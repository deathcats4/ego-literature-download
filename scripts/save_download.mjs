// Import inside an ego CLI round after obtaining its download artifact.
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {stat} from 'node:fs/promises';

class SaveTimeout extends Error {}

class SaveStopped extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function cancellationErrorKind(error) {
  // Return fixed labels only. SDK exception text can contain signed URLs.
  const message = typeof error?.message === 'string'
    ? error.message.replace(/\bhttps?:\/\/\S+/gi, '') : '';
  if (/not implemented|not supported|unsupported/i.test(message)) return 'unsupported';
  if (/Browser\.cancelDownload/.test(message)) return 'browser_cancel_error';
  return 'unknown';
}

async function bounded(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SaveTimeout()), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveDownload(download, outputPath, {
  timeoutMs = null, idleTimeoutMs = 90_000, cancelTimeoutMs = 5_000,
  pollMs = 250, observeProgress = null, expectedBytes = null,
} = {}) {
  if (!isAbsolute(outputPath)) throw new TypeError('outputPath must be absolute');
  for (const value of [idleTimeoutMs, cancelTimeoutMs, pollMs, ...(timeoutMs === null ? [] : [timeoutMs])]) {
    if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
      throw new TypeError('Timeouts must be positive 32-bit integers');
    }
  }
  if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0)) {
    throw new TypeError('expectedBytes must be a positive integer byte count');
  }
  if (observeProgress !== null && typeof observeProgress !== 'function') throw new TypeError('observeProgress must be a function');
  const started = Date.now();
  let lastGrowth = started, received = 0, localBytes = 0, total = 0, done = false;
  let wake;
  const stopped = new Promise(resolve => { wake = resolve; });
  const wait = async milliseconds => {
    let timer;
    try {
      await Promise.race([stopped, new Promise(resolve => {timer = setTimeout(resolve, milliseconds);})]);
    } finally {clearTimeout(timer);}
  };
  const observe = async (read, update) => {
    while (!done) {
      try {
        const value = await read();
        if (done) return; // A late read must not restart work after this round ends.
        update(value);
      } catch (error) {
        if (done) return;
        throw error instanceof SaveStopped ? error : new SaveStopped('progress_observation_failed');
      }
      await wait(pollMs);
    }
  };
  try {
    const saving = Promise.resolve().then(() => download.saveAs(outputPath));
    // The watchdog never awaits browser progress or filesystem observations.
    // Separate samplers also let local file growth extend idle time when a
    // browser progress call hangs. Timers still cannot abort an SDK operation.
    const monitoring = [observe(() => stat(outputPath).then(s => s.size, () => 0), size => {
      if (size > localBytes) lastGrowth = Date.now();
      localBytes = Math.max(localBytes, size);
    })];
    if (observeProgress) monitoring.push(observe(observeProgress, progress => {
      if (Number(progress?.receivedBytes) > received) lastGrowth = Date.now();
      received = Math.max(received, Number(progress?.receivedBytes) || 0);
      total = Math.max(total, Number(progress?.totalBytes) || 0);
      if (progress?.state === 'canceled') throw new SaveStopped('download_canceled');
    }));
    const watchdog = (async () => {
      while (!done) {
        if (timeoutMs !== null && Date.now() - started >= timeoutMs) throw new SaveTimeout();
        if (Date.now() - lastGrowth >= idleTimeoutMs) {
          // The sampler can be delayed by synchronous filesystem work in the
          // host process. Take one fresh reading at the deadline so a file that
          // grew during that gap renews the idle window instead of being
          // canceled as stalled.
          const freshBytes = await stat(outputPath).then(s => s.size, () => 0);
          if (freshBytes > localBytes) {
            localBytes = freshBytes;
            lastGrowth = Date.now();
            continue;
          }
          throw new SaveStopped(total > 0 && received >= total ? 'save_finalization_timeout' : 'save_idle_timeout');
        }
        await wait(Math.min(lastGrowth + idleTimeoutMs - Date.now(),
          timeoutMs === null ? Infinity : started + timeoutMs - Date.now()));
      }
    })();
    try {
      await Promise.race([saving, watchdog, ...monitoring]);
    } finally {
      done = true;
      wake();
    }
    // A resolved saveAs is not proof of a complete file: the browser can settle a
    // transfer that stopped early. Compare the saved bytes with the server's own
    // total when either the caller supplied it or the browser progress did.
    const savedBytes = await stat(outputPath).then(s => s.size, () => 0);
    const expected = expectedBytes ?? (total > 0 ? total : null);
    if (expected !== null && savedBytes !== expected) {
      return { capture_status: 'capture_failed', candidate_path: outputPath,
               candidate_exists: existsSync(outputPath), failure_reason: 'save_size_mismatch',
               saved_bytes: savedBytes, expected_bytes: expected, round_exit_required: false,
               elapsed_ms: Date.now() - started };
    }
    return { capture_status: 'saved_candidate', candidate_path: outputPath, candidate_bytes: savedBytes,
             round_exit_required: false, elapsed_ms: Date.now() - started };
  } catch (error) {
    let cancelStatus;
    let cancelErrorKind = null;
    try {
      await bounded(() => download.cancel(), cancelTimeoutMs);
      cancelStatus = 'completed';
    } catch (cancelError) {
      cancelStatus = cancelError instanceof SaveTimeout ? 'timed_out' : 'failed';
      if (cancelStatus === 'failed') cancelErrorKind = cancellationErrorKind(cancelError);
    }
    // A timer does not cancel saveAs. Even a completed cancel request does not
    // prove the SDK round has exited; the coordinator must confirm process exit.
    return { capture_status: 'capture_failed', candidate_path: outputPath,
             candidate_exists: existsSync(outputPath),
             failure_reason: error instanceof SaveTimeout ? 'save_timeout' : error instanceof SaveStopped ? error.reason : 'save_error',
             cancel_status: cancelStatus, cancel_error_kind: cancelErrorKind, round_exit_required: true,
             elapsed_ms: Date.now() - started };
  }
}
