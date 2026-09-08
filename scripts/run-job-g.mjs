import assert from 'node:assert/strict';
import {constants,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {PNG} from 'pngjs';
import {parseCsvTable} from '../dist/csv.js';
import {readTrkFromZip,readZipEntry} from '../dist/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const MAX_SOURCE_VIDEO_BYTES=64*1024*1024;
const MAX_MANIFEST_BYTES=1024*1024;
const MAX_FRAME_PNG_BYTES=1024*1024;
const MAX_STANDALONE_TRK_BYTES=32*1024*1024;
const PINNED_SOURCE_SHA256='2011c8bc38a512bceae19bc7d58bbe84aeb53443be2647b7a0408f574bbf9434';
const PINNED_MANIFEST_SHA256='6a4c0e2de1fe3a36ca18965d35a76c8e8488249d8ed953fe78eab0385c795b7f';
const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const ORACLE=[
  {frame:0,t:0,x:-1.3142304845413264,y:0.12368602791855858,vx:null,vy:null},
  {frame:7,t:0.7,x:1.8746950917173788,y:-0.3029328524455037,vx:null,vy:null},
];
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
  return {path:canonical,bytes,sha256:hashBytes(bytes),size:bytes.length};
}

function loadFixture(sourcePath,manifestPath) {
  assert.ok(path.isAbsolute(sourcePath),'source video must be absolute');
  assert.ok(path.isAbsolute(manifestPath),'Job G manifest must be absolute');
  const source=readBoundedRegularFile(sourcePath,'source video',MAX_SOURCE_VIDEO_BYTES);
  const manifest=readBoundedRegularFile(manifestPath,'Job G manifest',MAX_MANIFEST_BYTES);
  assert.equal(manifest.sha256,PINNED_MANIFEST_SHA256,'Job G manifest is not the pinned fixture');
  let fixture;
  try {fixture=JSON.parse(manifest.bytes.toString('utf8'));}
  catch {assert.fail('Job G manifest is not valid JSON');}
  assert.equal(fixture?.fixture_id,'job-g-frame-assisted-point-mass-v1','Job G manifest fixture id is invalid');
  assert.deepEqual(fixture?.raw_video,{path:'synthetic-parabola.mp4',sha256:PINNED_SOURCE_SHA256},'Job G raw-video provenance is invalid');
  assert.equal(source.sha256,fixture.raw_video.sha256,'source video hash does not match Job G manifest');
  assert.deepEqual(fixture.calibration,{origin_x:96,origin_y:168,angle_rad:Math.PI/6,scale:40,length_unit:'m',frame_interval_seconds:0.1},'Job G calibration is invalid');
  assert.deepEqual(fixture.sequence,[
    {frame:0,expected_point:[48,190]},
    {frame:7,expected_point:[167,141]},
    {frame:0,expected_point:[48,190]},
  ],'Job G frame sequence is invalid');
  assert.deepEqual(fixture.track,{name:'frame-assisted target',type:'point_mass',mass:1},'Job G track is invalid');
  assert.deepEqual(fixture.detector,{
    scope:'fixture-only',
    note:'This bounded color-mask check proves the Job G frame-assisted loop; it is not general vision.',
    png:{width:320,height:240,rgba:true},
    mask:{alpha:255,red_gt:180,green_gt:160,blue_lt:140,count_min:150,count_max:260,bbox_min:15,bbox_max:19},
  },'Job G detector declaration is invalid');
  return {source,manifest,fixture};
}

function preflightPngHeader(bytes) {
  assert.ok(Buffer.isBuffer(bytes),'Job G PNG must be bytes');
  assert.ok(bytes.length<=MAX_FRAME_PNG_BYTES,'Job G PNG exceeds the '+MAX_FRAME_PNG_BYTES+' byte limit');
  assert.ok(bytes.length>=PNG_SIGNATURE.length&&bytes.subarray(0,PNG_SIGNATURE.length).equals(PNG_SIGNATURE),'Job G frame is missing the PNG signature');
  assert.ok(bytes.length>=33,'Job G frame is missing a complete IHDR chunk');
  assert.equal(bytes.readUInt32BE(8),13,'Job G first PNG chunk must be a 13-byte IHDR');
  assert.ok(bytes.subarray(12,16).equals(Buffer.from('IHDR')),'Job G first PNG chunk must be IHDR');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  assert.equal(width,320,'Job G PNG width must be 320');
  assert.equal(height,240,'Job G PNG height must be 240');
  assert.equal(bytes[24],8,'Job G PNG bit depth must be 8');
  assert.ok(bytes[25]===2||bytes[25]===6,'Job G PNG color type must be truecolor or truecolor-alpha');
  assert.equal(bytes[26],0,'Job G PNG compression method must be 0');
  assert.equal(bytes[27],0,'Job G PNG filter method must be 0');
  assert.equal(bytes[28],0,'Job G PNG must be non-interlaced');
}

export function detectJobGMarker(bytes) {
  preflightPngHeader(bytes);
  let png;
  try {png=PNG.sync.read(bytes,{checkCRC:true});}
  catch (error) {assert.fail('Job G frame PNG failed CRC/decoder validation: '+(error instanceof Error?error.message:'unknown error'));}
  assert.equal(png.width,320,'Job G PNG width must be 320');
  assert.equal(png.height,240,'Job G PNG height must be 240');
  assert.equal(png.data.length,png.width*png.height*4,'Job G PNG must decode as RGBA');
  const selected=new Uint8Array(png.width*png.height),allPoints=[];
  for(let pixel=0;pixel<png.width*png.height;pixel++) {
    const offset=pixel*4;
    if(png.data[offset+3]===255&&png.data[offset]>180&&png.data[offset+1]>160&&png.data[offset+2]<140) {selected[pixel]=1;allPoints.push(pixel);}
  }
  assert.ok(allPoints.length>=150&&allPoints.length<=260,'Job G marker mask count must be 150..260');
  const seen=new Uint8Array(selected.length),components=[];
  for(let start=0;start<selected.length;start++) {
    if(!selected[start]||seen[start]) continue;
    const stack=[start],points=[];seen[start]=1;
    while(stack.length) {
      const pixel=stack.pop();points.push(pixel);
      const x=pixel%png.width,y=Math.floor(pixel/png.width);
      for(const next of [x>0?pixel-1:-1,x+1<png.width?pixel+1:-1,y>0?pixel-png.width:-1,y+1<png.height?pixel+png.width:-1]) {
        if(next>=0&&selected[next]&&!seen[next]) {seen[next]=1;stack.push(next);}
      }
    }
    const xs=points.map(pixel=>pixel%png.width),ys=points.map(pixel=>Math.floor(pixel/png.width));
    components.push({points,bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)}});
  }
  const parent=components.map((_,index)=>index);
  const rootOf=index=>parent[index]===index?index:(parent[index]=rootOf(parent[index]));
  const join=(left,right)=>{left=rootOf(left);right=rootOf(right);if(left!==right) parent[right]=left;};
  const gap=(leftMin,leftMax,rightMin,rightMax)=>Math.max(0,rightMin-leftMax-1,leftMin-rightMax-1);
  for(let left=0;left<components.length;left++) for(let right=left+1;right<components.length;right++) {
    const a=components[left].bounds,b=components[right].bounds;
    if(gap(a.minX,a.maxX,b.minX,b.maxX)<=1&&gap(a.minY,a.maxY,b.minY,b.maxY)<=1) join(left,right);
  }
  const clusters=new Map();
  for(const [index,component] of components.entries()) {const key=rootOf(index);const cluster=clusters.get(key)??[];cluster.push(...component.points);clusters.set(key,cluster);}
  assert.equal(clusters.size,1,'Job G marker mask must contain exactly one compact cluster');
  const points=[...clusters.values()][0];
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,sumX=0,sumY=0;
  for(const pixel of points) {
    const x=pixel%png.width,y=Math.floor(pixel/png.width);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;
  }
  const bbox={x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
  assert.ok(bbox.width>=15&&bbox.width<=19&&bbox.height>=15&&bbox.height<=19,'Job G marker bbox must be 15..19 pixels in both dimensions');
  const rawCentroid={x:sumX/points.length,y:sumY/points.length};
  return {point:[Math.round(rawCentroid.x),Math.round(rawCentroid.y)],mask:{count:points.length,bbox,raw_centroid:rawCentroid},png:{width:png.width,height:png.height,rgba:true}};
}

export function readJobGFrame(file,label='Job G frame output') {
  assert.ok(typeof file==='string'&&path.isAbsolute(file),label+' path must be absolute');
  const requested=path.resolve(file);
  let listed;
  try {listed=lstatSync(requested);} catch {assert.fail(label+' is unavailable');}
  assert.equal(listed.isSymbolicLink(),false,label+' must not be a symbolic link');
  const frame=readBoundedRegularFile(requested,label,MAX_FRAME_PNG_BYTES);
  assert.equal(frame.path,requested,label+' must be a canonical path');
  const detected=detectJobGMarker(frame.bytes);
  return {path:frame.path,sha256:frame.sha256,size:frame.size,...detected};
}

async function waitForProcessExit(pid,label) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    try {process.kill(pid,0);}
    catch(error) {if(error?.code==='ESRCH') return;throw error;}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.fail(label+' '+pid+' survived owner shutdown');
}

async function withFreshOwner(kind,options,action) {
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'dist/index.js')],cwd:root,stderr:'pipe'});
  const client=new Client({name:'tracker-job-g-'+kind,version:'1.0'});
  let stderr='',sessionId,sessionClosed=false,mcpPid,servicePid;
  const owner={kind,mcp_pid:null,service_pid:null,before_open:null,probe:null,mcp_terminated_after_client_close:false,service_terminated_after_client_close:false};
  const call=async(name,args)=>{
    if(name==='mark_set') options.onMarkSetInvoked?.(kind,args);
    if(name==='session_control'&&args?.action==='save') options.onSaveInvoked?.(kind,args);
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
        assert.equal(close.closed,true,'session did not close');sessionClosed=true;
      }
    },
  };
  try {
    await client.connect(transport);transport.stderr?.on('data',chunk=>{stderr=(stderr+chunk).slice(-16384);});
    mcpPid=transport.pid;assert.ok(Number.isInteger(mcpPid)&&mcpPid>0,'stdio MCP owner did not expose an integer PID');
    owner.mcp_pid=mcpPid;options.onOwnerMcpStarted?.(kind,mcpPid);
    const beforeOpen=await call('tracker_status',{probe_service:false});assert.equal(beforeOpen.service,null,'tracker_status without probe must not launch Java');
    owner.before_open={service:beforeOpen.service};
    const probed=await call('tracker_status',{probe_service:true});servicePid=probed.service?.pid;
    assert.equal(probed.service?.running,true,'tracker_status probe did not start Java');
    assert.ok(Number.isInteger(servicePid)&&servicePid>0,'tracker_status probe did not return an integer Java PID');
    owner.service_pid=servicePid;owner.probe={running:probed.service.running,pid:servicePid};options.onOwnerServiceStarted?.(kind,mcpPid,servicePid);
    const value=await action(context);return {owner,value};
  } finally {
    if(sessionId&&!sessionClosed) {try {await context.closeSession();} catch {}}
    try {await client.close();}
    finally {
      if(servicePid!==undefined) {await waitForProcessExit(servicePid,'owned Java service');owner.service_terminated_after_client_close=true;}
      if(mcpPid!==undefined) {await waitForProcessExit(mcpPid,'owned stdio MCP process');owner.mcp_terminated_after_client_close=true;}
    }
  }
}

function assertCoordinates(status,fixture) {
  const calibration=fixture.calibration;
  assert.equal(status.coords.origin_x,calibration.origin_x);assert.equal(status.coords.origin_y,calibration.origin_y);
  assert.equal(status.coords.scale,calibration.scale);assert.equal(status.coords.length_unit,calibration.length_unit);
  const angle=Math.atan2(Math.sin(calibration.angle_rad),Math.cos(calibration.angle_rad));
  assert.ok(Math.abs(status.coords.angle_rad-angle)<=Number.EPSILON,'project angle changed');
}

function assertState(status,fixture,dirty) {
  assert.equal(status.dirty,dirty,'unexpected session dirty state');assertCoordinates(status,fixture);
  assert.deepEqual(status.tracks,[{name:fixture.track.name,type:fixture.track.type,mass:fixture.track.mass,mark_count:2}],'frame-assisted track changed');
}

function compareToOracle(text) {
  const actual=parseCsvTable(text);assert.deepEqual(actual.columns,['t','x','y','vx','vy']);assert.equal(actual.rows.length,2,'Job G CSV must have exactly two rows');
  let numericCells=0,blankCells=0,maxAbsoluteError=0;
  for(const expected of ORACLE) {
    const rows=actual.rows.filter(row=>Math.abs(Number(row[0])-expected.t)<=1e-12);assert.equal(rows.length,1,'CSV has wrong row membership for frame '+expected.frame);
    const row=rows[0];
    for(const [index,name] of ['t','x','y','vx','vy'].entries()) {
      const value=row[index],wanted=expected[name];
      if(wanted===null) {assert.equal(value,'','frame '+expected.frame+' '+name+' must be blank');blankCells++;continue;}
      assert.notEqual(value,'','frame '+expected.frame+' '+name+' unexpectedly blank');
      const numeric=Number(value);assert.ok(Number.isFinite(numeric),'frame '+expected.frame+' '+name+' is not finite');
      const error=Math.abs(numeric-wanted);maxAbsoluteError=Math.max(maxAbsoluteError,error);
      assert.ok(error<=1e-9,'frame '+expected.frame+' '+name+' differs from the independent oracle by '+error);numericCells++;
    }
  }
  assert.equal(numericCells,6);assert.equal(blankCells,4);
  return {rows:2,numeric_cells:numericCells,blank_cells:blankCells,max_absolute_error:maxAbsoluteError,derivative_blank_frames:[0,7]};
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
  const embedded=readTrkFromZip(savedBytes,savedPath);assert.equal(embedded.ok,true,'saved archive has no readable project.trk');assert.equal(embedded.name,'project.trk');
  assert.match(embedded.xml,/<property name="path" type="string">videos\/media\.mp4<\/property>/);
  const sourceMediaSha=hash(sourcePath),savedMediaSha=hashBytes(savedMedia.data),companionMediaSha=hash(mediaPath);
  assert.equal(companionMediaSha,sourceMediaSha,'companion media changed source bytes');assert.equal(companionMediaSha,savedMediaSha,'archive media changed source bytes');
  return {entries:['project.trk','videos/media.mp4'],source_media_sha256:sourceMediaSha,saved_media_sha256:savedMediaSha,companion_media_sha256:companionMediaSha};
}

function assertStandaloneTrk(trkPath,mediaPath) {
  const trk=readBoundedRegularFile(trkPath,'frame-assisted standalone .trk',MAX_STANDALONE_TRK_BYTES);
  assert.ok(trk.bytes.toString('utf8').includes('<property name="path" type="string">'+path.basename(mediaPath)+'</property>'),'standalone .trk does not reference its companion media');
  return {path:trk.path,sha256:trk.sha256,media_path:path.basename(mediaPath)};
}

async function getFrameEvidence(context,sessionId,frame,ordinal,directory,options) {
  const output=path.join(directory,'frame-'+String(frame).padStart(4,'0')+'-ordinal-'+ordinal+'.png');
  const returned=await context.call('frame_get',{session_id:sessionId,frame,path:output});
  assert.equal(returned.path,output,'frame_get did not return its requested canonical output');
  assert.equal(returned.width,320,'frame_get width changed');assert.equal(returned.height,240,'frame_get height changed');
  options.onAfterFrameGet?.({ordinal,frame,path:output,response:returned});
  return {ordinal,frame,...readJobGFrame(output,'frame_get output')};
}

function assertEvidence(evidence,fixture) {
  assert.equal(evidence.length,fixture.sequence.length,'frame evidence count changed');
  for(const [index,item] of evidence.entries()) {
    const expected=fixture.sequence[index];assert.equal(item.ordinal,index+1);assert.equal(item.frame,expected.frame);
    assert.deepEqual(item.point,expected.expected_point,'frame '+item.frame+' detector result does not match fixture oracle');
    assert.equal(item.png.width,320);assert.equal(item.png.height,240);assert.equal(item.png.rgba,true);
    assert.ok(typeof item.sha256==='string'&&item.sha256.length===64,'frame evidence hash is absent');assert.ok(item.size>0&&item.size<=MAX_FRAME_PNG_BYTES,'frame evidence size is invalid');
  }
  assert.deepEqual(evidence[0].point,evidence[2].point,'backward frame seek did not return the frame 0 marker');
  assert.notDeepEqual(evidence[0].point,evidence[1].point,'frame 0 and frame 7 markers unexpectedly match');
}

function submittedMarksFromEvidence(evidence) {
  return evidence.slice(0,2).map(item=>({frame:item.frame,x:item.point[0],y:item.point[1],source:{ordinal:item.ordinal,sha256:item.sha256}}));
}

export async function runJobG(sourcePath=path.join(root,'fixtures/golden/synthetic-parabola.mp4'),runDir,options={}) {
  const manifestPath=options.manifestPath??path.join(root,'fixtures/golden/job-g-manifest.json');
  const trusted=loadFixture(sourcePath,manifestPath);sourcePath=trusted.source.path;
  if(runDir===undefined) runDir=path.join(root,'service/build','job-g-'+Date.now()+'-'+process.pid);
  assert.ok(path.isAbsolute(runDir),'run directory must be absolute');mkdirSync(runDir);runDir=realpathSync(runDir);
  const manifestOutput=path.join(runDir,'run.json'),evidenceDir=path.join(runDir,'frame-evidence'),createOutput=path.join(runDir,'create-output'),relocatedInput=path.join(runDir,'relocated-input'),relocatedOutput=path.join(runDir,'relocated-reopen-output');
  mkdirSync(evidenceDir);mkdirSync(createOutput);mkdirSync(relocatedInput);mkdirSync(relocatedOutput);
  const fixture=trusted.fixture;

  const created=await withFreshOwner('create',options,async context=>{
    assert.equal(existsSync(manifestOutput),false,'run.json appeared while create owner was live');
    const opened=await context.call('session_open',{path:sourcePath});context.setSession(opened.session_id);
    const calibration=fixture.calibration;
    await context.call('coords_set',{session_id:opened.session_id,origin_x:calibration.origin_x,origin_y:calibration.origin_y,angle_rad:calibration.angle_rad,scale:calibration.scale,length_unit:calibration.length_unit});
    const evidence=[];
    for(const [index,step] of fixture.sequence.entries()) evidence.push(await getFrameEvidence(context,opened.session_id,step.frame,index+1,evidenceDir,options));
    assertEvidence(evidence,fixture);
    const submitted= submittedMarksFromEvidence(evidence);
    assert.deepEqual(submitted.map(mark=>[mark.frame,mark.x,mark.y]),[[0,48,190],[7,167,141]],'submitted marks must derive only from the first two evidence objects');
    await context.call('track_create',{session_id:opened.session_id,name:fixture.track.name,type:fixture.track.type,mass:fixture.track.mass});
    const marked=await context.call('mark_set',{session_id:opened.session_id,track:fixture.track.name,marks:submitted.map(({frame,x,y})=>({frame,x,y}))});
    assert.equal(marked.mark_count,2,'frame-assisted mark count changed');
    if(options.injectFailureAfterMarkSet) throw new Error('injected Job G failure after mark_set');
    const statusBeforeSave=await context.call('session_control',{session_id:opened.session_id,action:'status'});assertState(statusBeforeSave,fixture,true);
    const csv=path.join(createOutput,'frame-assisted.csv');const exported=await context.call('data_export',{session_id:opened.session_id,track:fixture.track.name,path:csv});
    assert.equal(exported.path,csv);assert.deepEqual(exported.columns,['t','x','y','vx','vy']);assert.equal(exported.row_count,2);assert.equal(exported.format,'csv');
    const comparison=compareToOracle(readFileSync(csv,'utf8'));
    const expectedTrz=path.join(createOutput,'frame-assisted.trz'),expectedTrk=path.join(createOutput,'frame-assisted.trk');
    const saved=await context.call('session_control',{session_id:opened.session_id,action:'save',path:expectedTrz});
    assert.equal(saved.trz_path,expectedTrz,'save did not write canonical Job G archive');assert.equal(saved.trk_path,expectedTrk,'save did not write canonical Job G standalone project');
    const statusAfterSave=await context.call('session_control',{session_id:opened.session_id,action:'status'});assertState(statusAfterSave,fixture,false);
    await context.closeSession();
    const expectedMarks=[[0,48,190],[7,167,141]];
    const trkMarks=await context.call('data_read',{path:saved.trk_path,track:fixture.track.name});const trzMarks=await context.call('data_read',{path:saved.trz_path,track:fixture.track.name});
    assert.deepEqual(trkMarks.rows,expectedMarks,'standalone project marks changed');assert.deepEqual(trzMarks.rows,expectedMarks,'archive project marks changed');
    const mediaNames=readdirSync(createOutput).filter(name=>/^frame-assisted-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i.test(name));
    assert.equal(mediaNames.length,1,'save must publish exactly one frame-assisted-<UUID>.mp4 companion');
    return {evidence,submitted_marks:submitted,status_before_save:statusBeforeSave,status_after_save:statusAfterSave,export:{path:csv,sha256:hash(csv),comparison},saved,trk_marks:trkMarks.rows,trz_marks:trzMarks.rows,media:path.join(createOutput,mediaNames[0])};
  });
  assert.deepEqual(readdirSync(createOutput).sort(),['frame-assisted.csv','frame-assisted.trk','frame-assisted.trz',path.basename(created.value.media)].sort(),'create output contains unexpected artifacts');
  const archive=assertArchiveLayout(sourcePath,created.value.saved.trz_path,created.value.media);const standalone=assertStandaloneTrk(created.value.saved.trk_path,created.value.media);

  const relocated=path.join(relocatedInput,'frame-assisted.trz');copyFileSync(created.value.saved.trz_path,relocated,constants.COPYFILE_EXCL);
  assert.deepEqual(readdirSync(relocatedInput),['frame-assisted.trz'],'relocated input must contain the archive alone');assert.equal(hash(relocated),hash(created.value.saved.trz_path),'archive relocation changed bytes');
  const reopened=await withFreshOwner('relocated-reopen',options,async context=>{
    assert.equal(existsSync(manifestOutput),false,'run.json appeared while relocated owner was live');
    const opened=await context.call('session_open',{path:relocated});context.setSession(opened.session_id);
    const status=await context.call('session_control',{session_id:opened.session_id,action:'status'});assertState(status,fixture,false);
    const csv=path.join(relocatedOutput,'relocated.csv');const exported=await context.call('data_export',{session_id:opened.session_id,track:fixture.track.name,path:csv});
    assert.equal(exported.path,csv);assert.deepEqual(exported.columns,['t','x','y','vx','vy']);assert.equal(exported.row_count,2);assert.equal(exported.format,'csv');
    const comparison=compareToOracle(readFileSync(csv,'utf8'));await context.closeSession();
    const marks=await context.call('data_read',{path:relocated,track:fixture.track.name});assert.deepEqual(marks.rows,[[0,48,190],[7,167,141]],'relocated archive marks changed');
    return {status,export:{path:csv,sha256:hash(csv),comparison},marks:marks.rows};
  });
  assert.deepEqual(readdirSync(relocatedOutput),['relocated.csv'],'relocated reopen output contains unexpected artifacts');

  options.onBeforeFinalProvenanceRecheck?.();
  const sourceAfter=readBoundedRegularFile(sourcePath,'source video',MAX_SOURCE_VIDEO_BYTES);assert.equal(sourceAfter.sha256,trusted.source.sha256,'source video hash changed during Job G');
  const manifestAfter=readBoundedRegularFile(trusted.manifest.path,'Job G manifest',MAX_MANIFEST_BYTES);assert.equal(manifestAfter.sha256,trusted.manifest.sha256,'Job G manifest hash changed during Job G');assert.deepEqual(manifestAfter.bytes,trusted.manifest.bytes,'Job G manifest bytes changed during Job G');
  const services={create:created.owner,relocated_reopen:reopened.owner};
  for(const owner of Object.values(services)) {assert.equal(owner.mcp_terminated_after_client_close,true,'MCP owner was not reaped');assert.equal(owner.service_terminated_after_client_close,true,'Java owner was not reaped');}
  const pids=Object.values(services).flatMap(owner=>[owner.mcp_pid,owner.service_pid]);assert.equal(new Set(pids).size,pids.length,'Job G owners must all have distinct MCP and Java PIDs');
  const artifacts=Object.fromEntries(Object.entries({csv:created.value.export.path,trk:created.value.saved.trk_path,trz:created.value.saved.trz_path,media:created.value.media}).map(([key,file])=>[key,{path:file,sha256:hash(file)}]));
  const run={job:'G',input:{path:sourcePath,sha256:trusted.source.sha256,sha256_after:sourceAfter.sha256},fixture:{path:trusted.manifest.path,sha256:trusted.manifest.sha256,sha256_after:manifestAfter.sha256},services,evidence:created.value.evidence,submitted_marks:created.value.submitted_marks,status_before_save:created.value.status_before_save,status_after_save:created.value.status_after_save,create:{export:created.value.export,trk_marks:created.value.trk_marks,trz_marks:created.value.trz_marks},relocated_reopen:{path:relocated,sha256:hash(relocated),status:reopened.value.status,export:reopened.value.export,marks:reopened.value.marks},artifacts,standalone,archive,publication:{manifest_written_after_owners_reaped:true},manifest_path:manifestOutput};
  writeFileSync(manifestOutput,JSON.stringify(run,null,2)+'\n',{flag:'wx'});return run;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runJobG(process.argv[2]===undefined?undefined:path.resolve(process.argv[2]),process.argv[3]===undefined?undefined:path.resolve(process.argv[3])),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
