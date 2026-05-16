#!/usr/bin/env bash
# install-launchd.sh — Registra el bridge como LaunchAgent (arranca al login).
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BRIDGE_DIR="$( dirname "$SCRIPT_DIR" )"
PLIST_SRC="$SCRIPT_DIR/com.beacon.bridge.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.beacon.bridge.plist"

BUN_BIN="$( command -v bun || true )"
[ -n "$BUN_BIN" ] || { echo "✗ bun no encontrado en PATH. Instalar con: curl -fsSL https://bun.sh/install | bash"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$BRIDGE_DIR/.logs"

# Sustituir placeholders y escribir
sed -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__BRIDGE_DIR__|$BRIDGE_DIR|g" \
    "$PLIST_SRC" > "$PLIST_DST"

# Recargar
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

sleep 1

echo "✓ LaunchAgent instalado: $PLIST_DST"
echo "✓ Arranca al login automáticamente."
echo ""
echo "Comprobar status:"
echo "  launchctl list | grep beacon"
echo "  curl -s http://localhost:7890/healthz"
echo ""
echo "Logs:"
echo "  tail -f $BRIDGE_DIR/.logs/bridge.out.log"
echo "  tail -f $BRIDGE_DIR/.logs/bridge.err.log"
echo ""
echo "Para desinstalar:"
echo "  $SCRIPT_DIR/uninstall-launchd.sh"
