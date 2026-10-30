const test = require("node:test");
const assert = require("node:assert/strict");
const analytics = require("../src/analytics");

test("hostForKey picks the region and rejects bad keys", () => {
  assert.equal(analytics.hostForKey("A-US-1234567890"), "https://us.aptabase.com");
  assert.equal(analytics.hostForKey("A-EU-abc"), "https://eu.aptabase.com");
  assert.equal(analytics.hostForKey(""), null);
  assert.equal(analytics.hostForKey("A-XX-1"), null);
});

test("buckets are coarse", () => {
  assert.equal(analytics.minutesBucket(2 * 60000), "<5m");
  assert.equal(analytics.minutesBucket(45 * 60000), "30-60m");
  assert.equal(analytics.minutesBucket(5 * 3600000), "3h+");
  assert.equal(analytics.ramBucket(16 * 1024 - 300), "16GB");
});

test("sanitizeProps keeps only short primitives with plain keys", () => {
  const out = analytics.sanitizeProps({ mcVersion: "1.21.4", mods: 3, ok: true, bad: { a: 1 }, "x-y": "no", long: "z".repeat(100), nan: NaN });
  assert.deepEqual(out, { mcVersion: "1.21.4", mods: 3, ok: true, long: "z".repeat(40) });
});

test("errorCategory never returns the raw message", () => {
  assert.equal(analytics.errorCategory("Could not reach Modrinth for Sodium: ENOTFOUND"), "network");
  assert.equal(analytics.errorCategory("Java 21 download failed verification"), "java");
  assert.equal(analytics.errorCategory("C:\Users\steve\something odd"), "other");
});

test("track sends only allowed events, only when enabled and configured", () => {
  const sent = [];
  const fetchImpl = (url, init) => {
    sent.push({ url, init });
    return Promise.resolve();
  };
  let enabled = true;
  const client = analytics.createAnalytics({ appKey: "A-US-1", appVersion: "0.1.0", isEnabled: () => enabled, fetchImpl });
  assert.equal(client.track("launch_started", { mcVersion: "1.20.1" }), true);
  assert.equal(client.track("made_up_event"), false);
  enabled = false;
  assert.equal(client.track("launch_started"), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://us.aptabase.com/api/v0/event");
  assert.equal(sent[0].init.headers["App-Key"], "A-US-1");
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.eventName, "launch_started");
  assert.deepEqual(body.props, { mcVersion: "1.20.1" });

  const unconfigured = analytics.createAnalytics({ appKey: "", appVersion: "0.1.0", isEnabled: () => true, fetchImpl });
  assert.equal(unconfigured.track("app_started"), false);
});
