#!/usr/bin/env bash
set -euo pipefail
PLIST_DST="$HOME/Library/LaunchAgents/com.beacon.bridge.plist"
[ -f "$PLIST_DST" ] || { echo "no instalado"; exit 0; }
launchctl unload "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "✓ LaunchAgent eliminado"
