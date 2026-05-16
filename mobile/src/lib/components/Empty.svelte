<script lang="ts">
  /**
   * Empty state genérico, reutilizable. Acepta:
   *  - icon: emoji o texto pequeño que se muestra grande
   *  - title: heading
   *  - description: detalle opcional (puede usar slot)
   *  - steps: lista de pasos onboarding
   *  - action: { label, onclick } botón principal
   */
  type Action = { label: string; onclick: () => void; variant?: 'primary' | 'secondary' };

  let {
    icon = '🪔',
    title,
    description = '',
    steps = [],
    action,
    secondary
  }: {
    icon?: string;
    title: string;
    description?: string;
    steps?: string[];
    action?: Action;
    secondary?: Action;
  } = $props();
</script>

<div class="px-6 py-12 flex flex-col items-center text-center">
  <div class="text-6xl mb-4 opacity-60">{icon}</div>
  <h2 class="text-lg font-semibold mb-2">{title}</h2>
  {#if description}
    <p class="text-sm text-text-secondary mb-4 max-w-xs">{@html description}</p>
  {/if}

  {#if steps.length > 0}
    <ol class="text-left bg-bg-card border border-bg-line rounded-xl px-4 py-3 mb-5 w-full max-w-xs space-y-2.5">
      {#each steps as step, i}
        <li class="flex gap-3 items-start text-xs text-text-primary">
          <span class="bg-accent/20 text-accent rounded-full w-5 h-5 flex items-center justify-center text-[10px] shrink-0 mt-0.5">{i + 1}</span>
          <span class="flex-1">{@html step}</span>
        </li>
      {/each}
    </ol>
  {/if}

  <div class="flex gap-2">
    {#if action}
      <button
        onclick={action.onclick}
        class="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium"
      >{action.label}</button>
    {/if}
    {#if secondary}
      <button
        onclick={secondary.onclick}
        class="bg-bg-card border border-bg-line text-text-secondary px-4 py-2 rounded-lg text-sm"
      >{secondary.label}</button>
    {/if}
  </div>
</div>
