import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTrackerRuntime, type DiscoverOptions } from './discover.js';
import { ALL_ERROR_CODES, fail, type ErrorEnvelope } from './errors.js';

export type ServiceResult = ({ ok: true } & Record<string, unknown>) | ErrorEnvelope;
export type ServiceSnapshot = { running: true; pid: number } | null;
export type ServiceClientOptions = {
  discover?: DiscoverOptions;
  serviceJar?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownGraceMs?: number;
  launch?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
};
type State = {
  child: ChildProcessWithoutNullStreams; token: string; runtime: string; port?: number;
  exited: boolean; poisoned: boolean; exit: Promise<void>; stop?: Promise<void>;
  cancel?: (error: ErrorEnvelope) => void;
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const unavailable = () => fail('SERVICE_UNAVAILABLE', 'TrackerService returned an invalid or incomplete response');
const javaExit = () => fail('JAVA_EXIT', 'TrackerService exited; reopen the last saved project to recover');

/** Owns one JVM. A failed call is never retried: its mutation may have completed. */
export class ServiceClient {
  private readonly options: ServiceClientOptions;
  private state?: State;
  private busy = false;
  private closed = false;
  private id = 0;
  constructor(options: ServiceClientOptions = {}) { this.options = options; }

  snapshot(): ServiceSnapshot {
    const s = this.state;
    return s && !s.exited && !s.poisoned && s.port !== undefined && s.child.pid ? { running: true, pid: s.child.pid } : null;
  }

  async request(method: string, params: Record<string, unknown> = {}, timeoutMs = this.options.requestTimeoutMs ?? 65000): Promise<ServiceResult> {
    if (this.closed) return javaExit();
    if (this.busy) return fail('SESSION_BUSY', 'Another TrackerService request is in progress');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) return fail('INVALID_ARGUMENT', 'timeout must be an integer from 1 to 300000 milliseconds');
    this.busy = true;
    try {
      if (!this.state) {
        const started = this.launch();
        if ('ok' in started) return started;
        this.state = started;
        const ready = await this.readReady(started);
        if (!ready.ok) { await this.stop(started); return ready; }
      }
      const s = this.state;
      if (!s) return javaExit();
      if (this.closed || s.exited) { await this.stop(s); return javaExit(); }
      if (s.poisoned) return fail('SERVICE_UNAVAILABLE', 'The previous TrackerService process has not terminated');
      let wire: string;
      const id = ++this.id;
      try { wire = JSON.stringify({ jsonrpc: '2.0', id, token: s.token, method, params }) + '\n'; }
      catch { return fail('INVALID_ARGUMENT', 'Service arguments must be JSON values'); }
      if (Buffer.byteLength(wire) > 2 * 1024 * 1024) return fail('INVALID_ARGUMENT', 'Service request exceeds 2 MiB');
      const result = await this.exchange(s, wire, id, timeoutMs);
      if (!result.ok && ['TIMEOUT', 'JAVA_EXIT', 'SERVICE_UNAVAILABLE'].includes(result.error.code)) await this.stop(s);
      return result;
    } catch {
      if (this.state) await this.stop(this.state);
      return fail('SERVICE_UNAVAILABLE', 'Could not start or communicate with TrackerService');
    } finally { this.busy = false; }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.state) await this.stop(this.state);
  }

  private launch(): State | ErrorEnvelope {
    const discovered = discoverTrackerRuntime(this.options.discover);
    if (!discovered.ok) return fail('SERVICE_UNAVAILABLE', discovered.error.message, discovered.error.details);
    const jar = this.options.serviceJar ?? fileURLToPath(new URL('../service/build/TrackerService.jar', import.meta.url));
    try { if (!statSync(jar).isFile()) throw new Error(); }
    catch { return fail('SERVICE_UNAVAILABLE', 'TrackerService.jar is missing. Run service/build.sh from the tracker-mcp directory to build the service.', { path: path.resolve(jar) }); }
    const app = realpathSync(discovered.tracker_app_path);
    const inApp = (candidate: string) => {
      const real = realpathSync(candidate);
      if (!real.startsWith(app + path.sep) || !statSync(real).isFile()) throw new Error('dependency outside app');
      return real;
    };
    const java = inApp(path.join(discovered.jre_path, 'bin/java'));
    let jars: string[] | undefined;
    for (const dir of ['Contents/app', 'Contents/Java']) {
      try { jars = ['tracker.jar', 'slf4j-api.jar', 'logback-classic.jar', 'logback-core.jar'].map(name => inApp(path.join(app, dir, name))); break; } catch { /* Try the other supported app layout. */ }
    }
    if (!jars) return fail('SERVICE_UNAVAILABLE', 'Tracker and logging jars must be present inside Tracker.app');
    const classpath = [realpathSync(jar), ...jars, inApp(discovered.xuggle_jar)];
    if (classpath.some(entry => entry.includes(path.delimiter))) return fail('SERVICE_UNAVAILABLE', 'Java classpath paths cannot contain the classpath separator');
    const runtime = mkdtempSync(path.join(tmpdir(), 'tracker-runtime-'));
    let child: ChildProcessWithoutNullStreams;
    try {
      mkdirSync(path.join(runtime, 'preferences'), { mode: 0o700 }); mkdirSync(path.join(runtime, 'tmp'), { mode: 0o700 });
      // Do not inherit JAVA_TOOL_OPTIONS, CLASSPATH, library injection, or user preferences.
      const env: NodeJS.ProcessEnv = { HOME: runtime, TMPDIR: path.join(runtime, 'tmp'), LANG: 'en_US.UTF-8' };
      child = (this.options.launch ?? ((command, args, options) => spawn(command, args, { ...options, stdio: 'pipe' })))(java,
        ['-Dapple.awt.UIElement=true', `-Duser.home=${runtime}`, `-Djava.util.prefs.userRoot=${runtime}/preferences`, `-Djava.io.tmpdir=${runtime}/tmp`, '-classpath', classpath.join(path.delimiter), 'tracker.mcp.TrackerService'],
        { cwd: runtime, env, shell: false });
    } catch { rmSync(runtime, { recursive: true, force: true }); return fail('SERVICE_UNAVAILABLE', 'Could not launch the bundled Tracker Java runtime'); }
    let resolveExit!: () => void;
    const s: State = { child, runtime, token: randomBytes(32).toString('hex'), exited: false, poisoned: false, exit: new Promise(resolve => { resolveExit = resolve; }) };
    const exited = () => { if (s.exited) return; s.exited = true; s.cancel?.(javaExit()); resolveExit();
      if (s.poisoned && this.state === s) this.state = undefined;
      try { rmSync(runtime, { recursive: true, force: true }); } catch { /* Process is gone; do not turn cleanup into an unhandled exception. */ }
    };
    child.once('exit', exited);
    child.once('error', () => { if (!child.pid) exited(); else s.cancel?.(javaExit()); });
    child.stdin.on('error', () => s.cancel?.(javaExit()));
    child.stdout.on('error', () => s.cancel?.(unavailable()));
    child.stderr.on('error', () => {});
    child.stderr.resume(); // Discard logs without buffers or MCP stdout contamination.
    return s;
  }

  private readReady(s: State): Promise<ServiceResult> {
    return new Promise(resolve => {
      let buffer = Buffer.alloc(0); let finished = false;
      const finish = (result: ServiceResult) => { if (finished) return; finished = true; clearTimeout(timer); s.cancel = undefined; s.child.stdout.off('data', data); s.child.stdout.off('end', end); s.child.stdout.resume(); resolve(result); };
      const timer = setTimeout(() => finish(fail('TIMEOUT', 'TrackerService startup timed out')), this.options.startupTimeoutMs ?? 15000);
      const end = () => finish(javaExit());
      const data = (chunk: Buffer) => {
        if (buffer.length + chunk.length > 4096) return finish(unavailable());
        buffer = Buffer.concat([buffer, chunk]); const newline = buffer.indexOf(10); if (newline < 0) return;
        try {
          const ready: unknown = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
          if (newline !== buffer.length - 1 || !object(ready) || ready.ready !== true || !Number.isInteger(ready.port) || Number(ready.port) < 1 || Number(ready.port) > 65535 || ready.pid !== s.child.pid || !Number.isInteger(ready.pid)) return finish(unavailable());
          s.port = Number(ready.port); finish({ ok: true });
        } catch { finish(unavailable()); }
      };
      s.cancel = error => finish(error); s.child.stdout.on('data', data); s.child.stdout.once('end', end);
      if (s.exited || this.closed) finish(javaExit()); else s.child.stdin.write(s.token + '\n');
    });
  }

  private exchange(s: State, wire: string, id: number, timeout: number): Promise<ServiceResult> {
    return new Promise(resolve => {
      let buffer = Buffer.alloc(0); let finished = false; let socket: Socket;
      const finish = (result: ServiceResult) => { if (finished) return; finished = true; clearTimeout(timer); s.cancel = undefined; socket?.destroy(); resolve(result); };
      const timer = setTimeout(() => finish(fail('TIMEOUT', 'TrackerService request timed out; its session cannot be reused')), timeout);
      s.cancel = error => finish(error);
      socket = connect({ host: '127.0.0.1', port: s.port! }, () => socket.write(wire));
      socket.on('error', () => finish(s.exited ? javaExit() : unavailable()));
      socket.on('end', () => finish(unavailable()));
      socket.on('data', (chunk: Buffer) => {
        if (buffer.length + chunk.length > 4 * 1024 * 1024) return finish(unavailable());
        buffer = Buffer.concat([buffer, chunk]); const newline = buffer.indexOf(10); if (newline < 0) return;
        try {
          const reply: unknown = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
          if (newline !== buffer.length - 1 || !object(reply) || reply.jsonrpc !== '2.0' || reply.id !== id || 'error' in reply || !object(reply.result) || typeof reply.result.ok !== 'boolean') return finish(unavailable());
          const result = reply.result;
          if (!result.ok && (!object(result.error) || !ALL_ERROR_CODES.includes(result.error.code as never) || typeof result.error.message !== 'string' || !object(result.error.details))) return finish(unavailable());
          finish(result as ServiceResult);
        } catch { finish(unavailable()); }
      });
    });
  }

  private stop(s: State): Promise<void> {
    if (s.stop) return s.stop;
    s.poisoned = true; s.cancel?.(javaExit());
    s.stop = (async () => {
      s.child.stdin.end();
      const grace = this.options.shutdownGraceMs ?? 1500;
      const wait = async () => { let timer: NodeJS.Timeout | undefined; await Promise.race([s.exit, new Promise<void>(resolve => { timer = setTimeout(resolve, grace); })]); clearTimeout(timer); };
      await wait();
      if (!s.exited) { s.child.kill('SIGKILL'); await wait(); }
      // Retain a poisoned process if the OS cannot kill it; never launch over it.
      if (s.exited && this.state === s) this.state = undefined;
    })();
    return s.stop;
  }
}
