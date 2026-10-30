// Reads a player's skin from their Mojang session-server profile: the texture URL and whether
// it uses the slim (Alex) arm model. Without a custom skin, mc-heads.net serves the default
// skin Mojang assigns to that UUID.

const TEXTURE_URL = /^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]{16,128}$/;

function normalizeUuid(uuid) {
  const clean = String(uuid || "").replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(clean) ? clean : null;
}

function fallbackSkin(uuid) {
  return { url: `https://mc-heads.net/skin/${uuid}`, slim: false };
}

function parseSkinProfile(profile, uuid) {
  try {
    const property = (profile?.properties || []).find((entry) => entry.name === "textures");
    const textures = JSON.parse(Buffer.from(String(property?.value || ""), "base64").toString("utf8"));
    const skin = textures?.textures?.SKIN;
    // Mojang still hands out http:// texture links; the same files are served over https.
    const url = String(skin?.url || "").replace(/^http:\/\//, "https://");
    if (TEXTURE_URL.test(url)) {
      return { url, slim: skin?.metadata?.model === "slim" };
    }
  } catch (_error) {
    // malformed profile: use the default skin
  }
  return fallbackSkin(uuid);
}

module.exports = { normalizeUuid, parseSkinProfile, fallbackSkin };
