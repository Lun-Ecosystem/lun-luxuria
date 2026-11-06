<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';

  type Props = Omit<HTMLButtonAttributes, 'children' | 'aria-pressed'> & {
    /** Filter applied. */
    on?: boolean | undefined;
    icon?: IconComponent | undefined;
    /** Number of matching items, after the label. */
    count?: number | undefined;
    children: Snippet;
  };

  let {
    on = false,
    icon: Icon,
    count,
    type = 'button',
    class: className,
    children,
    ...rest
  }: Props = $props();
</script>

<button {...rest} {type} class={['chip', { on }, className]} aria-pressed={on}>
  {#if Icon}<Icon size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{/if}
  {@render children()}
  {#if count !== undefined}<span class="compte">{count}</span>{/if}
</button>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-rond);
    background: var(--surface-2);
    color: var(--texte-2);
    font: 400 12.5px/1 var(--sans);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }
  .chip :global(svg) {
    flex: none;
  }
  /* Each hover names its border: base.css still styles bare buttons for the views not yet redone. */
  .chip:enabled:hover,
  .chip[data-etat='survol'] {
    background: var(--surface-3);
    border-color: var(--bordure-forte);
    color: var(--texte);
  }
  .chip.on,
  .chip.on:enabled:hover {
    background: var(--accent-doux);
    border-color: var(--accent-bord);
    color: var(--texte);
  }
  .compte {
    font-variant-numeric: tabular-nums;
    color: var(--texte-3);
  }
  .on .compte {
    color: var(--accent-texte);
  }
  .chip:focus-visible,
  .chip[data-etat='focus'] {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .chip:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
</style>
