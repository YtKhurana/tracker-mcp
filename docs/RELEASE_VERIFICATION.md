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
7, and persistence after close/reopen all pass. TASKS 3.1 is complete; Jobs
D-G and the final full regression remain pending.
