<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  import { getField } from './field.ts';

  /* Multi-line field (a synthesis), in the style of TextInput; grows with its rows. */

  type Props = Omit<HTMLTextareaAttributes, 'value' | 'children'> & {
    value?: string | undefined;
    /** Error state; inside a Field, follows the Field's error. */
    invalid?: boolean | undefined;
  };

  let {
    value = $bindable(''),
    invalid,
    rows = 4,
    id,
    class: className,
    'aria-describedby': describedBy,
    ...rest
  }: Props = $props();

  const field = getField();
  const isInvalid = $derived(invalid ?? field?.invalid ?? false);
</script>

<textarea
  {...rest}
  {rows}
  class={['zone', { erreur: isInvalid }, className]}
  id={id ?? field?.id}
  aria-describedby={describedBy ?? field?.describedBy}
  aria-invalid={isInvalid || undefined}
  bind:value></textarea>

<style>
  .zone {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 76px;
    padding: 9px 12px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    color: var(--texte);
    font: 300 14px/1.55 var(--sans);
    resize: vertical;
    outline: none;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .zone:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--texte-2) 40%, transparent);
  }
  .zone:focus-visible {
    border-color: var(--accent-texte);
    box-shadow: 0 0 0 3px var(--accent-doux);
  }
  .zone::placeholder {
    color: var(--texte-3);
  }
  .zone.erreur {
    border-color: var(--danger-bord);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  .zone:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
</style>
