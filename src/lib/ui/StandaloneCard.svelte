<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  /*
   * Standalone page, seen before being in the app (pairing, authorization): ink background with the
   * world's halo on top, the brand and the steps in the header, one centered card.
   */

  type Props = {
    title: string;
    /** First sentence under the title. */
    lead?: string | undefined;
    /** The product's name, in its header (« Lun'Xxx »). */
    brand: string;
    /** Steps on the right of the header (Steps). */
    steps?: Snippet | undefined;
    /** Above the title (the two linked marks of an authorization). */
    top?: Snippet | undefined;
    children: Snippet;
    /** Under the card (a note, a link). */
    footer?: Snippet | undefined;
    /** Width of the card, in px. */
    width?: number | undefined;
    class?: string | undefined;
  };

  let {
    title,
    lead,
    brand,
    steps,
    top,
    children,
    footer,
    width = 440,
    class: className,
  }: Props = $props();
  const uid = $props.id();
</script>

<div class={['seul', className]}>
  <header class="tetiere">
    <span class="marque"><i aria-hidden="true"></i>{brand}</span>
    {#if steps}<div class="etapes">{@render steps()}</div>{/if}
  </header>
  <main class="centre">
    <section class="carte" style:--largeur="{width}px" aria-labelledby="{uid}-titre">
      {#if top}{@render top()}{/if}
      <h1 id="{uid}-titre">{title}</h1>
      {#if lead}<p class="lead">{lead}</p>{/if}
      {@render children()}
    </section>
    {#if footer}<div class="pied">{@render footer()}</div>{/if}
  </main>
</div>

<style>
  .seul {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background:
      radial-gradient(
        ellipse 60% 50% at 50% 0%,
        color-mix(in srgb, var(--accent) 10%, transparent),
        transparent 70%
      ),
      var(--fond);
    color: var(--texte);
  }
  .tetiere {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px 16px;
    padding: 18px 24px;
  }
  .marque {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font: 500 19px var(--serif);
    font-variant-numeric: lining-nums;
  }
  .marque i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-doux);
  }
  .etapes {
    margin-left: auto;
  }
  .centre {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 0 16px 40px;
  }
  .carte {
    box-sizing: border-box;
    width: min(var(--largeur), 100%);
    padding: 28px 30px 24px;
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: 18px;
    box-shadow: var(--ombre-2);
  }
  h1 {
    margin: 0 0 8px;
    font: 500 28px/1.15 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .lead {
    margin: 0 0 20px;
    font-size: 14px;
    color: var(--texte-2);
  }
  .pied {
    font-size: 12px;
    color: var(--texte-3);
    text-align: center;
  }
  @media (max-width: 767.98px) {
    .tetiere {
      padding: 14px 20px;
    }
    .centre {
      justify-content: flex-start;
      padding: 12px 16px 32px;
    }
    .carte {
      padding: 22px 20px 20px;
    }
  }
</style>
