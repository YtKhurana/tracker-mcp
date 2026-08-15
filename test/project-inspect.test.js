import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runProjectInspect } from "../dist/inspect.js";
import { makeTempDir } from "./helpers/bundle.js";
import { CLIP_ONLY_TRK, MINIMAL_TRK, writeStoreZip, writeTempTrk, writeTempTrz } from "./helpers/trk.js";

test("invalid path args", () => {
  for (const args of [undefined, null, [], {}, { path: 1 }, { path: "" }, { path: "rel.trk" }]) {
    const result = runProjectInspect(args);
    assert.equal(result.ok, false, String(args));
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
});

test("missing file is NOT_FOUND", () => {
  const result = runProjectInspect({ path: path.join(makeTempDir(), "gone.trk") });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("directory and wrong extension are INVALID_ARGUMENT", () => {
  const dir = makeTempDir();
  assert.equal(runProjectInspect({ path: dir }).error.code, "INVALID_ARGUMENT");
  const csv = path.join(dir, "table.csv");
  writeFileSync(csv, "t,x\n");
  assert.equal(runProjectInspect({ path: csv }).error.code, "INVALID_ARGUMENT");
});

test("inspects a fixture trk", () => {
  const file = writeTempTrk();
  const result = runProjectInspect({ path: file });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "trk");
  assert.equal(result.path, file);
  assert.equal(result.semantic_version, "5.1.2");
  assert.equal(result.video.class, "org.opensourcephysics.media.core.ImageVideo");
  assert.equal(result.video.path, "videos/clip00.jpg");
  assert.equal(result.video.framecount, 3);
  assert.equal(result.video.delta_t, 4);
  assert.equal(result.coords.fixedorigin, true);
  assert.equal(result.coords.frames[0].xorigin, 10);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].mark_count, 0);
  assert.equal(result.tracks[1].name, "mass A");
  assert.equal(result.tracks[1].mark_count, 2);
  assert.equal(result.units.length, "m");
});

test("inspects the same xml inside a trz", () => {
  const file = writeTempTrz();
  const result = runProjectInspect({ path: file });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "trz");
  assert.equal(result.tracks[1].mark_count, 2);
});

test("bad zip and zip without trk are PARSE_FAILED", () => {
  const dir = makeTempDir();
  const bad = path.join(dir, "bad.trz");
  writeFileSync(bad, "not-a-zip");
  assert.equal(runProjectInspect({ path: bad }).error.code, "PARSE_FAILED");
  const empty = path.join(dir, "empty.trz");
  writeStoreZip(empty, [{ name: "readme.txt", data: "hi" }]);
  assert.equal(runProjectInspect({ path: empty }).error.code, "PARSE_FAILED");
});

const PANEL = "org.opensourcephysics.cabrillo.tracker.TrackerPanel";

test("leftover tokens and sibling text are PARSE_FAILED", () => {
  const bodies = [
    `<<<object class="${PANEL}"></object>`,
    `<object class="${PANEL}"><!!!garbage!!!></object>`,
    `<object class="${PANEL}"></object><!!!`,
    `prefix<object class="${PANEL}"></object>`,
    `<object class="${PANEL}"></object>suffix`,
  ];
  for (const xml of bodies) {
    const result = runProjectInspect({ path: writeTempTrk(xml) });
    assert.equal(result.ok, false, xml);
    assert.equal(result.error.code, "PARSE_FAILED", xml);
  }
});

test("malformed xml and wrong root are PARSE_FAILED", () => {
  const bad = writeTempTrk("<not-xml");
  assert.equal(runProjectInspect({ path: bad }).error.code, "PARSE_FAILED");
  const other = writeTempTrk('<object class="java.lang.String">x</object>');
  assert.equal(runProjectInspect({ path: other }).error.code, "PARSE_FAILED");
  const mismatch = writeTempTrk(
    '<object class="org.opensourcephysics.cabrillo.tracker.TrackerPanel"></property>',
  );
  assert.equal(runProjectInspect({ path: mismatch }).error.code, "PARSE_FAILED");
});

test("clip-only file leaves video class/path/framecount null", () => {
  const file = writeTempTrk(CLIP_ONLY_TRK);
  const result = runProjectInspect({ path: file });
  assert.equal(result.ok, true);
  assert.equal(result.video.class, null);
  assert.equal(result.video.path, null);
  assert.equal(result.video.framecount, null);
  assert.equal(result.video.stepcount, 100);
  assert.equal(result.video.delta_t, 33.333333333333336);
  assert.deepEqual(result.tracks, []);
});
