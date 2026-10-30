// Pure helpers for Discord Rich Presence: no Electron or RPC dependencies,
// so they can be unit tested with plain Node.

function isValidUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_error) {
    return false;
  }
}

function buildDiscordButtons(buttonConfigs) {
  return buttonConfigs
    .filter((button) => isValidUrl(button.url))
    .map((button) => ({ label: button.label.slice(0, 32), url: button.url }))
    .slice(0, 2);
}

function formatVersion(version) {
  const cleaned = String(version || "").trim();
  return cleaned || "Minecraft";
}

function isIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateOrLocalIpv4(ipv4) {
  const parts = ipv4.split(".").map((x) => Number(x));
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  // Carrier-grade NAT / Tailscale range (100.64.0.0/10)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true;
  }
  return false;
}

function sanitizeServerForPresence(serverHost) {
  const normalizedHost = String(serverHost || "").trim().toLowerCase();

  if (!normalizedHost || normalizedHost === "localhost") {
    return "Private Server";
  }

  const isLocalDomain =
    normalizedHost.endsWith(".local") || normalizedHost.endsWith(".lan") || normalizedHost.endsWith(".home");
  if (isLocalDomain) {
    return "Private Server";
  }

  if (isIpv4(normalizedHost)) {
    return isPrivateOrLocalIpv4(normalizedHost) ? "Private Server" : "Public Server";
  }

  // Never broadcast raw IPv6 addresses.
  if (normalizedHost.includes(":")) {
    return "Private Server";
  }

  return normalizedHost;
}

function getPresenceState(serverHost, showServer) {
  return showServer ? sanitizeServerForPresence(serverHost) : "Private Server";
}

function parseConnectedServer(message) {
  const match = message.match(/Connecting to\s+([^,\s]+),\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return { host: match[1], port: match[2] };
}

function extractGameInfoFromCmdline(cmdline, showServer) {
  if (!cmdline) return { version: "Minecraft", state: "Private Server" };

  let version = "Minecraft";
  const mVersion = cmdline.match(/--version\s+"([^"]+)"/) || cmdline.match(/--version\s+([^\s"']+)/);
  if (mVersion) version = mVersion[1];

  let host = "";
  const mQuickPlay = cmdline.match(/--quickPlayMultiplayer\s+"?([^\s:"]+)/);
  if (mQuickPlay) {
    host = mQuickPlay[1];
  } else {
    const mServer = cmdline.match(/--server\s+([^\s"']+)/);
    if (mServer) host = mServer[1];
  }

  return {
    version: formatVersion(version),
    state: host ? getPresenceState(host, showServer) : "Private Server"
  };
}

module.exports = {
  isValidUrl,
  buildDiscordButtons,
  formatVersion,
  isIpv4,
  isPrivateOrLocalIpv4,
  sanitizeServerForPresence,
  getPresenceState,
  parseConnectedServer,
  extractGameInfoFromCmdline
};
