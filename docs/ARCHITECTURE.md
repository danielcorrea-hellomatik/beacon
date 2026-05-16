# Beacon — Arquitectura

## Vista de pájaro

```
┌──────────────────────── Mac N (cada uno corre lo mismo) ─────────────────────┐
│                                                                              │
│  Claude Code interactivo (terminal)                                          │
│         │                                                                    │
│         │   stdin JSON                                                       │
│         ▼                                                                    │
│  ~/.claude/hooks/beacon-hook.sh <EventName>                                  │
│         │                                                                    │
│         │   curl -X POST /api/events/<EventName> (background, max-time 0.5s) │
│         ▼                                                                    │
│  beacon-bridge :7890 (Bun + Hono + SQLite)                                   │
│   ├─ sessions / events / queued_prompts en SQLite                            │
│   ├─ idle-watcher (cron 15s)                                                 │
│   ├─ ccusage data-loader (stats reales)                                      │
│   ├─ spawn.ts (claude --resume -p ... cuando llega prompt del móvil)         │
│   └─ WebSocket /stream para broadcast en vivo                                │
│         │                                                                    │
└─────────┼────────────────────────────────────────────────────────────────────┘
          │
          │ Tailscale (red privada, MagicDNS)
          │
          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Móvil Android (Tauri 2 + Svelte 5 + Tailwind)                               │
│                                                                              │
│   • Lista de Macs vinculados (token único por Mac)                           │
│   • Para cada Mac: dashboard de stats + sesiones activas/pasadas             │
│   • Por sesión: timeline en vivo + input chat                                │
│   • Foreground Service Kotlin: WebSocket persistente en background           │
│   • ntfy.sh app oficial: push remoto cuando la app está cerrada              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Componentes

### bridge/  (corre en cada Mac)
- **Lenguaje**: TypeScript ejecutado por Bun (single binary, arranque <100ms)
- **Framework**: Hono (HTTP + WebSocket)
- **Storage**: SQLite con WAL mode en `~/.beacon/data.db`
- **Auth**: header `X-Beacon-Token` con token estático guardado en `~/.beacon/token` (modo 0600)
- **Stats**: librería `ccusage` que parsea `~/.claude/projects/**/*.jsonl` con `mode: 'calculate'` (evita el bug de subcuenta de tokens)
- **Spawn**: cuando llega un prompt nuevo del móvil para una sesión, encolamos. Al detectar `Stop` para esa sesión, lanzamos `claude --resume <session_id> -p "<prompt>" --output-format stream-json` y parseamos eventos en vivo.

#### Esquema SQLite

| Tabla | Propósito |
|---|---|
| `sessions` | Una fila por session_id. Status: working/idle/needs_input/ended/unknown. |
| `events` | Toda la actividad: cada hook que entra. Histórico infinito. |
| `queued_prompts` | Cola FIFO de prompts del móvil pendientes de despachar a Claude. |
| `notifications_log` | Auditoría de pushes enviados a ntfy.sh. |
| `config` | ntfy_topic, idle_threshold, otros. |

#### Endpoints

```
GET   /healthz                              (público — para el pair scanner)
POST  /api/events/:type                     (auth — hooks)
GET   /api/sessions                         (auth — lista)
GET   /api/sessions/:id                     (auth — detalle)
GET   /api/sessions/:id/events?since=ts     (auth — timeline)
POST  /api/sessions/:id/send                (auth — encola prompt para Claude)
POST  /api/sessions/:id/kill                (auth — TODO S9)
GET   /api/stats                            (auth — stats locales + ccusage)
GET   /api/config                           (auth — host, ntfy_topic, etc.)
WS    /stream?token=…                       (auth — broadcast de eventos en vivo)
```

### hooks/
8 hooks de Claude Code registrados en `~/.claude/settings.json`:
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `Notification`, `Stop`, `SessionEnd`. Todos disparan `beacon-hook.sh <EventName>` que hace POST al bridge en background con timeout 500ms. **No bloquea a Claude.**

### pair-cli/
Imprime un QR ASCII con un payload `beacon://pair?p=<base64url-json>` que contiene `host`, `port`, `token`, `name`. La app móvil escanea el QR y guarda el device en su lista. Detecta automáticamente el hostname Tailscale con `tailscale status --json`.

### mobile/
- **Stack**: Tauri 2 + Svelte 5 + Vite + Tailwind 3 + svelte-spa-router (hash router)
- **Plugins Tauri**: notification, deep-link, http, store, os; barcode-scanner + biometric solo en mobile
- **Tema**: dark only, accent `#D97757` (naranja Claude), mascot 🦀 animado en sesiones working
- **Foreground Service**: pendiente (S5) — plugin Kotlin custom para mantener WebSocket abierto en background
- **Distribución**: APK firmado, sideload directo (no Play Store)

## Decisiones críticas

### No se inyectan mensajes en sesiones interactivas
Claude Code no expone API/socket para inyectar prompts en una sesión activa. El bridge usa `claude --resume <id> -p` headless para reanudar con contexto completo. La sesión reanudada termina cuando responde, no queda interactiva. Para el usuario es transparente — sigue siendo "una sesión continuada".

### Push solo eventos críticos
Decisión del usuario: notificaciones solo en `Stop`, `Notification` (needs_input) y idle alert (>60s sin output). Cero spam de tool calls. El timeline detallado se ve en la app cuando entras.

### Histórico infinito
Decisión del usuario: SQLite no purga eventos. Acceso vía `/api/sessions/:id/events?since=` con paginación si llegara a hacer falta.

### Auth simple
Token estático por bridge. Tailscale ya provee la red privada — añadir mTLS o JWT sería sobreingeniería para single-user.

## Roadmap

| Sprint | Estado | Entregable |
|---|---|---|
| S1 Bridge core | ✅ | Bun+Hono+SQLite+ccusage, 8 endpoints, WS, launchd |
| S2 Pair CLI | ✅ | QR con beacon://pair?p=… |
| S3 Spawn + queue | ✅ | claude --resume -p stream-json parser |
| S4 App Tauri shell | ✅ | 4 pantallas Svelte con mock data |
| S5 WS live + FG Service | ⏳ | Plugin Kotlin custom |
| S6 ntfy.sh + push | ✅ | Dispatcher + deeplinks beacon:// |
| S7 Aprobación remota natural | ⏳ | Notification → push con botones |
| S8 Stats dashboard real | ✅ | ccusage + heatmap CSS Grid |
| S9 Polish v1 | ⏳ | Kill switch real, biometric, APK firmado |
| S10 Features V2 | ⏳ | Voice, Widget, Cost burndown, Snapshot |

## Riesgos conocidos

1. **`usage.input_tokens` JSONL subcuenta 100-174×** → siempre `ccusage mode: 'calculate'`.
2. **MainActivity duplicado con FG Service** (Tauri #11609) → check `isServiceRunning()` en `onCreate`.
3. **Battery optimization Xiaomi/MIUI** → UI guía a Autostart manual.
4. **`claude --resume -p` reanuda y termina** → el bridge orquesta loops de reanudación por cada prompt del móvil; el usuario no necesita Claude Code abierto en el Mac.
