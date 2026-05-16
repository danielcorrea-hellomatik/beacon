import { spawn } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  mark_prompt_delivered,
  pending_prompts,
  record_event,
  register_spawn,
  unregister_spawn,
  get_spawn_pid,
  get_session
} from './db.ts';

const CLAUDE_BIN = process.env.BEACON_CLAUDE_BIN || 'claude';

export type SpawnResult = {
  ok: boolean;
  error: string;
  events: number;
};

/**
 * Reanuda una sesión existente con un prompt nuevo en modo headless.
 *   claude --resume <session_id> -p "<prompt>" --output-format stream-json --verbose --include-partial-messages
 *
 * Parsea stream-json en tiempo real y persiste cada evento como si fuera un hook.
 * Es la única forma documentada de "enviar un mensaje" a una sesión existente
 * sin invadir el PTY del Claude Code interactivo.
 */
export async function resume_with_prompt(
  session_id: string,
  prompt: string,
  on_event: ( ev: Record<string, unknown> ) => void
): Promise<SpawnResult> {
  return new Promise( ( resolve ) => {
    let events = 0;
    let buf = '';
    let stderr = '';

    // Estrategia:
    // 1. Intentamos `claude --resume <session_id> -p` (continúa la conversación exacta)
    // 2. Si falla con "No conversation found" o similar (sesión activa por otro proceso,
    //    o sesión vieja no resumible), fallback a `--continue` en el cwd de la sesión,
    //    que reanuda la última conversation de ese directorio.
    // 3. Si no hay cwd válido, fallback a `-p` sin resume (sesión nueva).
    const session = get_session( session_id );
    const cwd = session?.cwd && existsSync( session.cwd ) ? session.cwd : undefined;

    const args = [
      '--resume', session_id,
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions'
    ];

    const proc = spawn( CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd
    } );

    if( proc.pid ) register_spawn( session_id, proc.pid );

    // Timeout: si claude se queda bloqueado (sesión locked por otro proc, etc.)
    // matamos a los 25s. Mejor fallar rápido que dejar el queue colgado.
    const timeout = setTimeout( () => {
      try { proc.kill( 'SIGKILL' ); } catch {}
    }, 120_000 );
    proc.on( 'close', () => clearTimeout( timeout ) );

    proc.stdout.on( 'data', ( chunk: Buffer ) => {
      buf += chunk.toString( 'utf8' );
      const lines = buf.split( '\n' );
      buf = lines.pop() ?? '';
      for( const line of lines )
      {
        const trimmed = line.trim();
        if( !trimmed ) continue;
        try
        {
          const ev = JSON.parse( trimmed );
          events += 1;
          on_event( ev );
          persist_stream_event( session_id, ev );
        }
        catch
        {
          // Línea no-JSON, ignoramos
        }
      }
    } );

    proc.stderr.on( 'data', ( chunk: Buffer ) => { stderr += chunk.toString( 'utf8' ); } );

    proc.on( 'close', async ( code ) => {
      unregister_spawn( session_id );
      if( code === 0 )
      {
        resolve( { ok: true, error: '', events } );
        return;
      }

      // Fallback: --resume falló (sesión activa por otro proceso, sesión vieja, etc.)
      // Intentamos --continue en el cwd de la sesión.
      const err_msg = stderr.slice( 0, 500 ) || `exit ${code}`;
      if( cwd && ( err_msg.includes( 'No conversation found' ) || err_msg.includes( 'already in use' ) ) )
      {
        const fb = await continue_in_cwd( cwd, prompt, on_event );
        resolve( fb.ok ? fb : { ok: false, error: 'resume failed: ' + err_msg + ' | continue failed: ' + fb.error, events: events + fb.events } );
        return;
      }

      resolve( { ok: false, error: err_msg, events } );
    } );

    proc.on( 'error', ( err ) => {
      unregister_spawn( session_id );
      resolve( { ok: false, error: err.message, events } );
    } );
  } );
}

/**
 * Fallback: ejecuta `claude --continue` en un directorio concreto. Reanuda
 * la última conversación de ese cwd. Funciona cuando --resume <id> falla
 * porque la sesión está bloqueada o no la conoce Claude CLI.
 */
async function continue_in_cwd(
  cwd: string,
  prompt: string,
  on_event: ( ev: Record<string, unknown> ) => void
): Promise<SpawnResult> {
  return new Promise( ( resolve ) => {
    let events = 0;
    let buf = '';
    let stderr = '';

    const args = [
      '-p', prompt,
      '--continue',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions'
    ];

    const proc = spawn( CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd
    } );

    const timeout = setTimeout( () => {
      try { proc.kill( 'SIGKILL' ); } catch {}
    }, 120_000 );

    proc.stdout.on( 'data', ( chunk: Buffer ) => {
      buf += chunk.toString( 'utf8' );
      const lines = buf.split( '\n' );
      buf = lines.pop() ?? '';
      for( const line of lines )
      {
        const t = line.trim();
        if( !t ) continue;
        try { const ev = JSON.parse( t ); events += 1; on_event( ev ); }
        catch {}
      }
    } );

    proc.stderr.on( 'data', ( chunk: Buffer ) => { stderr += chunk.toString( 'utf8' ); } );

    proc.on( 'close', ( code ) => {
      clearTimeout( timeout );
      resolve( {
        ok:    code === 0,
        error: code === 0 ? '' : ( stderr.slice( 0, 500 ) || `exit ${code}` ),
        events
      } );
    } );

    proc.on( 'error', ( err ) => resolve( { ok: false, error: err.message, events } ) );
  } );
}

function persist_stream_event( session_id: string, ev: Record<string, unknown> ): void {
  // Mapeamos stream-json a nuestros tipos de evento internos para que el timeline del móvil sea uniforme
  const type = String( ev.type ?? '' );
  let mapped = 'StreamEvent';
  if( type === 'system' && ev.subtype === 'init' ) mapped = 'SessionStart';
  else if( type === 'assistant_message' )           mapped = 'AssistantMessage';
  else if( type === 'tool_use' )                    mapped = 'PreToolUse';
  else if( type === 'tool_result' )                 mapped = 'PostToolUse';
  else if( type === 'result' )                      mapped = 'Stop';

  record_event( session_id, mapped, ev );
}

/**
 * Worker que vacía la cola de prompts pendientes y los dispara contra Claude.
 * Llamarlo cuando recibimos Stop para esa sesión (la sesión está idle).
 */
// Locks por sesión para que dos flush_queue concurrentes (poll + send) no
// disparen claude --resume dos veces sobre la misma session.
const flushing = new Set<string>();

export async function flush_queue( session_id: string ): Promise<void> {
  if( flushing.has( session_id ) ) return;
  flushing.add( session_id );
  try
  {
    const pending = pending_prompts( session_id );
    for( const item of pending )
    {
      const res = await resume_with_prompt( session_id, item.prompt, () => {} );
      mark_prompt_delivered( item.id, res.ok ? '' : res.error );
      if( !res.ok ) break;
    }
  }
  finally
  {
    flushing.delete( session_id );
  }
}

export function kill_session( session_id: string ): { ok: boolean; error: string; pid?: number } {
  const pid = get_spawn_pid( session_id );
  if( !pid )
    return { ok: false, error: 'no-active-spawn (only sessions started by Beacon can be killed)' };

  try
  {
    process.kill( pid, 'SIGTERM' );
    // SIGKILL en 5s si sigue vivo
    setTimeout( () => {
      try { process.kill( pid, 'SIGKILL' ); } catch {}
    }, 5_000 );
    unregister_spawn( session_id );
    return { ok: true, error: '', pid };
  }
  catch( e )
  {
    unregister_spawn( session_id );
    return { ok: false, error: ( e as Error ).message };
  }
}
