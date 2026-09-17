const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const RPC = require("discord-rpc");
const msmc = require("msmc");
const { launchMinecraft } = require("./src/launcher");

let mainWindow = null;
let activeLauncher = null;
let rpcClient = null;
let discordReady = false;
let lastPresenceSignature = "";
let inGameFallbackTimer = null;
const launcherSessionStart = Date.now();
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1412366181511335948";
const ENABLE_DISCORD_RPC = true;
const DISCORD_BUTTON_1_LABEL = process.env.DISCORD_BUTTON_1_LABEL || "Join Discord";
const DISCORD_BUTTON_1_URL = process.env.DISCORD_BUTTON_1_URL || "";
const DISCORD_BUTTON_2_LABEL = process.env.DISCORD_BUTTON_2_LABEL || "Download Launcher";
const DISCORD_BUTTON_2_URL = process.env.DISCORD_BUTTON_2_URL || "";
const DISCORD_SHOW_SERVER = process.env.DISCORD_SHOW_SERVER !== "false";

function isValidUrl(value) {
  if (!value) {
    return false; 
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_error) {
    return false;
  }
}

function buildDiscordButtons() {
  const buttons = [];
  if (isValidUrl(DISCORD_BUTTON_1_URL)) {
    buttons.push({
      label: DISCORD_BUTTON_1_LABEL.slice(0, 32),
      url: DISCORD_BUTTON_1_URL
    });
  }
  if (isValidUrl(DISCORD_BUTTON_2_URL)) {
    buttons.push({
      label: DISCORD_BUTTON_2_LABEL.slice(0, 32),
      url: DISCORD_BUTTON_2_URL
    });
  }
  return buttons.slice(0, 2);
}

function formatVersion(version) {
  const cleaned = String(version || "").trim();
  return cleaned || "Minecraft";
}

function isIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateOrLocalIpv4(ipv4) {
  const parts = ipv4.split(".").map((x) => Number(x));
  if (parts[0] === 10) {
    return true;
  }
  if (parts[0] === 127) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  return false;
}

function isIpv6Like(value) {
  return value.includes(":");
}

function sanitizeServerForPresence(serverHost, serverPort) {
  const normalizedHost = String(serverHost || "").trim().toLowerCase();

  if (!normalizedHost || normalizedHost === "localhost") {
    return "Private Server";
  }

  const isLocalDomain =
    normalizedHost.endsWith(".local") || normalizedHost.endsWith(".lan") || normalizedHost.endsWith(".home");
  if (isLocalDomain) {
    return "Private Server";
  }

  if (isIpv4(normalizedHost)) {
    return isPrivateOrLocalIpv4(normalizedHost)
      ? "Private Server"
      : "Public Server";
  }

  if (isIpv6Like(normalizedHost)) {
    return "Private Server";
  }

  return normalizedHost;
}

function getPresenceState(serverHost, serverPort) {
  if (!DISCORD_SHOW_SERVER) {
    return "Private Server";
  }
  return sanitizeServerForPresence(serverHost, serverPort);
}

function parseConnectedServer(message) {
  const match = message.match(/Connecting to\s+([^,\s]+),\s*(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    host: match[1],
    port: match[2]
  };
}

function clearInGameFallbackTimer() {
  if (inGameFallbackTimer) {
    clearTimeout(inGameFallbackTimer);
    inGameFallbackTimer = null;
  }
}

function sendStatus(message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("launcher:status", message);
}

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

  const buttons = buildDiscordButtons();
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

let externalGameCheckInterval = null;
let lastKnownGameRunning = false;

function checkMinecraftRunning() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec('wmic process where "name=\'javaw.exe\' or name=\'java.exe\'" get commandline', (err, stdout) => {
        if (!err && stdout && stdout.includes(".minecraft")) {
          resolve({ running: true, cmdline: stdout });
        } else if (err) {
          exec("powershell -command \"Get-CimInstance Win32_Process -Filter 'Name=''javaw.exe'' or Name=''java.exe''' | Select-Object -ExpandProperty CommandLine\"", (err2, stdout2) => {
            resolve({ running: !err2 && (stdout2 || "").includes(".minecraft"), cmdline: stdout2 || "" });
          });
        } else {
          resolve({ running: false, cmdline: "" });
        }
      });
    } else {
      exec("ps -ax -o command", (err, stdout) => {
        resolve({ running: !err && (stdout || "").includes(".minecraft") && (stdout || "").includes("java"), cmdline: stdout || "" });
      });
    }
  });
}

function extractGameInfoFromCmdline(cmdline) {
  if (!cmdline) return { version: "Minecraft", state: "Private Server" };

  let version = "Minecraft";
  let mVersion = cmdline.match(/--version\s+([^\s"']+)/) || cmdline.match(/--version\s+"([^"]+)"/);
  if (mVersion) version = mVersion[1];

  let host = "";
  let port = "25565";

  let mQuickPlay = cmdline.match(/--quickPlayMultiplayer\s+([^\s:]+)(?::(\d+))?/);
  if (mQuickPlay) {
    host = mQuickPlay[1];
    if (mQuickPlay[2]) port = mQuickPlay[2];
  } else {
    let mServer = cmdline.match(/--server\s+([^\s"']+)/);
    if (mServer) {
      host = mServer[1];
      let mPort = cmdline.match(/--port\s+(\d+)/);
      if (mPort) port = mPort[1];
    }
  }

  return { 
    version: formatVersion(version), 
    state: host ? getPresenceState(host, port) : "Private Server" 
  };
}

function initializeDiscordRpc() {
  if (!ENABLE_DISCORD_RPC) {
    sendStatus(
      "Discord Rich Presence disabled. Set DISCORD_CLIENT_ID env var to enable activity image."
    );
    return;
  }

  RPC.register(DISCORD_CLIENT_ID);
  rpcClient = new RPC.Client({ transport: "ipc" });

  rpcClient.on("ready", async () => {
    discordReady = true;
    sendStatus("Discord Rich Presence connected.");
    
    const status = await checkMinecraftRunning();
    lastKnownGameRunning = status.running;
    if (status.running) {
      const info = extractGameInfoFromCmdline(status.cmdline);
      await setDiscordPresence({
        state: `${info.version} | ${info.state}`,
        smallImageKey: "play_icon",
        smallImageText: "In game"
      });
    } else {
      await setDiscordPresence();
    }

    if (!externalGameCheckInterval) {
      externalGameCheckInterval = setInterval(async () => {
        if (activeLauncher) {
          lastKnownGameRunning = true; 
          return;
        }
        
        const currentlyRunningStatus = await checkMinecraftRunning();
        if (!currentlyRunningStatus.running && lastKnownGameRunning) {
          lastKnownGameRunning = false;
          await setDiscordPresence({
            smallImageKey: "minecraft_icon",
            smallImageText: "Minecraft"
          });
        } else if (currentlyRunningStatus.running && !lastKnownGameRunning) {
          lastKnownGameRunning = true;
          const info = extractGameInfoFromCmdline(currentlyRunningStatus.cmdline);
          await setDiscordPresence({
            state: `${info.version} | ${info.state}`,
            smallImageKey: "play_icon",
            smallImageText: "In game"
          });
        }
      }, 5000);
    }
  });

  rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
    sendStatus("Discord Rich Presence not connected (open Discord desktop app).");
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 900,
    minHeight: 650,
    title: "Legends Launcher",
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#050811',
      symbolColor: '#f8fafc',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, "src", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  initializeDiscordRpc();

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
  if (externalGameCheckInterval) {
    clearInterval(externalGameCheckInterval);
    externalGameCheckInterval = null;
  }
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

function loadSavedAuthProfile() {
  try {
    const filePath = getAuthProfilePath();
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (data && data.access_token && data.name) {
        return data;
      }
    }
  } catch (err) {
    console.error("[Auth] Error reading auth profile:", err.message);
  }
  return null;
}

function saveAuthProfile(authObj) {
  try {
    const filePath = getAuthProfilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(authObj, null, 2), "utf8");
  } catch (err) {
    console.error("[Auth] Error saving auth profile:", err.message);
  }
}

function clearAuthProfile() {
  try {
    const filePath = getAuthProfilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error("[Auth] Error clearing auth profile:", err.message);
  }
}

async function ensureValidAuth(savedAuth) {
  if (!savedAuth) {
    return { ok: false, message: "No authentication session." };
  }

  const exp = savedAuth.meta?.exp || 0;
  const isExpiringSoon = Date.now() >= (exp - 5 * 60 * 1000);

  if (!isExpiringSoon && savedAuth.access_token && savedAuth.name) {
    return { ok: true, profile: savedAuth };
  }

  const refreshToken = savedAuth.meta?.refresh;
  if (!refreshToken) {
    clearAuthProfile();
    return { ok: false, message: "Session expired. Please sign in again." };
  }

  try {
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
      backgroundColor: "#050811",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

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

ipcMain.handle("launcher:auth-get", async () => {
  if (currentMclcUser) {
    const check = await ensureValidAuth(currentMclcUser);
    if (check.ok) {
      currentMclcUser = check.profile;
      return {
        authenticated: true,
        profile: {
          name: currentMclcUser.name,
          uuid: currentMclcUser.uuid
        }
      };
    }
  }

  const saved = loadSavedAuthProfile();
  if (saved) {
    const check = await ensureValidAuth(saved);
    if (check.ok) {
      currentMclcUser = check.profile;
      return {
        authenticated: true,
        profile: {
          name: currentMclcUser.name,
          uuid: currentMclcUser.uuid
        }
      };
    }
  }

  currentMclcUser = null;
  return { authenticated: false };
});

ipcMain.handle("launcher:auth-login", async () => {
  try {
    const mc = await loginWithMicrosoft(mainWindow);
    const mclcAuth = mc.mclc(true);
    saveAuthProfile(mclcAuth);
    currentMclcUser = mclcAuth;
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

ipcMain.handle("launcher:auth-logout", async () => {
  currentMclcUser = null;
  clearAuthProfile();
  return { ok: true };
});

ipcMain.handle("launcher:auth", async () => {
  try {
    const mc = await loginWithMicrosoft(mainWindow);
    const mclcAuth = mc.mclc(true);
    saveAuthProfile(mclcAuth);
    currentMclcUser = mclcAuth;
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

  try {
    const launchVersion = enforcedConfig?.version || "unknown version";
    const serverHost = enforcedConfig?.serverHost || "unknown";
    const serverPort = enforcedConfig?.serverPort || "?";
    let currentPresenceState = getPresenceState(serverHost, serverPort);
    let hasSwitchedToInGame = false;

    clearInGameFallbackTimer();

    await setDiscordPresence({
      state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
      smallImageKey: "play_icon",
      smallImageText: "Starting"
    });

    inGameFallbackTimer = setTimeout(() => {
      if (!activeLauncher || hasSwitchedToInGame) {
        return;
      }
      hasSwitchedToInGame = true;
      setDiscordPresence({
        state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
        smallImageKey: "play_icon",
        smallImageText: "In game"
      });
    }, 20000);

    activeLauncher = await launchMinecraft(enforcedConfig, {
      onStatus: (message) => {
        sendStatus(message);

        const connectedServer = parseConnectedServer(message);
        if (connectedServer) {
          currentPresenceState = getPresenceState(
            connectedServer.host,
            connectedServer.port
          );
          setDiscordPresence({
            state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
            smallImageKey: "play_icon",
            smallImageText: "In game"
          });
          return;
        }

        if (message.includes("Preparing parkour speedrunner mod pack")) {
          setDiscordPresence({
            state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
            smallImageKey: "minecraft_icon",
            smallImageText: "Installing mods"
          });
          return;
        }

        if (message.includes("Downloading")) {
          setDiscordPresence({
            state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
            smallImageKey: "minecraft_icon",
            smallImageText: "Downloading"
          });
          return;
        }

        if (message.includes("Launching with")) {
          setDiscordPresence({
            state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
            smallImageKey: "play_icon",
            smallImageText: "Starting"
          });
          return;
        }

        if (
          /loading minecraft/i.test(message) ||
          /knotclient/i.test(message) ||
          /net\.minecraft\.client\.main\.main/i.test(message)
        ) {
          clearInGameFallbackTimer();
          hasSwitchedToInGame = true;
          setDiscordPresence({
            state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
            smallImageKey: "play_icon",
            smallImageText: "In game"
          });
          return;
        }

        if (message.includes("Minecraft closed")) {
          clearInGameFallbackTimer();
          setDiscordPresence({
            smallImageKey: "minecraft_icon",
            smallImageText: "Minecraft"
          });
          return;
        }

        if (message.includes("Launch error")) {
          clearInGameFallbackTimer();
          setDiscordPresence({
            state: `${formatVersion(launchVersion)} | ${currentPresenceState}`,
            smallImageKey: "minecraft_icon",
            smallImageText: "Check launcher logs"
          });
        }
      },
      onExit: () => {
        clearInGameFallbackTimer();
        activeLauncher = null;
        setDiscordPresence({
          smallImageKey: "minecraft_icon",
          smallImageText: "Minecraft"
        });
      }
    });

    return { ok: true, message: "Launch sequence started." };
  } catch (error) {
    activeLauncher = null;
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown launch failure."
    };
  }
});
