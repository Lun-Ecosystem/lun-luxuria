<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /*
   * Row of a settings card: label, help under it, control on the right. The control is named by
   * the label: `aria-labelledby={labelId}` (a Switch, a Slider).
   */

  type Props = {
    label: string;
    /** Help or state under the label. */
    hint?: string | Snippet | undefined;
    /** Replaces the hint (a refused value), announced. */
    error?: string | null | undefined;
    /** Before the text (an avatar, an icon). */
    start?: Snippet | undefined;
    children?: Snippet<[{ labelId: string }]> | undefined;
    class?: string | undefined;
  };

  let { label, hint, error, start, children, class: className }: Props = $props();
  const uid = $props.id();
  const labelId = `${uid}-libelle`;
</script>

<div class={['ligne', className]}>
  {#if start}<span class="debut">{@render start()}</span>{/if}
  <div class="texte">
    <div class="libelle" id={labelId}>{label}</div>
    {#if error}
      <div class="aide erreur" role="alert">{error}</div>
    {:else if typeof hint === 'string'}
      <div class="aide">{hint}</div>
    {:else if hint}
      <div class="aide">{@render hint()}</div>
    {/if}
  </div>
  {#if children}<div class="controle">{@render children({ labelId })}</div>{/if}
</div>

<style>
  .ligne {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--bordure);
  }
  .ligne:last-child {
    border-bottom: 0;
  }
  .debut {
    display: flex;
    flex: none;
    margin-right: -6px;
  }
  .texte {
    flex: 1;
    min-width: 0;
  }
  .libelle {
    font: 400 14px/1.4 var(--sans);
    overflow-wrap: anywhere;
  }
  .aide {
    max-width: 470px;
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .erreur {
    color: var(--danger);
  }
  .controle {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  @media (max-width: 767.98px) {
    .ligne {
      flex-wrap: wrap;
      gap: 10px 14px;
      padding: 14px;
    }
  }
</style>
