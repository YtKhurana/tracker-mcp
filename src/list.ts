import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fail, type ErrorEnvelope } from "./errors.js";

export type ProjectKind = "trk" | "trz";

export type ListedProject = {
  path: string;
  kind: ProjectKind;
  size: number;
};

export type ProjectListSuccess = {
  ok: true;
  projects: ListedProject[];
};

export type ProjectListResult = ProjectListSuccess | ErrorEnvelope;

function kindOf(filePath: string): ProjectKind | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".trk") {
    return "trk";
  }
  if (ext === ".trz") {
    return "trz";
  }
  return null;
}

function collect(dir: string, recursive: boolean, into: ListedProject[], isRoot: boolean): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return !isRoot;
  }
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      const kind = kindOf(entry.name);
      if (kind) {
        into.push({ path: path.resolve(full), kind, size: stat.size });
      }
      continue;
    }
    if (recursive && stat.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")) {
      collect(full, true, into, false);
    }
  }
  return true;
}

export function runProjectList(args: unknown): ProjectListResult {
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) {
    return fail("INVALID_ARGUMENT", "project_list arguments must be an object");
  }
  const record = (args ?? {}) as Record<string, unknown>;
  if (typeof record.dir !== "string" || record.dir.trim() === "") {
    return fail("INVALID_ARGUMENT", "dir must be a non-empty string");
  }
  const dir = record.dir.trim();
  if (!path.isAbsolute(dir)) {
    return fail("INVALID_ARGUMENT", "dir must be an absolute path", { dir });
  }
  if ("recursive" in record && typeof record.recursive !== "boolean") {
    return fail("INVALID_ARGUMENT", "recursive must be a boolean", { recursive: record.recursive });
  }
  const recursive = record.recursive === true;

  let rootStat;
  try {
    rootStat = statSync(dir);
  } catch {
    return fail("NOT_FOUND", "directory not found", { dir });
  }
  if (!rootStat.isDirectory()) {
    return fail("INVALID_ARGUMENT", "dir is not a directory", { dir });
  }

  const projects: ListedProject[] = [];
  if (!collect(dir, recursive, projects, true)) {
    return fail("NOT_FOUND", "directory not readable", { dir });
  }
  projects.sort((a, b) => a.path.localeCompare(b.path));
  return { ok: true, projects };
}
