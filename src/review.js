// When to ask a player for a review, and the anonymous id the website uses to allow one review
// per player. The first ask comes after the second real play session, never the first.

const crypto = require("crypto");

const MIN_SESSION_MS = 2 * 60 * 1000; // shorter games (crashes, quick checks) don't count
const FIRST_ASK_SESSION = 2;
const ASK_AGAIN_AFTER = 5; // sessions after a "Not now"
const MAX_ASKS = 2;

// One-way: the website can tell players apart but never learns the Minecraft account id.
function playerId(uuid) {
  const clean = String(uuid || "").replace(/-/g, "").toLowerCase();
  return crypto.createHash("sha256").update(`legends-review:${clean}`).digest("hex");
}

function normalizeState(state) {
  return { sessions: 0, asks: 0, lastAskSession: 0, reviewed: false, ...state };
}

// Records a finished play session; returns the new state and whether to ask for a review now.
function recordSession(state, playedMs) {
  const next = normalizeState(state);
  if (next.reviewed || !(playedMs >= MIN_SESSION_MS)) {
    return { state: next, ask: false };
  }
  next.sessions += 1;
  const ask =
    next.sessions >= FIRST_ASK_SESSION &&
    next.asks < MAX_ASKS &&
    (next.asks === 0 || next.sessions - next.lastAskSession >= ASK_AGAIN_AFTER);
  if (ask) {
    next.asks += 1;
    next.lastAskSession = next.sessions;
  }
  return { state: next, ask };
}

module.exports = { playerId, normalizeState, recordSession, MIN_SESSION_MS };
