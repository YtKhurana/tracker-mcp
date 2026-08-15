import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { coerceCsvCell, parseCsvTable } from "./csv.js";
import { fail, type ErrorEnvelope } from "./errors.js";
import { readPointMassTable } from "./trk-xml.js";
import { readTrkFromZip } from "./zip.js";

const MAX_BYTES = 32 * 1024 * 1024;
const MARK_COLUMNS = ["frame", "x", "y"] as const;

export type DataReadSuccess = {
  ok: true;
  source: "csv" | "trk_xml";
  columns: string[];
  rows: Array<Array<string | number>>;
  path: string;
};

export type DataReadResult = DataReadSuccess | ErrorEnvelope;

function kindOf(filePath: string): "csv" | "trk" | "trz" | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv" || ext === ".trk" || ext === ".trz") {
    return ext.slice(1) as "csv" | "trk" | "trz";
  }
  return null;
}

function loadXml(filePath: string, kind: "trk" | "trz"): string {
  if (kind === "trz") {
    const zip = readTrkFromZip(readFileSync(filePath), filePath);
    if (!zip.ok) {
      throw Object.assign(new Error("bad_trz"), { reason: zip.reason });
    }
    return zip.xml;
  }
  return readFileSync(filePath, "utf8");
}

export function runDataRead(args: unknown): DataReadResult {
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) {
    return fail("INVALID_ARGUMENT", "data_read arguments must be an object");
  }
  const record = (args ?? {}) as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.trim() === "") {
    return fail("INVALID_ARGUMENT", "path must be a non-empty string");
  }
  const requested = record.path.trim();
  if (!path.isAbsolute(requested)) {
    return fail("INVALID_ARGUMENT", "path must be an absolute path", { path: requested });
  }
  if ("track" in record && (typeof record.track !== "string" || record.track.trim() === "")) {
    return fail("INVALID_ARGUMENT", "track must be a non-empty string", { track: record.track });
  }
  if ("format" in record && record.format !== "json" && record.format !== "csv") {
    return fail("INVALID_ARGUMENT", "format must be json or csv", { format: record.format });
  }
  const track = typeof record.track === "string" ? record.track.trim() : null;
  const asStrings = record.format === "csv";
  const filePath = path.resolve(requested);
  const kind = kindOf(filePath);
  if (!kind) {
    return fail("INVALID_ARGUMENT", "path must be a .csv, .trk, or .trz file", { path: filePath, kind: null });
  }

  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return fail("NOT_FOUND", "file not found", { path: filePath });
    }
    return fail("NOT_FOUND", "file not readable", { path: filePath, reason: code || "stat_failed" });
  }
  if (stat.isSymbolicLink()) {
    return fail("INVALID_ARGUMENT", "path must not be a symbolic link", { path: filePath });
  }
  if (!stat.isFile()) {
    return fail("INVALID_ARGUMENT", "path is not a file", { path: filePath });
  }
  if (stat.size > MAX_BYTES) {
    return fail("PARSE_FAILED", "could not parse data file", { path: filePath, reason: "too_large" });
  }

  if (kind === "csv") {
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      return fail("NOT_FOUND", "file not readable", { path: filePath, reason: code || "read_failed" });
    }
    try {
      const table = parseCsvTable(text);
      return {
        ok: true,
        source: "csv",
        columns: table.columns,
        rows: asStrings ? table.rows : table.rows.map((row) => row.map(coerceCsvCell)),
        path: filePath,
      };
    } catch {
      return fail("PARSE_FAILED", "could not parse CSV", { path: filePath, reason: "bad_csv" });
    }
  }

  try {
    const xml = loadXml(filePath, kind);
    const table = readPointMassTable(xml, track);
    if (!table.ok) {
      if (table.reason === "no_track") {
        return fail("NOT_FOUND", "point mass track not found", { path: filePath, track });
      }
      if (table.reason === "not_point_mass") {
        return fail("INVALID_ARGUMENT", "track is not a PointMass", { path: filePath, track });
      }
      return fail("INVALID_ARGUMENT", "track is required when more than one PointMass is present", {
        path: filePath,
      });
    }
    return {
      ok: true,
      source: "trk_xml",
      columns: [...MARK_COLUMNS],
      rows: asStrings ? table.rows.map((row) => row.map(String)) : table.rows,
      path: filePath,
    };
  } catch (error) {
    const reason =
      error instanceof Error && "reason" in error && typeof error.reason === "string" ? error.reason : "bad_trk";
    return fail("PARSE_FAILED", "could not parse Tracker project", { path: filePath, reason });
  }
}
