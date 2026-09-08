import { spawnSync } from 'node:child_process';
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyS3 } from './verify-s3.mjs';

export const BUILD_TIMEOUT_MS = 30000;
export const PROBE_WAIT_SECONDS = 60;
export const WRITE_TIMEOUT_MS = 120000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkpointRoot = resolve(root, 'service/build/spikes');
const STAGING_PREFIX = 'checkpoint-incomplete-';

export function runCheckpointCommand(args, timeout, phase, spawn = spawnSync) {
  const result = spawn('/bin/zsh', args, { cwd: root, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 4*1024*1024 });
  if (result.error?.code === 'ETIMEDOUT') throw new Error(`checkpoint ${phase} phase timed out after ${timeout} ms`);
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `exit ${result.status}`);
  return result.stdout;
}

export function runCheckpoint() {
  runCheckpointCommand(['service/spikes/build-s2.sh'], BUILD_TIMEOUT_MS, 'build');
  const directory = mkdtempSync(join(checkpointRoot, STAGING_PREFIX));
  const log = runCheckpointCommand(['service/spikes/run-s2.sh', 'write', join(root, 'fixtures/golden/synthetic-parabola.mp4'), directory, String(PROBE_WAIT_SECONDS)], WRITE_TIMEOUT_MS, 'write');
  writeFileSync(join(directory, 'spike.log'), log);
  for (const expected of ['RESULT coords_verified=true', 'RESULT marks_verified=12', 'RESULT visible_windows_at_callback=0', 'RESULT visible_windows_after_dispose=0']) {
    if (!log.includes(expected)) throw new Error(`missing success evidence: ${expected}`);
  }
  const report = verifyS3(directory);
  writeFileSync(join(directory, 'verification.json'), JSON.stringify(report, null, 2)+'\n');
  const finalDirectory = join(checkpointRoot, `checkpoint-${basename(directory).slice(STAGING_PREFIX.length)}`);
  renameSync(directory, finalDirectory);
  console.log(`Checkpoint ready: ${finalDirectory}`);
  console.log(`Analytical maximum error: ${report.max_absolute_error}; official verification pending.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCheckpoint();
}
