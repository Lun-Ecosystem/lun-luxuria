<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { getField } from './field.ts';
  import type { DemoState } from './types.ts';

  /*
   * Six-digit code, one box per digit. A single real field lies over the boxes: typing, pasting
   * « 482 917 » or « 482·917 », and the code offered by the phone all go through it. Only the digits
   * are kept; the sixth one completes the code.
   */

  const LENGTH = 6;

  type Props = {
    value?: string | undefined;
    /** Refused code: the boxes turn to the danger tone. Inside a Field, follows its error. */
    error?: boolean | undefined;
    disabled?: boolean | undefined;
    oncomplete?: ((code: string) => void) | undefined;
    /** Accessible name, when the code is not inside a Field. */
    'aria-label'?: string | undefined;
    /** What describes the code (its error), when it is not inside a Field. */
    'aria-describedby'?: string | undefined;
    id?: string | undefined;
    class?: string | undefined;
    /** Forced focus, for the catalogue. */
    'data-etat'?: Extract<DemoState, 'focus'> | undefined;
  };

  let {
    value = $bindable(''),
    error,
    disabled = false,
    oncomplete,
    'aria-label': ariaLabel,
    'aria-describedby': describedBy,
    id,
    class: className,
    'data-etat': etat,
  }: Props = $props();

  const field = getField();
  const invalid = $derived(error ?? field?.invalid ?? false);
  let focused = $state(false);

  const digits = $derived(Array.from({ length: LENGTH }, (_, i) => value[i] ?? ''));
  /** The box the next digit goes to (the last one when full). */
  const active = $derived(Math.min(value.length, LENGTH - 1));

  /** The entry being typed replaces the whole content (all selected): a new entry, even if equal. */
  let replacing = false;

  function onBeforeInput(event: InputEvent & { currentTarget: HTMLInputElement }) {
    const field = event.currentTarget;
    replacing =
      field.value.length > 0 && field.selectionStart === 0 && field.selectionEnd === field.value.length;
  }

  function onInput(event: Event & { currentTarget: HTMLInputElement }) {
    const kept = event.currentTarget.value.replace(/\D/g, '').slice(0, LENGTH);
    event.currentTarget.value = kept;
    const pasted = event instanceof InputEvent && /^insertFrom|^insertReplacement/.test(event.inputType);
    // Completes once per entry: a new code, or the same code pasted or typed again over the whole
    // content (retry). A key typed into a full code changes nothing and sends nothing.
    const entry = kept !== value || pasted || replacing;
    replacing = false;
    value = kept;
    if (kept.length === LENGTH && entry) oncomplete?.(kept);
  }
</script>

<div class={['code', { erreur: invalid, focus: focused || etat === 'focus', disabled }, className]}>
  <input
    id={id ?? field?.id}
    type="text"
    inputmode="numeric"
    autocomplete="one-time-code"
    spellcheck="false"
    aria-label={field ? undefined : (ariaLabel ?? 'Code à 6 chiffres')}
    aria-describedby={field ? field.describedBy : describedBy}
    aria-invalid={invalid || undefined}
    {disabled}
    {value}
    onbeforeinput={onBeforeInput}
    oninput={onInput}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
  />
  <span class="cases" aria-hidden="true">
    {#each digits as digit, i (i)}
      {#if i === LENGTH / 2}<span class="sep">·</span>{/if}
      <span class={['case', { pleine: digit, active: i === active }]}>{digit}</span>
    {/each}
  </span>
</div>

<style>
  .code {
    position: relative;
    display: flex;
    justify-content: center;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: transparent;
    caret-color: transparent;
    font-size: 16px;
    letter-spacing: 0;
    opacity: 0;
    cursor: text;
  }
  input:disabled {
    cursor: not-allowed;
  }
  .cases {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    max-width: 378px;
  }
  /* 52 x 62 px, narrower when the card is (a phone): the six boxes always fit. */
  .case {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    flex: 1 1 0;
    min-width: 0;
    max-width: 52px;
    aspect-ratio: 52 / 62;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    color: var(--texte);
    font: 400 28px/1 var(--sans);
    font-variant-numeric: tabular-nums;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .sep {
    flex: none;
    width: 10px;
    text-align: center;
    color: var(--texte-3);
    font-size: 20px;
  }
  .focus .case.active {
    border-color: var(--accent-texte);
    box-shadow: 0 0 0 3px var(--accent-doux);
  }
  .focus .case.active:not(.pleine)::after {
    content: '';
    width: 2px;
    height: 26px;
    border-radius: 1px;
    background: var(--accent-texte);
    animation: clignote 1s steps(2, start) infinite;
  }
  .erreur .case {
    border-color: var(--danger-bord);
  }
  .erreur.focus .case.active {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  .disabled {
    opacity: 0.42;
  }
  @keyframes clignote {
    to {
      visibility: hidden;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .focus .case.active:not(.pleine)::after {
      animation: none;
    }
  }
  @media (max-width: 420px) {
    .cases {
      gap: 6px;
    }
    .case {
      font-size: 24px;
    }
  }
</style>
