<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  import { CircleAlert, ICON_STROKE } from './Icon.ts';
  import { mondeOf } from './monde.ts';

  /*
   * Confirmation of what cuts an access or removes a data (Bits AlertDialog): never a native
   * `confirm`. Only the click on the confirmation button acts; Escape, the veil and « Annuler » close
   * without acting. The window waits for the action, and says why when it fails.
   */

  type Props = {
    /** World of the window when no ancestor carries `data-monde` (it opens in a portal). */
    monde?: string | undefined;
    title: string;
    message: string;
    confirmLabel: string;
    onconfirm: () => Promise<void>;
    cancelLabel?: string | undefined;
    /** `danger-plein` for what removes data for good. */
    confirmVariant?: 'danger' | 'danger-plein' | undefined;
    open?: boolean | undefined;
    /** Optional trigger: spread `props` on a button. */
    trigger?: Snippet<[{ props: Record<string, unknown> }]> | undefined;
    /** Where the focus goes on closing, when the action removed what opened the window. */
    returnFocus?: (() => HTMLElement | null | undefined) | undefined;
  };

  let {
    monde: fallback,
    title,
    message,
    confirmLabel,
    onconfirm,
    cancelLabel = 'Annuler',
    confirmVariant = 'danger',
    open = $bindable(false),
    trigger,
    returnFocus,
  }: Props = $props();

  let probe = $state<HTMLElement | null>(null);
  const monde = $derived(mondeOf(probe) ?? fallback);
  let fenetre = $state<HTMLElement | null>(null);
  let busy = $state(false);
  let failure = $state<string | null>(null);

  $effect(() => {
    if (open) failure = null;
  });

  async function confirm() {
    if (busy) return;
    busy = true;
    failure = null;
    try {
      await onconfirm();
      open = false;
    } catch (error) {
      failure = error instanceof Error && error.message ? error.message : 'L’action a échoué.';
    } finally {
      busy = false;
    }
  }
</script>

<span bind:this={probe} hidden></span>
<AlertDialog.Root
  bind:open={
    () => open,
    (next) => {
      // A pending action keeps the window open.
      if (!busy) open = next;
    }
  }
>
  {#if trigger}
    <AlertDialog.Trigger>
      {#snippet child({ props })}{@render trigger({ props })}{/snippet}
    </AlertDialog.Trigger>
  {/if}
  <AlertDialog.Portal>
    <AlertDialog.Overlay>
      {#snippet child({ props })}<div {...props} class="voile"></div>{/snippet}
    </AlertDialog.Overlay>
    <AlertDialog.Content
      onOpenAutoFocus={(event) => {
        // The harmless choice takes the focus: Enter never confirms by accident.
        event.preventDefault();
        fenetre?.querySelector<HTMLElement>('[data-annuler]')?.focus();
      }}
      onCloseAutoFocus={(event) => {
        const target = returnFocus?.();
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
    >
      {#snippet child({ props })}
        <div {...props} bind:this={fenetre} class="fenetre" data-monde={monde}>
          <AlertDialog.Title>
            {#snippet child({ props: titleProps })}<h2 {...titleProps} class="titre">{title}</h2>{/snippet}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {#snippet child({ props: descProps })}<p {...descProps} class="message">{message}</p>{/snippet}
          </AlertDialog.Description>
          {#if failure}
            <p class="echec" role="alert">
              <CircleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{failure}
            </p>
          {/if}
          <div class="actions">
            <AlertDialog.Cancel>
              {#snippet child({ props: cancelProps })}
                <Button {...cancelProps} data-annuler variant="secondaire" disabled={busy}>{cancelLabel}</Button>
              {/snippet}
            </AlertDialog.Cancel>
            <Button variant={confirmVariant} loading={busy} onclick={confirm}>{confirmLabel}</Button>
          </div>
        </div>
      {/snippet}
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

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
    width: min(440px, calc(100vw - 32px));
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
  .titre {
    margin: 0 0 6px;
    font: 500 22px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  .message {
    margin: 0 0 16px;
    font-size: 13.5px;
    color: var(--texte-2);
  }
  .echec {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -6px 0 14px;
    font-size: 12.5px;
    color: var(--danger);
  }
  .echec :global(svg) {
    flex: none;
  }
  .actions {
    display: flex;
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
    .actions {
      flex-direction: column-reverse;
    }
    .actions :global(.btn) {
      width: 100%;
    }
  }
</style>
