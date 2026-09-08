import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed from the observed Tracker Full Precision format (0.000000E0).
// This is a rounding contract, not a tolerance fitted to observed differences.
export function compareOfficial(official, reference) {
  const lines = official.trim().split(/\r?\n/);
  assert.equal(lines.shift(), ',synthetic mass,,,,', 'unexpected track header');
  assert.equal(lines.shift(), 't,x,y,vx,vy,', 'unexpected columns');
  const expected = reference.trim().split(/\r?\n/);
  assert.equal(expected.shift(), 't,x,y,vx,vy');
  assert.equal(lines.length, 12, 'official row count');
  assert.equal(expected.length, 12, 'reference row count');
  let maxAbsoluteError = 0;
  let numericCells = 0;
  lines.forEach((line, row) => {
    const cells = line.split(',');
    const values = expected[row].split(',');
    assert.equal(cells.length, 5);
    assert.equal(values.length, 5);
    cells.forEach((cell, column) => {
      const value = values[column];
      if ((row === 0 || row === 11) && column >= 3) {
        assert.equal(cell, '', 'official derivative endpoint');
        assert.equal(value, '', 'reference derivative endpoint');
        return;
      }
      assert.match(cell, /^-?\d\.\d{6}E[+-]?\d+$/, 'expected seven significant digits');
      assert.match(value, /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/, 'reference missing or malformed value');
      assert.ok(Number.isFinite(Number(value)), 'reference nonfinite value');
      assert.equal(Number(cell), Number(Number(value).toExponential(6)), `rounding mismatch at ${row},${column}`);
      maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(Number(cell) - Number(value)));
      numericCells++;
    });
  });
  return { rows: 12, numericCells, significantDigits: 7, maxAbsoluteError };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'usage: node scripts/verify-official.mjs official.csv reference.csv');
  console.log(JSON.stringify(compareOfficial(readFileSync(process.argv[2], 'utf8'), readFileSync(process.argv[3], 'utf8')), null, 2));
}
