#!/usr/bin/env bash
# uninstall-hooks.sh — Quita los hooks de Beacon de ~/.claude/settings.json
set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
HOOK_DST="$HOME/.claude/hooks/beacon-hook.sh"

[ -f "$SETTINGS" ] || { echo "no settings.json found"; exit 0; }

command -v jq >/dev/null 2>&1 || { echo "✗ Falta jq. brew install jq"; exit 1; }

cp "$SETTINGS" "$SETTINGS.beacon-uninst.$(date +%s)"

TMP=$(mktemp)
jq '
  .hooks |= ( . // {} | with_entries(
    .value |= map(
      .hooks |= map(select( (.command // "") | test("beacon-hook.sh") | not ))
    ) | .value |= map(select( (.hooks // []) | length > 0 ))
  ))
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"

rm -f "$HOOK_DST"
echo "✓ Hooks de Beacon eliminados de $SETTINGS"
echo "✓ Script $HOOK_DST eliminado"
