// Minecraft Server List Ping (the protocol the in-game multiplayer screen uses):
// handshake + status request over TCP, returns MOTD, player counts and latency.

const net = require("net");
const dns = require("dns").promises;

function encodeVarInt(value) {
  const bytes = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

// Returns { value, size } or null when the buffer doesn't hold a complete VarInt yet.
function decodeVarInt(buffer, offset = 0) {
  let value = 0;
  let size = 0;
  let byte;
  do {
    if (offset + size >= buffer.length) return null;
    byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
    if (size > 5) throw new Error("VarInt too long");
  } while (byte & 0x80);
  return { value, size };
}

function packet(id, payload) {
  const body = Buffer.concat([encodeVarInt(id), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function buildHandshake(host, port, protocolVersion = 767) {
  const hostBytes = Buffer.from(host, "utf8");
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  return packet(
    0x00,
    Buffer.concat([encodeVarInt(protocolVersion), encodeVarInt(hostBytes.length), hostBytes, portBytes, encodeVarInt(1)])
  );
}

// Flattens chat components ({"text": "..", "extra": [...]}) into plain text without § codes.
function motdToText(description) {
  const walk = (node) => {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(walk).join("");
    // Obfuscated text renders as scrambled glyphs in game; its literal filler is noise.
    const own = node.obfuscated ? "" : node.text || "";
    return `${own}${(node.extra || []).map(walk).join("")}`;
  };
  return walk(description).replace(/§./g, "").trim();
}

function parseStatusResponse(buffer) {
  const length = decodeVarInt(buffer, 0);
  if (!length || buffer.length < length.size + length.value) return null;
  let offset = length.size;
  const id = decodeVarInt(buffer, offset);
  offset += id.size;
  const strLen = decodeVarInt(buffer, offset);
  offset += strLen.size;
  const json = JSON.parse(buffer.subarray(offset, offset + strLen.value).toString("utf8"));
  return {
    online: true,
    motd: motdToText(json.description),
    version: json.version?.name || null,
    playersOnline: json.players?.online ?? null,
    playersMax: json.players?.max ?? null,
    favicon: typeof json.favicon === "string" && json.favicon.startsWith("data:image/png;base64,") ? json.favicon : null
  };
}

// Domains may publish their real host/port via an SRV record, like the game client honours.
async function resolveTarget(host, port) {
  if (net.isIP(host)) return { host, port };
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (records.length > 0) return { host: records[0].name, port: records[0].port };
  } catch (_error) {
    // no SRV record
  }
  return { host, port };
}

async function pingServer(host, port = 25565, timeoutMs = 5000) {
  const target = await resolveTarget(host, port);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: target.host, port: target.port });
    let received = Buffer.alloc(0);
    let startedAt = 0;
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => finish({ online: false, error: "Timed out" }));
    socket.on("error", (error) => finish({ online: false, error: error.code || error.message }));
    socket.on("connect", () => {
      startedAt = Date.now();
      socket.write(buildHandshake(host, target.port));
      socket.write(packet(0x00, Buffer.alloc(0)));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      try {
        const status = parseStatusResponse(received);
        if (status) finish({ ...status, latencyMs: Date.now() - startedAt });
      } catch (_error) {
        finish({ online: false, error: "Invalid server response" });
      }
    });
  });
}

module.exports = {
  encodeVarInt,
  decodeVarInt,
  buildHandshake,
  motdToText,
  parseStatusResponse,
  pingServer
};
