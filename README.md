# Beacon

Remote monitoring and control of [Claude Code](https://docs.claude.com/en/docs/claude-code) sessions from your Android phone, over Tailscale.

Connect to one or more Macs running Claude Code, watch every active session in real time, see token and cost stats backed by [ccusage](https://github.com/ryoppippi/ccusage), and reply to Claude from your phone — sending prompts that continue the existing session headlessly.

## How it works

```
Mac (Claude Code + 8 hooks)
   |
   v
beacon-bridge (Bun + Hono + SQLite)        <-- runs on your Mac, port 7890
   |
   v
Tailscale (private network)
   |
   v
Beacon Android app (Tauri 2 + Svelte 5)    <-- installs as a normal Android app
                                               + ntfy.sh for background push
```

The bridge listens for Claude Code hook events, scans `~/.claude/projects/**/*.jsonl` to discover sessions that started before the hooks were installed, computes stats from ccusage, exposes a REST + WebSocket API, and dispatches push notifications to ntfy.sh on Stop / Notification / idle alerts. The Android app pairs with the bridge via host + token and renders everything: dashboard, calendar heatmap, models breakdown, per-session timeline, and a chat-style input that lets you send prompts back to Claude.

## Project layout

```
beacon/
  bridge/            Local server in Bun. REST + WS + SQLite + ccusage integration
  pair-cli/          QR-code pairing CLI
  hooks/             Generic Claude Code hook script + installer
  mobile/            Tauri 2 + Svelte 5 + Tailwind app (Android + Desktop)
  docs/              Architecture, pairing, hooks reference
```

## Quickstart

### 1. Run the bridge on your Mac

```sh
cd bridge
bun install
bun run start
# server listens on 0.0.0.0:7890, prints ntfy topic and token path
```

Token is auto-generated on first run at `~/.beacon/token` (mode 0600).

### 2. Install the Claude Code hooks (optional but recommended)

```sh
cd hooks
./install-hooks.sh
# merges 8 hooks into ~/.claude/settings.json without touching your existing ones
```

Hooks send `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `Notification`, `Stop`, `SessionEnd` to the bridge with a 500 ms timeout, so they never block Claude.

### 3. Install the Android app

The repo includes a signed release APK target at `mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/`.

Build it yourself:

```sh
cd mobile
bun install
bun run android:init           # only once
bun run tauri android build --apk --target aarch64
```

Install with adb:

```sh
adb install mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Or copy the APK to your phone, enable "install from unknown sources", and tap it.

### 4. Pair the phone with the Mac

Open the app, tap **Vincular Mac**, and enter:

- **Host**: your Tailscale hostname (e.g. `your-mac.tail-xxxxx.ts.net`) or LAN IP
- **Port**: `7890`
- **Token**: contents of `~/.beacon/token`
- **Name**: anything

The app pings `/healthz` before saving.

### 5. Autostart the bridge at login (optional)

```sh
cd bridge/scripts
./install-launchd.sh
# bridge will start automatically at login
```

## Features

- **Real-time dashboard** per Mac: sessions, messages, tokens, days active, current streak, longest streak, peak hour, favorite model
- **GitHub-style calendar heatmap** with intensity per day, anchored to today, week-aligned grid
- **Per-cell tooltip**: full date, total tokens, USD cost, model breakdown for that day
- **Models tab**: collapsible table sorted by spend, with daily breakdown per model
- **Session detail**: full timeline imported from the JSONL (including events that happened before hooks were installed), live updates via WebSocket, auto-scroll to bottom
- **Continue sessions from the phone**: text or voice input enqueues a prompt; bridge runs `claude --resume <id> -p` headlessly with the queued prompt
- **Approval flow**: when a session is `needs_input`, the app shows Continue / Stop buttons that send a natural reply to Claude
- **Push notifications** via ntfy.sh on Stop, Notification (permission requests), and idle alerts (>60 s without output)
- **Voice to prompt** using the Web Speech API
- **Biometric gate** for critical actions (send, approve, kill) via tauri-plugin-biometric or WebAuthn fallback
- **Kill switch** for sessions spawned by Beacon (SIGTERM + SIGKILL after 5 s)
- **Snapshot share** of the calendar as PNG with watermark
- **Cost burndown**: monthly plan tracking with overshoot alert
- **Multi-Mac**: vinculate any number of Macs, each with its own token

## Endpoints

```
GET   /healthz                                public, returns version + hostname + ntfy topic
GET   /dev-token                              loopback-only, used for auto-discovery in dev mode

GET   /api/sessions                           list sessions
GET   /api/sessions/:id                       session detail
GET   /api/sessions/:id/events                full event timeline (auto-imports from JSONL)
POST  /api/sessions/:id/send                  queue a prompt to send to Claude
POST  /api/sessions/:id/kill                  SIGTERM the spawn (Beacon-spawned only)
POST  /api/sessions/:id/respond               reply to a pending approval
GET   /api/sessions/:id/pending-approval      latest unresolved Notification
POST  /api/sessions/:id/import-history        force re-import the JSONL

GET   /api/stats                              global stats, instant response
GET   /api/stats/daily-by-model               per (day, model) breakdown, instant
GET   /api/stats/burndown                     monthly cost extrapolation vs configured plan

GET   /api/config                             host, ntfy topic, ntfy server
POST  /api/config                             update config key/values

WS    /stream?token=...                       real-time event broadcast
POST  /api/events/:type                       hook ingest (authenticated)

POST  /api/sessions/scan                      trigger JSONL discovery scan
```

All `/api/*` endpoints require the `X-Beacon-Token` header.

## Performance

The bridge serves all stat endpoints in under 50 ms after warmup. The first ccusage parse on boot is the only slow operation (5-15 s parsing every JSONL with model pricing). After that, ccusage data is held in a shared in-memory cache with 60 s TTL, so all three derived computations (global stats, daily breakdown, burndown) reuse the same parsed arrays.

```
Cold hit (ccusage warming up):       13 ms     <- returns sql-only
Warm hit (after warmup):              9 ms     <- returns mixed (sql + ccusage)
Bridge memory footprint:             ~80 MB
APK size:                            12 MB     <- arm64-v8a only
```

## Notes about Claude Code hooks

Claude Code does not provide an interactive API to inject prompts into a running session. The bridge solves this with a producer-consumer pattern: when the phone sends a prompt, it is queued in SQLite, and the next time the target session is idle (post-Stop), the bridge spawns `claude --resume <id> -p "<prompt>" --output-format stream-json` and parses the streamed events. From the user's perspective the session continues with full context; technically each turn is a new headless invocation that resumes from the saved checkpoint.

This means the user does not need to keep Claude Code open in a terminal on the Mac. The bridge orchestrates everything via the headless mode.

## Stack

- **Bridge**: Bun 1.3, Hono 4, SQLite (bun:sqlite), ccusage 15, node-spawn
- **Mobile**: Tauri 2, Svelte 5 with runes, Vite 6, Tailwind 3, Lucide icons, JetBrains Mono + Inter via @fontsource
- **Plugins**: tauri-plugin-http, tauri-plugin-store, tauri-plugin-notification, tauri-plugin-deep-link, tauri-plugin-barcode-scanner, tauri-plugin-biometric
- **Push**: ntfy.sh (self-hostable, or use the public instance), custom scheme `beacon://`
- **Database**: SQLite locally on the Mac with WAL mode

## License

MIT
