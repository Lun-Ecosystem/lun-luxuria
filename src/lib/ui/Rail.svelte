<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /*
   * Navigation column. `principal`: the rail of the app (brand and main action on top, links and
   * groups, Journal, Settings and the service card at the bottom). `themes`: the column of the
   * settings pages, under its title.
   */

  type Props = {
    /** Accessible name of the navigation. */
    label: string;
    variant?: 'principal' | 'themes' | undefined;
    /** Title of a themes column (« Réglages »). */
    title?: string | undefined;
    /** Brand and main action, above the links. */
    header?: Snippet | undefined;
    children: Snippet;
    /** Pinned at the bottom (Journal, Réglages, ServiceCard). */
    footer?: Snippet | undefined;
    class?: string | undefined;
  };

  let { label, variant = 'principal', title, header, children, footer, class: className }: Props = $props();
</script>

<nav class={['rail', variant, className]} aria-label={label}>
  {#if title}<h2 class="titre">{title}</h2>{/if}
  {#if header}<div class="tete">{@render header()}</div>{/if}
  <div class="liens">{@render children()}</div>
  {#if footer}<div class="bas">{@render footer()}</div>{/if}
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    padding: 14px 0;
    background: var(--fond);
    border-right: 1px solid var(--bordure);
  }
  .principal {
    width: 232px;
  }
  .themes {
    width: 220px;
    padding: 18px 0;
  }
  /* The side padding sits on each part, so the bar of the current link (10 px out) is not clipped. */
  .tete,
  .liens,
  .bas {
    padding-left: 10px;
    padding-right: 10px;
  }
  .titre {
    margin: 0 20px 10px;
    font: 500 24px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .tete {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 12px;
  }
  .liens {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
  }
  .bas {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: auto 10px 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--bordure);
  }
</style>
