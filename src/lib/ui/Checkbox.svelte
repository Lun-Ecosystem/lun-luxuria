<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Checkbox } from 'bits-ui';
  import { getField } from './field.ts';
  import { Check, Minus } from './Icon.ts';
  import type { DemoState } from './types.ts';

  type Props = {
    checked?: boolean | undefined;
    /** Part of a group selected (select all). */
    indeterminate?: boolean | undefined;
    disabled?: boolean | undefined;
    /** Visible label next to the box. */
    label?: string | undefined;
    /** Accessible name when no visible label (a list row). */
    'aria-label'?: string | undefined;
    id?: string | undefined;
    name?: string | undefined;
    value?: string | undefined;
    onchange?: ((checked: boolean) => void) | undefined;
    'data-etat'?: DemoState | undefined;
  };

  let {
    checked = $bindable(false),
    indeterminate = $bindable(false),
    disabled = false,
    label,
    'aria-label': ariaLabel,
    id,
    name,
    value,
    onchange,
    'data-etat': etat,
  }: Props = $props();

  const field = getField();
</script>

{#snippet box()}
  <Checkbox.Root
    bind:checked={
      () => checked,
      (next) => {
        checked = next;
        onchange?.(next);
      }
    }
    bind:indeterminate
    {disabled}
    {...name ? { name } : {}}
    {...value ? { value } : {}}
  >
    {#snippet child({ props, checked: on, indeterminate: partial })}
      <button
        {...props}
        type="button"
        class={['case', { on: on || partial }]}
        id={id ?? field?.id}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        data-etat={etat}
      >
        {#if partial}
          <Minus size={11} strokeWidth={3} aria-hidden="true" />
        {:else if on}
          <Check size={11} strokeWidth={3} aria-hidden="true" />
        {/if}
      </button>
    {/snippet}
  </Checkbox.Root>
{/snippet}

{#if label}
  <label class={['ligne', { inactif: disabled }]}>
    {@render box()}
    <span>{label}</span>
  </label>
{:else}
  {@render box()}
{/if}

<style>
  .case {
    display: grid;
    place-items: center;
    flex: none;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1.5px solid var(--bordure-forte);
    border-radius: 4px;
    background: none;
    color: var(--texte);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }
  .case:enabled:hover,
  .case[data-etat='survol'] {
    border-color: color-mix(in srgb, var(--texte-2) 60%, transparent);
    background: var(--survol);
  }
  .case.on,
  .case.on:enabled:hover {
    background: var(--accent);
    border-color: var(--accent);
  }
  .case:focus-visible,
  .case[data-etat='focus'] {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .case:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .ligne {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font: 400 14px/1.4 var(--sans);
    color: var(--texte);
    cursor: pointer;
  }
  .ligne.inactif {
    color: var(--texte-3);
    cursor: not-allowed;
  }
</style>
