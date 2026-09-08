# tracker-mcp

A local 11-tool stdio MCP server for Tracker video analysis. A TypeScript
sidecar talks to a separate GPL-3 Java service using your installed Tracker
runtime. No Tracker or Xuggle binaries are redistributed.

**0.2.0-rc.1:** all 11 tools are implemented. The latest full native run passed
108 of 109 tests; the corrupt-video test returned TIMEOUT instead of
VIDEO_DECODE. See [release verification](docs/RELEASE_VERIFICATION.md).
The new final artifact's official-app visual check and subsequent named job
acceptance gates remain pending. This is a release candidate, not a claim
that every v1 acceptance gate has passed.

## Install

Requires Node.js 20+, npm, macOS with a display session, and Tracker.app
(tested with 6.3.5 and its bundled Java 21). Read-only project tools do not
require Java. TRACKER_APP can override /Applications/Tracker.app.

From source:

```sh
npm ci --no-audit
npm run build
npm run build:service
```

For the private GitHub release tarball, install the downloaded local archive
in a new directory:

```sh
npm install /absolute/path/tracker-mcp-0.2.0-rc.1.tgz --no-audit
npm run build:service --prefix node_modules/tracker-mcp
```

The tarball includes compiled sidecar code; build the Java service locally
against your app. Do not move an installation while its service runs.
Configure an MCP host with the absolute installed dist/index.js path:

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

Only protocol messages go to stdout. Java starts lazily and exits when its
owning sidecar closes. One session and one request run at a time.

## Tools

| Tool | Purpose |
| --- | --- |
| tracker_status | Discover app runtime; optionally start/probe the service |
| project_list | Find local .trk and .trz files |
| project_inspect | Inspect stored video, coordinates, tracks and units |
| data_read | Read existing CSV or image-pixel marks without Java |
| session_open | Open supported local video or point-mass project |
| session_control | Status, save or close the session |
| coords_set | Set fixed origin, radian angle, scale and length unit |
| track_create | Create a point mass |
| mark_set | Set, replace or clear image-pixel marks |
| data_export | Export Tracker-computed CSV or JSON |
| frame_get | Save a decoded frame as PNG |

Use the advertised MCP input schemas for exact parameters. The workflow is
open → calibrate → create point mass → mark → export → save → close.
Inputs and explicit outputs are absolute local paths. Outputs never overwrite
existing files. Saves produce .trk, .trz and companion media; use .trz for
portable handoff. See [file lifetimes](docs/HANDOFF.md) and
[structured errors](docs/ERRORS.md).

Only fixed calibration and point masses are supported for editing. Unsupported
analysis settings fail explicitly; center of mass and autotracking are outside
v1. Read-only XML inspection reports stored values, not computed velocities.

## Verification and packaging

```sh
npm test
npm run typecheck
npm run test:service-unit
TRACKER_NATIVE_TESTS=1 npm test
npm run job:c -- /absolute/path/to/a-new-output-directory
npm run job:g -- \
  /absolute/path/to/synthetic-parabola.mp4 \
  /absolute/path/to/a-new-job-g-output-directory
npm pack
```

Job C uses an SDK client to create a fresh project from numeric fixture inputs,
checks all 12 marks, compares CSV to the frozen official export and records
artifact hashes in run.json. Official-app verification remains a separate
[checkpoint](docs/TRACKER_CHECKPOINT.md); automated comparison does not replace it.
Job G is a separate bounded frame-assisted replay: it decodes only the pinned
fixture's marker PNGs and explicitly does not claim general-purpose vision.

Fixture regeneration tests need Python 3, NumPy 2.2.6 and
OpenCV opencv-python-headless==4.12.0.88. Hosted CI runs portable checks on
Node 20/22; native tests require the app and display session. Green hosted CI
alone does not establish native video or official-app correctness.

The package includes TypeScript and GPL-3 service source, fixtures, documentation
and build/replay scripts. It excludes compiled Java/app jars and experiment
outputs. Distribution remains in the existing private GitHub repository, not
public npm. See [service documentation](service/README.md),
[protocol](service/PROTOCOL.md), [license](service/LICENSE) and
[changelog](CHANGELOG.md). Synthetic media provenance is in
fixtures/golden/manifest.json.
