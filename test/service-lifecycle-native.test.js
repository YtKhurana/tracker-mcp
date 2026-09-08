import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { serviceRoot } from './helpers/service.js';

test('service EDT timeouts poison state and suppress queued actions and late publication', {
  skip: process.env.TRACKER_NATIVE_TESTS !== '1', timeout: 90000,
}, () => {
  const app = process.env.TRACKER_APP || '/Applications/Tracker.app';
  const build = spawnSync('/bin/zsh', ['service/build.sh'], {
    cwd: serviceRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const result = spawnSync(join(app, 'Contents/runtime/Contents/Home/bin/java'), [
    '-Dapple.awt.UIElement=true', '-cp',
    `${join(serviceRoot, 'service/build/TrackerService.jar')}:${join(serviceRoot, 'service/build/test-classes')}:${join(app, 'Contents/app/*')}`,
    'tracker.mcp.EdtLifecycleTest',
  ], { cwd: serviceRoot, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EdtLifecycleTest passed/);
});
