<script lang="ts">
  /**
   * Tabla de uso por modelo, con desglose por día (hover/expandible).
   */
  import type { DailyBreakdown, DailyByModel } from '../types.ts';
  import { ChevronDown, ChevronRight } from 'lucide-svelte';
  import { compact_number } from '../format.ts';

  let { breakdown }: { breakdown: DailyBreakdown | null } = $props();

  let expanded = $state<string | null>( null );

  type ModelSummary = {
    model:       string;
    short:       string;
    tokens_in:   number;
    tokens_out:  number;
    cache_read:  number;
    cache_create: number;
    cost_usd:    number;
    days:        number;
    rows:        DailyByModel[];
  };

  const summary = $derived.by<ModelSummary[]>( () => {
    if( !breakdown || breakdown.source !== 'ccusage' ) return [];

    // Indexamos by_model en cliente (antes venía duplicado del bridge)
    const by_model: Record<string, DailyByModel[]> = {};
    for( const r of breakdown.days ) ( by_model[ r.model ] ??= [] ).push( r );

    const out: ModelSummary[] = [];
    for( const model in by_model )
    {
      const rows = by_model[ model ];
      const short = model.replace( /^claude-/, '' );
      out.push( {
        model,
        short,
        tokens_in:    rows.reduce( ( a, r ) => a + r.tokens_in, 0 ),
        tokens_out:   rows.reduce( ( a, r ) => a + r.tokens_out, 0 ),
        cache_read:   rows.reduce( ( a, r ) => a + r.cache_read, 0 ),
        cache_create: rows.reduce( ( a, r ) => a + r.cache_create, 0 ),
        cost_usd:     rows.reduce( ( a, r ) => a + r.cost_usd, 0 ),
        days:         rows.length,
        rows:         rows.slice().sort( ( a, b ) => b.date.localeCompare( a.date ) )
      } );
    }
    return out.sort( ( a, b ) => b.cost_usd - a.cost_usd );
  } );

  function toggle( model: string ) {
    expanded = expanded === model ? null : model;
  }
</script>

{#if !breakdown || breakdown.source === 'loading'}
  <div class="bg-bg-card border border-bg-line rounded-lg p-6 text-center text-text-secondary text-sm">
    <div class="mono text-[10px] uppercase tracking-wider text-text-muted">Cargando ccusage…</div>
    <p class="text-text-muted text-[11px] mt-2">Primera carga puede tardar 5-15s.</p>
  </div>
{:else if breakdown.source === 'fallback'}
  <div class="bg-bg-card border border-bg-line rounded-lg p-6 text-center text-text-secondary text-sm">
    <p>ccusage no disponible.</p>
    <p class="text-text-muted text-[11px] mt-1">Revisa los logs del bridge.</p>
  </div>
{:else if summary.length === 0}
  <div class="bg-bg-card border border-bg-line rounded-lg p-6 text-center text-text-secondary text-sm">
    Sin datos en ccusage. Aún no has usado Claude.
  </div>
{:else}
  <div class="bg-bg-card border border-bg-line rounded-lg overflow-hidden">
    <div class="grid grid-cols-[auto_1fr_70px_70px_70px] gap-2 px-3 py-2 border-b border-bg-line mono text-[9px] uppercase tracking-wider text-text-muted">
      <span class="w-3"></span>
      <span>Modelo</span>
      <span class="text-right">Tokens</span>
      <span class="text-right">Días</span>
      <span class="text-right">Coste</span>
    </div>

    {#each summary as s ( s.model )}
      {@const tokens_total = s.tokens_in + s.tokens_out + s.cache_read + s.cache_create}
      <button
        onclick={() => toggle( s.model )}
        class="w-full grid grid-cols-[auto_1fr_70px_70px_70px] gap-2 px-3 py-2.5 border-b border-bg-line/30 items-center hover:bg-bg-panel/50 transition text-left"
      >
        <span class="text-text-muted">
          {#if expanded === s.model}
            <ChevronDown size={12} strokeWidth={2.5} />
          {:else}
            <ChevronRight size={12} strokeWidth={2.5} />
          {/if}
        </span>
        <span class="mono text-[12px] text-text-primary truncate">{s.short}</span>
        <span class="mono text-[12px] text-right">{compact_number( tokens_total )}</span>
        <span class="mono text-[12px] text-right text-text-secondary">{s.days}</span>
        <span class="mono text-[12px] text-right text-accent">${s.cost_usd.toFixed( 2 )}</span>
      </button>

      {#if expanded === s.model}
        <div class="bg-bg-panel/40 border-b border-bg-line/30">
          <div class="grid grid-cols-[1fr_70px_70px_70px] gap-2 px-3 py-1.5 mono text-[9px] uppercase tracking-wider text-text-muted">
            <span>Día</span>
            <span class="text-right">In</span>
            <span class="text-right">Out</span>
            <span class="text-right">Coste</span>
          </div>
          {#each s.rows as r}
            <div class="grid grid-cols-[1fr_70px_70px_70px] gap-2 px-3 py-1.5 border-t border-bg-line/20 mono text-[11px]">
              <span class="text-text-secondary">{r.date}</span>
              <span class="text-right">{compact_number( r.tokens_in + r.cache_read + r.cache_create )}</span>
              <span class="text-right">{compact_number( r.tokens_out )}</span>
              <span class="text-right text-accent">${r.cost_usd.toFixed( 2 )}</span>
            </div>
          {/each}
        </div>
      {/if}
    {/each}

    <div class="grid grid-cols-[auto_1fr_70px_70px_70px] gap-2 px-3 py-2.5 mono text-[11px] bg-bg-panel/30 font-medium">
      <span class="w-3"></span>
      <span class="text-text-secondary">Total · {breakdown.totals.days_count} días · {breakdown.totals.models_count} modelos</span>
      <span class="text-right">{compact_number( breakdown.totals.tokens_total )}</span>
      <span class="text-right"></span>
      <span class="text-right text-accent">${breakdown.totals.cost_total.toFixed( 2 )}</span>
    </div>
  </div>
{/if}
