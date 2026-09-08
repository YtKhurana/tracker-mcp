import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdtempSync,readdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {runJobD} from '../scripts/run-job-d.mjs';
import {readTrkFromZip,readZipEntry} from '../dist/zip.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.join(root,'service/build/final-mcp-v1-videos-layout/golden.trz');
const sourceSha='e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5';
const baselineCsvSha='d7dcf854fd94129df50a5dbd9e1a7a346a51a454d185ff5d9c4035c48bf83c70';
const hash=value=>createHash('sha256').update(value).digest('hex');

function copiedTrustedJobC({csvPath,copyCsv=true,trzPath}={}) {
  const dir=mkdtempSync(path.join(tmpdir(),'tracker-job-d-trusted-'));
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

test('Job D refuses to reuse an existing run directory',{skip:!existsSync(source)},async()=>{
  const runDir=mkdtempSync(path.join(tmpdir(),'tracker-existing-job-d-'));
  await assert.rejects(runJobD(source,runDir),/exist/i);
});

test('Job D rejects a source project whose hash is not the accepted Job C archive',{skip:!existsSync(source)},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-d-bad-hash-')),'run');
  await assert.rejects(runJobD(path.join(root,'fixtures/golden/synthetic-parabola.mp4'),runDir),/human-verified Job C artifact/);
});

test('Job D rejects a trusted Job C manifest with a missing baseline CSV',{skip:!existsSync(source)},async()=>{
  const trusted=copiedTrustedJobC({csvPath:path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-d-missing-csv-')),'missing.csv'),copyCsv:false});
  const runDir=path.join(trusted.dir,'run');
  await assert.rejects(runJobD(trusted.trz,runDir),/baseline CSV is missing/);
});

test('Job D rejects relative project and baseline paths before launching MCP',{skip:!existsSync(source)},async()=>{
  await assert.rejects(runJobD('service/build/final-mcp-v1-videos-layout/golden.trz'),/source project must be absolute/);
  const trusted=copiedTrustedJobC({csvPath:'golden.csv',copyCsv:false});
  await assert.rejects(runJobD(trusted.trz,path.join(trusted.dir,'run')),/Job C CSV path must be absolute/);
});

test('full SDK Job D reopens the verified artifact after relocation, exports, saves, and closes',{
  skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:120000,
},async()=>{
  assert.equal(hash(readFileSync(source)),sourceSha,'the human-verified Job C artifact changed');
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-d-parent-')),'run');
  const run=await runJobD(source,runDir);

  assert.equal(run.job,'D');
  assert.equal(run.input.sha256,sourceSha);
  assert.equal(run.input.relocated_sha256,sourceSha);
  assert.notEqual(run.input.path,run.input.relocated_path);
  assert.ok(path.isAbsolute(run.input.relocated_path));
  assert.deepEqual(run.status.coords,{origin_x:96,origin_y:168,angle_rad:Math.atan2(Math.sin(Math.PI/6),Math.cos(Math.PI/6)),scale:40,length_unit:'m'});
  assert.equal(run.status.dirty,false);
  assert.deepEqual(run.status.tracks,[{name:'synthetic mass',type:'point_mass',mass:1,mark_count:12}]);
  assert.deepEqual(run.marks,run.expected_marks);
  assert.deepEqual(run.marks[0],[0,48,190]);
  assert.deepEqual(run.marks[7],[7,167,141]);
  assert.deepEqual(run.comparison.columns,['t','x','y','vx','vy']);
  assert.equal(run.comparison.rows,12);assert.equal(run.comparison.numericCells,56);assert.equal(run.comparison.blankCells,4);
  assert.ok(run.comparison.maxAbsoluteError<=1e-9);
  assert.deepEqual(run.baseline,{path:path.join(path.dirname(source),'golden.csv'),sha256:baselineCsvSha});
  assert.equal(run.service.before_open.service,null);
  assert.ok(Number.isInteger(run.service.pid)&&run.service.pid>0);
  assert.equal(run.service.terminated_after_client_close,true);
  assertProcessGone(run.service.pid);

  const output=realpathSync(path.join(runDir,'outputs'));
  assert.equal(run.artifacts.csv.path,path.join(output,'reopened.csv'));
  assert.equal(run.artifacts.trk.path,path.join(output,'reopened.trk'));
  assert.equal(run.artifacts.trz.path,path.join(output,'reopened.trz'));
  assert.match(path.basename(run.artifacts.media.path),/^reopened-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i);
  assert.deepEqual(readdirSync(output).sort(),['reopened.csv','reopened.trk','reopened.trz',path.basename(run.artifacts.media.path)].sort());

  for(const artifact of Object.values(run.artifacts)) {
    assert.ok(path.isAbsolute(artifact.path));
    assert.ok(existsSync(artifact.path));
    assert.equal(hash(readFileSync(artifact.path)),artifact.sha256);
    assert.notEqual(artifact.path,run.input.path);
    assert.notEqual(artifact.path,run.input.relocated_path);
  }
  assert.deepEqual(JSON.parse(readFileSync(run.manifest_path,'utf8')),run);

  const embedded=readTrkFromZip(readFileSync(run.artifacts.trz.path),run.artifacts.trz.path);
  assert.equal(embedded.ok,true);
  assert.match(embedded.xml,/<property name="path" type="string">videos\/media\.mp4<\/property>/);
  const sourceMedia=readZipEntry(readFileSync(source),'videos/media.mp4');
  const savedMedia=readZipEntry(readFileSync(run.artifacts.trz.path),'videos/media.mp4');
  assert.equal(sourceMedia.ok,true);assert.equal(savedMedia.ok,true);
  assert.equal(run.artifacts.media.sha256,hash(sourceMedia.data),'companion changed accepted source media bytes');
  assert.equal(run.artifacts.media.sha256,hash(savedMedia.data),'companion changed saved archive media bytes');
});

test('Job D reaps its owned Java process when an error is injected after open',{
  skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:120000,
},async()=>{
  const runDir=path.join(mkdtempSync(path.join(tmpdir(),'tracker-job-d-injected-parent-')),'run');
  let servicePid;
  await assert.rejects(runJobD(source,runDir,{injectFailureAfterOpen:true,onServiceStarted:pid=>{servicePid=pid;}}),/injected Job D failure/);
  assertProcessGone(servicePid);
});
