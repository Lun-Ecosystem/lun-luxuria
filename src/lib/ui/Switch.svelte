<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Switch } from 'bits-ui';
  import { getField } from './field.ts';
  import type { DemoState } from './types.ts';

  type Props = {
    checked?: boolean | undefined;
    disabled?: boolean | undefined;
    /** Accessible name, when the switch is not inside a Field nor named by aria-labelledby. */
    label?: string | undefined;
    'aria-labelledby'?: string | undefined;
    'aria-describedby'?: string | undefined;
    id?: string | undefined;
    name?: string | undefined;
    /** A switch acts at once: no Save button. */
    onchange?: ((checked: boolean) => void) | undefined;
    'data-etat'?: DemoState | undefined;
  };

  let {
    checked = $bindable(false),
    disabled = false,
    label,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    id,
    name,
    onchange,
    'data-etat': etat,
  }: Props = $props();

  const field = getField();
</script>

<Switch.Root
  bind:checked={
    () => checked,
    (next) => {
      checked = next;
      onchange?.(next);
    }
  }
  {disabled}
  {...name ? { name } : {}}
>
  {#snippet child({ props, checked: on })}
    <button
      {...props}
      type="button"
      class="inter"
      id={id ?? field?.id}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy ?? field?.describedBy}
      data-etat={etat}
    >
      <span class={['pouce', { on }]}></span>
    </button>
  {/snippet}
</Switch.Root>

<style>
  .inter {
    position: relative;
    flex: none;
    width: 36px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-rond);
    background: var(--surface-3);
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }
  .inter:enabled:hover,
  .inter[data-etat='survol'] {
    border-color: color-mix(in srgb, var(--texte-2) 45%, transparent);
  }
  .inter[data-state='checked'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .inter[data-state='checked']:enabled:hover,
  .inter[data-state='checked'][data-etat='survol'] {
    background: var(--accent-survol);
    border-color: var(--accent-survol);
  }
  .inter:focus-visible,
  .inter[data-etat='focus'] {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .inter:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .pouce {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--texte-2);
    transition:
      transform 150ms ease,
      background-color 150ms ease;
  }
  .pouce.on {
    transform: translateX(16px);
    background: var(--texte);
  }
  @media (prefers-reduced-motion: reduce) {
    .inter,
    .pouce {
      transition: none;
    }
  }
</style>
