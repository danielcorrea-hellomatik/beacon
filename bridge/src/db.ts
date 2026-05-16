import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = process.env.BEACON_DB_PATH || join( homedir(), '.beacon', 'data.db' );
const SCHEMA_PATH = new URL( './schema.sql', import.meta.url ).pathname;

mkdirSync( dirname( DB_PATH ), { recursive: true } );

export const db = new Database( DB_PATH, { create: true } );
db.exec( 'pragma journal_mode = wal;' );
db.exec( 'pragma foreign_keys = on;' );
db.exec( readFileSync( SCHEMA_PATH, 'utf8' ) );

// Limpiar spawns huérfanos al boot — los PIDs de runs anteriores ya no son válidos
db.exec( 'delete from active_spawns' );

export type SessionRow = {
  id: string;
  cwd: string;
  status: 'working' | 'idle' | 'needs_input' | 'ended' | 'unknown';
  model: string;
  channel: string;
  started_at: number;
  last_event_at: number;
  ended_at: number | null;
  prompt_first: string;
  tokens_in: number;
  tokens_out: number;
  events_count: number;
};

export type EventRow = {
  id: number;
  session_id: string;
  ts: number;
  type: string;
  tool_name: string;
  payload_json: string;
};

const upsertSessionStmt = db.prepare( `
  insert into sessions ( id, cwd, status, model, channel, started_at, last_event_at, prompt_first )
  values ( $id, $cwd, $status, $model, $channel, $now, $now, $prompt )
  on conflict( id ) do update set
    last_event_at = $now,
    status        = coalesce( $status_update, status ),
    cwd           = coalesce( nullif( $cwd, '' ), cwd ),
    model         = coalesce( nullif( $model, '' ), model ),
    channel       = coalesce( nullif( $channel, '' ), channel ),
    prompt_first  = case when prompt_first = '' then $prompt else prompt_first end,
    events_count  = events_count + 1
` );

const insertEventStmt = db.prepare( `
  insert into events ( session_id, ts, type, tool_name, payload_json )
  values ( $session_id, $ts, $type, $tool_name, $payload )
` );

const setStatusStmt = db.prepare( `
  update sessions
  set status = $status, last_event_at = $ts, ended_at = $ended_at
  where id = $session_id
` );

export function record_event(
  session_id: string,
  type: string,
  payload: Record<string, unknown>
): { session: SessionRow; event_id: number } {
  const now = Date.now();
  const cwd = String( payload.cwd ?? '' );
  const model = String( ( payload as { model?: string } ).model ?? '' );
  const channel = String( ( payload as { channel?: string } ).channel ?? '' );
  const tool_name = String( ( payload as { tool_name?: string } ).tool_name ?? '' );
  const user_prompt = type === 'UserPromptSubmit'
    ? String( ( payload as { prompt?: string } ).prompt ?? '' ).slice( 0, 500 )
    : '';

  let next_status: SessionRow['status'] | null = null;
  let ended_at: number | null = null;
  switch( type ) {
    case 'SessionStart':       next_status = 'idle';        break;
    case 'UserPromptSubmit':   next_status = 'working';     break;
    case 'PreToolUse':         next_status = 'working';     break;
    case 'PostToolUse':        next_status = 'working';     break;
    case 'Notification':       next_status = 'needs_input'; break;
    case 'Stop':               next_status = 'idle';        break;
    case 'SessionEnd':         next_status = 'ended'; ended_at = now; break;
  }

  upsertSessionStmt.run( {
    $id:            session_id,
    $cwd:           cwd,
    $status:        next_status ?? 'unknown',
    $status_update: next_status,
    $model:         model,
    $channel:       channel,
    $now:           now,
    $prompt:        user_prompt
  } );

  if( next_status )
  {
    setStatusStmt.run( {
      $session_id: session_id,
      $status:     next_status,
      $ts:         now,
      $ended_at:   ended_at
    } );
  }

  const result = insertEventStmt.run( {
    $session_id: session_id,
    $ts:         now,
    $type:       type,
    $tool_name:  tool_name,
    $payload:    JSON.stringify( payload )
  } );

  const session = db.prepare( 'select * from sessions where id = ?' ).get( session_id ) as SessionRow;
  return { session, event_id: Number( result.lastInsertRowid ) };
}

export function list_sessions( opts: { status?: string; limit?: number } = {} ): SessionRow[] {
  let sql = 'select * from sessions';
  const params: Array<string | number> = [];
  if( opts.status )
  {
    sql += ' where status = ?';
    params.push( opts.status );
  }
  sql += ' order by last_event_at desc limit ?';
  params.push( opts.limit ?? 100 );
  return db.prepare( sql ).all( ...params ) as SessionRow[];
}

export function get_session( id: string ): SessionRow | null {
  return ( db.prepare( 'select * from sessions where id = ?' ).get( id ) as SessionRow ) || null;
}

export function list_events( session_id: string, since: number = 0, limit: number = 500 ): EventRow[] {
  return db
    .prepare( 'select * from events where session_id = ? and ts > ? order by ts asc limit ?' )
    .all( session_id, since, limit ) as EventRow[];
}

export function queue_prompt( session_id: string, prompt: string ): number {
  const r = db.prepare( `
    insert into queued_prompts ( session_id, prompt, queued_at )
    values ( ?, ?, ? )
  ` ).run( session_id, prompt, Date.now() );
  return Number( r.lastInsertRowid );
}

export function pending_prompts( session_id: string ): Array<{ id: number; prompt: string }> {
  return db
    .prepare( 'select id, prompt from queued_prompts where session_id = ? and delivered_at is null order by queued_at asc' )
    .all( session_id ) as Array<{ id: number; prompt: string }>;
}

export function mark_prompt_delivered( id: number, error: string = '' ): void {
  db.prepare( 'update queued_prompts set delivered_at = ?, error = ? where id = ?' )
    .run( Date.now(), error, id );
}

export function log_notification( session_id: string, kind: string, title: string, body: string, sent: boolean ): void {
  db.prepare( `
    insert into notifications_log ( session_id, ts, kind, title, body, sent_to_ntfy )
    values ( ?, ?, ?, ?, ?, ? )
  ` ).run( session_id, Date.now(), kind, title, body, sent ? 1 : 0 );
}

export function set_config( key: string, value: string ): void {
  db.prepare( `
    insert into config ( key, value, updated_at )
    values ( ?, ?, ? )
    on conflict( key ) do update set value = excluded.value, updated_at = excluded.updated_at
  ` ).run( key, value, Date.now() );
}

export function get_config( key: string ): string | null {
  const row = db.prepare( 'select value from config where key = ?' ).get( key ) as { value: string } | undefined;
  return row?.value ?? null;
}

// ─── Active spawns (PID tracking para kill switch) ─────────────────────────
export function register_spawn( session_id: string, pid: number ): void {
  db.prepare( `
    insert into active_spawns ( session_id, pid, started_at )
    values ( ?, ?, ? )
    on conflict( session_id ) do update set
      pid = excluded.pid,
      started_at = excluded.started_at
  ` ).run( session_id, pid, Date.now() );
}

export function unregister_spawn( session_id: string ): void {
  db.prepare( 'delete from active_spawns where session_id = ?' ).run( session_id );
}

export function get_spawn_pid( session_id: string ): number | null {
  const row = db.prepare( 'select pid from active_spawns where session_id = ?' ).get( session_id ) as { pid: number } | undefined;
  return row?.pid ?? null;
}

// ─── Pending approvals ─────────────────────────────────────────────────────
export function create_approval( session_id: string, question: string ): number {
  const r = db.prepare( `
    insert into pending_approvals ( session_id, ts, question )
    values ( ?, ?, ? )
  ` ).run( session_id, Date.now(), question );
  return Number( r.lastInsertRowid );
}

export function respond_approval( id: number, response: string ): void {
  db.prepare( 'update pending_approvals set response = ?, responded_at = ? where id = ?' )
    .run( response, Date.now(), id );
}

export function get_pending_approval( session_id: string ): { id: number; question: string } | null {
  const row = db.prepare( `
    select id, question from pending_approvals
    where session_id = ? and responded_at is null
    order by ts desc limit 1
  ` ).get( session_id ) as { id: number; question: string } | undefined;
  return row ?? null;
}
