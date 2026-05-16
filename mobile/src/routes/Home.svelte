<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { devices, auto_discover_local_bridge, refresh_devices_status } from '../lib/stores.ts';
  import { list_sessions } from '../lib/api.ts';
  import { start_poll } from '../lib/poller.ts';
  import { relative_time, compact_number } from '../lib/format.ts';
  import type { Session, Device } from '../lib/types.ts';
  import StatusIcon from '../lib/components/StatusIcon.svelte';
  import Empty from '../lib/components/Empty.svelte';
  import PairDialog from '../lib/components/PairDialog.svelte';
  import { link } from 'svelte-spa-router';
  import {
    Radar, Settings, RefreshCw, ChevronRight, Activity, Cpu, Coins, Search, Monitor
  } from 'lucide-svelte';

  let sessions_by_device = $state<Record<string, Session[]>>( {} );
  let discovering        = $state( false );
  let pair_open          = $state( false );
  let stop_poll: ( () => void ) | null = null;

  async function refresh() {
    await refresh_devices_status();
    for( const d of $devices.filter( x => x.online ) )
    {
      try { sessions_by_device[ d.id ] = await list_sessions( d ); }
      catch { sessions_by_device[ d.id ] = []; }
    }
    sessions_by_device = { ...sessions_by_device };
  }

  async function rediscover() {
    discovering = true;
    await auto_discover_local_bridge();
    discovering = false;
    await refresh();
  }

  onMount( async () => { await rediscover(); stop_poll = start_poll( refresh, 5_000 ); } );
  onDestroy( () => stop_poll?.() );

  const total_active = $derived(
    Object.values( sessions_by_device ).flat()
      .filter( s => s.status === 'working' || s.status === 'needs_input' ).length
  );
  const total_tokens = $derived(
    Object.values( sessions_by_device ).flat().reduce( ( a, s ) => a + ( s.tokens_in + s.tokens_out ), 0 )
  );

  function active_count( d: Device ): number {
    return ( sessions_by_device[ d.id ] ?? [] ).filter( s =>
      s.status === 'working' || s.status === 'needs_input'
    ).length;
  }
</script>

<header class="sticky top-0 z-10 bg-bg-base/95 backdrop-blur border-b border-bg-line">
  <div class="px-5 pt-12 pb-3 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <Radar size={22} class="text-accent" strokeWidth={2} />
      <h1 class="text-[19px] font-semibold tracking-tight">Beacon</h1>
    </div>
    <a use:link href="/settings" class="text-text-secondary hover:text-text-primary p-1.5 rounded-md hover:bg-bg-card" aria-label="Settings">
      <Settings size={18} strokeWidth={2} />
    </a>
  </div>
</header>

{#if $devices.length === 0}
  {#if discovering}
    <div class="px-6 py-16 flex flex-col items-center text-center">
      <Search size={48} class="text-text-muted mb-4 spin opacity-60" strokeWidth={1.5} />
      <h2 class="text-base font-medium mb-1">Buscando bridge local…</h2>
      <p class="mono text-[11px] text-text-secondary">localhost:7890</p>
    </div>
  {:else}
    <div class="px-6 py-12 flex flex-col items-center text-center">
      <Radar size={48} class="text-accent mb-4 opacity-80" strokeWidth={1.5} />
      <h2 class="text-base font-semibold mb-2">Vincula tu primer Mac</h2>
      <p class="text-[12px] text-text-secondary mb-6 max-w-xs leading-relaxed">
        Arranca el bridge en tu Mac y pega aquí el hostname Tailscale + token.
      </p>

      <div class="bg-bg-card border border-bg-line rounded-lg px-4 py-3 mb-5 text-left max-w-xs w-full space-y-2">
        <p class="mono text-[10px] uppercase tracking-wider text-text-muted">En el Mac:</p>
        <p class="mono text-[10.5px] text-text-primary leading-relaxed">
          cd ~/Desktop/Work/beacon/bridge<br/>bun run start
        </p>
        <p class="mono text-[10px] uppercase tracking-wider text-text-muted pt-2">Luego copia el token:</p>
        <p class="mono text-[10.5px] text-accent">cat ~/.beacon/token</p>
      </div>

      <button
        onclick={() => pair_open = true}
        class="bg-accent text-white px-5 py-2.5 rounded-md text-[13px] font-medium mb-2"
      >Vincular Mac</button>
      <button
        onclick={rediscover}
        class="text-accent text-[11px]"
      >Buscar bridge local (solo si la app corre en el Mac)</button>
    </div>
  {/if}
{:else}
  <section class="px-5 py-4">
    <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2.5">Agregado</div>
    <div class="grid grid-cols-3 gap-2">
      <div class="bg-bg-card rounded-lg p-3 border border-bg-line">
        <div class="flex items-center gap-1.5 mb-1.5">
          <Activity size={11} class="text-accent" strokeWidth={2.5} />
          <span class="mono text-[9px] uppercase tracking-wider text-text-muted">activas</span>
        </div>
        <div class="text-[22px] font-semibold text-accent leading-none">{total_active}</div>
      </div>
      <div class="bg-bg-card rounded-lg p-3 border border-bg-line">
        <div class="flex items-center gap-1.5 mb-1.5">
          <Monitor size={11} class="text-text-secondary" strokeWidth={2.5} />
          <span class="mono text-[9px] uppercase tracking-wider text-text-muted">online</span>
        </div>
        <div class="text-[22px] font-semibold leading-none">
          {$devices.filter( d => d.online ).length}<span class="text-text-muted text-[15px]">/{$devices.length}</span>
        </div>
      </div>
      <div class="bg-bg-card rounded-lg p-3 border border-bg-line">
        <div class="flex items-center gap-1.5 mb-1.5">
          <Coins size={11} class="text-text-secondary" strokeWidth={2.5} />
          <span class="mono text-[9px] uppercase tracking-wider text-text-muted">tokens</span>
        </div>
        <div class="text-[22px] font-semibold leading-none">{compact_number( total_tokens )}</div>
      </div>
    </div>
  </section>

  <section class="px-5 pb-24">
    <div class="flex items-center justify-between mb-2.5">
      <div class="mono text-[10px] uppercase tracking-wider text-text-muted">Ordenadores · {$devices.length}</div>
      <button onclick={() => pair_open = true} class="text-accent text-[11px] flex items-center gap-1">
        + Añadir
      </button>
    </div>

    <div class="space-y-1.5">
      {#each $devices as device ( device.id )}
        {@const active = active_count( device )}
        {@const list = sessions_by_device[ device.id ] ?? []}
        <a
          use:link
          href="/mac/{device.id}"
          class="block bg-bg-card rounded-lg p-3 border border-bg-line active:bg-bg-panel hover:border-bg-line/80 transition"
        >
          <div class="flex items-center gap-3">
            <div class="shrink-0">
              <StatusIcon status={device.online ? ( active > 0 ? 'working' : 'idle' ) : 'ended'} size={16} />
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-[14px] truncate">{device.name}</div>
              <div class="mono text-[10px] text-text-muted mt-0.5 truncate">
                {#if device.online}
                  {active} active · {list.length} total · {device.host}
                {:else}
                  offline · {relative_time( device.last_seen )}
                {/if}
              </div>
            </div>
            <ChevronRight size={16} class="text-text-muted shrink-0" strokeWidth={2} />
          </div>
        </a>
      {/each}
    </div>
  </section>
{/if}

<PairDialog open={pair_open} on_close={() => pair_open = false} />
