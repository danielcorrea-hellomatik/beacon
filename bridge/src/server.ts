import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { upgradeWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import { hostname } from 'node:os';

import {
  get_session,
  list_events,
  list_sessions,
  queue_prompt,
  record_event,
  set_config,
  create_approval,
  respond_approval,
  get_pending_approval,
  db
} from './db.ts';

// Query helper local — última entrada de queued_prompts por sesión
const db_query_last_queued = ( session_id: string ) => {
  return db.prepare( `
    select id, prompt, queued_at, delivered_at, error
    from queued_prompts
    where session_id = ?
    order by id desc limit 1
  ` ).get( session_id );
};
import {
  compute_global_stats,
  compute_global_stats_instant,
  load_ccusage_stats,
  load_daily_by_model,
  load_daily_by_model_instant,
  type DailyBreakdown
} from './stats.ts';
import { load_ccusage_raw } from './ccusage-loader.ts';
import { flush_queue, kill_session } from './spawn.ts';
import { push, get_or_create_topic } from './ntfy.ts';
import { load_or_create_token } from './auth.ts';
import { start_idle_watcher } from './idle-watcher.ts';
import { compute_burndown } from './burndown.ts';
import { start_discovery_watcher, scan_once } from './discovery.ts';
import { cached, prime, peek } from './cache.ts';
import { import_session_history } from './history.ts';

const PORT = Number( process.env.BEACON_PORT ?? 7890 );
const HOST = process.env.BEACON_HOST ?? '0.0.0.0';
const TOKEN = load_or_create_token();
const NTFY_TOPIC = get_or_create_topic();

const app = new Hono();
app.use( '*', cors() );

// ─── Auth middleware ─────────────────────────────────────────────────────────
app.use( '/api/*', async ( c, next ) => {
  const provided = c.req.header( 'x-beacon-token' );
  if( provided !== TOKEN )
    return c.json( { error: 'unauthorized' }, 401 );
  return next();
} );

// ─── Healthcheck (sin auth) ──────────────────────────────────────────────────
app.get( '/healthz', ( c ) => c.json( {
  ok:           true,
  version:      '0.1.0',
  host:         hostname(),
  ntfy_topic:   NTFY_TOPIC
} ) );

// ─── Dev token (solo localhost) ──────────────────────────────────────────────
// Permite al frontend en dev (http://localhost:1420) descubrir el bridge sin
// tener que parear manualmente. En producción Android sólo se accede vía QR.
app.get( '/dev-token', ( c ) => {
  const remote = c.req.header( 'x-forwarded-for' )
              ?? c.req.header( 'x-real-ip' )
              ?? '';
  // Bun set su remote en req.raw cuando viene de fetch local
  const url = new URL( c.req.url );
  const is_loopback = remote === ''
                    || remote === '127.0.0.1'
                    || remote === '::1'
                    || url.hostname === 'localhost'
                    || url.hostname === '127.0.0.1';

  if( !is_loopback )
    return c.json( { error: 'dev-token only available from localhost' }, 403 );

  return c.json( {
    host:       'localhost',
    port:       PORT,
    token:      TOKEN,
    name:       hostname(),
    ntfy_topic: NTFY_TOPIC
  } );
} );

// ─── Hooks endpoint (auth: token estático) ───────────────────────────────────
// Llamado por ~/.claude/hooks/beacon-hook.sh con el JSON de stdin como body.
app.post( '/api/events/:type', async ( c ) => {
  const event_type = c.req.param( 'type' );
  let payload: Record<string, unknown>;
  try
  {
    payload = await c.req.json();
  }
  catch
  {
    return c.json( { error: 'invalid-json' }, 400 );
  }

  const session_id = String( payload.session_id ?? '' );
  if( !session_id )
    return c.json( { error: 'missing-session-id' }, 400 );

  const { session, event_id } = record_event( session_id, event_type, payload );

  // Push para eventos críticos
  if( event_type === 'Stop' )
  {
    const cwd = session.cwd.split( '/' ).slice( -2 ).join( '/' );
    await push( session_id, 'stop', 'Claude terminó', `${cwd}\n${session.prompt_first.slice( 0, 100 )}` );
    // Vaciar cola de prompts pendientes
    flush_queue( session_id ).catch( () => {} );
  }
  else if( event_type === 'Notification' )
  {
    const cwd = session.cwd.split( '/' ).slice( -2 ).join( '/' );
    const msg = String( payload.message ?? 'Claude necesita atención' ).slice( 0, 200 );
    // Registrar aprobación pendiente para que el móvil pueda responder
    create_approval( session_id, msg );
    await push( session_id, 'needs_input', 'Claude necesita atención', `${cwd}\n${msg}` );
  }

  // Broadcast WS
  broadcast( { kind: 'event', session_id, event_id, type: event_type, ts: Date.now() } );

  return c.json( { ok: true, event_id, session_status: session.status } );
} );

// ─── REST API ────────────────────────────────────────────────────────────────
app.get( '/api/sessions', ( c ) => {
  const status = c.req.query( 'status' ) ?? undefined;
  const limit = Number( c.req.query( 'limit' ) ?? 100 );
  return c.json( list_sessions( { status, limit } ) );
} );

app.get( '/api/sessions/:id', ( c ) => {
  const s = get_session( c.req.param( 'id' ) );
  if( !s ) return c.json( { error: 'not-found' }, 404 );
  return c.json( s );
} );

app.get( '/api/sessions/:id/events', async ( c ) => {
  const session_id = c.req.param( 'id' );
  const since = Number( c.req.query( 'since' ) ?? 0 );
  const limit = Number( c.req.query( 'limit' ) ?? 5_000 );

  // Auto-import: si la sesión tiene pocos events (discovery sin import previo)
  // o si nunca ha pasado por aquí, intentamos parsear el JSONL completo.
  // Idempotente: import_session_history skipea si ya hay >5 events.
  await import_session_history( session_id ).catch( () => {} );

  return c.json( list_events( session_id, since, limit ) );
} );

app.post( '/api/sessions/:id/import-history', async ( c ) => {
  const force = c.req.query( 'force' ) === '1';
  const r = await import_session_history( c.req.param( 'id' ), { force } );
  return c.json( r );
} );

app.post( '/api/sessions/:id/send', async ( c ) => {
  const session_id = c.req.param( 'id' );
  const body = await c.req.json().catch( () => ( {} ) ) as { prompt?: string };
  const prompt = String( body.prompt ?? '' ).trim();
  if( !prompt ) return c.json( { error: 'empty-prompt' }, 400 );

  const session = get_session( session_id );
  if( !session ) return c.json( { error: 'session-not-found' }, 404 );

  const queue_id = queue_prompt( session_id, prompt );

  // Disparamos flush en background SIEMPRE. Si la sesión está 'working',
  // claude --resume reanudará la sesión cuando termine el turno actual.
  // Si la sesión no es resumible (ej. discovery-only de un JSONL viejo),
  // el error queda en queued_prompts.error para feedback de la UI.
  flush_queue( session_id ).catch( ( err ) => {
    console.warn( `[beacon] flush_queue failed for ${ session_id }:`, ( err as Error ).message );
  } );

  return c.json( { ok: true, queue_id, session_status: session.status } );
} );

// Permite a la UI verificar si el último prompt encolado ya se entregó o falló
app.get( '/api/sessions/:id/queue-status', ( c ) => {
  const session_id = c.req.param( 'id' );
  // Usamos el db directamente para mantener este endpoint en server.ts
  const last = ( db_query_last_queued as ( s: string ) => unknown )( session_id );
  return c.json( { last } );
} );

app.post( '/api/sessions/:id/kill', ( c ) => {
  const r = kill_session( c.req.param( 'id' ) );
  return c.json( r, r.ok ? 200 : 409 );
} );

app.get( '/api/sessions/:id/pending-approval', ( c ) => {
  const a = get_pending_approval( c.req.param( 'id' ) );
  return c.json( a ?? { id: null } );
} );

app.post( '/api/sessions/:id/respond', async ( c ) => {
  const body = await c.req.json().catch( () => ( {} ) ) as { response?: string; approval_id?: number };
  const response = String( body.response ?? '' ).trim();
  if( !response ) return c.json( { error: 'empty-response' }, 400 );

  if( body.approval_id ) respond_approval( body.approval_id, response );

  // Enviar como prompt continuación a Claude
  const session_id = c.req.param( 'id' );
  const queue_id = queue_prompt( session_id, response );
  flush_queue( session_id ).catch( () => {} );

  return c.json( { ok: true, queue_id } );
} );

app.get( '/api/stats', ( c ) => {
  // Respuesta instant: si ccusage está cacheado lo combina; si no, sql-only.
  // load_ccusage_raw corre en background para próximas peticiones.
  load_ccusage_raw().catch( () => {} );
  const local = compute_global_stats_instant();
  return c.json( { local } );
} );

app.get( '/api/stats/burndown', async ( c ) => {
  const b = await cached( 'stats:burndown', 60_000, async () => compute_burndown() );
  return c.json( b );
} );

app.get( '/api/stats/daily-by-model', ( c ) => {
  // Mismo patrón instant: lee de la cache compartida de ccusage. Sin bloqueo.
  load_ccusage_raw().catch( () => {} );
  return c.json( load_daily_by_model_instant() );
} );

app.post( '/api/sessions/scan', async ( c ) => {
  const r = await scan_once();
  return c.json( { ok: true, ...r } );
} );

app.get( '/api/config', ( c ) => c.json( {
  host: hostname(),
  ntfy_topic: NTFY_TOPIC,
  ntfy_server: process.env.BEACON_NTFY_SERVER || 'https://ntfy.sh',
  plan_usd: Number( ( c.req.query( '_' ), '0' ) )
} ) );

app.post( '/api/config', async ( c ) => {
  const body = await c.req.json().catch( () => ( {} ) ) as Record<string, unknown>;
  for( const [ k, v ] of Object.entries( body ) )
    set_config( k, String( v ) );
  return c.json( { ok: true } );
} );

// ─── WebSocket /stream ───────────────────────────────────────────────────────
type WsData = { token: string };
const clients = new Set<ServerWebSocket<WsData>>();

function broadcast( msg: Record<string, unknown> ): void {
  const data = JSON.stringify( msg );
  for( const c of clients ) c.send( data );
}

app.get( '/stream', upgradeWebSocket( ( c ) => {
  const token = c.req.query( 'token' );
  if( token !== TOKEN )
  {
    return {
      onOpen: ( _evt, ws ) => ws.close( 1008, 'unauthorized' )
    };
  }
  return {
    onOpen: ( _evt, ws ) => {
      const raw = ws.raw as ServerWebSocket<WsData>;
      clients.add( raw );
      raw.send( JSON.stringify( { kind: 'hello', ts: Date.now() } ) );
    },
    onClose: ( _evt, ws ) => {
      clients.delete( ws.raw as ServerWebSocket<WsData> );
    },
    onMessage: ( _evt, _ws ) => {
      // Por ahora WS es solo server→client (broadcast). El móvil interactúa por REST.
    }
  };
} ) );

// ─── Boot ────────────────────────────────────────────────────────────────────
start_idle_watcher();
start_discovery_watcher();    // escanea ~/.claude/projects cada 10s

// Warmup: una sola carga de ccusage raw. Las stats derivadas (global, daily-by-model)
// se calculan ya en milisegundos a partir de ese raw cacheado.
( async () => {
  const t0 = Date.now();
  console.log( '[beacon] warming up ccusage cache…' );
  await load_ccusage_raw();
  console.log( `[beacon] ccusage warmup done in ${ Math.round( ( Date.now() - t0 ) / 100 ) / 10 }s` );
} )();

console.log( `[beacon] bridge listening on ${HOST}:${PORT}` );
console.log( `[beacon] ntfy topic: ${NTFY_TOPIC}` );
console.log( `[beacon] token path: ~/.beacon/token` );

export default {
  port:     PORT,
  hostname: HOST,
  fetch:    app.fetch,
  websocket: {
    open:    () => {},
    close:   () => {},
    message: () => {}
  }
};
