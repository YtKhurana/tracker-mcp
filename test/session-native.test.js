import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync,mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMcp } from './helpers/mcp.js';
import { serviceRoot } from './helpers/service.js';
test('native MCP session busy/save/close/stale/reopen', {skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:90000},async()=>{
  const mcp=await startMcp(); const output=mkdtempSync(path.join(tmpdir(),'tracker-session-test-'));
  try {
    const input=path.join(serviceRoot,'fixtures/official/service-generated.trz');
    const opened=await mcp.call('session_open',{path:input}); assert.equal(opened.ok,true,JSON.stringify(opened));
    const session_id=opened.session_id;
    assert.equal((await mcp.call('session_open',{path:input})).error.code,'SESSION_BUSY');
    const state=await mcp.call('session_control',{session_id,action:'status'});
    assert.equal(state.ok,true); assert.equal(state.dirty,false);
    const saved=await mcp.call('session_control',{session_id,action:'save',path:path.join(output,'saved.trz')});
    assert.equal(saved.ok,true,JSON.stringify(saved));
    for(const p of [saved.trk_path,saved.trz_path]) {assert.ok(path.isAbsolute(p));assert.ok(existsSync(p));}
    assert.equal((await mcp.call('session_control',{session_id,action:'close'})).closed,true);
    assert.equal((await mcp.call('session_control',{session_id,action:'status'})).error.code,'NO_SESSION');
    const reopened=await mcp.call('session_open',{path:saved.trz_path}); assert.equal(reopened.ok,true,JSON.stringify(reopened));
    const after=await mcp.call('session_control',{session_id:reopened.session_id,action:'status'});
    assert.deepEqual(after.tracks,state.tracks); assert.deepEqual(after.coords,state.coords);
    await mcp.call('session_control',{session_id:reopened.session_id,action:'close'});
    assert.ok(existsSync(saved.trz_path));
  } finally {await mcp.close();}
});
