import { get_config, set_config, log_notification } from './db.ts';
import { randomBytes } from 'node:crypto';

const NTFY_SERVER = process.env.BEACON_NTFY_SERVER || 'https://ntfy.sh';

export function get_or_create_topic(): string {
  let topic = get_config( 'ntfy_topic' );
  if( !topic )
  {
    topic = 'beacon-' + randomBytes( 12 ).toString( 'base64url' );
    set_config( 'ntfy_topic', topic );
  }
  return topic;
}

export type PushKind = 'stop' | 'needs_input' | 'idle';

export async function push(
  session_id: string,
  kind: PushKind,
  title: string,
  body: string
): Promise<boolean> {
  const topic = get_or_create_topic();
  const priority = kind === 'needs_input' ? '5' : kind === 'idle' ? '4' : '3';
  const deeplink = `beacon://session/${session_id}`;

  // Action buttons distintos según el tipo de evento
  let actions: string;
  if( kind === 'needs_input' )
  {
    // 3 acciones: open, allow rápido, deny rápido (via deeplink que la app intercepta)
    actions = [
      `view, Abrir, ${deeplink}, clear=true`,
      `view, ✓ Continuar, ${deeplink}?action=continue, clear=true`,
      `view, ✗ Detener, ${deeplink}?action=deny, clear=true`
    ].join( '; ' );
  }
  else if( kind === 'idle' )
  {
    actions = [
      `view, Abrir, ${deeplink}, clear=true`,
      `view, Matar, ${deeplink}?action=kill, clear=true`
    ].join( '; ' );
  }
  else
  {
    actions = `view, Abrir, ${deeplink}, clear=true`;
  }

  let ok = false;
  try
  {
    const res = await fetch( `${NTFY_SERVER}/${topic}`, {
      method: 'POST',
      headers: {
        'Title':    title,
        'Priority': priority,
        'Tags':     kind === 'needs_input' ? 'warning' : kind === 'stop' ? 'white_check_mark' : 'hourglass',
        'Click':    deeplink,
        'Actions':  actions
      },
      body: body
    } );
    ok = res.ok;
  }
  catch
  {
    ok = false;
  }

  log_notification( session_id, kind, title, body, ok );
  return ok;
}
