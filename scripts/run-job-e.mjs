import assert from 'node:assert/strict';
import {constants,copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {parseCsvTable} from '../dist/csv.js';
import {readTrkFromZip,readZipEntry} from '../dist/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const verifiedSha='e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5';
const baselineCsvSha='d7dcf854fd94129df50a5dbd9e1a7a346a51a454d185ff5d9c4035c48bf83c70';
const MAX_SOURCE_TRZ_BYTES=64*1024*1024;
const MAX_MANIFEST_BYTES=1024*1024;
const MAX_BASELINE_CSV_BYTES=8*1024*1024;
const MAX_STANDALONE_TRK_BYTES=32*1024*1024;
const hash=value=>createHash('sha256').update(readFileSync(value)).digest('hex');
const hashBytes=value=>createHash('sha256').update(value).digest('hex');

function readBoundedRegularFile(file,label,maxBytes) {
  let canonical,details;
  try {canonical=realpathSync(file);details=statSync(canonical);}
  catch {assert.fail(`${label} is unavailable`);}
  assert.ok(details.isFile(),`${label} must be a canonical regular file`);
  assert.ok(details.size<=maxBytes,`${label} exceeds the ${maxBytes} byte limit`);
  let bytes;
  try {bytes=readFileSync(canonical);} catch {assert.fail(`${label} could not be read`);}
  assert.ok(bytes.length<=maxBytes,`${label} exceeds the ${maxBytes} byte limit`);
  return {path:canonical,bytes,sha256:hashBytes(bytes)};
}

function trustedJobC(sourcePath) {
  assert.ok(path.isAbsolute(sourcePath),'source project must be absolute');
  const source=readBoundedRegularFile(sourcePath,'source project',MAX_SOURCE_TRZ_BYTES);
  assert.equal(source.sha256,verifiedSha,'source is not the human-verified Job C artifact');
  const manifestFile=readBoundedRegularFile(path.join(path.dirname(source.path),'run.json'),'Job C run.json',MAX_MANIFEST_BYTES);
  const manifest=JSON.parse(manifestFile.bytes.toString('utf8'));
  assert.equal(manifest?.job,'C','source project must be accompanied by a Job C run.json');
  const trz=manifest?.artifacts?.trz,csv=manifest?.artifacts?.csv;
  for(const [name,artifact] of [['TRZ',trz],['CSV',csv]]) {
    assert.ok(artifact&&typeof artifact==='object',`trusted Job C ${name} evidence is missing`);
    assert.equal(typeof artifact.path,'string',`trusted Job C ${name} path is invalid`);
    assert.ok(path.isAbsolute(artifact.path),`Job C ${name} path must be absolute`);
    assert.equal(typeof artifact.sha256,'string',`trusted Job C ${name} hash is invalid`);
  }
  assert.equal(trz.sha256,verifiedSha,'trusted Job C run.json records an unexpected TRZ hash');
  const recordedSource=readBoundedRegularFile(trz.path,'Job C TRZ',MAX_SOURCE_TRZ_BYTES);
  assert.equal(recordedSource.path,source.path,'source project does not match the trusted Job C run.json');
  assert.equal(recordedSource.sha256,verifiedSha,'trusted Job C archive hash changed');
  assert.equal(csv.sha256,baselineCsvSha,'trusted Job C run.json records an unexpected baseline CSV hash');
  const baseline=readBoundedRegularFile(csv.path,'Job C baseline CSV',MAX_BASELINE_CSV_BYTES);
  assert.equal(baseline.sha256,baselineCsvSha,'trusted Job C baseline CSV hash changed');
  return {source,manifestPath:manifestFile.path,baseline:{path:baseline.path,sha256:baseline.sha256,bytes:baseline.bytes}};
}

async function waitForProcessExit(pid,label) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    try {process.kill(pid,0);}
    catch(error) {
      if(error?.code==='ESRCH') return;
      throw error;
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.fail(`${label} ${pid} survived owner shutdown`);
}

async function withFreshOwner(kind,options,action) {
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:root,stderr:'pipe'});
  const client=new Client({name:`tracker-job-e-${kind}`,version:'1.0'});
  let stderr='',sessionId,sessionClosed=false,mcpPid,servicePid;
  const owner={kind,mcp_pid:null,service_pid:null,before_open:null,probe:null,mcp_terminated_after_client_close:false,service_terminated_after_client_close:false};
  const call=async(name,args)=>{
    const response=await client.callTool({name,arguments:args},undefined,{timeout:150000});
    const body=JSON.parse(response.content[0].text);
    assert.equal(body.ok,true,`${name}: ${JSON.stringify(body)}${stderr?`\n${stderr}`:''}`);
    assert.notEqual(response.isError,true,`${name} marked as error`);
    return body;
  };
  const context={
    call,
    setSession(id) {sessionId=id;},
    async closeSession() {
      if(sessionId&&!sessionClosed) {
        const close=await call('session_control',{session_id:sessionId,action:'close'});
        assert.equal(close.closed,true,'session did not close');
        sessionClosed=true;
      }
    },
  };
  try {
    await client.connect(transport);
    transport.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-16384);});
    mcpPid=transport.pid;
    assert.ok(Number.isInteger(mcpPid)&&mcpPid>0,'stdio MCP owner did not expose an integer PID');
    owner.mcp_pid=mcpPid;
    if(kind==='mutation') options.onMutationMcpStarted?.(mcpPid);else options.onReopenMcpStarted?.(mcpPid);
    const beforeOpen=await call('tracker_status',{probe_service:false});
    assert.equal(beforeOpen.service,null,'tracker_status without probe must not launch Java');
    owner.before_open={service:beforeOpen.service};
    const probed=await call('tracker_status',{probe_service:true});
    servicePid=probed.service?.pid;
    assert.equal(probed.service?.running,true,'tracker_status probe did not start Java');
    assert.ok(Number.isInteger(servicePid)&&servicePid>0,'tracker_status probe did not return an integer Java PID');
    owner.service_pid=servicePid;owner.probe={running:probed.service.running,pid:servicePid};
    if(kind==='mutation') options.onMutationServiceStarted?.(servicePid);else options.onReopenServiceStarted?.(servicePid);
    const value=await action(context);
    return {owner,value};
  } finally {
    if(sessionId&&!sessionClosed) {
      try {await context.closeSession();} catch {}
    }
    try {await client.close();}
    finally {
      if(servicePid!==undefined) {await waitForProcessExit(servicePid,'owned Java service');owner.service_terminated_after_client_close=true;}
      if(mcpPid!==undefined) {await waitForProcessExit(mcpPid,'owned stdio MCP process');owner.mcp_terminated_after_client_close=true;}
    }
  }
}

function expectedMarks(fixture) {
  const replacement=fixture.mutation_cases.correction.replacement;
  return fixture.track.marks.filter(mark=>mark.frame!==5).map(mark=>[
    mark.frame,
    mark.frame===fixture.mutation_cases.correction.frame?replacement.x:mark.x,
    mark.frame===fixture.mutation_cases.correction.frame?replacement.y:mark.y,
  ]);
}

function toWorld(fixture,x,y) {
  const calibration=fixture.calibration,angle=calibration.angle_rad;
  const dx=x-calibration.origin_x,dy=y-calibration.origin_y,scale=calibration.scale_px_per_world_unit;
  return {
    x:(dx*Math.cos(angle)-dy*Math.sin(angle))/scale,
    y:-(dx*Math.sin(angle)+dy*Math.cos(angle))/scale,
  };
}

function expectedTable(fixture,marks) {
  const byFrame=new Map(marks.map(([frame,x,y])=>[frame,{x,y,world:toWorld(fixture,x,y)}]));
  const dt=fixture.video.frame_interval_seconds;
  return [...byFrame].sort(([left],[right])=>left-right).map(([frame,mark])=>{
    const previous=byFrame.get(frame-1),next=byFrame.get(frame+1);
    const velocity=previous&&next?{
      vx:(next.world.x-previous.world.x)/(2*dt),
      vy:(next.world.y-previous.world.y)/(2*dt),
    }:null;
    return {frame,t:frame*dt,x:mark.world.x,y:mark.world.y,vx:velocity?.vx??null,vy:velocity?.vy??null};
  });
}

function rowForFrame(table,frame,dt) {
  const row=table.rows.find(candidate=>Math.abs(Number(candidate[0])-frame*dt)<=1e-12);
  assert.ok(row,`CSV lacks a row for frame ${frame}`);
  return row;
}

function compareToOracle(text,expected,fixture,baselineText) {
  const actual=parseCsvTable(text),baseline=parseCsvTable(baselineText),dt=fixture.video.frame_interval_seconds;
  assert.deepEqual(actual.columns,['t','x','y','vx','vy']);
  assert.deepEqual(baseline.columns,actual.columns);
  assert.equal(actual.rows.length,expected.length,'CSV row membership changed');
  const derivativeBlankFrames=[],actualByFrame=[];
  let numericCells=0,blankCells=0,maxAbsoluteError=0;
  for(const expectation of expected) {
    const row=rowForFrame(actual,expectation.frame,dt);actualByFrame.push(row);
    for(const [index,name] of ['t','x','y','vx','vy'].entries()) {
      const value=row[index],wanted=expectation[name];
      if(wanted===null) {
        assert.equal(value,'',`frame ${expectation.frame} ${name} must be blank without both neighbours`);
        blankCells++;
        continue;
      }
      assert.notEqual(value,'',`frame ${expectation.frame} ${name} unexpectedly blank`);
      const number=Number(value);assert.ok(Number.isFinite(number),`frame ${expectation.frame} ${name} is not finite`);
      const error=Math.abs(number-wanted);maxAbsoluteError=Math.max(maxAbsoluteError,error);
      assert.ok(error<=1e-9,`frame ${expectation.frame} ${name} differs from independent oracle by ${error}`);
      numericCells++;
    }
    if(expectation.vx===null) derivativeBlankFrames.push(expectation.frame);
  }
  assert.equal(numericCells,47);assert.equal(blankCells,8);
  assert.deepEqual(derivativeBlankFrames,[0,4,6,11]);
  const actualFrame7=rowForFrame(actual,7,dt),baselineFrame7=rowForFrame(baseline,7,dt),actualFrame8=rowForFrame(actual,8,dt),baselineFrame8=rowForFrame(baseline,8,dt);
  const frame7VelocityMatchesBaseline=Math.max(Math.abs(Number(actualFrame7[3])-Number(baselineFrame7[3])),Math.abs(Number(actualFrame7[4])-Number(baselineFrame7[4])));
  assert.ok(frame7VelocityMatchesBaseline<=1e-9,'frame 7 velocity changed despite unchanged neighbours');
  const frame8VelocityChange=Math.max(Math.abs(Number(actualFrame8[3])-Number(baselineFrame8[3])),Math.abs(Number(actualFrame8[4])-Number(baselineFrame8[4])));
  assert.ok(frame8VelocityChange>1e-6,'frame 8 velocity did not change after replacing frame 7');
  return {columns:actual.columns,rows:actual.rows.length,numericCells,blankCells,derivative_blank_frames:derivativeBlankFrames,max_absolute_error:maxAbsoluteError,frame7_velocity_matches_baseline:frame7VelocityMatchesBaseline,frame8_velocity_change:frame8VelocityChange};
}

function assertProjectState(status,fixture,markCount) {
  const calibration=fixture.calibration;
  assert.equal(status.dirty,false,'reopened project must start clean');
  assert.deepEqual(status.tracks,[{name:fixture.track.name,type:fixture.track.type,mass:fixture.track.mass,mark_count:markCount}]);
  assertCoordinates(status,fixture);
}

function assertCoordinates(status,fixture) {
  const calibration=fixture.calibration;
  assert.equal(status.coords.origin_x,calibration.origin_x);assert.equal(status.coords.origin_y,calibration.origin_y);
  assert.equal(status.coords.scale,calibration.scale_px_per_world_unit);assert.equal(status.coords.length_unit,calibration.length_unit);
  assert.ok(Math.abs(status.coords.angle_rad-Math.atan2(Math.sin(calibration.angle_rad),Math.cos(calibration.angle_rad)))<=Number.EPSILON,'project angle changed');
}

function archiveEntries(archivePath) {
  const result=spawnSync('unzip',['-Z1',archivePath],{encoding:'utf8',maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  return result.stdout.trim().split('\n').filter(Boolean);
}

function assertArchiveLayout(sourceArchive,savedPath,mediaPath) {
  assert.deepEqual(archiveEntries(savedPath),['project.trk','videos/media.mp4'],'corrected archive layout is not the accepted project/media shape');
  const sourceMedia=readZipEntry(sourceArchive,'videos/media.mp4');
  const savedArchive=readFileSync(savedPath),savedMedia=readZipEntry(savedArchive,'videos/media.mp4');
  assert.equal(sourceMedia.ok,true,'accepted source archive is missing videos/media.mp4');
  assert.equal(savedMedia.ok,true,'corrected archive is missing videos/media.mp4');
  const embedded=readTrkFromZip(savedArchive,savedPath);
  assert.equal(embedded.ok,true,'corrected archive has no readable project.trk');assert.equal(embedded.name,'project.trk');
  assert.match(embedded.xml,/<property name="path" type="string">videos\/media\.mp4<\/property>/);
  const sourceMediaSha=hashBytes(sourceMedia.data),savedMediaSha=hashBytes(savedMedia.data),companionMediaSha=hash(mediaPath);
  assert.equal(companionMediaSha,sourceMediaSha,'companion media changed accepted source bytes');
  assert.equal(companionMediaSha,savedMediaSha,'archive media changed accepted source bytes');
  return {entries:['project.trk','videos/media.mp4'],source_media_sha256:sourceMediaSha,saved_media_sha256:savedMediaSha,companion_media_sha256:companionMediaSha};
}

function assertStandaloneTrk(trkPath,mediaPath,marks) {
  const trk=readBoundedRegularFile(trkPath,'corrected standalone .trk',MAX_STANDALONE_TRK_BYTES);
  const mediaName=path.basename(mediaPath),escaped=mediaName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(trk.bytes.toString('utf8'),new RegExp(`<property name="path" type="string">${escaped}</property>`));
  return {marks,media_path:mediaName,sha256:trk.sha256};
}

export async function runJobE(sourcePath=path.join(root,'service/build/final-mcp-v1-videos-layout/golden.trz'),runDir,options={}) {
  const trusted=trustedJobC(sourcePath);sourcePath=trusted.source.path;
  if(runDir===undefined) runDir=path.join(root,'service/build',`job-e-${Date.now()}-${process.pid}`);
  assert.ok(path.isAbsolute(runDir),'run directory must be absolute');
  mkdirSync(runDir); // Existing directories are never reused.
  runDir=realpathSync(runDir);
  const relocatedInput=path.join(runDir,'relocated-input'),mutationOutput=path.join(runDir,'mutation-output'),reopenOutput=path.join(runDir,'reopen-output');
  mkdirSync(relocatedInput);mkdirSync(mutationOutput);mkdirSync(reopenOutput);
  const relocated=path.join(relocatedInput,'verified-job-c.trz');
  copyFileSync(sourcePath,relocated,constants.COPYFILE_EXCL);
  assert.deepEqual(readdirSync(relocatedInput),['verified-job-c.trz'],'relocated input directory must contain only the archive');
  assert.equal(hash(relocated),verifiedSha,'relocation changed the verified artifact');

  const fixture=JSON.parse(readFileSync(path.join(root,'fixtures/golden/manifest.json'),'utf8'));
  const baselineMarks=fixture.track.marks.map(mark=>[mark.frame,mark.x,mark.y]);
  const correctedMarks=expectedMarks(fixture),expected=expectedTable(fixture,correctedMarks);
  const markDiff={cleared:[5],replaced:[{frame:7,before:[167,141],after:[180,137]}]};
  const baselineCsv=trusted.baseline.bytes.toString('utf8');

  const mutation=await withFreshOwner('mutation',options,async context=>{
    const opened=await context.call('session_open',{path:relocated});context.setSession(opened.session_id);
    const initialStatus=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(initialStatus,fixture,baselineMarks.length);
    const cleared=await context.call('mark_set',{session_id:opened.session_id,track:fixture.track.name,clear:true,marks:[{frame:5}]});
    assert.equal(cleared.mark_count,11,'clear did not remove exactly frame 5');
    const replaced=await context.call('mark_set',{session_id:opened.session_id,track:fixture.track.name,marks:[{frame:7,x:180,y:137}]});
    assert.equal(replaced.mark_count,11,'replacement changed the mark count');
    const status=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assert.equal(status.dirty,true,'mutation must make the session dirty before save');
    assert.deepEqual(status.tracks,[{name:fixture.track.name,type:fixture.track.type,mass:fixture.track.mass,mark_count:11}]);
    assertCoordinates(status,fixture);
    if(options.injectFailureAfterMutationBeforeSave) throw new Error('injected Job E failure after mutation before save');
    const csv=path.join(mutationOutput,'corrected.csv');
    const exported=await context.call('data_export',{session_id:opened.session_id,track:fixture.track.name,path:csv});
    assert.equal(exported.path,csv,'data_export did not write the canonical corrected CSV');
    assert.deepEqual(exported.columns,['t','x','y','vx','vy']);assert.equal(exported.row_count,11);assert.equal(exported.format,'csv');
    const expectedTrz=path.join(mutationOutput,'corrected.trz'),expectedTrk=path.join(mutationOutput,'corrected.trk');
    const saved=await context.call('session_control',{session_id:opened.session_id,action:'save',path:expectedTrz});
    assert.equal(saved.trz_path,expectedTrz,'save did not write corrected.trz');assert.equal(saved.trk_path,expectedTrk,'save did not write corrected.trk');
    const savedStatus=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(savedStatus,fixture,correctedMarks.length);
    await context.closeSession();
    const sourceMarks=await context.call('data_read',{path:relocated,track:fixture.track.name});
    const savedMarks=await context.call('data_read',{path:saved.trz_path,track:fixture.track.name});
    const standaloneMarks=await context.call('data_read',{path:saved.trk_path,track:fixture.track.name});
    assert.deepEqual(sourceMarks.rows,baselineMarks,'relocated input marks changed');
    assert.deepEqual(savedMarks.rows,correctedMarks,'saved archive did not persist exactly the intended mark changes');
    assert.deepEqual(standaloneMarks.rows,correctedMarks,'standalone corrected.trk did not persist exactly the intended mark changes');
    const mediaNames=readdirSync(mutationOutput).filter(name=>/^corrected-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i.test(name));
    assert.equal(mediaNames.length,1,'save must publish exactly one corrected-<UUID>.mp4 companion video');
    const media=path.join(mutationOutput,mediaNames[0]);
    return {status:savedStatus,status_before_save:status,csv,saved,marks:savedMarks.rows,standalone_marks:standaloneMarks.rows,media};
  });
  assert.deepEqual(readdirSync(mutationOutput).sort(),['corrected.csv','corrected.trk','corrected.trz',path.basename(mutation.value.media)].sort(),'mutation output contains unexpected artifacts');
  for(const file of [mutation.value.csv,mutation.value.saved.trk_path,mutation.value.saved.trz_path,mutation.value.media]) assert.ok(existsSync(file),`missing mutation artifact ${file}`);
  const mutationComparison=compareToOracle(readFileSync(mutation.value.csv,'utf8'),expected,fixture,baselineCsv);
  const archive=assertArchiveLayout(trusted.source.bytes,mutation.value.saved.trz_path,mutation.value.media);
  const standalone=assertStandaloneTrk(mutation.value.saved.trk_path,mutation.value.media,mutation.value.standalone_marks);

  const reopened=await withFreshOwner('reopen',options,async context=>{
    const opened=await context.call('session_open',{path:mutation.value.saved.trz_path});context.setSession(opened.session_id);
    const status=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(status,fixture,correctedMarks.length);
    const csv=path.join(reopenOutput,'corrected-reopened.csv');
    const exported=await context.call('data_export',{session_id:opened.session_id,track:fixture.track.name,path:csv});
    assert.equal(exported.path,csv,'fresh reopen did not write the canonical CSV');assert.equal(exported.row_count,11);assert.deepEqual(exported.columns,['t','x','y','vx','vy']);
    await context.closeSession();
    const marks=await context.call('data_read',{path:mutation.value.saved.trz_path,track:fixture.track.name});
    assert.deepEqual(marks.rows,correctedMarks,'fresh reopen did not preserve corrections');
    return {status,csv,marks:marks.rows};
  });
  assert.deepEqual(readdirSync(reopenOutput),['corrected-reopened.csv'],'reopen output contains unexpected artifacts');
  const reopenComparison=compareToOracle(readFileSync(reopened.value.csv,'utf8'),expected,fixture,baselineCsv);
  const sourceShaAfter=readBoundedRegularFile(sourcePath,'source project',MAX_SOURCE_TRZ_BYTES).sha256,relocatedShaAfter=hash(relocated);
  assert.equal(sourceShaAfter,verifiedSha,'verified Job C source hash changed during Job E');
  assert.equal(relocatedShaAfter,verifiedSha,'relocated input hash changed during Job E');
  options.onBeforeFinalProvenanceRecheck?.();
  const baselineAfter=readBoundedRegularFile(trusted.baseline.path,'Job C baseline CSV',MAX_BASELINE_CSV_BYTES);
  assert.equal(baselineAfter.sha256,trusted.baseline.sha256,'Job C baseline CSV hash changed during Job E');
  assert.deepEqual(baselineAfter.bytes,trusted.baseline.bytes,'Job C baseline CSV bytes changed during Job E');

  const artifacts=Object.fromEntries(Object.entries({csv:mutation.value.csv,trk:mutation.value.saved.trk_path,trz:mutation.value.saved.trz_path,media:mutation.value.media}).map(([key,file])=>[key,{path:file,sha256:hash(file)}]));
  const reopenArtifact={path:reopened.value.csv,sha256:hash(reopened.value.csv)};
  const manifestPath=path.join(runDir,'run.json');
  const run={
    job:'E',
    input:{path:sourcePath,sha256:verifiedSha,source_sha256_after:sourceShaAfter,relocated_path:relocated,relocated_sha256:relocatedShaAfter,trusted_job_c_manifest_path:trusted.manifestPath},
    baseline:{path:trusted.baseline.path,sha256:trusted.baseline.sha256,sha256_after:baselineAfter.sha256},
    services:{mutation:mutation.owner,reopen:reopened.owner},
    mutation:{status:mutation.value.status,status_before_save:mutation.value.status_before_save,expected_marks:correctedMarks,marks:mutation.value.marks,expected_frames:expected.map(row=>row.frame),mark_diff:markDiff,comparison:mutationComparison},
    reopen:{status:reopened.value.status,marks:reopened.value.marks,comparison:reopenComparison,artifact:reopenArtifact},
    artifacts,standalone,archive,publication:{manifest_written_after_owners_reaped:true},manifest_path:manifestPath,
  };
  assert.equal(run.services.mutation.mcp_terminated_after_client_close,true,'mutation MCP owner was not reaped');
  assert.equal(run.services.mutation.service_terminated_after_client_close,true,'mutation Java owner was not reaped');
  assert.equal(run.services.reopen.mcp_terminated_after_client_close,true,'reopen MCP owner was not reaped');
  assert.equal(run.services.reopen.service_terminated_after_client_close,true,'reopen Java owner was not reaped');
  writeFileSync(manifestPath,JSON.stringify(run,null,2)+'\n',{flag:'wx'});
  return run;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runJobE(process.argv[2]===undefined?undefined:path.resolve(process.argv[2]),process.argv[3]===undefined?undefined:path.resolve(process.argv[3])),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
