#!/usr/bin/env bash
set -euo pipefail

# Run from the folder this script is in, so it works when double clicked from Finder
cd "$(dirname "$0")"

# The project file is made from project.yml, so it is rebuilt whenever project.yml is newer
if [ ! -d Kinetra.xcodeproj ] || [ project.yml -nt Kinetra.xcodeproj/project.pbxproj ]; then
  GEN="$(command -v xcodegen || true)"
  # Uses the installed XcodeGen if there is one, otherwise downloads a copy for this run only
  if [ -z "$GEN" ]; then
    TMP="$(mktemp -d)"
    curl -fsSL -o "$TMP/xcodegen.zip" "https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip"
    unzip -q "$TMP/xcodegen.zip" -d "$TMP"
    GEN="$TMP/xcodegen/bin/xcodegen"
  fi
  "$GEN" generate
fi

open Kinetra.xcodeproj
