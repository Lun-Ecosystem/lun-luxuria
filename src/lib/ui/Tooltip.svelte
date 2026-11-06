<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import Kbd from './Kbd.svelte';

  /*
   * Tooltip in a layer above the page (Bits Tooltip, portalled): the name of a control and its
   * shortcut. It only repeats what the control already says to screen readers (its aria-label).
   */

  type Props = {
    label: string;
    /** Shortcut shown after the label (`E`, `#`). */
    shortcut?: string | undefined;
    side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
    /** The control: spread `props` on it, merged with its own handlers (mergeProps). */
    children: Snippet<[{ props: Record<string, unknown> }]>;
  };

  let { label, shortcut, side = 'top', children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={350} skipDelayDuration={250}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render children({ props })}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content {side} sideOffset={6} collisionPadding={8}>
        {#snippet child({ wrapperProps, props })}
          <div {...wrapperProps}>
            <div {...props} class="bulle">
              {label}
              {#if shortcut}<Kbd>{shortcut}</Kbd>{/if}
            </div>
          </div>
        {/snippet}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  .bulle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border-radius: var(--r-1);
    background: var(--surface-3);
    color: var(--texte);
    font: 400 12px/1.4 var(--sans);
    white-space: nowrap;
    box-shadow: var(--ombre-2);
  }
</style>
