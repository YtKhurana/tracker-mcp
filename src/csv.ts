export type CsvTable = {
  columns: string[];
  rows: string[][];
};

function splitFields(line: string): string[] | null {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (quoted) {
    return null;
  }
  fields.push(current);
  return fields;
}

export function parseCsvTable(text: string): CsvTable {
  const cleaned = text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = cleaned.split("\n");
  let columns: string[] | null = null;
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const fields = splitFields(line);
    if (!fields) {
      throw new Error("bad_csv");
    }
    if (!columns) {
      if (fields.length === 0 || fields.every((field) => field.trim() === "")) {
        throw new Error("bad_csv");
      }
      columns = fields.map((field) => field.trim());
      continue;
    }
    if (fields.length !== columns.length) {
      throw new Error("bad_csv");
    }
    rows.push(fields.map((field) => field.trim()));
  }
  if (!columns) {
    throw new Error("bad_csv");
  }
  return { columns, rows };
}

export function coerceCsvCell(value: string): string | number {
  if (value === "") {
    return value;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}
