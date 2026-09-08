import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyS3(directory) {
  const text = readFileSync(join(directory, 'service.csv'), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines.shift(), 't,x,y,vx,vy');
  assert.equal(lines.length, 12);
  let maxError = 0;
  lines.forEach((line, n) => {
    const cells = line.split(',');
    assert.equal(cells.length, 5);
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const dx = 48 + 10*n + n*n - 96, dy = 190 - 7*n - 168;
    const values = [n/10, (c*dx-s*dy)/40, (-s*dx-c*dy)/40,
      (c*(100+20*n)+s*70)/40, (-s*(100+20*n)+c*70)/40];
    cells.forEach((cell, column) => {
      if ((n === 0 || n === 11) && column >= 3) {
        assert.equal(cell, '', 'Tracker velocity endpoints must be blank');
      } else {
        assert.notEqual(cell, '', `missing value at ${n},${column}`);
        const error = Math.abs(Number(cell)-values[column]);
        assert.ok(Number.isFinite(error) && error <= 1e-9, `mismatch at ${n},${column}`);
        maxError = Math.max(maxError, error);
      }
    });
  });
  assert.equal(readFileSync(join(directory, 'restored.csv'), 'utf8'), text);
  const corrected = readFileSync(join(directory, 'corrected.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(line => line.split(','));
  assert.equal(corrected.length, 10);
  assert.ok(!corrected.some(row => Math.abs(Number(row[0])-.5) < 1e-10 || Math.abs(Number(row[0])-.6) < 1e-10));
  const replacement = corrected.find(row => Math.abs(Number(row[0])-.7) < 1e-10);
  assert.ok(replacement);
  assert.ok(Math.abs(Number(replacement[1])-(Math.cos(Math.PI/6)*84-Math.sin(Math.PI/6)*(-31))/40) < 1e-9);
  const artifacts = {};
  for (const name of ['service.csv', 'golden.trk', 'synthetic-parabola.mp4', 'minimal.trz', 'with-html.trz', 'with-html-thumbnail.trz']) {
    artifacts[name] = createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
  }
  return { analytical_check: 'passed', rows: 12, max_absolute_error: maxError,
    official_tracker_check: 'pending', artifacts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] || 'service/build/spikes/s3-final');
  const report = verifyS3(directory);
  writeFileSync(join(directory, 'verification.json'), JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify(report, null, 2));
}
