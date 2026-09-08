# Official Tracker checkpoint

Status: pending human work. Java-generated candidates and analytical checks
are available. This is the required independent check before v1 tools are
implemented and a completed v1 release is published.

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
   at least **9 significant digits**. Save the untouched export as
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
