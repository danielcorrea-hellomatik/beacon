# Hooks — Cómo Claude Code reporta al bridge

## Los 8 hooks que registramos

| Hook | Cuándo dispara | Status que setea | Push |
|---|---|---|---|
| `SessionStart` | Al inicio/resume de sesión | `idle` | no |
| `UserPromptSubmit` | Cuando el user envía un prompt | `working` | no |
| `PreToolUse` | Antes de ejecutar cualquier tool | `working` | no |
| `PostToolUse` | Después de ejecutar una tool | `working` | no |
| `SubagentStop` | Cuando un subagent acaba | (sin cambio) | no |
| `Notification` | Permission requests, elicitations | `needs_input` | **sí** (prioridad 5) |
| `Stop` | Claude termina su turno | `idle` | **sí** (prioridad 3) |
| `SessionEnd` | Sesión cerrada | `ended` | no |

Adicional: el `idle-watcher` del bridge revisa cada 15s y dispara push (prioridad 4) si una sesión está en `working` más de 60s sin nuevos eventos.

## Anatomía del hook

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/beacon-hook.sh <EventName>
#
# Claude Code llama a este script y le pasa el JSON del evento por stdin.
# Nosotros lo POSTeamos al bridge en background y devolvemos exit 0
# inmediatamente para no bloquear a Claude.

EVENT="$1"
TOKEN=$(cat "$HOME/.beacon/token")
STDIN=$(cat)

curl -sS --max-time 0.5 -o /dev/null \
  -X POST \
  -H "X-Beacon-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw "$STDIN" \
  "http://127.0.0.1:7890/api/events/$EVENT" &

exit 0
```

Notas:
- `curl ... &` lo lanza en background. Si el bridge está caído o tarda, no afecta a Claude.
- `--max-time 0.5` es defensa adicional.
- Si `~/.beacon/token` no existe, salimos silenciosamente — el bridge no está instalado.

## Settings.json entry

`install-hooks.sh` mergea esto en `~/.claude/settings.json` preservando otros hooks existentes:

```json
{
  "hooks": {
    "SessionStart":     [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh SessionStart"     } ] } ],
    "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh UserPromptSubmit" } ] } ],
    "PreToolUse":       [ { "matcher": "*", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh PreToolUse"  } ] } ],
    "PostToolUse":      [ { "matcher": "*", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh PostToolUse" } ] } ],
    "SubagentStop":     [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh SubagentStop"     } ] } ],
    "Notification":     [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh Notification"     } ] } ],
    "Stop":             [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh Stop"             } ] } ],
    "SessionEnd":       [ { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/beacon-hook.sh SessionEnd"       } ] } ]
  }
}
```

## Compatibilidad con otros hooks

`install-hooks.sh` usa `jq` para mergear, **no** sobreescribe. Si ya tienes hooks (Discord, Termify, custom), los respeta. Solo añade `beacon-hook.sh` como entrada extra. Para verificar:

```bash
jq '.hooks | keys' ~/.claude/settings.json
```

Y para ver todos los comandos registrados para un hook concreto:

```bash
jq '.hooks.PreToolUse' ~/.claude/settings.json
```

## Hardening que NO hicimos (y por qué)

- **No interceptamos PreToolUse para forzar aprobación remota**. Decisión del usuario: solo las preguntas naturales que Claude hace (Notification hook). Si en S7 se reactiva, será un hook PreToolUse condicional que solo se activa si hay matcher específico.
- **No bloqueamos hooks**. Todos retornan exit 0 inmediato. No queremos que Claude se cuelgue por un bridge caído.
- **No logueamos el payload completo a stdout**. Claude lo mostraría como parte del flujo. Todo va al bridge silenciosamente.

## Debugging

Si Beacon no recibe eventos:

1. **Bridge corriendo?** `curl -s http://localhost:7890/healthz`
2. **Token bien?** `cat ~/.beacon/token`
3. **Hooks registrados?** `jq '.hooks | keys' ~/.claude/settings.json`
4. **Script ejecutable?** `ls -la ~/.claude/hooks/beacon-hook.sh` (debe tener `x`)
5. **Test manual**:
   ```bash
   echo '{"session_id":"manual-test","cwd":"/tmp"}' | ~/.claude/hooks/beacon-hook.sh SessionStart
   sleep 1
   curl -s -H "X-Beacon-Token: $(cat ~/.beacon/token)" http://localhost:7890/api/sessions
   ```
