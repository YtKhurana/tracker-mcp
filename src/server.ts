import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDataRead } from "./data.js";
import { fail } from "./errors.js";
import { runProjectInspect } from "./inspect.js";
import { runProjectList } from "./list.js";
import { runTrackerStatusWithService } from "./status.js";
import { ServiceClient } from "./service-client.js";

function toolText(body: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}

function safeTool(run: (args: unknown) => unknown) {
  return async (args: Record<string, unknown> | undefined) => {
    try {
      return toolText(await run(args ?? {}));
    } catch {
      return toolText(fail("PARSE_FAILED", "unexpected tool failure", { reason: "uncaught" }));
    }
  };
}

export const SERVER_NAME = "tracker-mcp";
export const SERVER_VERSION = "0.1.0";

/** Stdio MCP server. No Tracker/OSP classes. */
export function createTrackerMcpServer(client = new ServiceClient()): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  server.server.onclose = () => { void client.close(); };
  server.registerTool(
    "tracker_status",
    {
      description:
        "Preflight Tracker.app, bundled JRE and Xuggle. probe_service (boolean, default false) starts and checks the owned service; false reports existing state without starting Java.",
      inputSchema: {
        probe_service: z.unknown().optional(),
      },
    },
    safeTool(args => runTrackerStatusWithService(args, client)),
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
    safeTool(runProjectList),
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
    safeTool(runProjectInspect),
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
    safeTool(runDataRead),
  );
  return server;
}
