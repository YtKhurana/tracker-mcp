import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function run(script, args = []) {
  const result = spawnSync("/bin/zsh", [join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message || `${script} failed`,
  );
  return result.stdout;
}

test("S2 spike builds with the Tracker app compiler and loads its classes", { skip: !existsSync('/Applications/Tracker.app') }, () => {
  run("service/spikes/build-s2.sh");
  const output = run("service/spikes/run-s2.sh", ["classpath"]);

  assert.match(output, /RESULT runtime_app_jre=true/);
  assert.match(output, /RESULT tracker_class=true/);
  assert.match(output, /RESULT xuggle_class=true/);
  assert.match(output, /RESULT java_version=21\.0\.6/);
  assert.match(output, /RESULT process_arch=x86_64/);
});

test("S2 spike source does not invoke prohibited application entrypoints", () => {
  const source = readFileSync(
    join(repoRoot, "service", "spikes", "src", "tracker", "mcp", "spike", "S2Probe.java"),
    "utf8",
  );
  for (const forbidden of [
    ["Tracker", "main"].join("."),
    "TrackerStarter",
    ["System", "exit"].join("."),
    "TActions",
  ]) {
    assert.equal(source.includes(forbidden), false, `found prohibited ${forbidden}`);
  }
});
