import assert from "node:assert/strict";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { discoverTrackerRuntime } from "../dist/discover.js";
import { makeTempDir, makeTrackerBundle } from "./helpers/bundle.js";

test("TRACKER_APP complete bundle succeeds", () => {
  const { app, home } = makeTrackerBundle();
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: app },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, true);
  assert.equal(result.tracker_app_path, path.resolve(app));
  assert.equal(result.jre_path, path.resolve(home));
  assert.equal(result.jre_version, "21.0.6");
  assert.equal(
    result.xuggle_jar,
    path.resolve(app, "Contents", "app", "xuggle-xuggler-server-all.jar"),
  );
});

test("unset TRACKER_APP uses defaultAppPath", () => {
  const { app } = makeTrackerBundle();
  const result = discoverTrackerRuntime({
    env: {},
    defaultAppPath: app,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tracker_app_path, path.resolve(app));
});

test("TRACKER_APP missing does not fall back to default", () => {
  const { app } = makeTrackerBundle();
  const missing = path.join(makeTempDir(), "missing.app");
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: missing },
    defaultAppPath: app,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("whitespace TRACKER_APP is treated as unset", () => {
  const { app } = makeTrackerBundle();
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: "  " },
    defaultAppPath: app,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tracker_app_path, path.resolve(app));
});

test("default missing is NOT_FOUND", () => {
  const result = discoverTrackerRuntime({
    env: {},
    defaultAppPath: path.join(makeTempDir(), "gone.app"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("missing bundled java does not claim system java", () => {
  const { app } = makeTrackerBundle({ withJava: false, xuggle: "app" });
  mkdirSync(path.join(app, "Contents", "app"), { recursive: true });
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: app, JAVA_HOME: "/usr", PATH: "/usr/bin" },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /\/usr\/bin\/java/);
});

test("JRE symlink outside the app is refused", () => {
  const { app } = makeTrackerBundle({ jreSymlinkOutside: true });
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: app },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("unreadable JRE release is NOT_FOUND not a throw", () => {
  const { app, home } = makeTrackerBundle();
  chmodSync(path.join(home, "release"), 0);
  let result;
  try {
    result = discoverTrackerRuntime({
      env: { TRACKER_APP: app },
      defaultAppPath: "/Applications/Tracker.app",
    });
  } finally {
    chmodSync(path.join(home, "release"), 0o644);
  }
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("missing xuggle server jar is NOT_FOUND", () => {
  const { app } = makeTrackerBundle({ xuggle: "none" });
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: app },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NOT_FOUND");
});

test("xuggle under Contents/Java is accepted when app/ is absent", () => {
  const { app } = makeTrackerBundle({ xuggle: "java" });
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: app },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, true);
  assert.ok(result.xuggle_jar.endsWith(path.join("Contents", "Java", "xuggle-xuggler-server-all.jar")));
});

test("prefers Contents/app over Contents/Xuggle", () => {
  const { app } = makeTrackerBundle({ xuggle: "both-app-xuggle" });
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: app },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, true);
  assert.ok(result.xuggle_jar.includes(`${path.sep}app${path.sep}`));
});

test("relative TRACKER_APP is reported as absolute", () => {
  const { root, app } = makeTrackerBundle();
  const relative = path.relative(process.cwd(), app);
  const result = discoverTrackerRuntime({
    env: { TRACKER_APP: relative },
    defaultAppPath: "/Applications/Tracker.app",
  });
  assert.equal(result.ok, true);
  assert.equal(result.tracker_app_path, path.resolve(app));
  assert.ok(path.isAbsolute(result.tracker_app_path));
  void root;
});
