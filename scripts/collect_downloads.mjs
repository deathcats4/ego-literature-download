// Native browser intake. Call inside one ego round; CLI exit and lease release
// remain the coordinator's responsibility. Never arm SDK download waits here.
import {mkdir, writeFile, rename, access} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {withDownloadCapture} from './capture_lock.mjs';
import {persistCandidate} from './persist_candidate.mjs';

const ACCESS_STATES = new Set(['access_unavailable', 'human_verification_required',
  'viewer_requires_save', 'consent_required', 'page_not_ready']);

export async function prepareArticle(page, url, {readySelector, timeoutMs = 15_000} = {}) {
  if (!readySelector) throw new TypeError('An observed readySelector is required');
  let navigationTimedOut = false;
  try { await page.goto(url); }
  catch (error) {
    if (!/timeout/i.test(String(error?.name) + ' ' + String(error?.message))) return {state:'navigation_failed'};
    navigationTimedOut = true;
  }
  try {
    await page.waitForSelector(readySelector, {state:'visible', timeout:timeoutMs});
    return {state:'ready', navigation_timed_out:navigationTimedOut};
  } catch { return {state:'page_not_ready', navigation_timed_out:navigationTimedOut}; }
}

// Version-specific downloads-page adapter. Only IDs of old records cross out
// of the page. URL queries are discarded except the PLOS article DOI.
export async function downloadRecordIds(page) {
  return page.evaluate(() => {
    const root = document.querySelector('downloads-manager')?.shadowRoot;
    if (!root) throw new Error('downloads_ui_unsupported');
    return [...root.querySelectorAll('downloads-item')].map(i => String(i.data.id));
  });
}

export async function readDownloadRecords(page, baselineIds) {
  return page.evaluate(ids => {
    const root = document.querySelector('downloads-manager')?.shadowRoot;
    if (!root) throw new Error('downloads_ui_unsupported');
    return [...root.querySelectorAll('downloads-item')]
      .filter(i => !ids.includes(String(i.data.id))).map(i => {
        const d = i.data;
        const url = new URL(d.url.url ?? d.url);
        const total = Number(d.total);
        const percent = Number(d.percent);
        // Unknown-length transfers can expose bytes only in rendered status
        // text. Ignore rate values and unsupported number/unit formats rather
        // than interpreting a changing speed as transferred bytes.
        let displayed = null;
        const units = {B:1,KB:1024,KiB:1024,MB:1024**2,MiB:1024**2,
          GB:1024**3,GiB:1024**3,TB:1024**4,TiB:1024**4};
        for (const m of String(d.progressStatusText ?? '').matchAll(
          /(^|[^\d.,])([\d.,]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)\b(\s*\/\s*\S+)?/g)) {
          if (m[4]) continue;
          // The first non-rate byte field is received size; a later field may
          // be total size. Never skip an unsupported received number to total.
          if (!/^\d+(?:\.\d+)?$/.test(m[2])) break;
          const bytes = Math.floor(Number(m[2]) * units[m[3]]);
          if (Number.isSafeInteger(bytes) && bytes >= 0) {displayed=bytes;break;}
        }
        const exact = d.received !== undefined && d.received !== null && d.received !== ''
          && Number.isFinite(Number(d.received)) && Number(d.received) >= 0;
        const fractional = total > 0 && percent >= 0 && percent <= 100;
        const source = String(d.state) === '2' ? 'completed' : exact ? 'received_bytes'
          : displayed !== null ? 'displayed_bytes' : fractional ? 'percent' : 'unavailable';
        // All partial values remain growth telemetry, never completion proof.
        const received = source === 'completed' ? total : exact ? Number(d.received)
          : displayed !== null ? displayed : fractional ? Math.floor(total * percent / 100) : 0;
        return {id:String(d.id), file_path:String(d.filePath),
          raw_state:String(d.state),
          state:String(d.state) === '2' ? 'completed' : String(d.state) === '5' ? 'interrupted' : 'pending',
          started_ms:Number(d.started) * 1000, total_bytes:total,
          received_bytes:received, progress_source:source,
          progress_percent:percent, removed:!!d.fileExternallyRemoved,
          origin:url.origin, source_path:url.pathname,
          doi_query:url.origin === 'https://journals.plos.org' ? url.searchParams.get('id') : null};
      });
  }, baselineIds);
}

function positiveBudget(value) {
  return Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

// Sweep the visible virtual list, stopping at the frozen old-record boundary.
// This is UI observation, not access to the browser's private history store.
export async function readDownloadHistory(page, baselineIds, {
  requiredIds = [], maxScrolls = 64, settleMs = 75,
} = {}) {
  if (!Array.isArray(baselineIds) || !Array.isArray(requiredIds)
      || !positiveBudget(maxScrolls) || !positiveBudget(settleMs)) throw new TypeError('Invalid history options');
  const initial = await page.evaluate(() => {
    const c=document.querySelector('downloads-manager')?.shadowRoot?.querySelector('#mainContainer');
    if (!c) throw Error('downloads_ui_history_unsupported');
    const top=c.scrollTop;c.scrollTop=0;return top;
  });
  const seen=new Map();let boundary=false,unchanged=0;
  try {
    for (let index=0;index<maxScrolls;index++) {
      await pause(settleMs);
      const rows=await readDownloadRecords(page,[]);
      for (const row of rows) {
        if (baselineIds.includes(row.id)) {boundary=true;continue;}
        if (!boundary || requiredIds.includes(row.id) || seen.has(row.id)) seen.set(row.id,row);
      }
      const found=requiredIds.every(id=>seen.has(id));
      if (boundary && found) return [...seen.values()];
      const moved=await page.evaluate(() => {
        const c=document.querySelector('downloads-manager')?.shadowRoot?.querySelector('#mainContainer');
        if (!c) throw Error('downloads_ui_history_unsupported');
        const before=c.scrollTop;c.scrollTop+=Math.max(1,c.clientHeight*0.7);
        return c.scrollTop!==before;
      });
      unchanged=moved?0:unchanged+1;
      if (unchanged>=2) {
        if (!found) throw Error('downloads_ui_history_incomplete');
        return [...seen.values()];
      }
    }
    throw Error('downloads_ui_history_incomplete');
  } finally {
    await page.evaluate(top => {
      const c=document.querySelector('downloads-manager')?.shadowRoot?.querySelector('#mainContainer');
      if (!c) throw Error('downloads_ui_history_unsupported');
      c.scrollTop=top;
    },initial);
  }
}

export async function collectDownloads({items, recordsPage, outputDir, browserVersion,
  baselineIds, readRecords, lockPath, startTimeoutMs = 30_000, idleTimeoutMs = 90_000,
  pollMs = 500, maxWaitMs = null} = {}) {
  if (browserVersion !== '0.6.1.13') throw new TypeError('downloads_ui_version_unverified');
  if (typeof outputDir !== 'string' || !isAbsolute(outputDir)) throw new TypeError('outputDir must be absolute');
  if (!Array.isArray(items) || !items.length || new Set(items.map(i => i.key)).size !== items.length
      || items.some(i => !i.key || !i.page)) throw new TypeError('Unique keyed article Pages are required');
  for (const value of [startTimeoutMs, idleTimeoutMs, pollMs, ...(maxWaitMs === null ? [] : [maxWaitMs])]) {
    if (!positiveBudget(value)) throw new TypeError('Invalid download wait budget');
  }
  const result = await withDownloadCapture(async () => {
    await mkdir(outputDir, {recursive:true});
    const checkpointPath = join(outputDir, 'collection.json');
    if (await access(checkpointPath).then(() => true, () => false)) throw new Error('Use a new collection output directory');
    const baseline = baselineIds ?? await downloadRecordIds(recordsPage);
    const read = readRecords ?? (() => readDownloadHistory(recordsPage, baseline));
    const states = items.map(i => ({key:i.key, state:'queued', click_at:null, last_growth:null}));
    const candidates = [], unresolvedCandidates = [], downloads = new Map(), consumed = new Set(), frames = new Map();
    const diagnostics = new Set();
    let records = [], triggersDone = false, observationFailed = false;
    const started = Date.now();
    async function checkpoint(captureStatus) {
      const data = {capture_status:captureStatus, items:states, candidates, unresolved_candidates:unresolvedCandidates,
        downloads:[...downloads.values()], diagnostics:[...diagnostics],
        unattributed_record_ids:records.filter(r => !consumed.has(r.id)).map(r => r.id),
        elapsed_ms:Date.now() - started};
      const temporary = checkpointPath + '.tmp';
      await writeFile(temporary, JSON.stringify(data, null, 2));
      await rename(temporary, checkpointPath);
      return data;
    }
    // Record frames and drain pre-existing buffers before any triggering click.
    for (let index = 0; index < items.length; index++) {
      try {
        const tree = await items[index].page.cdp('Page.getFrameTree');
        const frame = tree.frameTree.frame.id;
        if (!frames.has(frame)) frames.set(frame, []);
        frames.get(frame).push(index);
        await items[index].page.events();
      } catch { states[index].state = 'page_observation_failed'; }
    }
    const triggers = (async () => {
      for (let index = 0; index < items.length; index++) {
        const item = items[index], state = states[index];
        if (state.state !== 'queued') continue;
        if (observationFailed) { state.state = 'observation_failed'; continue; }
        try {
          const prepared = item.prepare ? await item.prepare() : {state:'ready'};
          if (prepared?.state !== 'ready') {
            state.state = ACCESS_STATES.has(prepared?.state) ? prepared.state : 'preparation_failed';
            continue;
          }
        } catch { state.state = 'preparation_failed'; continue; }
        if (observationFailed) { state.state = 'observation_failed'; continue; }
        state.click_at = Date.now();
        state.last_growth = state.click_at;
        state.state = 'triggering';
        try { await item.trigger(); if (state.state === 'triggering') state.state = 'waiting_for_download'; }
        catch { if (state.state !== 'saved_candidate') state.state = 'trigger_failed'; }
      }
      triggersDone = true;
    })();
    const active = state => ['queued','triggering','waiting_for_download','receiving','finalizing'].includes(state.state);
    while (true) {
      const observingAfterTriggers = triggersDone;
      for (const item of observationFailed ? [] : items) {
        let events;
        try { events = await item.page.events(); }
        catch {
          diagnostics.add('article_event_observation_failed');
          observationFailed = true;
          break;
        }
        for (const event of events) {
          const p = event.params ?? {}, method = event.method ?? '';
          if (!p.guid) continue;
          if (/downloadWillBegin$/.test(method) && !downloads.has(p.guid)) {
            const owners = (frames.get(p.frameId) ?? []).filter(index => states[index].click_at !== null);
            if (owners.length !== 1) continue;
            let url;
            try { url = new URL(p.url); } catch { continue; }
            const owner = states[owners[0]];
            downloads.set(p.guid, {guid:p.guid, key:owner.key, origin:url.origin,
              source_path:url.pathname, state:'started', received_bytes:0, total_bytes:0,
              started_ms:Date.now(), receipt_id:null});
            if (active(owner)) { owner.state = 'receiving'; owner.last_growth = Date.now(); }
          }
          if (/downloadProgress$/.test(method) && downloads.has(p.guid)) {
            const d = downloads.get(p.guid), owner = states.find(s => s.key === d.key);
            if (Number(p.receivedBytes) > d.received_bytes) owner.last_growth = Date.now();
            d.received_bytes = Math.max(d.received_bytes, Number(p.receivedBytes) || 0);
            d.total_bytes = Math.max(d.total_bytes, Number(p.totalBytes) || 0);
            d.state = p.state;
            if (active(owner)) owner.state = p.state === 'canceled' ? 'download_canceled' : p.state === 'completed' ? 'finalizing' : 'receiving';
          }
        }
      }
      try { if (!observationFailed) records = await read(); }
      catch { diagnostics.add('downloads_ui_observation_failed'); observationFailed = true; records = []; }
      // An ephemeral PLOS tab may omit native events even for a long transfer.
      // UI growth keeps that paper alive; only completed UI records can be saved.
      for (const record of records) {
        if (baseline.includes(record.id) || record.removed
            || record.origin !== 'https://journals.plos.org' || record.source_path !== '/plosone/article/file'
            || !Number.isFinite(record.started_ms) || record.started_ms > Date.now() + 2000) continue;
        const owners = items.filter((item, index) => item.publisher === 'plos'
          && item.doi?.toLowerCase() === record.doi_query?.toLowerCase()
          && states[index].click_at !== null && record.started_ms >= states[index].click_at - 2000
          && ![...downloads.values()].some(d => d.key === item.key));
        if (owners.length !== 1) continue;
        const state = states.find(s => s.key === owners[0].key);
        if (!active(state)) continue;
        if (Number(record.received_bytes) > (state.received_bytes ?? 0)) state.last_growth = Date.now();
        if (!state.ui_record_id) state.last_growth = Date.now();
        state.ui_record_id = record.id;
        state.received_bytes = Math.max(state.received_bytes ?? 0, Number(record.received_bytes) || 0);
        state.total_bytes = Math.max(state.total_bytes ?? 0, Number(record.total_bytes) || 0);
        state.state = 'receiving';
      }
      for (const record of records) {
        if (consumed.has(record.id) || baseline.includes(record.id)
            || record.state !== 'completed' || record.removed
            || !Number.isSafeInteger(record.total_bytes) || record.total_bytes <= 0
            || !Number.isFinite(record.started_ms) || record.started_ms > Date.now() + 2000) continue;
        const matches = [...downloads.values()].filter(d => d.state === 'completed' && d.receipt_id === null
          && d.origin === record.origin && d.source_path === record.source_path
          && d.received_bytes === record.total_bytes
          && (d.total_bytes === 0 || d.total_bytes === d.received_bytes)
          && record.started_ms >= states.find(s => s.key === d.key).click_at - 2000);
        let owner, guid, evidence;
        if (matches.length === 1) {
          owner = states.find(s => s.key === matches[0].key);
          guid = matches[0].guid;
          evidence = 'native_event_and_ui';
        } else if (matches.length === 0 && record.origin === 'https://journals.plos.org'
            && record.source_path === '/plosone/article/file' && record.doi_query) {
          const possible = items.filter((i, index) => i.publisher === 'plos'
            && i.doi?.toLowerCase() === record.doi_query.toLowerCase()
            && ![...downloads.values()].some(d => d.key === i.key)
            && states[index].click_at !== null && record.started_ms >= states[index].click_at - 2000);
          if (possible.length === 1) {
            owner = states.find(s => s.key === possible[0].key);
            guid = null;
            evidence = 'completed_ui_ephemeral_plos_tab';
          }
        }
        if (!owner || owner.state === 'ambiguous_download_record') continue;
        try {
          const candidate = await persistCandidate(record.file_path, outputDir, {expectedBytes:record.total_bytes});
          candidates.push({...candidate, receipt_id:record.id, event_guid:guid,
            trigger_key:owner.key, completion_evidence:evidence});
          consumed.add(record.id);
          if (guid) downloads.get(guid).receipt_id = record.id;
          owner.state = 'saved_candidate';
          await checkpoint('collecting'); // Durable before any remaining slow paper.
        } catch { diagnostics.add('candidate_persistence_failed:' + record.id); }
      }
      // A second event/record can arrive after the first copy was persisted.
      // Keep that file, but withdraw an association that is no longer unique.
      for (let index = candidates.length - 1; index >= 0; index--) {
        const candidate = candidates[index];
        if (!candidate.event_guid) continue;
        const own = downloads.get(candidate.event_guid);
        const sameEvents = [...downloads.values()].filter(d => d.state === 'completed'
          && d.origin === own.origin && d.source_path === own.source_path && d.received_bytes === candidate.bytes);
        const sameRecords = records.filter(r => !baseline.includes(r.id) && r.state === 'completed' && !r.removed
          && r.origin === own.origin && r.source_path === own.source_path && r.total_bytes === candidate.bytes
          && r.started_ms >= states.find(s => s.key === own.key).click_at - 2000);
        if (sameEvents.length > 1 || sameRecords.length > 1) {
          unresolvedCandidates.push({...candidate, association_status:'ambiguous_download_record'});
          candidates.splice(index, 1);
          consumed.delete(candidate.receipt_id);
          states.find(s => s.key === candidate.trigger_key).state = 'ambiguous_download_record';
        }
      }
      for (let index = 0; index < states.length; index++) {
        const state = states[index];
        if (observationFailed && active(state)) { state.state = 'observation_failed'; continue; }
        if (!active(state) || state.click_at === null || state.state === 'triggering') continue;
        const own = [...downloads.values()].filter(d => d.key === state.key);
        if (!own.length && !state.ui_record_id && Date.now() - state.click_at >= startTimeoutMs) {
          let inspected;
          try { inspected = items[index].inspect ? await items[index].inspect() : null; }
          catch { diagnostics.add('page_inspection_failed:' + state.key); }
          state.state = ACCESS_STATES.has(inspected?.state) ? inspected.state : 'no_download_started';
        } else if ((own.length || state.ui_record_id) && Date.now() - state.last_growth >= idleTimeoutMs) {
          state.state = own.some(d => d.total_bytes > 0 && d.received_bytes >= d.total_bytes)
            || (state.total_bytes > 0 && state.received_bytes >= state.total_bytes)
            ? 'save_confirmation_unresolved' : 'download_stalled';
        }
        if (maxWaitMs !== null && Date.now() - started >= maxWaitMs && active(state)) state.state = 'diagnostic_limit_reached';
      }
      if (triggersDone && observingAfterTriggers && !states.some(active)) break;
      await pause(pollMs);
    }
    await triggers;
    const complete = !observationFailed && states.every(s => s.state === 'saved_candidate')
      && [...downloads.values()].every(d => d.state === 'completed' && d.receipt_id !== null)
      && records.every(r => consumed.has(r.id) || baseline.includes(r.id));
    return {...await checkpoint(complete ? 'saved_candidate' : 'partial_batch'),
      round_exit_required:states.some(s => ['receiving','finalizing','download_stalled',
        'save_confirmation_unresolved','observation_failed','trigger_failed','diagnostic_limit_reached'].includes(s.state))
        || [...downloads.values()].some(d => !['completed','canceled'].includes(d.state))};
  }, lockPath === undefined ? {} : {lockPath});
  // Include the retained lease in the final checkpoint, not only stdout.
  if (result.capture_lock?.status === 'retained') {
    try { await writeFile(join(outputDir, 'result.json'), JSON.stringify(result, null, 2)); }
    catch { result.checkpoint_write_failed = true; }
  }
  return result;
}
