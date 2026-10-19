#!/usr/bin/env bash
# Generate VEXON.xcodeproj from project.yml (run on the Mac).
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen is not installed. Install it with:  brew install xcodegen" >&2
  exit 1
fi
xcodegen generate
echo "Done. Open VEXON.xcodeproj in Xcode (packages resolve on first open)."
