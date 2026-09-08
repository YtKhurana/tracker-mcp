import assert from 'node:assert/strict';
import test from 'node:test';
import {runCoordsSet,runTrackCreate,runMarkSet} from '../dist/session.js';
const session_id='12345678-1234-4234-8234-123456789abc';
test('mutation adapters reject entire invalid batches before dispatch',async()=>{
  const client={request:async()=>assert.fail('invalid mutation dispatched')};
  for(const args of [{scale:0},{scale:1e-10},{angle_rad:Infinity},{frame:-1},{length_unit:'m2'}]) assert.equal((await runCoordsSet({session_id,...args},client)).error.code,'INVALID_ARGUMENT');
  for(const args of [{name:''},{name:'a',mass:1e-31},{name:'a',mass:NaN}]) assert.equal((await runTrackCreate({session_id,...args},client)).error.code,'INVALID_ARGUMENT');
  assert.equal((await runTrackCreate({session_id,name:'a',type:'vector'},client)).error.code,'UNSUPPORTED_TYPE');
  for(const args of [{marks:[{frame:0,x:1}]},{marks:[{frame:0,x:1,y:2},{frame:0,x:2,y:3}]},{clear:true,marks:[{frame:0,x:1,y:2}]},{marks:[{frame:100000,x:1,y:2}]},{marks:[{frame:0,x:1,y:NaN}]}]) assert.equal((await runMarkSet({session_id,track:'a',...args},client)).error.code,'INVALID_ARGUMENT');
});
test('mutations forward defaults, boundaries and preserve returned errors',async()=>{
  const calls=[];let result={ok:true};const client={request:async(...a)=>{calls.push(a);return result;}};
  await runCoordsSet({session_id,scale:1e-9},client);assert.deepEqual(calls.pop(),['coords',{session_id,frame:0,scale:1e-9},70000]);
  await runTrackCreate({session_id,name:'a'},client);assert.deepEqual(calls.pop(),['track',{session_id,name:'a',type:'point_mass',mass:1},70000]);
  const calibration={session_id,frame:7,origin_x:96,origin_y:168,angle_rad:Math.PI/6,scale:40,length_unit:'m'};
  await runCoordsSet(calibration,client);assert.deepEqual(calls.pop(),['coords',calibration,70000]);
  await runTrackCreate({session_id,name:'B',mass:2},client);assert.deepEqual(calls.pop(),['track',{session_id,name:'B',type:'point_mass',mass:2},70000]);
  for(const args of [{marks:[{frame:99999,x:1e12,y:-1e12}]},{clear:true,marks:[{frame:0}]}]) {
    assert.equal(await runMarkSet({session_id,track:'a',...args},client),result);
    assert.deepEqual(calls.pop(),['mark',{session_id,track:'a',clear:false,...args},70000]);
  }
  result={ok:false,error:{code:'NO_SESSION',message:'stale',details:{}}};
  assert.equal(await runCoordsSet({session_id},client),result);
});
