const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { beginBorderless, endBorderless, MARKER } = require("../src/borderless");

function makeGameDir(t, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legends-borderless-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (options !== undefined) fs.writeFileSync(path.join(dir, "options.txt"), options);
  return dir;
}

const readOptions = (dir) => fs.readFileSync(path.join(dir, "options.txt"), "utf8");

test("fullscreen from options.txt starts windowed and is restored on exit", (t) => {
  const dir = makeGameDir(t, "version:3953\nfullscreen:true\nrenderDistance:12\n");
  assert.equal(beginBorderless(dir, false), true);
  assert.equal(readOptions(dir), "version:3953\nfullscreen:false\nrenderDistance:12\n");
  assert.ok(fs.existsSync(path.join(dir, MARKER)));

  endBorderless(dir);
  assert.equal(readOptions(dir), "version:3953\nfullscreen:true\nrenderDistance:12\n");
  assert.ok(!fs.existsSync(path.join(dir, MARKER)));
});

test("windowed game is left alone", (t) => {
  const dir = makeGameDir(t, "fullscreen:false\n");
  assert.equal(beginBorderless(dir, false), false);
  endBorderless(dir);
  assert.equal(readOptions(dir), "fullscreen:false\n");
});

test("launcher fullscreen setting goes borderless without touching options.txt", (t) => {
  const dir = makeGameDir(t);
  assert.equal(beginBorderless(dir, true), true);
  assert.ok(!fs.existsSync(path.join(dir, MARKER)));
  endBorderless(dir);
  assert.ok(!fs.existsSync(path.join(dir, "options.txt")));
});

test("a launch that never restored is still treated as fullscreen", (t) => {
  const dir = makeGameDir(t, "fullscreen:true\n");
  beginBorderless(dir, false);
  // launcher died mid-game: next launch sees the marker, not fullscreen:true
  assert.equal(beginBorderless(dir, false), true);
  endBorderless(dir);
  assert.equal(readOptions(dir), "fullscreen:true\n");
});

test("switching to windowed in game is kept after quitting", async (t) => {
  const dir = makeGameDir(t, "fullscreen:true\nfov:0.0\n");
  beginBorderless(dir, false);
  const gameSaves = (value) => fs.writeFileSync(path.join(dir, "options.txt"), `fullscreen:${value}\nfov:0.0\n`);
  const playerPause = () => new Promise((resolve) => setTimeout(resolve, 1100));
  gameSaves(true); // F11: fullscreen
  await playerPause();
  gameSaves(false); // F11 again: windowed
  await playerPause();
  endBorderless(dir);
  assert.equal(readOptions(dir), "fullscreen:false\nfov:0.0\n");
  // and the next launch stays windowed
  assert.equal(beginBorderless(dir, false), false);
});

test("game saving options mid-session doesn't lose fullscreen", (t) => {
  const dir = makeGameDir(t, "fullscreen:true\nfov:0.0\n");
  beginBorderless(dir, false);
  fs.writeFileSync(path.join(dir, "options.txt"), "fullscreen:false\nfov:0.5\n");
  endBorderless(dir);
  assert.equal(readOptions(dir), "fullscreen:true\nfov:0.5\n");
});
