import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
test('distributable includes corresponding service source, license, build and replay inputs',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.license,'GPL-3.0-only');
  assert.ok(pkg.files.includes('tsconfig.json'),'include the sidecar rebuild configuration');
  for(const entry of ['dist','src','service/src','service/test','service/build.sh','service/LICENSE','scripts/run-job-c.mjs','scripts/run-job-d.mjs','scripts/run-job-e.mjs','scripts/verify-official.mjs','fixtures/golden','fixtures/official','docs'])assert.ok(pkg.files.includes(entry),`missing package input ${entry}`);
  assert.equal(pkg.scripts['build:service'],'zsh service/build.sh');
  assert.equal(pkg.engines.node,'>=20');
  assert.equal(pkg.scripts['job:e'],'node scripts/run-job-e.mjs');
  assert.equal(pkg.private,true,'do not accidentally publish private source to a public registry');
});
