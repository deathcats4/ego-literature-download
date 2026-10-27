import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {runInNewContext} from 'node:vm';
import {startDownloadPool,triggerPoolDownload,finishPoolWorker,collectDownloadPool,
  finalizeDownloadPool} from '../scripts/shared_download_pool.mjs';

async function fixture(t,workers=['a','b']) {
  const root=await mkdtemp(join(tmpdir(),'ego-shared-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const data=Buffer.from('%PDF-test browser download'), source=join(root,'browser.pdf');
  await writeFile(source,data);
  const outputDir=join(root,'pool');
  const started=await startDownloadPool({outputDir,browserVersion:'0.6.1.11',workers,
    baselineIds:['old']});
  const sessionPath=started.session_path, rows=[];
  const row=(id,overrides={})=>({id,file_path:source,state:'completed',started_ms:Date.now(),
    total_bytes:data.length,received_bytes:data.length,removed:false,
    origin:'https://publisher.test',source_path:'/shared-endpoint',...overrides});
  const trigger=(worker='a',attempt=worker,action=async()=>{})=>triggerPoolDownload({sessionPath,
    workerId:worker,attemptId:attempt,paperKey:worker,trigger:action});
  const finish=async()=>{for(const workerId of workers) await finishPoolWorker({sessionPath,workerId,cliExitConfirmed:true});};
  const collect=(options={})=>collectDownloadPool({sessionPath,readRecords:async()=>rows,
    pollMs:2,discoveryGraceMs:8,idleTimeoutMs:35,maxWaitMs:500,...options});
  return {root,source,data,outputDir,sessionPath,rows,row,trigger,finish,collect,started};
}

test('missing all native events: independent workers finish out of order and same URL records all persist',async t=>{
  const f=await fixture(t);
  const collecting=f.collect();
  await Promise.all([f.trigger('a','a',async()=>{await new Promise(r=>setTimeout(r,12));f.rows.push(f.row('a'));}),
    f.trigger('b','b',async()=>f.rows.push(f.row('b')))]);
  await f.finish();
  const result=await collecting;
  assert.equal(result.capture_status,'pool_collected');
  assert.deepEqual(new Set(result.candidates.map(c=>c.receipt_id)),new Set(['a','b']));
  assert.ok(result.candidates.every(c=>!('trigger_key' in c)&&c.event_guid===null&&!c.audit.cli_exit_confirmed));
  assert.equal(new Set(result.candidates.map(c=>c.sha256)).size,1); // matcher dedups later
  await assert.rejects(()=>finalizeDownloadPool({sessionPath:f.sessionPath}),/collector_cli_exit_required/);
  const finalized=await finalizeDownloadPool({sessionPath:f.sessionPath,collectorCliExitConfirmed:true});
  assert.ok(finalized.candidates.every(c=>c.audit.cli_exit_confirmed));
  assert.deepEqual(await readFile(finalized.candidates[0].candidate_path),f.data);
});

test('three workers trigger independent downloads concurrently',async t=>{
  const f=await fixture(t,['a','b','c']);
  const collecting=f.collect();
  const delays={a:18,b:4,c:10};
  await Promise.all(Object.entries(delays).map(([worker,delay])=>f.trigger(worker,worker,async()=>{
    await new Promise(resolve=>setTimeout(resolve,delay));
    f.rows.push(f.row(worker));
  })));
  await f.finish();
  const result=await collecting;
  assert.equal(result.capture_status,'pool_collected');
  assert.deepEqual(new Set(result.candidates.map(candidate=>candidate.receipt_id)),new Set(['a','b','c']));
  assert.equal(result.attempts.length,3);
  assert.ok(result.attempts.every(attempt=>attempt.state==='trigger_returned'));
});

test('pool starts without publisher or host preclassification',async t=>{
  const f=await fixture(t,['a']);
  assert.equal(f.started.capture_status,'pool_started');
  assert.equal(JSON.parse(await readFile(join(f.outputDir,'session.json'))).allowed_origins,undefined);
});

test('repeated receipt IDs persist only once, with no SDK or article Page dependency',async t=>{
  const f=await fixture(t,['a']);
  await f.trigger(); f.rows.push(f.row('one')); await f.finish();
  const result=await f.collect();
  assert.equal(result.candidates.length,1);
  await assert.rejects(()=>f.collect(),/EEXIST/);
});

test('no records is not a claimed per-paper success; workers must exit before sealing',async t=>{
  const f=await fixture(t,['a']);
  await f.trigger();
  let returned=false;
  const collecting=f.collect().then(r=>{returned=true;return r;});
  await new Promise(r=>setTimeout(r,20)); assert.equal(returned,false);
  await assert.rejects(()=>finishPoolWorker({sessionPath:f.sessionPath,workerId:'a'}),/worker_cli_exit_required/);
  await f.finish();
  const result=await collecting;
  assert.equal(result.candidates.length,0);
  assert.equal(result.capture_status,'pool_collected'); // collection ended, matcher still reports missing
  assert.equal(JSON.parse(await readFile(join(f.outputDir,'closed.json'))).state,'sealed');
  assert.equal(JSON.parse(await readFile(join(f.outputDir,'control.json'))).state,'accepting');
  await assert.rejects(()=>f.trigger('a','late'),/pool_not_accepting/);
});

test('a worker can resume after its trigger round and finish without replaying the click',async t=>{
  const f=await fixture(t,['a']);
  let clicks=0;
  await f.trigger('a','first',async()=>{clicks++; f.rows.push(f.row('resumed'));});
  const collecting=f.collect({discoveryGraceMs:20});
  await new Promise(resolve=>setTimeout(resolve,8));
  // This represents a restarted coordinator confirming the prior CLI exit.
  await finishPoolWorker({sessionPath:f.sessionPath,workerId:'a',cliExitConfirmed:true});
  const result=await collecting;
  assert.equal(result.capture_status,'pool_collected');
  assert.equal(result.candidates.length,1);
  assert.equal(clicks,1);
  // The closed pool fences all new work before checking worker exit markers.
  await assert.rejects(()=>f.trigger('a','replay',async()=>{clicks++;}),/pool_not_accepting/);
});

test('old, removed, out-of-window and non-HTTPS records are excluded and reported',async t=>{
  const f=await fixture(t,['a']); await f.trigger();
  f.rows.push(f.row('old'),f.row('non-https',{origin:'http://publisher.test'}),
    f.row('removed',{removed:true}),f.row('ancient',{started_ms:100}));
  await f.finish();const result=await f.collect();
  assert.equal(result.candidates.length,0);
  assert.equal(result.quarantined_records.length,3);
  assert.equal(result.capture_status,'partial_pool');
});

test('late record is discovered after worker CLI exit',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();
  const timer=setTimeout(()=>f.rows.push(f.row('late')),8);t.after(()=>clearTimeout(timer));
  const result=await f.collect({discoveryGraceMs:25});
  assert.equal(result.candidates.length,1);
});

test('growing transfer lasts beyond discovery grace; completed other file persists first',async t=>{
  const f=await fixture(t,['a']);await f.trigger();
  const slow=f.row('slow',{state:'pending',received_bytes:0});
  f.rows.push(slow,f.row('fast'));await f.finish();
  let finishSlow=false;
  const collecting=f.collect({idleTimeoutMs:1000,maxWaitMs:5000,readRecords:async()=>{
    if(finishSlow){slow.received_bytes=f.data.length;slow.state='completed';}
    else slow.received_bytes=Math.min(f.data.length-1,slow.received_bytes+1);
    return f.rows;
  }});
  try {
    let interim;const deadline=Date.now()+2000;
    do {
      try {interim=JSON.parse(await readFile(join(f.outputDir,'collection.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(interim?.candidates.length===1)break;
      await new Promise(r=>setTimeout(r,5));
    }while(Date.now()<deadline);
    assert.equal(interim?.candidates.length,1);
    assert.equal(interim.candidates[0].receipt_id,'fast');
  }finally{finishSlow=true;await collecting;}
  assert.equal((await collecting).candidates.length,2);
});

test('default UI observer follows an offscreen unknown-length transfer beyond its idle budget',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();
  const begun=Date.now();let top=0;
  const base={filePath:f.source,started:begun/1000,url:{url:'https://publisher.test/slow'}};
  const slow={...base,id:'slow',get state(){return Date.now()-begun>=650?2:0;},
    get total(){return this.state===2?f.data.length:0;},percent:-1,
    get progressStatusText(){return '120 B/s - '+Math.min(f.data.length,Math.floor((Date.now()-begun)/25))+' B';}};
  const rows=[{...base,id:'fast',state:2,total:f.data.length,percent:-2},slow,
    {...base,id:'old',state:2,total:f.data.length,percent:-2}];
  const container={clientHeight:100,get scrollTop(){return top;},set scrollTop(y){top=Math.max(0,Math.min(200,y));}};
  const root={querySelector:()=>container,querySelectorAll:()=>[{data:rows[Math.min(2,Math.floor(top/70))]}]};
  const recordsPage={evaluate:async(fn,arg)=>runInNewContext('('+fn.toString()+')(arg)',{
    arg,URL,document:{querySelector:()=>({shadowRoot:root})}})};
  const result=await f.collect({readRecords:undefined,recordsPage,idleTimeoutMs:100,maxWaitMs:2500});
  assert.equal(result.capture_status,'pool_collected');
  assert.deepEqual(new Set(result.candidates.map(c=>c.receipt_id)),new Set(['fast','slow']));
  assert.equal(result.rejected_records.length,0);
  assert.ok(result.ended_ms-begun>650);
  assert.equal(top,0);
});

test('interrupted and all-bytes pending do not become completed',async t=>{
  const f=await fixture(t,['a']);await f.trigger();
  f.rows.push(f.row('interrupted',{state:'interrupted',raw_state:'5'}),f.row('pending',{state:'pending'}));
  await f.finish();const result=await f.collect();
  assert.equal(result.candidates.length,0);
  assert.deepEqual(new Set(result.rejected_records.map(r=>r.reason)),new Set(['download_interrupted','download_stalled']));
});

test('a disappeared active DOM row remains unresolved',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();
  let calls=0;
  const result=await f.collect({readRecords:async()=>++calls===1?[f.row('gone',{state:'pending'})]:[]});
  assert.equal(result.rejected_records[0].reason,'download_stalled');
});

test('completed receipt mutation withdraws candidate and retains first evidence',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();
  const row=f.row('changed');let calls=0;
  const result=await f.collect({readRecords:async()=>{if(++calls>1) row.total_bytes+=1;return [row];}});
  assert.equal(result.candidates.length,0);
  assert.equal(result.rejected_records[0].reason,'record_changed');
  assert.equal(result.rejected_records[0].original.total_bytes,f.data.length);
});

test('temporarily unreadable completed file retries copy without another click',async t=>{
  const f=await fixture(t,['a']);let clicks=0;await f.trigger('a','a',async()=>{clicks++;});
  const later=join(f.root,'later.pdf');f.rows.push(f.row('later',{file_path:later}));await f.finish();
  const timer=setTimeout(()=>writeFile(later,f.data),12);t.after(()=>clearTimeout(timer));
  const result=await f.collect({idleTimeoutMs:100});
  assert.equal(result.candidates.length,1);assert.equal(clicks,1);
});

test('out-of-scope mutation of an already saved receipt also withdraws it',async t=>{
  for(const mutation of [{origin:'https://foreign.test'},{started_ms:100}]) {
    const f=await fixture(t,['a']);await f.trigger();await f.finish();
    const row=f.row('changed');let calls=0;
    const result=await f.collect({readRecords:async()=>{
      if(++calls>1)Object.assign(row,mutation);return [row];}});
    assert.equal(result.candidates.length,0);
    assert.equal(result.rejected_records[0].reason,'record_changed');
  }
});

test('observation failure pauses new triggers and preserves files',async t=>{
  const f=await fixture(t);await f.trigger('a');
  let calls=0;const result=await f.collect({readRecords:async()=>{
    if(++calls>1)throw Error('https://secret.test/?token=private');return [f.row('saved')];}});
  assert.equal(result.candidates.length,1);assert.equal(result.capture_status,'partial_pool');
  assert.ok(!JSON.stringify(result).includes('private'));
  await assert.rejects(()=>f.trigger('b'),/pool_not_accepting/);
  await assert.rejects(()=>finalizeDownloadPool({sessionPath:f.sessionPath,collectorCliExitConfirmed:true}),/worker_cli_exit_required/);
});

test('worker tokens and unique attempts prevent unregistered or replayed clicks',async t=>{
  const f=await fixture(t,['a']);
  await assert.rejects(()=>f.trigger('other'),/Registered worker/);
  await f.trigger();await assert.rejects(()=>f.trigger(),/EEXIST/);
  await f.finish();await assert.rejects(()=>f.trigger('a','next'),/worker_already_finished/);
});

test('explicit pause stops further browser reads and cannot be overwritten by sealed',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();let calls=0;
  const result=await f.collect({readRecords:async()=>{
    calls++;
    await writeFile(join(f.outputDir,'control.json'),JSON.stringify({state:'paused'}));
    return [f.row('saved')];
  }});
  assert.equal(calls,1);
  assert.equal(result.candidates.length,1);
  assert.equal(result.failure_reason,'pool_paused');
  assert.equal(JSON.parse(await readFile(join(f.outputDir,'control.json'))).state,'paused');
});

test('pause arriving during the last empty read wins over successful sealing',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();let calls=0;
  const result=await f.collect({discoveryGraceMs:5,readRecords:async()=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,20));
    await writeFile(join(f.outputDir,'control.json'),JSON.stringify({state:'paused',reason:'user_pause'}));
    return [];
  }});
  assert.equal(calls,1);
  assert.equal(result.capture_status,'partial_pool');
  assert.equal(result.failure_reason,'pool_paused');
  assert.deepEqual(JSON.parse(await readFile(join(f.outputDir,'control.json'))),{state:'paused',reason:'user_pause'});
  assert.equal(JSON.parse(await readFile(join(f.outputDir,'closed.json'))).state,'paused');
  await assert.rejects(()=>f.trigger('a','late'),/pool_not_accepting/);
});

test('later source removal preserves a stable copy with its original receipt snapshot',async t=>{
  const f=await fixture(t,['a']);await f.trigger();await f.finish();let calls=0;
  const row=f.row('saved');
  const result=await f.collect({readRecords:async()=>{if(++calls>1)row.removed=true;return [row];}});
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].audit.record.removed,false);
  assert.equal(result.quarantined_records[0].removed,true);
  assert.deepEqual(await readFile(result.candidates[0].candidate_path),f.data);
  assert.equal(result.capture_status,'partial_pool');
});

test('atomic records tolerate transient Windows rename denial without exposing partial JSON',async t=>{
  const originalRename=fs.rename;
  let denied=0;
  const mocked=t.mock.method(fs,'rename',async (...args)=>{
    if (denied<2) {denied++;throw Object.assign(Error('transient sharing denial'),{code:'EPERM'});}
    return originalRename(...args);
  });
  syncBuiltinESMExports();
  try {
    const f=await fixture(t,['a']);
    assert.equal(f.started.capture_status,'pool_started');
    assert.equal(denied,2);
    await f.trigger();await f.finish();
    assert.equal((await f.collect()).capture_status,'pool_collected');
  } finally {mocked.mock.restore();syncBuiltinESMExports();}
});

test('permanent record replacement errors stay failed with bounded retries and no temporary files',async t=>{
  for (const [code,expectedCalls] of [['EPERM',5],['EINVAL',1]]) {
    let calls=0;
    const mocked=t.mock.method(fs,'rename',async ()=>{
      calls++;throw Object.assign(Error('replacement failed'),{code});
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(()=>fixture(t,['a']),/replacement failed/);
      assert.equal(calls,expectedCalls);
    } finally {mocked.mock.restore();syncBuiltinESMExports();}
  }
});
