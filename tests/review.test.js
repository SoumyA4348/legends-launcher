const test = require("node:test");
const assert = require("node:assert/strict");
const { playerId, recordSession, MIN_SESSION_MS } = require("../src/review");

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
