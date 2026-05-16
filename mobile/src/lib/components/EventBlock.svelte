<script lang="ts">
  /**
   * Warp-style event block. Cada evento del timeline se renderiza así:
   *
   *  ┌─ timestamp ─┬─ icon ─┬─ label ─────────────────────────────────────┐
   *  │             │        │ contenido (truncable / expandable)          │
   *  └─────────────┴────────┴─────────────────────────────────────────────┘
   *
   * Borde izquierdo sutil que se ilumina en hover.
   */
  import {
    Hammer, ArrowRightToLine, ArrowLeftToLine,
    User, Play, Check, CirclePause, Circle, Bot,
    FileText, Pencil, FileSearch, Terminal, Search, Globe,
    type Icon as IconType
  } from 'lucide-svelte';

  let { event, summary }: {
    event: { type: string; tool_name: string; ts: number };
    summary: string;
  } = $props();

  type EventVisual = {
    Icon:  typeof IconType;
    label: string;
    color: string;     // tailwind text-*
  };

  function visual(): EventVisual {
    if( event.type === 'PreToolUse' )
    {
      const T = pick_tool_icon( event.tool_name );
      return { Icon: T, label: event.tool_name, color: 'text-accent' };
    }
    if( event.type === 'PostToolUse' )
    {
      return { Icon: ArrowLeftToLine, label: event.tool_name + ' ←', color: 'text-text-secondary' };
    }
    if( event.type === 'UserPromptSubmit' )
      return { Icon: User, label: 'user', color: 'text-blue-400' };
    if( event.type === 'SessionStart' )
      return { Icon: Play, label: 'start', color: 'text-status-idle' };
    if( event.type === 'Stop' )
      return { Icon: Check, label: 'done', color: 'text-status-idle' };
    if( event.type === 'Notification' )
      return { Icon: CirclePause, label: 'wait', color: 'text-status-needs_input' };
    if( event.type === 'SubagentStop' )
      return { Icon: Bot, label: 'agent', color: 'text-purple-400' };
    return { Icon: Circle, label: event.type, color: 'text-text-muted' };
  }

  function pick_tool_icon( name: string ): typeof IconType {
    const n = name.toLowerCase();
    if( n === 'read' )                 return FileSearch;
    if( n === 'edit' || n === 'write' ) return Pencil;
    if( n === 'bash' )                 return Terminal;
    if( n === 'grep' || n === 'glob' ) return Search;
    if( n === 'webfetch' || n === 'websearch' ) return Globe;
    if( n.startsWith( 'mcp_' ) || n.includes( 'mcp__' ) ) return Bot;
    return Hammer;
  }

  const v = $derived( visual() );
  const time_str = $derived(
    new Date( event.ts ).toLocaleTimeString( 'es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' } )
  );
</script>

<div class="block-leading pl-3 pr-2 py-2 hover:bg-bg-panel/40 transition flex gap-3 items-start">
  <div class="mono text-[10px] text-text-muted shrink-0 pt-0.5 w-[58px]">{time_str}</div>
  <div class="shrink-0 pt-0.5 {v.color}">
    <v.Icon size={13} strokeWidth={2} />
  </div>
  <div class="mono text-[11px] {v.color} shrink-0 pt-0.5 w-[60px] truncate">{v.label}</div>
  <div class="text-[13px] text-text-primary flex-1 break-words leading-snug pt-0.5">
    {summary}
  </div>
</div>
