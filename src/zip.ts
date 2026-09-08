import { inflateRawSync } from "node:zlib";
import path from "node:path";

const MAX_TRK_BYTES = 32 * 1024 * 1024;
const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export type ZipReadError = { ok: false; reason: "bad_zip" | "no_trk" | "too_large" };
export type ZipReadSuccess = { ok: true; name: string; xml: string };
export type ZipReadResult = ZipReadSuccess | ZipReadError;
export type ZipEntryReadError = { ok: false; reason: "bad_zip" | "no_entry" | "too_large" };
export type ZipEntryReadSuccess = { ok: true; data: Buffer };
export type ZipEntryReadResult = ZipEntryReadSuccess | ZipEntryReadError;
type Entry = { name: string; method: number; comp: number; uncomp: number; local: number };

function u16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function u32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (u32(buf, i) === EOCD) {
      return i;
    }
  }
  return -1;
}

function entriesFromZip(buf: Buffer): { ok: true; entries: Entry[] } | { ok: false; reason: "bad_zip" } {
  if (buf.length < 22) {
    return { ok: false, reason: "bad_zip" };
  }
  const eocd = findEocd(buf);
  if (eocd < 0) {
    return { ok: false, reason: "bad_zip" };
  }
  const count = u16(buf, eocd + 10);
  let cenOff = u32(buf, eocd + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (cenOff + 46 > buf.length || u32(buf, cenOff) !== CEN) {
      return { ok: false, reason: "bad_zip" };
    }
    const method = u16(buf, cenOff + 10);
    const comp = u32(buf, cenOff + 20);
    const uncomp = u32(buf, cenOff + 24);
    const nameLen = u16(buf, cenOff + 28);
    const extraLen = u16(buf, cenOff + 30);
    const commentLen = u16(buf, cenOff + 32);
    const local = u32(buf, cenOff + 42);
    if (cenOff + 46 + nameLen + extraLen + commentLen > buf.length) {
      return { ok: false, reason: "bad_zip" };
    }
    const name = buf.subarray(cenOff + 46, cenOff + 46 + nameLen).toString("utf8");
    entries.push({ name, method, comp, uncomp, local });
    cenOff += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, entries };
}

function readEntry(buf: Buffer, entry: Entry): { ok: true; data: Buffer } | { ok: false; reason: "bad_zip" | "too_large" } {
  if (entry.uncomp > MAX_TRK_BYTES || entry.comp > MAX_TRK_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const local = entry.local;
  if (local + 30 > buf.length || u32(buf, local) !== LOC) {
    return { ok: false, reason: "bad_zip" };
  }
  const nameLen = u16(buf, local + 26);
  const extraLen = u16(buf, local + 28);
  const dataStart = local + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.comp;
  if (dataEnd > buf.length) {
    return { ok: false, reason: "bad_zip" };
  }
  const compressed = buf.subarray(dataStart, dataEnd);
  let raw: Buffer;
  try {
    if (entry.method === 0) {
      if (entry.comp !== entry.uncomp) {
        return { ok: false, reason: "bad_zip" };
      }
      raw = Buffer.from(compressed);
    } else if (entry.method === 8) {
      raw = inflateRawSync(compressed, { maxOutputLength: MAX_TRK_BYTES });
    } else {
      return { ok: false, reason: "bad_zip" };
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "ERR_BUFFER_TOO_LARGE") {
      return { ok: false, reason: "too_large" };
    }
    return { ok: false, reason: "bad_zip" };
  }
  if (raw.length > MAX_TRK_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, data: raw };
}

export function readZipEntry(buf: Buffer, name: string): ZipEntryReadResult {
  const parsed = entriesFromZip(buf);
  if (!parsed.ok) return parsed;
  const matches = parsed.entries.filter((entry) => entry.name === name && !entry.name.endsWith("/"));
  if (matches.length !== 1) return { ok: false, reason: "no_entry" };
  return readEntry(buf, matches[0]);
}

export function readTrkFromZip(buf: Buffer, zipPath: string): ZipReadResult {
  const parsed = entriesFromZip(buf);
  if (!parsed.ok) return parsed;
  const trks = parsed.entries.filter((entry) => !entry.name.endsWith("/") && entry.name.toLowerCase().endsWith(".trk"));
  if (trks.length === 0) return { ok: false, reason: "no_trk" };
  const base = path.basename(zipPath, path.extname(zipPath)).toLowerCase();
  const chosen = trks.find((entry) => path.basename(entry.name, path.extname(entry.name)).toLowerCase() === base) ?? trks[0];
  const read = readEntry(buf, chosen);
  if (!read.ok) return read;
  return { ok: true, name: chosen.name, xml: read.data.toString("utf8") };
}
