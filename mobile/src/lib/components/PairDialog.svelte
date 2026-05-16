<script lang="ts">
  /**
   * Modal para vincular un Mac manualmente. Input host (Tailscale hostname o IP),
   * token (leído de ~/.beacon/token en el Mac), nombre. Hace ping antes de guardar.
   */
  import { add_device } from '../stores.ts';
  import { ping } from '../api.ts';
  import type { Device } from '../types.ts';
  import { X, Check, Loader2 } from 'lucide-svelte';

  let { open, on_close }: { open: boolean; on_close: () => void } = $props();

  let host  = $state( '' );
  let port  = $state( 7890 );
  let token = $state( '' );
  let name  = $state( '' );
  let status: 'idle' | 'testing' | 'ok' | 'fail' = $state( 'idle' );
  let error = $state( '' );

  async function connect() {
    if( !host.trim() || !token.trim() ) return;
    status = 'testing';
    error = '';

    const device: Device = {
      id:        'manual-' + host.replace( /[^a-z0-9]/gi, '-' ).toLowerCase(),
      host:      host.trim(),
      port,
      token:     token.trim(),
      name:      name.trim() || host.trim(),
      online:    false,
      last_seen: Date.now()
    };

    const ok = await ping( device );
    if( !ok )
    {
      status = 'fail';
      error = 'No respondió. Verifica que el bridge esté corriendo y el host/token sean correctos.';
      return;
    }

    device.online = true;
    add_device( device );
    status = 'ok';
    setTimeout( () => {
      host = ''; token = ''; name = ''; port = 7890; status = 'idle';
      on_close();
    }, 600 );
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 bg-bg-base/80 backdrop-blur-sm flex items-end sm:items-center justify-center"
    role="dialog"
    aria-modal="true"
  >
    <div class="bg-bg-card border border-bg-line rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto">
      <header class="flex items-center justify-between px-4 py-3 border-b border-bg-line sticky top-0 bg-bg-card">
        <h2 class="font-semibold text-[15px]">Vincular Mac</h2>
        <button onclick={on_close} class="text-text-secondary hover:text-text-primary p-1" aria-label="Cerrar">
          <X size={18} strokeWidth={2} />
        </button>
      </header>

      <div class="p-4 space-y-3">
        <p class="text-[11px] text-text-secondary leading-relaxed">
          Asegura que el bridge está corriendo en tu Mac
          (<code class="mono text-accent text-[10px]">cd ~/Desktop/Work/beacon/bridge && bun run start</code>)
          y obten el token con:
          <code class="mono text-accent text-[10px] block mt-1">cat ~/.beacon/token</code>
        </p>

        <label class="block">
          <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-1">Hostname Tailscale o IP</div>
          <input
            type="text"
            bind:value={host}
            placeholder="your-mac.tail-XXXXXX.ts.net"
            class="w-full bg-bg-panel border border-bg-line rounded-md px-3 py-2 text-[13px] mono focus:outline-none focus:border-accent"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </label>

        <label class="block">
          <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-1">Puerto</div>
          <input
            type="number"
            bind:value={port}
            min="1"
            max="65535"
            class="w-full bg-bg-panel border border-bg-line rounded-md px-3 py-2 text-[13px] mono focus:outline-none focus:border-accent"
          />
        </label>

        <label class="block">
          <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-1">Token</div>
          <input
            type="text"
            bind:value={token}
            placeholder="pega aquí el contenido de ~/.beacon/token"
            class="w-full bg-bg-panel border border-bg-line rounded-md px-3 py-2 text-[13px] mono focus:outline-none focus:border-accent"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
          />
        </label>

        <label class="block">
          <div class="mono text-[10px] uppercase tracking-wider text-text-muted mb-1">Nombre (opcional)</div>
          <input
            type="text"
            bind:value={name}
            placeholder="Mi Mac"
            class="w-full bg-bg-panel border border-bg-line rounded-md px-3 py-2 text-[13px] focus:outline-none focus:border-accent"
          />
        </label>

        {#if error}
          <p class="text-[11px] text-red-400">{error}</p>
        {/if}
      </div>

      <footer class="px-4 pb-4 sticky bottom-0 bg-bg-card">
        <button
          onclick={connect}
          disabled={status === 'testing' || !host.trim() || !token.trim()}
          class="w-full bg-accent text-white rounded-md py-2.5 text-[13px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:bg-bg-card disabled:text-text-muted"
        >
          {#if status === 'testing'}
            <Loader2 size={14} class="spin" strokeWidth={2.25} />
            Probando…
          {:else if status === 'ok'}
            <Check size={14} strokeWidth={2.5} />
            Conectado
          {:else}
            Conectar
          {/if}
        </button>
      </footer>
    </div>
  </div>
{/if}
