import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync,mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { startMcp } from './helpers/mcp.js';
import { serviceRoot } from './helpers/service.js';
test('native MCP session busy/save/close/stale/reopen', {skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:90000},async()=>{
  const mcp=await startMcp(); const output=mkdtempSync(path.join(tmpdir(),'tracker-session-test-'));
  try {
    assert.equal((await mcp.call('session_open',{path:path.join(output,'absent.mp4')})).error.code,'NOT_FOUND');
    const malformed=path.join(output,'malformed.trk');writeFileSync(malformed,'<object');
    assert.equal((await mcp.call('session_open',{path:malformed})).error.code,'PARSE_FAILED');
    const input=path.join(serviceRoot,'fixtures/official/service-generated.trz');
    const opened=await mcp.call('session_open',{path:input}); assert.equal(opened.ok,true,JSON.stringify(opened));
    const session_id=opened.session_id;
    assert.equal((await mcp.call('session_open',{path:input})).error.code,'SESSION_BUSY');
    const state=await mcp.call('session_control',{session_id,action:'status'});
    assert.equal(state.ok,true); assert.equal(state.dirty,false);
    const archiveVariants=[['lower','archive.trz'],['upper','Archive.trz']];
    for(const [directory,basename] of archiveVariants) {
      const variant=path.join(output,directory);mkdirSync(variant);
      const variantSaved=await mcp.call('session_control',{session_id,action:'save',path:path.join(variant,basename)});assert.equal(variantSaved.ok,true,JSON.stringify(variantSaved));
      const entries=spawnSync('unzip',['-Z1',variantSaved.trz_path],{encoding:'utf8'});assert.equal(entries.status,0,entries.stderr);
      assert.deepEqual(entries.stdout.trim().split('\n').sort(),['project.trk','videos/media.mp4']);
      for(const project of [variantSaved.trk_path,variantSaved.trz_path]) {
        const variantOpened=await mcp.call('session_open',{path:project});assert.equal(variantOpened.error?.code,'SESSION_BUSY');
      }
    }
    const saved=await mcp.call('session_control',{session_id,action:'save',path:path.join(output,'saved.trz')});
    assert.equal(saved.ok,true,JSON.stringify(saved));
    for(const p of [saved.trk_path,saved.trz_path]) {assert.ok(path.isAbsolute(p));assert.ok(existsSync(p));}
    assert.equal((await mcp.call('session_control',{session_id,action:'close'})).closed,true);
    assert.equal((await mcp.call('session_control',{session_id,action:'status'})).error.code,'NO_SESSION');
    const standalone=await mcp.call('session_open',{path:saved.trk_path});assert.equal(standalone.ok,true,JSON.stringify(standalone));
    const standaloneState=await mcp.call('session_control',{session_id:standalone.session_id,action:'status'});
    assert.deepEqual(standaloneState.tracks,state.tracks);assert.deepEqual(standaloneState.coords,state.coords);
    await mcp.call('session_control',{session_id:standalone.session_id,action:'close'});
    const reopened=await mcp.call('session_open',{path:saved.trz_path}); assert.equal(reopened.ok,true,JSON.stringify(reopened));
    const after=await mcp.call('session_control',{session_id:reopened.session_id,action:'status'});
    assert.deepEqual(after.tracks,state.tracks); assert.deepEqual(after.coords,state.coords);
    await mcp.call('session_control',{session_id:reopened.session_id,action:'close'});
    for(const [directory,basename] of archiveVariants) {
      const variant=path.join(output,directory),trk=path.join(variant,basename.slice(0,-4)+'.trk'),trz=path.join(variant,basename);
      for(const project of [trk,trz]) {
        const variantOpened=await mcp.call('session_open',{path:project});assert.equal(variantOpened.ok,true,JSON.stringify(variantOpened));
        const variantState=await mcp.call('session_control',{session_id:variantOpened.session_id,action:'status'});
        assert.deepEqual(variantState.tracks,state.tracks);assert.deepEqual(variantState.coords,state.coords);
        const frame=await mcp.call('frame_get',{session_id:variantOpened.session_id,frame:0});assert.equal(frame.ok,true,JSON.stringify(frame));assert.equal(existsSync(frame.path),true);
        await mcp.call('session_control',{session_id:variantOpened.session_id,action:'close'});
      }
    }
    assert.ok(existsSync(saved.trz_path));
  } finally {await mcp.close();}
});
