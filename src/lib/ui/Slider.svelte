<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Slider } from 'bits-ui';
  import { getField } from './field.ts';

  type Props = {
    value?: number | undefined;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | undefined;
    /** Unit shown after the value: « 95 % ». */
    unit?: string | undefined;
    disabled?: boolean | undefined;
    /** Accessible name, when the slider is not inside a Field. */
    label?: string | undefined;
    /** Called once the value is settled (end of drag, key, typed value). */
    onchange?: ((value: number) => void) | undefined;
    class?: string | undefined;
  };

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    unit = '%',
    disabled = false,
    label,
    onchange,
    class: className,
  }: Props = $props();

  const field = getField();
  const uid = $props.id();
  /** French typography: a non-breaking space before the unit. */
  const shown = $derived(unit ? `${value} ${unit}` : String(value));

  let draft = $state<string | null>(null);

  function clamp(n: number): number {
    const stepped = Math.round((n - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
  }

  function commit() {
    if (draft === null) return;
    const typed = Number(draft.replace(',', '.').trim());
    draft = null;
    if (!Number.isFinite(typed)) return;
    const next = clamp(typed);
    if (next !== value) {
      value = next;
      onchange?.(next);
    }
  }
</script>

<div class={['curseur', className]} data-disabled={disabled || undefined}>
  <Slider.Root type="single" bind:value {min} {max} {step} {disabled} onValueCommit={(v) => onchange?.(v)}>
    {#snippet child({ props })}
      <span {...props} class="piste">
        <Slider.Range>
          {#snippet child({ props: rangeProps })}
            <span {...rangeProps} class="plein"></span>
          {/snippet}
        </Slider.Range>
        <Slider.Thumb index={0}>
          {#snippet child({ props: thumbProps })}
            <span
              {...thumbProps}
              class="pouce"
              aria-label={field ? undefined : label}
              aria-labelledby={field?.labelId}
              aria-describedby={field?.describedBy}
              aria-valuetext={shown}
            ></span>
          {/snippet}
        </Slider.Thumb>
      </span>
    {/snippet}
  </Slider.Root>
  <div class="valeur">
    <input
      id={field?.id ?? `${uid}-valeur`}
      type="text"
      inputmode="decimal"
      aria-label={field ? undefined : label}
      aria-describedby={field?.describedBy}
      {disabled}
      value={draft ?? String(value)}
      oninput={(e) => (draft = e.currentTarget.value)}
      onblur={commit}
      onkeydown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') draft = null;
      }}
    />
    {#if unit}<span class="unite" aria-hidden="true">{unit}</span>{/if}
  </div>
</div>

<style>
  .curseur {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .curseur[data-disabled] {
    opacity: 0.42;
  }
  .piste {
    position: relative;
    flex: 1;
    min-width: 80px;
    height: 20px;
    cursor: pointer;
    touch-action: none;
  }
  .piste::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 8px;
    height: 4px;
    border-radius: 4px;
    background: var(--surface-3);
  }
  .plein {
    top: 8px;
    height: 4px;
    border-radius: 4px;
    background: var(--accent);
  }
  .pouce {
    top: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--ivoire);
    box-shadow: var(--ombre-1);
    cursor: grab;
    transition: box-shadow 120ms ease;
  }
  .pouce:active {
    cursor: grabbing;
  }
  .pouce:hover {
    box-shadow:
      var(--ombre-1),
      0 0 0 5px var(--accent-doux);
  }
  .pouce:focus-visible {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  .curseur[data-disabled] .piste,
  .curseur[data-disabled] .pouce {
    cursor: not-allowed;
  }

  .valeur {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    width: 84px;
    height: 34px;
    padding: 0 12px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .valeur:focus-within {
    border-color: var(--accent-texte);
    box-shadow: 0 0 0 3px var(--accent-doux);
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
    font: 400 14px var(--sans);
    font-variant-numeric: tabular-nums;
    text-align: right;
    outline: none;
  }
  input:focus-visible {
    outline: none;
  }
  .unite {
    font: 300 12.5px var(--sans);
    color: var(--texte-3);
  }
</style>
