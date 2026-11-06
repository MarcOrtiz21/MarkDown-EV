#!/usr/bin/env bash
# Builds "MarkDown EV.app" from the Swift package.
# Usage: scripts/build-app.sh [debug|release]
set -euo pipefail

SWIFT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SWIFT_DIR/.." && pwd)"
CONFIG="${1:-debug}"
APP="$SWIFT_DIR/build/MarkDown EV.app"

# SwiftUI's macros (@State, @Entry…) ship with Xcode, not with the Command Line Tools.
if [[ "$(xcode-select -p)" == *CommandLineTools* && -d /Applications/Xcode.app ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

echo "→ Vista previa web"
(cd "$REPO_DIR" && npm run --silent build:preview >/dev/null)

echo "→ Compilando Swift ($CONFIG)"
cd "$SWIFT_DIR"
swift build -c "$CONFIG"
BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"

echo "→ Montando $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/MarkDownEV" "$APP/Contents/MacOS/MarkDownEV"
cp "$SWIFT_DIR/Resources/Info.plist" "$APP/Contents/Info.plist"
cp -R "$SWIFT_DIR/Resources/Preview" "$APP/Contents/Resources/Preview"
# Icon Composer bundle: Assets.car carries the Liquid Glass layers, AppIcon.icns the fallback.
xcrun actool "$SWIFT_DIR/Resources/AppIcon.icon" \
  --compile "$APP/Contents/Resources" \
  --platform macosx --minimum-deployment-target 26.0 \
  --app-icon AppIcon \
  --output-partial-info-plist "$SWIFT_DIR/build/icon-partial.plist" >/dev/null

codesign --force --deep --sign - "$APP" >/dev/null
echo "✓ Listo: $APP"
