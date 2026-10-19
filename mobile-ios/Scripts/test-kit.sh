#!/usr/bin/env bash
# Unit tests for the platform-independent core (no simulator needed).
# Works on macOS with Xcode 16+, or on Linux/Windows with a Swift 6 toolchain.
set -euo pipefail
cd "$(dirname "$0")/../Packages/VEXONKit"
swift test "$@"
