// A tiny Chaos Monkey for the launcher's network layer. Netflix's Chaos Monkey kills production
// servers on purpose so weak spots show up before users find them:
// https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116
// This version fails a share of the launcher's own requests instead. It is off unless
// LEGENDS_CHAOS is set (LEGENDS_CHAOS=0.3 fails ~30% of requests), so normal runs never see it.

const FAULTS = ["reset", "timeout", "server-error"];

function parseRate(value) {
  const rate = Number.parseFloat(value);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 1) : 0;
}

function makeFault(kind, url) {
  if (kind === "server-error") {
    const error = new Error(`Chaos: injected 503 for ${url}`);
    error.statusCode = 503;
    return error;
  }
  const error = new Error(`Chaos: injected ${kind === "reset" ? "connection reset" : "timeout"} for ${url}`);
  error.code = kind === "reset" ? "ECONNRESET" : "ETIMEDOUT";
  return error;
}

// wrap(name, fn) returns fn untouched when chaos is off; otherwise a `rate` share of calls
// throw a network-style error before fn runs. fn must take the URL as its first argument.
function createChaos({ rate = parseRate(process.env.LEGENDS_CHAOS), random = Math.random, log = console.warn } = {}) {
  const wrap = (name, fn) => {
    if (rate === 0) return fn;
    return async (url, ...rest) => {
      if (random() < rate) {
        const kind = FAULTS[Math.floor(random() * FAULTS.length)];
        log(`[chaos] ${name}: ${kind} for ${url}`);
        throw makeFault(kind, url);
      }
      return fn(url, ...rest);
    };
  };
  return { rate, wrap };
}

module.exports = { createChaos, parseRate, FAULTS };
