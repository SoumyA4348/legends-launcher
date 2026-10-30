const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const launcher = require("../src/launcher");

const silentHooks = () => {
  const messages = [];
  return { messages, onStatus: (m) => messages.push(m), onExit: () => {} };
};

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legends-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Smallest valid ZIP: a lone end-of-central-directory record, padded past MIN_ZIP_SIZE
// with a local-file-header magic at the start.
function writeMinimalJar(filePath) {
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0)]);
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
  fs.writeFileSync(filePath, Buffer.concat([header, eocd]));
}

test("isLegacyVersion: 1.13 and below are legacy", () => {
  assert.equal(launcher.isLegacyVersion("1.8.9"), true);
  assert.equal(launcher.isLegacyVersion("1.13.2"), true);
  assert.equal(launcher.isLegacyVersion("1.14"), false);
  assert.equal(launcher.isLegacyVersion("1.21.1"), false);
  assert.equal(launcher.isLegacyVersion("24w14a"), false);
});

test("sanitizePort enforces 1-65535", () => {
  assert.equal(launcher.sanitizePort("25565"), 25565);
  assert.equal(launcher.sanitizePort(1), 1);
  assert.equal(launcher.sanitizePort(65535), 65535);
  for (const bad of [0, 65536, "abc", "", -1]) {
    assert.throws(() => launcher.sanitizePort(bad), /between 1 and 65535/, String(bad));
  }
});

test("sanitizeMemoryMb enforces 1024-32768", () => {
  assert.equal(launcher.sanitizeMemoryMb("4096"), 4096);
  assert.throws(() => launcher.sanitizeMemoryMb(512), /between 1024 and 32768/);
  assert.throws(() => launcher.sanitizeMemoryMb(65536), /between 1024 and 32768/);
});

test("parseBoolean handles strings, booleans and fallback", () => {
  assert.equal(launcher.parseBoolean(true, false), true);
  assert.equal(launcher.parseBoolean(" YES ", false), true);
  assert.equal(launcher.parseBoolean("0", true), false);
  assert.equal(launcher.parseBoolean("maybe", true), true);
  assert.equal(launcher.parseBoolean(undefined, false), false);
});

test("normalizeLaunchProfile defaults to competitive", () => {
  assert.equal(launcher.normalizeLaunchProfile("FULL"), "full");
  assert.equal(launcher.normalizeLaunchProfile("anything"), "competitive");
  assert.equal(launcher.normalizeLaunchProfile(undefined), "competitive");
});

test("isJarCorrupted detects missing, truncated, HTML and valid jars", (t) => {
  const dir = makeTempDir(t);
  const valid = path.join(dir, "ok.jar");
  writeMinimalJar(valid);
  assert.equal(launcher.isJarCorrupted(valid), false);

  const html = path.join(dir, "404.jar");
  fs.writeFileSync(html, "<html><body>404 Not Found</body></html>".padEnd(200, " "));
  assert.equal(launcher.isJarCorrupted(html), true);

  const truncated = path.join(dir, "cut.jar");
  fs.writeFileSync(truncated, fs.readFileSync(valid).subarray(0, 40));
  assert.equal(launcher.isJarCorrupted(truncated), true);

  assert.equal(launcher.isJarCorrupted(path.join(dir, "missing.jar")), true);
});

test("forcePerformanceVideoSettings fills missing keys and keeps the player's choices", (t) => {
  const dir = makeTempDir(t);
  const optionsPath = path.join(dir, "options.txt");
  fs.writeFileSync(optionsPath, "fov:0.5\nenableVsync:true\nlang:en_us\n");
  const hooks = silentHooks();

  launcher.forcePerformanceVideoSettings(dir, hooks);
  const written = fs.readFileSync(optionsPath, "utf8");
  assert.match(written, /^fov:0\.5$/m);
  assert.match(written, /^lang:en_us$/m);
  assert.match(written, /^enableVsync:true$/m);
  assert.match(written, /^maxFps:240$/m);

  launcher.forcePerformanceVideoSettings(dir, hooks);
  assert.match(hooks.messages.at(-1), /already applied/);
});

test("readManagedModsState handles missing, legacy-array and corrupt files", (t) => {
  const dir = makeTempDir(t);
  const statePath = path.join(dir, ".launcher-managed-mods.json");
  assert.deepEqual(launcher.readManagedModsState(dir), { mcVersion: null, fabricVersion: null, files: [] });

  fs.writeFileSync(statePath, JSON.stringify(["a.jar"]));
  assert.deepEqual(launcher.readManagedModsState(dir).files, ["a.jar"]);

  fs.writeFileSync(statePath, "{not json");
  assert.deepEqual(launcher.readManagedModsState(dir).files, []);
});

test("pruneManagedMods removes only unselected .jar files", (t) => {
  const dir = makeTempDir(t);
  const modsDir = path.join(dir, "mods");
  fs.mkdirSync(modsDir);
  for (const name of ["keep.jar", "stale.jar", "notes.txt"]) {
    fs.writeFileSync(path.join(modsDir, name), "x");
  }
  launcher.pruneManagedMods(dir, ["keep.jar"], silentHooks());
  assert.deepEqual(fs.readdirSync(modsDir).sort(), ["keep.jar", "notes.txt"]);
});

test("mapLimit preserves order and never exceeds the concurrency limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await launcher.mapLimit([50, 10, 30, 20, 40, 5], 3, async (ms, i) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, ms));
    inFlight -= 1;
    return i;
  });
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 3);
});

test("launchMinecraft refuses to start without Microsoft auth", async () => {
  await assert.rejects(
    launcher.launchMinecraft({ version: "1.21.1", serverHost: "x" }, silentHooks()),
    /Microsoft authentication is required/
  );
  await assert.rejects(
    launcher.launchMinecraft({ auth: { access_token: "0", name: "Steve" }, version: "1.21.1", serverHost: "x" }, silentHooks()),
    /Microsoft authentication is required/
  );
});

test("getInstanceDir keeps the default instance in the shared root and isolates the rest", (t) => {
  const dir = makeTempDir(t);
  const previous = process.env.LEGENDS_DATA_DIR;
  process.env.LEGENDS_DATA_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.LEGENDS_DATA_DIR;
    else process.env.LEGENDS_DATA_DIR = previous;
  });

  assert.equal(launcher.getInstanceDir("default"), launcher.getMinecraftRoot());
  assert.equal(launcher.getInstanceDir(undefined), launcher.getMinecraftRoot());
  assert.equal(
    launcher.getInstanceDir("survival-ab12c"),
    path.join(dir, "PrivateCustomMinecraftLauncher", "instances", "survival-ab12c")
  );
  for (const bad of ["../escape", "..", "a/b", "C:\\x", "UPPER", "-lead", "x".repeat(41)]) {
    assert.throws(() => launcher.getInstanceDir(bad), /Invalid instance id/, bad);
  }
});

test("sanitizeExtraMods keeps valid Modrinth slugs only", () => {
  assert.deepEqual(launcher.sanitizeExtraMods("nope"), []);
  assert.deepEqual(
    launcher.sanitizeExtraMods([
      { slug: "iris", name: "Iris Shaders" },
      { slug: "../../etc", name: "bad" },
      { slug: "a/b" },
      null,
      { slug: "P7dR8mSH" }
    ]),
    [
      { projects: ["iris"], name: "Iris Shaders" },
      { projects: ["P7dR8mSH"], name: "P7dR8mSH" }
    ]
  );
  const many = Array.from({ length: 150 }, (_, i) => ({ slug: `mod-${i}` }));
  assert.equal(launcher.sanitizeExtraMods(many).length, 100);
});

test("VerifiedCache trusts unchanged files and re-checks changed ones across restarts", (t) => {
  const { VerifiedCache } = require("../src/verified-cache");
  const dir = makeTempDir(t);
  const file = path.join(dir, "assets", "ab", "abcd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "hello");

  const cache = new VerifiedCache(dir);
  assert.equal(cache.has(file, "abcd"), false);
  cache.add(file, "abcd");
  cache.save();

  const reloaded = new VerifiedCache(dir);
  assert.equal(reloaded.has(file, "abcd"), true);
  assert.equal(reloaded.has(file, "other-hash"), false, "entry is bound to the expected hash");

  fs.writeFileSync(file, "hello, but truncated or replaced");
  assert.equal(reloaded.has(file, "abcd"), false, "a changed size invalidates the entry");

  fs.writeFileSync(path.join(dir, ".legends-verified.json"), "{not json");
  assert.equal(new VerifiedCache(dir).has(file, "abcd"), false, "a corrupt cache starts empty");
});

test("prepareModdedProfile launches from disk when the mod list was checked recently", async (t) => {
  const dir = makeTempDir(t);
  const root = path.join(dir, "root");
  const gameDir = path.join(dir, "game");
  const profile = "fabric-loader-0.16.0-1.21.1";
  fs.mkdirSync(path.join(root, "versions", profile), { recursive: true });
  fs.writeFileSync(path.join(root, "versions", profile, `${profile}.json`), "{}");
  fs.mkdirSync(path.join(gameDir, "mods"), { recursive: true });
  writeMinimalJar(path.join(gameDir, "mods", "sodium.jar"));
  const mods = [{ projects: ["sodium"], name: "Sodium" }];
  fs.writeFileSync(path.join(gameDir, ".launcher-managed-mods.json"), JSON.stringify({
    mcVersion: "1.21.1", fabricVersion: "0.16.0", files: ["sodium.jar"], modsKey: "1.21.1|sodium", resolvedAt: Date.now()
  }));

  const hooks = silentHooks();
  assert.equal(await launcher.prepareModdedProfile("1.21.1", root, gameDir, mods, hooks), profile);
  assert.ok(hooks.messages.some((m) => /up to date/.test(m)));
  assert.ok(!hooks.messages.some((m) => /Resolving|Installing Fabric/.test(m)), "no network work");
  assert.ok(fs.existsSync(path.join(gameDir, "mods", "sodium.jar")));
});

test("sanitizeGameWindow keeps valid sizes and drops bad ones", () => {
  assert.deepEqual(launcher.sanitizeGameWindow({ width: "1920", height: "1080", fullscreen: false }), {
    width: 1920,
    height: 1080,
    fullscreen: false
  });
  assert.equal(launcher.sanitizeGameWindow({ width: "", height: "" }), null);
  assert.equal(launcher.sanitizeGameWindow({ width: "100", height: "1080" }), null);
  assert.equal(launcher.sanitizeGameWindow(undefined), null);
  assert.deepEqual(launcher.sanitizeGameWindow({ fullscreen: true }), { fullscreen: true });
});

test("findLatestCrashReport returns the newest report written since launch", (t) => {
  const dir = makeTempDir(t);
  assert.equal(launcher.findLatestCrashReport(dir, 0), null);

  const reports = path.join(dir, "crash-reports");
  fs.mkdirSync(reports);
  const old = path.join(reports, "crash-old.txt");
  const fresh = path.join(reports, "crash-new.txt");
  fs.writeFileSync(old, "old");
  fs.writeFileSync(fresh, "new");
  fs.writeFileSync(path.join(reports, "notes.log"), "x");
  const now = Date.now();
  fs.utimesSync(old, new Date(now - 60000), new Date(now - 60000));
  fs.utimesSync(fresh, new Date(now), new Date(now));

  assert.equal(launcher.findLatestCrashReport(dir, now - 1000), fresh);
  assert.equal(launcher.findLatestCrashReport(dir, now + 60000), null);
});
