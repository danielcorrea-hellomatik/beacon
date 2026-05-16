import type { Device, Session, SessionEvent, DeviceStats, DailyBreakdown } from './types';

/**
 * Cliente API del bridge. Cada Device tiene su propio host+token,
 * así que los métodos toman el Device como primer argumento.
 *
 * En desarrollo sin device real, los componentes pueden usar lib/mock.ts.
 */

function url( d: Device, path: string ): string {
  const proto = d.host.endsWith( '.ts.net' ) || d.host.startsWith( '10.' ) || d.host.startsWith( '100.' )
    ? 'http' : 'http';
  return `${proto}://${d.host}:${d.port}${path}`;
}

async function get<T>( d: Device, path: string ): Promise<T> {
  const r = await fetch( url( d, path ), {
    headers: { 'X-Beacon-Token': d.token }
  } );
  if( !r.ok ) throw new Error( `${r.status} ${r.statusText}` );
  return r.json() as Promise<T>;
}

async function post<T>( d: Device, path: string, body: unknown ): Promise<T> {
  const r = await fetch( url( d, path ), {
    method:  'POST',
    headers: {
      'X-Beacon-Token': d.token,
      'Content-Type':   'application/json'
    },
    body: JSON.stringify( body )
  } );
  if( !r.ok ) throw new Error( `${r.status} ${r.statusText}` );
  return r.json() as Promise<T>;
}

export async function ping( d: Device ): Promise<boolean> {
  try
  {
    const r = await fetch( url( d, '/healthz' ), { signal: AbortSignal.timeout( 2_000 ) } );
    return r.ok;
  }
  catch
  {
    return false;
  }
}

export const list_sessions   = ( d: Device, status?: string ) => get<Session[]>( d, `/api/sessions${ status ? `?status=${status}` : '' }` );
export const get_session     = ( d: Device, id: string )      => get<Session>( d, `/api/sessions/${id}` );
export const list_events     = ( d: Device, id: string, since: number = 0 ) => get<SessionEvent[]>( d, `/api/sessions/${id}/events?since=${since}` );
export const send_prompt     = ( d: Device, id: string, prompt: string )    => post<{ ok: boolean; queue_id: number }>( d, `/api/sessions/${id}/send`, { prompt } );
export const kill_session    = ( d: Device, id: string )      => post<{ ok: boolean; error?: string }>( d, `/api/sessions/${id}/kill`, {} );
export const get_stats       = ( d: Device )                  => get<{ local: DeviceStats; ccusage: unknown }>( d, `/api/stats` );
export const get_daily_by_model = ( d: Device )               => get<DailyBreakdown>( d, `/api/stats/daily-by-model` );

export function open_stream( d: Device, on_event: ( msg: Record<string, unknown> ) => void ): WebSocket {
  const proto = 'ws';
  const ws = new WebSocket( `${proto}://${d.host}:${d.port}/stream?token=${encodeURIComponent( d.token )}` );
  ws.addEventListener( 'message', ( e ) => {
    try { on_event( JSON.parse( e.data ) ); } catch {}
  } );
  return ws;
}
