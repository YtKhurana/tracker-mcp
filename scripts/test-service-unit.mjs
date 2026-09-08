import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const appJdk = '/Applications/Tracker.app/Contents/runtime/Contents/Home';
// A system JDK is allowed only for these dependency-free unit tests, never
// for launching the Tracker-linked service.
const jdk = process.env.JAVA_HOME || (existsSync(appJdk) ? appJdk : null);
const binary = name => jdk ? join(jdk, 'bin', name) : name;
const output = mkdtempSync(join(tmpdir(), 'tracker-java-unit-'));
function run(name, args) {
  const result = spawnSync(binary(name), args, {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  process.stdout.write(result.stdout);
}
run('javac', ['-encoding', 'UTF-8', '-d', output,
  ...['Json', 'Failure', 'ProjectInput'].map(name => `service/src/tracker/mcp/${name}.java`),
  ...['CodecTest', 'ProjectInputTest'].map(name => `service/test/tracker/mcp/${name}.java`),
]);
run('java', ['-cp', output, 'tracker.mcp.CodecTest']);
run('java', ['-cp', output, 'tracker.mcp.ProjectInputTest', 'fixtures/official/service-generated.trz']);
