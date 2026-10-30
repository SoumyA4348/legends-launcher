const test = require("node:test");
const assert = require("node:assert/strict");
const { redactSecrets } = require("../src/redact");

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJ4dWlkIjoiMjUzNTQ1In0.c2lnbmF0dXJlLXZhbHVlLWhlcmU";

test("masks the session token old Minecraft versions print on start-up", () => {
  assert.equal(
    redactSecrets("[Client thread/INFO]: (Session ID is token:abc123def456:069a79f444e94726a5befca90e38aaf5)"),
    "[Client thread/INFO]: (Session ID is token:[redacted])"
  );
});

test("masks access tokens and Xbox ids in launch arguments", () => {
  const line = `DEBUG: [MCLC]: Launching with arguments --username Steve --accessToken ${JWT} --xuid 2535412345 --userType msa`;
  const out = redactSecrets(line);
  assert.ok(!out.includes(JWT));
  assert.ok(!out.includes("2535412345"));
  assert.match(out, /--accessToken \[redacted\] --xuid \[redacted\] --userType msa/);
  assert.match(out, /--username Steve/);
});

test("masks bare JWTs and the account's own secrets anywhere in a line", () => {
  assert.equal(redactSecrets(`token=${JWT};`), "token=[redacted];");
  assert.equal(redactSecrets("refresh M.R3_BAY.secret-value-123", ["M.R3_BAY.secret-value-123"]), "refresh [redacted]");
});

test("leaves ordinary log lines and short or missing secrets alone", () => {
  const line = "[Render thread/INFO]: Backend library: LWJGL version 3.3.3";
  assert.equal(redactSecrets(line, [undefined, null, "abc", ""]), line);
  assert.equal(redactSecrets(42), "42");
});
