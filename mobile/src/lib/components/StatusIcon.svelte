<script lang="ts">
  import { Loader2, CircleCheck, CirclePause, CircleSlash, Circle } from 'lucide-svelte';

  type Status = 'working' | 'idle' | 'needs_input' | 'ended' | 'unknown';
  let { status, size = 14 }: { status: Status; size?: number } = $props();
</script>

{#if status === 'working'}
  <Loader2 {size} class="text-status-working spin" strokeWidth={2.25} />
{:else if status === 'idle'}
  <CircleCheck {size} class="text-status-idle" strokeWidth={2} />
{:else if status === 'needs_input'}
  <CirclePause {size} class="text-status-needs_input pulse-dot" strokeWidth={2} />
{:else if status === 'ended'}
  <CircleSlash {size} class="text-text-muted" strokeWidth={1.5} />
{:else}
  <Circle {size} class="text-text-muted" strokeWidth={1.5} />
{/if}
