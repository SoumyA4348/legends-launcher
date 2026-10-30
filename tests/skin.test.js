const test = require("node:test");
const assert = require("node:assert/strict");
const skin = require("../src/skin");

const UUID = "069a79f444e94726a5befca90e38aaf5";
const profileWith = (textures) => ({
  id: UUID,
  properties: [{ name: "textures", value: Buffer.from(JSON.stringify({ textures })).toString("base64") }]
});

test("normalizeUuid accepts dashed and plain UUIDs only", () => {
  assert.equal(skin.normalizeUuid("069a79f4-44e9-4726-a5be-fca90e38aaf5"), UUID);
  assert.equal(skin.normalizeUuid(UUID.toUpperCase()), UUID);
  assert.equal(skin.normalizeUuid("../etc"), null);
  assert.equal(skin.normalizeUuid(undefined), null);
});

test("parseSkinProfile reads the texture over https and the slim model", () => {
  const hash = "292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680";
  assert.deepEqual(skin.parseSkinProfile(profileWith({ SKIN: { url: `http://textures.minecraft.net/texture/${hash}` } }), UUID), {
    url: `https://textures.minecraft.net/texture/${hash}`,
    slim: false
  });
  const slim = skin.parseSkinProfile(
    profileWith({ SKIN: { url: `https://textures.minecraft.net/texture/${hash}`, metadata: { model: "slim" } } }),
    UUID
  );
  assert.equal(slim.slim, true);
});

test("parseSkinProfile falls back to the default skin for missing or foreign textures", () => {
  const fallback = { url: `https://mc-heads.net/skin/${UUID}`, slim: false };
  assert.deepEqual(skin.parseSkinProfile(profileWith({}), UUID), fallback);
  assert.deepEqual(skin.parseSkinProfile(profileWith({ SKIN: { url: "https://evil.example/texture/abc" } }), UUID), fallback);
  assert.deepEqual(skin.parseSkinProfile({ properties: [{ name: "textures", value: "not base64 json" }] }, UUID), fallback);
  assert.deepEqual(skin.parseSkinProfile(null, UUID), fallback);
});
