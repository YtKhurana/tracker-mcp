import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyS3 } from './verify-s3.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(args, timeout) {
  const result = spawnSync('/bin/zsh', args, { cwd: root, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 4*1024*1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `exit ${result.status}`);
  return result.stdout;
}
run(['service/spikes/build-s2.sh'], 30000);
const directory = mkdtempSync(join(root, 'service/build/spikes/checkpoint-'));
const log = run(['service/spikes/run-s2.sh', 'write', join(root, 'fixtures/golden/synthetic-parabola.mp4'), directory, '30'], 60000);
writeFileSync(join(directory, 'spike.log'), log);
for (const expected of ['RESULT coords_verified=true', 'RESULT marks_verified=12', 'RESULT visible_windows_at_callback=0', 'RESULT visible_windows_after_dispose=0']) {
  if (!log.includes(expected)) throw new Error(`missing success evidence: ${expected}`);
}
const report = verifyS3(directory);
writeFileSync(join(directory, 'verification.json'), JSON.stringify(report, null, 2)+'\n');
console.log(`Checkpoint ready: ${directory}`);
console.log(`Analytical maximum error: ${report.max_absolute_error}; official verification pending.`);
