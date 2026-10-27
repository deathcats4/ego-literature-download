import {randomUUID} from 'node:crypto';
import {mkdir, open, readFile, unlink} from 'node:fs/promises';
import {dirname, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DEFAULT_CAPTURE_LOCK = fileURLToPath(new URL('../runtime/download-capture.lock', import.meta.url));

function checkPath(lockPath) {
  if (typeof lockPath !== 'string' || !isAbsolute(lockPath)) {
    throw new TypeError('lockPath must be an absolute path');
  }
}

// Call only after the owning CLI has exited and its pending capture is resolved.
// A PID reported inside an ego script can belong to the host, not the CLI.
export async function releaseDownloadCapture({lockPath = DEFAULT_CAPTURE_LOCK, leaseId} = {}) {
  checkPath(lockPath);
  if (typeof leaseId !== 'string' || !leaseId) throw new TypeError('leaseId is required');
  const owner = JSON.parse(await readFile(lockPath, 'utf8'));
  if (owner.lease_id !== leaseId) throw new Error('capture lock owner does not match');
  await unlink(lockPath);
}

// The callback must include event subscription, click, and save. Identity can
// be checked here or after CLI exit, before release. Workers share one path.
export async function withDownloadCapture(operation, {lockPath = DEFAULT_CAPTURE_LOCK} = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function');
  checkPath(lockPath);
  await mkdir(dirname(lockPath), {recursive:true});
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return {capture_status:'capture_busy', capture_lock:{status:'busy', path:lockPath}};
  }

  const leaseId = randomUUID();
  // If writing fails, leave the partial lock in place. No browser callback has
  // run, but another worker must not guess whether this lease is safe to erase.
  try {
    await handle.writeFile(JSON.stringify({lease_id:leaseId, acquired_at:new Date().toISOString()}));
  } finally {
    await handle.close();
  }

  let result;
  try {
    result = await operation();
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('capture callback must return an object');
    }
  } catch {
    // SDK errors can embed signed URLs; preserve the failure boundary, not the
    // raw exception. The owner must inspect its round before explicit cleanup.
    result = {capture_status:'capture_failed', failure_reason:'capture_callback_error', round_exit_required:true};
  }

  const verified = result.capture_status === 'saved_candidate'
    && result.identity_match === true
    && (result.identity_status === undefined || result.identity_status === 'matched')
    && result.round_exit_required !== true;
  // Keep the lease even on success: disposing this ego round can still clean
  // up browser download state. The coordinator releases it after CLI exit.
  return {...result, capture_lock:{status:'retained', path:lockPath, lease_id:leaseId, identity_verified:verified}};
}
