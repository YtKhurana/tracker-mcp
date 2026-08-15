import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeTempDir(prefix = "tracker-mcp-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/**
 * @param {object} options
 * @param {string} [options.root]
 * @param {boolean} [options.withJava]
 * @param {boolean} [options.withRelease]
 * @param {string} [options.javaVersion]
 * @param {"app"|"java"|"xuggle"|"both-app-xuggle"|"none"} [options.xuggle]
 * @param {boolean} [options.jreSymlinkOutside]
 */
export function makeTrackerBundle(options = {}) {
  const root = options.root ?? makeTempDir();
  const app = path.join(root, "Tracker.app");
  const home = path.join(app, "Contents", "runtime", "Contents", "Home");
  const bin = path.join(home, "bin");
  mkdirSync(path.join(app, "Contents"), { recursive: true });

  if (options.jreSymlinkOutside) {
    const outside = path.join(root, "outside-jre");
    mkdirSync(path.join(outside, "bin"), { recursive: true });
    writeFileSync(path.join(outside, "bin", "java"), "#!/bin/sh\n");
    chmodSync(path.join(outside, "bin", "java"), 0o755);
    writeFileSync(path.join(outside, "release"), 'JAVA_VERSION="21.0.6"\n');
    mkdirSync(path.join(app, "Contents", "runtime", "Contents"), { recursive: true });
    symlinkSync(outside, home);
  } else if (options.withJava !== false) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "java"), "#!/bin/sh\n");
    chmodSync(path.join(bin, "java"), 0o755);
    if (options.withRelease !== false) {
      const version = options.javaVersion ?? "21.0.6";
      writeFileSync(path.join(home, "release"), `JAVA_VERSION="${version}"\n`);
    }
  }

  const xuggle = options.xuggle ?? "app";
  const jarName = "xuggle-xuggler-server-all.jar";
  if (xuggle === "app" || xuggle === "both-app-xuggle") {
    mkdirSync(path.join(app, "Contents", "app"), { recursive: true });
    writeFileSync(path.join(app, "Contents", "app", jarName), "jar");
  }
  if (xuggle === "java") {
    mkdirSync(path.join(app, "Contents", "Java"), { recursive: true });
    writeFileSync(path.join(app, "Contents", "Java", jarName), "jar");
  }
  if (xuggle === "xuggle" || xuggle === "both-app-xuggle") {
    mkdirSync(path.join(app, "Contents", "Xuggle"), { recursive: true });
    writeFileSync(path.join(app, "Contents", "Xuggle", jarName), "jar");
  }

  return { root, app, home };
}
