import assert from 'node:assert/strict';
import {constants,copyFileSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {parseCsvTable} from '../dist/csv.js';
import {readTrkFromZip,readZipEntry} from '../dist/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const MAX_SOURCE_VIDEO_BYTES=64*1024*1024;
const MAX_MANIFEST_BYTES=1024*1024;
const MAX_STANDALONE_TRK_BYTES=32*1024*1024;
const PINNED_SOURCE_SHA256='2011c8bc38a512bceae19bc7d58bbe84aeb53443be2647b7a0408f574bbf9434';
const PINNED_MANIFEST_SHA256='936f900f84412e5bd992b6a84d8f2544692a4098517eea4ac2fa3699f8c1a091';
const hashBytes=value=>createHash('sha256').update(value).digest('hex');
const hash=file=>hashBytes(readFileSync(file));

function readBoundedRegularFile(file,label,maxBytes) {
  let canonical,details;
  try {canonical=realpathSync(file);details=statSync(canonical);}
  catch {assert.fail(label+' is unavailable');}
  assert.ok(details.isFile(),label+' must be a canonical regular file');
  assert.ok(details.size<=maxBytes,label+' exceeds the '+maxBytes+' byte limit');
  let bytes;
  try {bytes=readFileSync(canonical);} catch {assert.fail(label+' could not be read');}
  assert.ok(bytes.length<=maxBytes,label+' exceeds the '+maxBytes+' byte limit');
  return {path:canonical,bytes,sha256:hashBytes(bytes)};
}

function loadFixture(sourcePath,manifestPath) {
  assert.ok(path.isAbsolute(sourcePath),'source video must be absolute');
  assert.ok(path.isAbsolute(manifestPath),'Job F manifest must be absolute');
  const source=readBoundedRegularFile(sourcePath,'source video',MAX_SOURCE_VIDEO_BYTES);
  const manifestFile=readBoundedRegularFile(manifestPath,'Job F manifest',MAX_MANIFEST_BYTES);
  assert.equal(manifestFile.sha256,PINNED_MANIFEST_SHA256,'Job F manifest is not the pinned fixture');
  let fixture;
  try {fixture=JSON.parse(manifestFile.bytes.toString('utf8'));}
  catch {assert.fail('Job F manifest is not valid JSON');}
  assert.equal(fixture?.fixture_id,'job-f-two-point-masses-v1','Job F manifest fixture id is invalid');
  assert.equal(fixture?.raw_video?.path,'synthetic-parabola.mp4','Job F manifest raw video path is invalid');
  assert.equal(typeof fixture?.raw_video?.sha256,'string','Job F manifest raw video hash is invalid');
  assert.equal(fixture.raw_video.sha256,PINNED_SOURCE_SHA256,'Job F manifest raw video hash is not the pinned fixture');
  assert.equal(source.sha256,fixture.raw_video.sha256,'source video hash does not match Job F manifest');
  const calibration=fixture.calibration;
  assert.deepEqual(calibration,{origin_x:96,origin_y:168,angle_rad:Math.PI/6,scale:40,length_unit:'m',frame_interval_seconds:0.1},'Job F calibration is invalid');
  assert.ok(Array.isArray(fixture.tracks)&&fixture.tracks.length===2,'Job F must contain exactly two tracks');
  const expected=[
    {name:'parabolic target',type:'point_mass',mass:1.25,marks:12},
    {name:'linear reference',type:'point_mass',mass:2.75,marks:10},
  ];
  assert.deepEqual(fixture.tracks.map(track=>({name:track?.name,type:track?.type,mass:track?.mass,marks:Array.isArray(track?.marks)?track.marks.length:null})),expected,'Job F track definitions are invalid');
  for(const track of fixture.tracks) {
    assert.ok(track.marks.every(mark=>Number.isInteger(mark.frame)&&Number.isFinite(mark.x)&&Number.isFinite(mark.y)),'Job F marks are invalid');
    const frames=track.marks.map(mark=>mark.frame);
    assert.equal(new Set(frames).size,frames.length,'Job F track contains duplicate frames');
  }
  return {source,manifest:{path:manifestFile.path,bytes:manifestFile.bytes,sha256:manifestFile.sha256},fixture};
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
  assert.fail(label+' '+pid+' survived owner shutdown');
}

async function withFreshOwner(kind,options,action) {
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:root,stderr:'pipe'});
  const client=new Client({name:'tracker-job-f-'+kind,version:'1.0'});
  let stderr='',sessionId,sessionClosed=false,mcpPid,servicePid;
  const owner={kind,mcp_pid:null,service_pid:null,before_open:null,probe:null,mcp_terminated_after_client_close:false,service_terminated_after_client_close:false};
  const call=async(name,args)=>{
    const response=await client.callTool({name,arguments:args},undefined,{timeout:150000});
    const body=JSON.parse(response.content[0].text);
    assert.equal(body.ok,true,name+': '+JSON.stringify(body)+(stderr?'\n'+stderr:''));
    assert.notEqual(response.isError,true,name+' marked as error');
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
    options.onOwnerMcpStarted?.(kind,mcpPid);
    const beforeOpen=await call('tracker_status',{probe_service:false});
    assert.equal(beforeOpen.service,null,'tracker_status without probe must not launch Java');
    owner.before_open={service:beforeOpen.service};
    const probed=await call('tracker_status',{probe_service:true});
    servicePid=probed.service?.pid;
    assert.equal(probed.service?.running,true,'tracker_status probe did not start Java');
    assert.ok(Number.isInteger(servicePid)&&servicePid>0,'tracker_status probe did not return an integer Java PID');
    owner.service_pid=servicePid;owner.probe={running:probed.service.running,pid:servicePid};
    options.onOwnerServiceStarted?.(kind,mcpPid,servicePid);
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

function marksFor(track) {
  return track.marks.map(mark=>[mark.frame,mark.x,mark.y]);
}

function expectedTracks(fixture) {
  return fixture.tracks.map(track=>({name:track.name,type:track.type,mass:track.mass,mark_count:track.marks.length}));
}

function assertCoordinates(status,fixture) {
  const calibration=fixture.calibration;
  assert.equal(status.coords.origin_x,calibration.origin_x);assert.equal(status.coords.origin_y,calibration.origin_y);
  assert.equal(status.coords.scale,calibration.scale);assert.equal(status.coords.length_unit,calibration.length_unit);
  const canonicalAngle=Math.atan2(Math.sin(calibration.angle_rad),Math.cos(calibration.angle_rad));
  assert.ok(Math.abs(status.coords.angle_rad-canonicalAngle)<=Number.EPSILON,'project angle changed');
}

function assertProjectState(status,fixture,dirty) {
  assert.equal(status.dirty,dirty,'unexpected session dirty state');
  assertCoordinates(status,fixture);
  assert.deepEqual(status.tracks,expectedTracks(fixture),'track membership changed');
}

function toWorld(fixture,u,v) {
  const c=fixture.calibration,cos=Math.cos(c.angle_rad),sin=Math.sin(c.angle_rad);
  const du=u-c.origin_x,dv=v-c.origin_y;
  return {x:(du*cos-dv*sin)/c.scale,y:-(du*sin+dv*cos)/c.scale};
}

function expectedTable(fixture,track) {
  const marks=new Map(marksFor(track).map(([frame,x,y])=>[frame,{x,y,world:toWorld(fixture,x,y)}]));
  const dt=fixture.calibration.frame_interval_seconds;
  return [...marks].sort(([left],[right])=>left-right).map(([frame,mark])=>{
    const previous=marks.get(frame-1),next=marks.get(frame+1);
    const velocity=previous&&next?{
      vx:(next.world.x-previous.world.x)/(2*dt),
      vy:(next.world.y-previous.world.y)/(2*dt),
    }:null;
    return {frame,t:frame*dt,x:mark.world.x,y:mark.world.y,vx:velocity?.vx??null,vy:velocity?.vy??null};
  });
}

function rowForFrame(table,frame,dt) {
  const rows=table.rows.filter(row=>Math.abs(Number(row[0])-frame*dt)<=1e-12);
  assert.equal(rows.length,1,'CSV has wrong row membership for frame '+frame);
  return rows[0];
}

function compareToOracle(text,fixture,track) {
  const actual=parseCsvTable(text),expected=expectedTable(fixture,track),dt=fixture.calibration.frame_interval_seconds;
  assert.deepEqual(actual.columns,['t','x','y','vx','vy']);
  assert.equal(actual.rows.length,expected.length,'CSV row count changed for '+track.name);
  const derivativeBlankFrames=[];let numericCells=0,blankCells=0,maxAbsoluteError=0;
  for(const expectation of expected) {
    const row=rowForFrame(actual,expectation.frame,dt);
    for(const [index,name] of ['t','x','y','vx','vy'].entries()) {
      const wanted=expectation[name],value=row[index];
      if(wanted===null) {
        assert.equal(value,'','frame '+expectation.frame+' '+name+' must be blank without immediate neighbours');
        blankCells++;
        continue;
      }
      assert.notEqual(value,'','frame '+expectation.frame+' '+name+' unexpectedly blank');
      const number=Number(value);
      assert.ok(Number.isFinite(number),'frame '+expectation.frame+' '+name+' is not finite');
      const error=Math.abs(number-wanted);maxAbsoluteError=Math.max(maxAbsoluteError,error);
      assert.ok(error<=1e-9,'frame '+expectation.frame+' '+name+' differs from independent oracle by '+error);
      numericCells++;
    }
    if(expectation.vx===null) derivativeBlankFrames.push(expectation.frame);
  }
  const counts=track.name==='parabolic target'?{numeric:56,blank:4,frames:[0,11]}:{numeric:38,blank:12,frames:[0,3,5,7,9,11]};
  assert.equal(numericCells,counts.numeric);assert.equal(blankCells,counts.blank);
  assert.deepEqual(derivativeBlankFrames,counts.frames);
  let linearClosedFormMaxAbsoluteError;
  if(track.name==='linear reference') {
    const angle=fixture.calibration.angle_rad,scale=fixture.calibration.scale;
    const dt=fixture.calibration.frame_interval_seconds;
    const vx=(-9*Math.cos(angle)-6*Math.sin(angle))/(scale*dt);
    const vy=(9*Math.sin(angle)-6*Math.cos(angle))/(scale*dt);
    linearClosedFormMaxAbsoluteError=0;
    for(const expectation of expected.filter(row=>row.vx!==null)) {
      const row=rowForFrame(actual,expectation.frame,dt);
      linearClosedFormMaxAbsoluteError=Math.max(linearClosedFormMaxAbsoluteError,Math.abs(Number(row[3])-vx),Math.abs(Number(row[4])-vy));
    }
    assert.ok(linearClosedFormMaxAbsoluteError<=1e-9,'linear reference velocities do not match closed form');
  }
  return {track:track.name,rows:actual.rows.length,numeric_cells:numericCells,blank_cells:blankCells,derivative_blank_frames:derivativeBlankFrames,max_absolute_error:maxAbsoluteError,linear_closed_form_max_absolute_error:linearClosedFormMaxAbsoluteError};
}

function assertMarkMembership(actual,fixture) {
  const expected=Object.fromEntries(fixture.tracks.map(track=>[track.name,marksFor(track)]));
  const target=fixture.tracks[0],linear=fixture.tracks[1];
  assert.deepEqual(actual[target.name],expected[target.name],'target marks changed');
  assert.deepEqual(actual[linear.name],expected[linear.name],'linear marks changed');
  assert.notDeepEqual(actual[target.name],actual[linear.name],'tracks are cross-contaminated');
  assert.ok(actual[target.name].some(mark=>mark[0]===0&&mark[1]===48&&mark[2]===190),'target sentinel is absent');
  assert.ok(actual[linear.name].some(mark=>mark[0]===0&&mark[1]===280&&mark[2]===42),'linear sentinel is absent');
  assert.equal(actual[target.name].some(mark=>mark[0]===0&&mark[1]===280&&mark[2]===42),false,'linear sentinel leaked into target');
  assert.equal(actual[linear.name].some(mark=>mark[0]===0&&mark[1]===48&&mark[2]===190),false,'target sentinel leaked into linear');
  return expected;
}

function readMarks(context,projectPath,fixture) {
  return Promise.all(fixture.tracks.map(async track=>{
    const result=await context.call('data_read',{path:projectPath,track:track.name});
    return [track.name,result.rows];
  })).then(entries=>Object.fromEntries(entries));
}

function archiveEntries(archivePath) {
  const result=spawnSync('unzip',['-Z1',archivePath],{encoding:'utf8',maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout);
  return result.stdout.trim().split('\n').filter(Boolean);
}

function assertArchiveLayout(sourcePath,savedPath,mediaPath) {
  assert.deepEqual(archiveEntries(savedPath),['project.trk','videos/media.mp4'],'archive is not the accepted project/media shape');
  const savedBytes=readFileSync(savedPath),savedMedia=readZipEntry(savedBytes,'videos/media.mp4');
  assert.equal(savedMedia.ok,true,'saved archive is missing videos/media.mp4');
  const embedded=readTrkFromZip(savedBytes,savedPath);
  assert.equal(embedded.ok,true,'saved archive has no readable project.trk');assert.equal(embedded.name,'project.trk');
  assert.match(embedded.xml,/<property name="path" type="string">videos\/media\.mp4<\/property>/);
  const sourceMediaSha=hash(sourcePath),savedMediaSha=hashBytes(savedMedia.data),companionMediaSha=hash(mediaPath);
  assert.equal(companionMediaSha,sourceMediaSha,'companion media changed source bytes');
  assert.equal(companionMediaSha,savedMediaSha,'archive media changed source bytes');
  return {entries:['project.trk','videos/media.mp4'],source_media_sha256:sourceMediaSha,saved_media_sha256:savedMediaSha,companion_media_sha256:companionMediaSha};
}

function assertStandaloneTrk(trkPath,mediaPath) {
  const trk=readBoundedRegularFile(trkPath,'standalone .trk',MAX_STANDALONE_TRK_BYTES);
  const expected='<property name="path" type="string">'+path.basename(mediaPath)+'</property>';
  assert.ok(trk.bytes.toString('utf8').includes(expected),'standalone .trk does not reference its companion media');
  return {path:trk.path,sha256:trk.sha256,media_path:path.basename(mediaPath)};
}

function exportPaths(directory,phase,fixture) {
  return Object.fromEntries(fixture.tracks.map(track=>[
    track.name,
    path.join(directory,phase+'-'+(track.name==='parabolic target'?'parabolic-target':'linear-reference')+'.csv'),
  ]));
}

async function exportAndVerify(context,sessionId,directory,phase,fixture) {
  const paths=exportPaths(directory,phase,fixture),exports=[];
  for(const track of fixture.tracks) {
    const exported=await context.call('data_export',{session_id:sessionId,track:track.name,path:paths[track.name]});
    assert.equal(exported.path,paths[track.name],'data_export did not write canonical '+track.name+' CSV');
    assert.deepEqual(exported.columns,['t','x','y','vx','vy']);assert.equal(exported.row_count,track.marks.length);assert.equal(exported.format,'csv');
    const checked=compareToOracle(readFileSync(paths[track.name],'utf8'),fixture,track);
    const {linear_closed_form_max_absolute_error,...comparison}=checked;
    const record={path:paths[track.name],sha256:hash(paths[track.name]),comparison,max_absolute_error:comparison.max_absolute_error};
    if(linear_closed_form_max_absolute_error!==undefined) record.linear_closed_form_max_absolute_error=linear_closed_form_max_absolute_error;
    exports.push(record);
  }
  return exports;
}

export async function runJobF(sourcePath=path.join(root,'fixtures/golden/synthetic-parabola.mp4'),runDir,options={}) {
  const manifestPath=options.manifestPath??path.join(root,'fixtures/golden/job-f-manifest.json');
  const trusted=loadFixture(sourcePath,manifestPath);sourcePath=trusted.source.path;
  if(runDir===undefined) runDir=path.join(root,'service/build','job-f-'+Date.now()+'-'+process.pid);
  assert.ok(path.isAbsolute(runDir),'run directory must be absolute');
  mkdirSync(runDir); // Existing directories are never reused.
  runDir=realpathSync(runDir);
  const outputDir=path.join(runDir,'create-output');
  const standaloneOutput=path.join(runDir,'standalone-reopen-output');
  const relocatedInput=path.join(runDir,'relocated-input');
  const relocatedOutput=path.join(runDir,'relocated-reopen-output');
  mkdirSync(outputDir);mkdirSync(standaloneOutput);mkdirSync(relocatedInput);mkdirSync(relocatedOutput);
  const fixture=trusted.fixture,expected=Object.fromEntries(fixture.tracks.map(track=>[track.name,marksFor(track)]));

  const created=await withFreshOwner('create',options,async context=>{
    const opened=await context.call('session_open',{path:sourcePath});context.setSession(opened.session_id);
    const coords=fixture.calibration;
    await context.call('coords_set',{session_id:opened.session_id,origin_x:coords.origin_x,origin_y:coords.origin_y,angle_rad:coords.angle_rad,scale:coords.scale,length_unit:coords.length_unit});
    const target=fixture.tracks[0],linear=fixture.tracks[1];
    await context.call('track_create',{session_id:opened.session_id,name:target.name,type:target.type,mass:target.mass});
    const targetSet=await context.call('mark_set',{session_id:opened.session_id,track:target.name,marks:target.marks});
    assert.equal(targetSet.mark_count,target.marks.length,'target mark count changed');
    if(options.injectFailureAfterFirstTrack) throw new Error('injected Job F failure after first track');
    await context.call('track_create',{session_id:opened.session_id,name:linear.name,type:linear.type,mass:linear.mass});
    const linearSet=await context.call('mark_set',{session_id:opened.session_id,track:linear.name,marks:linear.marks});
    assert.equal(linearSet.mark_count,linear.marks.length,'linear mark count changed');
    const statusBeforeSave=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(statusBeforeSave,fixture,true);
    const exports=await exportAndVerify(context,opened.session_id,outputDir,'created',fixture);
    const expectedTrz=path.join(outputDir,'two-point-masses.trz');
    const expectedTrk=path.join(outputDir,'two-point-masses.trk');
    const saved=await context.call('session_control',{session_id:opened.session_id,action:'save',path:expectedTrz});
    assert.equal(saved.trz_path,expectedTrz,'save did not write canonical Job F archive');
    assert.equal(saved.trk_path,expectedTrk,'save did not write canonical Job F standalone project');
    const statusAfterSave=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(statusAfterSave,fixture,false);
    await context.closeSession();
    const trkMarks=await readMarks(context,saved.trk_path,fixture);
    const trzMarks=await readMarks(context,saved.trz_path,fixture);
    assertMarkMembership(trkMarks,fixture);assertMarkMembership(trzMarks,fixture);
    const mediaNames=readdirSync(outputDir).filter(name=>/^two-point-masses-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i.test(name));
    assert.equal(mediaNames.length,1,'save must publish exactly one two-point-masses-<UUID>.mp4 companion');
    return {status_before_save:statusBeforeSave,status_after_save:statusAfterSave,exports,saved,trk_marks:trkMarks,trz_marks:trzMarks,media:path.join(outputDir,mediaNames[0])};
  });
  assert.deepEqual(readdirSync(outputDir).sort(),[
    'created-linear-reference.csv','created-parabolic-target.csv','two-point-masses.trk','two-point-masses.trz',path.basename(created.value.media),
  ].sort(),'create output contains unexpected artifacts');
  const archive=assertArchiveLayout(sourcePath,created.value.saved.trz_path,created.value.media);
  const standalone=assertStandaloneTrk(created.value.saved.trk_path,created.value.media);

  const standaloneReopen=await withFreshOwner('standalone-reopen',options,async context=>{
    const opened=await context.call('session_open',{path:created.value.saved.trk_path});context.setSession(opened.session_id);
    const status=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(status,fixture,false);
    if(options.injectFailureDuringReopen) throw new Error('injected Job F failure during reopen');
    const exports=await exportAndVerify(context,opened.session_id,standaloneOutput,'standalone',fixture);
    await context.closeSession();
    return {status,exports};
  });
  assert.deepEqual(readdirSync(standaloneOutput).sort(),['standalone-linear-reference.csv','standalone-parabolic-target.csv'].sort(),'standalone reopen output contains unexpected artifacts');

  const relocated=path.join(relocatedInput,'two-point-masses.trz');
  copyFileSync(created.value.saved.trz_path,relocated,constants.COPYFILE_EXCL);
  assert.deepEqual(readdirSync(relocatedInput),['two-point-masses.trz'],'relocated input must contain the archive alone');
  assert.equal(hash(relocated),hash(created.value.saved.trz_path),'archive relocation changed bytes');
  const relocatedReopen=await withFreshOwner('relocated-reopen',options,async context=>{
    const opened=await context.call('session_open',{path:relocated});context.setSession(opened.session_id);
    const status=await context.call('session_control',{session_id:opened.session_id,action:'status'});
    assertProjectState(status,fixture,false);
    const exports=await exportAndVerify(context,opened.session_id,relocatedOutput,'relocated',fixture);
    await context.closeSession();
    return {status,exports};
  });
  assert.deepEqual(readdirSync(relocatedOutput).sort(),['relocated-linear-reference.csv','relocated-parabolic-target.csv'].sort(),'relocated reopen output contains unexpected artifacts');

  options.onBeforeFinalProvenanceRecheck?.();
  const sourceAfter=readBoundedRegularFile(sourcePath,'source video',MAX_SOURCE_VIDEO_BYTES);
  assert.equal(sourceAfter.sha256,trusted.source.sha256,'source video hash changed during Job F');
  const manifestAfter=readBoundedRegularFile(trusted.manifest.path,'Job F manifest',MAX_MANIFEST_BYTES);
  assert.equal(manifestAfter.sha256,trusted.manifest.sha256,'Job F manifest hash changed during Job F');
  assert.deepEqual(manifestAfter.bytes,trusted.manifest.bytes,'Job F manifest bytes changed during Job F');

  const artifacts=Object.fromEntries(Object.entries({trk:created.value.saved.trk_path,trz:created.value.saved.trz_path,media:created.value.media}).map(([key,file])=>[key,{path:file,sha256:hash(file)}]));
  const manifestOutput=path.join(runDir,'run.json');
  const services={create:created.owner,standalone_reopen:standaloneReopen.owner,relocated_reopen:relocatedReopen.owner};
  for(const owner of Object.values(services)) {
    assert.equal(owner.mcp_terminated_after_client_close,true,'MCP owner was not reaped');
    assert.equal(owner.service_terminated_after_client_close,true,'Java owner was not reaped');
  }
  const pids=Object.values(services).flatMap(owner=>[owner.mcp_pid,owner.service_pid]);
  assert.equal(new Set(pids).size,pids.length,'Job F owners must all have distinct MCP and Java PIDs');
  const run={
    job:'F',
    input:{path:sourcePath,sha256:trusted.source.sha256,sha256_after:sourceAfter.sha256},
    fixture:{path:trusted.manifest.path,sha256:trusted.manifest.sha256,sha256_after:manifestAfter.sha256},
    services,
    status_before_save:created.value.status_before_save,status_after_save:created.value.status_after_save,
    create:{exports:created.value.exports},
    standalone_reopen:{status:standaloneReopen.value.status,exports:standaloneReopen.value.exports},
    relocated_reopen:{status:relocatedReopen.value.status,exports:relocatedReopen.value.exports,path:relocated,sha256:hash(relocated)},
    marks:{expected,trk:created.value.trk_marks,trz:created.value.trz_marks},
    artifacts,standalone,archive,
    publication:{manifest_written_after_owners_reaped:true},manifest_path:manifestOutput,
  };
  writeFileSync(manifestOutput,JSON.stringify(run,null,2)+'\n',{flag:'wx'});
  return run;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runJobF(process.argv[2]===undefined?undefined:path.resolve(process.argv[2]),process.argv[3]===undefined?undefined:path.resolve(process.argv[3])),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
