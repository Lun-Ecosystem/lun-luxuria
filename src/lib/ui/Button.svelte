<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';
  import type { ButtonVariant, Size } from './types.ts';

  type Props = Omit<HTMLButtonAttributes, 'children'> & {
    variant?: ButtonVariant | undefined;
    size?: Size | undefined;
    icon?: IconComponent | undefined;
    /** Action in progress: keeps its width, shows a spinner, ignores clicks. */
    loading?: boolean | undefined;
    /** A link looking like the button (same classes), for a navigation. */
    href?: string | undefined;
    children?: Snippet | undefined;
  };

  let {
    variant = 'secondaire',
    size = 'normal',
    icon: Icon,
    loading = false,
    disabled = false,
    type = 'button',
    href,
    class: className,
    onclick,
    children,
    ...rest
  }: Props = $props();

  const handle: HTMLButtonAttributes['onclick'] = (event) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  };
</script>

<svelte:element
  this={href ? 'a' : 'button'}
  {href}
  {...rest}
  type={href ? undefined : type}
  class={['btn', variant, size, className]}
  {disabled}
  aria-busy={loading || undefined}
  aria-disabled={loading || undefined}
  onclick={handle}
>
  {#if loading}
    <span class="spin" aria-hidden="true"></span>
  {:else if Icon}
    <Icon size={size === 'petit' ? 14 : 16} strokeWidth={ICON_STROKE} aria-hidden="true" />
  {/if}
  {@render children?.()}
</svelte:element>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px;
    border: 1px solid transparent;
    border-radius: var(--r-2);
    background: none;
    color: var(--texte);
    font: 400 13.5px/1 var(--sans);
    white-space: nowrap;
    cursor: pointer;
    text-decoration: none;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }
  .btn :global(svg) {
    flex: none;
  }

  .petit {
    height: 28px;
    padding: 0 10px;
    gap: 6px;
    font-size: 12.5px;
    border-radius: var(--r-1);
  }
  .grand {
    height: 42px;
    padding: 0 20px;
    font-size: 14.5px;
  }

  .principal {
    background: var(--accent);
    border-color: var(--accent);
  }
  .principal:not(:disabled):hover,
  .principal[data-etat='survol'] {
    background: var(--accent-survol);
    border-color: var(--accent-survol);
  }

  .doux {
    background: var(--accent-doux);
    border-color: var(--accent-bord);
    color: var(--accent-texte);
  }
  .doux:not(:disabled):hover,
  .doux[data-etat='survol'] {
    background: color-mix(in srgb, var(--accent) 36%, transparent);
    border-color: var(--accent-bord);
    color: var(--texte);
  }

  .secondaire {
    background: var(--surface-2);
    border-color: var(--bordure-forte);
  }
  .secondaire:not(:disabled):hover,
  .secondaire[data-etat='survol'] {
    background: var(--surface-3);
    border-color: var(--bordure-forte);
  }

  .fantome {
    color: var(--texte-2);
  }
  .fantome:not(:disabled):hover,
  .fantome[data-etat='survol'] {
    background: var(--survol);
    border-color: transparent;
    color: var(--texte);
  }
  .fantome:not(:disabled):active,
  .secondaire:not(:disabled):active {
    background: var(--appui);
  }

  .danger {
    border-color: var(--danger-bord);
    color: var(--danger);
  }
  .danger:not(:disabled):hover,
  .danger[data-etat='survol'] {
    background: var(--danger-doux);
    border-color: var(--danger-bord);
  }

  .danger-plein {
    background: var(--danger-plein);
    border-color: var(--danger-plein);
  }
  .danger-plein:not(:disabled):hover,
  .danger-plein[data-etat='survol'] {
    background: color-mix(in srgb, var(--danger-plein) 86%, var(--texte));
    border-color: color-mix(in srgb, var(--danger-plein) 86%, var(--texte));
  }

  .btn:focus-visible,
  .btn[data-etat='focus'] {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }

  .btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .btn[aria-busy='true'] {
    cursor: progress;
  }

  .spin {
    flex: none;
    width: 14px;
    height: 14px;
    border: 2px solid color-mix(in srgb, currentColor 35%, transparent);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: tourne 800ms linear infinite;
  }
  .petit .spin {
    width: 12px;
    height: 12px;
  }
  @keyframes tourne {
    to {
      transform: rotate(1turn);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 2400ms;
    }
  }
</style>
