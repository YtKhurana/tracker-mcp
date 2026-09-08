import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,existsSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runJobC} from '../scripts/run-job-c.mjs';
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
  assert.deepEqual(JSON.parse(readFileSync(run.manifest_path,'utf8')),run);
});
