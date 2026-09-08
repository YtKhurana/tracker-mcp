import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
test('distributable includes corresponding service source, license, build and replay inputs',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.version,'0.2.0');
  assert.equal(pkg.license,'GPL-3.0-only');
  assert.ok(pkg.files.includes('tsconfig.json'),'include the sidecar rebuild configuration');
  for(const entry of ['dist','src','service/src','service/test','service/build.sh','service/LICENSE','service/spikes/src','service/spikes/build-s2.sh','service/spikes/run-s2.sh','scripts/prepare-checkpoint.mjs','scripts/verify-s3.mjs','scripts/run-job-c.mjs','scripts/run-job-d.mjs','scripts/run-job-e.mjs','scripts/run-job-f.mjs','scripts/run-job-g.mjs','scripts/verify-official.mjs','fixtures/golden','fixtures/official','docs'])assert.ok(pkg.files.includes(entry),`missing package input ${entry}`);
  assert.equal(pkg.scripts['build:service'],'zsh service/build.sh');
  assert.equal(pkg.engines.node,'>=20');
  assert.equal(pkg.scripts['job:e'],'node scripts/run-job-e.mjs');
  assert.equal(pkg.scripts['job:f'],'node scripts/run-job-f.mjs');
  assert.equal(pkg.scripts['job:g'],'node scripts/run-job-g.mjs');
  assert.equal(pkg.dependencies.pngjs,'7.0.0');
  assert.equal(pkg.private,true,'do not accidentally publish private source to a public registry');
});

test('checkpoint runner freezes phase timeouts around the 60-second probe',async()=>{
  const source=readFileSync(new URL('../scripts/prepare-checkpoint.mjs',import.meta.url),'utf8');
  const constant=(name)=>{
    const match=source.match(new RegExp(`export const ${name} = (\\d+);`));
    assert.ok(match,`missing exported ${name}`);
    return Number(match[1]);
  };
  const buildTimeout=constant('BUILD_TIMEOUT_MS');
  const probeWait=constant('PROBE_WAIT_SECONDS');
  const writeTimeout=constant('WRITE_TIMEOUT_MS');
  assert.equal(buildTimeout,30000);
  assert.equal(probeWait,60);
  assert.equal(writeTimeout,120000);
  assert.ok(writeTimeout>=probeWait*1000+60000,'write watchdog must include 60 seconds of grace beyond the probe wait');
  assert.match(source,/runCheckpointCommand\(\['service\/spikes\/build-s2\.sh'\], BUILD_TIMEOUT_MS, 'build'\)/);
  assert.match(source,/String\(PROBE_WAIT_SECONDS\)\], WRITE_TIMEOUT_MS, 'write'\)/);
  assert.match(source,/result\.error\?\.code === 'ETIMEDOUT'/);
  assert.match(source,/killSignal: 'SIGKILL'/);
  assert.match(source,/spawn\('\/bin\/zsh', args,/);
  assert.match(source,/export function runCheckpointCommand\(/);
  assert.match(source,/if \(process\.argv\[1\].*fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(readFileSync(new URL('../service/spikes/build-s2.sh',import.meta.url),'utf8'),/^exec "\$APP_JAVAC"/m);
  assert.doesNotMatch(source,/\b(?:rmSync|unlinkSync|rmdirSync|removeOwnedCheckpointDirectory)\b/);
  assert.match(source,/const STAGING_PREFIX = 'checkpoint-incomplete-';/);
  assert.match(source,/mkdtempSync\(join\(checkpointRoot, STAGING_PREFIX\)\)/);
  assert.match(source,/const finalDirectory = join\(checkpointRoot, `checkpoint-\$\{basename\(directory\)\.slice\(STAGING_PREFIX\.length\)\}`\);/);
  const verificationIndex=source.indexOf("writeFileSync(join(directory, 'verification.json')");
  const renameIndex=source.indexOf('renameSync(directory, finalDirectory)');
  assert.ok(verificationIndex>=0&&renameIndex>verificationIndex,'rename must occur only after verification evidence is written');
  assert.match(source,/console\.log\(`Checkpoint ready: \$\{finalDirectory\}`\)/);
  const {runCheckpointCommand}=await import('../scripts/prepare-checkpoint.mjs');
  const calls=[];
  assert.throws(()=>runCheckpointCommand(['write'],writeTimeout,'write',(command,args,options)=>{
    calls.push({command,args,options});
    return {error:{code:'ETIMEDOUT'}};
  }),new RegExp(`checkpoint write phase timed out after ${writeTimeout} ms`));
  assert.deepEqual(calls,[{command:'/bin/zsh',args:['write'],options:{cwd:resolve(fileURLToPath(new URL('..',import.meta.url))),encoding:'utf8',timeout:writeTimeout,killSignal:'SIGKILL',maxBuffer:4*1024*1024}}]);
});
