<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import Button from './Button.svelte';
  import { ICON_STROKE, type IconComponent } from './Icon.ts';

  /*
   * Where files are dropped or chosen: a dashed card with its button. `directory` picks a whole
   * folder (no drop then: browsers give folders as entries, not as files).
   */

  type Props = {
    title: string;
    hint?: string | undefined;
    /** Label of the button, also the name of the hidden file input. */
    label: string;
    icon: IconComponent;
    directory?: boolean | undefined;
    accept?: string | undefined;
    busy?: boolean | undefined;
    onfiles: (files: File[]) => void;
  };

  let { title, hint, label, icon: Icon, directory = false, accept, busy = false, onfiles }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);
  let over = $state(false);

  function send(files: File[]) {
    if (files.length && !busy) onfiles(files);
  }

  function chosen() {
    const files = [...(input?.files ?? [])];
    if (input) input.value = '';
    send(files);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    over = false;
    send([...(event.dataTransfer?.files ?? [])]);
  }
</script>

<!-- Dropping is a mouse shortcut: the button inside does the same by keyboard. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={['zone', { over }]}
  ondragover={(e) => {
    if (directory) return;
    e.preventDefault();
    over = true;
  }}
  ondragleave={(e) => {
    // Crossing into a child fires a leave on the zone: not a real exit.
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) over = false;
  }}
  ondrop={directory ? undefined : drop}
>
  <span class="rond" aria-hidden="true"><Icon size={20} strokeWidth={ICON_STROKE} /></span>
  <b class="titre">{title}</b>
  {#if hint}<p>{hint}</p>{/if}
  <Button variant="secondaire" loading={busy} onclick={() => input?.click()}>{label}</Button>
  <input
    bind:this={input}
    type="file"
    class="cache"
    aria-label={label}
    {accept}
    multiple
    {...directory ? { webkitdirectory: true } : {}}
    onchange={chosen}
  />
</div>

<style>
  .zone {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 18px;
    background: var(--surface);
    border: 1px dashed var(--bordure-forte);
    border-radius: var(--r-3);
  }
  .zone.over {
    background: var(--accent-doux);
    border-color: var(--accent-texte);
  }
  .rond {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--texte-2);
  }
  .titre {
    font-size: 14px;
    font-weight: 500;
  }
  p {
    margin: 0 0 8px;
    font-size: 12.5px;
    color: var(--texte-2);
  }
  .cache {
    display: none;
  }
</style>
