<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /*
   * Card of a settings page: its title and what it is for, its state first (a badge on the right),
   * then its rows (SettingsRow).
   */

  type Props = {
    title: string;
    description?: string | undefined;
    /** State or action of the whole card, on the right of the title. */
    aside?: Snippet | undefined;
    children?: Snippet | undefined;
    class?: string | undefined;
  };

  let { title, description, aside, children, class: className }: Props = $props();
  const uid = $props.id();
</script>

<section class={['carte', { seule: !children }, className]} aria-labelledby="{uid}-titre">
  <header>
    <div class="titres">
      <h3 id="{uid}-titre">{title}</h3>
      {#if description}<p>{description}</p>{/if}
    </div>
    {#if aside}<div class="droite">{@render aside()}</div>{/if}
  </header>
  {@render children?.()}
</section>

<style>
  .carte {
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--bordure);
  }
  .seule header {
    border-bottom: 0;
  }
  .titres {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font: 500 15px/1.35 var(--sans);
  }
  p {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .droite {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  @media (max-width: 767.98px) {
    header {
      flex-wrap: wrap;
      padding: 14px;
    }
  }
</style>
