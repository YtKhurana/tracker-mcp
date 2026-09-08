import assert from 'node:assert/strict';
import test from 'node:test';
import { runSessionOpen, runSessionControl } from '../dist/session.js';
const id = '12345678-1234-4234-8234-123456789abc';
test('session adapters validate before dispatch', async () => {
  const client = {request:async () => assert.fail('invalid input reached Java')};
  for (const args of [null, [], {}, {path:'relative.mp4'}, {path:'/a\0.mp4'}, {path:'/a.mp4',timeout_ms:0}, {path:'/a.mp4',timeout_ms:120001}, {path:'/a.mp4',timeout_ms:1.1}, {path:'/a.mp4',extra:true}])
    assert.equal((await runSessionOpen(args,client)).error.code,'INVALID_ARGUMENT');
  for (const args of [{}, {session_id:id,action:'save'}, {session_id:id,action:'save',path:'/a.csv'}, {session_id:id,action:'close',path:'/a.trz'}, {session_id:'bad',action:'status'}, {session_id:id,action:'other'}])
    assert.equal((await runSessionControl(args,client)).error.code,'INVALID_ARGUMENT');
});
test('session adapters forward exact requests and preserve service envelopes', async () => {
  const calls=[]; let result={ok:true,session_id:id};
  const client={request:async(...args)=>{calls.push(args);return result;}};
  assert.equal(await runSessionOpen({path:'/a.mp4'},client),result);
  assert.deepEqual(calls.pop(),['open',{path:'/a.mp4',timeout_ms:60000},70000]);
  await runSessionOpen({path:'/a.mp4',timeout_ms:120000},client);
  assert.equal(calls.pop()[2],130000);
  for (const action of ['status','save','close']) {
    const args={session_id:id,action,...(action==='save'?{path:'/new.trz'}:{})};
    assert.equal(await runSessionControl(args,client),result);
    assert.deepEqual(calls.pop(),['control',args,70000]);
  }
  for (const code of ['NO_SESSION','SESSION_BUSY','TIMEOUT','JAVA_EXIT','SAVE_FAILED','VIDEO_DECODE']) {
    result={ok:false,error:{code,message:'error',details:{}}};
    assert.equal(await runSessionOpen({path:'/a.mp4'},client),result);
  }
});
