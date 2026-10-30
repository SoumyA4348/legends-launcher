// Anonymous usage stats sent to Aptabase (https://aptabase.com): no names, UUIDs, tokens,
// server addresses or file paths, ever. Only the events listed in EVENTS are accepted,
// and players can turn it off in Settings.

const os = require("os");

const EVENTS = new Set([
  "app_started",
  "launch_started",
  "launch_failed",
  "game_started",
  "game_crashed",
  "game_closed",
  "account_added",
  "account_switched",
  "content_added",
  "instance_created",
  "news_opened",
  "update_installed"
]);

const HOSTS = { US: "https://us.aptabase.com", EU: "https://eu.aptabase.com" };

// App keys look like "A-US-1234567890": the middle part picks the region.
function hostForKey(appKey) {
  const region = /^A-(US|EU)-\w+$/.exec(String(appKey || ""))?.[1];
  return region ? HOSTS[region] : null;
}

// Coarse buckets keep a single player from standing out in the data.
function minutesBucket(ms) {
  const minutes = ms / 60000;
  if (minutes < 5) return "<5m";
  if (minutes < 30) return "5-30m";
  if (minutes < 60) return "30-60m";
  if (minutes < 180) return "1-3h";
  return "3h+";
}

function ramBucket(totalMb) {
  const gb = totalMb / 1024;
  if (gb < 6) return "<6GB";
  if (gb < 12) return "8GB";
  if (gb < 24) return "16GB";
  if (gb < 48) return "32GB";
  return "64GB+";
}

// Only short strings, finite numbers and booleans survive.
function sanitizeProps(props) {
  const clean = {};
  for (const [key, value] of Object.entries(props || {}).slice(0, 12)) {
    if (!/^[a-zA-Z]{1,32}$/.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 40);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) clean[key] = value;
  }
  return clean;
}

// Groups a launch error into a category, never the message itself (it can hold paths).
function errorCategory(message) {
  const text = String(message || "");
  if (/auth|sign in|microsoft|session/i.test(text)) return "auth";
  if (/java/i.test(text)) return "java";
  if (/reach|network|timeout|ENOTFOUND|ECONN|offline/i.test(text)) return "network";
  if (/checksum|corrupt/i.test(text)) return "download";
  if (/fabric|mod/i.test(text)) return "mods";
  return "other";
}

function createAnalytics({ appKey, appVersion, isEnabled, isDebug = false, fetchImpl = globalThis.fetch }) {
  const host = hostForKey(appKey);
  const sessionId = `${Math.floor(Date.now() / 1000)}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const systemProps = {
    isDebug,
    locale: Intl.DateTimeFormat().resolvedOptions().locale || "en",
    osName: os.platform() === "win32" ? "Windows" : os.platform(),
    osVersion: os.release(),
    appVersion,
    sdkVersion: `legends-launcher@${appVersion}`
  };

  function track(eventName, props = {}) {
    if (!host || !EVENTS.has(eventName) || !isEnabled() || typeof fetchImpl !== "function") {
      return false;
    }
    const body = JSON.stringify({
      timestamp: new Date().toISOString(),
      sessionId,
      eventName,
      systemProps,
      props: sanitizeProps(props)
    });
    // Fire and forget: stats must never slow down or break the launcher.
    fetchImpl(`${host}/api/v0/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "App-Key": appKey },
      body,
      signal: AbortSignal.timeout(8000)
    }).catch(() => {});
    return true;
  }

  return { track, enabled: Boolean(host) };
}

module.exports = { createAnalytics, hostForKey, minutesBucket, ramBucket, sanitizeProps, errorCategory, EVENTS };
