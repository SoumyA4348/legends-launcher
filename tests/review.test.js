const test = require("node:test");
const assert = require("node:assert/strict");
const { playerId, recordSession, joinSession, newServerId, MIN_SESSION_MS } = require("../src/review");

const PLAYED = MIN_SESSION_MS + 1000;

function play(state, times, playedMs = PLAYED) {
  const asks = [];
  for (let i = 0; i < times; i++) {
    const result = recordSession(state, playedMs);
    state = result.state;
    asks.push(result.ask);
  }
  return { state, asks };
}

test("first ask comes after the second session, then once more five sessions later", () => {
  const { asks } = play({}, 14);
  assert.deepEqual(
    asks.map((ask, i) => (ask ? i + 1 : null)).filter(Boolean),
    [2, 7]
  );
});

test("short sessions don't count and reviewed players are never asked", () => {
  assert.deepEqual(play({}, 5, 30 * 1000).asks, [false, false, false, false, false]);
  assert.equal(play({}, 5, 30 * 1000).state.sessions, 0);
  assert.deepEqual(play({ reviewed: true }, 10).asks.filter(Boolean), []);
});

test("playerId is a stable one-way hash that ignores dashes and case", () => {
  const id = playerId("069a79f4-44e9-4726-a5be-fca90e38aaf5");
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id, playerId("069A79F444E94726A5BEFCA90E38AAF5"));
  assert.notEqual(id, playerId("853c80ef3c3749fdaa49938b674adae6"));
  assert.ok(!id.includes("069a79f4"));
});

// A review is only accepted once Mojang confirms the player owns the account: the launcher
// "joins" a one-off server id, and the website asks Mojang whether this username did.
test("joinSession hands Mojang the token, the account id without dashes and a fresh server id", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 204 };
  };
  const serverId = newServerId();
  assert.match(serverId, /^[0-9a-f]{40}$/);
  assert.notEqual(newServerId(), serverId);
  await joinSession({ accessToken: "token", uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", serverId }, { fetchImpl });
  assert.equal(calls[0].url, "https://sessionserver.mojang.com/session/minecraft/join");
  assert.deepEqual(calls[0].body, { accessToken: "token", selectedProfile: "069a79f444e94726a5befca90e38aaf5", serverId });
});

test("joinSession fails at once when Mojang refuses the account", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: false, status: 403 };
  };
  const error = await joinSession({ accessToken: "t", uuid: "u", serverId: "s" }, { fetchImpl, baseDelayMs: 0 }).catch((e) => e);
  assert.equal(error.statusCode, 403);
  assert.equal(calls, 1);
});
