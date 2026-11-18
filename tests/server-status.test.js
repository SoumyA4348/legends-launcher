const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");
const status = require("../src/server-status");

test("VarInt round-trips edge values", () => {
  for (const value of [0, 1, 127, 128, 255, 25565, 2097151, 2147483647]) {
    const encoded = status.encodeVarInt(value);
    assert.deepEqual(status.decodeVarInt(encoded), { value, size: encoded.length }, String(value));
  }
  assert.deepEqual([...status.encodeVarInt(300)], [0xac, 0x02]);
});

test("decodeVarInt returns null for incomplete input", () => {
  assert.equal(status.decodeVarInt(Buffer.from([0x80])), null);
});

test("motdToText flattens chat components and strips colour codes", () => {
  assert.equal(status.motdToText("§aHello §lWorld"), "Hello World");
  assert.equal(
    status.motdToText({ text: "A ", extra: [{ text: "B" }, " C", { text: "", extra: ["§cD"] }] }),
    "A B CD"
  );
  assert.equal(status.motdToText({ text: "", extra: [{ text: "a", obfuscated: true }, " NEWS ", { text: "a", obfuscated: true }] }), "NEWS");
});

function frame(json) {
  const body = Buffer.from(JSON.stringify(json), "utf8");
  const payload = Buffer.concat([status.encodeVarInt(0), status.encodeVarInt(body.length), body]);
  return Buffer.concat([status.encodeVarInt(payload.length), payload]);
}

test("parseStatusResponse waits for a full frame, then parses it", () => {
  const full = frame({
    description: { text: "Welcome" },
    version: { name: "1.21.1" },
    players: { online: 12, max: 100 },
    favicon: "data:image/png;base64,AAAA"
  });
  assert.equal(status.parseStatusResponse(full.subarray(0, full.length - 5)), null);
  assert.deepEqual(status.parseStatusResponse(full), {
    online: true,
    motd: "Welcome",
    version: "1.21.1",
    playersOnline: 12,
    playersMax: 100,
    favicon: "data:image/png;base64,AAAA"
  });
});

test("parseStatusResponse rejects non-PNG favicons", () => {
  const parsed = status.parseStatusResponse(frame({ description: "x", favicon: "javascript:alert(1)" }));
  assert.equal(parsed.favicon, null);
});

test("pingServer talks to a real TCP server (split response)", async (t) => {
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      const response = frame({ description: "Local", version: { name: "test" }, players: { online: 1, max: 2 } });
      // Send in two chunks to exercise buffering.
      socket.write(response.subarray(0, 4));
      setTimeout(() => socket.end(response.subarray(4)), 10);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const result = await status.pingServer("127.0.0.1", server.address().port, 2000);
  assert.equal(result.online, true);
  assert.equal(result.motd, "Local");
  assert.equal(result.playersOnline, 1);
  assert.ok(result.latencyMs >= 0);
});

test("pingServer reports offline for a closed port", async () => {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const result = await status.pingServer("127.0.0.1", port, 2000);
  assert.equal(result.online, false);
  assert.ok(result.error);
});

// A TCP server for one test that runs `onSocket` per connection and is torn down afterwards.
async function serve(t, onSocket) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    onSocket(socket);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return server.address().port;
}

test("pingServer reports offline when the server hangs up without answering", async (t) => {
  const port = await serve(t, (socket) => socket.end());
  const result = await status.pingServer("127.0.0.1", port, 2000);
  assert.equal(result.online, false);
});

test("pingServer reports offline when the port is a web server", async (t) => {
  const port = await serve(t, (socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  const result = await status.pingServer("127.0.0.1", port, 2000);
  assert.equal(result.online, false);
});

test("pingServer gives up at its deadline even while bytes trickle in", async (t) => {
  const port = await serve(t, (socket) => {
    socket.write(Buffer.from([0x64])); // promises a 100-byte reply
    const drip = setInterval(() => socket.write(Buffer.from([0x20])), 200);
    socket.on("close", () => clearInterval(drip));
  });
  const startedAt = Date.now();
  const result = await status.pingServer("127.0.0.1", port, 1000);
  assert.deepEqual(result, { online: false, error: "Timed out" });
  assert.ok(Date.now() - startedAt < 2000);
});

test("a reply far over the protocol limit is refused before it fills memory", async (t) => {
  assert.throws(() => status.parseStatusResponse(Buffer.from([0xff, 0xff, 0xff, 0x7f])), /too large/);
  const port = await serve(t, (socket) => {
    socket.write(Buffer.from([0xff, 0xff, 0xff, 0x7f])); // claims 268 MB
    socket.write(Buffer.alloc(1024 * 1024, 0x20));
  });
  const result = await status.pingServer("127.0.0.1", port, 2000);
  assert.deepEqual(result, { online: false, error: "Invalid server response" });
});

test("a server that leaves out its player limit shows no player count", () => {
  const parsed = status.parseStatusResponse(frame({ description: "x", players: { online: 3 } }));
  assert.equal(parsed.playersMax, null);
});
