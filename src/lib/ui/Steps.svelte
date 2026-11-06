<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Check, ICON_STROKE } from './Icon.ts';

  /** Numbered steps of a standalone page (« Navigateur relié », « Autoriser »). */

  type Props = {
    steps: string[];
    /** Index of the current step; the ones before are done. */
    current: number;
    class?: string | undefined;
  };

  let { steps, current, class: className }: Props = $props();
</script>

<ol class={['etapes', className]} aria-label="Étapes">
  {#each steps as step, i (step)}
    {#if i > 0}<li class="tiret" aria-hidden="true"></li>{/if}
    <li
      class={['etape', { fait: i < current, cour: i === current }]}
      aria-current={i === current ? 'step' : undefined}
    >
      <span class="pt" aria-hidden="true">
        {#if i < current}<Check size={12} strokeWidth={2.25} />{:else}{i + 1}{/if}
      </span>
      {step}{#if i < current}<span class="sr"> (fait)</span>{/if}
    </li>
  {/each}
</ol>

<style>
  .etapes {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--texte-3);
    font: 400 12.5px var(--sans);
  }
  .etape {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .cour {
    color: var(--texte);
  }
  .pt {
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 22px;
    border: 1px solid var(--bordure-forte);
    border-radius: 50%;
    font-size: 11px;
  }
  .fait .pt {
    background: var(--ok-doux);
    border-color: var(--ok-bord);
    color: var(--ok);
  }
  .cour .pt {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--texte);
  }
  .tiret {
    width: 22px;
    height: 1px;
    background: var(--bordure-forte);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (max-width: 767.98px) {
    .etape:not(.cour) {
      font-size: 0;
      gap: 0;
    }
    .etape:not(.cour) .pt {
      font-size: 11px;
    }
  }
</style>
