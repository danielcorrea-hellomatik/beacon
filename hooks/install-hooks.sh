#!/usr/bin/env bash
# install-hooks.sh — Instala el hook genérico de Beacon en ~/.claude/settings.json
#
# - Copia beacon-hook.sh a ~/.claude/hooks/
# - Hace backup de settings.json
# - Añade los 8 eventos: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
#   SubagentStop, Notification, Stop, SessionEnd
#
# Idempotente: si los hooks ya están instalados, los reemplaza.

set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
SETTINGS="$CLAUDE_DIR/settings.json"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOOK_SRC="$SCRIPT_DIR/beacon-hook.sh"
HOOK_DST="$HOOKS_DIR/beacon-hook.sh"

# Verificar dependencias
command -v jq >/dev/null 2>&1 || {
  echo "✗ Falta jq. Instalar con: brew install jq"
  exit 1
}

[ -f "$HOOK_SRC" ] || { echo "✗ No encuentro $HOOK_SRC"; exit 1; }

mkdir -p "$HOOKS_DIR"
cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
echo "✓ Copiado beacon-hook.sh → $HOOK_DST"

# Si no existe settings.json, crear base
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi

# Backup
cp "$SETTINGS" "$SETTINGS.beacon-bak.$(date +%s)"

# Construir JSON con los 8 hooks
HOOKS_JSON=$( cat <<'JSON'
{
  "SessionStart":     [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh SessionStart"     } ] } ],
  "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh UserPromptSubmit" } ] } ],
  "PreToolUse":       [ { "matcher": "*", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh PreToolUse"       } ] } ],
  "PostToolUse":      [ { "matcher": "*", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh PostToolUse"      } ] } ],
  "SubagentStop":     [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh SubagentStop"     } ] } ],
  "Notification":     [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh Notification"     } ] } ],
  "Stop":             [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh Stop"             } ] } ],
  "SessionEnd":       [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh SessionEnd"       } ] } ]
}
JSON
)

# Mergear con settings existente preservando otros hooks (los previos quedan, los de beacon se sobrescriben)
TMP=$(mktemp)
jq --argjson new_hooks "$HOOKS_JSON" '
  .hooks = ( (.hooks // {}) as $existing
           | $existing * $new_hooks )
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"

echo "✓ Registrados 8 hooks de Beacon en $SETTINGS"
echo "  (los hooks previos se mantienen, los de Beacon se sobrescriben)"
echo ""
echo "Para verificar:"
echo "  jq '.hooks | keys' $SETTINGS"
