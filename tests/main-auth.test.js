const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { loadMain } = require("./helpers/main");

let refreshError = null; // what msmc's refresh throws next
const { handlers, storePath, saveAccounts, savedIds } = loadMain({
  msmc: {
    Auth: class {
      async refresh() {
        throw refreshError;
      }
    }
  }
});

// What msmc 5 really throws (checked 2026-11-18): no network is a node-fetch FetchError,
// a refused token is { ts, response } carrying the HTTP status.
const offline = Object.assign(new Error("request to https://login.live.com/oauth20_token.srf failed, reason: getaddrinfo ENOTFOUND login.live.com"), {
  name: "FetchError",
  code: "ENOTFOUND"
});
const outage = { ts: "error.auth.xsts", response: { status: 503 } };
const refused = { ts: "error.auth.microsoft", response: { status: 400 } };

const TOKEN_EXPIRED = -60 * 1000;
const clickPlay = () => handlers["launcher:start"]({}, { version: "1.21.1" });

test("offline Play keeps every saved account", async () => {
  saveAccounts(["a", "b", "c"], TOKEN_EXPIRED);
  refreshError = offline;
  for (let click = 0; click < 3; click++) {
    const result = await clickPlay();
    assert.equal(result.ok, false);
    assert.match(result.message, /Can't reach Microsoft/);
  }
  assert.deepEqual(savedIds(), ["a", "b", "c"]);
});

test("a Microsoft or Xbox outage keeps the account", async () => {
  saveAccounts(["a", "b"], TOKEN_EXPIRED);
  refreshError = outage;
  await clickPlay();
  assert.deepEqual(savedIds(), ["a", "b"]);
});

test("a refused refresh signs out only that account", async () => {
  saveAccounts(["a", "b"], TOKEN_EXPIRED);
  refreshError = refused;
  const result = await clickPlay();
  assert.match(result.message, /sign in again/i);
  assert.deepEqual(savedIds(), ["b"]);
  assert.ok(!fs.existsSync(`${storePath}.tmp`)); // saved by swapping in a whole new file
});
