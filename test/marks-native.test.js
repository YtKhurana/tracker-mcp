import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startMcp} from './helpers/mcp.js';
import {serviceRoot} from './helpers/service.js';
test('native MCP calibration/two masses/atomic invalid batch/replace/clear persist', {skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:90000},async()=>{
  const mcp=await startMcp();const dir=mkdtempSync(path.join(tmpdir(),'tracker-marks-test-'));
  try {
    const opened=await mcp.call('session_open',{path:path.join(serviceRoot,'fixtures/golden/synthetic-parabola.mp4')});assert.equal(opened.ok,true,JSON.stringify(opened));
    const session_id=opened.session_id;
    const coords=await mcp.call('coords_set',{session_id,origin_x:96,origin_y:168,angle_rad:Math.PI/6,scale:40,length_unit:'m'});assert.equal(coords.ok,true);
    // Direction-vector round trip has a deterministic one-ULP normalization.
    const normalizedAngle=Math.atan2(Math.sin(Math.PI/6),Math.cos(Math.PI/6));
    assert.deepEqual(coords.coords,{origin_x:96,origin_y:168,angle_rad:normalizedAngle,scale:40,length_unit:'m'});
    for(const name of ['A','B'])assert.equal((await mcp.call('track_create',{session_id,name,mass:2})).ok,true);
    assert.equal((await mcp.call('track_create',{session_id,name:'A'})).error.code,'INVALID_ARGUMENT');
    const marks=[{frame:0,x:48,y:190},{frame:1,x:59,y:183},{frame:2,x:72,y:176}];
    assert.equal((await mcp.call('mark_set',{session_id,track:'A',marks})).mark_count,3);
    assert.equal((await mcp.call('mark_set',{session_id,track:'A',marks:[{frame:0,x:999,y:999},{frame:12,x:1,y:2}]})).error.code,'INVALID_ARGUMENT');
    assert.equal((await mcp.call('mark_set',{session_id,track:'A',marks:[{frame:1,x:60,y:182}]})).ok,true);
    assert.equal((await mcp.call('mark_set',{session_id,track:'A',clear:true,marks:[{frame:2}]})).mark_count,2);
    const before=await mcp.call('session_control',{session_id,action:'status'});assert.equal(before.dirty,true);assert.deepEqual(before.tracks.map(t=>t.mark_count),[2,0]);
    assert.deepEqual(before.tracks.map(t=>t.mass),[2,2]);
    const saved=await mcp.call('session_control',{session_id,action:'save',path:path.join(dir,'marked.trz')});assert.equal(saved.ok,true,JSON.stringify(saved));
    assert.equal((await mcp.call('session_control',{session_id,action:'status'})).dirty,false);
    const stored=await mcp.call('data_read',{path:saved.trz_path,track:'A'});assert.deepEqual(stored.rows,[[0,48,190],[1,60,182]]);
    await mcp.call('session_control',{session_id,action:'close'});
    const reopened=await mcp.call('session_open',{path:saved.trz_path});assert.equal(reopened.ok,true);
    const after=await mcp.call('session_control',{session_id:reopened.session_id,action:'status'});
    assert.deepEqual(after.tracks,before.tracks);assert.deepEqual(after.coords,before.coords);
  } finally {await mcp.close();}
});
