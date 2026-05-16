<script lang="ts">
  /**
   * Mantengo el nombre `Crab` por compatibilidad pero ahora delega en StatusIcon.
   * El cangrejo desaparece del UI — usamos iconos Lucide consistentes.
   */
  import StatusIcon from './StatusIcon.svelte';
  type Status = 'working' | 'idle' | 'needs_input' | 'ended' | 'unknown';
  let { status, size = 'md' }: { status: Status; size?: 'sm' | 'md' | 'lg' } = $props();
  const px = $derived( size === 'sm' ? 12 : size === 'lg' ? 18 : 14 );
</script>

<StatusIcon {status} size={px} />
