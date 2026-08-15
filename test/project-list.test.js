import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runProjectList } from "../dist/list.js";
import { makeTempDir } from "./helpers/bundle.js";
import { makeProjectTree, writeFile } from "./helpers/projects.js";

test("non-object args are INVALID_ARGUMENT", () => {
  for (const args of [undefined, null, [], "x"]) {
    const result = runProjectList(args);
    assert.equal(result.ok, false, String(args));
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
});

test("dir must be a non-empty absolute string", () => {
  for (const args of [{}, { dir: 1 }, { dir: "" }, { dir: "tmp/projects" }]) {
    const result = runProjectList(args);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_ARGUMENT");
  }
});

test("recursive non-boolean is INVALID_ARGUMENT", () => {
  const dir = makeTempDir();
  const result = runProjectList({ dir, recursive: "yes" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_ARGUMENT");
});

test("missing path is NOT_FOUND", () => {
  const dir = path.join(makeTempDir(), "gone");
  const result = runProjectList({ dir });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("file as dir is INVALID_ARGUMENT", () => {
  const file = writeFile(path.join(makeTempDir(), "only.trk"), "x");
  const result = runProjectList({ dir: file });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_ARGUMENT");
});

test("empty directory returns no projects", () => {
  const dir = makeTempDir();
  const result = runProjectList({ dir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.projects, []);
});

test("non-recursive lists only immediate trk/trz", () => {
  const dir = makeProjectTree();
  const result = runProjectList({ dir });
  assert.equal(result.ok, true);
  const kinds = Object.fromEntries(result.projects.map((p) => [path.basename(p.path), p.kind]));
  assert.deepEqual(kinds, {
    "Bar.Trz": "trz",
    "Foo.TRK": "trk",
    "a.trk": "trk",
    "b.trz": "trz",
  });
  assert.equal(result.projects.some((p) => p.path.includes(`${path.sep}sub${path.sep}`)), false);
  assert.equal(result.projects.every((p) => path.isAbsolute(p.path)), true);
});

test("recursive includes nested projects and skips hidden dirs", () => {
  const dir = makeProjectTree();
  const result = runProjectList({ dir, recursive: true });
  assert.equal(result.ok, true);
  const names = result.projects.map((p) => path.relative(dir, p.path)).sort();
  assert.deepEqual(names, ["Bar.Trz", "Foo.TRK", "a.trk", "b.trz", path.join("sub", "c.trk")]);
});

test("size matches file bytes and paths are sorted", () => {
  const dir = makeTempDir();
  writeFile(path.join(dir, "z.trk"), "zzzz");
  writeFile(path.join(dir, "a.trz"), "aa");
  const result = runProjectList({ dir });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.projects.map((p) => path.basename(p.path)),
    ["a.trz", "z.trk"],
  );
  assert.equal(result.projects[0].size, 2);
  assert.equal(result.projects[1].size, 4);
});

test("hidden root directory is scanned", () => {
  const hidden = path.join(makeTempDir(), ".hidden");
  writeFile(path.join(hidden, "x.trk"), "ok");
  const result = runProjectList({ dir: hidden });
  assert.equal(result.ok, true);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].kind, "trk");
});

test("unreadable child does not fail the list", () => {
  const dir = makeTempDir();
  const blocked = path.join(dir, "blocked.trk");
  writeFileSync(blocked, "x");
  chmodSync(blocked, 0);
  const result = runProjectList({ dir });
  chmodSync(blocked, 0o644);
  assert.equal(result.ok, true);
});

test("unreadable root directory is NOT_FOUND", () => {
  const dir = makeTempDir();
  chmodSync(dir, 0);
  const result = runProjectList({ dir });
  chmodSync(dir, 0o755);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});
