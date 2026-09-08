#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTrackerMcpServer } from "./server.js";
import { ServiceClient } from "./service-client.js";

const client = new ServiceClient();
const server = createTrackerMcpServer(client);
let shuttingDown = false;
async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  await client.close();
  process.exit(code);
}
let transportFailed = false;
server.server.onerror = (error) => {
  transportFailed = true;
  process.stderr.write(`${error.stack ?? error.message}\n`);
};
server.server.onclose = () => {
  void shutdown(transportFailed ? 1 : 0);
};
process.once('SIGINT', () => { void shutdown(130); });
process.once('SIGTERM', () => { void shutdown(143); });
process.stdin.once('end', () => { void shutdown(transportFailed ? 1 : 0); });

const transport = new StdioServerTransport();
await server.connect(transport);
