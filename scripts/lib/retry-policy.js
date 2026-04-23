'use strict';

// ── Contract ────────────────────────────────────────────────────────────────
// shouldRetry(error, attemptCount) → { retry, delayMs, reason }
//
// Policy (see README / design docs — these rules are NOT negotiable per call):
//   401 / 403  → retry:false. Emit re-login guidance. Repeating auth-failed
//                requests without a re-login can trigger account lock, so this
//                is an absolute no-retry regardless of attemptCount.
//   429        → retry:true. Exponential backoff delayMs = 1000 * 2^attempt,
//                capped at 30_000 ms. Also suggest reducing `n` to shed load.
//   stream interruption → retry:true exactly ONCE (attemptCount === 0),
//                delayMs:0. Subsequent interruptions mean a persistent
//                connection issue and should bubble up to the user.
//   anything else → retry:false (let the caller decide what to do).
//
// Hard ceiling: MAX_ATTEMPTS = 3. Even a retryable class returns retry:false
// once attemptCount >= MAX_ATTEMPTS so runaway loops are impossible.
// ────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

function extractStatus(error) {
  if (!error) return null;
  if (typeof error.status === 'number') return error.status;
  if (typeof error.statusCode === 'number') return error.statusCode;
  if (error.response && typeof error.response.status === 'number') return error.response.status;
  // Node's fetch-like errors sometimes surface as strings in `message`.
  const msg = typeof error.message === 'string' ? error.message : '';
  const m = msg.match(/\b(4\d\d|5\d\d)\b/);
  if (m) return Number(m[1]);
  return null;
}

function isStreamInterruption(error) {
  if (!error) return false;
  const name = error.name || '';
  const code = error.code || '';
  if (name === 'AbortError') return true;
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || code === 'UND_ERR_SOCKET') return true;
  const msg = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (/stream (?:was )?(?:interrupted|aborted|closed)/i.test(msg)) return true;
  if (/premature close|socket hang up|connection reset/i.test(msg)) return true;
  return false;
}

function clampDelay(ms) {
  return Math.max(0, Math.min(BACKOFF_CAP_MS, Math.round(ms)));
}

function shouldRetry(error, attemptCount) {
  const attempt = Number.isInteger(attemptCount) && attemptCount >= 0 ? attemptCount : 0;

  if (attempt >= MAX_ATTEMPTS) {
    return {
      retry: false,
      delayMs: 0,
      reason: `max_attempts_reached (${MAX_ATTEMPTS})`,
    };
  }

  const status = extractStatus(error);

  // ── 401 / 403: never retry, always guide re-login ──
  if (status === 401 || status === 403) {
    return {
      retry: false,
      delayMs: 0,
      reason:
        status === 401
          ? 'auth_failed_401: OAuth session expired or invalid. Do NOT retry — this can trigger account lock. Run `npx @openai/codex login` to refresh the session, then re-run the command.'
          : 'auth_forbidden_403: OAuth session is authenticated but lacks permission. Do NOT retry — re-login or check account tier. Run `npx @openai/codex login` to refresh, then re-run.',
    };
  }

  // ── 429: retry with exponential backoff, suggest n reduction ──
  if (status === 429) {
    const delayMs = clampDelay(BACKOFF_BASE_MS * Math.pow(2, attempt));
    return {
      retry: true,
      delayMs,
      reason: `rate_limited_429: waiting ${delayMs}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS}). Consider reducing --n (batch size) on the next invocation to lower pressure.`,
    };
  }

  // ── Stream interruption: exactly one immediate retry ──
  if (isStreamInterruption(error)) {
    if (attempt === 0) {
      return {
        retry: true,
        delayMs: 0,
        reason: 'stream_interrupted: transient connection drop — retrying once immediately. Subsequent interruptions will surface to the user.',
      };
    }
    return {
      retry: false,
      delayMs: 0,
      reason: 'stream_interrupted_repeated: persistent connection issue — surfacing to user instead of looping.',
    };
  }

  // ── Anything else: let caller decide; this module never silently retries ──
  return {
    retry: false,
    delayMs: 0,
    reason: `unknown_error_class: no retry policy matched (status=${status !== null ? status : 'n/a'}).`,
  };
}

module.exports = {
  shouldRetry,
  MAX_ATTEMPTS,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
};
