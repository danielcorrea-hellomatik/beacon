# Android Plugin Reference

Código Kotlin que **no se puede compilar hasta que tengas Android SDK + NDK instalados**.
Es la referencia para Sprint 5 (Foreground Service) y la parte Android del Sprint 10 (Widget).

## Cómo activarlo

```bash
# 1. Instala Android Studio + acepta licencias de SDK
brew install --cask android-studio
# Abre Android Studio → Settings → Languages & Frameworks → Android SDK
# Asegura instalar: Platform 34, Build-Tools 34.0.0, NDK 26.x, CMake

# 2. Export env
echo 'export ANDROID_HOME=$HOME/Library/Android/sdk' >> ~/.config/fish/config.fish
echo 'set -gx ANDROID_HOME $HOME/Library/Android/sdk' >> ~/.config/fish/config.fish
echo 'set -gx NDK_HOME $ANDROID_HOME/ndk/26.3.11579264' >> ~/.config/fish/config.fish

# 3. Inicializa Android en Tauri
cd mobile
bun run android:init

# 4. Mueve estos archivos a sus paths reales
#    ws-service/WsService.kt   → src-tauri/gen/android/app/src/main/java/app/beacon/mobile/WsService.kt
#    widget/BeaconWidget.kt    → src-tauri/gen/android/app/src/main/java/app/beacon/mobile/widget/BeaconWidget.kt
#    widget/beacon_widget.xml  → src-tauri/gen/android/app/src/main/res/layout/beacon_widget.xml
#    widget/beacon_widget_info.xml → src-tauri/gen/android/app/src/main/res/xml/beacon_widget_info.xml
#    manifest/snippets.xml     → mergea en src-tauri/gen/android/app/src/main/AndroidManifest.xml

# 5. Build APK
bun run android:build
```

## Estructura

| Archivo | Propósito |
|---|---|
| `ws-service/WsService.kt` | Foreground Service que mantiene WebSocket persistente |
| `ws-service/BootReceiver.kt` | Reinicia el servicio tras reboot |
| `widget/BeaconWidget.kt` | AppWidgetProvider con tokens del día + N sesiones activas |
| `widget/beacon_widget.xml` | Layout del widget |
| `widget/beacon_widget_info.xml` | Metadata (tamaño, update interval) |
| `manifest/snippets.xml` | Permisos + declaración del Service + Widget |

## Gotchas conocidos

- **Tauri Bug #11609**: si el FG Service sobrevive a `MainActivity`, al relanzar la app hay dos instancias y `TAURI_INVOKE_KEY` no matchea. `WsService.kt` chequea `isMainActivityAlive()` y se autoapaga si no.
- **Android 14 (API 34)**: `foregroundServiceType` es obligatorio (usamos `dataSync`).
- **Battery optimization en MIUI (Xiaomi)**: el usuario debe activar manualmente "Autostart" para que Android no mate el service. La app debería detectarlo y mostrar un banner.
