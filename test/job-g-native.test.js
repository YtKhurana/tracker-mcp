import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,readdirSync,symlinkSync,truncateSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {PNG} from 'pngjs';
import {detectJobGMarker,readJobGFrame,runJobG} from '../scripts/run-job-g.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.join(root,'fixtures/golden/synthetic-parabola.mp4');
const sourceSha='2011c8bc38a512bceae19bc7d58bbe84aeb53443be2647b7a0408f574bbf9434';
const manifest=path.join(root,'fixtures/golden/job-g-manifest.json');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

function assertGone(pid,label) {
  assert.ok(Number.isInteger(pid)&&pid>0,`${label} PID is invalid`);
  assert.throws(()=>process.kill(pid,0),error=>error?.code==='ESRCH',`${label} survived owner shutdown`);
}

function png(width=320,height=240,rectangles=[]) {
  const image=new PNG({width,height});
  for(let offset=0;offset<image.data.length;offset+=4) image.data.set([0,0,0,255],offset);
  for(const {x,y,width:rectWidth,height:rectHeight} of rectangles) for(let row=y;row<y+rectHeight;row++) for(let column=x;column<x+rectWidth;column++) image.data.set([255,255,0,255],(row*width+column)*4);
  return PNG.sync.write(image);
}

function pngIhdr({width,height,bitDepth=8,colorType=6,interlace=0}) {
  const bytes=Buffer.alloc(33),signature=Buffer.from([137,80,78,71,13,10,26,10]);
  signature.copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12,'ascii');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);
  bytes[24]=bitDepth;bytes[25]=colorType;bytes[26]=0;bytes[27]=0;bytes[28]=interlace;
  return bytes;
}

test('Job G fixture pins its bounded fixture-only detector inputs',()=>{
  const fixture=JSON.parse(readFileSync(manifest,'utf8'));
  assert.equal(fixture.fixture_id,'job-g-frame-assisted-point-mass-v1');
  assert.deepEqual(fixture.raw_video,{path:'synthetic-parabola.mp4',sha256:sourceSha});
  assert.equal(hash(source),sourceSha);
  assert.deepEqual(fixture.calibration,{origin_x:96,origin_y:168,angle_rad:Math.PI/6,scale:40,length_unit:'m',frame_interval_seconds:0.1});
  assert.deepEqual(fixture.sequence,[
    {frame:0,expected_point:[48,190]},
    {frame:7,expected_point:[167,141]},
    {frame:0,expected_point:[48,190]},
  ]);
  assert.deepEqual(fixture.track,{name:'frame-assisted target',type:'point_mass',mass:1});
  assert.equal(fixture.detector.scope,'fixture-only');
  assert.match(fixture.detector.note,/not general vision/i);
});

test('Job G portable detector accepts pinned frame PNGs and returns only their rounded yellow marker points',()=>{
  const first=detectJobGMarker(readFileSync(path.join(root,'fixtures/golden/frames/frame-0000.png')));
  const seventh=detectJobGMarker(readFileSync(path.join(root,'fixtures/golden/frames/frame-0007.png')));
  assert.deepEqual(first.point,[48,190]);assert.deepEqual(seventh.point,[167,141]);
  assert.deepEqual(first.mask,{count:216,bbox:{x:40,y:182,width:17,height:17},raw_centroid:{x:48,y:190}});
  assert.deepEqual(seventh.mask,{count:216,bbox:{x:159,y:133,width:17,height:17},raw_centroid:{x:167,y:141}});
  assert.deepEqual(first.png,{width:320,height:240,rgba:true});
});

test('Job G portable detector rejects malformed, oversized, empty, ambiguous, and wrong-geometry PNG masks',()=>{
  const frozen=readFileSync(path.join(root,'fixtures/golden/frames/frame-0000.png'));
  const corrupt=Buffer.from(frozen),idat=corrupt.indexOf(Buffer.from('IDAT'));
  assert.ok(idat>=0,'frozen PNG is missing IDAT');corrupt[idat+8]^=1;
  assert.throws(()=>detectJobGMarker(Buffer.alloc(1024*1024+1)),/byte limit/);
  assert.throws(()=>detectJobGMarker(Buffer.from('not a PNG')),/PNG signature/);
  assert.throws(()=>detectJobGMarker(corrupt),/CRC\/decoder/);
  assert.throws(()=>detectJobGMarker(png()),/mask count/);
  assert.throws(()=>detectJobGMarker(png(320,240,[{x:20,y:20,width:10,height:8},{x:200,y:20,width:10,height:8}])),/compact cluster/);
  assert.throws(()=>detectJobGMarker(png(320,240,[{x:20,y:20,width:10,height:15}])),/bbox/);
  assert.throws(()=>detectJobGMarker(png(319,240,[{x:20,y:20,width:15,height:15}])),/width/);
});

test('Job G rejects bounded hostile IHDR dimensions and interlacing before decoder allocation',()=>{
  for(const header of [
    pngIhdr({width:0xffffffff,height:240}),
    pngIhdr({width:320,height:0xffffffff,interlace:1}),
  ]) assert.throws(()=>detectJobGMarker(header),/PNG (width|height) must be/);
  assert.throws(()=>detectJobGMarker(pngIhdr({width:320,height:240,interlace:1})),/non-interlaced/);
});

test('Job G rejects unsafe frame paths and input provenance before it starts an owner',{skip:process.platform==='win32'},async()=>{
  const parent=mkdtempSync(path.join(tmpdir(),'tracker-job-g-provenance-'));
  const linked=path.join(parent,'linked.png');symlinkSync(path.join(root,'fixtures/golden/frames/frame-0000.png'),linked);
  assert.throws(()=>readJobGFrame(linked),/symbolic link/);
  await assert.rejects(runJobG('fixtures/golden/synthetic-parabola.mp4',path.join(parent,'relative-source-run')),/absolute/);
  await assert.rejects(runJobG(source,path.join(parent,'relative-manifest-run'),{manifestPath:'fixtures/golden/job-g-manifest.json'}),/absolute/);
  await assert.rejects(runJobG(path.join(parent,'missing.mp4'),path.join(parent,'missing-run')),/source video is unavailable/);
  const bad=path.join(parent,'bad.mp4');writeFileSync(bad,'not the pinned fixture');
  await assert.rejects(runJobG(bad,path.join(parent,'bad-run')),/source video hash does not match Job G manifest/);
  await assert.rejects(runJobG('/dev/null',path.join(parent,'nonregular-run')),/source video must be a canonical regular file/);
  const huge=path.join(parent,'huge.mp4');writeFileSync(huge,'');truncateSync(huge,64*1024*1024+1);
  await assert.rejects(runJobG(huge,path.join(parent,'huge-run')),/source video exceeds the 67108864 byte limit/);
  const missingManifest=path.join(parent,'missing.json');
  await assert.rejects(runJobG(source,path.join(parent,'missing-manifest-run'),{manifestPath:missingManifest}),/Job G manifest is unavailable/);
  const hugeManifest=path.join(parent,'huge.json');writeFileSync(hugeManifest,'');truncateSync(hugeManifest,1024*1024+1);
  await assert.rejects(runJobG(source,path.join(parent,'huge-manifest-run'),{manifestPath:hugeManifest}),/Job G manifest exceeds the 1048576 byte limit/);
});

test('Job G refuses an existing run directory before it starts an owner',async()=>{
  const runDir=mkdtempSync(path.join(tmpdir(),'tracker-existing-job-g-'));
  await assert.rejects(runJobG(source,runDir),/exist/i);
  assert.equal(existsSync(path.join(runDir,'run.json')),false);
});

test('full SDK Job G proves the bounded frame-assisted mark loop, archive layout, and relocation',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:180000},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-g-parent-')),'run');
  const live=[];
  const run=await runJobG(source,runDir,{onOwnerServiceStarted(kind,mcpPid,servicePid) {
    assert.equal(existsSync(path.join(runDir,'run.json')),false,`run.json appeared while ${kind} owner was live`);
    assert.doesNotThrow(()=>process.kill(mcpPid,0));assert.doesNotThrow(()=>process.kill(servicePid,0));live.push(kind);
  }});
  assert.equal(run.job,'G');assert.equal(run.input.sha256,sourceSha);assert.equal(run.input.sha256_after,sourceSha);
  assert.equal(run.fixture.sha256_after,run.fixture.sha256,'Job G manifest changed during the run');
  assert.deepEqual(live,['create','relocated-reopen']);
  assert.deepEqual(run.evidence.map(({ordinal,frame,point})=>({ordinal,frame,point})),[
    {ordinal:1,frame:0,point:[48,190]},
    {ordinal:2,frame:7,point:[167,141]},
    {ordinal:3,frame:0,point:[48,190]},
  ]);
  for(const evidence of run.evidence) {
    assert.equal(evidence.png.width,320);assert.equal(evidence.png.height,240);assert.equal(evidence.png.rgba,true);
    assert.ok(evidence.mask.count>=150&&evidence.mask.count<=260,'live marker count is outside the bounded detector range');
    assert.ok(evidence.mask.bbox.width>=15&&evidence.mask.bbox.width<=19,'live marker width is outside the bounded detector range');
    assert.ok(evidence.mask.bbox.height>=15&&evidence.mask.bbox.height<=19,'live marker height is outside the bounded detector range');
    assert.ok(typeof evidence.sha256==='string'&&evidence.sha256.length===64);assert.ok(evidence.size>0&&evidence.size<=1024*1024);
  }
  assert.deepEqual(run.submitted_marks.map(mark=>[mark.frame,mark.x,mark.y,mark.source.ordinal]),[[0,48,190,1],[7,167,141,2]]);
  assert.deepEqual(run.submitted_marks.map(mark=>mark.source.sha256),run.evidence.slice(0,2).map(evidence=>evidence.sha256));
  for(const phase of [run.create.export,run.relocated_reopen.export]) {
    assert.deepEqual(phase.comparison,{rows:2,numeric_cells:6,blank_cells:4,max_absolute_error:phase.comparison.max_absolute_error,derivative_blank_frames:[0,7]});
    assert.ok(phase.comparison.max_absolute_error<=1e-9);
  }
  assert.deepEqual(run.create.trk_marks,[[0,48,190],[7,167,141]]);assert.deepEqual(run.create.trz_marks,run.create.trk_marks);assert.deepEqual(run.relocated_reopen.marks,run.create.trk_marks);
  assert.deepEqual(run.archive.entries,['project.trk','videos/media.mp4']);assert.equal(run.archive.source_media_sha256,sourceSha);assert.equal(run.archive.saved_media_sha256,sourceSha);assert.equal(run.archive.companion_media_sha256,sourceSha);
  for(const owner of Object.values(run.services)) {
    assertGone(owner.mcp_pid,'MCP owner');assertGone(owner.service_pid,'Java owner');assert.equal(owner.mcp_terminated_after_client_close,true);assert.equal(owner.service_terminated_after_client_close,true);
  }
  const pids=Object.values(run.services).flatMap(owner=>[owner.mcp_pid,owner.service_pid]);assert.equal(new Set(pids).size,pids.length,'each fresh owner needs distinct MCP and Java processes');
  assert.equal(run.publication.manifest_written_after_owners_reaped,true);assert.deepEqual(JSON.parse(readFileSync(run.manifest_path,'utf8')),run);
});

test('Job G rejects a substituted valid frame 0 PNG before mark_set, save, or manifest publication',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:120000},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-g-substitution-')),'run');
  let mcpPid,servicePid,markSet=false,save=false;
  await assert.rejects(runJobG(source,runDir,{
    onOwnerMcpStarted(kind,pid) {if(kind==='create') mcpPid=pid;},
    onOwnerServiceStarted(kind,_mcpPid,pid) {if(kind==='create') servicePid=pid;},
    onAfterFrameGet({ordinal,path:framePath}) {if(ordinal===2) writeFileSync(framePath,readFileSync(path.join(root,'fixtures/golden/frames/frame-0000.png')));},
    onMarkSetInvoked() {markSet=true;},onSaveInvoked() {save=true;},
  }),/frame 7 detector result/);
  assert.equal(markSet,false,'mark_set must not run after a bad frame 7 proposal');assert.equal(save,false,'save must not run after a bad frame 7 proposal');
  assertGone(mcpPid,'substitution MCP owner');assertGone(servicePid,'substitution Java owner');assert.equal(existsSync(path.join(runDir,'run.json')),false);
});

test('Job G injected post-mark failure closes owners and never publishes a save or manifest',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:120000},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-g-post-mark-')),'run');
  let mcpPid,servicePid,markSet=false,save=false;
  await assert.rejects(runJobG(source,runDir,{injectFailureAfterMarkSet:true,
    onOwnerMcpStarted(kind,pid) {if(kind==='create') mcpPid=pid;},onOwnerServiceStarted(kind,_mcpPid,pid) {if(kind==='create') servicePid=pid;},
    onMarkSetInvoked() {markSet=true;},onSaveInvoked() {save=true;},
  }),/injected Job G failure after mark_set/);
  assert.equal(markSet,true);assert.equal(save,false);assertGone(mcpPid,'post-mark MCP owner');assertGone(servicePid,'post-mark Java owner');assert.equal(existsSync(path.join(runDir,'run.json')),false);assert.deepEqual(readdirSync(path.join(runDir,'create-output')),[]);
});

test('Job G rechecks raw-video and manifest provenance before publication',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:180000},async()=>{
  for(const [name,tamper,expected] of [
    ['source',({sourcePath})=>writeFileSync(sourcePath,'tampered raw fixture\n'),/source video hash changed during Job G/],
    ['manifest',({manifestPath})=>writeFileSync(manifestPath,'{}\n'),/Job G manifest hash changed during Job G/],
  ]) {
    const parent=mkdtempSync(path.join(tmpdir(),'tracker-job-g-tamper-'+name+'-'));
    const copiedSource=path.join(parent,'synthetic-parabola.mp4');writeFileSync(copiedSource,readFileSync(source));
    const copiedManifest=path.join(parent,'job-g-manifest.json');writeFileSync(copiedManifest,readFileSync(manifest));
    const runDir=path.join(parent,'run');
    await assert.rejects(runJobG(copiedSource,runDir,{manifestPath:copiedManifest,onBeforeFinalProvenanceRecheck:()=>tamper({sourcePath:copiedSource,manifestPath:copiedManifest})}),expected);
    assert.equal(existsSync(path.join(runDir,'run.json')),false);assert.equal(hash(source),sourceSha,'tamper proof must not alter the pinned source');
  }
});
