import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { saveDownload } from '../scripts/save_download.mjs';

const budgets = { timeoutMs: 5, cancelTimeoutMs: 5 };

function output(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ego-save-test-'));
  t.after(() => rmSync(directory, { recursive: true }));
  return join(directory, 'candidate.pdf');
}

test('a completed save is a candidate, not a verified PDF', async (t) => {
  const path = output(t);
  let cancelled = false;
  const result = await saveDownload({
    saveAs: async (target) => writeFileSync(target, 'candidate'),
    cancel: async () => { cancelled = true; },
  }, path);
  assert.equal(result.capture_status, 'saved_candidate');
  assert.equal(result.round_exit_required, false);
  assert.equal(cancelled, false);
});

test('stalled save requests cancellation and still requires round exit', async (t) => {
  let calls = 0;
  const result = await saveDownload({
    saveAs: () => new Promise(() => {}),
    cancel: async () => { calls++; },
  }, output(t), budgets);
  assert.equal(calls, 1);
  assert.equal(result.failure_reason, 'save_timeout');
  assert.equal(result.cancel_status, 'completed');
  assert.equal(result.cancel_error_kind, null);
  assert.equal(result.round_exit_required, true);
});

test('a stalled cancellation also returns within its bound', async (t) => {
  const result = await saveDownload({
    saveAs: () => new Promise(() => {}), cancel: () => new Promise(() => {}),
  }, output(t), budgets);
  assert.equal(result.cancel_status, 'timed_out');
  assert.equal(result.cancel_error_kind, null);
  assert.equal(result.round_exit_required, true);
});

test('save errors preserve partial candidates without leaking error URLs', async (t) => {
  const path = output(t);
  const result = await saveDownload({
    saveAs: async () => {
      writeFileSync(path, 'partial');
      throw new Error('https://publisher.invalid/file?secret=do-not-log');
    }, cancel: async () => {},
  }, path, budgets);
  assert.equal(result.failure_reason, 'save_error');
  assert.equal(result.candidate_exists, true);
  assert.equal(result.round_exit_required, true);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('failed cancellation is not reported as completed', async (t) => {
  const result = await saveDownload({
    saveAs: async () => { throw new Error('save failed'); },
    cancel: async () => { throw new Error('cancel failed'); },
  }, output(t), budgets);
  assert.equal(result.cancel_status, 'failed');
});

test('a rejected browser cancellation keeps a safe diagnostic without its URL', async (t) => {
  const result = await saveDownload({
    saveAs: async () => { throw new Error('save failed'); },
    cancel: async () => { throw new Error('Protocol error (Browser.cancelDownload): https://publisher.invalid/?secret=private'); },
  }, output(t), budgets);
  assert.equal(result.cancel_status, 'failed');
  assert.equal(result.cancel_error_kind, 'browser_cancel_error');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('publisher.invalid'));
});

test('unsupported and unknown cancellations are distinguished without raw errors', async (t) => {
  for (const [message, expected] of [
    ['Not implemented', 'unsupported'],
    ['unexpected secret=private https://publisher.invalid/Browser.cancelDownload/unsupported', 'unknown'],
  ]) {
    const result = await saveDownload({
      saveAs: async () => { throw new Error('save failed'); },
      cancel: async () => { throw new Error(message); },
    }, output(t), budgets);
    assert.equal(result.cancel_error_kind, expected);
    assert.ok(!JSON.stringify(result).includes('private'));
  }
});

test('a late save can write after cancellation returns; the failed result stays failed', async (t) => {
  const path = output(t);
  let completeSave;
  const pendingSave = new Promise(resolve => { completeSave = resolve; })
    .then(() => writeFileSync(path, 'late candidate'));
  const result = await saveDownload({saveAs: () => pendingSave, cancel: async () => {}}, path, budgets);
  assert.equal(result.failure_reason, 'save_timeout');
  assert.equal(result.cancel_status, 'completed');
  assert.equal(result.candidate_exists, false);
  completeSave();
  await pendingSave;
  assert.equal(existsSync(path), true);
  assert.equal(result.capture_status, 'capture_failed');
  assert.equal(result.round_exit_required, true);
});

test('invalid paths and budgets fail before any download operation', async (t) => {
  const download = { saveAs: () => assert.fail('save should not run') };
  await assert.rejects(saveDownload(download, 'relative.pdf'), /absolute/);
  await assert.rejects(saveDownload(download, output(t), { timeoutMs: 0 }), /Timeouts/);
});

test('ongoing progress can exceed the idle budget in total duration', async t => {
  const path = output(t);
  let bytes = 0;
  const interval = setInterval(() => {bytes++;}, 5);
  t.after(() => clearInterval(interval));
  const result = await saveDownload({
    saveAs:async target => {await new Promise(r => setTimeout(r, 100)); writeFileSync(target, 'candidate');},
    cancel:async () => assert.fail('a growing transfer must not be canceled'),
  }, path, {idleTimeoutMs:40, pollMs:5, observeProgress:async () => ({receivedBytes:bytes})});
  assert.equal(result.capture_status, 'saved_candidate');
  assert.ok(result.elapsed_ms >= 80);
});

test('no progress expires as idle, not as a fixed total timeout', async t => {
  const result = await saveDownload({saveAs:() => new Promise(() => {}), cancel:async () => {}},
    output(t), {idleTimeoutMs:15, pollMs:2, observeProgress:async () => ({receivedBytes:0})});
  assert.equal(result.failure_reason, 'save_idle_timeout');
});

test('hung progress observation cannot defeat total or idle deadlines', async t => {
  for (const [limits, expected] of [
    [{timeoutMs:15,idleTimeoutMs:100}, 'save_timeout'],
    [{idleTimeoutMs:15}, 'save_idle_timeout'],
  ]) {
    let cancelCalls = 0, guard;
    try {
      const result = await Promise.race([
        saveDownload({saveAs:() => new Promise(() => {}), cancel:async () => {cancelCalls++;}},
          output(t), {...limits,pollMs:2,observeProgress:() => new Promise(() => {})}),
        new Promise((_, reject) => {guard=setTimeout(() => reject(Error('deadline watchdog stuck')),300);}),
      ]);
      assert.equal(result.failure_reason, expected);
      assert.equal(result.round_exit_required, true);
      assert.equal(cancelCalls, 1);
    } finally {clearTimeout(guard);}
  }
});

test('a late progress read after save completion starts no further polls or cancellation', async t => {
  let resolveProgress, observations = 0, cancelled = false;
  const progress = new Promise(resolve => {resolveProgress=resolve;});
  const result = await saveDownload({saveAs:async () => {}, cancel:async () => {cancelled=true;}},
    output(t), {idleTimeoutMs:15,pollMs:2,observeProgress:() => {observations++;return progress;}});
  resolveProgress({state:'canceled'});
  await new Promise(resolve => setTimeout(resolve,30));
  assert.equal(result.capture_status,'saved_candidate');
  assert.equal(observations,1);
  assert.equal(cancelled,false);
});

test('local file growth still renews idle time while browser progress is hung', async t => {
  const path = output(t);
  let bytes = 0;
  const interval = setInterval(() => writeFileSync(path, 'x'.repeat(++bytes)), 5);
  t.after(() => clearInterval(interval));
  const result = await saveDownload({saveAs:async () => {
    await new Promise(resolve => setTimeout(resolve,150));
    clearInterval(interval);
  }, cancel:async () => assert.fail('local growth must extend idle time')}, path,
  {idleTimeoutMs:70,pollMs:5,observeProgress:() => new Promise(() => {})});
  assert.equal(result.capture_status,'saved_candidate');
  assert.ok(result.elapsed_ms >= 120);
});

test('full bytes without save confirmation expire as finalization failure', async t => {
  const result = await saveDownload({saveAs:() => new Promise(() => {}),cancel:async () => {}},
    output(t), {idleTimeoutMs:20,pollMs:2,observeProgress:async () => ({receivedBytes:100,totalBytes:100})});
  assert.equal(result.failure_reason,'save_finalization_timeout');
});

test('a save whose bytes equal the expected total stays a candidate', async t => {
  const path = output(t);
  const result = await saveDownload({saveAs:async target => writeFileSync(target,'candidate'),cancel:async () => {}},
    path, {expectedBytes:9});
  assert.equal(result.capture_status,'saved_candidate');
  assert.equal(result.candidate_bytes,9);
  assert.equal(result.round_exit_required,false);
});

test('a truncated save is a failure even though saveAs resolved', async t => {
  const path = output(t);
  const result = await saveDownload({saveAs:async target => writeFileSync(target,'candidate'),cancel:async () => {}},
    path, {expectedBytes:40850840});
  assert.equal(result.capture_status,'capture_failed');
  assert.equal(result.failure_reason,'save_size_mismatch');
  assert.equal(result.saved_bytes,9);
  assert.equal(result.expected_bytes,40850840);
  assert.equal(result.candidate_exists,true);
  assert.equal(result.round_exit_required,false);
});

test('browser progress total also exposes a short save', async t => {
  const result = await saveDownload({saveAs:async target => writeFileSync(target,'candidate'),cancel:async () => {}},
    output(t), {pollMs:2,observeProgress:async () => ({receivedBytes:9,totalBytes:1024})});
  assert.equal(result.failure_reason,'save_size_mismatch');
  assert.equal(result.saved_bytes,9);
  assert.equal(result.expected_bytes,1024);
});

test('an invalid expected size fails before any download operation', async t => {
  const download = {saveAs: () => assert.fail('save should not run')};
  for (const expectedBytes of [0, -1, 1.5, '10']) {
    await assert.rejects(saveDownload(download, output(t), {expectedBytes}), /expectedBytes/);
  }
});
