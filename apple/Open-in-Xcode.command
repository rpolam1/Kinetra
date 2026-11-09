#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d Kinetra.xcodeproj ] || [ project.yml -nt Kinetra.xcodeproj/project.pbxproj ]; then
  GEN="$(command -v xcodegen || true)"
  if [ -z "$GEN" ]; then
    TMP="$(mktemp -d)"
    curl -fsSL -o "$TMP/xcodegen.zip" "https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip"
    unzip -q "$TMP/xcodegen.zip" -d "$TMP"
    GEN="$TMP/xcodegen/bin/xcodegen"
  fi
  "$GEN" generate
fi

open Kinetra.xcodeproj
