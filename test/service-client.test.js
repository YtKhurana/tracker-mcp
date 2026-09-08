import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { existsSync, writeFileSync, symlinkSync, unlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ServiceClient } from '../dist/service-client.js';
import { runTrackerStatusWithService } from '../dist/status.js';
import { makeTrackerBundle } from './helpers/bundle.js';

async function fixture(t, behavior = {}) {
  const bundle = makeTrackerBundle();
  for (const name of ['tracker.jar', 'slf4j-api.jar', 'logback-classic.jar', 'logback-core.jar']) writeFileSync(path.join(bundle.app, 'Contents/app', name), 'jar');
  const jar = path.join(bundle.root, 'TrackerService.jar'); writeFileSync(jar, 'jar');
  const sockets = new Set(); let token; let launches = 0; let child; let launchOptions;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let text = ''; socket.on('data', chunk => {
      text += chunk;
      if (!text.includes('\n')) return;
      const req = JSON.parse(text.trim()); assert.equal(req.token, token);
      behavior.received?.(req);
      if (behavior.hang) return;
      const response = behavior.response?.(req) ?? JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true, running: true } }) + '\n';
      socket.write(response.slice(0, 10)); setImmediate(() => socket.end(response.slice(10)));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new ServiceClient({ discover: { env: { TRACKER_APP: bundle.app } }, serviceJar: jar, startupTimeoutMs: 100, requestTimeoutMs: 100, shutdownGraceMs: 10,
    launch(command, args, options) {
      launches++; launchOptions = { command, args, options };
      if (behavior.launchThrow) throw new Error('cannot spawn');
      child = Object.assign(new EventEmitter(), { pid: 54321, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
      child.kill = signal => { child.signalCode = signal; child.emit('exit', null, signal); child.emit('close', null, signal); return true; };
      child.stdin.on('data', chunk => { token = chunk.toString().trim(); });
      child.stdin.on('finish', () => { if (!behavior.ignoreEof) child.kill('EOF'); });
      setImmediate(() => {
        if (behavior.spawnError) { child.pid = undefined; child.emit('error', new Error('ENOENT')); return; }
        if (behavior.noReady) return;
        const line = behavior.ready ?? JSON.stringify({ ready: true, port: server.address().port, pid: child.pid }) + '\n';
        child.stdout.write(line.slice(0, 5)); child.stdout.write(line.slice(5));
      });
      return child;
    }
  });
  t.after(async () => { await client.close(); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { client, bundle, get launches() { return launches; }, get child() { return child; }, get launchOptions() { return launchOptions; } };
}

test('lazy status and fragmented authenticated replies; runtime cleanup', async t => {
  const f = await fixture(t);
  const preflight = await runTrackerStatusWithService({}, f.client, { env: { TRACKER_APP: f.bundle.app } });
  assert.equal(preflight.service, null); assert.equal(f.launches, 0);
  assert.equal((await f.client.request('status')).ok, true);
  assert.deepEqual(f.client.snapshot(), { running: true, pid: 54321 });
  assert.equal(f.launches, 1);
  assert.ok(f.launchOptions.command.startsWith(realpathSync(f.bundle.home) + path.sep));
  assert.equal(f.launchOptions.options.shell, false);
  const runtime = f.launchOptions.options.env.HOME;
  assert.ok(existsSync(runtime)); await f.client.close(); assert.equal(existsSync(runtime), false);
});
test('concurrent startup is rejected without duplicate children', async t => {
  const f = await fixture(t); const first = f.client.request('status');
  assert.equal((await f.client.request('status')).error.code, 'SESSION_BUSY');
  assert.equal((await first).ok, true); assert.equal(f.launches, 1);
});
for (const [name, behavior, code] of [
  ['startup timeout', { noReady: true }, 'TIMEOUT'],
  ['request timeout', { hang: true, ignoreEof: true }, 'TIMEOUT'],
  ['wrong readiness pid', { ready: '{"ready":true,"port":1234,"pid":1}\n' }, 'SERVICE_UNAVAILABLE'],
  ['oversized readiness', { ready: 'x'.repeat(4097) }, 'SERVICE_UNAVAILABLE'],
  ['missing result', { response: req => JSON.stringify({jsonrpc:'2.0',id:req.id})+'\n' }, 'SERVICE_UNAVAILABLE'],
  ['malformed reply', { response: () => 'garbage\n' }, 'SERVICE_UNAVAILABLE'],
  ['wrong reply ID', { response: () => '{"jsonrpc":"2.0","id":100,"result":{"ok":true}}\n' }, 'SERVICE_UNAVAILABLE'],
  ['oversized reply', { response: () => 'x'.repeat(4 * 1024 * 1024 + 1) }, 'SERVICE_UNAVAILABLE'],
  ['service poison', { response: req => JSON.stringify({ jsonrpc:'2.0', id:req.id, result:{ok:false,error:{code:'TIMEOUT',message:'poisoned',details:{}}} })+'\n' }, 'TIMEOUT'],
]) test(name + ' terminates the child', async t => {
  const f = await fixture(t, behavior); assert.equal((await f.client.request('status')).error.code, code);
  assert.equal(f.client.snapshot(), null); assert.notEqual(f.child.signalCode, null);
});
test('unexpected exit fails active request and close interrupts startup', async t => {
  const f = await fixture(t, { hang: true }); const pending = f.client.request('status');
  setTimeout(() => f.child.kill('CRASH'), 20);
  assert.equal((await pending).error.code, 'JAVA_EXIT');
  const g = await fixture(t, { noReady:true }); const starting = g.client.request('status');
  await g.client.close(); assert.equal((await starting).error.code, 'JAVA_EXIT'); assert.equal(g.client.snapshot(), null);
});
test('spawn errors and missing service artifact have actionable errors', async t => {
  for (const behavior of [{launchThrow:true}, {spawnError:true}]) {
    const f = await fixture(t, behavior); const result = await f.client.request('status');
    assert.ok(['JAVA_EXIT','SERVICE_UNAVAILABLE'].includes(result.error.code));
    assert.equal(existsSync(f.launchOptions.options.env.HOME), false);
  }
  const f = await fixture(t); unlinkSync(path.join(f.bundle.root, 'TrackerService.jar'));
  const result = await f.client.request('status'); assert.equal(result.error.code,'SERVICE_UNAVAILABLE');
  assert.match(result.error.message,/service\/build.sh/); assert.equal(f.launches,0);
});
test('outside-app jar symlink is refused before launch', async t => {
  const f = await fixture(t); const jar = path.join(f.bundle.app,'Contents/app/tracker.jar');
  unlinkSync(jar); symlinkSync(path.join(f.bundle.root,'TrackerService.jar'),jar);
  assert.equal((await f.client.request('status')).error.code,'SERVICE_UNAVAILABLE'); assert.equal(f.launches,0);
});
test('false status reports already running child and launch contains no token or inherited injection', async t => {
  const f = await fixture(t); await f.client.request('status');
  const status = await runTrackerStatusWithService({probe_service:false},f.client,{env:{TRACKER_APP:f.bundle.app}});
  assert.equal(status.service.pid,54321); assert.equal(f.launches,1);
  assert.doesNotMatch(f.launchOptions.args.join(' '), /[a-f0-9]{64}/);
  assert.equal(f.launchOptions.options.env.JAVA_TOOL_OPTIONS,undefined);
});

test('late child exit permits recovery but never launches over a still-live poisoned child', async t => {
  const behavior = { hang: true, ignoreEof: true };
  const f = await fixture(t, behavior);
  const pending = f.client.request('status');
  f.child.kill = () => true; // OS accepted termination, but exit arrives late.
  assert.equal((await pending).error.code, 'TIMEOUT');
  assert.equal((await f.client.request('status')).error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(f.launches, 1);
  f.child.emit('exit', null, 'SIGKILL');
  behavior.hang = false;
  assert.equal((await f.client.request('status')).ok, true);
  assert.equal(f.launches, 2);
});

test('an ambiguous mutation is sent exactly once and its child is terminated', async t => {
  const requests = [];
  const f = await fixture(t, {hang:true, ignoreEof:true, received:req => requests.push(req)});
  assert.equal((await f.client.request('mark', {session_id:'example', track:'mass', marks:[]})).error.code, 'TIMEOUT');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'mark');
  assert.equal(f.launches, 1);
  assert.equal(f.child.signalCode, 'SIGKILL');
});
