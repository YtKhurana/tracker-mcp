import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "./bundle.js";

export function writeFile(abs, contents = "x") {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
  return abs;
}

export function makeProjectTree() {
  const dir = makeTempDir("tracker-mcp-list-");
  writeFile(path.join(dir, "a.trk"), "trk-a");
  writeFile(path.join(dir, "b.trz"), "trz-bb");
  writeFile(path.join(dir, "notes.csv"), "t,x\n");
  writeFile(path.join(dir, "sub", "c.trk"), "nested");
  writeFile(path.join(dir, "clip.mp4"), "vid");
  writeFile(path.join(dir, "file.trk.txt"), "nope");
  writeFile(path.join(dir, "Foo.TRK"), "cased");
  writeFile(path.join(dir, "Bar.Trz"), "cased2");
  writeFile(path.join(dir, ".git", "secret.trk"), "hidden");
  return dir;
}
