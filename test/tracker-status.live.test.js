import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { discoverTrackerRuntime } from "../dist/discover.js";

const LIVE_APP = "/Applications/Tracker.app";

test("live Tracker.app 6.3.5 reports bundled JRE 21 and Xuggle server jar", { skip: !existsSync(LIVE_APP) }, () => {
  const result = discoverTrackerRuntime({
    env: {},
    defaultAppPath: LIVE_APP,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tracker_app_path, LIVE_APP);
  assert.match(result.jre_version, /^21\./);
  assert.ok(result.jre_path.endsWith("/Contents/runtime/Contents/Home"));
  assert.ok(result.xuggle_jar.endsWith("/Contents/app/xuggle-xuggler-server-all.jar"));
});
