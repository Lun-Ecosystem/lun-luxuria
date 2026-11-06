<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import Button from './Button.svelte';

  /* Figure card of a dashboard: what is counted, the number, a muted line, and the way in. */

  type Props = {
    label: string;
    value: number;
    sub?: string | undefined;
    href: string;
    /** Text of the link; `principal` look when the figure is the first thing to do. */
    action: string;
    primary?: boolean | undefined;
    tone?: 'neutre' | 'danger' | undefined;
    class?: string | undefined;
  };

  let {
    label,
    value,
    sub,
    href,
    action,
    primary = false,
    tone = 'neutre',
    class: className,
  }: Props = $props();
</script>

<div class={['carte', className]}>
  <div class="label">{label}</div>
  <div class={['chiffre', { danger: tone === 'danger' }]}>{value}</div>
  {#if sub}<span class="sub">{sub}</span>{/if}
  <div class="suite">
    <Button {href} variant={primary ? 'principal' : 'secondaire'} aria-label="{label} : {action}"
      >{action}</Button
    >
  </div>
</div>

<style>
  .carte {
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-3);
    padding: 16px;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--texte-2);
  }
  .chiffre {
    font: 500 40px/1 var(--serif);
    font-variant-numeric: lining-nums tabular-nums;
    margin: 6px 0;
  }
  .danger {
    color: var(--danger);
  }
  .sub {
    font-size: 12.5px;
    color: var(--texte-2);
  }
  .suite {
    margin-top: 12px;
  }
</style>
