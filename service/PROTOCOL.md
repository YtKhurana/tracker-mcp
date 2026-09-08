# TrackerService local protocol

Item 2.1 uses the existing architecture's localhost JSON-RPC option.
The sidecar remains JSON-only and never links Tracker classes.

Start `service/run.sh` after `service/build.sh`. The child reads a random
64-hex-character token as its first stdin line; keep stdin open for its
lifetime. Closing stdin requests shutdown. The token must not appear in
process arguments, logs, readiness output, or files.

The service binds only `127.0.0.1` on an OS-selected port and prints one stdout
line `{ "ready": true, "port": 12345, "pid": 123 }`. Tracker logs go to
stderr. This is not an HTTP server and has no browser API.

TCP messages are newline-delimited JSON-RPC 2.0, with bounded sizes/depth:

```json
{"jsonrpc":"2.0","id":1,"token":"<launch token>","method":"status","params":{}}
```

Each reply preserves the request ID and uses `result` for the shared product
envelope: `{ "ok": true, ... }` or
`{ "ok": false, "error": { "code": "...", "message": "...", "details": {} } }`.
The internal methods map to the frozen MCP fields without exposing objects:

| Internal method | MCP operation |
| --- | --- |
| status | service readiness, current session summary |
| open | session_open |
| control | session_control (status/save/close) |
| coords | coords_set |
| track | track_create (point_mass only) |
| mark | mark_set |
| export | data_export |
| frame | frame_get |

One service holds at most one session. Tracker access is EDT-owned and
serialized. Validate complete requests before mutation. Unknown/stale sessions
fail explicitly. Timeouts poison in-flight state; the sidecar must terminate
the process rather than reuse it while native work may still be running.

Import must parse bounded ZIP/XML as data, validate supported point-mass,
coordinate and timing values, load only staged local media, then rebuild
objects via Java. Staged media uses the direct Xuggle decoder, not
TrackerIO.openURL (whose failure path can display a dialog).
Never pass arbitrary project XML/archive to Tracker's loader:
it can instantiate objects or open supplemental files. Unsupported physics is
an explicit error, never silently discarded. Output publication must not
overwrite existing files or inputs.

Acceptance tests include authentication before file access, invalid-batch
atomicity, archive relocation/reopen, official CSV comparison, requested-frame
PNG extraction, existing-file preservation, and clean process shutdown.

## Sidecar ownership

The TypeScript client launches app Java directly with an argv array, no shell,
and a private temporary runtime. It validates the app-contained runtime/jars,
readiness PID and port, response envelope and request ID. Tokens travel only
over the owned stdin pipe and authenticated loopback socket. Child logs are
drained without forwarding them to MCP stdout.

Default status does not start Java. An explicit probe requests service status;
later probes reuse the same process. Concurrent service requests return
`SESSION_BUSY`. Startup and request deadlines are bounded. A timed-out or
broken exchange is never automatically retried, since a write may have run.
Shutdown closes child stdin, waits a bounded grace period, then uses SIGKILL
if necessary. A child that cannot be terminated remains poisoned and prevents
a replacement launch. Private runtime cleanup occurs only after child exit.
