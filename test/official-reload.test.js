import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compareOfficial } from '../scripts/verify-official.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('official archive saved at frame 10 extracts requested frame 0 after relocation', {
  skip: process.env.TRACKER_NATIVE_TESTS !== '1', timeout: 90000,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'tracker-official-reload-'));
  const archive = join(directory, 'relocated.trz');
  copyFileSync(join(root, 'fixtures/official/official.trz'), archive);
  const run = (args) => {
    const result = spawnSync('/bin/zsh', args, {
      cwd: root, encoding: 'utf8', timeout: 60000,
      killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  run(['service/spikes/build-s2.sh']);
  const log = run(['service/spikes/run-s2.sh', 'reload', archive, join(directory, 'output'), '20']);
  for (const expected of [
    'RESULT reload_verified=true', 'RESULT frame_count=12',
    'RESULT frame0_bright_center=48,190', 'RESULT frame7_bright_center=167,141',
    'RESULT frame0_backseek_bright_center=48,190',
    'RESULT visible_windows_at_callback=0', 'RESULT visible_windows_after_dispose=0',
  ]) assert.ok(log.includes(expected), `Missing ${expected}\n${log}`);
  compareOfficial(readFileSync(join(root, 'fixtures/official/official.csv'), 'utf8'),
    readFileSync(join(directory, 'output/reloaded.csv'), 'utf8'));
});
