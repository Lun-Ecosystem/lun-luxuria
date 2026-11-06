<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';
  import type { Tone } from './types.ts';

  type Props = {
    tone?: Tone | undefined;
    /** Status dot before the text (« Connecté »). */
    dot?: boolean | undefined;
    icon?: IconComponent | undefined;
    class?: string | undefined;
    children: Snippet;
  };

  let { tone = 'neutre', dot = false, icon: Icon, class: className, children }: Props = $props();
</script>

<span class={['pastille', tone, className]}>
  {#if Icon}
    <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
  {:else if dot}
    <span class="point" aria-hidden="true"></span>
  {/if}
  {@render children()}
</span>

<style>
  .pastille {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 22px;
    padding: 0 9px;
    border: 1px solid;
    border-radius: var(--r-rond);
    font: 400 12px/1 var(--sans);
    white-space: nowrap;
  }
  .pastille :global(svg) {
    flex: none;
  }
  .point {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .ok {
    color: var(--ok);
    background: var(--ok-doux);
    border-color: var(--ok-bord);
  }
  .attention {
    color: var(--attention);
    background: var(--attention-doux);
    border-color: var(--attention-bord);
  }
  .danger {
    color: var(--danger);
    background: var(--danger-doux);
    border-color: var(--danger-bord);
  }
  .info {
    color: var(--info);
    background: var(--info-doux);
    border-color: var(--info-bord);
  }
  .ia {
    color: var(--ia);
    background: var(--ia-doux);
    border-color: var(--ia-bord);
  }
  .accent {
    color: var(--accent-texte);
    background: var(--accent-doux);
    border-color: var(--accent-bord);
  }
  .neutre {
    color: var(--texte-2);
    background: var(--surface-2);
    border-color: var(--bordure-forte);
  }
</style>
