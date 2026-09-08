import assert from 'node:assert/strict';
import {constants,copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {parseCsvTable} from '../dist/csv.js';
import {readZipEntry} from '../dist/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const verifiedSha='e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5';
const baselineCsvSha='d7dcf854fd94129df50a5dbd9e1a7a346a51a454d185ff5d9c4035c48bf83c70';
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');

function trustedJobC(sourcePath) {
  assert.ok(path.isAbsolute(sourcePath),'source project must be absolute');
  sourcePath=realpathSync(sourcePath);
  assert.equal(hash(sourcePath),verifiedSha,'source is not the human-verified Job C artifact');
  const manifestPath=path.join(path.dirname(sourcePath),'run.json');
  assert.ok(existsSync(manifestPath),'trusted Job C run.json is missing beside the source project');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.equal(manifest?.job,'C','source project must be accompanied by a Job C run.json');
  const trz=manifest?.artifacts?.trz,csv=manifest?.artifacts?.csv;
  for(const [name,artifact] of [['TRZ',trz],['CSV',csv]]) {
    assert.ok(artifact&&typeof artifact==='object',`trusted Job C ${name} evidence is missing`);
    assert.equal(typeof artifact.path,'string',`trusted Job C ${name} path is invalid`);
    assert.ok(path.isAbsolute(artifact.path),`Job C ${name} path must be absolute`);
    assert.equal(typeof artifact.sha256,'string',`trusted Job C ${name} hash is invalid`);
  }
  assert.equal(trz.sha256,verifiedSha,'trusted Job C run.json records an unexpected TRZ hash');
  assert.equal(realpathSync(trz.path),sourcePath,'source project does not match the trusted Job C run.json');
  assert.equal(csv.sha256,baselineCsvSha,'trusted Job C run.json records an unexpected baseline CSV hash');
  assert.ok(existsSync(csv.path),'trusted Job C baseline CSV is missing');
  const baselinePath=realpathSync(csv.path);
  assert.equal(hash(baselinePath),baselineCsvSha,'trusted Job C baseline CSV hash changed');
  return {sourcePath,manifestPath:realpathSync(manifestPath),baseline:{path:baselinePath,sha256:baselineCsvSha}};
}

async function waitForOwnedServiceExit(pid) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    try {process.kill(pid,0);}
    catch(error) {
      if(error?.code==='ESRCH') return;
      throw error;
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.fail(`owned Java service ${pid} survived client shutdown`);
}

function compareCsv(expectedText,actualText) {
  const expected=parseCsvTable(expectedText),actual=parseCsvTable(actualText);
  assert.deepEqual(actual.columns,['t','x','y','vx','vy']);
  assert.deepEqual(actual.columns,expected.columns);
  assert.equal(actual.rows.length,12);assert.equal(actual.rows.length,expected.rows.length);
  let numericCells=0,blankCells=0,maxAbsoluteError=0;
  actual.rows.forEach((row,rowIndex)=>row.forEach((cell,columnIndex)=>{
    const baseline=expected.rows[rowIndex][columnIndex];
    assert.equal(cell==='',baseline==='','reopened export changed the blank-value mask');
    if(cell==='') {blankCells++;return;}
    const value=Number(cell),expectedValue=Number(baseline);
    assert.ok(Number.isFinite(value)&&Number.isFinite(expectedValue),'export contains a nonnumeric value');
    const difference=Math.abs(value-expectedValue);maxAbsoluteError=Math.max(maxAbsoluteError,difference);
    assert.ok(difference<=1e-9,`reopened data changed at row ${rowIndex}, column ${columnIndex}`);
    numericCells++;
  }));
  assert.equal(numericCells,56);assert.equal(blankCells,4);
  return {columns:actual.columns,rows:actual.rows.length,numericCells,blankCells,maxAbsoluteError,byteIdentical:actualText===expectedText};
}

export async function runJobD(sourcePath=path.join(root,'service/build/final-mcp-v1-videos-layout/golden.trz'),runDir,options={}) {
  const trusted=trustedJobC(sourcePath);sourcePath=trusted.sourcePath;
  const sourceCsv=trusted.baseline.path;
  if(runDir===undefined) runDir=path.join(root,'service/build',`job-d-${Date.now()}-${process.pid}`);
  assert.ok(path.isAbsolute(runDir),'run directory must be absolute');
  mkdirSync(runDir); // Existing directories are never reused.
  runDir=realpathSync(runDir);
  const inputDir=path.join(runDir,'relocated-input'),outputDir=path.join(runDir,'outputs');
  mkdirSync(inputDir);mkdirSync(outputDir);
  const relocated=path.join(inputDir,'verified-job-c.trz');
  copyFileSync(sourcePath,relocated,constants.COPYFILE_EXCL);
  assert.deepEqual(readdirSync(inputDir),['verified-job-c.trz'],'relocated input directory must contain only the archive');
  assert.equal(hash(relocated),verifiedSha,'relocation changed the verified artifact');

  const fixture=JSON.parse(readFileSync(path.join(root,'fixtures/golden/manifest.json'),'utf8'));
  const expectedMarks=fixture.track.marks.map(mark=>[mark.frame,mark.x,mark.y]);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:root,stderr:'pipe'});
  const client=new Client({name:'tracker-job-d',version:'1.0'});
  let sessionId,closed=false,stderr='',servicePid,run;
  const call=async(name,args)=>{
    const response=await client.callTool({name,arguments:args},undefined,{timeout:150000});
    const body=JSON.parse(response.content[0].text);
    assert.equal(body.ok,true,`${name}: ${JSON.stringify(body)}${stderr?`\n${stderr}`:''}`);
    assert.notEqual(response.isError,true,`${name} marked as error`);
    return body;
  };
  try {
    await client.connect(transport);transport.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-16384);});
    const beforeOpen=await call('tracker_status',{probe_service:false});
    assert.equal(beforeOpen.service,null,'tracker_status without probe must not launch Java');
    const probed=await call('tracker_status',{probe_service:true});
    servicePid=probed.service?.pid;
    assert.equal(probed.service?.running,true,'tracker_status probe did not start Java');
    assert.ok(Number.isInteger(servicePid)&&servicePid>0,'tracker_status probe did not return an integer Java PID');
    options.onServiceStarted?.(servicePid);
    const opened=await call('session_open',{path:relocated});sessionId=opened.session_id;
    if(options.injectFailureAfterOpen) throw new Error('injected Job D failure after session open');
    const status=await call('session_control',{session_id:sessionId,action:'status'});
    assert.equal(status.dirty,false,'a reopened project must start clean');
    assert.deepEqual(status.tracks,[{name:fixture.track.name,type:fixture.track.type,mass:fixture.track.mass,mark_count:expectedMarks.length}]);
    assert.equal(status.coords.origin_x,fixture.calibration.origin_x);assert.equal(status.coords.origin_y,fixture.calibration.origin_y);
    assert.equal(status.coords.scale,fixture.calibration.scale_px_per_world_unit);assert.equal(status.coords.length_unit,fixture.calibration.length_unit);
    assert.ok(Math.abs(status.coords.angle_rad-fixture.calibration.angle_rad)<=Number.EPSILON,'reopened angle changed');

    const csv=path.join(outputDir,'reopened.csv');
    const exported=await call('data_export',{session_id:sessionId,track:fixture.track.name,path:csv});
    assert.equal(exported.path,csv,'data_export did not write the canonical reopened CSV');
    assert.deepEqual(exported.columns,['t','x','y','vx','vy']);assert.equal(exported.row_count,12);assert.equal(exported.format,'csv');
    const expectedTrz=path.join(outputDir,'reopened.trz'),expectedTrk=path.join(outputDir,'reopened.trk');
    const saved=await call('session_control',{session_id:sessionId,action:'save',path:expectedTrz});
    assert.equal(saved.trz_path,expectedTrz,'save did not write the canonical reopened TRZ');
    assert.equal(saved.trk_path,expectedTrk,'save did not derive the canonical reopened TRK');
    const close=await call('session_control',{session_id:sessionId,action:'close'});closed=close.closed===true;
    assert.equal(closed,true,'session did not close');

    const sourceMarks=await call('data_read',{path:relocated,track:fixture.track.name});
    const savedMarks=await call('data_read',{path:saved.trz_path,track:fixture.track.name});
    assert.deepEqual(sourceMarks.rows,expectedMarks,'relocated input marks changed');
    assert.deepEqual(savedMarks.rows,expectedMarks,'resaved marks changed');
    const comparison=compareCsv(readFileSync(sourceCsv,'utf8'),readFileSync(csv,'utf8'));
    const mediaNames=readdirSync(outputDir).filter(name=>/^reopened-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i.test(name));
    assert.equal(mediaNames.length,1,'save must publish exactly one reopened-<UUID>.mp4 companion video');
    const media=path.join(outputDir,mediaNames[0]);
    const artifactPaths={csv,trk:saved.trk_path,trz:saved.trz_path,media};
    for(const file of Object.values(artifactPaths)) {assert.ok(path.isAbsolute(file));assert.ok(existsSync(file));assert.notEqual(file,sourcePath);assert.notEqual(file,relocated);}
    assert.deepEqual(readdirSync(outputDir).sort(),Object.values(artifactPaths).map(file=>path.basename(file)).sort(),'canonical output directory contains unexpected artifacts');
    const sourceArchiveMedia=readZipEntry(readFileSync(sourcePath),'videos/media.mp4');
    const savedArchiveMedia=readZipEntry(readFileSync(saved.trz_path),'videos/media.mp4');
    assert.equal(sourceArchiveMedia.ok,true,'accepted Job C archive is missing videos/media.mp4');
    assert.equal(savedArchiveMedia.ok,true,'saved archive is missing videos/media.mp4');
    const companionSha256=hash(media),sourceArchiveSha256=hashBytes(sourceArchiveMedia.data),savedArchiveSha256=hashBytes(savedArchiveMedia.data);
    assert.equal(companionSha256,sourceArchiveSha256,'companion media changed accepted archive bytes');
    assert.equal(companionSha256,savedArchiveSha256,'companion media changed saved archive bytes');
    const artifacts=Object.fromEntries(Object.entries(artifactPaths).map(([key,file])=>[key,{path:file,sha256:hash(file)}]));
    const manifestPath=path.join(runDir,'run.json');
    run={
      job:'D',
      input:{path:sourcePath,sha256:verifiedSha,relocated_path:relocated,relocated_sha256:hash(relocated),trusted_job_c_manifest_path:trusted.manifestPath},
      baseline:trusted.baseline,
      service:{before_open:{service:beforeOpen.service},probe:{running:probed.service.running,pid:servicePid},pid:servicePid,terminated_after_client_close:false},
      status,expected_marks:expectedMarks,marks:savedMarks.rows,comparison,artifacts,
      media:{companion_sha256:companionSha256,source_archive_sha256:sourceArchiveSha256,saved_archive_sha256:savedArchiveSha256},manifest_path:manifestPath,
    };
  } finally {
    if(sessionId&&!closed) {
      try {await call('session_control',{session_id:sessionId,action:'close'});} catch {}
    }
    try {await client.close();}
    finally {if(servicePid!==undefined) await waitForOwnedServiceExit(servicePid);}
  }
  assert.ok(run,'Job D did not produce a run record');
  run.service.terminated_after_client_close=true;
  writeFileSync(run.manifest_path,JSON.stringify(run,null,2)+'\n',{flag:'wx'});
  return run;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runJobD(process.argv[2]===undefined?undefined:path.resolve(process.argv[2]),process.argv[3]===undefined?undefined:path.resolve(process.argv[3])),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
