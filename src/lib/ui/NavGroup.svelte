<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Group of links in a rail (« Boîtes », « Système »), with an optional action on its title. */

  type Props = {
    title: string;
    /** Small action at the end of the title (an IconButton « Nouvelle boîte »). */
    action?: Snippet | undefined;
    children: Snippet;
  };

  let { title, action, children }: Props = $props();
  const uid = $props.id();
</script>

<div class="groupe" role="group" aria-labelledby="{uid}-titre">
  <div class="titre">
    <span id="{uid}-titre">{title}</span>
    {#if action}{@render action()}{/if}
  </div>
  {@render children()}
</div>

<style>
  .groupe {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .titre {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 34px;
    padding: 10px 4px 0 10px;
    font: 500 10.5px var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
</style>
