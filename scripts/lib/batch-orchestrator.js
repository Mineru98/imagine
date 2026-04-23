'use strict';

const { shouldRetry } = require('./retry-policy.js');

// ── Contract ────────────────────────────────────────────────────────────────
// runBatch(tasks, runFn, options?) → Promise<BatchReport>
//   tasks:     any[]                                 — each is handed verbatim to runFn.
//   runFn:     (task, ctx) => Promise<any>           — user-provided worker.
//                                                     ctx = { index, attempt }.
//   options = {
//     concurrency?: number,                          // default 1, max 2.
//     onProgress?:  (done: number, total: number, lastResult?) => void,
//   }
//
//   BatchReport = {
//     ok:        boolean,       // true iff every task resolved
//     total:     number,
//     success:   { index, task, result }[],
//     failures:  { index, task, error, reason, attempts }[],
//     warnings:  string[],      // e.g. concurrency clamp notices
//     concurrency_used: number,
//   }
//
// Policy:
//   - Hard cap at concurrency=2. Requests to go higher are clamped with a
//     console.warn so the caller knows image-level parallelism was limited.
//   - Retries are delegated to `scripts/lib/retry-policy.js`. On a 429, the
//     *entire* batch pauses (all workers wait) — not just the offending task —
//     so queued peers don't keep adding pressure while we're already rate-limited.
//   - On 401 / 403, the batch fails fast: we don't drain the queue into an
//     auth-locked account. Remaining tasks are recorded in `failures` with
//     reason `auth_blocked_batch_halt`.
//   - One image per slot. Agents inside a single image (vision / layout /
//     tokens / assets / a11y) run in parallel INSIDE runFn, never across it.
// ────────────────────────────────────────────────────────────────────────────

const MAX_CONCURRENCY = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isAuthError(error) {
  if (!error) return false;
  const s = error.status || error.statusCode || (error.response && error.response.status);
  return s === 401 || s === 403;
}

function isRateLimited(error) {
  if (!error) return false;
  const s = error.status || error.statusCode || (error.response && error.response.status);
  return s === 429;
}

async function runBatch(tasks, runFn, options = {}) {
  if (!Array.isArray(tasks)) {
    throw new Error('runBatch: tasks must be an array');
  }
  if (typeof runFn !== 'function') {
    throw new Error('runBatch: runFn must be a function');
  }

  const warnings = [];
  let concurrency = Number.isInteger(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : 1;
  if (concurrency > MAX_CONCURRENCY) {
    const msg = `batch-orchestrator: concurrency ${concurrency} requested but clamped to ${MAX_CONCURRENCY}. Image-level parallelism is capped to prevent n=8-style quota bursts.`;
    console.warn(msg);
    warnings.push(msg);
    concurrency = MAX_CONCURRENCY;
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const total = tasks.length;
  const success = [];
  const failures = [];

  let cursor = 0;
  let pausedUntil = 0;    // epoch ms until which all workers must wait.
  let authHalt = null;    // when set, drain the queue into failures and stop.

  const takeNext = () => {
    if (authHalt) return -1;
    const i = cursor;
    if (i >= total) return -1;
    cursor = i + 1;
    return i;
  };

  const runTask = async (index) => {
    let attempt = 0;
    while (true) {
      // Honor any batch-wide pause before touching the network.
      const now = Date.now();
      if (pausedUntil > now) {
        await sleep(pausedUntil - now);
      }
      if (authHalt) {
        return { kind: 'failure', error: authHalt.error, reason: 'auth_blocked_batch_halt', attempts: attempt };
      }
      try {
        const result = await runFn(tasks[index], { index, attempt });
        return { kind: 'success', result };
      } catch (err) {
        if (isAuthError(err)) {
          // Halt the whole batch. Other in-flight tasks will bail on their
          // next loop iteration via the authHalt check.
          authHalt = { error: err };
          const decision = shouldRetry(err, attempt);
          return { kind: 'failure', error: err, reason: decision.reason, attempts: attempt + 1 };
        }

        const decision = shouldRetry(err, attempt);
        if (!decision.retry) {
          return { kind: 'failure', error: err, reason: decision.reason, attempts: attempt + 1 };
        }

        if (isRateLimited(err)) {
          // Propagate the wait to every worker in the pool.
          const until = Date.now() + decision.delayMs;
          if (until > pausedUntil) pausedUntil = until;
        } else if (decision.delayMs > 0) {
          await sleep(decision.delayMs);
        }
        attempt += 1;
      }
    }
  };

  const worker = async () => {
    while (true) {
      const index = takeNext();
      if (index < 0) return;
      const outcome = await runTask(index);
      if (outcome.kind === 'success') {
        success.push({ index, task: tasks[index], result: outcome.result });
      } else {
        failures.push({
          index,
          task: tasks[index],
          error: outcome.error,
          reason: outcome.reason,
          attempts: outcome.attempts,
        });
      }
      if (onProgress) {
        try {
          onProgress(success.length + failures.length, total, outcome);
        } catch (cbErr) {
          warnings.push(`onProgress callback threw: ${cbErr && cbErr.message ? cbErr.message : cbErr}`);
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, () => worker());
  await Promise.all(workers);

  return {
    ok: failures.length === 0,
    total,
    success,
    failures,
    warnings,
    concurrency_used: concurrency,
  };
}

module.exports = {
  runBatch,
  MAX_CONCURRENCY,
};
