const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec, execFile } = require("child_process");
// msmc and discord-rpc are required where first used, so they don't delay the window.
const { launchMinecraft, getInstanceDir, getProfileSlugs, searchModrinthMods, fetchJson } = require("./src/launcher");
const { listReleaseVersions } = require("./src/java");
const { pingServer } = require("./src/server-status");
const presence = require("./src/presence");
const accounts = require("./src/accounts");
const analytics = require("./src/analytics");
const skins = require("./src/skin");
const { buildNewsItems } = require("./src/news");

// Public Aptabase app key (it ships inside the app either way); the env var overrides it.
const APTABASE_APP_KEY = process.env.APTABASE_APP_KEY ?? "A-US-1329639096";

function getAnalyticsSettingsPath() {
  return path.join(app.getPath("userData"), "analytics.json");
}

// On by default; players can turn it off in Settings.
function isAnalyticsEnabled() {
  try {
    return JSON.parse(fs.readFileSync(getAnalyticsSettingsPath(), "utf8")).enabled !== false;
  } catch (_error) {
    return true;
  }
}

let stats = null;
function track(eventName, props) {
  if (!stats) {
    stats = analytics.createAnalytics({
      appKey: APTABASE_APP_KEY,
      appVersion: require("./package.json").version,
      isEnabled: isAnalyticsEnabled,
      isDebug: !app.isPackaged
    });
  }
  stats.track(eventName, props);
}
const { formatVersion, parseConnectedServer } = presence;

let mainWindow = null;
let activeLauncher = null;
let rpcClient = null;
let discordReady = false;
let lastPresenceSignature = "";
let inGameFallbackTimer = null;
const launcherSessionStart = Date.now();
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1412366181511335948";
const ENABLE_DISCORD_RPC = process.env.DISCORD_RPC !== "false";
const DISCORD_BUTTONS = [
  {
    label: process.env.DISCORD_BUTTON_1_LABEL || "Join Discord",
    url: process.env.DISCORD_BUTTON_1_URL || ""
  },
  {
    label: process.env.DISCORD_BUTTON_2_LABEL || "Download Launcher",
    url: process.env.DISCORD_BUTTON_2_URL || ""
  }
];
const DISCORD_SHOW_SERVER = process.env.DISCORD_SHOW_SERVER !== "false";

// Keep sign-in and settings next to the game data too, so the override is a true clean slate.
if (process.env.LEGENDS_DATA_DIR) {
  app.setPath("userData", path.join(process.env.LEGENDS_DATA_DIR, "legends-launcher"));
}

// Lightweight by design. The UI is a few mostly static pages, so it renders in software and
// keeps Chromium's GPU and network helpers inside the main process: two processes instead of
// four, about a third less RAM, and no graphics memory taken away from Minecraft.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("in-process-gpu");
app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess2");

// Two launchers would download into the same files at once: a second start focuses the first.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => restoreMainWindow());
}

// While Minecraft runs, the launcher's own processes drop to below-normal priority so they
// never compete with the game for CPU time. The game itself keeps normal priority.
function setLauncherPriority(priority) {
  for (const { pid } of app.getAppMetrics()) {
    try {
      os.setPriority(pid, priority);
    } catch (_error) {
      // a helper process may have exited in between
    }
  }
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

const getPresenceState = (serverHost) => presence.getPresenceState(serverHost, DISCORD_SHOW_SERVER);
const extractGameInfoFromCmdline = (cmdline) =>
  presence.extractGameInfoFromCmdline(cmdline, DISCORD_SHOW_SERVER);

function clearInGameFallbackTimer() {
  if (inGameFallbackTimer) {
    clearTimeout(inGameFallbackTimer);
    inGameFallbackTimer = null;
  }
}

// --- Renderer messaging ---
// The game can print thousands of lines per second. Sending each as its own IPC message
// floods the renderer, so log lines are batched and progress is throttled.

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

const LOG_FLUSH_MS = 100;
let pendingLogLines = [];
let logFlushTimer = null;

function sendStatus(message) {
  pendingLogLines.push(String(message));
  if (logFlushTimer) {
    return;
  }
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    const lines = pendingLogLines;
    pendingLogLines = [];
    sendToRenderer("launcher:log", lines);
  }, LOG_FLUSH_MS);
}

const PROGRESS_THROTTLE_MS = 80;
let lastProgress = null;
let lastProgressSentAt = 0;
let progressTimer = null;

function sendProgress(progress) {
  const stageChanged = !lastProgress || lastProgress.stage !== progress.stage;
  lastProgress = progress;
  const elapsed = Date.now() - lastProgressSentAt;
  if (stageChanged || elapsed >= PROGRESS_THROTTLE_MS) {
    clearTimeout(progressTimer);
    progressTimer = null;
    lastProgressSentAt = Date.now();
    sendToRenderer("launcher:progress", progress);
    return;
  }
  if (!progressTimer) {
    progressTimer = setTimeout(() => {
      progressTimer = null;
      lastProgressSentAt = Date.now();
      sendToRenderer("launcher:progress", lastProgress);
    }, PROGRESS_THROTTLE_MS - elapsed);
  }
}

// phase: "idle" | "preparing" | "running" | "error"
function sendPhase(phase, message = "") {
  if (phase !== "preparing") {
    lastProgress = null;
  }
  sendToRenderer("launcher:phase", { phase, message });
}

// --- Discord Rich Presence ---

async function setDiscordPresence(overrides = {}) {
  if (!ENABLE_DISCORD_RPC || !rpcClient || !discordReady) {
    return;
  }

  const payload = {
    largeImageKey: "legends_launcher_logo",
    largeImageText: "Legends Launcher",
    smallImageKey: "minecraft_icon",
    smallImageText: "Minecraft",
    startTimestamp: launcherSessionStart,
    instance: false,
    ...overrides
  };

  const buttons = presence.buildDiscordButtons(DISCORD_BUTTONS);
  if (buttons.length > 0) {
    payload.buttons = buttons;
  }

  const signature = JSON.stringify(payload);
  if (signature === lastPresenceSignature) {
    return;
  }

  try {
    await rpcClient.setActivity(payload);
    lastPresenceSignature = signature;
  } catch (_error) {
    // Ignore non-fatal Rich Presence failures.
  }
}

let externalGameCheckTimer = null;
let lastKnownGameRunning = false;
const EXTERNAL_GAME_POLL_MS = 15000;

// Shows "In game" for a Minecraft that was already running when Discord connected. Games this
// launcher starts update presence directly, so an idle launcher spawns no process at all:
// polling continues only while such an outside game is open, to notice when it closes.
async function refreshExternalGamePresence() {
  clearTimeout(externalGameCheckTimer);
  externalGameCheckTimer = null;
  if (activeLauncher || !discordReady) {
    return;
  }
  const status = await checkMinecraftRunning();
  if (status.running && !lastKnownGameRunning) {
    lastKnownGameRunning = true;
    const info = extractGameInfoFromCmdline(status.cmdline);
    await setDiscordPresence({
      state: `${info.version} | ${info.state}`,
      smallImageKey: "play_icon",
      smallImageText: "In game"
    });
  } else if (!status.running && lastKnownGameRunning) {
    lastKnownGameRunning = false;
    await setDiscordPresence({ smallImageKey: "minecraft_icon", smallImageText: "Minecraft" });
  }
  if (status.running) {
    externalGameCheckTimer = setTimeout(refreshExternalGamePresence, EXTERNAL_GAME_POLL_MS);
  }
}

// wmic is removed on recent Windows 11 builds; once it fails, go straight to PowerShell
// instead of spawning a failing process every poll.
let wmicAvailable = true;

function checkMinecraftRunningPowerShell(resolve) {
  exec("powershell -NoProfile -command \"Get-CimInstance Win32_Process -Filter 'Name=''javaw.exe'' or Name=''java.exe''' | Select-Object -ExpandProperty CommandLine\"", { windowsHide: true }, (err, stdout) => {
    resolve({ running: !err && (stdout || "").includes(".minecraft"), cmdline: stdout || "" });
  });
}

// PowerShell costs ~0.7 s of CPU per call, too much to run every few seconds. tasklist is
// far cheaper and answers "is any Java running?"; only then is the command line read.
function anyJavaRunning() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? true : /"javaw?\.exe"/i.test(stdout));
    });
  });
}

function checkMinecraftRunning() {
  return new Promise(async (resolve) => {
    if (process.platform === "win32") {
      if (!(await anyJavaRunning())) {
        resolve({ running: false, cmdline: "" });
        return;
      }
      if (!wmicAvailable) {
        checkMinecraftRunningPowerShell(resolve);
        return;
      }
      exec('wmic process where "name=\'javaw.exe\' or name=\'java.exe\'" get commandline', { windowsHide: true }, (err, stdout) => {
        if (err) {
          wmicAvailable = false;
          checkMinecraftRunningPowerShell(resolve);
          return;
        }
        resolve({ running: (stdout || "").includes(".minecraft"), cmdline: stdout || "" });
      });
    } else {
      exec("ps -ax -o command", (err, stdout) => {
        resolve({ running: !err && (stdout || "").includes(".minecraft") && (stdout || "").includes("java"), cmdline: stdout || "" });
      });
    }
  });
}

function initializeDiscordRpc() {
  if (rpcClient) {
    return;
  }
  if (!ENABLE_DISCORD_RPC) {
    sendStatus("Discord Rich Presence disabled (DISCORD_RPC=false).");
    return;
  }

  const RPC = require("discord-rpc");
  RPC.register(DISCORD_CLIENT_ID);
  rpcClient = new RPC.Client({ transport: "ipc" });

  rpcClient.on("ready", async () => {
    discordReady = true;
    sendStatus("Discord Rich Presence connected.");

    await refreshExternalGamePresence();
    if (!lastKnownGameRunning) {
      await setDiscordPresence();
    }
  });

  rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
    sendStatus("Discord Rich Presence not connected (open Discord desktop app).");
  });
}

// --- Auto-update (packaged builds only) ---

let autoUpdater = null;

function initializeAutoUpdates() {
  if (!app.isPackaged) {
    return;
  }
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (_error) {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let pendingVersion = null;
  autoUpdater.on("update-available", (info) => {
    pendingVersion = info.version;
    sendToRenderer("launcher:update", { state: "downloading", version: info.version, percent: 0 });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("launcher:update", {
      state: "downloading",
      version: pendingVersion,
      percent: Math.round(progress.percent || 0)
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendToRenderer("launcher:update", { state: "ready", version: info.version });
  });
  autoUpdater.on("error", (error) => {
    // Only the first line: the full stack is noise in the console.
    sendStatus(`Update check failed: ${String(error.message).split("\n")[0]}`);
  });
  autoUpdater.checkForUpdates().catch(() => {});
  // Players leave the launcher open for hours: look for new releases every few hours too.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), UPDATE_CHECK_INTERVAL_MS);
}

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function isGameRunning() {
  return Boolean(activeLauncher?.process && activeLauncher.process.exitCode === null);
}

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 920,
    minHeight: 640,
    title: "Legends Launcher",
    // Paint the app color immediately and only show once the first frame is ready,
    // so there is no white flash on startup.
    show: false,
    backgroundColor: "#faf8f4",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#faf8f4",
      symbolColor: "#262323",
      height: 48
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    // Discord and update checks aren't needed for the first frame: start them once visible.
    setTimeout(() => {
      initializeDiscordRpc();
      initializeAutoUpdates();
      track("app_started", {
        ram: analytics.ramBucket(os.totalmem() / (1024 * 1024)),
        accounts: accounts.listAccounts(readAccountStore()).length
      });
    }, 1500);
  });
  // Links opened from the UI go to the default browser, never a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (presence.isValidUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // The launcher page itself never navigates away, whatever gets clicked.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (presence.isValidUrl(url)) shell.openExternal(url);
  });
  mainWindow.loadFile(path.join(__dirname, "src", "renderer", "index.html"));
}

app.whenReady().then(() => {
  if (!hasInstanceLock) {
    return;
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  clearTimeout(externalGameCheckTimer);
  externalGameCheckTimer = null;
  if (rpcClient) {
    try {
      await rpcClient.clearActivity();
      rpcClient.destroy();
    } catch (_error) {
      // no-op
    }
    rpcClient = null;
  }
});

// --- Microsoft Authentication & Session Management ---

let currentMclcUser = null;

function getAuthProfilePath() {
  return path.join(app.getPath("userData"), "auth_profile.json");
}

// Tokens are encrypted with the OS keystore (DPAPI on Windows) when it is available.
// Files from older versions are plain JSON; they are read as-is and encrypted on next save.
const ENCRYPTED_PREFIX = "enc:";

function readAccountStore() {
  try {
    const filePath = getAuthProfilePath();
    if (fs.existsSync(filePath)) {
      let raw = fs.readFileSync(filePath, "utf8");
      if (raw.startsWith(ENCRYPTED_PREFIX)) {
        raw = safeStorage.decryptString(Buffer.from(raw.slice(ENCRYPTED_PREFIX.length), "base64"));
      }
      return accounts.normalizeStore(JSON.parse(raw));
    }
  } catch (err) {
    console.error("[Auth] Error reading auth profile:", err.message);
  }
  return accounts.normalizeStore(null);
}

function writeAccountStore(store) {
  try {
    const filePath = getAuthProfilePath();
    if (!store.active) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const json = JSON.stringify(store);
    const contents = safeStorage.isEncryptionAvailable()
      ? ENCRYPTED_PREFIX + safeStorage.encryptString(json).toString("base64")
      : json;
    fs.writeFileSync(filePath, contents, "utf8");
  } catch (err) {
    console.error("[Auth] Error saving auth profile:", err.message);
  }
}

function loadSavedAuthProfile() {
  return accounts.activeAccount(readAccountStore());
}

function saveAuthProfile(authObj) {
  writeAccountStore(accounts.upsertAccount(readAccountStore(), authObj));
}

// Signs out the active account only; another saved account becomes active.
function clearAuthProfile() {
  const store = readAccountStore();
  writeAccountStore(accounts.removeAccount(store, store.active));
}

function isExpiringSoon(auth) {
  return Date.now() >= (auth.meta?.exp || 0) - 5 * 60 * 1000;
}

// One refresh at a time: the startup background refresh and a Play click share it,
// instead of spending the same refresh token twice.
let pendingRefresh = null;

async function ensureValidAuth(savedAuth) {
  if (!savedAuth) {
    return { ok: false, message: "No authentication session." };
  }

  if (!isExpiringSoon(savedAuth) && savedAuth.access_token && savedAuth.name) {
    return { ok: true, profile: savedAuth };
  }

  const refreshToken = savedAuth.meta?.refresh;
  if (!refreshToken) {
    clearAuthProfile();
    return { ok: false, message: "Session expired. Please sign in again." };
  }

  if (!pendingRefresh) {
    pendingRefresh = refreshAuth(refreshToken).finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

async function refreshAuth(refreshToken) {
  try {
    const msmc = require("msmc");
    const authManager = new msmc.Auth();
    const xbox = await authManager.refresh(refreshToken);
    const mc = await xbox.getMinecraft();
    if (mc.isDemo()) {
      clearAuthProfile();
      return { ok: false, message: "This Microsoft account does not own Minecraft." };
    }
    const refreshedMclc = mc.mclc(true);
    saveAuthProfile(refreshedMclc);
    return { ok: true, profile: refreshedMclc };
  } catch (err) {
    console.error("[Auth] Token refresh failed:", err.message);
    clearAuthProfile();
    return { ok: false, message: "Session expired. Please sign in again." };
  }
}

function loginWithMicrosoft(parentWindow) {
  return new Promise((resolve, reject) => {
    const msmc = require("msmc");
    const authManager = new msmc.Auth("select_account");
    const redirectUri = "https://login.live.com/oauth20_desktop.srf";
    const authUrl = authManager.createLink(redirectUri);

    const loginWin = new BrowserWindow({
      width: 520,
      height: 680,
      parent: parentWindow || undefined,
      modal: Boolean(parentWindow),
      show: true,
      autoHideMenuBar: true,
      title: "Sign in with Microsoft - Legends Launcher",
      backgroundColor: "#faf8f4",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    // Only the en-US locale ships (a smaller install), which would also make the sign-in page
    // English for everyone: ask Microsoft for the player's own Windows languages instead.
    loginWin.webContents.session.setUserAgent(
      loginWin.webContents.getUserAgent(),
      app.getPreferredSystemLanguages().join(",")
    );

    let handled = false;

    const checkUrl = async (url) => {
      if (handled || !url) return;
      if (url.startsWith(redirectUri)) {
        handled = true;
        try {
          const parsedUrl = new URL(url);
          const code = parsedUrl.searchParams.get("code");
          const error = parsedUrl.searchParams.get("error");
          const errorDesc = parsedUrl.searchParams.get("error_description");

          try {
            loginWin.close();
          } catch (_) {}

          if (error) {
            reject(new Error(errorDesc || error || "Microsoft authentication canceled."));
            return;
          }

          if (!code) {
            reject(new Error("No authorization code received from Microsoft."));
            return;
          }

          const xbox = await authManager.login(code, redirectUri);
          const mc = await xbox.getMinecraft();
          if (mc.isDemo()) {
            reject(new Error("This Microsoft account does not own Minecraft (Demo account)."));
            return;
          }

          resolve(mc);
        } catch (err) {
          reject(err);
        }
      }
    };

    loginWin.webContents.on("will-navigate", (_event, url) => {
      checkUrl(url);
    });

    loginWin.webContents.on("will-redirect", (_event, url) => {
      checkUrl(url);
    });

    loginWin.webContents.on("did-finish-load", () => {
      checkUrl(loginWin.webContents.getURL());
    });

    loginWin.on("closed", () => {
      if (!handled) {
        handled = true;
        reject(new Error("Sign-in window was closed."));
      }
    });

    loginWin.loadURL(authUrl).catch((err) => {
      if (!handled) {
        handled = true;
        reject(err);
      }
    });
  });
}

// Answers from the saved session without waiting on the network, so Play is ready instantly.
// An expiring token is refreshed in the background; Play re-validates before launching.
ipcMain.handle("launcher:auth-get", async () => {
  const session = currentMclcUser || loadSavedAuthProfile();
  if (!session) {
    return { authenticated: false };
  }
  currentMclcUser = session;
  if (isExpiringSoon(session)) {
    ensureValidAuth(session).then((check) => {
      currentMclcUser = check.ok ? check.profile : null;
      if (!check.ok) {
        sendToRenderer("launcher:signed-out", { message: check.message });
      }
    });
  }
  return { authenticated: true, profile: { name: session.name, uuid: session.uuid } };
});

ipcMain.handle("launcher:auth-login", async () => {
  try {
    const mc = await loginWithMicrosoft(mainWindow);
    const mclcAuth = mc.mclc(true);
    saveAuthProfile(mclcAuth);
    currentMclcUser = mclcAuth;
    track("account_added", { accounts: accounts.listAccounts(readAccountStore()).length });
    return {
      ok: true,
      profile: {
        name: mclcAuth.name,
        uuid: mclcAuth.uuid
      }
    };
  } catch (error) {
    return { ok: false, message: error.message || "Login failed." };
  }
});

// Signing out drops the active account; the next saved one (if any) takes over.
ipcMain.handle("launcher:auth-logout", async () => {
  clearAuthProfile();
  currentMclcUser = loadSavedAuthProfile();
  return { ok: true, profile: currentMclcUser ? { name: currentMclcUser.name, uuid: currentMclcUser.uuid } : null };
});

ipcMain.handle("launcher:accounts-list", () => accounts.listAccounts(readAccountStore()));

// --- News ---
// Fetched at most every few hours and kept on disk, so most launches make no news requests
// and the column still shows offline.
const NEWS_TTL_MS = 6 * 60 * 60 * 1000;

function getNewsCachePath() {
  return path.join(app.getPath("userData"), "news-cache.json");
}

ipcMain.handle("launcher:news", async () => {
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(getNewsCachePath(), "utf8"));
  } catch (_error) {
    // no cache yet
  }
  if (Array.isArray(cached?.items) && Date.now() - cached.fetchedAt < NEWS_TTL_MS) {
    return { items: cached.items };
  }
  const [news, patchNotes, releases] = await Promise.all([
    fetchJson("https://launchercontent.mojang.com/v2/news.json").catch(() => null),
    fetchJson("https://launchercontent.mojang.com/v2/javaPatchNotes.json").catch(() => null),
    fetchJson("https://api.github.com/repos/SoumyA4348/legends-launcher/releases?per_page=5").catch(() => null)
  ]);
  if (!news && !patchNotes) {
    return { items: Array.isArray(cached?.items) ? cached.items : [] };
  }
  const items = buildNewsItems({ news, patchNotes, releases });
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(getNewsCachePath(), JSON.stringify({ fetchedAt: Date.now(), items }));
  } catch (_error) {
    // not fatal: fetched again next time
  }
  return { items };
});

// The active account's skin for the Play page. Looked up once per account per session; a
// failed lookup (offline) isn't cached, so the next visit tries again.
const skinCache = new Map();
ipcMain.handle("launcher:skin", async () => {
  const uuid = skins.normalizeUuid(currentMclcUser?.uuid);
  if (!uuid) {
    return null;
  }
  if (!skinCache.has(uuid)) {
    try {
      const profile = await fetchJson(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
      skinCache.set(uuid, skins.parseSkinProfile(profile, uuid));
    } catch (_error) {
      return skins.fallbackSkin(uuid);
    }
  }
  return skinCache.get(uuid);
});

ipcMain.handle("launcher:accounts-switch", (_event, uuid) => {
  if (isGameRunning()) {
    return { ok: false, message: "Close Minecraft before switching accounts." };
  }
  const store = readAccountStore();
  if (!store.accounts[uuid]) {
    return { ok: false, message: "That account isn't saved anymore." };
  }
  const next = accounts.switchAccount(store, uuid);
  writeAccountStore(next);
  currentMclcUser = accounts.activeAccount(next);
  track("account_switched");
  return { ok: true, profile: { name: currentMclcUser.name, uuid: currentMclcUser.uuid } };
});

ipcMain.handle("launcher:analytics-get", () => ({ enabled: isAnalyticsEnabled(), configured: Boolean(analytics.hostForKey(APTABASE_APP_KEY)) }));

ipcMain.handle("launcher:analytics-set", (_event, enabled) => {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(getAnalyticsSettingsPath(), JSON.stringify({ enabled: enabled === true }));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

// The UI may report only these events; everything else is tracked here in the main process.
const RENDERER_EVENTS = new Set(["content_added", "instance_created", "news_opened"]);
ipcMain.handle("launcher:analytics-track", (_event, eventName, props) => {
  if (RENDERER_EVENTS.has(eventName)) track(eventName, props);
});

ipcMain.handle("launcher:accounts-remove", (_event, uuid) => {
  const store = readAccountStore();
  if (store.active === uuid && isGameRunning()) {
    return { ok: false, message: "Close Minecraft before removing the account in use." };
  }
  const next = accounts.removeAccount(store, uuid);
  writeAccountStore(next);
  currentMclcUser = accounts.activeAccount(next);
  return { ok: true, profile: currentMclcUser ? { name: currentMclcUser.name, uuid: currentMclcUser.uuid } : null };
});

// --- UI data ---

ipcMain.handle("launcher:versions", async () => {
  try {
    return { ok: true, ...(await listReleaseVersions(fetchJson)) };
  } catch (_error) {
    return { ok: false, latest: null, releases: [] };
  }
});

ipcMain.handle("launcher:system-info", () => ({
  totalMemoryMb: Math.floor(os.totalmem() / (1024 * 1024)),
  appVersion: require("./package.json").version,
  profileSlugs: getProfileSlugs()
}));

ipcMain.handle("launcher:server-status", async (_event, host, port) => {
  const cleanHost = String(host || "").trim();
  const cleanPort = Number.parseInt(port, 10) || 25565;
  if (!cleanHost || cleanPort < 1 || cleanPort > 65535) {
    return { online: false, error: "No server set" };
  }
  return pingServer(cleanHost, cleanPort);
});

ipcMain.handle("launcher:open-game-folder", async (_event, instanceId) => {
  try {
    const dir = getInstanceDir(instanceId);
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return { ok: !error, message: error };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle("launcher:mods-search", async (_event, query, version, type) => {
  const cleanQuery = String(query || "").trim().slice(0, 100);
  const cleanVersion = /^[\w.-]{1,32}$/.test(String(version || "")) ? String(version) : "";
  const cleanType = ["mod", "resourcepack", "shader"].includes(type) ? type : "mod";
  try {
    return { ok: true, hits: await searchModrinthMods(cleanQuery, cleanVersion, cleanType) };
  } catch (_error) {
    return { ok: false, hits: [], message: "Could not reach Modrinth. Check your connection." };
  }
});

ipcMain.handle("launcher:instance-delete", async (_event, instanceId, name) => {
  if (!instanceId || instanceId === "default") {
    return { ok: false, message: "The default instance can't be deleted." };
  }
  if (activeLauncher) {
    return { ok: false, message: "Close Minecraft before deleting an instance." };
  }
  let dir;
  try {
    dir = getInstanceDir(instanceId);
  } catch (error) {
    return { ok: false, message: error.message };
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Delete instance",
    message: `Delete "${String(name || instanceId).slice(0, 60)}"?`,
    detail: "Its worlds, mods, screenshots and settings will be removed. This can't be undone."
  });
  if (response !== 0) {
    return { ok: false, cancelled: true };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
});

// Only the report found by the last crash can be opened: the renderer never supplies a path.
let lastCrashReport = null;
let stopRequested = false;

ipcMain.handle("launcher:open-crash-report", async () => {
  if (!lastCrashReport || !fs.existsSync(lastCrashReport)) {
    return { ok: false, message: "No crash report was written." };
  }
  const error = await shell.openPath(lastCrashReport);
  return { ok: !error, message: error };
});

ipcMain.handle("launcher:stop", () => {
  const child = activeLauncher?.process;
  if (!child || child.exitCode !== null) {
    return { ok: false, message: "Minecraft isn't running." };
  }
  stopRequested = true;
  // taskkill /T also ends child processes; a plain kill can leave the game window open.
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    child.kill();
  }
  return { ok: true };
});

// Restarting closes the game with it; the update installs on the next quit instead.
ipcMain.handle("launcher:install-update", () => {
  if (!autoUpdater) {
    return { ok: false, message: "Updates are only available in the installed launcher." };
  }
  if (isGameRunning()) {
    return { ok: false, message: "Close Minecraft first. The update will also install when you quit the launcher." };
  }
  track("update_installed");
  // Give the event a moment to leave before the app quits.
  setTimeout(() => autoUpdater.quitAndInstall(), 500);
  return { ok: true };
});

// --- Launch ---

ipcMain.handle("launcher:start", async (_event, launchConfig) => {
  if (activeLauncher) {
    const activeProcess = activeLauncher?.process;
    const isStillRunning = Boolean(activeProcess && activeProcess.exitCode === null);
    if (isStillRunning) {
      return { ok: false, message: "Minecraft is already running from this launcher." };
    }
    activeLauncher = null;
  }

  // Strictly enforce verified Microsoft authentication
  let authToUse = currentMclcUser;
  if (!authToUse) {
    const saved = loadSavedAuthProfile();
    if (saved) {
      const valid = await ensureValidAuth(saved);
      if (valid.ok) {
        authToUse = valid.profile;
        currentMclcUser = valid.profile;
      }
    }
  }

  if (!authToUse || !authToUse.access_token || authToUse.access_token === "0" || !authToUse.name) {
    return {
      ok: false,
      message: "Microsoft authentication is required. Please sign in to launch Minecraft."
    };
  }

  const freshCheck = await ensureValidAuth(authToUse);
  if (!freshCheck.ok) {
    return {
      ok: false,
      message: freshCheck.message || "Authentication expired. Please sign in again."
    };
  }
  authToUse = freshCheck.profile;
  currentMclcUser = freshCheck.profile;

  const enforcedConfig = {
    ...launchConfig,
    auth: authToUse,
    username: authToUse.name
  };

  const launchVersion = formatVersion(enforcedConfig?.version);
  let currentPresenceState = enforcedConfig?.serverHost
    ? getPresenceState(enforcedConfig.serverHost)
    : "Main Menu";
  let isInGame = false;
  let minimizedForGame = false;
  const minimizeWhilePlaying = launchConfig?.launcherBehavior === "minimize";
  const presenceFor = (smallImageKey, smallImageText) =>
    setDiscordPresence({ state: `${launchVersion} | ${currentPresenceState}`, smallImageKey, smallImageText });

  const mcVersion = String(enforcedConfig?.version || "").slice(0, 16);
  let gameStartedAt = 0;
  const markInGame = () => {
    if (isInGame) return;
    isInGame = true;
    gameStartedAt = Date.now();
    track("game_started", { mcVersion });
    clearInGameFallbackTimer();
    sendPhase("running", "Minecraft is running.");
    presenceFor("play_icon", "In game");
    if (minimizeWhilePlaying && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      mainWindow.minimize();
      minimizedForGame = true;
    }
    setLauncherPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  };

  const PRESENCE_BY_STAGE = {
    java: ["minecraft_icon", "Installing Java"],
    loader: ["minecraft_icon", "Installing mods"],
    mods: ["minecraft_icon", "Installing mods"],
    game: ["minecraft_icon", "Downloading"],
    launching: ["play_icon", "Starting"]
  };
  let presenceStage = null;
  // launchMinecraft reports a failure via "Launch error:" and then onExit; keep the
  // error visible instead of letting onExit reset the UI to idle.
  let launchFailed = false;

  clearInGameFallbackTimer();
  stopRequested = false;
  lastCrashReport = null;
  const extras = Array.isArray(launchConfig?.extraMods) ? launchConfig.extraMods : [];
  track("launch_started", {
    mcVersion,
    profile: launchConfig?.launchProfile === "full" ? "full" : "competitive",
    mods: extras.filter((item) => !item?.type || item.type === "mod").length,
    packs: extras.filter((item) => item?.type && item.type !== "mod").length,
    server: Boolean(enforcedConfig?.serverHost)
  });
  sendPhase("preparing", "Starting launch sequence...");
  presenceFor("play_icon", "Starting");

  try {
    activeLauncher = await launchMinecraft(enforcedConfig, {
      onProgress: (progress) => {
        sendProgress(progress);
        if (progress.stage !== presenceStage && PRESENCE_BY_STAGE[progress.stage]) {
          presenceStage = progress.stage;
          presenceFor(...PRESENCE_BY_STAGE[progress.stage]);
        }
        if (progress.stage === "launching" && !inGameFallbackTimer) {
          // If no recognisable "game started" log line appears, assume in-game after 20s.
          inGameFallbackTimer = setTimeout(markInGame, 20000);
        }
      },
      onStatus: (message) => {
        sendStatus(message);

        const connectedServer = parseConnectedServer(message);
        if (connectedServer) {
          currentPresenceState = getPresenceState(connectedServer.host);
          isInGame = false;
          markInGame();
          return;
        }

        if (
          /loading minecraft/i.test(message) ||
          /knotclient/i.test(message) ||
          /net\.minecraft\.client\.main\.main/i.test(message)
        ) {
          markInGame();
          return;
        }

        // A game stopped from the launcher exits non-zero; that's not a crash.
        if (message.startsWith("Launch error:") && !stopRequested) {
          launchFailed = true;
          // After the game is up, a non-zero exit is a crash (tracked on exit), not a failed launch.
          if (!isInGame) {
            track("launch_failed", { mcVersion, reason: analytics.errorCategory(message), stage: presenceStage || "start" });
          }
          clearInGameFallbackTimer();
          sendPhase("error", message.slice("Launch error:".length).trim());
          presenceFor("minecraft_icon", "Check launcher logs");
        }
      },
      onExit: ({ code, crashReport } = {}) => {
        clearInGameFallbackTimer();
        activeLauncher = null;
        if (isInGame && launchFailed && !stopRequested) {
          track("game_crashed", { mcVersion, exitCode: Number(code) || 0, report: Boolean(crashReport) });
        } else if (isInGame) {
          track("game_closed", { mcVersion, played: analytics.minutesBucket(Date.now() - gameStartedAt), stopped: stopRequested });
        }
        if (stopRequested) {
          sendPhase("idle", "Minecraft stopped.");
        } else if (!launchFailed) {
          sendPhase("idle", "Minecraft closed. Ready to launch again.");
        } else if (crashReport) {
          lastCrashReport = crashReport;
          sendToRenderer("launcher:phase", {
            phase: "error",
            message: "Minecraft crashed. Open the crash report to see why.",
            crashReport: true
          });
        }
        setLauncherPriority(os.constants.priority.PRIORITY_NORMAL);
        // Bring the launcher back after a crash, or when it was minimized for the game.
        if (minimizedForGame || launchFailed) {
          restoreMainWindow();
        }
        setDiscordPresence({
          smallImageKey: "minecraft_icon",
          smallImageText: "Minecraft"
        });
      }
    });

    return { ok: true, message: "Launch sequence started." };
  } catch (error) {
    activeLauncher = null;
    clearInGameFallbackTimer();
    const message = error instanceof Error ? error.message : "Unknown launch failure.";
    // launchMinecraft may already have reported this failure through onStatus.
    if (!launchFailed) {
      track("launch_failed", { mcVersion, reason: analytics.errorCategory(message), stage: presenceStage || "start" });
    }
    sendPhase("error", message);
    return { ok: false, message };
  }
});
