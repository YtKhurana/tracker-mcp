import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {compareOfficial} from './verify-official.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

export async function runJobC(outputDir) {
  if(outputDir!==undefined) {
    assert.ok(path.isAbsolute(outputDir),'output directory must be absolute');
    mkdirSync(outputDir); // Existing directories are never reused.
  } else {
    const base=path.join(root,'service/build');mkdirSync(base,{recursive:true});
    outputDir=mkdtempSync(path.join(base,'job-c-'));
  }
  outputDir=realpathSync(outputDir);
  const fixture=JSON.parse(readFileSync(path.join(root,'fixtures/golden/manifest.json'),'utf8'));
  const video=path.join(root,'fixtures/golden',fixture.video.path);
  assert.equal(hash(video),fixture.artifacts[fixture.video.path],'fixture media hash changed');
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:root,stderr:'pipe'});
  const client=new Client({name:'tracker-job-c',version:'1.0'});
  const call=async(name,args)=>{
    const response=await client.callTool({name,arguments:args},undefined,{timeout:150000});
    const body=JSON.parse(response.content[0].text);
    assert.equal(body.ok,true,`${name}: ${JSON.stringify(body)}`);
    assert.notEqual(response.isError,true,`${name} marked as error`);
    return body;
  };
  try {
    await client.connect(transport);transport.stderr?.on('data',()=>{});
    await call('tracker_status',{probe_service:true});
    const opened=await call('session_open',{path:video});const session_id=opened.session_id;
    const {scale_px_per_world_unit,...calibration}=fixture.calibration;
    await call('coords_set',{session_id,...calibration,scale:scale_px_per_world_unit});
    await call('track_create',{session_id,name:fixture.track.name,type:fixture.track.type,mass:fixture.track.mass});
    await call('mark_set',{session_id,track:fixture.track.name,marks:fixture.track.marks});
    const state=await call('session_control',{session_id,action:'status'});
    const csv=path.join(outputDir,'golden.csv');await call('data_export',{session_id,track:fixture.track.name,path:csv});
    const saved=await call('session_control',{session_id,action:'save',path:path.join(outputDir,'golden.trz')});
    await call('session_control',{session_id,action:'close'});
    const marks=await call('data_read',{path:saved.trz_path,track:fixture.track.name});
    assert.deepEqual(marks.rows,fixture.track.marks.map(m=>[m.frame,m.x,m.y]));
    const official=path.join(root,'fixtures/official/official.csv');
    const comparison=compareOfficial(readFileSync(official,'utf8'),readFileSync(csv,'utf8'));
    const artifacts=Object.fromEntries(Object.entries({csv,trk:saved.trk_path,trz:saved.trz_path}).map(([key,file])=>[key,{path:file,sha256:hash(file)}]));
    const manifest_path=path.join(outputDir,'run.json');
    const run={job:'C',official_check_required:true,input_sha256:hash(video),official_csv_sha256:hash(official),comparison,coords:state.coords,marks:marks.rows,artifacts,manifest_path};
    writeFileSync(manifest_path,JSON.stringify(run,null,2)+'\n',{flag:'wx'});
    return run;
  } finally {await client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runJobC(process.argv[2]),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
