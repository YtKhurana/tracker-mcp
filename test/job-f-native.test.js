import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,statSync,truncateSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runJobF} from '../scripts/run-job-f.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.join(root,'fixtures/golden/synthetic-parabola.mp4');
const sourceSha='2011c8bc38a512bceae19bc7d58bbe84aeb53443be2647b7a0408f574bbf9434';
const manifest=path.join(root,'fixtures/golden/job-f-manifest.json');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

function assertGone(pid,label) {
  assert.ok(Number.isInteger(pid)&&pid>0,`${label} PID is invalid`);
  assert.throws(()=>process.kill(pid,0),error=>error?.code==='ESRCH',`${label} survived owner shutdown`);
}

test('Job F fixture pins the raw video and exact two-track input',()=>{
  const fixture=JSON.parse(readFileSync(manifest,'utf8'));
  assert.equal(fixture.fixture_id,'job-f-two-point-masses-v1');
  assert.equal(fixture.raw_video.path,'synthetic-parabola.mp4');
  assert.equal(fixture.raw_video.sha256,sourceSha);
  assert.equal(hash(source),sourceSha);
  assert.deepEqual(fixture.calibration,{origin_x:96,origin_y:168,angle_rad:Math.PI/6,scale:40,length_unit:'m',frame_interval_seconds:0.1});
  assert.deepEqual(fixture.tracks.map(track=>({name:track.name,type:track.type,mass:track.mass,marks:track.marks.length})),[
    {name:'parabolic target',type:'point_mass',mass:1.25,marks:12},
    {name:'linear reference',type:'point_mass',mass:2.75,marks:10},
  ]);
  assert.deepEqual(fixture.tracks[0].marks.map(mark=>[mark.frame,mark.x,mark.y]),[[0,48,190],[1,59,183],[2,72,176],[3,87,169],[4,104,162],[5,123,155],[6,144,148],[7,167,141],[8,192,134],[9,219,127],[10,248,120],[11,279,113]]);
  assert.deepEqual(fixture.tracks[1].marks.map(mark=>[mark.frame,mark.x,mark.y]),[[0,280,42],[1,271,48],[2,262,54],[3,253,60],[5,235,72],[6,226,78],[7,217,84],[9,199,96],[10,190,102],[11,181,108]]);
});

test('Job F refuses an existing run directory before starting an owner',async()=>{
  const runDir=mkdtempSync(path.join(tmpdir(),'tracker-existing-job-f-'));
  await assert.rejects(runJobF(source,runDir),/exist/i);
});

test('Job F rejects a structurally valid manifest with altered marks before run creation or MCP launch',async()=>{
  const parent=mkdtempSync(path.join(tmpdir(),'tracker-job-f-altered-manifest-'));
  const alteredManifest=path.join(parent,'job-f-manifest.json');
  const fixture=JSON.parse(readFileSync(manifest,'utf8'));
  fixture.tracks[0].marks[4].x+=1;
  writeFileSync(alteredManifest,JSON.stringify(fixture,null,2)+'\n');
  const runDir=path.join(parent,'must-not-exist');
  let mcpStarted=false;
  await assert.rejects(runJobF(source,runDir,{manifestPath:alteredManifest,onOwnerMcpStarted(){mcpStarted=true;}}),/Job F manifest is not the pinned fixture/);
  assert.equal(existsSync(runDir),false,'altered manifest must fail before run directory creation');
  assert.equal(mcpStarted,false,'altered manifest must fail before MCP launch');
});

test('Job F rejects bad, missing, oversized, or non-regular raw/manifest provenance before starting an owner',{skip:process.platform==='win32'},async()=>{
  const parent=mkdtempSync(path.join(tmpdir(),'tracker-job-f-provenance-'));
  await assert.rejects(runJobF(path.join(parent,'missing.mp4'),path.join(parent,'missing-run')),/source video is unavailable/);
  const bad=path.join(parent,'bad.mp4');writeFileSync(bad,'not the pinned fixture');
  await assert.rejects(runJobF(bad,path.join(parent,'bad-run')),/source video hash does not match Job F manifest/);
  await assert.rejects(runJobF('/dev/null',path.join(parent,'nonregular-run')),/source video must be a canonical regular file/);
  const huge=path.join(parent,'huge.mp4');writeFileSync(huge,'');truncateSync(huge,64*1024*1024+1);
  await assert.rejects(runJobF(huge,path.join(parent,'huge-run')),/source video exceeds the 67108864 byte limit/);
  const missingManifest=path.join(parent,'missing.json');
  await assert.rejects(runJobF(source,path.join(parent,'missing-manifest-run'),{manifestPath:missingManifest}),/Job F manifest is unavailable/);
  const hugeManifest=path.join(parent,'huge.json');writeFileSync(hugeManifest,'');truncateSync(hugeManifest,1024*1024+1);
  await assert.rejects(runJobF(source,path.join(parent,'huge-manifest-run'),{manifestPath:hugeManifest}),/Job F manifest exceeds the 1048576 byte limit/);
  const manifestDir=path.join(parent,'manifest-dir');mkdirSync(manifestDir);
  await assert.rejects(runJobF(source,path.join(parent,'dir-manifest-run'),{manifestPath:manifestDir}),/Job F manifest must be a canonical regular file/);
});

test('full SDK Job F creates, reopens, and relocates two isolated point masses',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:240000},async()=>{
  assert.equal(hash(source),sourceSha,'raw fixture changed before Job F');
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-f-parent-')),'run');
  const live=[];
  const run=await runJobF(source,runDir,{
    onOwnerServiceStarted(kind,mcpPid,servicePid) {
      assert.equal(existsSync(path.join(runDir,'run.json')),false,`run.json appeared while ${kind} owner was live`);
      assert.doesNotThrow(()=>process.kill(mcpPid,0));assert.doesNotThrow(()=>process.kill(servicePid,0));
      live.push(kind);
    },
  });
  assert.equal(run.job,'F');assert.equal(run.input.sha256,sourceSha);assert.equal(run.input.sha256_after,sourceSha);
  assert.equal(run.fixture.sha256_after,run.fixture.sha256,'Job F manifest changed during the run');
  assert.deepEqual(live,['create','standalone-reopen','relocated-reopen']);
  assert.deepEqual(run.status_before_save.tracks,[
    {name:'parabolic target',type:'point_mass',mass:1.25,mark_count:12},
    {name:'linear reference',type:'point_mass',mass:2.75,mark_count:10},
  ]);
  assert.equal(run.status_before_save.dirty,true);assert.equal(run.status_after_save.dirty,false);
  for(const phase of [run.create,run.standalone_reopen,run.relocated_reopen]) {
    assert.deepEqual(phase.exports.map(({comparison})=>({
      track:comparison.track,
      rows:comparison.rows,
      numeric_cells:comparison.numeric_cells,
      blank_cells:comparison.blank_cells,
      derivative_blank_frames:comparison.derivative_blank_frames,
    })),[
      {track:'parabolic target',rows:12,numeric_cells:56,blank_cells:4,derivative_blank_frames:[0,11]},
      {track:'linear reference',rows:10,numeric_cells:38,blank_cells:12,derivative_blank_frames:[0,3,5,7,9,11]},
    ]);
    for(const {comparison} of phase.exports) assert.ok(comparison.max_absolute_error<=1e-9);
  }
  assert.ok(run.create.exports[1].linear_closed_form_max_absolute_error<=1e-9);
  assert.deepEqual(run.marks.trk,run.marks.expected);assert.deepEqual(run.marks.trz,run.marks.expected);
  assert.deepEqual(run.archive.entries,['project.trk','videos/media.mp4']);
  assert.equal(run.archive.source_media_sha256,sourceSha);assert.equal(run.archive.saved_media_sha256,sourceSha);assert.equal(run.archive.companion_media_sha256,sourceSha);
  for(const owner of Object.values(run.services)) {
    assertGone(owner.mcp_pid,'MCP owner');assertGone(owner.service_pid,'Java owner');
    assert.equal(owner.mcp_terminated_after_client_close,true);assert.equal(owner.service_terminated_after_client_close,true);
  }
  const pids=Object.values(run.services).flatMap(owner=>[owner.mcp_pid,owner.service_pid]);
  assert.equal(new Set(pids).size,pids.length,'each fresh owner needs distinct MCP and Java processes');
  assert.equal(run.publication.manifest_written_after_owners_reaped,true);
  assert.deepEqual(JSON.parse(readFileSync(run.manifest_path,'utf8')),run);
});

test('Job F reaps owners and publishes no manifest when failures are injected',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:180000},async()=>{
  for(const [name,option,expectedOwner] of [
    ['after-first-track','injectFailureAfterFirstTrack','create'],
    ['during-reopen','injectFailureDuringReopen','standalone-reopen'],
  ]) {
    const runDir=path.join(mkdtempSync(path.join(tmpdir(),`tracker-job-f-${name}-`)),'run');
    let mcpPid,servicePid;
    await assert.rejects(runJobF(source,runDir,{[option]:true,onOwnerMcpStarted(kind,pid){if(kind===expectedOwner)mcpPid=pid;},onOwnerServiceStarted(kind,_mcpPid,pid){if(kind===expectedOwner)servicePid=pid;}}),/injected Job F failure/);
    assertGone(mcpPid,'injected MCP owner');assertGone(servicePid,'injected Java owner');
    assert.equal(existsSync(path.join(runDir,'run.json')),false,'failed run must not publish a manifest');
    if(name==='after-first-track') assert.deepEqual(readdirSync(path.join(runDir,'create-output')),[],'failure before save must not publish create artifacts');
    assert.equal(hash(source),sourceSha,'failed run must not alter the raw source');
  }
});

test('Job F rejects final raw-video or manifest provenance tampering',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:240000},async()=>{
  for(const [name,tamper,expected] of [
    ['source',({sourcePath})=>writeFileSync(sourcePath,'tampered raw fixture\n'),/source video hash changed during Job F/],
    ['manifest',({manifestPath})=>writeFileSync(manifestPath,'{}\n'),/Job F manifest hash changed during Job F/],
  ]) {
    const parent=mkdtempSync(path.join(tmpdir(),'tracker-job-f-tamper-'+name+'-'));
    const copiedSource=path.join(parent,'synthetic-parabola.mp4');writeFileSync(copiedSource,readFileSync(source));
    const copiedManifest=path.join(parent,'job-f-manifest.json');writeFileSync(copiedManifest,readFileSync(manifest));
    const runDir=path.join(parent,'run');
    await assert.rejects(runJobF(copiedSource,runDir,{manifestPath:copiedManifest,onBeforeFinalProvenanceRecheck:()=>tamper({sourcePath:copiedSource,manifestPath:copiedManifest})}),expected);
    assert.equal(existsSync(path.join(runDir,'run.json')),false);
    assert.equal(hash(source),sourceSha,'tamper proof must not alter the pinned source');
    assert.equal(statSync(copiedSource).isFile(),true);
  }
});
