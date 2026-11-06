<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { ICON_STROKE, X } from './Icon.ts';
  import { mondeOf } from './monde.ts';

  /*
   * Window above the page (Bits Dialog, portalled, focus trapped, Escape and the veil close it):
   * creating or editing an event or a task, details of an authorization.
   */

  type Props = {
    /** World of the window when no ancestor carries `data-monde` (it opens in a portal). */
    monde?: string | undefined;
    title: string;
    description?: string | undefined;
    open?: boolean | undefined;
    /** Optional trigger: spread `props` on a button. */
    trigger?: Snippet<[{ props: Record<string, unknown> }]> | undefined;
    /** Width of the window, in px (440 by default). */
    width?: number | undefined;
    children?: Snippet<[{ close: () => void }]> | undefined;
    /** Actions at the bottom right; the main one last. */
    footer?: Snippet<[{ close: () => void }]> | undefined;
  };

  let {
    monde: fallback,
    title,
    description,
    open = $bindable(false),
    trigger,
    width = 440,
    children,
    footer,
  }: Props = $props();

  let probe = $state<HTMLElement | null>(null);
  const monde = $derived(mondeOf(probe) ?? fallback);
  const close = () => (open = false);
</script>

<span class="sonde" bind:this={probe} hidden></span>
<Dialog.Root bind:open>
  {#if trigger}
    <Dialog.Trigger>
      {#snippet child({ props })}{@render trigger({ props })}{/snippet}
    </Dialog.Trigger>
  {/if}
  <Dialog.Portal>
    <Dialog.Overlay>
      {#snippet child({ props })}<div {...props} class="voile"></div>{/snippet}
    </Dialog.Overlay>
    <Dialog.Content>
      {#snippet child({ props })}
        <div {...props} class="fenetre" data-monde={monde} style:--largeur="{width}px">
          <header>
            <div>
              <Dialog.Title>
                {#snippet child({ props: titleProps })}<h2 {...titleProps} class="titre">
                    {title}
                  </h2>{/snippet}
              </Dialog.Title>
              {#if description}
                <Dialog.Description>
                  {#snippet child({ props: descProps })}<p {...descProps} class="desc">
                      {description}
                    </p>{/snippet}
                </Dialog.Description>
              {/if}
            </div>
            <Dialog.Close>
              {#snippet child({ props: closeProps })}
                <button {...closeProps} type="button" class="fermer" aria-label="Fermer">
                  <X size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                </button>
              {/snippet}
            </Dialog.Close>
          </header>
          {#if children}<div class="corps">{@render children({ close })}</div>{/if}
          {#if footer}<footer>{@render footer({ close })}</footer>{/if}
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .voile {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--fond) 70%, transparent);
    animation: fondu 140ms ease-out;
  }
  .fenetre {
    box-sizing: border-box;
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 51;
    width: min(var(--largeur), calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 20px 22px 16px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-3);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 300 14px/1.5 var(--sans);
    transform: translate(-50%, -50%);
    outline: none;
    animation: apparait 160ms ease-out;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  header > div {
    flex: 1;
    min-width: 0;
  }
  .titre {
    margin: 0 0 6px;
    font: 500 22px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .desc {
    margin: 0 0 16px;
    font-size: 13.5px;
    color: var(--texte-2);
  }
  .fermer {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    margin: -2px -6px 0 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--r-1);
    background: none;
    color: var(--texte-3);
    cursor: pointer;
  }
  .fermer:hover {
    background: var(--survol);
    color: var(--texte);
  }
  .fermer:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .corps {
    margin-bottom: 16px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  @keyframes fondu {
    from {
      opacity: 0;
    }
  }
  @keyframes apparait {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 6px));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .voile,
    .fenetre {
      animation: none;
    }
  }
  @media (max-width: 767.98px) {
    footer {
      flex-direction: column-reverse;
    }
    footer :global(.btn) {
      width: 100%;
    }
  }
</style>
