# tracker-mcp

A local stdio MCP server for inspecting Tracker video-analysis projects.

**Current status:** four read-only v0 tools work. Java experiments also create
calibrated point-mass projects and CSVs, but the seven v1 session tools are
under implementation after the completed S3 checkpoint. Official reference
CSV and checked archives are preserved in `fixtures/official/`. This is not a finished
v1 release.

## Install and run

Requires Node.js 20 or 22 and npm. Clone this repository, then run:

```sh
npm ci
npm run build
npm start
```

The server uses stdio; launch it from an MCP host. For example:

```json
{
  "mcpServers": {
    "tracker": {
      "command": "node",
      "args": ["/absolute/path/to/tracker-mcp/dist/index.js"]
    }
  }
}
```

The sidecar writes only protocol messages to stdout. Tool inputs use absolute
filesystem paths. Tool errors use `{ok:false,error:{code,message,details}}`.

| Tool | Input | Result |
| --- | --- | --- |
| `tracker_status` | optional `probe_service` | Tracker.app's bundled JRE and Xuggle locations; service is null in v0 |
| `project_list` | `dir`, optional `recursive` | `.trk`/`.trz` paths and sizes |
| `project_inspect` | `path` | Video metadata, stored coordinates, tracks, mark counts and units |
| `data_read` | `path`, optional `track`, `format` | Existing CSV data or image-pixel marks from a project |

`project_list`, `project_inspect`, and `data_read` do not need Java. Runtime
discovery defaults to `/Applications/Tracker.app`; `TRACKER_APP` overrides it.
The v0 sidecar never starts Java or computes Tracker velocities. XML inspection
returns stored values; serialized angles may use degrees even though the Java
coordinate setter takes radians.

## Development and packaging

```sh
npm test
npm run typecheck
npm pack
```

Native regression against the official project (macOS with Tracker installed):

```sh
TRACKER_NATIVE_TESTS=1 node --test test/official-reload.test.js
```

The fixture-generation test needs Python 3, NumPy 2.2.6 and OpenCV 4.12.0.
Install the development dependencies with
`python3 -m pip install numpy==2.2.6 opencv-python-headless==4.12.0.88`.
CI runs the portable tests and package build on Node 20/22. Checks requiring
Tracker.app or the sibling Tracker source/examples are explicitly skipped
when unavailable. A green hosted CI run does not establish native video or
official-app correctness; those checks run locally with Tracker 6.3.5.

`npm pack` builds a v0 sidecar tarball containing compiled code and TypeScript
source. It excludes the Java experiments and app jars. The package remains
private until the release gates are complete.

## Java experiments and human checkpoint

See [service/README.md](service/README.md) for the bundled-JRE build/run
commands and [the checkpoint instructions](docs/TRACKER_CHECKPOINT.md).
`npm run checkpoint` prepares fresh artifacts and checks analytical values;
it requires a macOS display session and the installed Tracker app runtime.

The planned v1 workflow is open → calibrate → create point mass → mark →
export → save → close, with a total of 11 MCP tools. Official Tracker must
open the output and export a matching table before that work can be marked
complete. Center of mass and autotracking remain outside v1.

TrackerService experiments are GPL-3; see [service/LICENSE](service/LICENSE).
Tracker and Xuggle binaries are provided by the user's Tracker installation
and are not redistributed here. Synthetic fixture media is generated from
numeric inputs; its provenance is recorded in `fixtures/golden/manifest.json`.
