// Builds the Play page news column from Mojang's launcher feeds and this launcher's GitHub
// releases. Feed data is untrusted: only https links to known sites survive, text is plain
// and trimmed, and images must be Mojang's own.

const MOJANG_CONTENT = "https://launchercontent.mojang.com";
const RELEASES_PAGE = "https://github.com/SoumyA4348/legends-launcher/releases/";
const MAX_ITEMS = 3;

function clip(text, max) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function safeUrl(value, host) {
  try {
    const url = new URL(String(value));
    const hostOk = url.hostname === host || url.hostname.endsWith(`.${host}`);
    return url.protocol === "https:" && hostOk ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

// Feed images are site-relative paths such as /v2/images/abc.jpg.
function mojangImage(pathname) {
  return /^\/v2\/images\/[\w.%-]+$/.test(String(pathname || "")) ? MOJANG_CONTENT + pathname : "";
}

function isoDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function launcherItem(releases) {
  const release = Array.isArray(releases) ? releases.find((r) => r && !r.draft && !r.prerelease) : null;
  const url = safeUrl(release?.html_url, "github.com");
  const date = isoDate(release?.published_at);
  if (!url.startsWith(RELEASES_PAGE) || !date) {
    return null;
  }
  // First real line of the release notes, without Markdown markers.
  const summary = String(release.body || "")
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  return {
    kind: "launcher",
    title: clip(`Legends Launcher ${release.tag_name || release.name || ""}`, 60),
    text: clip(summary || "A new version of the launcher is out.", 140),
    date,
    image: "",
    url
  };
}

// The newest full release's notes, linked to its changelog on the Minecraft Wiki.
function javaReleaseItem(patchNotes) {
  const entries = Array.isArray(patchNotes?.entries) ? patchNotes.entries : [];
  const latest = entries.find((entry) => entry?.type === "release" && /^[\w.-]{1,24}$/.test(String(entry.version || "")));
  const date = isoDate(latest?.date);
  if (!date) {
    return null;
  }
  return {
    kind: "release",
    title: clip(String(latest.title || "").replace(/^Minecraft:\s*/, "") || `Java Edition ${latest.version}`, 60),
    text: clip(latest.shortText, 140),
    date,
    image: mojangImage(latest.image?.url),
    url: `https://minecraft.wiki/w/Java_Edition_${encodeURIComponent(latest.version)}`
  };
}

// News Mojang tags for Java players (as the official launcher's Java tab does); the feed also
// carries Bedrock-only and store promotions.
function javaNewsItems(news) {
  const entries = Array.isArray(news?.entries) ? news.entries : [];
  return entries
    .filter((entry) => Array.isArray(entry?.newsType) && entry.newsType.includes("Java") && entry.title)
    .map((entry) => ({
      kind: "news",
      title: clip(entry.title, 60),
      text: clip(entry.text, 140),
      date: isoDate(entry.date),
      image: mojangImage(entry.playPageImage?.url),
      url: safeUrl(entry.readMoreLink, "minecraft.net")
    }))
    .filter((item) => item.date && item.url)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Launcher release first, then the latest Java release notes, then the newest news.
function buildNewsItems({ news, patchNotes, releases }) {
  return [launcherItem(releases), javaReleaseItem(patchNotes), ...javaNewsItems(news)]
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

module.exports = { buildNewsItems, MAX_ITEMS };
