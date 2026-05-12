const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
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
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
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

ipcMain.handle("launcher:auth", async () => {
  try {
    const authManager = new msmc.Auth("select_account");
    const xboxManager = await authManager.launch("raw");
    const mcResult = await xboxManager.getMinecraft();
    
    if (mcResult.type === "Success") {
      return { 
        ok: true, 
        profile: {
          name: mcResult.profile.name,
          uuid: mcResult.profile.id,
          access_token: mcResult.access_token,
          xuid: mcResult.profile.xuid
        }
      };
    } else {
      return { ok: false, message: "Login failed or cancelled." };
    }
  } catch (error) {
    return { ok: false, message: error.message };
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

  try {
    const launchVersion = launchConfig?.version || "unknown version";
    const serverHost = launchConfig?.serverHost || "unknown";
    const serverPort = launchConfig?.serverPort || "?";
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

    activeLauncher = await launchMinecraft(launchConfig, {
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
