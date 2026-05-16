<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { devices } from '../lib/stores.ts';
  import { list_sessions, get_stats, get_daily_by_model } from '../lib/api.ts';
  import { start_poll } from '../lib/poller.ts';
  import { relative_time, compact_number, short_path } from '../lib/format.ts';
  import { share_heatmap_snapshot } from '../lib/snapshot.ts';
  import type { Session, DeviceStats, DailyBreakdown } from '../lib/types.ts';
  import StatusIcon from '../lib/components/StatusIcon.svelte';
  import Heatmap from '../lib/components/Heatmap.svelte';
  import ModelsTable from '../lib/components/ModelsTable.svelte';
  import Empty from '../lib/components/Empty.svelte';
  import { link, push } from 'svelte-spa-router';
  import {
    ChevronLeft, Share2, Moon, type Icon as IconType, Hash, MessageSquare, Coins, CalendarDays, Flame, Trophy, Clock, Sparkles
  } from 'lucide-svelte';

  let { params }: { params: { id: string } } = $props();
  let range: 'all' | '30d' | '7d' = $state( 'all' );
  let tab:   'overview' | 'models'  = $state( 'overview' );

  let sessions  = $state<Session[]>( [] );
  let stats     = $state<DeviceStats | null>( null );
  let breakdown = $state<DailyBreakdown | null>( null );
  let loading   = $state( true );

  const device = $derived( $devices.find( d => d.id === params.id ) );
  const active = $derived( sessions.filter( s => s.status === 'working' || s.status === 'needs_input' || s.status === 'idle' ) );
  const past   = $derived( sessions.filter( s => s.status === 'ended' ) );

  let stop_poll: ( () => void ) | null = null;

  async function refresh_fast() {
    if( !device ) return;
    try
    {
      const [ ss, st ] = await Promise.all( [
        list_sessions( device ),
        get_stats( device )
      ] );
      sessions = ss;
      stats = st.local;
      loading = false;
    }
    catch { loading = false; }
  }

  async function refresh_breakdown() {
    if( !device ) return;
    try
    {
      const b = await get_daily_by_model( device );
      // Si el bridge aún no terminó warmup viene 'loading' — mantenemos el previo
      // si lo había, si no guardamos el loading para que la UI lo sepa.
      if( b.source === 'loading' && breakdown && breakdown.source === 'ccusage' ) return;
      breakdown = b;
    }
    catch { breakdown = null; }
  }

  onMount( () => {
    refresh_fast();
    refresh_breakdown();
    // Poll: stats rápidas cada 8s, breakdown cada 15s (ccusage cambia poco)
    stop_poll = start_poll( refresh_fast, 8_000 );
    stop_poll_bd = start_poll( refresh_breakdown, 15_000 );
  } );
  onDestroy( () => { stop_poll?.(); stop_poll_bd?.(); } );

  let stop_poll_bd: ( () => void ) | null = null;

  type StatDef = { Icon: typeof IconType; label: string; value: string };
  const stat_cards = $derived<StatDef[]>( stats ? [
    { Icon: Hash,          label: 'sessions', value: stats.sessions_total.toLocaleString() },
    { Icon: MessageSquare, label: 'messages', value: compact_number( stats.messages ) },
    { Icon: Coins,         label: 'tokens',   value: compact_number( stats.tokens_in + stats.tokens_out ) },
    { Icon: CalendarDays,  label: 'days',     value: String( stats.active_days ) },
    { Icon: Flame,         label: 'streak',   value: stats.current_streak + 'd' },
    { Icon: Trophy,        label: 'longest',  value: stats.longest_streak + 'd' },
    { Icon: Clock,         label: 'peak',     value: stats.peak_hour + ':00' },
    { Icon: Sparkles,      label: 'model',    value: stats.favorite_model || '—' }
  ] : [] );
</script>

<header class="sticky top-0 z-10 bg-bg-base/95 backdrop-blur border-b border-bg-line">
  <div class="px-4 pt-12 pb-2 flex items-center gap-2">
    <button onclick={() => push( '/' )} class="text-text-secondary p-1 -ml-1">
      <ChevronLeft size={20} strokeWidth={2} />
    </button>
    <h1 class="font-medium text-[15px] truncate flex-1">{device?.name ?? 'Mac'}</h1>
    <div class="flex gap-1 bg-bg-card rounded-md p-0.5 border border-bg-line">
      {#each [ 'all', '30d', '7d' ] as r}
        <button
          class="px-2 py-1 rounded text-[10px] mono uppercase tracking-wider {range === r ? 'bg-bg-panel text-text-primary' : 'text-text-muted'}"
          onclick={() => range = r as typeof range}
        >{r}</button>
      {/each}
    </div>
  </div>
  <div class="px-4 pb-2 flex gap-1">
    {#each [ { id: 'overview', label: 'Overview' }, { id: 'models', label: 'Models' } ] as t}
      <button
        class="px-3 py-1 rounded-md text-[11px] mono uppercase tracking-wider transition {tab === t.id ? 'bg-bg-card text-text-primary border border-bg-line' : 'text-text-muted hover:text-text-primary'}"
        onclick={() => tab = t.id as typeof tab}
      >{t.label}</button>
    {/each}
  </div>
</header>

{#if !device}
  <Empty title="Ordenador no encontrado" description="Es posible que lo hayas desvinculado." action={ { label: 'Volver al inicio', onclick: () => push( '/' ) } } />
{:else if tab === 'models'}
  <section class="px-4 py-4 pb-24">
    <ModelsTable {breakdown} />
  </section>
{:else}
  {#if stats}
    <section class="px-4 py-3">
      <div class="grid grid-cols-4 gap-1.5">
        {#each stat_cards as s}
          <div class="bg-bg-card rounded-md p-2.5 border border-bg-line">
            <div class="flex items-center gap-1 mb-1.5 text-text-muted">
              <s.Icon size={10} strokeWidth={2.5} />
              <span class="mono text-[8.5px] uppercase tracking-wider">{s.label}</span>
            </div>
            <div class="text-[15px] font-semibold leading-tight truncate">{s.value}</div>
          </div>
        {/each}
      </div>
    </section>

    <section class="px-4 mt-1">
      <Heatmap calendar={stats.calendar} {breakdown} />
      <div class="flex items-center justify-end mt-1.5">
        <button
          onclick={() => {
            // Reconstruimos data[][] simple para la snapshot a partir del calendar
            const grid = Array.from( { length: 7 }, () => Array( 24 ).fill( 0 ) );
            for( const c of stats!.calendar )
            {
              const d = new Date( c.date + 'T12:00:00' );
              grid[ d.getDay() ][ 12 ] += c.count;
            }
            share_heatmap_snapshot( grid, { title: `Beacon · ${ device.name }`, subtitle: `${ stats!.active_days } días activos · ${ stats!.current_streak }d streak` } );
          }}
          class="text-[10px] text-accent flex items-center gap-1 hover:opacity-80"
        >
          <Share2 size={11} strokeWidth={2.5} />
          Share
        </button>
      </div>
    </section>
  {:else if loading}
    <section class="px-5 py-8 text-center text-text-secondary text-sm">Cargando…</section>
  {/if}

  <section class="px-4 mt-5 pb-24">
    <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
      <StatusIcon status={active.length > 0 ? 'working' : 'idle'} size={11} />
      Activas · {active.length}
    </div>

    {#if active.length === 0 && !loading}
      <div class="bg-bg-card border border-dashed border-bg-line rounded-lg p-5 text-center mb-5">
        <Moon size={20} class="mx-auto mb-2 text-text-muted" strokeWidth={1.5} />
        <p class="text-text-secondary text-[13px]">Sin sesiones activas</p>
        <p class="text-text-muted text-[11px] mt-1.5 leading-relaxed">
          Aparecerán aquí cuando arranques <code class="text-accent mono">claude</code> en este Mac.
        </p>
      </div>
    {:else}
      <div class="space-y-1 mb-5">
        {#each active as s ( s.id )}
          <a
            use:link
            href="/session/{s.id}"
            class="block bg-bg-card rounded-md p-2.5 border border-bg-line active:bg-bg-panel hover:border-bg-line/80 transition"
          >
            <div class="flex items-start gap-2.5">
              <div class="shrink-0 pt-0.5"><StatusIcon status={s.status} size={13} /></div>
              <div class="flex-1 min-w-0">
                <div class="mono text-[11px] text-accent truncate font-medium">{short_path( s.cwd )}</div>
                <div class="text-[13px] text-text-primary truncate mt-0.5 leading-snug">{s.prompt_first || '(sin prompt aún)'}</div>
                <div class="mono text-[9.5px] text-text-muted mt-1 uppercase tracking-wider">
                  {s.status} · {compact_number( s.tokens_in + s.tokens_out )} tok · {relative_time( s.last_event_at )}
                </div>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}

    {#if past.length > 0}
      <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2">Pasadas · {past.length}</div>
      <div class="space-y-1">
        {#each past.slice( 0, 30 ) as s ( s.id )}
          <a
            use:link
            href="/session/{s.id}"
            class="block bg-bg-card/50 rounded-md p-2.5 border border-bg-line/30 active:bg-bg-panel hover:border-bg-line transition"
          >
            <div class="flex items-start gap-2.5">
              <div class="shrink-0 pt-0.5"><StatusIcon status="ended" size={13} /></div>
              <div class="flex-1 min-w-0">
                <div class="mono text-[11px] text-text-secondary truncate">{short_path( s.cwd )}</div>
                <div class="text-[13px] text-text-primary truncate mt-0.5 leading-snug">{s.prompt_first || '(sin prompt)'}</div>
                <div class="mono text-[9.5px] text-text-muted mt-1">{relative_time( s.ended_at ?? s.last_event_at )}</div>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>
{/if}
