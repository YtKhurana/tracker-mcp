import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runDataRead } from "../dist/data.js";
import { runProjectInspect } from "../dist/inspect.js";
import { runProjectList } from "../dist/list.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const examples = path.resolve(root, "..", "tracker source code", "examples");
const car = path.join(examples, "car.trz");
const sine = path.join(examples, "asinewave.trk");
const csv = path.join(root, "fixtures", "sample.csv");

test("reads the sidecar comma-separated CSV fixture", () => {
  const result = runDataRead({ path: csv });
  assert.equal(result.ok, true);
  assert.equal(result.source, "csv");
  assert.equal(result.path, csv);
  assert.deepEqual(result.columns, ["t", "x", "y"]);
  assert.deepEqual(result.rows, [
    [0, 1, 2],
    [0.04, 1.5, 2.5],
  ]);
});

test("inspects official car.trz", { skip: !existsSync(car) }, () => {
  const listed = runProjectList({ dir: examples });
  assert.equal(listed.ok, true);
  assert.ok(listed.projects.some((project) => project.path === car && project.kind === "trz"));

  const result = runProjectInspect({ path: car });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "trz");
  assert.equal(result.video.class, "org.opensourcephysics.media.core.ImageVideo");
  assert.equal(result.video.framecount, 53);
  const mass = result.tracks.find((track) => track.class.endsWith(".PointMass"));
  assert.ok(mass);
  assert.equal(mass.name, "masa A");
  assert.equal(mass.mark_count, 53);

  const marks = runDataRead({ path: car, track: "masa A" });
  assert.equal(marks.ok, true);
  assert.equal(marks.source, "trk_xml");
  assert.equal(marks.rows.length, 53);
  assert.deepEqual(marks.columns, ["frame", "x", "y"]);
  assert.equal(marks.rows[0][0], 0);
  assert.equal(typeof marks.rows[0][1], "number");
  assert.equal(typeof marks.rows[0][2], "number");
});

test("inspects official asinewave.trk", { skip: !existsSync(sine) }, () => {
  const result = runProjectInspect({ path: sine });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "trk");
  assert.equal(result.semantic_version, "5.1.2");
  assert.equal(result.video.class, null);
  assert.equal(result.video.stepcount, 100);
  assert.ok(result.tracks.some((track) => track.name === "model A"));
  const marks = runDataRead({ path: sine });
  assert.equal(marks.ok, false);
  assert.equal(marks.error.code, "NOT_FOUND");
});
