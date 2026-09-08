#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_DIR=${SCRIPT_DIR:h:h}
APP_ROOT=${TRACKER_APP:-/Applications/Tracker.app}
APP_JAVA="$APP_ROOT/Contents/runtime/Contents/Home/bin/java"
TRACKER_JAR="$APP_ROOT/Contents/app/tracker.jar"
XUGGLE_JAR="$APP_ROOT/Contents/app/xuggle-xuggler-server-all.jar"
SLF4J_JAR="$APP_ROOT/Contents/app/slf4j-api.jar"
LOGBACK_CLASSIC_JAR="$APP_ROOT/Contents/app/logback-classic.jar"
LOGBACK_CORE_JAR="$APP_ROOT/Contents/app/logback-core.jar"
BUILD_DIR="$REPO_DIR/service/build/spikes"
MODE=${1:-classpath}
if (( $# > 0 )); then
  shift
fi
RUNTIME_STATE_DIR="$BUILD_DIR/runtime-state"

for required in "$APP_JAVA" "$TRACKER_JAR" "$XUGGLE_JAR" "$SLF4J_JAR" "$LOGBACK_CLASSIC_JAR" "$LOGBACK_CORE_JAR" "$BUILD_DIR/tracker/mcp/spike/S2Probe.class"; do
  if [[ ! -e "$required" ]]; then
    print -u2 "missing S2 runtime dependency: $required"
    exit 2
  fi
done

CLASSPATH="$BUILD_DIR:$TRACKER_JAR:$XUGGLE_JAR:$SLF4J_JAR:$LOGBACK_CLASSIC_JAR:$LOGBACK_CORE_JAR"
mkdir -p "$RUNTIME_STATE_DIR/preferences" "$RUNTIME_STATE_DIR/tmp"
exec "$APP_JAVA" \
  -Dapple.awt.UIElement=true \
  -Duser.home="$RUNTIME_STATE_DIR" \
  -Djava.util.prefs.userRoot="$RUNTIME_STATE_DIR/preferences" \
  -Djava.io.tmpdir="$RUNTIME_STATE_DIR/tmp" \
  -classpath "$CLASSPATH" \
  tracker.mcp.spike.S2Probe "$MODE" "$@"
