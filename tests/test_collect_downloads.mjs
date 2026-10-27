import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertDownloadsPageCompatible, collectDownloads, prepareArticle, probeDownloadsPage,
  readDownloadRecords, readDownloadHistory} from '../scripts/collect_downloads.mjs';
import {runInNewContext} from 'node:vm';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ego-pool-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const source = join(root, 'source.pdf');
  const data = Buffer.from('%PDF-test fixture bytes');
  await writeFile(source, data);
  const events = [];
  const receipts = [];
  const page = {
    targetId:'frame-a',
    cdp:async () => ({frameTree:{frame:{id:'frame-a'}}}),
    events:async () => events.splice(0),
  };
  const item = {key:'a', doi:'10.1234/a', publisher:'mdpi', page,
    trigger:async () => {
      events.push({method:'Page.downloadWillBegin', params:{guid:'g1', frameId:'frame-a', url:'https://publisher.test/a.pdf?secret=private'}});
      events.push({method:'Page.downloadProgress', params:{guid:'g1', state:'completed', receivedBytes:data.length, totalBytes:data.length}});
      receipts.push({id:'new', file_path:source, state:'completed', started_ms:Date.now(),
        total_bytes:data.length, received_bytes:data.length, removed:false,
        origin:'https://publisher.test', source_path:'/a.pdf', doi_query:null});
    }};
  const options = {items:[item], outputDir:join(root, 'pool'), browserVersion:'0.6.1.13',
    baselineIds:[], readRecords:async () => receipts,
    pollMs:2, startTimeoutMs:20, idleTimeoutMs:30};
  async function collect(extra={}) { return collectDownloads({...options, ...extra}); }
  return {root, data, source, page, item, events, receipts, options, collect};
}

test('native candidates are persisted and checkpointed without signed URLs', async t => {
  const f = await fixture(t);
  const r = await f.collect();
  assert.equal(r.capture_status, 'saved_candidate');
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].identity_match, null);
  assert.equal(r.candidates[0].completion_evidence, 'native_event_and_ui');
  assert.deepEqual(await readFile(r.candidates[0].candidate_path), f.data);
  assert.ok(!JSON.stringify(r).includes('private'));
  assert.equal(JSON.parse(await readFile(join(f.options.outputDir, 'collection.json'))).candidates.length, 1);
});

test('downloads page compatibility is detected from the observed DOM, independent of version', async () => {
  const data = {id:'new', filePath:'source', state:2, started:123, total:100, percent:100,
    url:{url:'https://publisher.test/a.pdf'}};
  const page = {evaluate:async (fn, fields) => runInNewContext('('+fn.toString()+')(fields)', {
    fields, document:{querySelector:selector => selector === 'downloads-manager' ? {
      shadowRoot:{querySelector:inner => inner === '#mainContainer' ? {} : null,
        querySelectorAll:() => [{data}]},
    } : null},
  })};
  const probe = await probeDownloadsPage(page);
  assert.equal(probe.has_container, true);
  assert.equal(probe.row_count, 1);
  await assert.doesNotReject(() => assertDownloadsPageCompatible(page));
});

test('a compatible older browser version is accepted by collection', async t => {
  const f = await fixture(t);
  const data = {id:'old', filePath:'source', state:2, started:123, total:100, percent:100,
    url:{url:'https://publisher.test/a.pdf'}};
  const recordsPage = {evaluate:async (fn, fields) => runInNewContext('('+fn.toString()+')(fields)', {
    fields, document:{querySelector:selector => selector === 'downloads-manager' ? {
      shadowRoot:{querySelector:inner => inner === '#mainContainer' ? {} : null,
        querySelectorAll:() => [{data}]},
    } : null},
  })};
  const result = await f.collect({recordsPage, browserVersion:'0.6.1.11'});
  assert.equal(result.capture_status, 'saved_candidate');
});

test('unsupported downloads page fails closed before browser capture', async () => {
  const page = {evaluate:async fn => runInNewContext('('+fn.toString()+')()', {
    document:{querySelector:() => null},
  })};
  await assert.rejects(() => assertDownloadsPageCompatible(page), /downloads_ui_unverified/);
});

test('actual UI percent telemetry supplies growth when received is absent', async () => {
  const data = {id:'new', filePath:'source', state:0, started:123, total:'10000', percent:37,
    url:{url:'https://journals.plos.org/plosone/article/file?id=10.1234/a&type=printable'}};
  const page = {evaluate:async (fn, ids) => runInNewContext('('+fn.toString()+')(ids)', {
    ids, URL, document:{querySelector:() => ({shadowRoot:{querySelectorAll:() => [{data}]}})}})};
  let rows = await readDownloadRecords(page, []);
  assert.equal(rows[0].received_bytes, 3700);
  assert.equal(rows[0].state, 'pending');
  data.state = 2; data.percent = -2;
  rows = await readDownloadRecords(page, []);
  assert.equal(rows[0].received_bytes, 10000);
  assert.equal(rows[0].state, 'completed');
  data.state = 5; data.percent = 56;
  rows = await readDownloadRecords(page, []);
  assert.equal(rows[0].state, 'interrupted');
  assert.equal(rows[0].raw_state, '5');
});

test('unknown-length real UI progress text supplies received growth without a percent', async () => {
  const data = {id:'172', filePath:'source', state:0, started:123, total:0, percent:-1,
    progressStatusText:'28.1 KB/s - 5.8 MB', url:{url:'https://www.mdpi.com/api/articles/single/download-from-url'}};
  const page = {evaluate:async (fn, ids) => runInNewContext('('+fn.toString()+')(ids)', {
    ids, URL, document:{querySelector:() => ({shadowRoot:{querySelectorAll:() => [{data}]}})}})};
  const first = (await readDownloadRecords(page, []))[0];
  assert.equal(first.total_bytes, 0);
  assert.ok(first.received_bytes > 5_000_000);
  assert.equal(first.progress_source, 'displayed_bytes');
  data.progressStatusText = '28.1 KB/s - 5.9 MB';
  const second = (await readDownloadRecords(page, []))[0];
  assert.ok(second.received_bytes > first.received_bytes);
  data.progressStatusText = '300 MB/s - 0 B';
  assert.equal((await readDownloadRecords(page, []))[0].received_bytes, 0);
});

test('unsupported displayed units or ambiguous grouped numbers do not invent byte growth', async () => {
  const data = {id:'new', filePath:'source', state:0, started:123, total:0, percent:-1,
    url:{url:'https://publisher.test/a'}};
  const page = {evaluate:async (fn, ids) => runInNewContext('('+fn.toString()+')(ids)', {
    ids, URL, document:{querySelector:() => ({shadowRoot:{querySelectorAll:() => [{data}]}})}})};
  for (const text of ['28.1 KB/s', '28.1 KB/秒', '28.1 KB/s - 5,800 MB', '28.1 Ko/s - 5.8 Mo',
    '10.2 KB/s - 1,570 KB，共 14.1 MB，还剩 21 分钟']) {
    data.progressStatusText=text;
    const row=(await readDownloadRecords(page, []))[0];
    assert.equal(row.received_bytes, 0);
    assert.equal(row.progress_source, 'unavailable');
  }
  data.total=14829066;data.percent=10;
  data.progressStatusText='10.2 KB/s - 1,570 KB，共 14.1 MB，还剩 21 分钟';
  const row=(await readDownloadRecords(page, []))[0];
  assert.equal(row.progress_source,'percent');
  assert.equal(row.received_bytes,1482906);
});

test('history observation finds a growing record outside the virtual viewport and restores scroll', async () => {
  let top=0;
  const rows=[
    {id:'new-fast',filePath:'fast',state:2,total:50,percent:-2,started:123,url:{url:'https://publisher.test/fast'}},
    {id:'new-slow',filePath:'slow',state:0,total:0,percent:-1,started:123,progressStatusText:'28.1 KB/s - 5.8 MB',url:{url:'https://publisher.test/slow'}},
    {id:'old',filePath:'old',state:2,total:10,percent:-2,started:100,url:{url:'https://publisher.test/old'}},
  ];
  const container={clientHeight:100,scrollHeight:300,get scrollTop(){return top;},set scrollTop(y){top=Math.max(0,Math.min(200,y));}};
  const root={querySelector:()=>container,querySelectorAll:()=>[{data:rows[Math.min(2,Math.floor(top/70))]}]};
  const page={evaluate:async(fn,arg)=>runInNewContext('('+fn.toString()+')(arg)',{arg,URL,document:{querySelector:()=>({shadowRoot:root})}})};
  const result=await readDownloadHistory(page,['old'],{requiredIds:['new-slow'],settleMs:1});
  assert.deepEqual(Array.from(result,r=>r.id),['new-fast','new-slow']);
  assert.ok(result.find(r=>r.id==='new-slow').received_bytes>5_000_000);
  assert.equal(top,0);
  await assert.rejects(readDownloadHistory(page,['old'],{requiredIds:['missing'],settleMs:1,maxScrolls:3}),/history_incomplete/);
  assert.equal(top,0);
});

test('one failed preparation does not lose another completed download', async t => {
  const f = await fixture(t);
  const r = await f.collect({items:[{key:'broken', page:f.page, prepare:async () => {throw Error('private');}}, f.item]});
  assert.equal(r.capture_status, 'partial_batch');
  assert.equal(r.items[0].state, 'preparation_failed');
  assert.equal(r.items[1].state, 'saved_candidate');
  assert.equal(r.candidates.length, 1);
});

test('lost observation stops future preparations and browser polling', async t => {
  const f = await fixture(t);
  let eventCalls = 0, nextPrepared = false;
  const page = {...f.page, events:async () => {
    if (++eventCalls > 2) throw Error('observation lost');
    return [];
  }};
  const r = await f.collect({items:[{key:'first',page,
    trigger:async () => {await new Promise(resolve=>setTimeout(resolve,20));}},
    {key:'next',page, prepare:async () => {nextPrepared=true;return {state:'ready'};}}]});
  assert.equal(eventCalls, 3);
  assert.equal(nextPrepared, false);
  assert.ok(r.items.every(i=>i.state==='observation_failed'));
  assert.equal(r.round_exit_required, true);
});

test('known access and viewer states stop only that paper without a download wait', async t => {
  for (const state of ['access_unavailable','human_verification_required','viewer_requires_save','consent_required']) {
    const f = await fixture(t);
    let clicked = false;
    const r = await f.collect({items:[{key:'blocked', page:f.page,
      prepare:async () => ({state}), trigger:async () => {clicked=true;}}]});
    assert.equal(r.items[0].state, state);
    assert.equal(clicked, false);
  }
});

test('closed ephemeral PLOS tabs use separately labelled completed UI evidence', async t => {
  const f = await fixture(t);
  f.item.publisher = 'plos';
  f.item.trigger = async () => f.receipts.push({id:'plos', file_path:f.source, state:'completed',
    started_ms:Date.now(), total_bytes:f.data.length, removed:false,
    origin:'https://journals.plos.org', source_path:'/plosone/article/file', doi_query:'10.1234/a'});
  const r = await f.collect();
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].event_guid, null);
  assert.equal(r.candidates[0].completion_evidence, 'completed_ui_ephemeral_plos_tab');
});

test('old, foreign and ambiguous UI records never fill a request', async t => {
  const f = await fixture(t);
  f.item.trigger = async () => {
    f.receipts.push({id:'foreign', file_path:f.source, state:'completed', started_ms:Date.now(),
      total_bytes:f.data.length, removed:false, origin:'https://unrelated.test', source_path:'/a.pdf'});
  };
  const r = await f.collect();
  assert.equal(r.candidates.length, 0);
  assert.equal(r.items[0].state, 'no_download_started');
  assert.deepEqual(r.unattributed_record_ids, ['foreign']);
});

test('an explicit canceled transfer is not confused with a slow transfer', async t => {
  const f = await fixture(t);
  f.item.trigger = async () => f.events.push(
    {method:'Page.downloadWillBegin', params:{guid:'g',frameId:'frame-a',url:'https://publisher.test/a.pdf'}},
    {method:'Page.downloadProgress',params:{guid:'g',state:'canceled',receivedBytes:3,totalBytes:100}});
  const r = await f.collect();
  assert.equal(r.items[0].state, 'download_canceled');
});

test('all received bytes without completion require finalization inspection, never success', async t => {
  const f = await fixture(t);
  f.item.trigger = async () => f.events.push(
    {method:'Page.downloadWillBegin',params:{guid:'g',frameId:'frame-a',url:'https://publisher.test/a.pdf'}},
    {method:'Page.downloadProgress',params:{guid:'g',state:'inProgress',receivedBytes:100,totalBytes:100}});
  const r = await f.collect();
  assert.equal(r.items[0].state, 'save_confirmation_unresolved');
  assert.equal(r.candidates.length, 0);
  assert.equal(r.round_exit_required, true);
});

test('a usable page survives navigation load timeout; a wrong page does not', async () => {
  const page = {goto:async () => {throw Object.assign(Error('load timeout'), {name:'TimeoutError'});},
    waitForSelector:async () => {}};
  const r = await prepareArticle(page, 'https://publisher.test/a', {readySelector:'h1'});
  assert.equal(r.state, 'ready');
  assert.equal(r.navigation_timed_out, true);
  page.waitForSelector = async () => {throw Error('missing');};
  assert.equal((await prepareArticle(page, 'https://publisher.test/a', {readySelector:'h1'})).state, 'page_not_ready');
});

test('growing UI-only downloads survive the initial response deadline', async t => {
  const f = await fixture(t);
  let timer;
  t.after(() => clearInterval(timer));
  f.item.publisher = 'plos';
  f.item.trigger = async () => {
    const r = {id:'long-plos', file_path:f.source, state:'pending', started_ms:Date.now(),
      total_bytes:f.data.length, received_bytes:0, removed:false,
      origin:'https://journals.plos.org',source_path:'/plosone/article/file',doi_query:'10.1234/a'};
    f.receipts.push(r);
    timer = setInterval(() => {r.received_bytes += 2; if (r.received_bytes >= f.data.length) {
      r.received_bytes = f.data.length; r.state = 'completed'; clearInterval(timer);
    }}, 10);
  };
  const r = await f.collect({startTimeoutMs:30, idleTimeoutMs:100});
  assert.equal(r.capture_status, 'saved_candidate');
  assert.ok(r.elapsed_ms > 80);
});

test('a waiting paper does not delay persistence of a completed paper', async t => {
  const f = await fixture(t);
  let finishedWhileOtherWaiting = false;
  const slowPage = {cdp:async () => ({frameTree:{frame:{id:'slow'}}}), events:async () => []};
  const slow = {key:'slow',page:slowPage,trigger:async () => {}};
  const collecting = f.collect({items:[slow,f.item],startTimeoutMs:150});
  await new Promise(resolve => setTimeout(resolve, 70));
  try {
    const checkpoint = JSON.parse(await readFile(join(f.options.outputDir,'collection.json')));
    finishedWhileOtherWaiting = checkpoint.candidates.length === 1;
  } catch {}
  const r = await collecting;
  assert.equal(finishedWhileOtherWaiting, true);
  assert.equal(r.items[0].state, 'no_download_started');
  assert.equal(r.items[1].state, 'saved_candidate');
});

test('collection proceeds without a global queue', async t => {
  const f = await fixture(t);
  const r = await f.collect();
  assert.equal(r.capture_status, 'saved_candidate');
  assert.equal(r.capture_lock, undefined);
});

test('ambiguous native records are retained unresolved, not assigned by arrival order', async t => {
  const f = await fixture(t);
  const original = f.item.trigger;
  f.item.trigger = async () => {await original(); f.events.push(
    {method:'Page.downloadWillBegin',params:{guid:'g2',frameId:'frame-a',url:'https://publisher.test/a.pdf'}},
    {method:'Page.downloadProgress',params:{guid:'g2',state:'completed',receivedBytes:f.data.length,totalBytes:f.data.length}});};
  const r = await f.collect();
  assert.equal(r.candidates.length, 0);
  assert.equal(r.capture_status, 'partial_batch');
  assert.deepEqual(r.unattributed_record_ids, ['new']);
});
