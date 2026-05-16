<script lang="ts">
  let { label, value, sub }: { label: string; value: string; sub?: string } = $props();
</script>

<div class="bg-bg-card rounded-xl p-3 border border-bg-line">
  <div class="text-xs text-text-secondary uppercase tracking-wide">{label}</div>
  <div class="text-2xl font-semibold text-text-primary mt-1">{value}</div>
  {#if sub}<div class="text-xs text-text-muted mt-0.5">{sub}</div>{/if}
</div>
