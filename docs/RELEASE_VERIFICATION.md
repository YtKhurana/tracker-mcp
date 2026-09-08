# 0.2.0 verification

This is the stable v1 release record for the private GitHub distribution. The
package remains `private: true`; it is not an npm publication.

- All 11 tools are registered; input validation, JSON errors and native
  session/save/export/PNG paths have regression coverage.
- Portable `npm test` passed 119/119 with 0 failures and 22 native tests
  skipped. A pre-staging full native `TRACKER_NATIVE_TESTS=1 npm test` passed
  141/141 with 0 failures and 0 skips in 565507 ms.
- A later stressed post-staging full native run passed 139/141 in 694857 ms.
  All Jobs C–G passed; the two failures were the EDT action-start and
  unauthenticated slow-client timing checks. One controlled quiescent,
  unchanged rerun of each affected file passed: `service-lifecycle` 1/1 in
  16096.973291 ms and `service-native` 1/1 in 31640.377458 ms. That supports a
  host-contention inference, but does not eliminate the timing residual. The
  owner explicitly accepted that residual for this private stable release.
- TypeScript typecheck plus Java `CodecTest` and `ProjectInputTest` pass. The
  final package dry run contains 117 entries, including these release notes and
  the complete checkpoint script/source chain.
- The earlier 108/109 native run had a corrupt-MP4 assertion expecting
  `VIDEO_DECODE` but receiving `TIMEOUT` under its 5000 ms open budget. An
  unchanged focused test then passed three consecutive times (30.071 s,
  25.804 s, and 24.691 s), and the pre-staging full native run passed. This is
  evidence of the current release result, not proof that the timing-sensitive
  decoder behavior was fixed; retain it as residual risk.
- A clean temporary consumer installed the local package with public runtime
  dependencies and no audit, and its Java build passed against the installed
  Tracker.app. Its packaged checkpoint exited 0 in 18.5 s with 12 rows, maximum
  error `4.440892098500626e-15`, all expected artifacts, and zero visible
  windows. Packaged Job C reproduced approved TRZ SHA-256
  `e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5`; packaged
  Job G passed relocation and reaping.
- The package additionally includes TypeScript rebuild configuration and
  checkpoint documentation; no final tarball hash is recorded here.
- No app jars or compiled Java artifacts are included. GPL-3 service source
  and its license/build inputs are included.
- No online dependency advisory scan was submitted because this is a private
  package; the release is not represented as a public-registry publication.

The rc.1 archive failed the official GUI check because its video resource was
at the ZIP root. It must not be promoted as stable. The reviewed replacement
uses fixed `project.trk` and `videos/media.mp4` entries, preserves the encoded
media bytes, and passed focused native save/reopen/path tests.

The owner verified replacement SHA-256
`e50fb6d38ef7f163de93fd6cd21c0af1ec92ea52dd4902cf4c8f2b80f59809b5`
in official Tracker: no import, video playback, marker overlap at frames 0 and
7, and persistence after close/reopen all pass. TASKS 3.1 is complete.

TASKS 3.2 Job D passes focused native checks through a fresh stdio MCP and
newly owned Java service. The SHA-pinned artifact was copied by itself to a
new relocation directory, reopened cleanly, reported the same fixed calibration and one
12-mark point mass, exported `t,x,y,vx,vy`, saved to new `.trk`/`.trz`/media
paths, and closed. The saved archive retains root `project.trk` plus
`videos/media.mp4`; its embedded media bytes match the verified input. CSV
columns, 12-row membership, four endpoint blanks and all 56 finite cells match
the Job C export, with reload-only floating-point differences below the
predeclared `1e-9` absolute bound. The native acceptance and injected-error
cleanup paths pass 6/6. Fresh independent fault, code, security, and test
reviews passed after one consolidated fix and finding-only rechecks. TASKS 3.2
is complete.

TASKS 3.3 Job E reopens that same pinned Job C archive, clears frame 5, and
replaces frame 7 from `(167,141)` to `(180,137)` through `mark_set`. Its
independent calibration and central-difference oracle verifies the exact 11
retained rows, derivative blanks at frames 0, 4, 6, and 11, unchanged frame-7
velocity, and the expected frame-8 velocity change within `1e-9`. The corrected
`.trk` and `.trz` preserve exactly those marks, their companion/archive media
bytes and accepted archive layout, and a distinct fresh MCP/Java owner reopens
the saved archive cleanly. Both owners and the injected-failure owner are
reaped before evidence publication; a baseline changed before final
publication is rejected. Focused native Job E checks pass 8/8. Fresh fault,
code, security, and test reviews passed after one narrow fix and finding-only
rechecks. TASKS 3.3 is complete.

TASKS 3.4 Job F starts from the SHA-pinned raw fixture and exact pinned
two-track manifest. It creates `parabolic target` (mass 1.25, 12 marks) and
`linear reference` (mass 2.75, 10 distinct marks), then validates separate
exports against independent calibrated position and central-difference
velocity oracles, including a closed-form linear velocity check. A fresh owner
reopens the standalone `.trk`; another relocates and reopens the `.trz` alone.
All six exports retain the correct track membership without cross-contamination,
both project forms preserve the exact marks/masses, and raw, companion, and
embedded media bytes match. All three owner pairs are distinct and reaped;
injected failures and final provenance tampering suppress `run.json`. Focused
native Job F checks pass 6/6. Fresh fault, code, security, and test reviews
passed after pinning the approved manifest digest in the single fix pass and
rechecking that finding. TASKS 3.4 is complete.

TASKS 3.5 Job G starts from the pinned raw fixture and exact fixture-specific
detector manifest. It calls `frame_get` in the sequence 0 → 7 → 0, validates
bounded PNG structure before decode, derives marker centroids from the actual
returned RGBA pixels, and constructs `mark_set` only from those evidence
records. The two saved marks and independent world-coordinate export persist
through an archive-only relocation and a distinct fresh owner. A substituted
valid frame-0 PNG at the frame-7 step changes the derived result and aborts
before marking, saving, or evidence publication, proving that the returned
image bytes drive the write path. Media/layout/provenance and both owner pairs
are verified and reaped. Focused native Job G checks pass 10/10. Fresh fault,
code, security, and test reviews passed after one pre-decode IHDR-bound fix and
finding-only rechecks. This proves only the pinned fixture-assisted loop, not
general visual tracking accuracy. TASKS 3.5 and the Slice 3 success metric are
complete. The final portable/native regression, Java checks, typecheck, and
package validation are recorded at the top of this document; the 0.2.0 private
GitHub release metadata is ready for publication.
