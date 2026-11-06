<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { ICON_STROKE } from './Icon.ts';
  import type { NavItem } from './types.ts';

  /** Navigation bar at the bottom of the mobile layout (under 768 px): four destinations at most. */

  type Props = {
    items: NavItem[];
    /** `href` of the current destination. */
    current?: string | undefined;
    label?: string | undefined;
    class?: string | undefined;
  };

  let { items, current, label = 'Navigation principale', class: className }: Props = $props();
</script>

<nav class={['barre', className]} aria-label={label} style:--colonnes={items.length}>
  {#each items as item (item.href)}
    {@const Icon = item.icon}
    {@const on = item.href === current}
    <a href={item.href} class={['dest', { on }]} aria-current={on ? 'page' : undefined}>
      <span class="ic">
        <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
        {#if item.count}
          <em class={item.countTone ?? 'neutre'}>{item.count}<span class="sr"> en attente</span></em>
        {/if}
      </span>
      {item.label}
    </a>
  {/each}
</nav>

<style>
  .barre {
    display: grid;
    grid-template-columns: repeat(var(--colonnes), 1fr);
    height: calc(68px + env(safe-area-inset-bottom, 0px));
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--surface-1);
    border-top: 1px solid var(--bordure);
  }
  .dest {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--texte-3);
    font: 400 11px var(--sans);
    text-decoration: none;
  }
  .dest.on {
    color: var(--texte);
  }
  .dest:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: -4px;
    border-radius: var(--r-2);
  }
  .ic {
    position: relative;
    display: grid;
    place-items: center;
    width: 56px;
    height: 28px;
    border-radius: 14px;
    transition: background-color 120ms ease;
  }
  .on .ic {
    background: var(--accent-doux);
    color: var(--accent-texte);
  }
  em {
    position: absolute;
    top: -3px;
    right: 8px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--texte-2);
    color: var(--surface-1);
    font: 500 10px/15px var(--sans);
    font-style: normal;
    text-align: center;
  }
  em.ia {
    background: var(--ia);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
