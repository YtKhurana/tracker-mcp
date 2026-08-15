import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fail, type ErrorEnvelope } from "./errors.js";
import { parseTrackerPanelXml, type InspectPayload } from "./trk-xml.js";
import { readTrkFromZip } from "./zip.js";

export type ProjectInspectSuccess = InspectPayload & {
  ok: true;
  path: string;
  kind: "trk" | "trz";
};

export type ProjectInspectResult = ProjectInspectSuccess | ErrorEnvelope;

function kindOf(filePath: string): "trk" | "trz" | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".trk") {
    return "trk";
  }
  if (ext === ".trz") {
    return "trz";
  }
  return null;
}

export function runProjectInspect(args: unknown): ProjectInspectResult {
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) {
    return fail("INVALID_ARGUMENT", "project_inspect arguments must be an object");
  }
  const record = (args ?? {}) as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.trim() === "") {
    return fail("INVALID_ARGUMENT", "path must be a non-empty string");
  }
  const requested = record.path.trim();
  if (!path.isAbsolute(requested)) {
    return fail("INVALID_ARGUMENT", "path must be an absolute path", { path: requested });
  }
  const filePath = path.resolve(requested);
  const kind = kindOf(filePath);
  if (!kind) {
    return fail("INVALID_ARGUMENT", "path must be a .trk or .trz file", { path: filePath, kind: null });
  }

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return fail("NOT_FOUND", "file not found", { path: filePath });
  }
  if (!stat.isFile()) {
    return fail("INVALID_ARGUMENT", "path is not a file", { path: filePath });
  }
  if (kind === "trk" && stat.size > 32 * 1024 * 1024) {
    return fail("PARSE_FAILED", "could not parse Tracker project", { path: filePath, reason: "too_large" });
  }

  let xml: string;
  try {
    if (kind === "trz") {
      const zip = readTrkFromZip(readFileSync(filePath), filePath);
      if (!zip.ok) {
        return fail("PARSE_FAILED", "could not read .trz", { path: filePath, reason: zip.reason });
      }
      xml = zip.xml;
    } else {
      xml = readFileSync(filePath, "utf8");
    }
    const parsed = parseTrackerPanelXml(xml);
    return { ok: true, path: filePath, kind, ...parsed };
  } catch {
    return fail("PARSE_FAILED", "could not parse Tracker project", { path: filePath, reason: "bad_trk" });
  }
}
