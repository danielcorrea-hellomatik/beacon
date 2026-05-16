<script lang="ts">
  /**
   * Render del timeline de una sesión Claude Code con look terminal real:
   *
   *   ~/path/to/cwd                           <- path verde
   *   claude
   *
   *   ● Voy a empezar leyendo el archivo      <- assistant text, bullet blanco
   *
   *   ● Read(core/RAG.php)                    <- tool call
   *     └  240 lines read                     <- tool output, gris cursivo
   *
   *   ● Bash(pnpm test core)
   *     └  3 tests passed
   *
   *   * Cogitated for 12s                     <- meta event, italic suave
   *
   *   ⚠ Claude espera tu respuesta            <- notification, amarillo
   *
   *   > Vale, sigue con esto                  <- user prompt, naranja
   */
  import type { SessionEvent } from '../types.ts';

  let { events, cwd }: { events: SessionEvent[]; cwd: string } = $props();

  function ev_summary( ev: SessionEvent ): string {
    try
    {
      const p = JSON.parse( ev.payload_json ) as Record<string, unknown>;
      if( ev.type === 'UserPromptSubmit' ) return String( p.prompt ?? '' ).trim();
      if( ev.type === 'PreToolUse' )
      {
        const ti = p.tool_input as Record<string, unknown> | undefined;
        if( !ti ) return '';
        if( ev.tool_name === 'Read' || ev.tool_name === 'Edit' || ev.tool_name === 'Write' )
          return String( ti.file_path ?? '' );
        if( ev.tool_name === 'Bash' )
          return String( ti.command ?? '' );
        if( ev.tool_name === 'Grep' || ev.tool_name === 'Glob' )
          return String( ti.pattern ?? ti.path ?? '' );
        if( ev.tool_name === 'WebFetch' || ev.tool_name === 'WebSearch' )
          return String( ti.url ?? ti.query ?? '' );
        // MCP / otros: cogemos el primer string corto del tool_input
        const first = Object.values( ti ).find( v => typeof v === 'string' );
        return typeof first === 'string' ? first.slice( 0, 200 ) : JSON.stringify( ti ).slice( 0, 120 );
      }
      if( ev.type === 'PostToolUse' )
      {
        const out = String( p.tool_output ?? '' ).trim();
        return out.split( '\n' )[ 0 ].slice( 0, 160 );
      }
      if( ev.type === 'Notification' )
        return String( p.message ?? '' );
      return '';
    }
    catch { return ''; }
  }

  // Short path: ~/Desktop/Work/foo en vez del absoluto
  const short_cwd = $derived( cwd.replace( /^\/Users\/[^/]+/, '~' ) );

  function tool_label( ev: SessionEvent ): string {
    const arg = ev_summary( ev );
    return ev.tool_name + ( arg ? '(' + truncate( arg, 80 ) + ')' : '' );
  }

  function truncate( s: string, n: number ): string {
    return s.length > n ? s.slice( 0, n ) + '…' : s;
  }
</script>

<header class="px-4 pt-4 pb-3 border-b border-bg-line">
  <div class="mono text-[12.5px] text-status-idle font-medium">{short_cwd}</div>
  <div class="mono text-[12.5px] text-status-idle/80 mt-0.5">claude</div>
</header>

<section class="px-4 py-4 pb-44 mono text-[12.5px] leading-relaxed space-y-2.5">
  {#each events as ev ( ev.id )}
    {#if ev.type === 'UserPromptSubmit'}
      {@const prompt = ev_summary( ev )}
      <div class="flex gap-2 pt-3">
        <span class="text-accent shrink-0">&gt;</span>
        <span class="text-text-primary break-words whitespace-pre-wrap flex-1">{prompt}</span>
      </div>
    {:else if ev.type === 'PreToolUse'}
      <div class="text-text-primary break-words">
        <span class="text-text-secondary">●</span>
        <span class="text-text-primary"> {ev.tool_name}</span><span class="text-text-secondary">(</span><span class="text-text-secondary break-all">{truncate( ev_summary( ev ), 200 )}</span><span class="text-text-secondary">)</span>
      </div>
    {:else if ev.type === 'PostToolUse'}
      {@const out = ev_summary( ev )}
      {#if out}
        <div class="pl-4 text-text-muted text-[11.5px] italic break-all flex gap-2">
          <span class="shrink-0">└</span>
          <span class="flex-1 truncate">{out}</span>
        </div>
      {/if}
    {:else if ev.type === 'Notification'}
      <div class="flex gap-2 text-status-needs_input italic">
        <span class="shrink-0">⚠</span>
        <span class="break-words flex-1">{ev_summary( ev )}</span>
      </div>
    {:else if ev.type === 'Stop'}
      <div class="text-text-muted/70 italic text-[11.5px] pt-1">
        <span>*</span> Cogitated
      </div>
    {:else if ev.type === 'SessionStart'}
      <!-- omitimos SessionStart del flujo terminal — ya está en el header -->
    {:else if ev.type === 'SubagentStop'}
      <div class="text-purple-400/80 italic text-[11.5px]">
        <span>*</span> Subagent done
      </div>
    {/if}
  {/each}
</section>
