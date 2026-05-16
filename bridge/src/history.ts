/*
  Importa el historial completo de una sesión desde el JSONL de Claude Code
  (~/.claude/projects/<proyecto>/<sid>.jsonl) y lo persiste como events en
  nuestra DB, para que la UI vea TODO el timeline aunque la sesión empezara
  antes de instalar los hooks.

  Mapeo JSONL → eventos internos:
    type='system' subtype='init'          → SessionStart
    type='user'   content=string          → UserPromptSubmit
    type='user'   content=[{tool_result}] → PostToolUse
    type='user'   content=[{text}]        → UserPromptSubmit
    type='assistant' content=[{tool_use}] → PreToolUse (uno por tool_use)
    type='assistant' content=[{text}]     → ignorado (no representamos texto
                                            del assistant en el timeline)

  Tokens reales se acumulan desde message.usage:
    input_tokens + cache_read_input_tokens + cache_creation_input_tokens → tokens_in
    output_tokens                                                        → tokens_out

  Idempotente: si la sesión ya tiene >5 events en DB, asume ya importada.
  Para forzar reimport llamar a clear_session_events() primero.
*/

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { db } from './db.ts';

const PROJECTS_DIR = process.env.BEACON_CLAUDE_PROJECTS_DIR
  ?? join( homedir(), '.claude', 'projects' );

type JsonlEntry = {
  type?:        string;
  subtype?:     string;
  timestamp?:   string;
  cwd?:         string;
  model?:       string;
  message?: {
    role?:    string;
    content?: string | Array<Record<string, unknown>>;
    usage?: {
      input_tokens?:               number;
      output_tokens?:              number;
      cache_read_input_tokens?:    number;
      cache_creation_input_tokens?: number;
    };
  };
};

type MappedEvent = {
  type:       string;
  tool_name:  string;
  ts:         number;
  payload:    Record<string, unknown>;
};

const insertEventStmt = db.prepare( `
  insert into events ( session_id, ts, type, tool_name, payload_json )
  values ( $session_id, $ts, $type, $tool_name, $payload )
` );

const updateTokensStmt = db.prepare( `
  update sessions set tokens_in = $tin, tokens_out = $tout where id = $id
` );

const updateSessionMetaStmt = db.prepare( `
  update sessions set
    model        = case when model = '' then $model else model end,
    cwd          = case when cwd = '' then $cwd else cwd end,
    prompt_first = case when prompt_first = '' then $prompt else prompt_first end
  where id = $id
` );

async function find_jsonl_path( session_id: string ): Promise<string | null> {
  if( !existsSync( PROJECTS_DIR ) ) return null;
  const projects = await readdir( PROJECTS_DIR );
  for( const proj of projects )
  {
    const candidate = join( PROJECTS_DIR, proj, session_id + '.jsonl' );
    if( existsSync( candidate ) ) return candidate;
  }
  return null;
}

function extract_text( content: unknown ): string {
  if( typeof content === 'string' ) return content;
  if( Array.isArray( content ) )
  {
    const parts: string[] = [];
    for( const b of content )
    {
      if( typeof b === 'string' ) parts.push( b );
      else if( b && typeof b === 'object' )
      {
        const t = ( b as { type?: string; text?: string; content?: unknown } );
        if( t.type === 'text' && t.text ) parts.push( t.text );
        else if( t.content !== undefined ) parts.push( extract_text( t.content ) );
      }
    }
    return parts.join( ' ' );
  }
  return '';
}

function map_entry( ev: JsonlEntry, base_ts: number, offset: number ): MappedEvent[] {
  const ts = ev.timestamp ? new Date( ev.timestamp ).getTime() : base_ts + offset;
  const out: MappedEvent[] = [];

  if( ev.type === 'summary' ) return out;

  if( ev.type === 'system' && ev.subtype === 'init' )
  {
    out.push( {
      type: 'SessionStart',
      tool_name: '',
      ts,
      payload: { cwd: ev.cwd ?? '', model: ev.model ?? '' }
    } );
    return out;
  }

  const msg = ev.message;
  if( !msg ) return out;

  if( msg.role === 'user' || ev.type === 'user' )
  {
    if( typeof msg.content === 'string' )
    {
      out.push( {
        type: 'UserPromptSubmit',
        tool_name: '',
        ts,
        payload: { prompt: msg.content.slice( 0, 4000 ) }
      } );
    }
    else if( Array.isArray( msg.content ) )
    {
      for( const block of msg.content )
      {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; text?: string };
        if( b.type === 'tool_result' )
        {
          out.push( {
            type: 'PostToolUse',
            tool_name: '',
            ts,
            payload: { tool_use_id: b.tool_use_id, tool_output: extract_text( b.content ).slice( 0, 600 ) }
          } );
        }
        else if( b.type === 'text' && b.text )
        {
          out.push( {
            type: 'UserPromptSubmit',
            tool_name: '',
            ts,
            payload: { prompt: b.text.slice( 0, 4000 ) }
          } );
        }
      }
    }
  }
  else if( msg.role === 'assistant' || ev.type === 'assistant' )
  {
    if( Array.isArray( msg.content ) )
    {
      for( const block of msg.content )
      {
        const b = block as { type?: string; id?: string; name?: string; input?: unknown };
        if( b.type === 'tool_use' )
        {
          out.push( {
            type: 'PreToolUse',
            tool_name: b.name ?? '',
            ts,
            payload: { tool_use_id: b.id, tool_input: b.input ?? {} }
          } );
        }
      }
    }
  }

  return out;
}

export type ImportResult = {
  imported:    number;
  tokens_in:   number;
  tokens_out:  number;
  skipped:     boolean;
};

export async function import_session_history(
  session_id: string,
  opts: { force?: boolean } = {}
): Promise<ImportResult> {
  const existing = ( db.prepare( 'select count(*) c from events where session_id = ?' ).get( session_id ) as { c: number } ).c;
  if( existing > 5 && !opts.force )
    return { imported: 0, tokens_in: 0, tokens_out: 0, skipped: true };

  const path = await find_jsonl_path( session_id );
  if( !path ) return { imported: 0, tokens_in: 0, tokens_out: 0, skipped: true };

  if( opts.force )
    db.prepare( 'delete from events where session_id = ?' ).run( session_id );

  let content: string;
  try { content = await readFile( path, 'utf8' ); }
  catch { return { imported: 0, tokens_in: 0, tokens_out: 0, skipped: true }; }

  const file_mtime = ( await stat( path ) ).mtimeMs;
  const lines = content.split( '\n' );
  const base_ts = Date.now() - lines.length * 1000;     // fallback si no hay timestamp

  let tokens_in = 0;
  let tokens_out = 0;
  let imported = 0;
  let first_prompt = '';
  let model = '';
  let cwd = '';

  for( let i = 0; i < lines.length; i++ )
  {
    const line = lines[ i ].trim();
    if( !line ) continue;
    let ev: JsonlEntry;
    try { ev = JSON.parse( line ); }
    catch { continue; }

    const mapped = map_entry( ev, base_ts, i * 10 );
    for( const m of mapped )
    {
      insertEventStmt.run( {
        $session_id: session_id,
        $ts:         Math.round( m.ts ),
        $type:       m.type,
        $tool_name:  m.tool_name,
        $payload:    JSON.stringify( m.payload )
      } );
      imported += 1;

      if( m.type === 'UserPromptSubmit' && !first_prompt )
        first_prompt = String( ( m.payload as { prompt?: string } ).prompt ?? '' );

      if( m.type === 'SessionStart' )
      {
        const p = m.payload as { model?: string; cwd?: string };
        if( p.model && !model ) model = p.model;
        if( p.cwd && !cwd )     cwd = p.cwd;
      }
    }

    // Acumular tokens del usage
    const u = ev.message?.usage;
    if( u )
    {
      tokens_in  += ( u.input_tokens ?? 0 ) + ( u.cache_read_input_tokens ?? 0 ) + ( u.cache_creation_input_tokens ?? 0 );
      tokens_out += ( u.output_tokens ?? 0 );
    }
  }

  // Persistir tokens + metadata
  updateTokensStmt.run( { $tin: tokens_in, $tout: tokens_out, $id: session_id } );
  updateSessionMetaStmt.run( {
    $id:     session_id,
    $model:  model,
    $cwd:    cwd,
    $prompt: first_prompt.slice( 0, 500 )
  } );

  // Mark last_event_at con mtime real del archivo
  db.prepare( 'update sessions set last_event_at = ? where id = ?' )
    .run( Math.round( file_mtime ), session_id );

  return { imported, tokens_in, tokens_out, skipped: false };
}
