<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { getField } from './field.ts';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';

  type Props = Omit<HTMLInputAttributes, 'value' | 'size' | 'children'> & {
    value?: string | undefined;
    /** Icon at the start of the field. */
    icon?: IconComponent | undefined;
    /** Unit or hint at the end of the field (`%`, `jours`). */
    suffix?: string | undefined;
    /** Error state; inside a Field, follows the Field's error. */
    invalid?: boolean | undefined;
    size?: 'petit' | 'normal' | undefined;
  };

  let {
    value = $bindable(''),
    icon: Icon,
    suffix,
    invalid,
    size = 'normal',
    type = 'text',
    id,
    class: className,
    'aria-describedby': describedBy,
    ...rest
  }: Props = $props();

  const field = getField();
  const isInvalid = $derived(invalid ?? field?.invalid ?? false);
</script>

<div class={['entree', size, { erreur: isInvalid }, className]} data-disabled={rest.disabled || undefined}>
  {#if Icon}<Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />{/if}
  <input
    {...rest}
    {type}
    id={id ?? field?.id}
    aria-describedby={describedBy ?? field?.describedBy}
    aria-invalid={isInvalid || undefined}
    bind:value
  />
  {#if suffix}<span class="suffixe" aria-hidden="true">{suffix}</span>{/if}
</div>

<style>
  .entree {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    color: var(--texte-3);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .entree :global(svg) {
    flex: none;
  }
  .petit {
    height: 34px;
  }
  .entree:hover:not([data-disabled]),
  .entree:has(input[data-etat='survol']) {
    border-color: color-mix(in srgb, var(--texte-2) 40%, transparent);
  }
  .entree:focus-within,
  .entree:has(input[data-etat='focus']) {
    border-color: var(--accent-texte);
    box-shadow: 0 0 0 3px var(--accent-doux);
  }
  .entree.erreur {
    border-color: var(--danger-bord);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  .entree.erreur:focus-within,
  .entree.erreur:has(input[data-etat='focus']) {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  .entree[data-disabled] {
    opacity: 0.42;
    cursor: not-allowed;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 0;
    color: var(--texte);
    font: 300 14px var(--sans);
    outline: none;
  }
  input:focus-visible {
    outline: none;
  }
  input::placeholder {
    color: var(--texte-3);
  }
  input:disabled {
    cursor: not-allowed;
  }
  .suffixe {
    font: 300 12.5px var(--sans);
    color: var(--texte-3);
  }
</style>
