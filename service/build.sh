#!/bin/zsh
set -euo pipefail
SERVICE_DIR=${0:A:h}
APP_ROOT=${TRACKER_APP:-/Applications/Tracker.app}
JDK="$APP_ROOT/Contents/runtime/Contents/Home"
APP_LIB="$APP_ROOT/Contents/app"
[[ -d "$APP_LIB" ]] || APP_LIB="$APP_ROOT/Contents/Java"
for required in "$JDK/bin/javac" "$JDK/bin/jar" "$APP_LIB/tracker.jar"; do
  [[ -f "$required" ]] || { print -u2 "Missing Tracker app dependency: $required"; exit 2; }
done
mkdir -p "$SERVICE_DIR/build/classes" "$SERVICE_DIR/build/test-classes"
"$JDK/bin/javac" -encoding UTF-8 -classpath "$APP_LIB/*" -d "$SERVICE_DIR/build/classes" "$SERVICE_DIR"/src/**/*.java
"$JDK/bin/jar" --create --file "$SERVICE_DIR/build/TrackerService.jar" --main-class tracker.mcp.TrackerService -C "$SERVICE_DIR/build/classes" . -C "$SERVICE_DIR" LICENSE
"$JDK/bin/javac" -encoding UTF-8 -classpath "$SERVICE_DIR/build/TrackerService.jar:$APP_LIB/*" -d "$SERVICE_DIR/build/test-classes" "$SERVICE_DIR"/test/**/*.java
"$JDK/bin/java" -classpath "$SERVICE_DIR/build/TrackerService.jar:$SERVICE_DIR/build/test-classes" tracker.mcp.CodecTest
"$JDK/bin/java" -classpath "$SERVICE_DIR/build/TrackerService.jar:$SERVICE_DIR/build/test-classes" tracker.mcp.ProjectInputTest "$SERVICE_DIR/../fixtures/official/service-generated.trz"
print "Built $SERVICE_DIR/build/TrackerService.jar"
