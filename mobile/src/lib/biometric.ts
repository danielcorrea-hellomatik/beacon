/**
 * Biometric gate para acciones críticas (send_prompt, kill, approve).
 *
 * En Tauri Android usamos tauri-plugin-biometric (huella/face).
 * En el browser usamos WebAuthn como fallback para dev/testing.
 * Si nada está disponible, se aprueba automáticamente (UX > fricción en dev).
 *
 * Settings.svelte controla si el gate está activo (toggle).
 */

import { get } from 'svelte/store';
import { settings } from './stores.ts';

async function tauri_biometric_check( reason: string ): Promise<boolean> {
  try
  {
    const mod = await import( '@tauri-apps/plugin-biometric' );
    await mod.authenticate( reason, {
      allowDeviceCredential: true,
      cancelTitle:           'Cancelar',
      fallbackTitle:         'Usar PIN',
      title:                 'Beacon',
      subtitle:              'Confirma la acción',
      confirmationRequired:  true
    } );
    return true;
  }
  catch
  {
    return false;
  }
}

async function webauthn_fallback(): Promise<boolean> {
  // En dev (browser sin Tauri), usamos prompt nativo. Aprobamos siempre que
  // el user clickee OK. WebAuthn real requiere registrar credenciales primero.
  return confirm( 'Confirma esta acción' );
}

export async function require_biometric( reason: string ): Promise<boolean> {
  const cfg = get( settings );
  if( !cfg.biometric_enabled ) return true;

  const is_tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return is_tauri ? tauri_biometric_check( reason ) : webauthn_fallback();
}
