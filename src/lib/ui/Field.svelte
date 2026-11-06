<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setField, type FieldControl } from './field.ts';
  import { ICON_STROKE, TriangleAlert } from './Icon.ts';

  type Props = {
    label: string;
    /** Help under the control. */
    hint?: string | undefined;
    /** Replaces the hint and marks the control invalid. */
    error?: string | undefined;
    class?: string | undefined;
    /** The control. Controls of this folder find the Field by themselves; others use the ids given. */
    children: Snippet<[FieldControl]>;
  };

  let { label, hint, error, class: className, children }: Props = $props();

  const uid = $props.id();
  const message = $derived(error || hint);

  const control: FieldControl = {
    id: `${uid}-control`,
    labelId: `${uid}-label`,
    get describedBy() {
      return message ? `${uid}-message` : undefined;
    },
    get invalid() {
      return Boolean(error);
    },
  };
  setField(control);
</script>

<div class={['champ', className]}>
  <label id={control.labelId} for={control.id}>{label}</label>
  {@render children(control)}
  {#if error}
    <span class="err" id={control.describedBy}>
      <TriangleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{error}
    </span>
  {:else if hint}
    <span class="aide" id={control.describedBy}>{hint}</span>
  {/if}
</div>

<style>
  .champ {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  label {
    align-self: flex-start;
    font: 400 13px/1.4 var(--sans);
    color: var(--texte);
  }
  .aide,
  .err {
    font: 300 12.5px/1.45 var(--sans);
    color: var(--texte-3);
  }
  .err {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 400;
    color: var(--danger);
  }
  .err :global(svg) {
    flex: none;
  }
</style>
