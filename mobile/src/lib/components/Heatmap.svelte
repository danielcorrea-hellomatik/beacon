<script lang="ts">
  /**
   * Calendar heatmap estilo GitHub contributions.
   * 7 filas (L-D) × N columnas (semanas). Cada celda = un día.
   * Color por intensidad (tokens del día). Tooltip muestra fecha + coste + modelos.
   */
  import type { CalendarCell, DailyByModel, DailyBreakdown } from '../types.ts';
  import { compact_number } from '../format.ts';

  let { calendar, breakdown }: {
    calendar:   CalendarCell[];
    breakdown?: DailyBreakdown | null;
  } = $props();

  let hover_date: string | null = $state( null );
  let hover_x = $state( 0 );
  let hover_y = $state( 0 );

  // by_day del breakdown se construye en cliente (en lugar de enviar duplicado del bridge)
  const by_day = $derived.by<Record<string, DailyByModel[]>>( () => {
    if( !breakdown || breakdown.source !== 'ccusage' ) return {};
    const m: Record<string, DailyByModel[]> = {};
    for( const r of breakdown.days ) ( m[ r.date ] ??= [] ).push( r );
    return m;
  } );

  // Organizamos en columnas de 7 días (L-D). Empezamos por la semana del primer día.
  const weeks = $derived.by<CalendarCell[][]>( () => {
    if( calendar.length === 0 ) return [];
    const out: CalendarCell[][] = [];
    let current: CalendarCell[] = [];
    for( const cell of calendar )
    {
      const d = new Date( cell.date + 'T00:00:00' );
      const dow = ( d.getDay() + 6 ) % 7;    // 0 = Lunes
      // Si la celda no encaja en la posición esperada, rellenamos hasta su posición
      while( current.length < dow ) current.push( { date: '', count: 0, cost: 0, models: 0 } );
      current.push( cell );
      if( current.length === 7 ) { out.push( current ); current = []; }
    }
    if( current.length > 0 )
    {
      while( current.length < 7 ) current.push( { date: '', count: 0, cost: 0, models: 0 } );
      out.push( current );
    }
    return out;
  } );

  const max_count = $derived.by( () => {
    let m = 0;
    for( const c of calendar ) if( c.count > m ) m = c.count;
    return m || 1;
  } );

  function cell_color( c: CalendarCell ): string {
    if( !c.date ) return 'transparent';
    if( c.count === 0 ) return '#1E1E22';
    const i = Math.min( 1, c.count / max_count );
    // Curva log para que los días pequeños tengan algo de color
    const intensity = Math.sqrt( i );
    const lum = 22 + intensity * 38;
    return `hsl( 16 60% ${lum}% )`;
  }

  function on_cell_enter( e: MouseEvent, c: CalendarCell ) {
    if( !c.date ) return;
    hover_date = c.date;
    const rect = ( e.target as HTMLElement ).getBoundingClientRect();
    hover_x = rect.left + rect.width / 2;
    hover_y = rect.top;
  }
  function on_cell_leave() { hover_date = null; }

  const tooltip = $derived.by( () => {
    if( !hover_date ) return null;
    const cell = calendar.find( c => c.date === hover_date );
    if( !cell ) return null;
    const d = new Date( cell.date + 'T00:00:00' );
    const day_name = d.toLocaleDateString( 'es-ES', { weekday: 'long', day: 'numeric', month: 'short' } );
    const models = by_day[ cell.date ] ?? [];
    return {
      day_name,
      cell,
      models: models.map( r => ( {
        model: r.model.replace( /^claude-/, '' ),
        tokens: r.tokens_in + r.tokens_out + r.cache_read + r.cache_create,
        cost:   r.cost_usd
      } ) ).sort( ( a, b ) => b.cost - a.cost )
    };
  } );

  // Etiquetas de meses encima del grid: la semana que cambia de mes muestra el nombre
  const month_labels = $derived.by( () => {
    const out: Array<{ col: number; label: string }> = [];
    let last_month = -1;
    weeks.forEach( ( w, i ) => {
      const first = w.find( c => c.date );
      if( !first ) return;
      const m = new Date( first.date + 'T00:00:00' ).getMonth();
      if( m !== last_month )
      {
        out.push( { col: i, label: new Date( first.date + 'T00:00:00' ).toLocaleDateString( 'es-ES', { month: 'short' } ) } );
        last_month = m;
      }
    } );
    return out;
  } );

  const day_labels = [ 'L', 'M', 'X', 'J', 'V', 'S', 'D' ];
</script>

<div class="bg-bg-card rounded-lg p-3 border border-bg-line">
  <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2 flex items-center justify-between">
    <span>{calendar.filter( c => c.count > 0 ).length} días activos</span>
    {#if breakdown && breakdown.source === 'ccusage'}
      <span class="text-accent normal-case tracking-normal">${breakdown.totals.cost_total.toFixed( 2 )}</span>
    {/if}
  </div>

  <div class="relative overflow-x-auto pb-1">
    <!-- Month labels -->
    <div class="flex gap-[3px] mb-1 pl-5 mono text-[9px] text-text-muted">
      {#each weeks as _, i}
        {@const lbl = month_labels.find( m => m.col === i )?.label}
        <div class="w-[10px] shrink-0">{lbl ?? ''}</div>
      {/each}
    </div>

    <div class="flex gap-[3px]">
      <!-- Day-of-week labels -->
      <div class="flex flex-col gap-[3px] mr-1 mono text-[8px] text-text-muted">
        {#each day_labels as l}
          <div class="h-[10px] w-3 flex items-center justify-center">{l}</div>
        {/each}
      </div>

      <!-- Grid -->
      {#each weeks as week}
        <div class="flex flex-col gap-[3px] shrink-0">
          {#each week as cell}
            <button
              class="w-[10px] h-[10px] rounded-[2px] cursor-default border border-transparent hover:border-accent/70 transition"
              style="background: {cell_color( cell )}"
              onmouseenter={( e ) => on_cell_enter( e, cell )}
              onmouseleave={on_cell_leave}
              aria-label={cell.date || 'empty'}
              disabled={!cell.date}
            ></button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if tooltip}
  <div
    class="fixed z-40 pointer-events-none bg-bg-panel border border-bg-line rounded-md shadow-xl px-3 py-2 text-[11px] min-w-[180px]"
    style="left: {hover_x}px; top: {hover_y - 8}px; transform: translate( -50%, -100% );"
  >
    <div class="font-medium text-text-primary capitalize">{tooltip.day_name}</div>
    <div class="mono text-[10px] text-text-muted mt-0.5 flex items-center gap-2">
      <span>{compact_number( tooltip.cell.count )} tokens</span>
      {#if tooltip.cell.cost > 0}
        <span class="text-accent">·  ${tooltip.cell.cost.toFixed( 2 )}</span>
      {/if}
    </div>
    {#if tooltip.models.length > 0}
      <div class="mt-1.5 pt-1.5 border-t border-bg-line space-y-0.5">
        {#each tooltip.models as m}
          <div class="flex items-center justify-between gap-3 text-[10px] mono">
            <span class="text-text-secondary truncate">{m.model}</span>
            <span class="text-accent shrink-0">${m.cost.toFixed( 2 )}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
