#!/bin/zsh
set -euo pipefail
SERVICE_DIR=${0:A:h}
APP_ROOT=${TRACKER_APP:-/Applications/Tracker.app}
APP_JAVA="$APP_ROOT/Contents/runtime/Contents/Home/bin/java"
APP_LIB="$APP_ROOT/Contents/app"
[[ -d "$APP_LIB" ]] || APP_LIB="$APP_ROOT/Contents/Java"
for required in "$APP_JAVA" "$APP_LIB/tracker.jar" "$APP_LIB/xuggle-xuggler-server-all.jar" "$SERVICE_DIR/build/TrackerService.jar"; do
  [[ -f "$required" ]] || { print -u2 "Missing Tracker service dependency: $required"; exit 2; }
done
RUNTIME_DIR=$(mktemp -d "${TMPDIR:-/private/tmp}/tracker-runtime.XXXXXXXX")
mkdir -p "$RUNTIME_DIR/preferences" "$RUNTIME_DIR/tmp"
exec "$APP_JAVA" -Dapple.awt.UIElement=true -Duser.home="$RUNTIME_DIR" -Djava.util.prefs.userRoot="$RUNTIME_DIR/preferences" -Djava.io.tmpdir="$RUNTIME_DIR/tmp" -classpath "$SERVICE_DIR/build/TrackerService.jar:$APP_LIB/tracker.jar:$APP_LIB/xuggle-xuggler-server-all.jar:$APP_LIB/slf4j-api.jar:$APP_LIB/logback-classic.jar:$APP_LIB/logback-core.jar" tracker.mcp.TrackerService
