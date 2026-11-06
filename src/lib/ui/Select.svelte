<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Select } from 'bits-ui';
  import { getField } from './field.ts';
  import { Check, ChevronDown, ICON_STROKE, type IconComponent } from './Icon.ts';
  import { mondeOf } from './monde.ts';
  import type { DemoState, Option } from './types.ts';

  type Props = {
    value?: string | undefined;
    items: Option[];
    placeholder?: string | undefined;
    /** Icon at the start of the trigger. */
    icon?: IconComponent | undefined;
    disabled?: boolean | undefined;
    invalid?: boolean | undefined;
    id?: string | undefined;
    name?: string | undefined;
    /** Accessible name, when the select is not inside a Field. */
    'aria-label'?: string | undefined;
    onchange?: ((value: string) => void) | undefined;
    class?: string | undefined;
    'data-etat'?: DemoState | undefined;
  };

  let {
    value = $bindable(''),
    items,
    placeholder = 'Choisir…',
    icon: Icon,
    disabled = false,
    invalid,
    id,
    name,
    'aria-label': ariaLabel,
    onchange,
    class: className,
    'data-etat': etat,
  }: Props = $props();

  const field = getField();
  const isInvalid = $derived(invalid ?? field?.invalid ?? false);
  const selected = $derived(items.find((item) => item.value === value));

  let trigger = $state<HTMLButtonElement | null>(null);
  const monde = $derived(mondeOf(trigger));
</script>

<Select.Root
  type="single"
  bind:value={
    () => value,
    (next) => {
      value = next;
      onchange?.(next);
    }
  }
  {items}
  {disabled}
  {...name ? { name } : {}}
>
  <Select.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        bind:this={trigger}
        type="button"
        class={['entree', { erreur: isInvalid }, className]}
        id={id ?? field?.id}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        data-etat={etat}
      >
        <span class={['valeur', { vide: !selected }]}>
          {#if Icon}<Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />{/if}
          <span class="texte">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown size={16} strokeWidth={ICON_STROKE} aria-hidden="true" class="chevron" />
      </button>
    {/snippet}
  </Select.Trigger>
  <Select.Portal>
    <Select.Content sideOffset={6} collisionPadding={8}>
      {#snippet child({ wrapperProps, props })}
        <div {...wrapperProps}>
          <div {...props} class="menu" data-monde={monde}>
            <Select.Viewport>
              {#each items as item (item.value)}
                <Select.Item value={item.value} label={item.label} disabled={item.disabled ?? false}>
                  {#snippet child({ props: itemProps, selected: isSelected })}
                    <div {...itemProps} class={['item', { double: item.hint }]}>
                      <span class="lignes">
                        <span class="texte">{item.label}</span>
                        {#if item.hint}<span class="indice">{item.hint}</span>{/if}
                      </span>
                      {#if isSelected}
                        <Check size={16} strokeWidth={ICON_STROKE} aria-hidden="true" class="coche" />
                      {/if}
                    </div>
                  {/snippet}
                </Select.Item>
              {/each}
            </Select.Viewport>
          </div>
        </div>
      {/snippet}
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  .entree {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    height: 38px;
    padding: 0 10px 0 12px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    color: var(--texte);
    font: 300 14px var(--sans);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }
  .entree:enabled:hover,
  .entree[data-etat='survol'] {
    border-color: color-mix(in srgb, var(--texte-2) 40%, transparent);
  }
  .entree:focus-visible,
  .entree[data-etat='focus'],
  .entree[data-state='open'] {
    outline: none;
    border-color: var(--accent-texte);
    box-shadow: 0 0 0 3px var(--accent-doux);
  }
  .entree.erreur {
    border-color: var(--danger-bord);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  /* Focused or open while invalid: the strong danger border, as the text field and the code. */
  .entree.erreur:focus,
  .entree.erreur[data-etat='focus'],
  .entree.erreur[data-state='open'] {
    border-color: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  .entree:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .valeur {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--texte-3);
  }
  .texte {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--texte);
  }
  .vide .texte {
    color: var(--texte-3);
  }
  .entree :global(.chevron) {
    flex: none;
    color: var(--texte-3);
    transition: transform 150ms ease;
  }
  .entree[data-state='open'] :global(.chevron) {
    transform: rotate(180deg);
  }

  .menu {
    min-width: max(var(--bits-select-anchor-width), 180px);
    max-height: min(320px, var(--bits-select-content-available-height));
    overflow-y: auto;
    padding: 6px;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-2);
    box-shadow: var(--ombre-2);
    outline: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-1);
    color: var(--texte);
    font: 400 13.5px var(--sans);
    cursor: pointer;
    outline: none;
  }
  .item.double {
    height: auto;
    min-height: 32px;
    padding-block: 6px;
  }
  .lignes {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .indice {
    font: 400 12px var(--sans);
    color: var(--texte-3);
  }
  .item[data-highlighted] {
    background: var(--survol);
  }
  .item[data-disabled] {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .item :global(.coche) {
    margin-left: auto;
    flex: none;
    color: var(--accent-texte);
  }
</style>
