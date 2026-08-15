import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runDataRead } from "../dist/data.js";
import { ERROR_CODES, fail } from "../dist/errors.js";
import { runProjectInspect } from "../dist/inspect.js";
import { runProjectList } from "../dist/list.js";
import { runTrackerStatus } from "../dist/status.js";
import { makeTempDir } from "./helpers/bundle.js";

function assertEnvelope(result, code) {
  assert.equal(result.ok, false);
  assert.equal(typeof result.error.message, "string");
  assert.notEqual(result.error.message.trim(), "");
  assert.equal(typeof result.error.details, "object");
  assert.notEqual(result.error.details, null);
  assert.equal(Array.isArray(result.error.details), false);
  assert.ok(ERROR_CODES.includes(result.error.code), result.error.code);
  assert.equal(result.error.code, code);
}

test("fail() builds the shared v0 envelope", () => {
  assert.deepEqual(ERROR_CODES, ["NOT_FOUND", "INVALID_ARGUMENT", "PARSE_FAILED"]);
  const result = fail("PARSE_FAILED", "could not parse", { reason: "bad_csv" });
  assertEnvelope(result, "PARSE_FAILED");
  assert.equal(result.error.details.reason, "bad_csv");
});

test("v0 tools use only NOT_FOUND, PARSE_FAILED, and INVALID_ARGUMENT", () => {
  const missing = path.join(makeTempDir(), "gone.trk");
  const dir = makeTempDir();
  const garbage = path.join(dir, "bad.trk");
  writeFileSync(garbage, "<not-xml");

  assertEnvelope(runTrackerStatus([]), "INVALID_ARGUMENT");
  assertEnvelope(runTrackerStatus({ probe_service: "yes" }), "INVALID_ARGUMENT");

  assertEnvelope(runProjectList({}), "INVALID_ARGUMENT");
  assertEnvelope(runProjectList({ dir: missing }), "NOT_FOUND");

  assertEnvelope(runProjectInspect({ path: "rel.trk" }), "INVALID_ARGUMENT");
  assertEnvelope(runProjectInspect({ path: missing }), "NOT_FOUND");
  assertEnvelope(runProjectInspect({ path: garbage }), "PARSE_FAILED");

  assertEnvelope(runDataRead({ path: "rel.csv" }), "INVALID_ARGUMENT");
  assertEnvelope(runDataRead({ path: missing.replace(/\.trk$/, ".csv") }), "NOT_FOUND");
  assertEnvelope(runDataRead({ path: garbage }), "PARSE_FAILED");
});
