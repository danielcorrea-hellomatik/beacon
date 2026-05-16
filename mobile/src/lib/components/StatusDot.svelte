<script lang="ts">
  type Status = 'working' | 'idle' | 'needs_input' | 'ended' | 'unknown';
  let { status }: { status: Status } = $props();
  const color = $derived(
    status === 'working'     ? 'bg-status-working animate-pulse' :
    status === 'idle'        ? 'bg-status-idle' :
    status === 'needs_input' ? 'bg-status-needs_input animate-pulse' :
                               'bg-status-ended'
  );
</script>

<span class="inline-block w-2 h-2 rounded-full {color}"></span>
