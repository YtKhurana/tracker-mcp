import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {runDataExport,runFrameGet} from '../dist/output.js';
const session_id='12345678-1234-4234-8234-123456789abc';
test('export/frame prevalidation rejects bad paths/columns/frames without dispatch',async()=>{
  const client={request:async()=>assert.fail('invalid output dispatched')};
  for(const args of [{columns:[]},{columns:['x','x']},{columns:['unknown']},{format:'json',path:'/a.csv'},{path:'relative.csv'},{format:'xml'}])assert.equal((await runDataExport({session_id,track:'A',...args},client)).error.code,'INVALID_ARGUMENT');
  for(const args of [{frame:-1},{frame:1.1},{frame:0,path:'/a.jpg'},{frame:100000}])assert.equal((await runFrameGet({session_id,...args},client)).error.code,'INVALID_ARGUMENT');
});
test('export/frame forward defaults and allocate distinct persistent absolute PNG paths',async()=>{
  const calls=[];const result={ok:true};const client={request:async(...args)=>{calls.push(args);return result;}};
  assert.equal(await runDataExport({session_id,track:'A'},client),result);
  assert.deepEqual(calls.pop(),['export',{session_id,track:'A',columns:['t','x','y','vx','vy'],format:'csv'},70000]);
  await runDataExport({session_id,track:'A',format:'json',columns:['y','t'],path:'/a.json'},client);
  assert.deepEqual(calls.pop(),['export',{session_id,track:'A',format:'json',columns:['y','t'],path:'/a.json'},70000]);
  await runFrameGet({session_id,frame:7,path:'/a.png'},client);assert.deepEqual(calls.pop(),['frame',{session_id,frame:7,path:'/a.png'},70000]);
  await runFrameGet({session_id,frame:0},client);const first=calls.pop()[1].path;
  await runFrameGet({session_id,frame:0},client);const second=calls.pop()[1].path;
  assert.ok(path.isAbsolute(first));assert.notEqual(first,second);
});
test('output errors remain structured and uncertain PNG destinations are reported',async()=>{
  const error={ok:false,error:{code:'TIMEOUT',message:'uncertain',details:{}}};const client={request:async()=>error};
  assert.equal(await runDataExport({session_id,track:'A'},client),error);
  const result=await runFrameGet({session_id,frame:0,path:'/a.png'},client);
  assert.equal(result.error.code,'TIMEOUT');assert.equal(result.error.details.attempted_path,'/a.png');
});
