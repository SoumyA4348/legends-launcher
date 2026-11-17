// A dropped connection, timeout or 5xx gets more tries with a short backoff. A 4xx (except 429)
// is a real answer and fails at once. Only for requests that are safe to repeat.
async function withRetry(attemptFn, { attempts = 3, baseDelayMs = 400 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptFn();
    } catch (error) {
      const permanent = error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429;
      if (permanent || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}

module.exports = { withRetry };
