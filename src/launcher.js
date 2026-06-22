const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const { app } = require("electron");
const { Client } = require("minecraft-launcher-core");

const PARKOUR_SPEEDRUNNER_MODS = [
  { projects: ["fabric-api", "legacy-fabric-api"], name: "Fabric API" },
  { projects: ["sodium"], name: "Sodium" },
  { projects: ["lithium"], name: "Lithium" },
  { projects: ["ferrite-core"], name: "FerriteCore" },
  { projects: ["modmenu"], name: "Mod Menu" },
  { projects: ["reeses-sodium-options"], name: "Reese's Sodium Options" },
  { projects: ["sodium-extra"], name: "Sodium Extra" },
  { projects: ["entityculling"], name: "Entity Culling" },
  { projects: ["immediatelyfast"], name: "ImmediatelyFast" },
  { projects: ["fabric-language-kotlin"], name: "Fabric Language Kotlin" },
  { projects: ["yet-another-config-lib", "yacl"], name: "YetAnotherConfigLib (YACL)" },
  { projects: ["zoomify"], name: "Zoomify" }
];

const COMPETITIVE_MODS = [
  { projects: ["fabric-api", "legacy-fabric-api"], name: "Fabric API" },
  { projects: ["sodium"], name: "Sodium" },
  { projects: ["lithium"], name: "Lithium" },
  { projects: ["ferrite-core"], name: "FerriteCore" },
  { projects: ["entityculling"], name: "Entity Culling" },
  { projects: ["immediatelyfast"], name: "ImmediatelyFast" }
];

const FPS_HUD_MODS = [
  { projects: ["fabric-api", "legacy-fabric-api"], name: "Fabric API" },
  { projects: ["fps-monitor"], name: "FPS Monitor" }
];

const MANAGED_MODS_STATE_FILE = ".launcher-managed-mods.json";

function isLegacyVersion(version) {
  const match = version.match(/^1\.(\d+)/);
  if (match) {
    const minor = parseInt(match[1], 10);
    return minor <= 13;
  }
  return false;
}

function sanitizePort(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Server port must be between 1 and 65535.");
  }
  return parsed;
}

function sanitizeMemoryMb(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed < 1024 || parsed > 32768) {
    throw new Error("Memory must be between 1024 and 32768 MB.");
  }
  return parsed;
}

function usernameToOfflineUuid(username) {
  // Stable UUID for offline auth based on username
  const digest = crypto.createHash("md5").update(`OfflinePlayer:${username}`).digest("hex");
  return `${digest.slice(0, 8)}${digest.slice(8, 12)}${digest.slice(12, 16)}${digest.slice(
    16,
    20
  )}${digest.slice(20)}`;
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return fallback;
}

function normalizeLaunchProfile(value) {
  const normalized = String(value || "competitive").trim().toLowerCase();
  return normalized === "full" ? "full" : "competitive";
}

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`Request failed (${response.statusCode}) for ${url}`));
        response.resume();
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms for ${url}`));
    });

    req.on("error", reject);
  });
}

function downloadFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath);

    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        file.close();
        fs.rmSync(destinationPath, { force: true });
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        response.resume();
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve());
      });
    });

    request.on("error", (error) => {
      file.close();
      fs.rmSync(destinationPath, { force: true });
      reject(error);
    });

    file.on("error", (error) => {
      file.close();
      fs.rmSync(destinationPath, { force: true });
      reject(error);
    });
  });
}

function forcePerformanceVideoSettings(minecraftRoot, hooks) {
  const optionsPath = path.join(minecraftRoot, "options.txt");
  const requiredSettings = {
    enableVsync: "false",
    maxFps: "240",
    framerateLimit: "240",
    prioritizeChunkUpdates: "2",
    renderDistance: "10",
    simulationDistance: "8",
    entityDistanceScaling: "0.8"
  };

  const parsed = {};
  if (fs.existsSync(optionsPath)) {
    const current = fs.readFileSync(optionsPath, "utf8");
    for (const line of current.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      const key = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1);
      parsed[key] = value;
    }
  }

  let changed = false;
  for (const [key, value] of Object.entries(requiredSettings)) {
    if (parsed[key] !== value) {
      parsed[key] = value;
      changed = true;
    }
  }

  if (!changed && fs.existsSync(optionsPath)) {
    hooks.onStatus("Performance settings already applied (stable FPS + chunk priorities).");
    return;
  }

  const serialized = `${Object.entries(parsed)
    .map(([key, value]) => `${key}:${value}`)
    .join("\n")}\n`;
  fs.writeFileSync(optionsPath, serialized, "utf8");
  hooks.onStatus("Applied performance settings: VSync off, 240 FPS cap, chunk updates prioritized.");
}

async function ensureFabricProfile(version, minecraftRoot, hooks) {
  const baseUrl = isLegacyVersion(version)
    ? "https://meta.legacyfabric.net"
    : "https://meta.fabricmc.net";

  const loaderList = await fetchJson(`${baseUrl}/v2/versions/loader/${version}`);
  if (!Array.isArray(loaderList) || loaderList.length === 0) {
    throw new Error(`No Fabric loader found for Minecraft ${version}.`);
  }

  const loaderVersion = loaderList[0].loader?.version;
  if (!loaderVersion) {
    throw new Error(`Invalid Fabric loader metadata for Minecraft ${version}.`);
  }

  const profileId = `fabric-loader-${loaderVersion}-${version}`;
  const versionsDir = path.join(minecraftRoot, "versions", profileId);
  const profilePath = path.join(versionsDir, `${profileId}.json`);

  if (fs.existsSync(profilePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(profilePath, "utf8"));
      if (cached && (cached.id || Array.isArray(cached.libraries))) {
        hooks.onStatus(`Fabric profile ready: ${profileId}`);
        return profileId;
      }
    } catch (_error) {
      // Fall through to re-fetch
    }
    hooks.onStatus("Fabric profile corrupted, re-fetching...");
    fs.rmSync(profilePath, { force: true });
  }

  hooks.onStatus(`Installing Fabric loader ${loaderVersion}...`);
  const profileJson = await fetchJson(
    `${baseUrl}/v2/versions/loader/${version}/${loaderVersion}/profile/json`
  );
  fs.mkdirSync(versionsDir, { recursive: true });
  fs.writeFileSync(profilePath, JSON.stringify(profileJson, null, 2), "utf8");
  hooks.onStatus(`Fabric installed: ${profileId}`);
  return profileId;
}

async function ensureParkourMods(version, minecraftRoot, hooks) {
  return ensureMods(version, minecraftRoot, hooks, PARKOUR_SPEEDRUNNER_MODS);
}

async function ensureMods(version, minecraftRoot, hooks, modsList) {
  const modsDir = path.join(minecraftRoot, "mods");
  fs.mkdirSync(modsDir, { recursive: true });
  const selectedFileNames = [];

  const loaders = isLegacyVersion(version) ? ["fabric", "legacy-fabric"] : ["fabric"];

  for (const mod of modsList) {
    hooks.onStatus(`Resolving mod: ${mod.name}...`);
    let modVersions = null;
    for (const projectId of mod.projects) {
      try {
        const versionsUrl = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=${encodeURIComponent(
          JSON.stringify(loaders)
        )}&game_versions=${encodeURIComponent(JSON.stringify([version]))}`;
        const candidateVersions = await fetchJson(versionsUrl);
        if (Array.isArray(candidateVersions) && candidateVersions.length > 0) {
          modVersions = candidateVersions;
          break;
        }
      } catch (_error) {
        // Try fallback project id if available.
      }
    }

    if (!Array.isArray(modVersions) || modVersions.length === 0) {
      hooks.onStatus(`Skipped ${mod.name}: no Fabric build for ${version}.`);
      continue;
    }

    const selectedVersion = modVersions[0];
    const files = Array.isArray(selectedVersion.files) ? selectedVersion.files : [];
    const fileMeta = files.find((entry) => entry.primary) || files[0];

    if (!fileMeta?.url || !fileMeta?.filename) {
      hooks.onStatus(`Skipped ${mod.name}: no downloadable file found.`);
      continue;
    }

    // Strip any directory components from the filename — Modrinth is trusted but
    // a compromised/malicious API response could otherwise write files outside modsDir.
    const safeFilename = path.basename(fileMeta.filename);
    if (!safeFilename || safeFilename !== fileMeta.filename) {
      hooks.onStatus(`Skipped ${mod.name}: unsafe filename rejected.`);
      continue;
    }

    const targetPath = path.join(modsDir, safeFilename);
    selectedFileNames.push(safeFilename);
    if (fs.existsSync(targetPath)) {
      hooks.onStatus(`${mod.name} already installed.`);
      continue;
    }

    hooks.onStatus(`Downloading ${mod.name} (${safeFilename})...`);
    await downloadFile(fileMeta.url, targetPath);
    hooks.onStatus(`Installed ${mod.name}.`);
  }

  return selectedFileNames;
}

function readManagedModsState(minecraftRoot) {
  const statePath = path.join(minecraftRoot, MANAGED_MODS_STATE_FILE);
  if (!fs.existsSync(statePath)) {
    return { mcVersion: null, fabricVersion: null, files: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    // Backwards compatibility: old format was a plain array
    if (Array.isArray(parsed)) {
      return { mcVersion: null, fabricVersion: null, files: parsed };
    }
    return {
      mcVersion: parsed.mcVersion || null,
      fabricVersion: parsed.fabricVersion || null,
      files: Array.isArray(parsed.files) ? parsed.files : []
    };
  } catch (_error) {
    return { mcVersion: null, fabricVersion: null, files: [] };
  }
}

function writeManagedModsState(minecraftRoot, state) {
  const statePath = path.join(minecraftRoot, MANAGED_MODS_STATE_FILE);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function walkDir(dir, ext, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_error) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, ext, results);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function validateAndRepairLibraries(minecraftRoot, hooks) {
  const librariesDir = path.join(minecraftRoot, "libraries");
  if (!fs.existsSync(librariesDir)) {
    return;
  }

  const jars = walkDir(librariesDir, ".jar");
  let deletedCount = 0;

  // ZIP local file header magic: 50 4B 03 04
  // ZIP end-of-central-directory (EOCD) signature: 50 4B 05 06
  // A valid ZIP must start with the local file header magic AND end with the EOCD record.
  // Checking only the first 4 bytes misses truncated files that start correctly but are
  // incomplete (causing "zip END header not found" at runtime).
  const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  // Minimum valid ZIP size: local file header(30) + EOCD(22) = 52 bytes
  const MIN_ZIP_SIZE = 52;
  // EOCD is at least 22 bytes; we scan the last 65557 bytes (max comment length + EOCD)
  const EOCD_SCAN_SIZE = 65557 + 22;

  for (const jarPath of jars) {
    let isCorrupted = false;
    let fd = -1;

    try {
      const stat = fs.statSync(jarPath);
      if (stat.size < MIN_ZIP_SIZE) {
        isCorrupted = true;
      } else {
        fd = fs.openSync(jarPath, "r");

        // Check start magic
        const headBuf = Buffer.alloc(4);
        fs.readSync(fd, headBuf, 0, 4, 0);
        if (!headBuf.equals(ZIP_MAGIC)) {
          isCorrupted = true;
        } else {
          // Check EOCD signature exists somewhere in the last EOCD_SCAN_SIZE bytes
          const scanSize = Math.min(stat.size, EOCD_SCAN_SIZE);
          const tailBuf = Buffer.alloc(scanSize);
          fs.readSync(fd, tailBuf, 0, scanSize, stat.size - scanSize);
          // Search backwards for EOCD signature
          let foundEocd = false;
          for (let i = tailBuf.length - 4; i >= 0; i--) {
            if (
              tailBuf[i] === EOCD_SIG[0] &&
              tailBuf[i + 1] === EOCD_SIG[1] &&
              tailBuf[i + 2] === EOCD_SIG[2] &&
              tailBuf[i + 3] === EOCD_SIG[3]
            ) {
              foundEocd = true;
              break;
            }
          }
          if (!foundEocd) {
            isCorrupted = true;
          }
        }
      }
    } catch (_error) {
      isCorrupted = true;
    } finally {
      if (fd !== -1) {
        try {
          fs.closeSync(fd);
        } catch (_error) {
          // ignore close errors
        }
      }
    }

    if (isCorrupted) {
      try {
        fs.rmSync(jarPath, { force: true });
        hooks.onStatus(`Removed corrupted library: ${path.basename(jarPath)}`);
        deletedCount += 1;
      } catch (_error) {
        // ignore deletion errors
      }
    }
  }

  if (deletedCount > 0) {
    hooks.onStatus("Corrupted libraries removed. They will be re-downloaded on launch.");
  }
}

function pruneManagedMods(minecraftRoot, selectedFiles, hooks) {
  const { files: previousFiles } = readManagedModsState(minecraftRoot);
  const selectedSet = new Set(selectedFiles);
  const modsDir = path.join(minecraftRoot, "mods");
  let removedCount = 0;

  for (const fileName of previousFiles) {
    if (selectedSet.has(fileName)) {
      continue;
    }
    const filePath = path.join(modsDir, fileName);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      removedCount += 1;
    }
  }

  if (removedCount > 0) {
    hooks.onStatus(`Cleaned ${removedCount} old managed mod(s) for selected profile.`);
  }
}

async function launchMinecraft(config, hooks) {
  const launcher = new Client();
  let minecraftProcess = null;
  let hasExited = false;
  const exitOnce = (message) => {
    if (hasExited) {
      return;
    }
    hasExited = true;
    if (message) {
      hooks.onStatus(message);
    }
    hooks.onExit();
  };

  const username = String(config?.username || "").trim();
  const version = String(config?.version || "").trim();
  const serverHost = String(config?.serverHost || "").trim();
  const serverPort = sanitizePort(config?.serverPort || 25565);
  const maxMemoryMb = sanitizeMemoryMb(config?.maxMemoryMb || 4096);
  const installParkourPack = parseBoolean(config?.installParkourPack, true);
  const installFpsHud = parseBoolean(config?.installFpsHud, true);
  const launchProfile = normalizeLaunchProfile(config?.launchProfile);

  if (!username) {
    throw new Error("Username is required.");
  }

  if (!version) {
    throw new Error("Minecraft version is required.");
  }

  if (!serverHost) {
    throw new Error("Server host is required.");
  }

  const offlineUuid = usernameToOfflineUuid(username);
  const appDataPath =
    app && typeof app.getPath === "function" ? app.getPath("appData") : process.cwd();
  const minecraftRoot = path.join(appDataPath, "PrivateCustomMinecraftLauncher", ".minecraft");
  fs.mkdirSync(minecraftRoot, { recursive: true });
  const launchVersion = {
    number: version,
    type: "release"
  };

  const legacy = isLegacyVersion(version);

  const profileMods =
    launchProfile === "full" && installParkourPack ? PARKOUR_SPEEDRUNNER_MODS : COMPETITIVE_MODS;
  const mergedMods = [...profileMods];
  if (installFpsHud) {
    mergedMods.push(...FPS_HUD_MODS);
  }

  if (legacy) {
    // Legacy Minecraft (< 1.14) has no compatible Fabric performance mods, and
    // LegacyFabric's maven does not host the lwjgl-platform natives jar (returns a
    // 404 HTML page that gets saved as a broken .jar and crashes the game). For these
    // versions we launch vanilla so any version the user types reliably starts.
    hooks.onStatus(
      `Legacy version ${version} detected — launching vanilla (Fabric mods are not available for this version).`
    );
    pruneManagedMods(minecraftRoot, [], hooks);
    writeManagedModsState(minecraftRoot, { mcVersion: version, fabricVersion: null, files: [] });
  } else if (mergedMods.length > 0) {
    hooks.onStatus(
      launchProfile === "full" ? "Preparing full mod profile..." : "Preparing competitive profile..."
    );
    const fabricProfile = await ensureFabricProfile(version, minecraftRoot, hooks);
    // Extract loader version from profileId: "fabric-loader-<loaderVer>-<mcVer>"
    const fabricLoaderVersion = fabricProfile.slice(
      "fabric-loader-".length,
      fabricProfile.length - version.length - 1
    );

    // If MC version or Fabric loader version changed since last run, purge stale mods
    // so they are re-downloaded for the correct version pair.
    const prevState = readManagedModsState(minecraftRoot);
    if (prevState.mcVersion !== version || prevState.fabricVersion !== fabricLoaderVersion) {
      if (prevState.files.length > 0) {
        hooks.onStatus(
          `Minecraft or Fabric version changed — removing ${prevState.files.length} stale mod(s)...`
        );
        const modsDir = path.join(minecraftRoot, "mods");
        for (const fileName of prevState.files) {
          fs.rmSync(path.join(modsDir, fileName), { force: true });
        }
      }
    }

    const uniqueMods = [];
    const seenProjects = new Set();
    for (const mod of mergedMods) {
      const key = mod.projects[0];
      if (seenProjects.has(key)) {
        continue;
      }
      seenProjects.add(key);
      uniqueMods.push(mod);
    }

    const selectedFiles = await ensureMods(version, minecraftRoot, hooks, uniqueMods);
    pruneManagedMods(minecraftRoot, selectedFiles, hooks);
    writeManagedModsState(minecraftRoot, {
      mcVersion: version,
      fabricVersion: fabricLoaderVersion,
      files: selectedFiles
    });
    if (installFpsHud) {
      hooks.onStatus("FPS overlay installed.");
    }
    launchVersion.custom = fabricProfile;
  } else {
    pruneManagedMods(minecraftRoot, [], hooks);
    writeManagedModsState(minecraftRoot, { mcVersion: version, fabricVersion: null, files: [] });
  }

  forcePerformanceVideoSettings(minecraftRoot, hooks);

  // Microsoft Auth or Offline Auth
  let auth = config?.auth;
  if (!auth) {
    auth = {
      access_token: "0",
      client_token: crypto.randomBytes(16).toString("hex"),
      uuid: offlineUuid,
      name: username,
      user_properties: {}
    };
  }

  // Check for Java 21 installation
  const java21Path = "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot\\bin\\java.exe";
  const hasJava21 = fs.existsSync(java21Path);

  const options = {
    authorization: auth,
    root: minecraftRoot,
    version: launchVersion,
    ...(hasJava21 ? { javaPath: java21Path } : {}),
    memory: {
      max: `${maxMemoryMb}M`,
      min: `${Math.min(512, maxMemoryMb)}M`
    },
    customArgs: [
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+UseG1GC",
      "-XX:MaxGCPauseMillis=45",
      "-XX:G1NewSizePercent=20",
      "-XX:G1ReservePercent=20",
      "-XX:InitiatingHeapOccupancyPercent=15",
      "-XX:G1MixedGCCountTarget=4",
      "-XX:SurvivorRatio=32",
      "-XX:MaxTenuringThreshold=1",
      "-XX:+PerfDisableSharedMem",
      "-XX:-UseAdaptiveSizePolicy",
      "-XX:-OmitStackTraceInFastThrow"
    ],
    quickPlay: {
      type: "multiplayer",
      identifier: `${serverHost}:${serverPort}`
    },
    overrides: {
      detached: false
    }
  };

  validateAndRepairLibraries(minecraftRoot, hooks);
  hooks.onStatus(`Preparing Minecraft ${version} for ${username}...`);

  launcher.on("debug", (line) => hooks.onStatus(`DEBUG: ${line}`));
  launcher.on("data", (line) => hooks.onStatus(line));
  launcher.on("progress", (event) => {
    if (!event || typeof event !== "object") {
      return;
    }
    if (event.task && Number.isFinite(event.total) && Number.isFinite(event.current)) {
      hooks.onStatus(`${event.task}: ${event.current}/${event.total}`);
    }
  });
  launcher.on("close", () => {
    exitOnce("Minecraft closed.");
  });
  launcher.on("error", (error) => {
    exitOnce(
      `Launch error: ${error instanceof Error ? error.message : "Unknown error from launcher"}`
    );
  });

  try {
    minecraftProcess = await launcher.launch(options);
    if (!minecraftProcess) {
      exitOnce("Launch error: Minecraft process did not start.");
      throw new Error("Minecraft process did not start.");
    }

    minecraftProcess.on("close", () => {
      exitOnce("Minecraft closed.");
    });

    minecraftProcess.on("error", (error) => {
      exitOnce(
        `Launch error: ${
          error instanceof Error ? error.message : "Unexpected Minecraft process error"
        }`
      );
    });
  } catch (error) {
    exitOnce(`Launch error: ${error instanceof Error ? error.message : "Unknown launcher failure"}`);
    throw error;
  }

  return { launcher, process: minecraftProcess };
}

module.exports = {
  launchMinecraft
};
