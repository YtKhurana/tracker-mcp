# TrackerService and Java experiments

The GPL-3 service source is under `src/`. Its authenticated local protocol is
documented in [PROTOCOL.md](PROTOCOL.md). Native service and lifecycle checks
pass. After building the jar,
`tracker_status(probe_service=true)` starts and checks one owned service.
All seven v1 MCP operations are registered alongside the four read-only tools.
Job C has passed its official-app checkpoint. Job D's native
reopen/export/save/close acceptance and independent reviews pass. Job E
replays the approved one-frame clear/correction in isolated owners. Jobs F-G
remain pending.

```sh
./service/build.sh
npm run test:service-unit
TRACKER_NATIVE_TESTS=1 node --test test/service-native.test.js
TRACKER_NATIVE_TESTS=1 node --test test/service-lifecycle-native.test.js
TRACKER_NATIVE_TESTS=1 node --test test/mcp-service-native.test.js
```

Replay Job D against the exact human-verified Job C artifact into a new,
previously nonexistent run directory:

```sh
npm run build:service
npm run build
npm run job:d -- \
  "$PWD/service/build/final-mcp-v1-videos-layout/golden.trz" \
  "/absolute/new/job-d-run"
```

The runner verifies SHA-256
`e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5`,
copies only that archive into an isolated relocation directory, starts a fresh
stdio MCP/service process, checks status, exports CSV, saves new project
artifacts, closes the session, and writes `run.json`. It requires the adjacent
Job C `run.json` to identify a SHA-pinned baseline CSV and refuses to reuse an
existing run directory.

Replay Job E against that same exact human-verified Job C artifact into a new,
previously nonexistent run directory:

```sh
npm run build:service
npm run build
npm run job:e -- \
  "$PWD/service/build/final-mcp-v1-videos-layout/golden.trz" \
  "/absolute/new/job-e-run"
```

Job E rechecks the source and Job C CSV provenance hashes, copies the archive
alone into `relocated-input`, clears frame 5 and replaces frame 7 with
`(180,137)` in one fresh stdio MCP/service owner, and writes the corrected
CSV/project/media only to `mutation-output`. It then opens that archive through
a distinct fresh MCP/service owner and exports to `reopen-output`. It checks
the independent calibrated world-coordinate and central-difference oracle,
the exact `project.trk` + `videos/media.mp4` archive layout, and unchanged
media bytes. `run.json` is exclusive-created only after both owner pairs have
exited.

`build.sh` uses the installed app compiler and creates
`service/build/TrackerService.jar`. The portable codec/import tests require
JDK 21 but no Tracker classes; CI runs them separately. Native tests require
the official app runtime and a macOS display session.

Imports are data-only: bounded XML/ZIP parsing, fixed coordinates, point masses,
and local MP4/MOV/AVI video. Project media must stay within the project directory
or archive. Variable calibration and unsupported analysis settings fail
explicitly. Supplemental archive HTML is never opened. Only validated staged
media reaches the direct Xuggle decoder; its error path does not invoke
Tracker's file-opening dialogs.

All Tracker state is EDT-owned. Output paths are absolute, parents must exist,
and existing outputs are never overwritten. A project save emits a `.trk`,
`.trz`, and companion video; CSV/JSON export with a path returns metadata, while
inline exports return bounded data. Session close discards unsaved memory but
does not remove published files. A timeout poisons the process; its owner must
terminate/restart it before accepting more work.

## Earlier experiments

The GPL-3 source under `spikes/` links the installed Tracker app. It is an
experiment, not the JSON-RPC service or an MCP tool.

Use the app's Java/compiler and jars (tested: Tracker 6.3.5, x86_64 Java 21.0.6
on an arm64 Mac). A display session is required. No headless flag is set.

```sh
./service/spikes/build-s2.sh
./service/spikes/run-s2.sh classpath
./service/spikes/run-s2.sh construct
./service/spikes/run-s2.sh construct_no_frame
npm run checkpoint
```

`npm run checkpoint` uses a fresh directory, bounds the process to 60 seconds,
and verifies the CSV against independent analytical values. A timeout forcibly
terminates that child and is a failed experiment. Successful runs exit normally.
Preferences, temporary native files and outputs live under ignored `service/build/`.

The write probe sets fixed coordinates, creates 12 marks, exports
`TTrack.getData`, checks replace/delete/restore, writes via `XMLControlElement`,
then packages three archive candidates. It only accepts the known synthetic
fixture for meaningful numerical verification. It is not an untrusted-file
service. The preference bridge accesses source-verified package-private flags
without requiring reflection on Tracker's missing desktop SwingJS interface.

To reload a generated project with the hidden loader:

```sh
./service/spikes/run-s2.sh reload /absolute/path/minimal.trz /absolute/path/new-output 30
```

Lifecycle findings: callbacks may repeat, so writes use a one-shot guard.
Dispose the frame's owned dialogs before deregistering the panel. Java setter
angles are radians; this Tracker serializer records the angle in degrees.
The S3 official-app checkpoint passed; its untouched references and fixed
seven-significant-digit comparison are under `fixtures/official/`. New final
v1 artifacts still require the [official check](../docs/TRACKER_CHECKPOINT.md).
