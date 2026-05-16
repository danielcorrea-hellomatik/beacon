#!/usr/bin/env bash
# beacon-hook.sh — Despacha un evento de Claude Code al bridge local.
#
# Uso (en ~/.claude/settings.json):
#   { "type": "command", "command": "~/.claude/hooks/beacon-hook.sh <EventName>" }
#
# Lee el JSON del hook por stdin, le añade hook_event_name y lo POSTea al bridge
# en background con timeout corto para no bloquear a Claude.

set -eu

EVENT_NAME="${1:-Unknown}"
BRIDGE_URL="${BEACON_BRIDGE_URL:-http://127.0.0.1:7890}"
TOKEN_FILE="${BEACON_TOKEN_PATH:-$HOME/.beacon/token}"

# Si no hay token aún, el bridge no está instalado — salir silenciosamente
[ -f "$TOKEN_FILE" ] || exit 0

TOKEN=$(cat "$TOKEN_FILE")

# Leer stdin completo
STDIN_JSON=$(cat)

# Si stdin está vacío, mandar al menos el event name
[ -n "$STDIN_JSON" ] || STDIN_JSON='{}'

# POST en background — máx 500ms, no bloqueamos a Claude pase lo que pase
{
  curl -sS --max-time 0.5 -o /dev/null \
    -X POST \
    -H "X-Beacon-Token: $TOKEN" \
    -H "Content-Type: application/json" \
    --data-raw "$STDIN_JSON" \
    "$BRIDGE_URL/api/events/$EVENT_NAME" || true
} &

# Para hooks bloqueantes (PreToolUse, Stop) Claude espera nuestro stdout/exit code.
# Devolvemos exit 0 inmediatamente para no añadir latencia.
exit 0
