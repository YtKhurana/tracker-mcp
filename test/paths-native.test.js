import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,readlinkSync,readdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startMcp} from './helpers/mcp.js';
import {serviceRoot} from './helpers/service.js';
test('native path contract: no overwrite, symlink leaves, companion collisions, canonical parents',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:90000},async()=>{
  const mcp=await startMcp();const dir=mkdtempSync(path.join(tmpdir(),'tracker-path-test-'));
  try {
    assert.equal((await mcp.call('session_open',{path:'relative.trz'})).error.code,'INVALID_ARGUMENT');
    const opened=await mcp.call('session_open',{path:path.join(serviceRoot,'fixtures/official/service-generated.trz')});assert.equal(opened.ok,true);
    const session_id=opened.session_id,track='synthetic mass';
    await mcp.call('coords_set',{session_id,origin_x:96});
    for(const [tool,args] of [['session_control',{action:'save',path:'relative.trz'}],['data_export',{track,path:'relative.csv'}],['frame_get',{frame:0,path:'relative.png'}]])assert.equal((await mcp.call(tool,{session_id,...args})).error.code,'INVALID_ARGUMENT');
    const missing=path.join(dir,'absent');assert.equal((await mcp.call('data_export',{session_id,track,path:path.join(missing,'data.csv')})).error.code,'SAVE_FAILED');assert.equal(existsSync(missing),false);
    const target=path.join(dir,'keep.txt');writeFileSync(target,'keep');
    const csvLink=path.join(dir,'link.csv');symlinkSync(target,csvLink);
    assert.equal((await mcp.call('data_export',{session_id,track,path:csvLink})).error.code,'SAVE_FAILED');assert.equal(readlinkSync(csvLink),target);assert.equal(readFileSync(target,'utf8'),'keep');
    const pngLink=path.join(dir,'dangling.png'),absentTarget=path.join(dir,'never-created');symlinkSync(absentTarget,pngLink);
    assert.equal((await mcp.call('frame_get',{session_id,frame:0,path:pngLink})).error.code,'SAVE_FAILED');assert.equal(readlinkSync(pngLink),absentTarget);assert.equal(existsSync(absentTarget),false);
    writeFileSync(path.join(dir,'collision.trk'),'keep project');const before=readdirSync(dir).sort();
    assert.equal((await mcp.call('session_control',{session_id,action:'save',path:path.join(dir,'collision.trz')})).error.code,'SAVE_FAILED');assert.deepEqual(readdirSync(dir).sort(),before);assert.equal(readFileSync(path.join(dir,'collision.trk'),'utf8'),'keep project');
    for(const basename of ['.trz','bad\\name.trz','bad:name.trz','bad\u0001name.trz']) {
      const beforeUnsafe=readdirSync(dir).sort();
      const rejected=await mcp.call('session_control',{session_id,action:'save',path:path.join(dir,basename)});
      assert.equal(rejected.error.code,'INVALID_ARGUMENT',`unsafe save basename accepted: ${JSON.stringify(basename)}`);
      assert.deepEqual(readdirSync(dir).sort(),beforeUnsafe,'unsafe basename left a save artifact or staging directory');
      assert.equal((await mcp.call('session_control',{session_id,action:'status'})).dirty,true);
    }
    const real=path.join(dir,'real'),alias=path.join(dir,'alias');mkdirSync(real);symlinkSync(real,alias);
    const exported=await mcp.call('data_export',{session_id,track,path:path.join(alias,'data.csv')});assert.equal(exported.ok,true);assert.equal(exported.path,path.join(realpathSync(real),'data.csv'));
    const saved=await mcp.call('session_control',{session_id,action:'save',path:path.join(alias,'final.trz')});assert.equal(saved.ok,true,JSON.stringify(saved));
    for(const p of [saved.trk_path,saved.trz_path])assert.equal(path.dirname(p),realpathSync(real));
    assert.equal((await mcp.call('session_control',{session_id,action:'status'})).ok,true);
  } finally {await mcp.close();}
});
