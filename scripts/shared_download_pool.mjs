// One browser-record observer; independent workers click through their own Pages.
// No SDK download objects, per-paper event ownership, or filename assignment.
import {randomUUID} from 'node:crypto';
import {mkdir, open, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {withDownloadCapture} from './capture_lock.mjs';
import {assertDownloadsPageCompatible, downloadRecordIds, readDownloadHistory} from './collect_downloads.mjs';
import {persistCandidate} from './persist_candidate.mjs';

const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
async function atomicJSON(path, data) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2), {flag:'wx'});
    for (let attempt=0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (error) {
        // Windows can briefly deny replacement while another reader/security
        // tool holds the target. Keep atomic replacement and bound the retry.
        if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt>=4) throw error;
        await pause(10 * 2 ** attempt);
      }
    }
  } finally {await rm(temporary,{force:true});}
}
async function exclusiveJSON(path, data) {
  // A claim reserves the name; readers only see the complete atomic JSON file.
  const handle = await open(path+'.claim', 'wx');
  await handle.close();
  await atomicJSON(path,data);
}
async function entries(directory) {
  return Promise.all((await readdir(directory)).filter(n => n.endsWith('.json')).map(n => readJSON(join(directory,n))));
}
async function sessionAt(sessionPath) {
  if (typeof sessionPath !== 'string' || !isAbsolute(sessionPath)) throw new TypeError('sessionPath must be absolute');
  const session = await readJSON(sessionPath);
  const lease = await readJSON(session.capture_lock.path);
  if (lease.lease_id !== session.capture_lock.lease_id) throw new Error('pool_lease_mismatch');
  return session;
}
async function accepting(dir) {
  if ((await readJSON(join(dir,'control.json'))).state !== 'accepting') return false;
  try { await readJSON(join(dir,'closed.json')); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

export async function startDownloadPool({recordsPage, outputDir, browserVersion, workers,
  allowedOrigins, baselineIds, lockPath} = {}) {
  if (recordsPage) await assertDownloadsPageCompatible(recordsPage);
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir)) throw new TypeError('outputDir must be absolute');
  if (!Array.isArray(workers) || !workers.length || workers.some(w => !safeId(w))
      || new Set(workers).size !== workers.length) throw new TypeError('Unique worker IDs required');
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; }
    catch { return true; }
  })) throw new TypeError('Explicit HTTPS origins required');
  const sessionPath = join(outputDir, 'session.json');
  const result = await withDownloadCapture(async () => {
    // A new directory prevents merging attempts or silently replacing evidence.
    await mkdir(outputDir);
    await mkdir(join(outputDir,'attempts'));
    await mkdir(join(outputDir,'worker-exits'));
    const baseline = baselineIds ?? await downloadRecordIds(recordsPage);
    await atomicJSON(join(outputDir,'control.json'), {state:'initializing'});
    return {capture_status:'pool_started', session:{pool_id:randomUUID(), output_dir:outputDir,
      started_ms:Date.now(), baseline_ids:baseline, workers, allowed_origins:allowedOrigins}};
  }, lockPath === undefined ? {} : {lockPath});
  if (result.capture_status !== 'pool_started') return result;
  await exclusiveJSON(sessionPath, {...result.session, capture_lock:result.capture_lock});
  await atomicJSON(join(outputDir,'control.json'), {state:'accepting'});
  return {capture_status:'pool_started', session_path:sessionPath, capture_lock:result.capture_lock};
}

// Invoke inside the worker's ego CLI. Register before clicking; never use an SDK
// download wait/path/saveAs in trigger. The worker retains its own Page ownership.
export async function triggerPoolDownload({sessionPath, workerId, attemptId, paperKey, trigger} = {}) {
  const session = await sessionAt(sessionPath), dir = session.output_dir;
  if (!session.workers.includes(workerId) || !safeId(attemptId) || !safeId(paperKey)
      || typeof trigger !== 'function') throw new TypeError('Registered worker and unique attempt required');
  if (!await accepting(dir)) throw new Error('pool_not_accepting');
  const exited = await readdir(join(dir,'worker-exits'));
  if (exited.includes(workerId+'.json')) throw new Error('worker_already_finished');
  const attemptPath = join(dir,'attempts',attemptId+'.json');
  const record = {attempt_id:attemptId, worker_id:workerId, paper_key:paperKey,
    started_ms:Date.now(), state:'triggering'};
  await exclusiveJSON(attemptPath, record);
  // Stop newly queued clicks if the collector lost browser control meanwhile.
  if (!await accepting(dir)) {
    await atomicJSON(attemptPath,{...record,state:'not_triggered'});
    return {state:'not_triggered', attempt_id:attemptId};
  }
  try {
    await trigger();
    record.state = 'trigger_returned';
  } catch {
    // A failed action can still have started a download. Observe; do not retry here.
    record.state = 'trigger_error';
  }
  record.returned_ms = Date.now();
  await atomicJSON(attemptPath, record);
  return record;
}

// Call OUTSIDE all of this worker's ego rounds, after their actual CLI exits.
export async function finishPoolWorker({sessionPath, workerId, cliExitConfirmed} = {}) {
  const session = await sessionAt(sessionPath);
  if (!session.workers.includes(workerId) || cliExitConfirmed !== true) throw new Error('worker_cli_exit_required');
  const attempts = (await entries(join(session.output_dir,'attempts'))).filter(a => a.worker_id === workerId);
  if (attempts.some(a => a.state === 'triggering')) throw new Error('worker_trigger_unresolved');
  await exclusiveJSON(join(session.output_dir,'worker-exits',workerId+'.json'),
    {worker_id:workerId,cli_exit_confirmed:true,confirmed_ms:Date.now()});
}

export async function collectDownloadPool({sessionPath, recordsPage, readRecords,
  pollMs=500, discoveryGraceMs=5_000, idleTimeoutMs=90_000, maxWaitMs=null} = {}) {
  for (const value of [pollMs,discoveryGraceMs,idleTimeoutMs,...(maxWaitMs === null ? [] : [maxWaitMs])]) {
    if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) throw new TypeError('Invalid pool budget');
  }
  const session = await sessionAt(sessionPath), dir = session.output_dir;
  if (recordsPage) await assertDownloadsPageCompatible(recordsPage);
  // Retained marker prevents a second observer or blind replay after an error.
  await exclusiveJSON(join(dir,'observer.json'),{started_ms:Date.now()});
  const seen = new Map(), candidates = new Map(), rejected = new Map(), quarantined = new Map();
  const read = readRecords ?? (() => readDownloadHistory(recordsPage,session.baseline_ids,{
    requiredIds:[...seen.values()].filter(r=>r.state==='pending').map(r=>r.id),
  }));
  let ended = null, lastDiscovery = Date.now(), failure = null, attempts = [], exits = [];
  const snapshot = () => ({capture_status:failure ? 'partial_pool' : ended ? 'pool_collected' : 'collecting',
    pool_id:session.pool_id, started_ms:session.started_ms, ended_ms:ended,
    candidates:[...candidates.values()], records:[...seen.values()],
    rejected_records:[...rejected.values()], quarantined_records:[...quarantined.values()],
    attempts, worker_exits:exits, failure_reason:failure, capture_lock:session.capture_lock,
    round_exit_required:true});
  try {
    while (true) {
      await sessionAt(sessionPath);
      if (!await accepting(dir)) {
        failure = 'pool_paused';
        break;
      }
      attempts = await entries(join(dir,'attempts'));
      exits = await entries(join(dir,'worker-exits'));
      let rows;
      try { rows = await read(); }
      catch { failure = 'downloads_ui_observation_failed'; break; }
      const now = Date.now();
      const startedAttempts = attempts.filter(a => a.state !== 'not_triggered');
      const firstClick = Math.min(...startedAttempts.map(a => a.started_ms));
      for (const row of rows) {
        if (session.baseline_ids.includes(row.id)) continue;
        const previous = seen.get(row.id);
        // Check already-seen identities before scope filtering: a changed origin
        // or timestamp must withdraw a saved copy even when now out of scope.
        const changed = previous && (previous.started_ms !== row.started_ms || previous.origin !== row.origin
          || previous.source_path !== row.source_path || (previous.state === 'completed'
          && (previous.file_path !== row.file_path || previous.total_bytes !== row.total_bytes || row.state !== 'completed')));
        if (changed) {
          rejected.set(row.id,{id:row.id,reason:'record_changed',original:previous,observed:row});
          candidates.delete(row.id);
          continue;
        }
        if (rejected.get(row.id)?.reason === 'record_changed') continue;
        const eligible = typeof row.id === 'string' && row.id
          && Number.isFinite(row.started_ms) && row.started_ms >= session.started_ms - 2000
          && row.started_ms >= firstClick - 2000 && row.started_ms <= now + 2000
          && session.allowed_origins.includes(row.origin) && row.removed === false;
        if (!eligible) { quarantined.set(row.id,{...row,reason:'outside_pool_scope'}); continue; }
        quarantined.delete(row.id);
        const grew = !previous || Number(row.received_bytes) > Number(previous.received_bytes ?? 0);
        if (!previous) lastDiscovery = now;
        const current = {...row,last_growth_ms:grew ? now : previous.last_growth_ms,
          first_seen_ms:previous?.first_seen_ms ?? now};
        seen.set(row.id,current);
        if (candidates.has(row.id)) continue;
        if (row.state === 'interrupted') {
          rejected.set(row.id,{id:row.id,reason:'download_interrupted',record:row});
          continue;
        }
        if (row.state !== 'completed') continue;
        if (!Number.isSafeInteger(row.total_bytes) || row.total_bytes <= 0 || !isAbsolute(row.file_path ?? '')) {
          rejected.set(row.id,{id:row.id,reason:'invalid_completed_record',record:row});
          continue;
        }
        try {
          const saved = await persistCandidate(row.file_path,join(dir,'candidates'),{expectedBytes:row.total_bytes});
          candidates.set(row.id,{...saved,receipt_id:row.id,event_guid:null,
            completion_evidence:'shared_pool_ui_completed',audit:{source_attempt:session.pool_id,
              pool_id:session.pool_id,new_record_ids:[row.id],cli_exit_confirmed:false,
              attempt_started_ms:session.started_ms,attempt_ended_ms:now,record:{...row}}});
          rejected.delete(row.id);
          await atomicJSON(join(dir,'collection.json'),snapshot());
        } catch {
          // Retry copying the same receipt within its idle budget; never re-click.
          rejected.set(row.id,{id:row.id,reason:'candidate_persistence_pending',record:row});
        }
      }
      // Missing DOM rows remain tracked; disappearance is never completion.
      const unsettled = [...seen.values()].filter(row => !candidates.has(row.id)
        && !['record_changed','download_interrupted','invalid_completed_record','download_stalled',
          'candidate_persistence_failed'].includes(rejected.get(row.id)?.reason));
      for (const row of unsettled) {
        if (now - row.last_growth_ms >= idleTimeoutMs) rejected.set(row.id,{id:row.id,
          reason:row.state === 'completed' ? 'candidate_persistence_failed' : 'download_stalled',record:row});
      }
      const allExited = session.workers.every(w => exits.some(e => e.worker_id === w && e.cli_exit_confirmed));
      const lastExit = Math.max(session.started_ms,...exits.map(e => e.confirmed_ms));
      const stillActive = [...seen.keys()].some(id => !candidates.has(id) && !rejected.has(id)
        || rejected.get(id)?.reason === 'candidate_persistence_pending');
      if (allExited && now - Math.max(lastExit,lastDiscovery) >= discoveryGraceMs && !stillActive) break;
      if (maxWaitMs !== null && now - session.started_ms >= maxWaitMs) { failure='diagnostic_limit_reached'; break; }
      await atomicJSON(join(dir,'collection.json'),snapshot());
      await pause(pollMs);
    }
  } catch { failure = 'pool_observation_failed'; }
  ended = Date.now();
  if (rejected.size || quarantined.size) failure ??= 'pool_records_unresolved';
  // The observer owns its closure record, never the coordinator's pause file.
  // Fence new triggers first, then check pauses received during the final read.
  const closedPath = join(dir,'closed.json');
  await exclusiveJSON(closedPath,{state:'closing',ended_ms:ended});
  if ((await readJSON(join(dir,'control.json'))).state !== 'accepting') failure ??= 'pool_paused';
  await atomicJSON(closedPath,{state:failure ? 'paused' : 'sealed',ended_ms:ended,failure_reason:failure});
  const result = snapshot();
  await atomicJSON(join(dir,'collection.json'),result);
  return result;
}

// Caller confirms the observer CLI really exited. Worker exit markers were
// written separately after each worker's actual CLI exit. Lease stays retained.
export async function finalizeDownloadPool({sessionPath, collectorCliExitConfirmed} = {}) {
  const session = await sessionAt(sessionPath), dir = session.output_dir;
  if (collectorCliExitConfirmed !== true) throw new Error('collector_cli_exit_required');
  const exits = await entries(join(dir,'worker-exits'));
  if (!session.workers.every(w => exits.some(e => e.worker_id === w && e.cli_exit_confirmed))) {
    throw new Error('worker_cli_exit_required');
  }
  const result = await readJSON(join(dir,'collection.json'));
  if (!result.ended_ms) throw new Error('collector_not_ended');
  for (const candidate of result.candidates) candidate.audit.cli_exit_confirmed = true;
  result.cli_exit_confirmed = true;
  await atomicJSON(join(dir,'result.json'),result);
  return result;
}
