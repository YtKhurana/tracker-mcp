import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { serviceRoot } from './helpers/service.js';

for (const shutdown of ['graceful', 'SIGKILL']) test(`MCP status lazily owns one native service; ${shutdown} shutdown reaps it`, {
  skip: process.env.TRACKER_NATIVE_TESTS !== '1', timeout: 90000,
}, async () => {
  const built = spawnSync('/bin/zsh', ['service/build.sh'], {
    cwd: serviceRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(built.error);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(serviceRoot, 'dist/index.js')],
    cwd: serviceRoot, stderr: 'pipe',
  });
  const client = new Client({ name: 'tracker-native-test', version: '1.0' });
  let servicePid;
  try {
    await client.connect(transport);
    transport.stderr?.on('data', () => {});
    const call = async probe => {
      const result = await client.callTool({ name: 'tracker_status', arguments: { probe_service: probe } });
      return JSON.parse(result.content[0].text);
    };
    const cold = await call(false);
    assert.equal(cold.ok, true);
    assert.equal(cold.service, null, 'read-only status started Java');
    const started = await call(true);
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.service?.running, true);
    servicePid = started.service.pid;
    assert.ok(Number.isInteger(servicePid) && servicePid > 0);
    const repeated = await call(true);
    assert.equal(repeated.service.pid, servicePid, 'probe started a second child');
    assert.equal((await call(false)).service.pid, servicePid);
    if (shutdown === 'SIGKILL') {
      assert.ok(transport.pid > 0);
      process.kill(transport.pid, 'SIGKILL');
    }
  } finally { await client.close(); }
  if (servicePid) {
    const until = Date.now() + 10000;
    let alive = true;
    while (alive && Date.now() < until) {
      try { process.kill(servicePid, 0); }
      catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      if (alive) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, 'sidecar shutdown leaked its Java child');
  }
});
