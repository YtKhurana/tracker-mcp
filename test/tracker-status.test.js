import assert from "node:assert/strict";
import { test } from "node:test";
import { runTrackerStatus } from "../dist/status.js";
import { makeTrackerBundle } from "./helpers/bundle.js";

test("probe_service true still returns service null", () => {
  const { app } = makeTrackerBundle();
  const result = runTrackerStatus(
    { probe_service: true },
    { env: { TRACKER_APP: app }, defaultAppPath: "/Applications/Tracker.app" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.service, null);
});

test("probe_service non-boolean is INVALID_ARGUMENT", () => {
  const result = runTrackerStatus({ probe_service: "yes" }, { env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_ARGUMENT");
});
