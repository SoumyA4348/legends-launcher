// Masks sign-in secrets in log lines before they reach the console, where players copy logs
// into public bug reports. Minecraft 1.8-1.12 print the session token on start-up, and the
// game's launch arguments carry the access token too.

const PATTERNS = [
  [/(--accessToken\s+)\S+/gi, "$1[redacted]"],
  [/(--xuid\s+)\S+/gi, "$1[redacted]"],
  [/(Session ID is token:)[^\s)]+/gi, "$1[redacted]"],
  // Minecraft access tokens are JWTs: three base64url parts starting with "eyJ".
  [/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[redacted]"]
];

// `secrets` are exact values to mask as well, such as the signed-in account's tokens.
function redactSecrets(line, secrets = []) {
  let text = String(line);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) text = text.split(secret).join("[redacted]");
  }
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

module.exports = { redactSecrets };
