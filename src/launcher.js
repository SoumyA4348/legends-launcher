const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const { app } = require("electron");
const java = require("./java");
const { VerifiedCache } = require("./verified-cache");

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
  { projects: ["fpsdisplay", "fps-monitor"], name: "FPS Display" }
];

// Every Modrinth slug each profile installs, so the UI can mark those mods as already included.
function getProfileSlugs() {
  const slugs = (mods) => mods.flatMap((mod) => mod.projects);
  return {
    competitive: slugs(COMPETITIVE_MODS),
    full: slugs(PARKOUR_SPEEDRUNNER_MODS),
    fpsHud: slugs(FPS_HUD_MODS)
  };
}

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

// Game window size from the renderer; anything unusable falls back to Minecraft's default.
function sanitizeGameWindow(value) {
  const fullscreen = parseBoolean(value?.fullscreen, false);
  const width = Number.parseInt(String(value?.width), 10);
  const height = Number.parseInt(String(value?.height), 10);
  const valid = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  if (!valid(width, 640, 7680) || !valid(height, 480, 4320)) {
    return fullscreen ? { fullscreen: true } : null;
  }
  return { width, height, fullscreen };
}

// Quick Play arrived in 1.20 (and replaced --server); older versions silently ignore it,
// so they get the old --server/--port flags instead. Year-style versions (26.1+) are modern.
function supportsQuickPlay(version) {
  const match = /^1\.(\d+)/.exec(String(version));
  return !match || Number(match[1]) >= 20;
}

function serverJoinOptions(version, host, port) {
  if (!host) {
    return {};
  }
  return supportsQuickPlay(version)
    ? { quickPlay: { type: "multiplayer", identifier: `${host}:${port}` } }
    : { customLaunchArgs: ["--server", host, "--port", String(port)] };
}

// Newest crash report Minecraft wrote since `sinceMs`, or null.
function findLatestCrashReport(gameDir, sinceMs) {
  const dir = path.join(gameDir, "crash-reports");
  let latest = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".txt")) {
        continue;
      }
      const filePath = path.join(dir, name);
      const { mtimeMs } = fs.statSync(filePath);
      if (mtimeMs >= sinceMs && (!latest || mtimeMs > latest.mtimeMs)) {
        latest = { filePath, mtimeMs };
      }
    }
  } catch (_error) {
    return null;
  }
  return latest ? latest.filePath : null;
}

const GAME_PROGRESS_LABELS = {
  assets: "Downloading game assets",
  "assets-copy": "Preparing game assets",
  natives: "Downloading native libraries",
  classes: "Downloading libraries",
  "classes-custom": "Downloading Fabric libraries",
  "classes-maven-custom": "Downloading Fabric libraries"
};

// LEGENDS_DATA_DIR points all game data at another folder, e.g. to test a clean first run.
function getUserDataBase() {
  if (process.env.LEGENDS_DATA_DIR) {
    return process.env.LEGENDS_DATA_DIR;
  }
  return app && typeof app.getPath === "function" ? app.getPath("appData") : process.cwd();
}

function getMinecraftRoot() {
  return path.join(getUserDataBase(), "PrivateCustomMinecraftLauncher", ".minecraft");
}

function getRuntimesDir() {
  return path.join(getUserDataBase(), "PrivateCustomMinecraftLauncher", "runtimes");
}

const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Each instance has its own game directory (mods, saves, options.txt); versions, libraries
// and assets stay shared in the root. "default" is the root itself, so existing worlds stay put.
function getInstanceDir(instanceId) {
  const id = String(instanceId || "default");
  if (id === "default") {
    return getMinecraftRoot();
  }
  if (!INSTANCE_ID_PATTERN.test(id)) {
    throw new Error("Invalid instance id.");
  }
  return path.join(getUserDataBase(), "PrivateCustomMinecraftLauncher", "instances", id);
}

const MODRINTH_SLUG_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_EXTRA_MODS = 100;

const CONTENT_TYPES = ["mod", "resourcepack", "shader"];

// User-added Modrinth content arrives from the renderer as [{ slug, name, type }].
function sanitizeExtraMods(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((mod) => mod && MODRINTH_SLUG_PATTERN.test(String(mod.slug)))
    .slice(0, MAX_EXTRA_MODS)
    .map((mod) => ({
      projects: [String(mod.slug)],
      name: String(mod.name || mod.slug).slice(0, 80),
      type: CONTENT_TYPES.includes(mod.type) ? mod.type : "mod"
    }));
}

const SEARCH_FACETS = {
  mod: [["project_type:mod"], ["categories:fabric"]],
  resourcepack: [["project_type:resourcepack"]],
  shader: [["project_type:shader"], ["categories:iris"]]
};

async function searchModrinthMods(query, version, type = "mod") {
  const facets = [...(SEARCH_FACETS[type] || SEARCH_FACETS.mod)];
  if (version) {
    facets.push([`versions:${version}`]);
  }
  const url = `https://api.modrinth.com/v2/search?limit=20&query=${encodeURIComponent(
    query
  )}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const result = await fetchJson(url);
  return (Array.isArray(result?.hits) ? result.hits : []).map((hit) => ({
    slug: hit.slug,
    name: hit.title,
    description: hit.description || "",
    downloads: hit.downloads || 0,
    iconUrl: hit.icon_url || ""
  }));
}

// Finds (or downloads, on first run) the Java major this Minecraft version requires.
async function ensureJavaRuntime(version, minecraftRoot, hooks) {
  const onProgress = hooks.onProgress || (() => {});
  const runtimesDir = getRuntimesDir();
  const major = await java.getRequiredJavaMajor(version, { minecraftRoot, fetchJson });
  const existing = java.findJava(major, { runtimesDir });
  if (existing) {
    hooks.onStatus(`Using Java ${major}: ${existing}`);
    return existing;
  }
  return java.provisionJava(major, {
    runtimesDir,
    fetchJson,
    downloadFile,
    onStatus: hooks.onStatus,
    onProgress: (received, total) =>
      onProgress({ stage: "java", label: `Downloading Java ${major}`, current: received, total, unit: "bytes" })
  });
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
    // Modrinth asks API clients to identify themselves.
    const req = https.get(url, { headers: { "User-Agent": "SoumyA4348/legends-launcher" } }, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        const error = new Error(`Request failed (${response.statusCode}) for ${url}`);
        error.statusCode = response.statusCode;
        reject(error);
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

function downloadFile(url, destinationPath, { maxRedirects = 5, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error(`Too many redirects when downloading ${url}`));
      return;
    }

    const tempPath = `${destinationPath}.tmp`;
    const file = fs.createWriteStream(tempPath);

    const cleanup = () => {
      try {
        file.close();
      } catch (_e) {}
      try {
        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true });
        }
      } catch (_e) {}
    };

    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        cleanup();
        response.resume();
        const redirectUrl = new URL(response.headers.location, url).toString();
        downloadFile(redirectUrl, destinationPath, { maxRedirects: maxRedirects - 1, onProgress })
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode && response.statusCode >= 400) {
        cleanup();
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }

      if (onProgress) {
        const total = Number.parseInt(response.headers["content-length"], 10) || 0;
        let received = 0;
        response.on("data", (chunk) => {
          received += chunk.length;
          onProgress(received, total);
        });
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close((err) => {
          if (err) {
            cleanup();
            reject(err);
            return;
          }
          try {
            fs.renameSync(tempPath, destinationPath);
            resolve();
          } catch (renameErr) {
            cleanup();
            reject(renameErr);
          }
        });
      });
    });

    request.on("error", (error) => {
      cleanup();
      reject(error);
    });

    file.on("error", (error) => {
      cleanup();
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
    prioritizeChunkUpdates: "0",
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

  // Defaults only fill keys the game hasn't written yet: a player's own render distance,
  // VSync or FPS cap must survive the next launch.
  let changed = false;
  for (const [key, value] of Object.entries(requiredSettings)) {
    if (!(key in parsed)) {
      parsed[key] = value;
      changed = true;
    }
  }

  if (!changed && fs.existsSync(optionsPath)) {
    hooks.onStatus("Performance settings already applied (stable FPS + threaded chunk updates).");
    return;
  }

  const serialized = `${Object.entries(parsed)
    .map(([key, value]) => `${key}:${value}`)
    .join("\n")}\n`;
  fs.writeFileSync(optionsPath, serialized, "utf8");
  hooks.onStatus("Applied performance settings: VSync off, 240 FPS cap, threaded chunk updates.");
}

async function ensureFabricProfile(version, minecraftRoot, hooks) {
  const baseUrl = isLegacyVersion(version)
    ? "https://meta.legacyfabric.net"
    : "https://meta.fabricmc.net";

  const loaderList = await fetchJson(`${baseUrl}/v2/versions/loader/${version}`);
  if (!Array.isArray(loaderList) || loaderList.length === 0) {
    const error = new Error(`No Fabric loader found for Minecraft ${version}.`);
    error.code = "NO_FABRIC";
    throw error;
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

// ZIP local file header magic: 50 4B 03 04
// ZIP end-of-central-directory (EOCD) signature: 50 4B 05 06
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
// Minimum valid ZIP size: local file header(30) + EOCD(22) = 52 bytes
const MIN_ZIP_SIZE = 52;
// EOCD is at least 22 bytes; we scan the last 65557 bytes (max comment length + EOCD)
const EOCD_SCAN_SIZE = 65557 + 22;

function isJarCorrupted(jarPath) {
  let fd = -1;
  try {
    const stat = fs.statSync(jarPath);
    if (stat.size < MIN_ZIP_SIZE) {
      return true;
    }
    fd = fs.openSync(jarPath, "r");

    const headBuf = Buffer.alloc(4);
    fs.readSync(fd, headBuf, 0, 4, 0);
    if (!headBuf.equals(ZIP_MAGIC)) {
      return true;
    }

    // Fast path: jars almost never carry a ZIP comment, so the EOCD record sits in the
    // final 22 bytes. Only fall back to the 64 KB scan when it doesn't.
    const eocdBuf = Buffer.alloc(4);
    fs.readSync(fd, eocdBuf, 0, 4, stat.size - 22);
    if (eocdBuf.equals(EOCD_SIG)) {
      return false;
    }

    const scanSize = Math.min(stat.size, EOCD_SCAN_SIZE);
    const tailBuf = Buffer.alloc(scanSize);
    fs.readSync(fd, tailBuf, 0, scanSize, stat.size - scanSize);
    for (let i = tailBuf.length - 4; i >= 0; i--) {
      if (
        tailBuf[i] === EOCD_SIG[0] &&
        tailBuf[i + 1] === EOCD_SIG[1] &&
        tailBuf[i + 2] === EOCD_SIG[2] &&
        tailBuf[i + 3] === EOCD_SIG[3]
      ) {
        return false;
      }
    }
    return true;
  } catch (_error) {
    return true;
  } finally {
    if (fd !== -1) {
      try {
        fs.closeSync(fd);
      } catch (_error) {
        // ignore close errors
      }
    }
  }
}

// Runs `worker` over `items` with at most `limit` in flight; results keep input order.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const MOD_CONCURRENCY = 4;

// Dependency chains deeper than this are not real-world; the cap stops a bad API loop.
const MAX_DEPENDENCY_ROUNDS = 3;

async function ensureMods(version, gameDir, hooks, modsList) {
  const modsDir = path.join(gameDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });
  const loaders = isLegacyVersion(version) ? ["fabric", "legacy-fabric"] : ["fabric"];
  const onProgress = hooks.onProgress || (() => {});
  let done = 0;
  let total = modsList.length;
  onProgress({ stage: "mods", label: "Installing mods", current: 0, total });

  const fileNames = [];
  const installedProjects = new Set();
  let queue = modsList;

  // Each round resolves its mods first, so two names for the same Modrinth project
  // (e.g. a profile mod the user also added) download once. Required dependencies
  // the resolved versions declare are queued for the next round.
  for (let round = 0; round < MAX_DEPENDENCY_ROUNDS && queue.length > 0; round++) {
    const resolved = await mapLimit(queue, MOD_CONCURRENCY, (mod) => resolveMod(mod, { version, loaders, hooks }));
    const toInstall = [];
    for (const entry of resolved) {
      if (!entry || installedProjects.has(entry.projectId)) {
        done += 1;
        continue;
      }
      installedProjects.add(entry.projectId);
      toInstall.push(entry);
    }

    const installed = await mapLimit(toInstall, MOD_CONCURRENCY, async (entry) => {
      try {
        return await installMod(entry, { modsDir, hooks });
      } finally {
        done += 1;
        onProgress({ stage: "mods", label: `Installing mods (${entry.mod.name})`, current: done, total });
      }
    });
    fileNames.push(...installed.filter(Boolean));

    const nextQueue = [];
    for (const entry of toInstall) {
      for (const dependencyId of entry.dependencies) {
        if (!installedProjects.has(dependencyId) && !nextQueue.some((mod) => mod.projects[0] === dependencyId)) {
          nextQueue.push({ projects: [dependencyId], name: `dependency of ${entry.mod.name}` });
        }
      }
    }
    queue = nextQueue;
    total += nextQueue.length;
  }
  return fileNames;
}

// Finds the newest Modrinth file for one mod. Returns null when there is no compatible build.
async function resolveMod(mod, { version, loaders, hooks }) {
  hooks.onStatus(`Resolving mod: ${mod.name}...`);
  let modVersions = null;
  let unreachable = null;
  for (const projectId of mod.projects) {
    try {
      const versionsUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?loaders=${encodeURIComponent(
        JSON.stringify(loaders)
      )}&game_versions=${encodeURIComponent(JSON.stringify([version]))}`;
      const candidateVersions = await fetchJson(versionsUrl);
      if (Array.isArray(candidateVersions) && candidateVersions.length > 0) {
        modVersions = candidateVersions;
        break;
      }
    } catch (error) {
      // A 4xx means this id doesn't exist: try the fallback id. Anything else (offline,
      // timeout, 5xx) must not look like "no build", or the mod would be pruned from disk.
      if (!(error.statusCode >= 400 && error.statusCode < 500)) {
        unreachable = error;
      }
    }
  }

  if ((!Array.isArray(modVersions) || modVersions.length === 0) && unreachable) {
    throw new Error(`Could not reach Modrinth for ${mod.name}: ${unreachable.message}`);
  }
  if (!Array.isArray(modVersions) || modVersions.length === 0) {
    hooks.onStatus(`Skipped ${mod.name}: no Fabric build for ${version}.`);
    return null;
  }

  const selectedVersion = modVersions[0];
  const files = Array.isArray(selectedVersion.files) ? selectedVersion.files : [];
  const fileMeta = files.find((entry) => entry.primary) || files[0];

  if (!fileMeta?.url || !fileMeta?.filename) {
    hooks.onStatus(`Skipped ${mod.name}: no downloadable file found.`);
    return null;
  }

  const dependencies = (Array.isArray(selectedVersion.dependencies) ? selectedVersion.dependencies : [])
    .filter((dep) => dep.dependency_type === "required" && MODRINTH_SLUG_PATTERN.test(String(dep.project_id)))
    .map((dep) => String(dep.project_id));
  return { mod, projectId: selectedVersion.project_id || mod.projects[0], fileMeta, dependencies };
}

// Downloads and verifies one resolved mod. Returns its file name, or null when skipped.
async function installMod({ mod, fileMeta }, { modsDir, hooks }) {
  // Strip any directory components from the filename — Modrinth is trusted but
  // a compromised/malicious API response could otherwise write files outside modsDir.
  const safeFilename = path.basename(fileMeta.filename);
  if (!safeFilename || safeFilename !== fileMeta.filename) {
    hooks.onStatus(`Skipped ${mod.name}: unsafe filename rejected.`);
    return null;
  }

  const targetPath = path.join(modsDir, safeFilename);
  if (fs.existsSync(targetPath)) {
    if (!isJarCorrupted(targetPath)) {
      hooks.onStatus(`${mod.name} already installed.`);
      return safeFilename;
    }
    fs.rmSync(targetPath, { force: true });
    hooks.onStatus(`Corrupted mod detected, re-downloading ${mod.name}...`);
  }

  hooks.onStatus(`Downloading ${mod.name} (${safeFilename})...`);
  await downloadFile(fileMeta.url, targetPath);
  const expectedSha512 = fileMeta.hashes?.sha512;
  if (expectedSha512) {
    const actualSha512 = crypto.createHash("sha512").update(fs.readFileSync(targetPath)).digest("hex");
    if (actualSha512 !== expectedSha512) {
      fs.rmSync(targetPath, { force: true });
      throw new Error(`Checksum mismatch for ${mod.name} (${safeFilename}); download discarded.`);
    }
  }
  hooks.onStatus(`Installed ${mod.name}.`);
  return safeFilename;
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
      files: Array.isArray(parsed.files) ? parsed.files : [],
      ...(parsed.modsKey ? { modsKey: parsed.modsKey, resolvedAt: Number(parsed.resolvedAt) || 0 } : {})
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

// Jars already found intact (and unchanged since) are skipped when a cache is given.
function isJarCorruptedCached(jarPath, cache) {
  if (cache?.has(jarPath, "zip")) {
    return false;
  }
  const corrupted = isJarCorrupted(jarPath);
  if (!corrupted) {
    cache?.add(jarPath, "zip");
  }
  return corrupted;
}

function validateAndRepairLibraries(minecraftRoot, hooks, cache = null) {
  const librariesDir = path.join(minecraftRoot, "libraries");
  if (!fs.existsSync(librariesDir)) {
    return;
  }

  const jars = walkDir(librariesDir, ".jar");
  let deletedCount = 0;

  for (const jarPath of jars) {
    if (isJarCorruptedCached(jarPath, cache)) {
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

function validateAndRepairMods(minecraftRoot, hooks, cache = null) {
  const modsDir = path.join(minecraftRoot, "mods");
  if (!fs.existsSync(modsDir)) {
    return;
  }

  const jars = walkDir(modsDir, ".jar");
  let deletedCount = 0;

  for (const jarPath of jars) {
    if (isJarCorruptedCached(jarPath, cache)) {
      try {
        fs.rmSync(jarPath, { force: true });
        hooks.onStatus(`Removed corrupted mod: ${path.basename(jarPath)}`);
        deletedCount += 1;
      } catch (_error) {
        // ignore deletion errors
      }
    }
  }

  if (deletedCount > 0) {
    hooks.onStatus("Corrupted mod(s) removed.");
  }
}

function pruneManagedMods(minecraftRoot, selectedFiles, hooks) {
  const selectedSet = new Set(selectedFiles);
  const modsDir = path.join(minecraftRoot, "mods");
  if (!fs.existsSync(modsDir)) {
    return;
  }

  let removedCount = 0;
  let existingFiles = [];
  try {
    existingFiles = fs.readdirSync(modsDir);
  } catch (_e) {
    return;
  }

  for (const fileName of existingFiles) {
    if (!fileName.endsWith(".jar")) {
      continue;
    }
    if (!selectedSet.has(fileName)) {
      const filePath = path.join(modsDir, fileName);
      try {
        fs.rmSync(filePath, { force: true });
        removedCount += 1;
        hooks.onStatus(`Cleaned incompatible/stale mod: ${fileName}`);
      } catch (_e) {}
    }
  }

  if (removedCount > 0) {
    hooks.onStatus(`Cleaned ${removedCount} incompatible or old mod(s) for version.`);
  }
}

const DOWNLOAD_CONNECTIONS = 16;

// MCLC SHA-1-hashes every asset (~800 MB) and native on every launch. Route its checks
// through the verified cache so only new or changed files are hashed.
let activeVerifiedCache = null;

function useVerifiedCacheForMclc(cache) {
  activeVerifiedCache = cache;
  const Handler = require("minecraft-launcher-core/components/handler");
  if (Handler.prototype.checkSum.usesVerifiedCache) {
    return;
  }
  const original = Handler.prototype.checkSum;
  const cachedCheckSum = async function (hash, file) {
    if (activeVerifiedCache?.has(file, hash)) {
      return true;
    }
    const ok = await original.call(this, hash, file);
    if (ok) {
      activeVerifiedCache?.add(file, hash);
    }
    return ok;
  };
  cachedCheckSum.usesVerifiedCache = true;
  Handler.prototype.checkSum = cachedCheckSum;
}

// Fabric and Modrinth are asked for updates at most once a day; in between, an unchanged mod
// list launches straight from disk. If they can't be reached, the installed set is reused.
// Resource packs work on every version; shaders need Fabric + Iris (added automatically).
const PACK_TYPES = {
  resourcepack: { folder: "resourcepacks", loaders: ["minecraft"], label: "resource pack" },
  shader: { folder: "shaderpacks", loaders: ["iris"], label: "shader" }
};
const MANAGED_PACKS_STATE_FILE = ".launcher-managed-packs.json";
const IRIS_MOD = { projects: ["iris"], name: "Iris Shaders" };

function readManagedPacks(gameDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(gameDir, MANAGED_PACKS_STATE_FILE), "utf8"));
    return { resourcepack: Array.isArray(parsed.resourcepack) ? parsed.resourcepack : [], shader: Array.isArray(parsed.shader) ? parsed.shader : [] };
  } catch (_error) {
    return { resourcepack: [], shader: [] };
  }
}

// options.txt lists enabled packs as a JSON array; 1.13+ prefixes folder packs with "file/".
function enableResourcePacks(gameDir, version, fileNames) {
  if (fileNames.length === 0) {
    return;
  }
  const optionsPath = path.join(gameDir, "options.txt");
  const lines = fs.existsSync(optionsPath) ? fs.readFileSync(optionsPath, "utf8").split(/\r?\n/).filter(Boolean) : [];
  const index = lines.findIndex((line) => line.startsWith("resourcePacks:"));
  let enabled = [];
  try {
    enabled = index === -1 ? [] : JSON.parse(lines[index].slice("resourcePacks:".length));
  } catch (_error) {
    enabled = [];
  }
  if (!Array.isArray(enabled)) enabled = [];
  const prefix = isLegacyVersion(version) && !/^1\.13/.test(version) ? "" : "file/";
  if (prefix && !enabled.includes("vanilla")) enabled.unshift("vanilla");
  for (const name of fileNames) {
    if (!enabled.includes(prefix + name)) enabled.push(prefix + name);
  }
  const line = `resourcePacks:${JSON.stringify(enabled)}`;
  if (index === -1) lines.push(line);
  else lines[index] = line;
  fs.writeFileSync(optionsPath, `${lines.join("\n")}\n`, "utf8");
}

// Turns on a newly added shader, unless the player already picked one in Iris.
function enableShader(gameDir, fileName) {
  const configDir = path.join(gameDir, "config");
  const configPath = path.join(configDir, "iris.properties");
  const props = {};
  if (fs.existsSync(configPath)) {
    for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
      const at = line.indexOf("=");
      if (at > 0 && !line.startsWith("#")) props[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  if (props.shaderPack) {
    return;
  }
  props.shaderPack = fileName;
  props.enableShaders = "true";
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, `${Object.entries(props).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, "utf8");
}

// Installs the player's resource packs and shaders. Only files this launcher installed are
// ever removed; packs the player dropped in by hand are left alone.
async function ensurePacks(version, gameDir, packs, hooks, { modded }) {
  const previous = readManagedPacks(gameDir);
  const next = { resourcepack: [], shader: [] };
  for (const [type, spec] of Object.entries(PACK_TYPES)) {
    const wanted = packs.filter((pack) => pack.type === type);
    const dir = path.join(gameDir, spec.folder);
    if (type === "shader" && wanted.length > 0 && !modded) {
      hooks.onStatus(`Skipped ${wanted.length} shader(s): shaders need Minecraft 1.16.5 or newer with Fabric.`);
      wanted.length = 0;
    }
    if (wanted.length > 0) {
      fs.mkdirSync(dir, { recursive: true });
      const resolved = await mapLimit(wanted, MOD_CONCURRENCY, (pack) => resolveMod(pack, { version, loaders: spec.loaders, hooks }));
      const installed = await mapLimit(resolved.filter(Boolean), MOD_CONCURRENCY, (entry) => installMod(entry, { modsDir: dir, hooks }));
      next[type] = installed.filter(Boolean);
    }
    for (const fileName of previous[type]) {
      if (!next[type].includes(fileName)) {
        fs.rmSync(path.join(dir, path.basename(String(fileName))), { force: true });
        hooks.onStatus(`Removed ${spec.label} ${fileName}.`);
      }
    }
  }
  enableResourcePacks(gameDir, version, next.resourcepack.filter((name) => !previous.resourcepack.includes(name)));
  const newShader = next.shader.find((name) => !previous.shader.includes(name));
  if (newShader) enableShader(gameDir, newShader);
  fs.writeFileSync(path.join(gameDir, MANAGED_PACKS_STATE_FILE), JSON.stringify(next), "utf8");
  return next;
}

const MOD_RECHECK_MS = 24 * 60 * 60 * 1000;

async function prepareModdedProfile(version, minecraftRoot, gameDir, mods, hooks) {
  const onProgress = hooks.onProgress || (() => {});
  const modsDir = path.join(gameDir, "mods");
  const modsKey = `${version}|${mods.map((mod) => mod.projects[0]).join(",")}`;
  const prevState = readManagedModsState(gameDir);
  const cachedProfile = prevState.fabricVersion ? `fabric-loader-${prevState.fabricVersion}-${version}` : null;
  const cacheUsable =
    prevState.modsKey === modsKey &&
    Boolean(cachedProfile) &&
    fs.existsSync(path.join(minecraftRoot, "versions", cachedProfile, `${cachedProfile}.json`)) &&
    // basename: never let a tampered state file point outside the mods folder
    prevState.files.every((file) => fs.existsSync(path.join(modsDir, path.basename(String(file)))));

  if (cacheUsable && Date.now() - prevState.resolvedAt < MOD_RECHECK_MS) {
    hooks.onStatus(`Fabric and ${prevState.files.length} mods are up to date.`);
    return cachedProfile;
  }

  try {
    onProgress({ stage: "loader", label: "Installing Fabric", current: 0, total: 0 });
    const fabricProfile = await ensureFabricProfile(version, minecraftRoot, hooks);
    // Profile id is "fabric-loader-<loaderVersion>-<mcVersion>"
    const fabricVersion = fabricProfile.slice("fabric-loader-".length, fabricProfile.length - version.length - 1);

    // Mods are built per Minecraft version (not per loader version), so only a Minecraft
    // version change forces a clean re-download.
    if (prevState.mcVersion !== version && prevState.files.length > 0) {
      hooks.onStatus(`Minecraft version changed — removing ${prevState.files.length} old mod(s)...`);
      for (const fileName of prevState.files) {
        fs.rmSync(path.join(modsDir, path.basename(String(fileName))), { force: true });
      }
    }

    const files = await ensureMods(version, gameDir, hooks, mods);
    pruneManagedMods(gameDir, files, hooks);
    writeManagedModsState(gameDir, { mcVersion: version, fabricVersion, files, modsKey, resolvedAt: Date.now() });
    return fabricProfile;
  } catch (error) {
    if (!cacheUsable || error.code === "NO_FABRIC") {
      throw error;
    }
    hooks.onStatus(`Couldn't check for mod updates (${error.message}). Launching with your installed mods.`);
    return cachedProfile;
  }
}

async function launchMinecraft(config, hooks) {
  const { Client } = require("minecraft-launcher-core");
  const launcher = new Client();
  let minecraftProcess = null;
  let hasExited = false;
  const startedAt = Date.now();
  const exitOnce = (message, code = 0) => {
    if (hasExited) {
      return;
    }
    hasExited = true;
    // Look for the report before the status line, so the error can link to it.
    const crashReport = code ? findLatestCrashReport(getInstanceDir(config?.instanceId), startedAt) : null;
    if (message) {
      hooks.onStatus(message);
    }
    hooks.onExit({ code, crashReport });
  };

  const auth = config?.auth;
  if (!auth || !auth.access_token || auth.access_token === "0" || !auth.name) {
    throw new Error("Microsoft authentication is required. Please sign in with an official Microsoft account to launch Minecraft.");
  }

  const username = String(auth.name).trim();
  const version = String(config?.version || "").trim();
  const serverHost = String(config?.serverHost || "").trim();
  const serverPort = sanitizePort(config?.serverPort || 25565);
  const maxMemoryMb = sanitizeMemoryMb(config?.maxMemoryMb || 4096);
  const installParkourPack = parseBoolean(config?.installParkourPack, true);
  const installFpsHud = parseBoolean(config?.installFpsHud, true);
  const launchProfile = normalizeLaunchProfile(config?.launchProfile);
  const extraContent = sanitizeExtraMods(config?.extraMods);
  const extraMods = extraContent.filter((item) => item.type === "mod");
  const packs = extraContent.filter((item) => item.type !== "mod");
  const gameWindow = sanitizeGameWindow(config?.gameWindow);

  const onProgress = hooks.onProgress || (() => {});

  if (!version) {
    throw new Error("Minecraft version is required.");
  }

  const minecraftRoot = getMinecraftRoot();
  const gameDir = getInstanceDir(config?.instanceId);
  fs.mkdirSync(minecraftRoot, { recursive: true });
  fs.mkdirSync(gameDir, { recursive: true });

  // Java first: it is the one prerequisite players most often lack.
  onProgress({ stage: "java", label: "Checking Java", current: 0, total: 0 });
  const javaPath = await ensureJavaRuntime(version, minecraftRoot, hooks);
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
  mergedMods.push(...extraMods);
  if (packs.some((pack) => pack.type === "shader")) {
    mergedMods.push(IRIS_MOD);
  }

  if (legacy) {
    // Legacy Minecraft (< 1.14) has no compatible Fabric performance mods, and
    // LegacyFabric's maven does not host the lwjgl-platform natives jar (returns a
    // 404 HTML page that gets saved as a broken .jar and crashes the game). For these
    // versions we launch vanilla so any version the user types reliably starts.
    hooks.onStatus(
      `Legacy version ${version} detected — launching vanilla (Fabric mods are not available for this version).`
    );
    if (extraMods.length > 0) {
      hooks.onStatus(`Your ${extraMods.length} added mod(s) were skipped: they need Minecraft 1.14 or newer.`);
    }
    pruneManagedMods(gameDir, [], hooks);
    writeManagedModsState(gameDir, { mcVersion: version, fabricVersion: null, files: [] });
  } else if (mergedMods.length > 0) {
    hooks.onStatus(
      launchProfile === "full" ? "Preparing full mod profile..." : "Preparing competitive profile..."
    );
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

    try {
      launchVersion.custom = await prepareModdedProfile(version, minecraftRoot, gameDir, uniqueMods, hooks);
      if (installFpsHud) {
        hooks.onStatus("FPS overlay installed.");
      }
    } catch (error) {
      // A brand-new release can land before Fabric supports it: play vanilla instead of failing.
      if (error.code !== "NO_FABRIC") {
        throw error;
      }
      hooks.onStatus(`Fabric doesn't support Minecraft ${version} yet — launching vanilla without mods.`);
      pruneManagedMods(gameDir, [], hooks);
      writeManagedModsState(gameDir, { mcVersion: version, fabricVersion: null, files: [] });
    }
  } else {
    pruneManagedMods(gameDir, [], hooks);
    writeManagedModsState(gameDir, { mcVersion: version, fabricVersion: null, files: [] });
  }

  // Packs never block a launch: offline, the game starts with what's already installed.
  try {
    await ensurePacks(version, gameDir, packs, hooks, { modded: Boolean(launchVersion.custom) });
  } catch (error) {
    hooks.onStatus(`Couldn't update resource packs or shaders (${error.message}). Launching anyway.`);
  }

  forcePerformanceVideoSettings(gameDir, hooks);

  const options = {
    authorization: auth,
    root: minecraftRoot,
    version: launchVersion,
    ...(javaPath ? { javaPath } : {}),
    memory: {
      max: `${maxMemoryMb}M`,
      min: `${maxMemoryMb}M`
    },
    customArgs: [
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+UseG1GC",
      "-XX:MaxGCPauseMillis=130",
      "-XX:+ParallelRefProcEnabled",
      // No AlwaysPreTouch: touching the whole heap up front adds ~1 s to every game start.
      "-XX:+PerfDisableSharedMem",
      "-XX:G1HeapWastePercent=5",
      "-XX:G1MixedGCCountTarget=8",
      "-XX:G1MixedGCLiveThresholdPercent=90",
      "-XX:G1HeapRegionSize=16M",
      "-XX:-OmitStackTraceInFastThrow"
    ],
    ...(gameWindow ? { window: gameWindow } : {}),
    // No server set: open the main menu instead of joining.
    ...serverJoinOptions(version, serverHost, serverPort),
    overrides: {
      detached: false,
      // MCLC's default of 2 connections makes a first install crawl through ~4,000 asset files.
      maxSockets: DOWNLOAD_CONNECTIONS,
      ...(gameDir !== minecraftRoot ? { gameDirectory: gameDir } : {})
    }
  };

  const verified = new VerifiedCache(minecraftRoot);
  useVerifiedCacheForMclc(verified);
  validateAndRepairLibraries(minecraftRoot, hooks, verified);
  validateAndRepairMods(gameDir, hooks, verified);
  hooks.onStatus(`Preparing Minecraft ${version} for ${username}...`);

  launcher.on("debug", (line) => hooks.onStatus(`DEBUG: ${line}`));
  launcher.on("data", (line) => hooks.onStatus(line));
  // MCLC reports { type, task: <done>, total } per file group (assets, natives, classes...).
  launcher.on("progress", (event) => {
    if (!event || !Number.isFinite(event.task) || !Number.isFinite(event.total)) {
      return;
    }
    onProgress({
      stage: "game",
      label: GAME_PROGRESS_LABELS[event.type] || "Downloading game files",
      current: event.task,
      total: event.total
    });
  });
  // A non-zero exit code means the game crashed; surface it as an error, not a normal close.
  launcher.on("close", (code) => {
    exitOnce(
      code
        ? `Launch error: Minecraft exited unexpectedly (code ${code}). Open the console for details.`
        : "Minecraft closed.",
      code || 0
    );
  });
  launcher.on("error", (error) => {
    exitOnce(
      `Launch error: ${error instanceof Error ? error.message : "Unknown error from launcher"}`
    );
  });

  try {
    onProgress({ stage: "game", label: "Checking game files", current: 0, total: 0 });
    minecraftProcess = await launcher.launch(options);
    onProgress({ stage: "launching", label: "Starting Minecraft", current: 0, total: 0 });
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
  } finally {
    verified.save();
  }

  return { launcher, process: minecraftProcess };
}

module.exports = {
  launchMinecraft,
  getMinecraftRoot,
  getRuntimesDir,
  getInstanceDir,
  getProfileSlugs,
  searchModrinthMods,
  fetchJson,
  sanitizeExtraMods,
  // Exported for unit and integration tests
  downloadFile,
  ensureMods,
  ensureFabricProfile,
  isLegacyVersion,
  sanitizePort,
  sanitizeMemoryMb,
  sanitizeGameWindow,
  serverJoinOptions,
  findLatestCrashReport,
  ensurePacks,
  enableResourcePacks,
  enableShader,
  parseBoolean,
  normalizeLaunchProfile,
  mapLimit,
  isJarCorrupted,
  forcePerformanceVideoSettings,
  prepareModdedProfile,
  useVerifiedCacheForMclc,
  readManagedModsState,
  pruneManagedMods
};
