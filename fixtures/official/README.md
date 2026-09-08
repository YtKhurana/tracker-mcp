# Official Tracker reference — 2026-09-08

These files are untouched exports from the owner using the installed official
Tracker 6.3.5 application (version also present in serialized project metadata).
Media is the repository-owned CC0 synthetic fixture, not a third-party video.

The original generated `minimal.trz` and `golden.trk` produced an MP4 warning
in the GUI. The owner imported the adjacent MP4 into the existing golden tab,
confirmed mark overlap at frames 0 and 7 (and reported overlap throughout),
saved, closed, and reopened `golden.trk` successfully. The owner then exported
the data and saved/reopened `official.trz` successfully with its video intact.

| File | SHA-256 |
| --- | --- |
| official.csv | 210b11edb567787c9462a6b2da450784664c4278a986d29c0da587c758bfc8bf |
| official.trz | 83292ade5ffe389e1286c31df004658b9f56f98f83ceaac1a3471a111d7d1d01 |

CSV: synthetic mass; t,x,y,vx,vy; comma delimiter; Tracker's **Full Precision**
option actually emits seven significant digits (`0.000000E0`). All 12 rows
and 56 finite cells match the independent analytical reference rounded to
seven significant digits; first/last velocities are blank. This rounding
criterion follows the format, not a fitted error tolerance. The unrounded
service comparison's maximum absolute difference was 4.845413266174603e-7.
The file includes Tracker's track-name preamble and trailing header delimiter;
do not normalize or resave it.

Archive entries: `official_golden.trk`, `videos/synthetic-parabola.mp4`,
`html/official_info.html`, and `official_thumbnail.png`. The bundled MP4 hash
is 2011c8bc38a512bceae19bc7d58bbe84aeb53443be2647b7a0408f574bbf9434,
identical to the prepared media. The saved current frame is 10.

## Rechecks

```sh
node --test test/official-oracle.test.js
TRACKER_NATIVE_TESTS=1 node --test test/official-reload.test.js
node scripts/verify-official.mjs fixtures/official/official.csv /absolute/path/to/reloaded.csv
```

The native test copies the archive into a fresh temporary directory (with no
adjacent MP4), reloads it, checks marks/calibration, compares its CSV, checks
frame 0 → 7 → 0 pixel centres, and requires normal exit with no visible windows.
Temporary extraction/output evidence is retained for diagnosis.

**Not yet proven:** untouched service-generated archive opening in official
Tracker from a fresh launch. The working human-saved golden video subtree is
identical to the original generated subtree. Changing serialization without
a discriminating test would not establish the root cause. S3 remains open;
these official references alone do not authorize skipping its exit check.
