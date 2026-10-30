// Java runtime discovery and one-click provisioning.
// Minecraft versions declare the Java major they need (8, 17, 21, ...). We look for a
// matching local install first, then download an Eclipse Temurin JRE into userData.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const ADOPTIUM_ASSETS_URL = (major) =>
  `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`;

// Adoptium never shipped 16; 17 runs every version that asked for 16.
function normalizeJavaMajor(major) {
  const parsed = Number.parseInt(major, 10);
  if (!Number.isFinite(parsed) || parsed < 8) return 8;
  if (parsed === 16) return 17;
  return parsed;
}

// Matches install folder names such as jdk-21.0.5+11-jre, jdk-17.0.9.9-hotspot, jre1.8.0_401.
function folderMatchesMajor(name, major) {
  if (major === 8) {
    return /^(jdk|jre)-?(1\.)?8([u.]|\b)/i.test(name);
  }
  return new RegExp(`^(jdk|jre|java|temurin)[-_]?${major}(\\b|[.+_-])`, "i").test(name);
}

function javaBinaryName(platform = process.platform) {
  // javaw.exe has no console window; java.exe would flash a terminal next to the game.
  return platform === "win32" ? "javaw.exe" : "java";
}

function binaryIn(dir, platform) {
  const preferred = path.join(dir, "bin", javaBinaryName(platform));
  if (fs.existsSync(preferred)) return preferred;
  const fallback = path.join(dir, "bin", platform === "win32" ? "java.exe" : "java");
  return fs.existsSync(fallback) ? fallback : null;
}

function listMatchingInstalls(baseDir, major) {
  let entries = [];
  try {
    entries = fs.readdirSync(baseDir);
  } catch (_error) {
    return [];
  }
  // Newest first: jdk-21.0.11 before jdk-21.0.2
  return entries
    .filter((name) => folderMatchesMajor(name, major))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => path.join(baseDir, name));
}

function managedRuntimeDir(runtimesDir, major) {
  return path.join(runtimesDir, `java-${major}`);
}

// Returns a java binary for `major`, or null. Order: explicit override, launcher-managed
// runtime, JAVA_HOME, then common Windows install folders.
function findJava(major, { env = process.env, runtimesDir = null, platform = process.platform } = {}) {
  if (env.LEGENDS_JAVA_PATH && fs.existsSync(env.LEGENDS_JAVA_PATH)) {
    return env.LEGENDS_JAVA_PATH;
  }

  const dirs = [];
  if (runtimesDir) {
    // A managed runtime holds one extracted folder, e.g. java-21/jdk-21.0.5+11-jre
    const managed = managedRuntimeDir(runtimesDir, major);
    try {
      for (const name of fs.readdirSync(managed)) dirs.push(path.join(managed, name));
    } catch (_error) {
      // not provisioned yet
    }
  }
  if (env.JAVA_HOME && folderMatchesMajor(path.basename(env.JAVA_HOME), major)) {
    dirs.push(env.JAVA_HOME);
  }
  if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    for (const vendor of ["Eclipse Adoptium", "Microsoft", "Java", "Zulu"]) {
      dirs.push(...listMatchingInstalls(path.join(programFiles, vendor), major));
    }
  }

  for (const dir of dirs) {
    const binary = binaryIn(dir, platform);
    if (binary) return binary;
  }
  return null;
}

let manifestCache = null;

const JAVA_MAJORS_FILE = ".legends-java-majors.json";

async function fetchVersionManifest(fetchJson) {
  if (!manifestCache) {
    manifestCache = fetchJson(MANIFEST_URL).catch((error) => {
      manifestCache = null;
      throw error;
    });
  }
  return manifestCache;
}

// Reads the Java major a Minecraft version needs. Prefers the already-downloaded version
// JSON (works offline), then Mojang's manifest. Falls back to 21 when unknown.
async function getRequiredJavaMajor(version, { minecraftRoot, fetchJson }) {
  const localJson = path.join(minecraftRoot, "versions", version, `${version}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(localJson, "utf8"));
    if (parsed.javaVersion?.majorVersion) return normalizeJavaMajor(parsed.javaVersion.majorVersion);
  } catch (_error) {
    // not downloaded yet
  }

  // A release's Java requirement never changes, so a looked-up answer is kept for good.
  const cachePath = path.join(minecraftRoot, JAVA_MAJORS_FILE);
  let known = {};
  try {
    known = JSON.parse(fs.readFileSync(cachePath, "utf8")) || {};
  } catch (_error) {
    // first lookup
  }
  if (known[version]) return normalizeJavaMajor(known[version]);

  try {
    const manifest = await fetchVersionManifest(fetchJson);
    const entry = manifest.versions.find((v) => v.id === version);
    if (!entry) return 21;
    const versionJson = await fetchJson(entry.url);
    // Versions older than 1.17 have no javaVersion field and run on Java 8.
    const major = normalizeJavaMajor(versionJson.javaVersion?.majorVersion || 8);
    try {
      fs.mkdirSync(minecraftRoot, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ ...known, [version]: major }));
    } catch (_error) {
      // not fatal: looked up again next launch
    }
    return major;
  } catch (_error) {
    return 21;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

function extractZip(zipPath, destination) {
  // Windows 10+ ships bsdtar, which extracts .zip natively. Use its full path: a GNU tar
  // earlier on PATH (Git, MSYS) can't read .zip and treats "C:" as a remote host.
  const systemTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  const tar = process.platform === "win32" && fs.existsSync(systemTar) ? systemTar : "tar";
  return new Promise((resolve, reject) => {
    execFile(tar, ["-xf", zipPath, "-C", destination], { windowsHide: true }, (error) =>
      error ? reject(new Error(`Could not extract Java runtime: ${error.message}`)) : resolve()
    );
  });
}

// Downloads and verifies a Temurin JRE for `major` into runtimesDir/java-<major>.
async function provisionJava(major, { runtimesDir, fetchJson, downloadFile, onStatus, onProgress }) {
  if (process.platform !== "win32") {
    throw new Error(`Java ${major} is required. Install it from https://adoptium.net and try again.`);
  }

  onStatus(`Java ${major} not found. Downloading Eclipse Temurin ${major}...`);
  const assets = await fetchJson(ADOPTIUM_ASSETS_URL(major));
  const pkg = Array.isArray(assets) ? assets[0]?.binary?.package : null;
  if (!pkg?.link || !pkg?.checksum) {
    throw new Error(`No Java ${major} runtime available for download.`);
  }

  fs.mkdirSync(runtimesDir, { recursive: true });
  const zipPath = path.join(runtimesDir, `java-${major}.zip`);
  await downloadFile(pkg.link, zipPath, {
    onProgress: (received, total) => onProgress(received, total || pkg.size || 0)
  });

  const actual = await sha256File(zipPath);
  if (actual !== pkg.checksum) {
    fs.rmSync(zipPath, { force: true });
    throw new Error(`Java ${major} download failed verification; please retry.`);
  }

  // Extract to a staging folder, then swap in, so a failed extract never leaves a half runtime.
  const finalDir = managedRuntimeDir(runtimesDir, major);
  const stagingDir = `${finalDir}.staging`;
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  onStatus(`Installing Java ${major}...`);
  try {
    await extractZip(zipPath, stagingDir);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, finalDir);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }

  const binary = findJava(major, { env: {}, runtimesDir });
  if (!binary) {
    throw new Error(`Java ${major} was downloaded but no java binary was found.`);
  }
  onStatus(`Java ${major} installed.`);
  return binary;
}

async function listReleaseVersions(fetchJson) {
  const manifest = await fetchVersionManifest(fetchJson);
  return {
    latest: manifest.latest?.release || null,
    releases: manifest.versions.filter((v) => v.type === "release").map((v) => v.id)
  };
}

module.exports = {
  normalizeJavaMajor,
  folderMatchesMajor,
  findJava,
  getRequiredJavaMajor,
  provisionJava,
  listReleaseVersions,
  sha256File
};
