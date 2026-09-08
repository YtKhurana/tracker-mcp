# Tracker Java experiments

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
The official-app checkpoint remains pending, including export precision and
final numerical tolerance. See [checkpoint instructions](../docs/TRACKER_CHECKPOINT.md).
