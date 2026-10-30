const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const java = require("../src/java");

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legends-java-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeJdk(baseDir, folder, binary = "javaw.exe") {
  const bin = path.join(baseDir, folder, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, binary), "");
  return path.join(bin, binary);
}

test("normalizeJavaMajor maps 16 to 17 and floors at 8", () => {
  assert.equal(java.normalizeJavaMajor(16), 17);
  assert.equal(java.normalizeJavaMajor(21), 21);
  assert.equal(java.normalizeJavaMajor("17"), 17);
  assert.equal(java.normalizeJavaMajor(undefined), 8);
  assert.equal(java.normalizeJavaMajor(6), 8);
});

test("folderMatchesMajor recognises vendor folder names", () => {
  assert.equal(java.folderMatchesMajor("jdk-21.0.5+11-jre", 21), true);
  assert.equal(java.folderMatchesMajor("jdk-21.0.11.10-hotspot", 21), true);
  assert.equal(java.folderMatchesMajor("jdk-17.0.21", 21), false);
  assert.equal(java.folderMatchesMajor("jdk-210", 21), false);
  assert.equal(java.folderMatchesMajor("jre1.8.0_401", 8), true);
  assert.equal(java.folderMatchesMajor("jdk8u402-b06-jre", 8), true);
  assert.equal(java.folderMatchesMajor("jdk-21.0.5", 8), false);
});

test("findJava honours LEGENDS_JAVA_PATH override", (t) => {
  const dir = makeTempDir(t);
  const override = path.join(dir, "custom-java.exe");
  fs.writeFileSync(override, "");
  assert.equal(java.findJava(21, { env: { LEGENDS_JAVA_PATH: override }, platform: "win32" }), override);
});

test("findJava prefers the launcher-managed runtime and javaw.exe", (t) => {
  const runtimes = makeTempDir(t);
  const managed = fakeJdk(path.join(runtimes, "java-21"), "jdk-21.0.5+11-jre");
  fakeJdk(path.join(runtimes, "java-21"), "jdk-21.0.5+11-jre", "java.exe");
  assert.equal(java.findJava(21, { env: { ProgramFiles: runtimes }, runtimesDir: runtimes, platform: "win32" }), managed);
});

test("findJava picks the newest matching install and ignores other majors", (t) => {
  const programFiles = makeTempDir(t);
  const adoptium = path.join(programFiles, "Eclipse Adoptium");
  fakeJdk(adoptium, "jdk-17.0.9.9-hotspot");
  fakeJdk(adoptium, "jdk-21.0.2.13-hotspot");
  const newest = fakeJdk(adoptium, "jdk-21.0.11.10-hotspot");
  assert.equal(java.findJava(21, { env: { ProgramFiles: programFiles }, platform: "win32" }), newest);
  assert.equal(java.findJava(8, { env: { ProgramFiles: programFiles }, platform: "win32" }), null);
});

test("findJava only trusts JAVA_HOME for the right major", (t) => {
  const root = makeTempDir(t);
  const jdk17 = path.join(root, "jdk-17.0.21");
  const jdk21 = path.join(root, "jdk-21.0.5");
  fakeJdk(root, "jdk-17.0.21");
  const java21 = fakeJdk(root, "jdk-21.0.5");
  const env = (home) => ({ JAVA_HOME: home, ProgramFiles: path.join(root, "none") });
  assert.equal(java.findJava(21, { env: env(jdk17), platform: "win32" }), null);
  assert.equal(java.findJava(21, { env: env(jdk21), platform: "win32" }), java21);
});

test("getRequiredJavaMajor reads the local version JSON first (offline)", async (t) => {
  const root = makeTempDir(t);
  const versionDir = path.join(root, "versions", "1.20.1");
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, "1.20.1.json"), JSON.stringify({ javaVersion: { majorVersion: 17 } }));
  const fetchJson = () => {
    throw new Error("network should not be used");
  };
  assert.equal(await java.getRequiredJavaMajor("1.20.1", { minecraftRoot: root, fetchJson }), 17);
});

test("getRequiredJavaMajor falls back to Java 8 for old versions and 21 when offline", async (t) => {
  const root = makeTempDir(t);
  const fetchJson = async (url) => {
    if (url.includes("version_manifest")) {
      return { versions: [{ id: "1.8.9", url: "https://example/1.8.9.json" }] };
    }
    return {}; // 1.8.9's JSON has no javaVersion field
  };
  assert.equal(await java.getRequiredJavaMajor("1.8.9", { minecraftRoot: root, fetchJson }), 8);

  const offline = async () => {
    throw new Error("ENOTFOUND");
  };
  assert.equal(await java.getRequiredJavaMajor("9.99", { minecraftRoot: root, fetchJson: offline }), 21);
});

test("sha256File hashes file contents", async (t) => {
  const dir = makeTempDir(t);
  const file = path.join(dir, "a.txt");
  fs.writeFileSync(file, "abc");
  assert.equal(await java.sha256File(file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
