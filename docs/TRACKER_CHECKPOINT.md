# Official Tracker checkpoint

## Final v1 release-candidate check

The clean installed package successfully built its service and replayed Job C.
The new artifact is `service/build/final-mcp-v1/golden.trz` in the development
checkout; its SHA-256 is
`6a21e90822c6abea8d96fecfbdb674766da5582f4f889cdcc36c8e9a0a12a807`.
The adjacent `run.json` records all output paths, hashes, marks and calibration.
Its CSV passes the unchanged official comparison: 12 rows, 56 numeric cells,
seven significant digits. **Human confirmation is pending.**

1. Open this exact new archive in official Tracker, without importing media.
2. Play it; check that markers overlap the ball at frames 0 and 7.
3. Close and reopen the same archive and confirm video and marks persist.
4. Report any warning or mismatch; otherwise confirm these checks passed.

Do not substitute an earlier golden.trk or repaired archive. This final check
gates later named acceptance jobs; the earlier S3 evidence below is separate.

## Earlier S3 evidence

Status: S3 checkpoint complete. Official CSV and repaired project are checked;
the owner also confirmed the original unchanged minimal archive opens with
video after a fresh Tracker launch, before importing any MP4. Untouched
copies, hashes and evidence are in `fixtures/official/`. The transient initial
warning is not attributed to a proven code defect. New final v1 artifacts
still need official verification under ADR 0006.

The original checkpoint procedure is retained below for future regenerations.

Run `npm run checkpoint` to generate a fresh directory, or use the current
local directory `service/build/spikes/s3-final/`.

1. Open `minimal.trz`, `with-html.trz`, and `with-html-thumbnail.trz` in official
   Tracker.app, one at a time. Record which open with the video intact.
2. For a working candidate, check track **synthetic mass**, mass **1 kg**,
   **12 marks**, clip frames **0–11**, step size **1**, **10 fps**. Origin is
   **(96,168)** image pixels; angle **30°**; scale **40 pixels/m**. Frame 0's
   marker is **(48,190)**; frame 7 is **(167,141)**. The full list is in
   `fixtures/golden/manifest.json`.
3. Export the synthetic mass's table with **t,x,y,vx,vy**, all rows, preferably
   **Full Precision** (observed: seven significant digits in Tracker 6.3.5). Save the untouched export as
   `official.csv` beside the candidates. Keep blank derivative endpoints.
4. Save the verified project as `official.trz` in that same directory.
5. Report the directory, which candidate shapes worked, the Tracker version,
   and the export precision. If anything looks wrong, report the mismatch.

Do not rename `service.csv` to `official.csv`: the latter must come from the
official application's table export. The agent will hash the checked files,
compare the export, test relocation/reload, and continue implementation.

Expected checks: 12 position rows; t runs 0 to 1.1 seconds; velocity is blank
at the first and last rows with the default derivative method. Java's current
finite values agree with the independent polynomial expectation to about
4.45e-15. Official CSV comparison will account for the chosen export precision,
with its tolerance fixed before inspecting differences.
