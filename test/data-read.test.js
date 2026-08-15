import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runDataRead } from "../dist/data.js";
import { makeTempDir } from "./helpers/bundle.js";
import { CLIP_ONLY_TRK, TWO_MASS_TRK, writeStoreZip, writeTempTrk, writeTempTrz } from "./helpers/trk.js";

function writeTempCsv(text, name = "table.csv") {
  const dir = makeTempDir("tracker-mcp-csv-");
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
}

test("invalid path args", () => {
  for (const args of [undefined, null, [], {}, { path: 1 }, { path: "" }, { path: "rel.csv" }]) {
    const result = runDataRead(args);
    assert.equal(result.ok, false, String(args));
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
});

test("format and track must be the declared types", () => {
  const file = writeTempCsv("t,x\n0,1\n");
  assert.equal(runDataRead({ path: file, format: "xml" }).error.code, "INVALID_ARGUMENT");
  assert.equal(runDataRead({ path: file, track: 1 }).error.code, "INVALID_ARGUMENT");
  assert.equal(runDataRead({ path: file, track: "" }).error.code, "INVALID_ARGUMENT");
});

test("missing file is NOT_FOUND", () => {
  const result = runDataRead({ path: path.join(makeTempDir(), "gone.csv") });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("symlink is INVALID_ARGUMENT", () => {
  const file = writeTempCsv("t,x\n0,1\n");
  const link = path.join(makeTempDir(), "alias.csv");
  symlinkSync(file, link);
  assert.equal(runDataRead({ path: link }).error.code, "INVALID_ARGUMENT");
});

test("directory and unsupported extension are INVALID_ARGUMENT", () => {
  const dir = makeTempDir();
  assert.equal(runDataRead({ path: dir }).error.code, "INVALID_ARGUMENT");
  const txt = path.join(dir, "notes.txt");
  writeFileSync(txt, "t,x\n");
  assert.equal(runDataRead({ path: txt }).error.code, "INVALID_ARGUMENT");
});

test("reads a comma-separated CSV as stored", () => {
  const file = writeTempCsv("t,x,y,vx,vy\n0,1.5,2,0.1,0.2\n0.04,3,4,0.3,0.4\n");
  const result = runDataRead({ path: file });
  assert.equal(result.ok, true);
  assert.equal(result.source, "csv");
  assert.equal(result.path, file);
  assert.deepEqual(result.columns, ["t", "x", "y", "vx", "vy"]);
  assert.deepEqual(result.rows, [
    [0, 1.5, 2, 0.1, 0.2],
    [0.04, 3, 4, 0.3, 0.4],
  ]);
});

test("csv format keeps cells as strings", () => {
  const file = writeTempCsv("t,x\n0,1.5\n");
  const result = runDataRead({ path: file, format: "csv" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, ["t", "x"]);
  assert.deepEqual(result.rows, [
    ["0", "1.5"],
  ]);
});

test("quoted CSV fields and hash comments are accepted", () => {
  const file = writeTempCsv('# Tracker export\n"t","x,y"\n"0","1,2"\n');
  const result = runDataRead({ path: file });
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, ["t", "x,y"]);
  assert.deepEqual(result.rows, [[0, "1,2"]]);
});

test("blank and non-numeric CSV cells stay as stored", () => {
  const file = writeTempCsv("t,x,vx\n0,1.5,\n1,n/a,2\n");
  const result = runDataRead({ path: file });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    [0, 1.5, ""],
    [1, "n/a", 2],
  ]);
});

test("ragged, headerless, or unclosed-quote CSV is PARSE_FAILED", () => {
  const ragged = writeTempCsv("t,x\n0,1,2\n");
  assert.equal(runDataRead({ path: ragged }).error.code, "PARSE_FAILED");
  const empty = writeTempCsv("# only comments\n\n");
  assert.equal(runDataRead({ path: empty }).error.code, "PARSE_FAILED");
  const unclosed = writeTempCsv('t,x\n0,"1\n');
  assert.equal(runDataRead({ path: unclosed }).error.code, "PARSE_FAILED");
});

test("reads PointMass FrameData from a trk as image-space marks", () => {
  const file = writeTempTrk();
  const result = runDataRead({ path: file, track: "mass A" });
  assert.equal(result.ok, true);
  assert.equal(result.source, "trk_xml");
  assert.deepEqual(result.columns, ["frame", "x", "y"]);
  assert.deepEqual(result.rows, [
    [0, 1, 2],
    [2, 3, 4],
  ]);
});

test("single PointMass trk does not require track", () => {
  const file = writeTempTrk();
  const result = runDataRead({ path: file });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows[1], [2, 3, 4]);
});

test("reads the same marks from a trz", () => {
  const file = writeTempTrz();
  const result = runDataRead({ path: file, track: "mass A" });
  assert.equal(result.ok, true);
  assert.equal(result.source, "trk_xml");
  assert.deepEqual(result.rows, [
    [0, 1, 2],
    [2, 3, 4],
  ]);
});

test("csv format stringifies trk mark rows", () => {
  const file = writeTempTrk();
  const result = runDataRead({ path: file, track: "mass A", format: "csv" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    ["0", "1", "2"],
    ["2", "3", "4"],
  ]);
});

test("two PointMass tracks require a name and select that track", () => {
  const file = writeTempTrk(TWO_MASS_TRK);
  assert.equal(runDataRead({ path: file }).error.code, "INVALID_ARGUMENT");
  const named = runDataRead({ path: file, track: "mass B" });
  assert.equal(named.ok, true);
  assert.deepEqual(named.rows, [[1, 9, 8]]);
});

test("bad zip and malformed trk are PARSE_FAILED", () => {
  const badTrk = writeTempTrk("<not-xml");
  assert.equal(runDataRead({ path: badTrk }).error.code, "PARSE_FAILED");
  const dir = makeTempDir();
  const badZip = path.join(dir, "bad.trz");
  writeFileSync(badZip, "not-a-zip");
  assert.equal(runDataRead({ path: badZip }).error.code, "PARSE_FAILED");
  const empty = path.join(dir, "empty.trz");
  writeStoreZip(empty, [{ name: "readme.txt", data: "hi" }]);
  assert.equal(runDataRead({ path: empty }).error.code, "PARSE_FAILED");
});

test("missing or non-point-mass track is NOT_FOUND or INVALID_ARGUMENT", () => {
  const file = writeTempTrk();
  assert.equal(runDataRead({ path: file, track: "nope" }).error.code, "NOT_FOUND");
  assert.equal(runDataRead({ path: file, track: "axes" }).error.code, "INVALID_ARGUMENT");
});

test("clip-only trk has no PointMass marks", () => {
  const file = writeTempTrk(CLIP_ONLY_TRK);
  const result = runDataRead({ path: file });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("does not invent velocity columns for XML marks", () => {
  const file = writeTempTrk();
  const result = runDataRead({ path: file, track: "mass A" });
  assert.equal(result.columns.includes("vx"), false);
  assert.equal(result.columns.includes("vy"), false);
});
