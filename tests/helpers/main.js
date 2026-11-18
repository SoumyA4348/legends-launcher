// Loads the real main.js with a stand-in for Electron (plus any module a test swaps out), so
// its IPC handlers can be called without a window, an account or a network. Once per process:
// node --test runs every test file in its own process.
const Module = require("module");
const fs = require("fs");
const os = require("os");
const path = require("path");

function loadMain(stubs = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "legends-main-"));
  const userData = path.join(base, "legends-launcher");
  fs.mkdirSync(userData, { recursive: true });
  process.env.LEGENDS_DATA_DIR = base;
  process.env.APTABASE_APP_KEY = ""; // no analytics host, so no events leave
  process.env.DISCORD_RPC = "false";

  const handlers = {};
  const electron = {
    app: {
      setPath() {},
      getPath: () => userData,
      disableHardwareAcceleration() {},
      commandLine: { appendSwitch() {} },
      requestSingleInstanceLock: () => true,
      on() {},
      whenReady: () => new Promise(() => {}),
      getAppMetrics: () => [],
      isPackaged: false
    },
    BrowserWindow: class {},
    dialog: {},
    shell: {},
    ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
    safeStorage: { isEncryptionAvailable: () => false }
  };
  const replaced = { electron, ...stubs };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.hasOwn(replaced, request) ? replaced[request] : originalLoad.call(this, request, ...rest);
  };
  console.error = () => {};
  require("../../main.js");

  const storePath = path.join(userData, "auth_profile.json");
  // Saves accounts (the first is active); `expiresInMs` < 0 means their token needs a refresh.
  function saveAccounts(uuids, expiresInMs) {
    const accounts = Object.fromEntries(
      uuids.map((uuid) => [
        uuid,
        { access_token: `token-${uuid}`, name: uuid, uuid, meta: { refresh: `refresh-${uuid}`, exp: Date.now() + expiresInMs } }
      ])
    );
    fs.writeFileSync(storePath, JSON.stringify({ active: uuids[0], accounts }));
  }
  function savedIds() {
    try {
      return Object.keys(JSON.parse(fs.readFileSync(storePath, "utf8")).accounts).sort();
    } catch (_error) {
      return [];
    }
  }
  return { handlers, storePath, saveAccounts, savedIds };
}

module.exports = { loadMain };
