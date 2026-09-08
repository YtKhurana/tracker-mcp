import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runJobC} from '../scripts/run-job-c.mjs';
import {spawnSync} from 'node:child_process';
import {readTrkFromZip} from '../dist/zip.js';
test('Job C never reuses an existing output directory',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'tracker-existing-job-'));
  await assert.rejects(runJobC(dir),/exist/i);
});
test('full SDK Job C produces hash-identified artifacts matching official CSV',{skip:process.env.TRACKER_NATIVE_TESTS!=='1',timeout:120000},async()=>{
  const run=await runJobC();
  assert.equal(run.official_check_required,true);assert.equal(run.comparison.rows,12);assert.equal(run.comparison.numericCells,56);
  assert.equal(run.marks.length,12);assert.deepEqual(run.marks[7],[7,167,141]);
  assert.equal(run.coords.origin_x,96);assert.equal(run.coords.origin_y,168);assert.equal(run.coords.scale,40);assert.equal(run.coords.length_unit,'m');
  assert.equal(run.coords.angle_rad,Math.atan2(Math.sin(Math.PI/6),Math.cos(Math.PI/6)));
  for(const artifact of Object.values(run.artifacts)) {assert.ok(path.isAbsolute(artifact.path));assert.ok(existsSync(artifact.path));assert.equal(createHash('sha256').update(readFileSync(artifact.path)).digest('hex'),artifact.sha256);}
  const archive=readFileSync(run.artifacts.trz.path);
  const namesResult=spawnSync('unzip',['-Z1',run.artifacts.trz.path],{encoding:'utf8'});assert.equal(namesResult.status,0,namesResult.stderr);
  const names=namesResult.stdout.trim().split('\n');
  assert.deepEqual(names.sort(),['project.trk','videos/media.mp4'],'archive must contain only stable project and media entries');
  const trkName=names.find(name=>name.endsWith('.trk'));const mediaName=names.find(name=>name.startsWith('videos/')&&name.endsWith('.mp4'));
  assert.ok(trkName&&!trkName.includes('/'),'archive project must be at the ZIP root');assert.ok(mediaName,'archive media must use Tracker\'s videos/ resource layout');
  const embedded=readTrkFromZip(archive,run.artifacts.trz.path);assert.equal(embedded.ok,true);
  assert.match(embedded.xml,new RegExp(`<property name="path" type="string">${mediaName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}</property>`));
  const media=spawnSync('unzip',['-p',run.artifacts.trz.path,mediaName],{encoding:null,maxBuffer:1024*1024});assert.equal(media.status,0,String(media.stderr));
  assert.equal(createHash('sha256').update(media.stdout).digest('hex'),run.input_sha256,'archive must preserve media bytes');
  assert.deepEqual(JSON.parse(readFileSync(run.manifest_path,'utf8')),run);
});
