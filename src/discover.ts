import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fail, type ErrorEnvelope } from "./errors.js";

export const DEFAULT_TRACKER_APP = "/Applications/Tracker.app";
const XUGGLE_JAR = "xuggle-xuggler-server-all.jar";
const XUGGLE_DIRS = ["Contents/app", "Contents/Java", "Contents/Xuggle"] as const;

export type DiscoverOptions = {
  env?: NodeJS.ProcessEnv;
  defaultAppPath?: string;
};

export type DiscoverSuccess = {
  ok: true;
  tracker_app_path: string;
  jre_path: string;
  jre_version: string;
  xuggle_jar: string;
};

export type DiscoverResult = DiscoverSuccess | ErrorEnvelope;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function insideApp(appPath: string, candidate: string): boolean {
  let appReal: string;
  let candReal: string;
  try {
    appReal = realpathSync(appPath);
    candReal = realpathSync(candidate);
  } catch {
    return false;
  }
  return candReal === appReal || candReal.startsWith(`${appReal}${path.sep}`);
}

function parseJavaVersion(releasePath: string): string | null {
  if (!isFile(releasePath)) {
    return null;
  }
  const text = readFileSync(releasePath, "utf8");
  const match = text.match(/^JAVA_VERSION="([^"]+)"/m);
  return match?.[1] ?? null;
}

function findXuggleJar(appPath: string): string | null {
  for (const dir of XUGGLE_DIRS) {
    const candidate = path.join(appPath, dir, XUGGLE_JAR);
    if (isFile(candidate) && insideApp(appPath, candidate)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

export function discoverTrackerRuntime(options: DiscoverOptions = {}): DiscoverResult {
  const env = options.env ?? process.env;
  const defaultAppPath = options.defaultAppPath ?? DEFAULT_TRACKER_APP;
  const raw = env.TRACKER_APP;
  const override = typeof raw === "string" ? raw.trim() : "";
  const requested = override.length > 0 ? override : defaultAppPath;
  const appPath = path.resolve(requested);

  if (!isDir(appPath) || !isDir(path.join(appPath, "Contents"))) {
    return fail("NOT_FOUND", "Tracker.app not found", { tracker_app_path: appPath });
  }

  const jreHome = path.join(appPath, "Contents", "runtime", "Contents", "Home");
  const javaBin = path.join(jreHome, "bin", "java");
  if (!isFile(javaBin) || !insideApp(appPath, javaBin)) {
    return fail("NOT_FOUND", "Bundled JRE not found inside Tracker.app", {
      tracker_app_path: appPath,
      jre_path: path.resolve(jreHome),
    });
  }

  const jreVersion = parseJavaVersion(path.join(jreHome, "release"));
  if (!jreVersion) {
    return fail("NOT_FOUND", "Could not read bundled JRE version", {
      tracker_app_path: appPath,
      jre_path: path.resolve(jreHome),
    });
  }

  const xuggleJar = findXuggleJar(appPath);
  if (!xuggleJar) {
    return fail("NOT_FOUND", "xuggle-xuggler-server-all.jar not found in Tracker.app", {
      tracker_app_path: appPath,
      jre_path: path.resolve(jreHome),
    });
  }

  return {
    ok: true,
    tracker_app_path: appPath,
    jre_path: path.resolve(jreHome),
    jre_version: jreVersion,
    xuggle_jar: xuggleJar,
  };
}
