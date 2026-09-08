# Files and handoff

All input and explicit output paths must be absolute local filesystem paths,
not URLs or `file://` URIs. Output parent directories must already exist and
be writable. Directory symlinks are resolved; successful output replies use
canonical absolute paths. Existing output files and leaf symlinks—including
dangling links—are never overwritten. Save also refuses an existing companion
`.trk` or `.trz`. Choose a new basename to save again.

`session_control(save)` accepts either suffix and emits both `.trk` and `.trz`,
plus a uniquely named adjacent media file. Keep the media beside the `.trk`.
The `.trz` contains its own project and video and is the portable handoff.
Multi-file publication cannot be one filesystem transaction; failed saves
roll back only their own published files. Do not treat this as a guarantee
against a concurrently hostile filesystem.

File exports and saved projects survive session and service close. Closing
discards unsaved in-memory state. Paths in session status/open responses may
refer to staged input media whose lifetime ends at session close; save/export
paths are the durable handoff. No output directory or existing project is
automatically cleaned up by closing a session.

`data_export` without a path returns bounded inline data. `frame_get` without
a path allocates a unique private directory in the sidecar's OS temporary
area, outside Java's disposable runtime. Its PNG survives service shutdown;
move it to durable storage if needed, then remove it yourself. OS temporary
file maintenance may eventually remove it. Failed frame requests may leave
temporary directories or uncertain outputs; see [errors](ERRORS.md).

Open the saved artifact in official Tracker:

```sh
open -a Tracker.app "/absolute/path/result.trz"
```

Check that the video plays and the marks follow the intended object. This is
file handoff, not GUI automation. The initial S3 artifacts have official-app
evidence; a changed final v1 artifact needs its own recorded check. The
server does not manipulate Tracker's frontmost window, dialogs, or menus.

The surface is exactly 11 tools. No optional resources or prompts are needed
to retrieve the returned paths, CSV, JSON, or PNG outputs.
