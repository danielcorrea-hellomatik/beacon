import { writable, get } from 'svelte/store';
import type { Device } from './types.ts';
import { ping } from './api.ts';

declare const __BEACON_DEFAULT__: {
  host:  string;
  port:  number;
  token: string;
  name:  string;
};

const STORAGE_KEY_DEVICES = 'beacon.devices.v1';
const STORAGE_KEY_SETTINGS = 'beacon.settings.v1';

function load_persistent<T>( key: string, fallback: T ): T {
  try
  {
    const raw = localStorage.getItem( key );
    if( !raw ) return fallback;
    return JSON.parse( raw ) as T;
  }
  catch
  {
    return fallback;
  }
}

function save_persistent<T>( key: string, value: T ): void {
  try { localStorage.setItem( key, JSON.stringify( value ) ); } catch {}
}

// ─── Devices ────────────────────────────────────────────────────────────────
export const devices = writable<Device[]>( load_persistent<Device[]>( STORAGE_KEY_DEVICES, [] ) );
devices.subscribe( ( ds ) => save_persistent( STORAGE_KEY_DEVICES, ds ) );

export function add_device( d: Device ): void {
  devices.update( list => {
    const idx = list.findIndex( x => x.id === d.id );
    if( idx >= 0 ) { list[ idx ] = d; return [ ...list ]; }
    return [ ...list, d ];
  } );
}

export function remove_device( id: string ): void {
  devices.update( list => list.filter( d => d.id !== id ) );
}

export function get_device( id: string ): Device | undefined {
  return get( devices ).find( d => d.id === id );
}

// ─── Settings ──────────────────────────────────────────────────────────────
export type Settings = {
  biometric_enabled:  boolean;
  voice_lang:         string;
  idle_threshold_s:   number;
  fg_service_enabled: boolean;
  plan_usd:           number;
  quiet_hours_start:  number;
  quiet_hours_end:    number;
};

const DEFAULT_SETTINGS: Settings = {
  biometric_enabled:  true,
  voice_lang:         'es-ES',
  idle_threshold_s:   60,
  fg_service_enabled: true,
  plan_usd:           0,
  quiet_hours_start:  22,
  quiet_hours_end:    7
};

export const settings = writable<Settings>( load_persistent( STORAGE_KEY_SETTINGS, DEFAULT_SETTINGS ) );
settings.subscribe( ( s ) => save_persistent( STORAGE_KEY_SETTINGS, s ) );

// ─── Default device inyectado en compile time ──────────────────────────────
/**
 * Si el APK fue compilado con `BEACON_DEFAULT_HOST` etc. en env, el primer
 * arranque registra ese device automáticamente. Idempotente: si ya existe
 * un device con el mismo id (basado en host), no duplica.
 *
 * Para activarlo:
 *   BEACON_DEFAULT_HOST=mac.tail-xxx.ts.net \
 *   BEACON_DEFAULT_TOKEN=<token> \
 *   BEACON_DEFAULT_NAME="Mi Mac" \
 *   bunx tauri android build --apk --target aarch64
 */
export function auto_add_default_device(): Device | null {
  try
  {
    const d = ( typeof __BEACON_DEFAULT__ !== 'undefined' ) ? __BEACON_DEFAULT__ : null;
    if( !d || !d.host || !d.token ) return null;

    const id = 'default-' + d.host.replace( /[^a-z0-9]/gi, '-' ).toLowerCase();
    const existing = get( devices ).find( x => x.id === id );
    if( existing ) return existing;

    const device: Device = {
      id,
      host:      d.host,
      port:      d.port || 7890,
      token:     d.token,
      name:      d.name || d.host,
      online:    false,
      last_seen: Date.now()
    };
    add_device( device );
    return device;
  }
  catch
  {
    return null;
  }
}

// ─── Auto-discovery del bridge local (sólo en dev) ─────────────────────────
/**
 * Cuando la app corre en localhost:1420 (modo dev), intentamos descubrir
 * el bridge local. Llama a /dev-token (sólo accesible desde loopback) y
 * registra el device automáticamente. Idempotente: si ya está pareado, refresca.
 */
export async function auto_discover_local_bridge(): Promise<Device | null> {
  if( typeof window === 'undefined' ) return null;
  // Sólo intentamos auto-discovery en dev (localhost / 127.x)
  const host = window.location.hostname;
  const is_local_dev = host === 'localhost' || host === '127.0.0.1' || host.startsWith( '192.168.' );
  if( !is_local_dev ) return null;

  try
  {
    const res = await fetch( 'http://localhost:7890/dev-token', { signal: AbortSignal.timeout( 1_500 ) } );
    if( !res.ok ) return null;
    const cfg = await res.json() as { host: string; port: number; token: string; name: string; ntfy_topic: string };

    const device: Device = {
      id:         'local-' + cfg.name.toLowerCase().replace( /[^a-z0-9]/g, '-' ),
      host:       'localhost',
      port:       cfg.port,
      token:      cfg.token,
      name:       cfg.name + ' (local)',
      online:     true,
      last_seen:  Date.now(),
      ntfy_topic: cfg.ntfy_topic
    };

    add_device( device );
    return device;
  }
  catch
  {
    return null;
  }
}

/**
 * Refresca el estado online/offline de todos los devices haciendo healthz.
 */
export async function refresh_devices_status(): Promise<void> {
  const list = get( devices );
  await Promise.all( list.map( async ( d ) => {
    const ok = await ping( d );
    if( ok !== d.online || ok ) {
      devices.update( ds => {
        const idx = ds.findIndex( x => x.id === d.id );
        if( idx < 0 ) return ds;
        ds[ idx ] = { ...d, online: ok, last_seen: ok ? Date.now() : d.last_seen };
        return [ ...ds ];
      } );
    }
  } ) );
}
