<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';
  import type { DemoState } from './types.ts';

  /*
   * Link of a rail or of the settings column: icon (or the color of a box), label, counter. The
   * current page is marked by the accent and a bar on the left, and by `aria-current`.
   */

  type Props = Omit<HTMLAnchorAttributes, 'children'> & {
    href: string;
    label: string;
    icon?: IconComponent | undefined;
    /** Color of a box (a data value), instead of an icon. */
    color?: string | undefined;
    /** A number, or a lower bound such as `50+`. */
    count?: number | string | undefined;
    /** `ia`: what waits for a validation. */
    countTone?: 'neutre' | 'ia' | undefined;
    current?: boolean | undefined;
    'data-etat'?: DemoState | undefined;
  };

  let {
    href,
    label,
    icon: Icon,
    color,
    count,
    countTone = 'neutre',
    current = false,
    class: className,
    ...rest
  }: Props = $props();
</script>

<a {...rest} {href} class={['lien', { on: current }, className]} aria-current={current ? 'page' : undefined}>
  {#if Icon}
    <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
  {:else if color}
    <span class="pastille" style:background={color} aria-hidden="true"></span>
  {/if}
  <span class="texte">{label}</span>
  {#if count}
    <span class={['compte', countTone]}>{count}</span>
  {/if}
</a>

<style>
  .lien {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--r-2);
    color: var(--texte-2);
    font: 400 13.5px var(--sans);
    text-decoration: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  .lien :global(svg) {
    flex: none;
  }
  .lien:hover,
  .lien[data-etat='survol'] {
    background: var(--survol);
    color: var(--texte);
  }
  .lien.on {
    background: var(--accent-doux);
    color: var(--texte);
  }
  .lien.on::before {
    content: '';
    position: absolute;
    left: -10px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent-texte);
  }
  .lien:focus-visible,
  .lien[data-etat='focus'] {
    outline: 2px solid var(--accent-texte);
    outline-offset: -2px;
  }
  .pastille {
    flex: none;
    width: 8px;
    height: 8px;
    margin: 0 4px;
    border-radius: 2px;
  }
  .texte {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compte {
    margin-left: auto;
    font: 400 12px var(--sans);
    font-variant-numeric: tabular-nums;
    color: var(--texte-3);
  }
  .on .compte {
    color: var(--texte);
  }
  .compte.ia {
    padding: 0 6px;
    border: 1px solid var(--ia-bord);
    border-radius: 9px;
    background: var(--ia-doux);
    color: var(--ia);
    font-size: 11px;
    line-height: 16px;
  }
</style>
