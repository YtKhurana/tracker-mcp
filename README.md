# tracker-mcp

A local 11-tool stdio MCP server for Tracker video analysis. A TypeScript
sidecar talks to a separate GPL-3 Java service using your installed Tracker
runtime. No Tracker or Xuggle binaries are redistributed.

**0.2.0:** the frozen 11-tool v1 surface, Job C–G replays, and the
official-app checkpoint are complete. A pre-staging native suite passed
141/141 tests with no skips in 565507 ms. A later stressed post-staging run
passed 139/141 in 694857 ms: its two timing failures passed unchanged in
controlled quiescent reruns, but remain a documented residual accepted by the
owner for this private stable release. See
[release verification](docs/RELEASE_VERIFICATION.md) for exact evidence.

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
npm install /absolute/path/tracker-mcp-0.2.0.tgz --no-audit
npm run build:service --prefix node_modules/tracker-mcp
```

The tarball includes compiled sidecar code but no Tracker, Xuggle, or other
app jars. Build the Java service locally against your installed Tracker.app;
do not move an installation while its service runs.
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

The 0.2.0 verification record includes a portable suite (119 pass, 0 fail,
22 native skips) and a pre-staging full native suite (141 pass, 0 fail,
0 skipped in 565507 ms). A later stressed post-staging native run passed
139/141 in 694857 ms: all Jobs C–G passed, while the EDT action-start and
unauthenticated slow-client timing checks failed. One controlled quiescent,
unchanged rerun of each file passed—`service-lifecycle` 1/1 in 16096.973291 ms
and `service-native` 1/1 in 31640.377458 ms—supporting a host-contention
inference but retaining the timing residual. The owner explicitly accepted it
for this private stable release. A clean consumer built Java and ran the
packaged checkpoint with exit 0 in 18.5 s (12 rows; maximum error
`4.440892098500626e-15`; expected artifacts; zero visible windows); packaged
Job C reproduced the approved TRZ SHA-256
`e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5`, and
packaged Job G passed relocation and reaping. Native tests require a local
Tracker.app and display session; they cannot be replaced by hosted CI.

Fixture regeneration tests need Python 3, NumPy 2.2.6 and
OpenCV opencv-python-headless==4.12.0.88. Hosted CI runs portable checks on
Node 20/22; native tests require the app and display session. Green hosted CI
alone does not establish native video or official-app correctness.

The package includes TypeScript and GPL-3 service source, fixtures, documentation
and build/replay scripts. It excludes compiled Java/app jars and experiment
outputs. Distribution remains in the existing private GitHub repository, not
public npm; the 0.2.0 release notes are for that private GitHub release. See
[service documentation](service/README.md),
[protocol](service/PROTOCOL.md), [license](service/LICENSE) and
[changelog](CHANGELOG.md), plus the [0.2.0 release notes](docs/RELEASE_NOTES_0.2.0.md).
Synthetic media provenance is in
fixtures/golden/manifest.json.
