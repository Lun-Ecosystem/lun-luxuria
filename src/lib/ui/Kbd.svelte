<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<kbd class="kbd">{@render children()}</kbd>

<style>
  .kbd {
    display: inline-block;
    min-width: 18px;
    padding: 0 5px;
    font: 500 11px/17px var(--sans);
    text-align: center;
    color: var(--texte-3);
    border: 1px solid var(--bordure-forte);
    border-bottom-width: 2px;
    border-radius: 5px;
  }
</style>
