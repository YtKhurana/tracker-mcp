#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_DIR=${SCRIPT_DIR:h:h}
APP_ROOT=${TRACKER_APP:-/Applications/Tracker.app}
APP_JAVAC="$APP_ROOT/Contents/runtime/Contents/Home/bin/javac"
TRACKER_JAR="$APP_ROOT/Contents/app/tracker.jar"
XUGGLE_JAR="$APP_ROOT/Contents/app/xuggle-xuggler-server-all.jar"
SLF4J_JAR="$APP_ROOT/Contents/app/slf4j-api.jar"
LOGBACK_CLASSIC_JAR="$APP_ROOT/Contents/app/logback-classic.jar"
LOGBACK_CORE_JAR="$APP_ROOT/Contents/app/logback-core.jar"
BUILD_DIR="$REPO_DIR/service/build/spikes"

for required in "$APP_JAVAC" "$TRACKER_JAR" "$XUGGLE_JAR" "$SLF4J_JAR" "$LOGBACK_CLASSIC_JAR" "$LOGBACK_CORE_JAR"; do
  if [[ ! -e "$required" ]]; then
    print -u2 "missing Tracker app dependency: $required"
    exit 2
  fi
done

mkdir -p "$BUILD_DIR"
CLASSPATH="$TRACKER_JAR:$XUGGLE_JAR:$SLF4J_JAR:$LOGBACK_CLASSIC_JAR:$LOGBACK_CORE_JAR"
exec "$APP_JAVAC" -encoding UTF-8 -classpath "$CLASSPATH" -d "$BUILD_DIR" \
  "$SCRIPT_DIR/src/tracker/mcp/spike/S2Probe.java" \
  "$SCRIPT_DIR/src/tracker/mcp/spike/S3Write.java" \
  "$SCRIPT_DIR/src/org/opensourcephysics/cabrillo/tracker/SpikePreferences.java"
