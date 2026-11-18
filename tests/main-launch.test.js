const test = require("node:test");
const assert = require("node:assert/strict");
const launcher = require("../src/launcher");
const { loadMain } = require("./helpers/main");

// Preparing (Java, mods, game files) can take minutes on a first run; this one waits for us.
let finishPreparing;
const { handlers, saveAccounts } = loadMain({
  "./src/launcher": {
    ...launcher,
    launchMinecraft: () => new Promise((resolve) => (finishPreparing = () => resolve({ process: { exitCode: 0 } })))
  }
});

test("a second Play or an instance delete waits until the first launch is prepared", async () => {
  saveAccounts(["steve"], 60 * 60 * 1000);
  const first = handlers["launcher:start"]({}, { version: "1.21.1", instanceId: "pvp" });
  await new Promise((resolve) => setImmediate(resolve));

  const second = await handlers["launcher:start"]({}, { version: "1.21.1", instanceId: "pvp" });
  assert.equal(second.ok, false);
  const deleted = await handlers["launcher:instance-delete"]({}, "pvp", "PvP");
  assert.equal(deleted.ok, false);

  finishPreparing();
  assert.equal((await first).ok, true);
});
