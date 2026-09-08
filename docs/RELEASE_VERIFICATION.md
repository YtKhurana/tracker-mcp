# 0.2.0-rc.1 verification

This is a private release candidate, not final v1 acceptance.

- All 11 tools are registered; input validation, JSON errors and native
  session/save/export/PNG paths have regression coverage.
- Earlier complete native run: 106/106 passed before Job C/package tests.
- Latest full run: 108/109 passed, none skipped. The corrupt MP4 assertion
  expected VIDEO_DECODE but received TIMEOUT with its 5000 ms open budget.
  The unchanged focused test reproduced the mismatch. A standalone diagnostic
  returned VIDEO_DECODE (wall time about 5.86 seconds). Cause is not established;
  do not describe this as a clean native test run or a fixed issue.
  A subsequent unchanged focused run passed in 27.3 seconds; this establishes
  intermittency, not resolution.
- TypeScript typecheck and portable Java codec/import unit tests pass.
- Clean temporary consumer installed the local tarball with public runtime
  dependencies and no audit, built Java against the installed app, and ran
  SDK Job C successfully: 12 marks and 56 official CSV numeric cells agree at
  the frozen seven-significant-digit precision.
- Final tarball additionally includes TypeScript rebuild configuration and
  checkpoint documentation; clean-consumer reinstall and Java rebuild pass.
- No app jars or compiled Java artifacts are included. GPL-3 service source
  and its license/build inputs are included.
- Dependency advisory scanning was not performed; authorization for submitting
  private dependency metadata to the registry was not obtained.

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
complete; the final whole-project regression and release packaging remain.
