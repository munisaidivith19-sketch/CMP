#!/usr/bin/env bash
# App unit + UI tests on an iOS simulator (macOS + Xcode 16+ only).
# Usage: Scripts/test-app.sh ["iPhone 16"]
set -euo pipefail
cd "$(dirname "$0")/.."
DEVICE="${1:-iPhone 16}"
[ -d VEXON.xcodeproj ] || Scripts/generate-project.sh
xcodebuild test \
  -project VEXON.xcodeproj \
  -scheme VEXON \
  -destination "platform=iOS Simulator,name=${DEVICE}" \
  CODE_SIGNING_ALLOWED=NO
