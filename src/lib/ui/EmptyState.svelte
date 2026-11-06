<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Check, ICON_STROKE, type IconComponent } from './Icon.ts';

  /*
   * Empty state that explains: what happened, where things went, what to do next. `grand` fills a
   * whole page (the queue to validate, emptied), `normal` sits in a card.
   */

  type Props = {
    title: string;
    message?: string | undefined;
    icon?: IconComponent | undefined;
    tone?: 'ok' | 'neutre' | undefined;
    size?: 'normal' | 'grand' | undefined;
    /** Figures of the day, actions (« Voir le journal »). */
    children?: Snippet | undefined;
    class?: string | undefined;
  };

  let {
    title,
    message,
    icon: Icon = Check,
    tone = 'ok',
    size = 'normal',
    children,
    class: className,
  }: Props = $props();
</script>

<div class={['vide', tone, size, className]}>
  <span class="rond" aria-hidden="true">
    <Icon size={size === 'grand' ? 28 : 20} strokeWidth={ICON_STROKE} />
  </span>
  <h2 class="titre">{title}</h2>
  {#if message}<p>{message}</p>{/if}
  {#if children}<div class="suite">{@render children()}</div>{/if}
</div>

<style>
  .vide {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px 20px;
    text-align: center;
  }
  .rond {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    margin-bottom: 12px;
    border-radius: 50%;
  }
  .ok .rond {
    background: var(--ok-doux);
    color: var(--ok);
  }
  .neutre .rond {
    background: var(--surface-2);
    color: var(--texte-2);
  }
  .titre {
    margin: 0 0 4px;
    font: 500 22px/1.2 var(--serif);
    font-variant-numeric: lining-nums;
  }
  p {
    max-width: 340px;
    margin: 0 0 14px;
    font-size: 13.5px;
    color: var(--texte-2);
  }
  .suite {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .grand {
    gap: 8px;
    padding: 40px 20px;
  }
  .grand .rond {
    width: 64px;
    height: 64px;
    margin-bottom: 6px;
  }
  .grand.ok .rond {
    border: 1px solid var(--ok-bord);
  }
  .grand .titre {
    margin: 0;
    font-size: 26px;
  }
  .grand p {
    max-width: 420px;
    margin: 0;
  }
  .grand .suite {
    margin-top: 14px;
  }
</style>
