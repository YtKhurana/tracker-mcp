import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compareOfficial } from '../scripts/verify-official.mjs';

const read = path => readFileSync(new URL(path, import.meta.url));
const official = read('../fixtures/official/official.csv').toString();
const analytical = read('../fixtures/golden/analytical-expected.csv').toString().trim().split(/\r?\n/);
assert.equal(analytical.shift(), 'frame,t,x,y,vx,vy');
// Continuous analytical derivatives exist at endpoints; Tracker's central
// differences do not. Project the analytical table to that documented shape.
const reference = ['t,x,y,vx,vy', ...analytical.map((line, row) => {
  const cells = line.split(',');
  assert.equal(Number(cells.shift()), row);
  if (row === 0 || row === 11) cells.splice(3, 2, '', '');
  return cells.join(',');
})].join('\n');

test('untouched official artifacts retain their human-checkpoint hashes', () => {
  for (const [name, hash] of Object.entries({
    'official.csv': '210b11edb567787c9462a6b2da450784664c4278a986d29c0da587c758bfc8bf',
    'official.trz': '83292ade5ffe389e1286c31df004658b9f56f98f83ceaac1a3471a111d7d1d01',
    'service-generated.trz': '0c62192ed4157a8d63c57a165fb97308cc98075672cde3ecc1f133753c157f38',
  })) assert.equal(createHash('sha256').update(read('../fixtures/official/' + name)).digest('hex'), hash);
});

test('official export matches independent analytical values at seven significant digits', () => {
  assert.equal(compareOfficial(official, reference).numericCells, 56);
});

test('official comparator rejects changed values, blanks, headers, precision and row counts', () => {
  for (const bad of [
    official.replace('-1.314230E0', '-1.314231E0'),
    official.replace('1.236860E-1,,', '1.236860E-1,0.000000E0,'),
    official.replace('t,x,y,vx,vy,', 't,y,x,vx,vy,'),
    official.replace('-1.314230E0', '-1.314E0'),
    official.trim().split('\n').slice(0, -1).join('\n'),
  ]) assert.throws(() => compareOfficial(bad, reference));
  for (const value of ['', ' ', 'NaN', 'Infinity', '0x0']) {
    const rows = reference.split('\n');
    const cells = rows[1].split(',');
    cells[0] = value;
    rows[1] = cells.join(',');
    assert.throws(() => compareOfficial(official, rows.join('\n')));
  }
});
