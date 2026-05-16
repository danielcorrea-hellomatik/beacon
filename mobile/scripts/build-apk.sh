#!/usr/bin/env bash
# build-apk.sh — compila el APK firmado para Android con un device pre-configurado.
#
# Uso:
#   ./scripts/build-apk.sh                                 # sin default; el user vincula a mano
#   ./scripts/build-apk.sh --local                         # auto-detecta host Tailscale + lee token de ~/.beacon/token
#   ./scripts/build-apk.sh --host=mac.ts.net --token=XXX --port=7890 --name="Mi Mac"
#
# Output: src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
#         + copia en ~/Desktop/Beacon.apk

set -euo pipefail

cd "$( dirname "${BASH_SOURCE[0]}" )/.."

HOST=""
PORT="7890"
TOKEN=""
NAME=""
INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --local)
      # Hostname Tailscale
      HOST=$( tailscale status --json 2>/dev/null | python3 -c \
        "import sys,json; d=json.load(sys.stdin); print(d.get('Self',{}).get('DNSName','').rstrip('.'))" 2>/dev/null || true )
      [ -z "$HOST" ] && HOST=$( hostname )
      # Token del bridge local
      if [ -f "$HOME/.beacon/token" ]; then
        TOKEN=$( cat "$HOME/.beacon/token" )
      else
        echo "✗ No encuentro ~/.beacon/token. Arranca el bridge primero."
        exit 1
      fi
      NAME=$( hostname | sed 's/\.local$//' )
      ;;
    --host=*) HOST="${arg#--host=}" ;;
    --port=*) PORT="${arg#--port=}" ;;
    --token=*) TOKEN="${arg#--token=}" ;;
    --name=*) NAME="${arg#--name=}" ;;
    --install) INSTALL=true ;;
    -h|--help)
      cat <<USAGE
Uso:
  $0                                              compile vanilla
  $0 --local                                      auto-detect host Tailscale + token
  $0 --host=X.ts.net --token=Y [--port=7890] [--name=...]
  $0 --local --install                            compile + adb install + lanzar
USAGE
      exit 0
      ;;
  esac
done

echo "═══ Beacon APK build ═══"
if [ -n "$HOST" ]; then
  echo "  Default device:"
  echo "    host:  $HOST"
  echo "    port:  $PORT"
  echo "    token: ${TOKEN:0:6}…${TOKEN: -4}"
  echo "    name:  ${NAME:-$HOST}"
else
  echo "  Sin default device (el user vincula a mano)"
fi
echo

# Env requirements
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/26.3.11579264}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export JAVA_HOME="${JAVA_HOME:-$( /usr/libexec/java_home )}"

# Vars que vite.config.ts lee y inyecta en el bundle
export BEACON_DEFAULT_HOST="$HOST"
export BEACON_DEFAULT_PORT="$PORT"
export BEACON_DEFAULT_TOKEN="$TOKEN"
export BEACON_DEFAULT_NAME="$NAME"

echo "═══ Compilando ═══"
bunx tauri android build --apk --target aarch64 2>&1 | tail -3

APK="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
if [ ! -f "$APK" ]; then
  echo "✗ APK no generado"
  exit 1
fi

cp "$APK" "$HOME/Desktop/Beacon.apk"
echo
echo "✓ APK: $HOME/Desktop/Beacon.apk ($( du -h "$APK" | awk '{print $1}' ))"

if [ "$INSTALL" = true ]; then
  echo
  echo "═══ Instalando en el móvil conectado ═══"
  STATE=$( adb devices | grep -v 'List of' | head -1 | awk '{print $2}' )
  if [ "$STATE" != "device" ]; then
    echo "✗ móvil no autorizado (estado: $STATE)"
    exit 1
  fi
  # uninstall por si firma cambia
  adb uninstall app.beacon.mobile 2>&1 | tail -1 || true
  adb install "$APK" 2>&1 | tail -1
  adb shell am start -n app.beacon.mobile/.MainActivity 2>&1 | tail -1
  echo "✓ instalado y lanzado"
fi
