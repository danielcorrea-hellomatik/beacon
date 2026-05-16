import { spawn } from 'node:child_process';
import {
  mark_prompt_delivered,
  pending_prompts,
  record_event,
  register_spawn,
  unregister_spawn,
  get_spawn_pid
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

    const args = [
      '--resume', session_id,
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages'
    ];

    const proc = spawn( CLAUDE_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    } );

    if( proc.pid ) register_spawn( session_id, proc.pid );

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

    proc.on( 'close', ( code ) => {
      unregister_spawn( session_id );
      resolve( {
        ok:     code === 0,
        error:  code === 0 ? '' : ( stderr.slice( 0, 500 ) || `exit ${code}` ),
        events
      } );
    } );

    proc.on( 'error', ( err ) => {
      unregister_spawn( session_id );
      resolve( { ok: false, error: err.message, events } );
    } );
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
export async function flush_queue( session_id: string ): Promise<void> {
  const pending = pending_prompts( session_id );
  for( const item of pending )
  {
    const res = await resume_with_prompt( session_id, item.prompt, () => {} );
    mark_prompt_delivered( item.id, res.ok ? '' : res.error );
    if( !res.ok ) break;
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
