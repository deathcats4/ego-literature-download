// Capture a loaded viewer from its observed Download control.
import {isAbsolute} from 'node:path';
import {saveDownload} from './save_download.mjs';

export async function captureViewer(page, selector, outputPath, {
  eventTimeoutMs = 30_000, ...saveOptions
} = {}) {
  if (!selector || !isAbsolute(outputPath)) throw new TypeError('Viewer selector and absolute outputPath required');
  if (!Number.isInteger(eventTimeoutMs) || eventTimeoutMs <= 0) throw new TypeError('eventTimeoutMs must be positive');
  await page.events();
  const pending = page.waitForEvent('download', {timeout:eventTimeoutMs});
  pending.catch(() => {});
  let download;
  try {
    await page.click(selector, {label:'Save loaded paper PDF'});
    download = await pending;
  } catch {
    try { download = await pending; } catch {}
    if (download) {
      const failed = await saveDownload({saveAs:async () => {throw Error('viewer_action_failed');},
        cancel:() => download.cancel()}, outputPath, saveOptions);
      return {...failed, failure_reason:'viewer_click_or_event_failed'};
    }
    return {capture_status:'capture_failed', failure_reason:'viewer_click_or_event_failed', round_exit_required:true};
  }
  const progress = new Map();
  const saved = await saveDownload(download, outputPath, {...saveOptions, observeProgress:async () => {
    for (const event of await page.events()) {
      const p = event.params ?? {};
      if (/downloadProgress$/.test(event.method ?? '') && p.guid) progress.set(p.guid, p);
    }
    if (progress.size > 1) throw Error('multiple_viewer_downloads');
    return [...progress.values()][0] ?? null;
  }});
  return {...saved, identity_match:null,
    completion_evidence:saved.capture_status === 'saved_candidate' ? 'sdk_saveAs' : null};
}
