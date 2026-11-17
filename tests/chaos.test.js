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
