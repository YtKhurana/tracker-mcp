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

Human verification of the new artifact remains pending as described in
[the checkpoint](TRACKER_CHECKPOINT.md). The project requires this before
starting named jobs D, E, F and G. Existing lower-level tests exercising similar
operations are not substituted for those ordered acceptance jobs.
