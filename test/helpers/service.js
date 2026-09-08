import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

export const serviceRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function startService() {
  const build = spawnSync('/bin/zsh', ['service/build.sh'], {
    cwd: serviceRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const token = randomBytes(32).toString('hex');
  const child = spawn('/bin/zsh', ['service/run.sh'], {
    cwd: serviceRoot, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let log = '';
  child.stderr.on('data', data => { log = (log + data).slice(-16000); });
  child.stdin.on('error', () => {}); // Exit/close checks below report process failures.
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('service readiness timeout\n' + log)); }, 30000);
    const fail = error => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', (code, signal) => fail(new Error(`service exited before ready: ${code}/${signal}\n${log}`)));
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 4096) return fail(new Error('unexpected service stdout'));
      if (!buffer.includes('\n')) return;
      try {
        const record = JSON.parse(buffer.trim());
        assert.equal(record.ready, true);
        assert.ok(Number.isInteger(record.port) && record.port > 0 && record.port <= 65535);
        clearTimeout(timer);
        resolve(record);
      } catch (error) { fail(error); }
    });
  });
  child.stdin.write(token + '\n');
  let info;
  try { info = await ready; } catch (error) { child.kill('SIGKILL'); throw error; }
  let id = 0;
  function request(method, params = {}, suppliedToken = token) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      let buffer = '';
      const socket = createConnection({ host: '127.0.0.1', port: info.port });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error(`request timeout: ${method}\n${log}`)); }, 35000);
      const finish = (error, body) => {
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error); else resolve(body);
      };
      socket.on('error', error => finish(error));
      socket.on('connect', () => socket.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, token: suppliedToken, method, params }) + '\n'));
      socket.on('data', data => {
        buffer += data;
        if (buffer.length > 4 * 1024 * 1024) return finish(new Error('oversized response'));
        if (!buffer.includes('\n')) return;
        try {
          const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
          assert.equal(response.jsonrpc, '2.0');
          assert.equal(response.id, requestId);
          finish(null, response.result);
        } catch (error) { finish(error); }
      });
      socket.on('end', () => { if (!buffer.includes('\n')) finish(new Error('service closed without response')); });
    });
  }
  return { child, info, request, logs: () => log, async close() {
    child.stdin.end();
    let timer;
    const result = await Promise.race([exit, new Promise(resolve => {
      timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, signal: 'WATCHDOG' }); }, 10000);
    })]);
    clearTimeout(timer);
    assert.deepEqual(result, { code: 0, signal: null }, 'service failed to exit cleanly\n' + log);
  } };
}
