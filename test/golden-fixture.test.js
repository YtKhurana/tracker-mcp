import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const generator = join(repoRoot, "scripts", "generate-golden-fixture.py");

function generate(outputDir) {
  const result = spawnSync("python3", [generator, "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || result.error?.message || "generator failed",
  );
  return JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"));
}

test("golden fixture generation is deterministic and self-describing", () => {
  const firstDir = mkdtempSync(join(tmpdir(), "tracker-golden-a-"));
  const secondDir = mkdtempSync(join(tmpdir(), "tracker-golden-b-"));
  const first = generate(firstDir);
  const second = generate(secondDir);

  assert.equal(first.fixture_id, "synthetic-parabola-v1");
  assert.equal(first.provenance.rights, "CC0-1.0");
  assert.equal(first.video.frame_count, 12);
  assert.equal(first.video.fps, 10);
  assert.equal(first.video.encoded.codec_requested, "mp4v");
  assert.deepEqual(first.calibration, {
    frame: 0,
    origin_x: 96,
    origin_y: 168,
    angle_rad: 0.5235987755982988,
    scale_px_per_world_unit: 40,
    length_unit: "m",
  });
  assert.equal(first.track.name, "synthetic mass");
  assert.equal(first.track.mass, 1);
  assert.equal(first.track.marks.length, 12);
  assert.equal(new Set(first.track.marks.map(({ frame }) => frame)).size, 12);
  assert.deepEqual(first.track.marks[0], { frame: 0, x: 48, y: 190 });
  assert.deepEqual(first.track.marks.at(-1), { frame: 11, x: 279, y: 113 });
  assert.equal(first.references.analytical.status, "not_official_tracker_oracle");
  assert.equal(first.references.official.status, "pending_human_tracker_checkpoint");

  assert.deepEqual(first.artifacts, second.artifacts);
});
