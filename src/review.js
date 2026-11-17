// When to ask a player for a review, and the anonymous id the website uses to allow one review
// per player. The first ask comes after the second real play session, never the first.

const crypto = require("crypto");
const { createChaos } = require("./chaos");
const { withRetry } = require("./retry");

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

// The website keeps one review per player and answers a repeat with 409, so a POST that may
// already have landed is safe to send again. 409 and 429 come back as answers, not errors.
const chaos = createChaos();
async function submitReview(url, payload, { fetchImpl = fetch, attempts = 3, baseDelayMs = 400 } = {}) {
  const post = chaos.wrap("submitReview", fetchImpl);
  return withRetry(
    async () => {
      const res = await post(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      if (res.status >= 500) {
        throw Object.assign(new Error(`Review server answered ${res.status}`), { statusCode: res.status });
      }
      return res;
    },
    { attempts, baseDelayMs }
  );
}

module.exports = { playerId, normalizeState, recordSession, submitReview, MIN_SESSION_MS };
