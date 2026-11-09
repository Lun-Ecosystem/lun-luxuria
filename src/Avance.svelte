<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { Snippet } from 'svelte';
  import { ICON_STROKE } from './lib/ui/index.ts';

  /* What the kit has not: the rest of a theme, folded under its everyday settings and always there. */

  let { what, children }: { what: string; children: Snippet } = $props();
</script>

<details class="avance">
  <summary>
    Réglages avancés : {what}
    <ChevronRight size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
  </summary>
  <div class="dedans">{@render children()}</div>
</details>

<style>
  .avance {
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    border-radius: var(--r-3);
    list-style: none;
    font-size: 13.5px;
    color: var(--texte-2);
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    color: var(--texte);
  }
  summary:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  summary :global(svg) {
    flex: none;
    color: var(--texte-3);
    transition: rotate 120ms ease;
  }
  .avance[open] summary :global(svg) {
    rotate: 90deg;
  }
  @media (prefers-reduced-motion: reduce) {
    summary :global(svg) {
      transition: none;
    }
  }
  .dedans {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 2px 12px 14px;
  }
</style>
