# Changelog

## 0.2.0

- Promote the reviewed private GitHub release after the official Tracker.app
  checkpoint and reproducible Job C–G acceptance replays completed.
- Add the bounded Job G `frame_get` → `mark_set` replay. It derives marks only
  from validated pixels of the pinned synthetic fixture; it is not a
  general-purpose vision feature.
- Ship the verified v1 package inputs, including fixture manifests, replay
  scripts, TypeScript source, and GPL-3 Java service source. Tracker, Xuggle,
  and other app jars are not bundled; a local Tracker.app remains required for
  native operations.
- Keep the package private and distribute this version through the private
  GitHub release, not the public npm registry.

Verification recorded for this release: portable `npm test` passed 119/119
with 22 native tests skipped; the pre-staging full native
`TRACKER_NATIVE_TESTS=1 npm test` passed 141/141 with no skips in 565507 ms.
A later stressed post-staging full run passed 139/141 in 694857 ms: all Jobs
C–G passed, while EDT action-start and unauthenticated slow-client timing
checks failed. Unchanged controlled quiescent reruns then passed
`service-lifecycle` 1/1 in 16096.973291 ms and `service-native` 1/1 in
31640.377458 ms. That supports a host-contention inference but retains a
timing residual, explicitly accepted by the owner for this private stable
release. Typecheck, Java `CodecTest` and `ProjectInputTest`, a Java build in a
clean consumer, and a 117-entry package dry run passed. The packaged
checkpoint exited 0 in 18.5 s with 12 rows, maximum error
`4.440892098500626e-15`, expected artifacts, and zero visible windows; packaged
Job C reproduced TRZ SHA-256
`e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5`, and
packaged Job G passed relocation and reaping. The earlier intermittent
corrupt-video error-code history remains residual timing risk rather than a
claim of a code fix.

## 0.2.0-rc.1

- Complete the frozen 11-tool MCP surface: sessions, calibration, point masses,
  batch marks, Tracker-computed CSV/JSON, and PNG frame extraction.
- Add an authenticated loopback Java service using the installed Tracker app
  runtime, EDT-owned state, bounded input parsing, and nonoverwriting writes.
- Own Java startup/shutdown and timeout recovery; never retry ambiguous writes.
- Preserve structured errors across both transports and document file lifetimes.
- Add native SDK workflow, official CSV, pixel, lifecycle, and path regressions.
- Include corresponding GPL-3 service source, build scripts, and reproducible
  Job C inputs in the installable package. App jars are not redistributed.

Release-candidate limitation: the new final Job C artifact still requires its
own official Tracker visual check. Later named job acceptance gates remain
pending until that check passes. Earlier S3 official evidence is preserved,
not substituted for verification of a changed final artifact.

The latest full native run passed 108/109 tests. The corrupt-video error-code
test timed out and reproduced in a focused run; a separate direct diagnostic
returned VIDEO_DECODE. This timing-sensitive check remains unresolved; no
assertions or timeouts were relaxed. See docs/RELEASE_VERIFICATION.md.
