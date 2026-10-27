import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {captureViewer} from '../scripts/capture_viewer.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'ego-viewer-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  return {path:join(root,'viewer.pdf'), options:{idleTimeoutMs:100, pollMs:5}};
}

test('viewer wait is armed before click and the SDK save remains a candidate', async t => {
  const f = await fixture(t);
  let armed = false;
  let receive;
  const pending = new Promise(resolve => {receive=resolve;});
  const page = {events:async () => [], waitForEvent:() => {armed=true;return pending;},
    click:async () => {assert.equal(armed,true);receive({saveAs:path => writeFile(path,'%PDF-fixture'),cancel:async () => {}});}};
  const r = await captureViewer(page,'observed-download-button',f.path,f.options);
  assert.equal(r.capture_status,'saved_candidate');
  assert.equal(r.identity_match,null);
  assert.equal(r.completion_evidence,'sdk_saveAs');
  assert.equal(r.capture_lock,undefined);
});

test('failed viewer click cancels a late artifact and never reports success', async t => {
  const f = await fixture(t);
  let canceled = false;
  const page = {events:async () => [], waitForEvent:async () => ({cancel:async () => {canceled=true;}}),
    click:async () => {throw Error('https://secret.invalid/token');}};
  const r = await captureViewer(page,'download',f.path,f.options);
  assert.equal(canceled,true);
  assert.equal(r.failure_reason,'viewer_click_or_event_failed');
  assert.equal(r.round_exit_required,true);
  assert.ok(!JSON.stringify(r).includes('secret'));
  assert.equal(r.capture_lock,undefined);
});

test('failed SDK save never receives successful completion evidence', async t => {
  const f = await fixture(t);
  const page = {events:async () => [], click:async () => {}, waitForEvent:async () => ({
    saveAs:async () => {throw Error('save failed');}, cancel:async () => {},
  })};
  const r = await captureViewer(page,'download',f.path,f.options);
  assert.equal(r.capture_status,'capture_failed');
  assert.equal(r.round_exit_required,true);
  assert.notEqual(r.completion_evidence,'sdk_saveAs');
  assert.equal(r.capture_lock,undefined);
});

test('independent viewers can start SDK captures concurrently', async t => {
  const a = await fixture(t), b = await fixture(t);
  let clicks = 0;
  const makePage = () => ({events:async () => [],
    waitForEvent:async () => ({saveAs:path => writeFile(path,'%PDF-parallel'),cancel:async () => {}}),
    click:async () => {clicks++;}});
  const results = await Promise.all([
    captureViewer(makePage(),'download',a.path,a.options),
    captureViewer(makePage(),'download',b.path,b.options),
  ]);
  assert.equal(clicks,2);
  assert.ok(results.every(result => result.capture_status === 'saved_candidate'));
});
