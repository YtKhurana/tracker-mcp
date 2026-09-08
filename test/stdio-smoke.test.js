import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeTempDir } from "./helpers/bundle.js";
import { writeTempTrk } from "./helpers/trk.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "dist", "index.js");

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function readJsonLine(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for MCP JSON (buffer=${JSON.stringify(buf)})`));
    }, timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) {
        return;
      }
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) {
        return;
      }
      cleanup();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`server exited ${code} before reply (buffer=${JSON.stringify(buf)})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

test("stdio MCP initialize and tools/list", async () => {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));

  try {
    send(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "tracker-mcp-smoke", version: "0.0.0" },
      },
    });

    const init = await readJsonLine(child);
    assert.equal(init.id, 1);
    assert.equal(init.result.serverInfo.name, "tracker-mcp");
    assert.equal(init.result.serverInfo.version, "0.1.0");
    assert.ok(init.result.protocolVersion);
    assert.ok(init.result.capabilities?.tools);

    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list" });

    const listed = await readJsonLine(child);
    assert.equal(listed.id, 2);
    assert.equal(listed.error, undefined, JSON.stringify(listed.error));
    assert.equal(listed.result.tools.length, 11);
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["tracker_status", "project_list", "project_inspect", "data_read", "session_open", "session_control", "coords_set", "track_create", "mark_set", "data_export", "frame_get"],
    );
    child.stdin.write("not-json\n");
    send(child, { jsonrpc: "2.0", id: 3, method: "tools/list" });
    const afterBadLine = await readJsonLine(child);
    assert.equal(afterBadLine.id, 3);
    assert.equal(afterBadLine.result.tools[2].name, "project_inspect");
    assert.match(stderr.join(""), /\S/);

    send(child, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "tracker_status", arguments: { probe_service: "yes" } },
    });
    const called = await readJsonLine(child);
    assert.equal(called.id, 4);
    const body = JSON.parse(called.result.content[0].text);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INVALID_ARGUMENT");

    const emptyDir = makeTempDir();
    send(child, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "project_list", arguments: { dir: emptyDir } },
    });
    const listedProjects = await readJsonLine(child);
    assert.equal(listedProjects.id, 5);
    const listBody = JSON.parse(listedProjects.result.content[0].text);
    assert.equal(listBody.ok, true);
    assert.deepEqual(listBody.projects, []);

    const trk = writeTempTrk();
    send(child, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "project_inspect", arguments: { path: trk } },
    });
    const inspected = await readJsonLine(child);
    assert.equal(inspected.id, 6);
    const inspectBody = JSON.parse(inspected.result.content[0].text);
    assert.equal(inspectBody.ok, true);
    assert.equal(inspectBody.kind, "trk");
    assert.equal(inspectBody.tracks[1].mark_count, 2);

    send(child, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "data_read", arguments: { path: trk, track: "mass A" } },
    });
    const read = await readJsonLine(child);
    assert.equal(read.id, 7);
    const readBody = JSON.parse(read.result.content[0].text);
    assert.equal(readBody.ok, true);
    assert.equal(readBody.source, "trk_xml");
    assert.deepEqual(readBody.rows[1], [2, 3, 4]);
  } catch (error) {
    const extra = stderr.join("");
    if (extra) {
      error.message += `\nstderr:\n${extra}`;
    }
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("close", resolve)),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
  }
});
