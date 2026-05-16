<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { devices } from '../lib/stores.ts';
  import { get_session, list_events, send_prompt, kill_session, open_stream, queue_status } from '../lib/api.ts';
  import { start_poll } from '../lib/poller.ts';
  import { relative_time, compact_number, short_path } from '../lib/format.ts';
  import { create_voice } from '../lib/voice.ts';
  import { require_biometric } from '../lib/biometric.ts';
  import type { Session as SessionT, SessionEvent } from '../lib/types.ts';
  import StatusIcon from '../lib/components/StatusIcon.svelte';
  import TerminalLog from '../lib/components/TerminalLog.svelte';
  import Empty from '../lib/components/Empty.svelte';
  import { push } from 'svelte-spa-router';
  import {
    ChevronLeft, Square, Mic, Send, Inbox, Check, X, ArrowDown, ArrowUp
  } from 'lucide-svelte';

  let { params }: { params: { id: string } } = $props();

  let session       = $state<SessionT | null>( null );
  let events        = $state<SessionEvent[]>( [] );
  let input         = $state( '' );
  let sending       = $state( false );
  let voice_active  = $state( false );
  let device_id     = $state<string>( '' );
  let searching     = $state( true );
  let not_found     = $state( false );
  let timeline_end   = $state<HTMLDivElement | undefined>( undefined );
  let timeline_start = $state<HTMLDivElement | undefined>( undefined );
  let first_render_done = $state( false );
  let stuck_to_bottom   = $state( true );
  let toast = $state<{ kind: 'ok' | 'err'; msg: string } | null>( null );

  function on_user_scroll() {
    const dist = document.body.scrollHeight - window.innerHeight - window.scrollY;
    stuck_to_bottom = dist < 200;
  }

  // Auto-scroll cuando llegan events. Primera carga: instant al final.
  // Updates: smooth solo si el usuario está cerca del fondo.
  $effect( () => {
    if( events.length === 0 ) return;
    if( !first_render_done )
    {
      tick().then( () => {
        timeline_end?.scrollIntoView( { block: 'end' } );
        first_render_done = true;
      } );
    }
    else if( stuck_to_bottom )
    {
      tick().then( () => timeline_end?.scrollIntoView( { behavior: 'smooth', block: 'end' } ) );
    }
  } );

  const device = $derived( $devices.find( d => d.id === device_id ) );
  const voice = create_voice( { lang: 'es-ES' } );

  let stop_poll: ( () => void ) | null = null;
  let ws: WebSocket | null = null;

  async function locate_session() {
    for( const d of $devices.filter( x => x.online ) )
    {
      try { const s = await get_session( d, params.id );
            if( s ) { device_id = d.id; session = s; return d; } }
      catch {}
    }
    return null;
  }

  async function refresh() {
    if( !device || !session ) return;
    try
    {
      const [ s, evs ] = await Promise.all( [
        get_session( device, params.id ),
        list_events( device, params.id )
      ] );
      session = s;
      events = evs;
    }
    catch {}
  }

  onMount( async () => {
    searching = true;
    const d = await locate_session();
    searching = false;
    if( d )
    {
      await refresh();
      stop_poll = start_poll( refresh, 2_000 );
      ws = open_stream( d, ( msg ) => { if( msg.session_id === params.id ) refresh(); } );
    }
    else not_found = true;
    window.addEventListener( 'scroll', on_user_scroll, { passive: true } );
  } );

  onDestroy( () => {
    stop_poll?.();
    ws?.close();
    voice.stop();
    window.removeEventListener( 'scroll', on_user_scroll );
  } );

  function jump_to_top()    { timeline_start?.scrollIntoView( { behavior: 'smooth', block: 'start' } ); }
  function jump_to_bottom() { timeline_end?.scrollIntoView( { behavior: 'smooth', block: 'end' } ); stuck_to_bottom = true; }

  function show_toast( kind: 'ok' | 'err', msg: string ) {
    toast = { kind, msg };
    setTimeout( () => { toast = null; }, 4_000 );
  }

  async function send( text?: string ) {
    const msg = ( text ?? input ).trim();
    if( !msg || sending || !device ) return;
    if( !( await require_biometric( 'Enviar mensaje a Claude' ) ) ) return;
    sending = true;
    try
    {
      await send_prompt( device, params.id, msg );
      input = '';
      show_toast( 'ok', 'Encolado · Claude lo procesa al terminar el turno' );

      // Tras 3s, verificar si claude --resume falló (sesión no resumible)
      setTimeout( async () => {
        if( !device ) return;
        try
        {
          const q = await queue_status( device, params.id );
          if( q.last?.delivered_at && q.last?.error )
            show_toast( 'err', q.last.error.slice( 0, 100 ) );
        }
        catch {}
      }, 3_000 );
    }
    catch ( e )
    {
      show_toast( 'err', ( e as Error ).message );
    }
    sending = false;
    refresh();
  }

  async function approve( decision: 'continue' | 'deny' ) {
    if( !( await require_biometric( decision === 'continue' ? 'Continuar' : 'Detener' ) ) ) return;
    await send( decision === 'continue' ? 'sí, continúa' : 'no, detente' );
  }

  async function kill() {
    if( !device ) return;
    if( !confirm( 'Detener esta sesión de Claude?' ) ) return;
    if( !( await require_biometric( 'Matar sesión' ) ) ) return;
    try { await kill_session( device, params.id ); }
    catch ( e ) { alert( ( e as Error ).message ); }
    refresh();
  }

  function toggle_voice() {
    if( voice_active ) { voice.stop(); voice_active = false; return; }
    if( !voice.supported ) { alert( 'Voice no soportado' ); return; }
    voice_active = true;
    voice.start( ( text, is_final ) => {
      input = text;
      if( is_final ) voice_active = false;
    } );
  }
</script>

<header class="sticky top-0 z-10 bg-bg-base/95 backdrop-blur border-b border-bg-line">
  <div class="px-3 pt-12 pb-2.5 flex items-center gap-2">
    <button onclick={() => history.back()} class="text-text-secondary p-1 -ml-1">
      <ChevronLeft size={20} strokeWidth={2} />
    </button>
    {#if session}
      <div class="flex items-center gap-2 text-[10px] mono flex-1 min-w-0">
        <StatusIcon status={session.status} size={11} />
        <span class="uppercase tracking-wider text-text-secondary">{session.status}</span>
        <span class="text-bg-line">·</span>
        <span class="text-text-muted truncate">{session.model || '—'}</span>
        <span class="text-bg-line">·</span>
        <span class="text-text-muted">{compact_number( session.tokens_in + session.tokens_out )} tok</span>
        <span class="text-bg-line">·</span>
        <span class="text-text-muted">{relative_time( session.started_at )}</span>
      </div>
      <button onclick={kill} class="text-red-500/70 hover:text-red-500 p-1.5 rounded-md hover:bg-red-500/10" aria-label="Stop">
        <Square size={14} strokeWidth={2} fill="currentColor" />
      </button>
    {:else}
      <div class="flex-1 text-sm text-text-secondary mono">…</div>
      <div class="w-7"></div>
    {/if}
  </div>
</header>

<section class="pb-44">
  {#if searching}
    <div class="text-center text-text-secondary py-12 text-sm">Buscando sesión…</div>
  {:else if not_found}
    <Empty title="Sesión no encontrada" description="Ya no existe en ningún Mac vinculado." action={ { label: 'Volver', onclick: () => push( '/' ) } } />
  {:else if !session}
    <div class="text-center text-text-secondary py-12 text-sm">Cargando…</div>
  {:else if events.length === 0}
    <div class="mx-4 mt-6 bg-bg-card border border-dashed border-bg-line rounded-xl p-5 text-center">
      <Inbox size={28} class="mx-auto mb-2 text-text-muted" strokeWidth={1.5} />
      <p class="text-text-secondary text-sm">Sin eventos aún</p>
      <p class="text-text-muted text-[11px] mt-1.5 leading-relaxed">
        {session.channel === 'discovery'
          ? 'Sesión detectada por escaneo del JSONL. Para timeline en vivo arranca un Claude nuevo con los hooks instalados.'
          : 'Los eventos aparecerán aquí cuando Claude haga algo.'}
      </p>
    </div>
  {:else}
    <div bind:this={timeline_start}></div>
    {#if events.length > 50}
      <div class="px-4 py-2 mono text-[10px] text-text-muted uppercase tracking-wider flex items-center justify-between border-b border-bg-line/30">
        <span>{events.length} eventos · historial completo</span>
        <button onclick={jump_to_top} class="text-accent flex items-center gap-1 hover:opacity-80">
          <ArrowUp size={10} strokeWidth={2.5} />
          Inicio
        </button>
      </div>
    {/if}
    <TerminalLog {events} cwd={session.cwd} />
    <div bind:this={timeline_end}></div>
  {/if}

  {#if session?.status === 'needs_input'}
    <div class="mx-4 mt-4 bg-status-needs_input/[0.07] border border-status-needs_input/30 rounded-xl p-3">
      <div class="mono text-[10px] uppercase tracking-wider text-status-needs_input mb-2 flex items-center gap-1.5">
        <CirclePause_marker />
        Claude espera respuesta
      </div>
      <div class="text-sm text-text-primary mb-3 leading-snug">{session.prompt_first}</div>
      <div class="flex gap-2">
        <button
          onclick={() => approve( 'continue' )}
          class="flex-1 bg-status-idle/15 border border-status-idle/40 hover:bg-status-idle/25 text-status-idle rounded-md py-2 text-[13px] font-medium flex items-center justify-center gap-1.5 mono"
        >
          <Check size={14} strokeWidth={2.5} />
          Continúa
        </button>
        <button
          onclick={() => approve( 'deny' )}
          class="flex-1 bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 text-red-500 rounded-md py-2 text-[13px] font-medium flex items-center justify-center gap-1.5 mono"
        >
          <X size={14} strokeWidth={2.5} />
          Detén
        </button>
      </div>
    </div>
  {/if}

  {#if session?.status === 'ended'}
    <div class="text-center text-[11px] text-text-muted py-6 mono uppercase tracking-wider">— Sesión terminada —</div>
  {/if}
</section>

{#if !stuck_to_bottom && events.length > 10}
  <button
    onclick={jump_to_bottom}
    class="fixed bottom-24 right-4 bg-accent text-white rounded-full p-2.5 shadow-lg z-20 hover:opacity-90"
    aria-label="Ir al final"
  >
    <ArrowDown size={16} strokeWidth={2.5} />
  </button>
{/if}

{#if toast}
  <div
    class="fixed bottom-24 inset-x-3 z-30 rounded-lg px-3 py-2 text-[12px] mono border {toast.kind === 'ok' ? 'bg-status-idle/10 border-status-idle/40 text-status-idle' : 'bg-red-500/10 border-red-500/40 text-red-400'}"
  >
    {toast.msg}
  </div>
{/if}

<footer class="fixed bottom-0 inset-x-0 bg-bg-base border-t border-bg-line px-3 pt-2.5 safe-bottom">
  <div class="flex gap-1.5 items-end">
    <button
      onclick={toggle_voice}
      class="p-2.5 rounded-md transition {voice_active ? 'text-accent bg-accent/10 pulse-dot' : 'text-text-secondary hover:bg-bg-card'}"
      title="Dictar"
      aria-label="Dictar"
    >
      <Mic size={18} strokeWidth={2} />
    </button>
    <textarea
      bind:value={input}
      placeholder={voice_active ? 'Escuchando…' : 'Escribe a Claude…'}
      class="flex-1 bg-bg-card border {voice_active ? 'border-accent' : 'border-bg-line'} rounded-lg px-3 py-2 text-[14px] resize-none max-h-24 focus:outline-none focus:border-accent transition placeholder-text-muted"
      rows="1"
    ></textarea>
    <button
      onclick={() => send()}
      disabled={!input.trim() || sending || !session || session.status === 'ended'}
      class="bg-accent text-white rounded-lg px-3 py-2.5 text-sm font-medium disabled:opacity-30 disabled:bg-bg-card disabled:text-text-muted flex items-center"
      aria-label="Enviar"
    >
      {#if sending}
        <span class="mono">…</span>
      {:else}
        <Send size={16} strokeWidth={2.25} />
      {/if}
    </button>
  </div>
</footer>

<!-- helper marker so we can use the named import above without unused warning -->
{#snippet CirclePause_marker()}
  <span class="inline-block w-1.5 h-1.5 rounded-full bg-status-needs_input pulse-dot"></span>
{/snippet}
