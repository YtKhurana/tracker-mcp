import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from "zod";
import { runDataRead } from "./data.js";
import { fail } from "./errors.js";
import { runProjectInspect } from "./inspect.js";
import { runProjectList } from "./list.js";
import { runTrackerStatusWithService } from "./status.js";
import { ServiceClient } from "./service-client.js";
import { openSchema, controlSchema, runSessionOpen, runSessionControl, coordsSchema, trackSchema, markSchema, runCoordsSet, runTrackCreate, runMarkSet } from './session.js';

function toolText(body: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }],
    ...((body as {ok?:boolean})?.ok === false ? {isError:true} : {}) };
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
  const definitions: Tool[] = [];
  // Advertise the strict contract, but let the adapter produce our JSON errors.
  // The SDK's own validator otherwise turns invalid arguments into plain text.
  function register(name:string, config:{description:string; inputSchema:z.ZodType | z.ZodRawShape}, handler:ReturnType<typeof safeTool>) {
    const schema=config.inputSchema instanceof z.ZodType ? config.inputSchema : z.object(config.inputSchema);
    definitions.push({name,description:config.description,inputSchema:z.toJSONSchema(schema,{target:'draft-7',io:'input'}) as Tool['inputSchema']});
    server.registerTool(name,{description:config.description,inputSchema:z.looseObject({})},handler);
  }
  server.server.onclose = () => { void client.close(); };
  register(
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
  register(
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
  register(
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
  register(
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
  register('session_open', {
    description:'Open one local video or point-mass .trk/.trz with the bundled Tracker runtime. One session at a time. timeout_ms bounds decoding; transport adds 10 seconds for preparation. No automatic retry.',
    inputSchema:openSchema,
  },safeTool(args=>runSessionOpen(args,client)));
  register('session_control', {
    description:'Inspect, save, or close a session. Save requires a new absolute .trk/.trz path and emits both files plus companion video; existing files are never overwritten. Close discards unsaved memory, not saved files.',
    inputSchema:controlSchema,
  },safeTool(args=>runSessionControl(args,client)));
  register('coords_set',{description:'Set fixed calibration across all frames: origin in image pixels, angle in radians, scale in pixels per world unit. Omitted values are preserved.',inputSchema:coordsSchema},safeTool(args=>runCoordsSet(args,client)));
  register('track_create',{description:'Create a uniquely named point mass. Only point_mass is supported; default mass is 1.',inputSchema:trackSchema},safeTool(args=>runTrackCreate(args,client)));
  register('mark_set',{description:'Set or clear a batch of image-pixel marks. Frame is the video frame number, not clip step. Set requires x and y; clear=true allows frame only. Duplicate frames are rejected before mutation.',inputSchema:markSchema},safeTool(args=>runMarkSet(args,client)));
  server.server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:definitions}));
  return server;
}
