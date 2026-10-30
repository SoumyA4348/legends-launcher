const test = require("node:test");
const assert = require("node:assert/strict");
const presence = require("../src/presence");

test("isValidUrl accepts only http(s)", () => {
  assert.equal(presence.isValidUrl("https://discord.gg/abc"), true);
  assert.equal(presence.isValidUrl("http://example.com"), true);
  assert.equal(presence.isValidUrl("javascript:alert(1)"), false);
  assert.equal(presence.isValidUrl("file:///C:/x"), false);
  assert.equal(presence.isValidUrl("not a url"), false);
  assert.equal(presence.isValidUrl(""), false);
});

test("buildDiscordButtons drops invalid URLs, truncates labels, caps at 2", () => {
  const buttons = presence.buildDiscordButtons([
    { label: "A".repeat(40), url: "https://a.com" },
    { label: "Bad", url: "" },
    { label: "B", url: "https://b.com" },
    { label: "C", url: "https://c.com" }
  ]);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].label.length, 32);
  assert.deepEqual(buttons.map((b) => b.url), ["https://a.com", "https://b.com"]);
});

test("isIpv4 validates dotted quads", () => {
  assert.equal(presence.isIpv4("192.168.1.1"), true);
  assert.equal(presence.isIpv4("256.1.1.1"), false);
  assert.equal(presence.isIpv4("1.2.3"), false);
  assert.equal(presence.isIpv4("a.b.c.d"), false);
});

test("isPrivateOrLocalIpv4 covers RFC1918, loopback, link-local, CGNAT", () => {
  for (const ip of ["10.0.0.5", "127.0.0.1", "192.168.0.10", "172.16.0.1", "172.31.255.255", "169.254.1.1", "100.64.0.1", "100.127.1.1", "0.0.0.0"]) {
    assert.equal(presence.isPrivateOrLocalIpv4(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.0.1", "100.128.0.1"]) {
    assert.equal(presence.isPrivateOrLocalIpv4(ip), false, ip);
  }
});

test("sanitizeServerForPresence never leaks private addresses", () => {
  assert.equal(presence.sanitizeServerForPresence("192.168.1.20"), "Private Server");
  assert.equal(presence.sanitizeServerForPresence("localhost"), "Private Server");
  assert.equal(presence.sanitizeServerForPresence("myserver.lan"), "Private Server");
  assert.equal(presence.sanitizeServerForPresence("::1"), "Private Server");
  assert.equal(presence.sanitizeServerForPresence(""), "Private Server");
  assert.equal(presence.sanitizeServerForPresence("8.8.8.8"), "Public Server");
  assert.equal(presence.sanitizeServerForPresence("  Play.Hypixel.NET "), "play.hypixel.net");
});

test("getPresenceState hides everything when showServer is off", () => {
  assert.equal(presence.getPresenceState("play.hypixel.net", false), "Private Server");
  assert.equal(presence.getPresenceState("play.hypixel.net", true), "play.hypixel.net");
});

test("parseConnectedServer reads Minecraft's connect log line", () => {
  assert.deepEqual(presence.parseConnectedServer("[Render thread/INFO]: Connecting to mc.example.com, 25565"), {
    host: "mc.example.com",
    port: "25565"
  });
  assert.equal(presence.parseConnectedServer("Loading Minecraft 1.21"), null);
});

test("extractGameInfoFromCmdline reads version and quick-play server", () => {
  const cmd = 'javaw.exe -Xmx4G net.minecraft.client.main.Main --version fabric-loader-0.16.9-1.21.1 --gameDir C:\\.minecraft --quickPlayMultiplayer play.example.net:25565';
  assert.deepEqual(presence.extractGameInfoFromCmdline(cmd, true), {
    version: "fabric-loader-0.16.9-1.21.1",
    state: "play.example.net"
  });
  assert.equal(presence.extractGameInfoFromCmdline(cmd, false).state, "Private Server");
});

test("extractGameInfoFromCmdline handles quoted version and legacy --server", () => {
  const cmd = 'java --version "1.8.9" --server 10.0.0.2 --port 25570';
  assert.deepEqual(presence.extractGameInfoFromCmdline(cmd, true), {
    version: "1.8.9",
    state: "Private Server"
  });
  assert.deepEqual(presence.extractGameInfoFromCmdline("", true), {
    version: "Minecraft",
    state: "Private Server"
  });
});
