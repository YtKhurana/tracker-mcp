# Changelog

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
