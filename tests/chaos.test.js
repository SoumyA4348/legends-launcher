const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { createChaos, parseRate, FAULTS } = require("../src/chaos");
const launcher = require("../src/launcher");
const java = require("../src/java");

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legends-chaos-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Serves `handler` on localhost and routes the launcher's https.get calls to it.
async function withLocalServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const realGet = https.get;
  https.get = (url, ...rest) => http.get(String(url).replace(/^https:/, "http:"), ...rest);
  t.after(() => {
    https.get = realGet;
    server.closeAllConnections();
    server.close();
  });
  return `https://127.0.0.1:${server.address().port}`;
}

test("parseRate: off unless a positive number, capped at 1", () => {
  for (const off of [undefined, "", "abc", "0", "-0.5"]) assert.equal(parseRate(off), 0, String(off));
  assert.equal(parseRate("0.3"), 0.3);
  assert.equal(parseRate("5"), 1);
});

test("chaos off returns the original function", () => {
  const fn = async () => "ok";
  assert.equal(createChaos({ rate: 0 }).wrap("fetchJson", fn), fn);
});

test("chaos injects each fault kind as a network-style error", async () => {
  const seen = [];
  for (let i = 0; i < FAULTS.length; i++) {
    const rolls = [0, (i + 0.5) / FAULTS.length];
    const chaos = createChaos({ rate: 0.5, random: () => rolls.shift(), log: () => {} });
    const error = await chaos.wrap("fetchJson", async () => "ok")("https://x").catch((e) => e);
    seen.push(error.statusCode || error.code);
  }
  assert.deepEqual(seen, ["ECONNRESET", "ETIMEDOUT", 503]);
});

test("chaos lets a call through when the roll misses", async () => {
  const chaos = createChaos({ rate: 0.5, random: () => 0.9, log: () => {} });
  assert.equal(await chaos.wrap("fetchJson", async (url) => url)("https://x"), "https://x");
});

// Experiments: what broke first when the network misbehaved.

test("experiment: fetchJson rides out a transient 503", async (t) => {
  let hits = 0;
  const base = await withLocalServer(t, (_req, res) => {
    hits += 1;
    res.writeHead(hits === 1 ? 503 : 200, { "Content-Type": "application/json" });
    res.end(hits === 1 ? "" : '{"ok":true}');
  });
  assert.deepEqual(await launcher.fetchJson(`${base}/meta`), { ok: true });
  assert.equal(hits, 2);
});

test("experiment: fetchJson does not retry a 404", async (t) => {
  let hits = 0;
  const base = await withLocalServer(t, (_req, res) => {
    hits += 1;
    res.writeHead(404).end();
  });
  const error = await launcher.fetchJson(`${base}/missing`).catch((e) => e);
  assert.equal(error.statusCode, 404);
  assert.equal(hits, 1);
});

test("experiment: a download cut off mid-body fails cleanly", { timeout: 5000 }, async (t) => {
  const base = await withLocalServer(t, (_req, res) => {
    res.writeHead(200, { "Content-Length": "1000" });
    res.write(Buffer.alloc(400));
    setTimeout(() => res.socket.destroy(), 20);
  });
  const target = path.join(makeTempDir(t), "mod.jar");
  await assert.rejects(launcher.downloadFile(`${base}/mod.jar`, target, { retries: 0 }));
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(`${target}.tmp`), false);
});

test("experiment: a stalled download times out instead of hanging", { timeout: 5000 }, async (t) => {
  const base = await withLocalServer(t, (_req, res) => {
    res.writeHead(200, { "Content-Length": "1000" });
    res.write(Buffer.alloc(10));
  });
  const target = path.join(makeTempDir(t), "java.zip");
  await assert.rejects(
    launcher.downloadFile(`${base}/java.zip`, target, { timeoutMs: 200, retries: 0 }),
    /timed out|stalled/i
  );
  assert.equal(fs.existsSync(`${target}.tmp`), false);
});

test("experiment: offline Java lookup keeps old versions on Java 8", async (t) => {
  const offline = async () => {
    throw Object.assign(new Error("offline"), { code: "ENOTFOUND" });
  };
  const minecraftRoot = makeTempDir(t);
  const expected = { "1.8.9": 8, "1.16.5": 8, "1.17.1": 16, "1.18.2": 17, "1.20.4": 17, "1.20.5": 21, "1.21.1": 21 };
  for (const [version, major] of Object.entries(expected)) {
    assert.equal(await java.getRequiredJavaMajor(version, { minecraftRoot, fetchJson: offline }), major, version);
  }
  // A guess is never written to the permanent cache.
  assert.equal(fs.existsSync(path.join(minecraftRoot, ".legends-java-majors.json")), false);
});

// Reviews: the POST to the website had no retry, so one dropped connection lost the review.
const { submitReview } = require("../src/review");

function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { ok: next >= 200 && next < 300, status: next };
  };
  return { fetchImpl, calls };
}

test("experiment: a review survives a dropped connection and a 503", async () => {
  const reset = Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
  const { fetchImpl, calls } = fakeFetch([reset, 503, 201]);
  const res = await submitReview("https://site/reviews", { rating: 5 }, { fetchImpl, baseDelayMs: 0 });
  assert.equal(res.status, 201);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body, { rating: 5 });
});

test("reviews: 409 (already reviewed) and 429 (daily limit) are answers, not retried", async () => {
  for (const status of [409, 429]) {
    const { fetchImpl, calls } = fakeFetch([status]);
    const res = await submitReview("https://site/reviews", {}, { fetchImpl, baseDelayMs: 0 });
    assert.equal(res.status, status);
    assert.equal(calls.length, 1);
  }
});

test("reviews: a server that stays down fails with its status after 3 tries", async () => {
  const { fetchImpl, calls } = fakeFetch([503, 503, 503]);
  const error = await submitReview("https://site/reviews", {}, { fetchImpl, baseDelayMs: 0 }).catch((e) => e);
  assert.equal(error.statusCode, 503);
  assert.equal(calls.length, 3);
});

// Auto-update: a download that failed partway left the banner on "Downloading update…" for
// hours, and a failed check waited the full 4 hours before trying again.
const { EventEmitter } = require("events");
const { wireAutoUpdates, RETRY_DELAYS_MS } = require("../src/updater");

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.checkForUpdates = async () => {
    updater.checks++;
  };
  const sent = [];
  const timers = [];
  const setTimer = (fn, ms) => {
    const timer = { fn, ms, cleared: false };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    if (timer) timer.cleared = true;
  };
  wireAutoUpdates(updater, {
    send: (payload) => sent.push(payload),
    status: () => {},
    setTimer,
    clearTimer,
    every: () => {},
    chaos: createChaos({ rate: 0 })
  });
  const pending = () => timers.filter((timer) => !timer.cleared);
  return { updater, sent, pending };
}

test("experiment: a download that fails partway clears the banner and retries soon", () => {
  const { updater, sent, pending } = fakeUpdater();
  assert.equal(updater.checks, 1);
  updater.emit("update-available", { version: "9.9.9" });
  updater.emit("download-progress", { percent: 37 });
  updater.emit("error", new Error("net::ERR_CONNECTION_RESET"));
  assert.deepEqual(sent.at(-1), { state: "failed", version: "9.9.9" });
  assert.equal(pending().length, 1);
  assert.equal(pending()[0].ms, RETRY_DELAYS_MS[0]);
  pending()[0].fn();
  assert.equal(updater.checks, 2);
});

test("updater: retries back off, never stack, and reset after a good check", () => {
  const { updater, sent, pending } = fakeUpdater();
  const delays = [];
  for (let i = 0; i < RETRY_DELAYS_MS.length + 1; i++) {
    updater.emit("error", new Error("offline"));
    assert.equal(pending().length, 1);
    delays.push(pending()[0].ms);
  }
  assert.deepEqual(delays, [...RETRY_DELAYS_MS, RETRY_DELAYS_MS.at(-1)]);
  assert.equal(sent.length, 0, "a failed check with no download in flight shows nothing");
  updater.emit("update-not-available", {});
  assert.equal(pending().length, 0);
  updater.emit("error", new Error("offline"));
  assert.equal(pending()[0].ms, RETRY_DELAYS_MS[0]);
});

test("updater: chaos can fail a check, which then goes down the same retry path", async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  const timers = [];
  wireAutoUpdates(updater, {
    send: () => {},
    status: () => {},
    setTimer: (fn, ms) => timers.push(ms),
    clearTimer: () => {},
    every: () => {},
    chaos: createChaos({ rate: 1, random: () => 0, log: () => {} })
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timers, [RETRY_DELAYS_MS[0]]);
});
