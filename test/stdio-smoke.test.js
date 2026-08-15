import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
    assert.deepEqual(listed.result.tools, []);
  } catch (error) {
    const extra = stderr.join("");
    if (extra) {
      error.message += `\nstderr:\n${extra}`;
    }
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
  }
});
