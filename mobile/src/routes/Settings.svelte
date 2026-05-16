<script lang="ts">
  import { devices, settings, remove_device } from '../lib/stores.ts';
  import { relative_time } from '../lib/format.ts';
  import { push } from 'svelte-spa-router';
  import { ChevronLeft, Trash2, Plus, DollarSign, BellRing, MoonStar, Mic, Fingerprint, Layers } from 'lucide-svelte';
  import PairDialog from '../lib/components/PairDialog.svelte';

  let pair_open = $state( false );

  function unpair( id: string ) {
    if( !confirm( '¿Eliminar este ordenador?' ) ) return;
    remove_device( id );
  }
</script>

<header class="sticky top-0 z-10 bg-bg-base/95 backdrop-blur border-b border-bg-line">
  <div class="px-4 pt-12 pb-3 flex items-center gap-2">
    <button onclick={() => push( '/' )} class="text-text-secondary p-1 -ml-1">
      <ChevronLeft size={20} strokeWidth={2} />
    </button>
    <h1 class="font-medium text-[15px]">Settings</h1>
  </div>
</header>

<section class="px-4 py-4">
  <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2">Ordenadores</div>
  <div class="bg-bg-card border border-bg-line rounded-lg divide-y divide-bg-line">
    {#each $devices as d ( d.id )}
      <div class="p-3 flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="font-medium text-[13px] truncate">{d.name}</div>
          <div class="mono text-[10px] text-text-muted mt-0.5 truncate">{d.host}:{d.port}</div>
          <div class="mono text-[10px] text-text-secondary mt-0.5">
            {d.online ? 'online' : 'offline · ' + relative_time( d.last_seen )}
          </div>
        </div>
        <button onclick={() => unpair( d.id )} class="text-red-500/80 hover:text-red-500 p-1.5 rounded hover:bg-red-500/10" aria-label="Eliminar">
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    {/each}
    <button onclick={() => pair_open = true} class="w-full p-3 text-accent text-[13px] font-medium flex items-center justify-center gap-1.5 hover:bg-bg-panel/40">
      <Plus size={14} strokeWidth={2.5} />
      Vincular Mac
    </button>
  </div>
</section>

<PairDialog open={pair_open} on_close={() => pair_open = false} />

<section class="px-4 py-3">
  <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
    <DollarSign size={11} strokeWidth={2.5} />
    Cost burndown
  </div>
  <div class="bg-bg-card border border-bg-line rounded-lg p-3">
    <label class="flex items-center justify-between">
      <div>
        <div class="text-[13px]">Plan mensual</div>
        <div class="text-[10px] text-text-muted mt-0.5">Avisar si excede +10%</div>
      </div>
      <div class="flex items-center gap-1 mono">
        <span class="text-text-muted text-[13px]">$</span>
        <input
          type="number"
          bind:value={$settings.plan_usd}
          min="0"
          step="10"
          class="w-20 bg-bg-panel border border-bg-line rounded px-2 py-1 text-[13px] text-right mono"
        />
      </div>
    </label>
  </div>
</section>

<section class="px-4 py-3">
  <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
    <BellRing size={11} strokeWidth={2.5} />
    Notificaciones
  </div>
  <div class="bg-bg-card border border-bg-line rounded-lg divide-y divide-bg-line">
    <div class="p-3 flex items-center justify-between">
      <div>
        <div class="text-[13px]">Idle alert</div>
        <div class="text-[10px] text-text-muted mt-0.5">Avisar si sin output durante…</div>
      </div>
      <select bind:value={$settings.idle_threshold_s} class="bg-bg-panel border border-bg-line rounded px-2 py-1 text-[12px] mono">
        <option value={30}>30s</option>
        <option value={60}>60s</option>
        <option value={120}>2min</option>
        <option value={300}>5min</option>
        <option value={0}>off</option>
      </select>
    </div>
    <div class="p-3 flex items-center justify-between gap-3">
      <div class="flex-1 flex items-center gap-2">
        <MoonStar size={13} class="text-text-muted shrink-0" strokeWidth={2} />
        <div>
          <div class="text-[13px]">Horario silencioso</div>
          <div class="text-[10px] text-text-muted mt-0.5">No notificar entre estas horas</div>
        </div>
      </div>
      <div class="flex items-center gap-1 text-[11px] mono">
        <input type="number" bind:value={$settings.quiet_hours_start} min="0" max="23" class="w-9 bg-bg-panel border border-bg-line rounded px-1 py-1 text-center mono" />
        <span class="text-text-muted">→</span>
        <input type="number" bind:value={$settings.quiet_hours_end} min="0" max="23" class="w-9 bg-bg-panel border border-bg-line rounded px-1 py-1 text-center mono" />
      </div>
    </div>
  </div>
</section>

<section class="px-4 py-3">
  <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
    <Mic size={11} strokeWidth={2.5} />
    Voice
  </div>
  <div class="bg-bg-card border border-bg-line rounded-lg p-3 flex items-center justify-between">
    <div>
      <div class="text-[13px]">Idioma del dictado</div>
    </div>
    <select bind:value={$settings.voice_lang} class="bg-bg-panel border border-bg-line rounded px-2 py-1 text-[12px] mono">
      <option value="es-ES">es-ES</option>
      <option value="es-MX">es-MX</option>
      <option value="en-US">en-US</option>
      <option value="en-GB">en-GB</option>
    </select>
  </div>
</section>

<section class="px-4 py-3">
  <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
    <Fingerprint size={11} strokeWidth={2.5} />
    Seguridad
  </div>
  <div class="bg-bg-card border border-bg-line rounded-lg divide-y divide-bg-line">
    <label class="p-3 flex items-center justify-between cursor-pointer">
      <div class="flex-1">
        <div class="text-[13px]">Biométrico en acciones críticas</div>
        <div class="text-[10px] text-text-muted mt-0.5">Huella para send, allow/deny, kill</div>
      </div>
      <input type="checkbox" bind:checked={$settings.biometric_enabled} class="accent-accent w-5 h-5" />
    </label>
    <label class="p-3 flex items-center justify-between cursor-pointer gap-3">
      <div class="flex items-center gap-2 flex-1">
        <Layers size={13} class="text-text-muted shrink-0" strokeWidth={2} />
        <div>
          <div class="text-[13px]">Servicio en primer plano</div>
          <div class="text-[10px] text-text-muted mt-0.5">WebSocket persistente en background</div>
        </div>
      </div>
      <input type="checkbox" bind:checked={$settings.fg_service_enabled} class="accent-accent w-5 h-5" />
    </label>
  </div>
</section>

<section class="px-5 py-6 pb-12 text-center mono text-[10px] text-text-muted uppercase tracking-wider">
  Beacon v0.1.0
</section>
