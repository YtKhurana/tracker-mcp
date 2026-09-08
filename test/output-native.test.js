import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startMcp} from './helpers/mcp.js';
import {serviceRoot} from './helpers/service.js';
import {compareOfficial} from '../scripts/verify-official.mjs';
test('native MCP CSV/JSON columns and PNG pixels survive close without overwrites',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:90000},async()=>{
  const mcp=await startMcp();const dir=mkdtempSync(path.join(tmpdir(),'tracker-export-test-'));const outputs=[];
  try {
    const opened=await mcp.call('session_open',{path:path.join(serviceRoot,'fixtures/official/service-generated.trz')});assert.equal(opened.ok,true,JSON.stringify(opened));
    const session_id=opened.session_id;const track='synthetic mass';
    const inline=await mcp.call('data_export',{session_id,track});assert.equal(inline.ok,true,JSON.stringify(inline));
    compareOfficial(readFileSync(path.join(serviceRoot,'fixtures/official/official.csv'),'utf8'),inline.csv);
    const csv=path.join(dir,'data.csv');assert.equal((await mcp.call('data_export',{session_id,track,path:csv})).row_count,12);assert.equal(readFileSync(csv,'utf8'),inline.csv);
    assert.equal((await mcp.call('data_export',{session_id,track,path:csv})).error.code,'SAVE_FAILED');assert.equal(readFileSync(csv,'utf8'),inline.csv);
    const json=await mcp.call('data_export',{session_id,track,format:'json',columns:['vy','t','x']});assert.deepEqual(json.columns,['vy','t','x']);assert.equal(json.rows[0][0],null);assert.equal(json.rows[0][1],0);assert.equal(json.rows[0][2],inline.rows[0][1]);
    const jsonPath=path.join(dir,'data.json');assert.equal((await mcp.call('data_export',{session_id,track,format:'json',path:jsonPath,columns:['vy','t','x']})).ok,true);assert.deepEqual(JSON.parse(readFileSync(jsonPath,'utf8')),{columns:json.columns,rows:json.rows});
    assert.equal((await mcp.call('data_export',{session_id,track:'missing'})).error.code,'NOT_FOUND');
    await mcp.call('track_create',{session_id,name:'empty'});assert.equal((await mcp.call('data_export',{session_id,track:'empty'})).error.code,'EXPORT_EMPTY');
    for(const [frame,expected] of [[0,[48,190]],[7,[167,141]],[0,[48,190]]]) {
      const result=await mcp.call('frame_get',{session_id,frame});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.width,320);assert.equal(result.height,240);assert.ok(path.isAbsolute(result.path));outputs.push(result.path);
      const pixels=spawnSync('python3',['-c','import cv2,numpy as np,sys,json; im=cv2.imread(sys.argv[1]); ys,xs=np.where((im[:,:,2]>180)&(im[:,:,1]>160)&(im[:,:,0]<140)); print(json.dumps([round(float(xs.mean())),round(float(ys.mean()))]))',result.path],{encoding:'utf8',timeout:10000});assert.equal(pixels.status,0,pixels.stderr);assert.deepEqual(JSON.parse(pixels.stdout),expected);
    }
    assert.equal(new Set(outputs).size,3);
    const bytes=readFileSync(outputs[0]);assert.equal((await mcp.call('frame_get',{session_id,frame:7,path:outputs[0]})).error.code,'SAVE_FAILED');assert.deepEqual(readFileSync(outputs[0]),bytes);
    assert.equal((await mcp.call('frame_get',{session_id,frame:12,path:path.join(dir,'bad.png')})).error.code,'INVALID_ARGUMENT');
    await mcp.call('session_control',{session_id,action:'close'});
  } finally {await mcp.close();}
  for(const file of outputs)assert.ok(existsSync(file),'default output was deleted with Java runtime');
});
