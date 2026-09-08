# tracker-mcp 0.2.0

`0.2.0` is the stable v1 release of the local 11-tool Tracker MCP server.
It is distributed as a private GitHub release, not through the public npm
registry.

## Included

- The complete read-only and v1 point-mass MCP tool surface.
- Reproducible Job C–G acceptance scripts, including the bounded, pinned-fixture
  Job G frame-to-mark replay.
- TypeScript source, fixtures, documentation, and the GPL-3 Java service source.

## Requirements

Use Node.js 20+ and a local macOS Tracker.app installation with a display
session for native video workflows. Tracker, Xuggle, and other app jars are
not bundled in the tarball; build the included Java service against the local
Tracker.app runtime.

## Verification

The portable suite passed 119/119 with 22 native tests skipped. A pre-staging
complete native suite passed 141/141 with no skips in 565507 ms. A later
stressed post-staging full run passed 139/141 in 694857 ms: all Jobs C–G
passed, but EDT action-start and unauthenticated slow-client timing checks
failed. Unchanged controlled quiescent reruns then passed `service-lifecycle`
1/1 in 16096.973291 ms and `service-native` 1/1 in 31640.377458 ms. This
supports host contention but retains a timing residual explicitly accepted by
the owner for this private stable release. Typecheck, Java
`CodecTest`/`ProjectInputTest`, a clean-consumer Java build, and a 117-entry
package dry run passed. The packaged checkpoint exited 0 in 18.5 s with 12
rows, maximum error `4.440892098500626e-15`, expected artifacts, and zero
visible windows; packaged Job C reproduced TRZ SHA-256
`e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5`, and
packaged Job G passed relocation and reaping. See
[release verification](RELEASE_VERIFICATION.md) for the complete evidence and
the retained timing-sensitive residual.

## Scope

Job G's pixel detector is intentionally restricted to the pinned synthetic
fixture. It does not provide general-purpose visual tracking. The package stays
private and must not be published to public npm without a separate release
decision.
