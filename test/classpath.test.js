import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("sidecar package does not depend on tracker.jar or Tracker Java", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const blob = JSON.stringify({
    dependencies: pkg.dependencies ?? {},
    optionalDependencies: pkg.optionalDependencies ?? {},
    peerDependencies: pkg.peerDependencies ?? {},
    bundledDependencies: pkg.bundledDependencies ?? [],
  }).toLowerCase();

  assert.equal(blob.includes("tracker.jar"), false);
  assert.equal(blob.includes("tracker-6."), false);
  assert.doesNotMatch(blob, /opensourcephysics/);
});
