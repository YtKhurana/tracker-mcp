#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTrackerMcpServer } from "./server.js";

const server = createTrackerMcpServer();
let transportFailed = false;
server.server.onerror = (error) => {
  transportFailed = true;
  process.stderr.write(`${error.stack ?? error.message}\n`);
};
server.server.onclose = () => {
  process.exit(transportFailed ? 1 : 0);
};

const transport = new StdioServerTransport();
await server.connect(transport);
