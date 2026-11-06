<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { DemoState } from './types.ts';

  /*
   * Row of a list (mail, journal): the start (box, avatar), the body on the whole width, and the
   * actions that appear on hover or keyboard focus, as in Gmail. The list gives the role and the
   * keyboard moves (J, K); a click on the row opens it, a click on a control inside does not.
   */

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onclick'> & {
    /** The row is open, or ticked in a selection. */
    selected?: boolean | undefined;
    /** Already read: lighter text. */
    read?: boolean | undefined;
    start?: Snippet | undefined;
    children: Snippet;
    actions?: Snippet | undefined;
    onopen?: (() => void) | undefined;
    'data-etat'?: Extract<DemoState, 'survol'> | undefined;
  };

  let {
    selected = false,
    read = false,
    start,
    children,
    actions,
    onopen,
    class: className,
    ...rest
  }: Props = $props();

  const CONTROL = 'button, a, input, label, [role="menuitem"], [data-no-open]';

  function onclick(event: MouseEvent) {
    if (!onopen) return;
    if (event.target instanceof Element && event.target.closest(CONTROL)) return;
    onopen();
  }
</script>

<!-- The list gives the keyboard (Enter, J, K) and the role of its rows. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div {...rest} class={['rangee', { sel: selected, lu: read, ouvrable: onopen }, className]} {onclick}>
  {#if start}<span class="debut">{@render start()}</span>{/if}
  <div class="corps">{@render children()}</div>
  {#if actions}<div class="survol">{@render actions()}</div>{/if}
</div>

<style>
  .rangee {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 8px 18px;
    border-bottom: 1px solid var(--bordure);
    outline: none;
  }
  .ouvrable {
    cursor: pointer;
  }
  .rangee:hover,
  .rangee[data-etat='survol'] {
    background: var(--survol);
  }
  .rangee.sel {
    background: var(--accent-doux);
  }
  .rangee.sel::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent-texte);
  }
  .rangee:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-texte);
  }
  .debut {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }
  .corps {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
  }
  .lu .corps {
    color: var(--texte-2);
  }
  .survol {
    position: absolute;
    top: 50%;
    right: 14px;
    display: none;
    gap: 2px;
    padding: 2px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    box-shadow: var(--ombre-1);
    transform: translateY(-50%);
  }
  .rangee:hover .survol,
  .rangee:focus-within .survol,
  .rangee[data-etat='survol'] .survol {
    display: flex;
  }
  @media (max-width: 767.98px) {
    .rangee {
      align-items: flex-start;
      min-height: 72px;
      padding: 10px 14px;
    }
  }
  /* No hover on touch screens: the actions are elsewhere (bar of the reading, swipes). */
  @media (hover: none) {
    .rangee:hover .survol {
      display: none;
    }
  }
</style>
