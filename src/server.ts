import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDataRead } from "./data.js";
import { runProjectInspect } from "./inspect.js";
import { runProjectList } from "./list.js";
import { runTrackerStatus } from "./status.js";

export const SERVER_NAME = "tracker-mcp";
export const SERVER_VERSION = "0.1.0";

/** Stdio MCP server. No Tracker/OSP classes. */
export function createTrackerMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  server.registerTool(
    "tracker_status",
    {
      description:
        "Preflight Tracker.app, bundled JRE home (Contents/runtime/Contents/Home), and xuggle-xuggler-server-all.jar. Optional probe_service (boolean, default false) is ignored in v0; service is always null. Does not start Java.",
      inputSchema: {
        probe_service: z.unknown().optional(),
      },
    },
    async (args) => {
      const body = runTrackerStatus(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  );
  server.registerTool(
    "project_list",
    {
      description:
        "List .trk and .trz files in an absolute directory. recursive (boolean, default false) walks descendants. No Java; does not open or parse projects.",
      inputSchema: {
        dir: z.unknown(),
        recursive: z.unknown().optional(),
      },
    },
    async (args) => {
      const body = runProjectList(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  );
  server.registerTool(
    "project_inspect",
    {
      description:
        "Inspect a .trk (OSP XML) or .trz (zip containing a .trk). Returns image-space video, coords, tracks, and units. Does not write marks or start Java.",
      inputSchema: {
        path: z.unknown(),
      },
    },
    async (args) => {
      const body = runProjectInspect(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  );
  server.registerTool(
    "data_read",
    {
      description:
        "Read an existing CSV as stored, or image-space PointMass$FrameData (frame,x,y) from a .trk/.trz. Does not compute velocities or start Java.",
      inputSchema: {
        path: z.unknown(),
        track: z.unknown().optional(),
        format: z.unknown().optional(),
      },
    },
    async (args) => {
      const body = runDataRead(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify(body) }] };
    },
  );
  return server;
}
