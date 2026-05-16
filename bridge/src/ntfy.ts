import { get_config, set_config, log_notification } from './db.ts';
import { randomBytes } from 'node:crypto';

const NTFY_SERVER = process.env.BEACON_NTFY_SERVER || 'https://ntfy.sh';

// Webhook Discord opcional (fallback cuando ntfy.sh está rate-limited)
// Configurable via env: BEACON_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
// O via /api/config { discord_webhook: "..." }
function get_discord_webhook(): string | null {
  return process.env.BEACON_DISCORD_WEBHOOK
      ?? get_config( 'discord_webhook' )
      ?? null;
}

async function push_discord( kind: PushKind, title: string, body: string, deeplink: string ): Promise<boolean> {
  const url = get_discord_webhook();
  if( !url ) return false;
  const color = kind === 'needs_input' ? 0xE5B23F : kind === 'idle' ? 0xD97757 : 0x3F8F5F;
  try
  {
    const r = await fetch( url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify( {
        embeds: [ {
          title,
          description: body,
          color,
          footer: { text: deeplink }
        } ]
      } )
    } );
    return r.ok;
  }
  catch
  {
    return false;
  }
}

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

// Rate limit interno: max 1 push por (session_id, kind) cada 60s.
// Evita pegar contra ntfy.sh free tier (cuota diaria 250 msgs/topic).
const RATE_LIMIT_MS = 60_000;
const last_pushed = new Map<string, number>();

export async function push(
  session_id: string,
  kind: PushKind,
  title: string,
  body: string
): Promise<boolean> {
  const rate_key = session_id + ':' + kind;
  const last = last_pushed.get( rate_key ) ?? 0;
  if( Date.now() - last < RATE_LIMIT_MS )
  {
    log_notification( session_id, kind, title, body, false );
    return false;
  }
  last_pushed.set( rate_key, Date.now() );

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
  let ntfy_status = 0;
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
    ntfy_status = res.status;
  }
  catch
  {
    ok = false;
  }

  // Fallback Discord si ntfy falla (429 rate limit, network error, etc.)
  if( !ok )
  {
    const discord_ok = await push_discord( kind, title, body, deeplink );
    if( discord_ok ) ok = true;
  }

  log_notification( session_id, kind, title, body, ok );
  return ok;
}
