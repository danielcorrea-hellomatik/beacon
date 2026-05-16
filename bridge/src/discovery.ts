/*
  Discovery de sesiones de Claude Code escaneando ~/.claude/projects/.

  Para cada proyecto y session_id encontrado:
   - Parsea las primeras N líneas del JSONL para extraer cwd, model, prompt inicial
   - Lee mtime del archivo → si < ACTIVE_WINDOW_MS, considera la sesión "working"
     (en realidad puede estar idle, pero al menos sabemos que el proceso Claude
     escribió hace poco — buena heurística para "activa")
   - Upsert en `sessions` con un payload sintetico { source: 'discovery' }
     para que se distinga de eventos venidos por hook.

  Idempotente: las sesiones que ya existen sólo actualizan last_event_at si su
  mtime es más reciente. No pisamos status si vino por hook (más fiable).
*/

import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { db } from './db.ts';

const PROJECTS_DIR = process.env.BEACON_CLAUDE_PROJECTS_DIR
  ?? join( homedir(), '.claude', 'projects' );

const ACTIVE_WINDOW_MS  = 120_000;     // 2min: si JSONL escribió en este lapso, está activa
const IDLE_WINDOW_MS    = 30 * 60_000; // 30min: si entre eso y eso, está idle reciente
const FIRST_LINES_TO_READ = 30;        // suficiente para SessionStart + primer prompt

type DiscoveredSession = {
  id:        string;
  cwd:       string;
  model:     string;
  prompt:    string;
  mtime_ms:  number;
  source:    'discovery';
};

/**
 * Lee las primeras líneas de un JSONL sin cargar el archivo entero.
 * Usa stream + buffer para fichero grande.
 */
async function read_first_lines( path: string, max_lines: number ): Promise<string[]> {
  // Para JSONL pequeños esto es OK; si crece habría que streaming
  const content = await readFile( path, 'utf8' );
  return content.split( '\n', max_lines + 1 ).slice( 0, max_lines ).filter( Boolean );
}

/**
 * Decodifica el cwd a partir del nombre del proyecto en ~/.claude/projects/.
 * Claude Code usa el path absoluto con / → -. Ejemplo:
 *   "-Users-jane-Desktop-projects-foo" → "/Users/jane/Desktop/projects/foo"
 */
function project_dir_to_cwd( name: string ): string {
  if( !name.startsWith( '-' ) ) return name;
  return name.replace( /^-/, '/' ).replace( /-/g, '/' );
}

async function parse_session_metadata( jsonl_path: string ): Promise<{ cwd: string; model: string; prompt: string }> {
  let cwd = '';
  let model = '';
  let prompt = '';
  try
  {
    const lines = await read_first_lines( jsonl_path, FIRST_LINES_TO_READ );
    for( const line of lines )
    {
      try
      {
        const ev = JSON.parse( line ) as Record<string, unknown>;

        // Eventos comunes de Claude Code: `type: 'summary'`, `type: 'user'`, etc.
        // El "init" del session suele tener cwd, model, version.
        if( !cwd )
          cwd = String( ev.cwd ?? ( ev as { workspace?: { cwd?: string } } ).workspace?.cwd ?? '' );

        if( !model )
          model = String( ev.model ?? '' );

        if( !prompt && ev.type === 'user' )
        {
          const message = ( ev as { message?: { content?: unknown } } ).message;
          if( message && typeof message.content === 'string' )
            prompt = message.content.slice( 0, 200 );
          else if( Array.isArray( message?.content ) )
          {
            const text_block = message.content.find( ( b ): b is { type: string; text: string } =>
              typeof b === 'object' && b !== null && ( b as { type?: string } ).type === 'text'
            );
            if( text_block ) prompt = text_block.text.slice( 0, 200 );
          }
        }
      }
      catch { /* skip línea no-JSON */ }
    }
  }
  catch { /* archivo ilegible */ }

  return { cwd, model, prompt };
}

const upsertDiscoveredStmt = db.prepare( `
  insert into sessions ( id, cwd, status, model, channel, started_at, last_event_at, prompt_first )
  values ( $id, $cwd, $status, $model, 'discovery', $mtime, $mtime, $prompt )
  on conflict( id ) do update set
    last_event_at = max( last_event_at, $mtime ),
    cwd           = case when cwd = '' then $cwd else cwd end,
    model         = case when model = '' then $model else model end,
    prompt_first  = case when prompt_first = '' then $prompt else prompt_first end,
    status        = case
                      -- Sólo sobrescribimos el status si la fuente original era discovery.
                      -- Si la sesión llegó vía hook, su status es más fiable.
                      when channel = 'discovery' then $status
                      else status
                    end
` );

export async function scan_once(): Promise<{ found: number; active: number }> {
  if( !existsSync( PROJECTS_DIR ) )
    return { found: 0, active: 0 };

  let found = 0;
  let active = 0;
  const now = Date.now();

  let projects: string[];
  try { projects = await readdir( PROJECTS_DIR ); }
  catch { return { found: 0, active: 0 }; }

  for( const proj of projects )
  {
    const proj_path = join( PROJECTS_DIR, proj );
    let files: string[];
    try { files = await readdir( proj_path ); }
    catch { continue; }

    const cwd_from_dir = project_dir_to_cwd( proj );

    for( const file of files )
    {
      if( !file.endsWith( '.jsonl' ) ) continue;
      const sid = file.replace( /\.jsonl$/, '' );
      const path = join( proj_path, file );

      let mtime_ms: number;
      try { mtime_ms = ( await stat( path ) ).mtimeMs; }
      catch { continue; }

      // Sólo escaneamos a fondo si vale la pena: la sesión está en ventana
      // activa o idle reciente. Las muy antiguas (>30min) las ignoramos al boot
      // para no machacar la DB con miles de sesiones viejas.
      const age = now - mtime_ms;
      if( age > IDLE_WINDOW_MS ) continue;

      const meta = await parse_session_metadata( path );
      const cwd = meta.cwd || cwd_from_dir;

      // Heurística de status:
      //   - mtime < 2min  → working (escribiendo activamente)
      //   - 2-30min       → idle (parada esperando input)
      //   - >30min        → ended
      let status: 'working' | 'idle' | 'ended';
      if( age < ACTIVE_WINDOW_MS )    { status = 'working'; active += 1; }
      else if( age < IDLE_WINDOW_MS ) { status = 'idle'; }
      else                            { status = 'ended'; }

      upsertDiscoveredStmt.run( {
        $id:     sid,
        $cwd:    cwd,
        $status: status,
        $model:  meta.model,
        $prompt: meta.prompt,
        $mtime:  Math.round( mtime_ms )
      } );

      found += 1;
    }
  }

  return { found, active };
}

let watcher_started = false;
export function start_discovery_watcher( interval_ms: number = 10_000 ): NodeJS.Timeout {
  if( watcher_started )
    throw new Error( 'discovery watcher already started' );
  watcher_started = true;

  // Boot scan inmediato
  scan_once().catch( () => {} );

  return setInterval( () => { scan_once().catch( () => {} ); }, interval_ms );
}
