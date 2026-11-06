<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CircleAlert, ICON_STROKE, type IconComponent, TriangleAlert } from './Icon.ts';

  /*
   * State banner at the top of the page concerned: what goes wrong, what still works, and the action
   * that repairs it.
   */

  type Props = {
    tone?: 'danger' | 'attention' | 'info' | undefined;
    title: string;
    /** What still works, or what to do. */
    children?: Snippet | undefined;
    /** The repairing action, at the end (a Button). */
    action?: Snippet | undefined;
    icon?: IconComponent | undefined;
    class?: string | undefined;
  };

  let { tone = 'danger', title, children, action, icon, class: className }: Props = $props();

  const Icon = $derived(icon ?? (tone === 'danger' ? CircleAlert : TriangleAlert));
</script>

<div class={['bandeau', tone, className]} role={tone === 'info' ? 'status' : 'alert'}>
  <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" class="ico" />
  <p>
    <b>{title}</b>
    {#if children}<span class="detail">{@render children()}</span>{/if}
  </p>
  {#if action}<span class="action">{@render action()}</span>{/if}
</div>

<style>
  .bandeau {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid;
    border-radius: var(--r-2);
    color: var(--texte);
  }
  .danger {
    background: var(--danger-doux);
    border-color: var(--danger-bord);
  }
  .attention {
    background: var(--attention-doux);
    border-color: var(--attention-bord);
  }
  .info {
    background: var(--info-doux);
    border-color: var(--info-bord);
  }
  .bandeau :global(.ico) {
    flex: none;
    align-self: flex-start;
    margin-top: 2px;
  }
  .danger :global(.ico) {
    color: var(--danger);
  }
  .attention :global(.ico) {
    color: var(--attention);
  }
  .info :global(.ico) {
    color: var(--info);
  }
  p {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 13.5px;
  }
  b {
    font-weight: 500;
  }
  .detail {
    display: block;
    font-size: 12.5px;
    color: var(--texte-2);
  }
  .action {
    flex: none;
  }
  @media (max-width: 767.98px) {
    .bandeau {
      flex-wrap: wrap;
    }
    .action {
      flex-basis: 100%;
      padding-left: 28px;
    }
  }
</style>
