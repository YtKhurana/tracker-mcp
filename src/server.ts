import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SERVER_NAME = "tracker-mcp";
export const SERVER_VERSION = "0.1.0";

/** Stdio MCP server. No Tracker/OSP classes; tools are added in later slices. */
export function createTrackerMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );
  // McpServer only wires tools/list on the first registerTool(). Slice 0.1
  // has no tools yet; initialize the empty list so hosts can enumerate.
  type ToolHandlerInit = { setToolRequestHandlers(): void };
  (server as unknown as ToolHandlerInit).setToolRequestHandlers();
  return server;
}
