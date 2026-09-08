import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,realpathSync,truncateSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runJobE} from '../scripts/run-job-e.mjs';
import {readTrkFromZip,readZipEntry} from '../dist/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.join(root,'service/build/final-mcp-v1-videos-layout/golden.trz');
const sourceSha='e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5';
const baselineCsvSha='d7dcf854fd94129df50a5dbd9e1a7a346a51a454d185ff5d9c4035c48bf83c70';
const hash=value=>createHash('sha256').update(value).digest('hex');

function copiedTrustedJobC({csvPath,copyCsv=true,trzPath}={}) {
  const dir=mkdtempSync(path.join(tmpdir(),'tracker-job-e-trusted-'));
  const copiedTrz=trzPath??path.join(dir,'golden.trz');
  if(trzPath===undefined)copyFileSync(source,copiedTrz);
  const copiedCsv=csvPath??path.join(dir,'golden.csv');
  if(copyCsv)copyFileSync(path.join(path.dirname(source),'golden.csv'),copiedCsv);
  writeFileSync(path.join(dir,'run.json'),JSON.stringify({job:'C',artifacts:{
    trz:{path:copiedTrz,sha256:sourceSha},csv:{path:copiedCsv,sha256:baselineCsvSha},
  }}));
  return {dir,trz:copiedTrz,csv:copiedCsv};
}

function assertProcessGone(pid) {
  assert.ok(Number.isInteger(pid)&&pid>0);
  assert.throws(()=>process.kill(pid,0),error=>error?.code==='ESRCH','owned Java process survived client shutdown');
}

test('Job E refuses to reuse an existing run directory',{skip:!existsSync(source)},async()=>{
  const runDir=mkdtempSync(path.join(tmpdir(),'tracker-existing-job-e-'));
  await assert.rejects(runJobE(source,runDir),/exist/i);
});

test('Job E rejects an unverified source project before launching MCP',{skip:!existsSync(source)},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-e-bad-hash-')),'run');
  await assert.rejects(runJobE(path.join(root,'fixtures/golden/synthetic-parabola.mp4'),runDir),/human-verified Job C artifact/);
});

test('Job E rejects relative Job C baseline provenance before launching MCP',{skip:!existsSync(source)},async()=>{
  const trusted=copiedTrustedJobC({csvPath:'golden.csv',copyCsv:false});
  await assert.rejects(runJobE(trusted.trz,path.join(trusted.dir,'run')),/Job C CSV path must be absolute/);
});

test('Job E rejects oversized source and baseline provenance before launching MCP',{skip:!existsSync(source)},async()=>{
  const oversizedSource=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-e-large-source-')),'oversized.trz');
  writeFileSync(oversizedSource,'');truncateSync(oversizedSource,64*1024*1024+1);
  await assert.rejects(runJobE(oversizedSource,path.join(path.dirname(oversizedSource),'run')),/source project exceeds the 67108864 byte limit/);

  const trusted=copiedTrustedJobC();
  truncateSync(trusted.csv,8*1024*1024+1);
  await assert.rejects(runJobE(trusted.trz,path.join(trusted.dir,'run')),/Job C baseline CSV exceeds the 8388608 byte limit/);
});

test('Job E rejects non-regular source and manifest provenance before launching MCP',{skip:process.platform==='win32'||!existsSync(source)},async()=>{
  const sourceRun=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-e-nonregular-source-')),'run');
  await assert.rejects(runJobE('/dev/null',sourceRun),/source project must be a canonical regular file/);

  const dir=mkdtempSync(path.join(tmpdir(),'tracker-job-e-nonregular-manifest-'));
  const trz=path.join(dir,'golden.trz');copyFileSync(source,trz);mkdirSync(path.join(dir,'run.json'));
  await assert.rejects(runJobE(trz,path.join(dir,'run')),/Job C run.json must be a canonical regular file/);
});

test('full SDK Job E clears frame 5, replaces frame 7, saves, and reopens in a fresh owner',{
  skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:180000,
},async()=>{
  assert.equal(hash(readFileSync(source)),sourceSha,'the human-verified Job C artifact changed before Job E');
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-e-parent-')),'run');
  const live=[];let mutationMcpPid,reopenMcpPid;
  const assertManifestAbsentWhileOwnerLives=(phase,mcpPid,servicePid)=>{
    assert.equal(existsSync(path.join(runDir,'run.json')),false,`run.json appeared while the ${phase} owner was live`);
    assert.doesNotThrow(()=>process.kill(mcpPid,0));assert.doesNotThrow(()=>process.kill(servicePid,0));
    live.push(phase);
  };
  const run=await runJobE(source,runDir,{
    onMutationMcpStarted:pid=>{mutationMcpPid=pid;},
    onMutationServiceStarted:pid=>assertManifestAbsentWhileOwnerLives('mutation',mutationMcpPid,pid),
    onReopenMcpStarted:pid=>{reopenMcpPid=pid;},
    onReopenServiceStarted:pid=>assertManifestAbsentWhileOwnerLives('reopen',reopenMcpPid,pid),
  });

  assert.equal(run.job,'E');
  assert.equal(run.input.sha256,sourceSha);assert.equal(run.input.relocated_sha256,sourceSha);
  assert.equal(run.input.source_sha256_after,sourceSha,'Job E must recheck source provenance after the run');
  assert.equal(run.baseline.sha256,baselineCsvSha);assert.equal(run.baseline.sha256_after,baselineCsvSha,'Job E must recheck baseline provenance after the run');
  assert.notEqual(run.input.path,run.input.relocated_path);
  assert.equal(run.mutation.expected_marks.length,11);assert.deepEqual(run.mutation.marks,run.mutation.expected_marks);
  assert.deepEqual(run.mutation.mark_diff,{cleared:[5],replaced:[{frame:7,before:[167,141],after:[180,137]}]});
  assert.deepEqual(run.mutation.expected_frames,[0,1,2,3,4,6,7,8,9,10,11]);
  assert.equal(run.mutation.comparison.rows,11);assert.equal(run.mutation.comparison.numericCells,47);assert.equal(run.mutation.comparison.blankCells,8);
  assert.deepEqual(run.mutation.comparison.derivative_blank_frames,[0,4,6,11]);
  assert.ok(run.mutation.comparison.max_absolute_error<=1e-9);
  assert.ok(run.mutation.comparison.frame7_velocity_matches_baseline<=1e-9);
  assert.ok(run.mutation.comparison.frame8_velocity_change>1e-6);
  assert.equal(run.reopen.comparison.rows,11);assert.equal(run.reopen.comparison.numericCells,47);assert.equal(run.reopen.comparison.blankCells,8);
  assert.deepEqual(run.reopen.comparison.derivative_blank_frames,[0,4,6,11]);
  assert.ok(run.reopen.comparison.max_absolute_error<=1e-9);
  assert.deepEqual(run.reopen.marks,run.mutation.expected_marks);

  for(const state of [run.mutation.status,run.reopen.status]) {
    assert.deepEqual(state.coords,{origin_x:96,origin_y:168,angle_rad:Math.atan2(Math.sin(Math.PI/6),Math.cos(Math.PI/6)),scale:40,length_unit:'m'});
    assert.deepEqual(state.tracks,[{name:'synthetic mass',type:'point_mass',mass:1,mark_count:11}]);
    assert.equal(state.dirty,false);
  }
  assert.equal(run.mutation.status_before_save.dirty,true);
  for(const owner of [run.services.mutation,run.services.reopen]) {
    assert.ok(Number.isInteger(owner.mcp_pid)&&owner.mcp_pid>0);
    assert.ok(Number.isInteger(owner.service_pid)&&owner.service_pid>0);
    assert.equal(owner.mcp_terminated_after_client_close,true);
    assert.equal(owner.service_terminated_after_client_close,true);
    assertProcessGone(owner.mcp_pid);assertProcessGone(owner.service_pid);
  }
  assert.notEqual(run.services.mutation.mcp_pid,run.services.reopen.mcp_pid,'reopen must use a distinct fresh MCP owner');
  assert.notEqual(run.services.mutation.service_pid,run.services.reopen.service_pid,'reopen must use a distinct fresh Java owner');
  assert.equal(run.publication.manifest_written_after_owners_reaped,true);
  assert.deepEqual(live,['mutation','reopen']);

  const relocated=realpathSync(path.join(runDir,'relocated-input'));
  const mutationOutput=realpathSync(path.join(runDir,'mutation-output'));
  const reopenOutput=realpathSync(path.join(runDir,'reopen-output'));
  assert.deepEqual(readdirSync(relocated),['verified-job-c.trz']);
  assert.deepEqual(readdirSync(mutationOutput).sort(),[
    'corrected.csv','corrected.trk','corrected.trz',path.basename(run.artifacts.media.path),
  ].sort());
  assert.deepEqual(readdirSync(reopenOutput),['corrected-reopened.csv']);
  assert.deepEqual(readdirSync(runDir).sort(),['mutation-output','relocated-input','reopen-output','run.json']);
  for(const artifact of Object.values(run.artifacts)) {
    assert.ok(path.isAbsolute(artifact.path));assert.ok(existsSync(artifact.path));
    assert.equal(hash(readFileSync(artifact.path)),artifact.sha256);
  }
  assert.equal(run.artifacts.csv.path,path.join(mutationOutput,'corrected.csv'));
  assert.equal(run.artifacts.trk.path,path.join(mutationOutput,'corrected.trk'));
  assert.equal(run.artifacts.trz.path,path.join(mutationOutput,'corrected.trz'));
  assert.equal(run.reopen.artifact.path,path.join(reopenOutput,'corrected-reopened.csv'));
  assert.deepEqual(run.standalone.marks,run.mutation.expected_marks,'standalone corrected.trk did not persist exact marks');
  assert.equal(run.standalone.media_path,path.basename(run.artifacts.media.path));
  assert.match(readFileSync(run.artifacts.trk.path,'utf8'),new RegExp(`<property name="path" type="string">${path.basename(run.artifacts.media.path).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}</property>`));

  assert.deepEqual(run.archive.entries,['project.trk','videos/media.mp4']);
  const archive=readFileSync(run.artifacts.trz.path);
  const embedded=readTrkFromZip(archive,run.artifacts.trz.path);
  assert.equal(embedded.ok,true);assert.equal(embedded.name,'project.trk');
  assert.match(embedded.xml,/<property name="path" type="string">videos\/media\.mp4<\/property>/);
  const sourceMedia=readZipEntry(readFileSync(source),'videos/media.mp4');
  const savedMedia=readZipEntry(archive,'videos/media.mp4');
  assert.equal(sourceMedia.ok,true);assert.equal(savedMedia.ok,true);
  assert.equal(run.archive.source_media_sha256,hash(sourceMedia.data));
  assert.equal(run.archive.saved_media_sha256,hash(savedMedia.data));
  assert.equal(run.archive.companion_media_sha256,hash(readFileSync(run.artifacts.media.path)));
  assert.equal(run.archive.source_media_sha256,run.archive.saved_media_sha256);
  assert.equal(run.archive.source_media_sha256,run.archive.companion_media_sha256);
  assert.deepEqual(JSON.parse(readFileSync(run.manifest_path,'utf8')),run);
});

test('Job E refuses a Job C baseline changed after initial provenance verification',{
  skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:180000,
},async()=>{
  const trusted=copiedTrustedJobC();
  const runDir=path.join(trusted.dir,'run');
  await assert.rejects(runJobE(trusted.trz,runDir,{onBeforeFinalProvenanceRecheck:()=>writeFileSync(trusted.csv,'tampered after initial verification\n')}),/Job C baseline CSV hash changed during Job E/);
  assert.equal(existsSync(path.join(runDir,'run.json')),false,'changed baseline must prevent manifest publication');
});

test('Job E reaps its mutation owner when failure is injected after mutation before save',{
  skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:120000,
},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-e-injected-parent-')),'run');
  let mcpPid,servicePid;
  await assert.rejects(runJobE(source,runDir,{injectFailureAfterMutationBeforeSave:true,onMutationMcpStarted:pid=>{mcpPid=pid;},onMutationServiceStarted:pid=>{servicePid=pid;}}),/injected Job E failure after mutation before save/);
  assertProcessGone(mcpPid);assertProcessGone(servicePid);
  assert.equal(existsSync(path.join(runDir,'run.json')),false,'failure must not publish a run manifest');
  assert.equal(hash(readFileSync(source)),sourceSha,'injected mutation failure must not alter the verified source');
});
