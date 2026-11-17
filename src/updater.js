// Wires electron-updater to the renderer. A failed check or download (offline, GitHub hiccup)
// is retried after a short backoff instead of waiting for the next regular check.

const { createChaos } = require("./chaos");

// Players leave the launcher open for hours: look for new releases every few hours too.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

function wireAutoUpdates(
  updater,
  { send, status, setTimer = setTimeout, clearTimer = clearTimeout, every = setInterval, chaos = createChaos() }
) {
  let pendingVersion = null;
  let failures = 0;
  let retryTimer = null;

  const chaosCheck = chaos.wrap("checkForUpdates", () => updater.checkForUpdates());
  // Real failures arrive on the "error" event; an injected one only rejects, so pass it on.
  const check = () => chaosCheck("update feed").catch((error) => error.chaos && updater.emit("error", error));

  const settle = () => {
    failures = 0;
    clearTimer(retryTimer);
    retryTimer = null;
  };

  updater.on("update-available", (info) => {
    pendingVersion = info.version;
    send({ state: "downloading", version: info.version, percent: 0 });
  });
  updater.on("download-progress", (progress) => {
    send({ state: "downloading", version: pendingVersion, percent: Math.round(progress.percent || 0) });
  });
  updater.on("update-not-available", settle);
  updater.on("update-downloaded", (info) => {
    settle();
    pendingVersion = null;
    send({ state: "ready", version: info.version });
  });
  updater.on("error", (error) => {
    // Only the first line: the full stack is noise in the console.
    status(`Update check failed: ${String(error.message).split("\n")[0]}`);
    if (pendingVersion) {
      send({ state: "failed", version: pendingVersion });
      pendingVersion = null;
    }
    clearTimer(retryTimer);
    retryTimer = setTimer(check, RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]);
    failures++;
  });

  check();
  every(check, CHECK_INTERVAL_MS);
}

module.exports = { wireAutoUpdates, CHECK_INTERVAL_MS, RETRY_DELAYS_MS };
