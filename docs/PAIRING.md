# Pairing — Vincular tu móvil con un Mac

## Flujo completo (3 pasos)

```
┌─── Mac ────────────┐                ┌─── Móvil ──────────┐
│                    │                │                    │
│  bridge corriendo  │                │  app Beacon abierta│
│                    │                │                    │
│  $ beacon pair     │                │                    │
│  ┌──────────────┐  │                │                    │
│  │ █▀▀▀▀▀▀▀▀▀▀█ │  │  cámara QR     │  + Vincular Mac    │
│  │ █  QR    █   │  │ ────────────►  │  (scanner)         │
│  │ █  Beacon █  │  │                │                    │
│  │ ▀▀▀▀▀▀▀▀▀▀▀▀ │  │                │  ✓ Pareado:        │
│  └──────────────┘  │                │    Mac Trabajo     │
└────────────────────┘                └────────────────────┘
```

## QR payload

El QR codifica una URL `beacon://pair?p=<base64url-json>` con este JSON:

```json
{
  "v":     1,
  "host":  "your-mac.tail-XXXXXX.ts.net",
  "port":  7890,
  "token": "<base64url-token-from-~/.beacon/token>",
  "name":  "Your Mac",
  "fp":    ""
}
```

- **`v`**: versión del schema (ahora 1)
- **`host`**: hostname Tailscale (MagicDNS) si está autenticado, o hostname local si no
- **`port`**: puerto del bridge (default 7890)
- **`token`**: leído de `~/.beacon/token` — token único por Mac
- **`name`**: nombre display
- **`fp`**: TLS fingerprint pinning, reservado para S9

## Seguridad

- **Token único por bridge**. Si pareas 3 Macs, tienes 3 tokens distintos guardados en el móvil. Revocas uno y los otros siguen.
- **Token cifrado en device**. La app móvil guarda los tokens vía `tauri-plugin-store` (que en Android usa MasterKey + AndroidKeyStore).
- **Tailscale**: el bridge escucha en `0.0.0.0:7890`, pero como solo está expuesto a tu tailnet, nadie fuera de tu cuenta Tailscale puede llegar.
- **Sin TLS aún** (v0.1): la red Tailscale ya está cifrada de extremo a extremo (WireGuard). En S9 añadimos pinning para defensa en profundidad.

## Re-emparejar

Si rotas el token (borras `~/.beacon/token`), tienes que volver a parear. El bridge regenera el token la próxima vez que arranca.

## Múltiples móviles

Como el bridge solo guarda el token, no distingue entre devices que se conectan con ese mismo token. Si quieres pares por dispositivo, en S9 añadimos tokens por device-id que se generan al escanear (el bridge genera uno nuevo en `/api/pair` y devuelve token+device_id firmados).
