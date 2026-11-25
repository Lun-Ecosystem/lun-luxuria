<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Button from './Button.svelte';
  import Checkbox from './Checkbox.svelte';
  import DecisionCard from './DecisionCard.svelte';
  import { Check } from './Icon.ts';
  import type { GroupCard } from './types.ts';

  /*
   * « Valider ensemble », in the sense of the dictionary: the cards a post marked `bulk`, all checked, decided in one
   * gesture. Unchecking a card leaves it to decide; a corrected card leaves the group and goes alone. The app opens
   * and closes the group, and takes a decided card out of `cards`: the kit only draws the open group.
   */
  type Props = {
    /** The pending cards the app offers the group. Only `bulk` ones, without `sends` or `options`, are taken. */
    cards: GroupCard[];
    /** The name of a card in the texts, a feminine noun (« proposition »). */
    one?: string | undefined;
    many?: string | undefined;
    /** Heading level of the header; the cards take the next one. */
    level?: 2 | 3 | 4 | undefined;
    /** The gesture is on its way: the main button spins, the corrections and the boxes wait. */
    busy?: boolean | undefined;
    /** Read only: the gestures stay in sight, disabled, under this line that says why. */
    off?: string | undefined;
    /** The gesture: one call, with the ids of the checked cards still in the group. */
    onaccept?: ((ids: string[]) => void) | undefined;
    /** A corrected card, which leaves the group and goes alone. */
    oncorrect?: ((id: string, values: Record<string, string[]>) => void) | undefined;
    /** « Fermer », and Escape outside a correction. */
    onclose?: (() => void) | undefined;
  };

  let {
    cards,
    one = 'carte',
    many = 'cartes',
    level = 3,
    busy = false,
    off,
    onaccept,
    oncorrect,
    onclose,
  }: Props = $props();

  const uid = $props.id();
  const locked = $derived(busy || !!off);
  const fits = (c: GroupCard) => !!c.bulk && !c.sends && !c.options?.length;

  // Left by a correction, for as long as the group lives, even if the app keeps the card in `cards`.
  const gone = new SvelteSet<string>();
  const unchecked = new SvelteSet<string>();
  const rows = $derived(cards.filter((c) => fits(c) && !gone.has(c.id)));
  const checked = $derived(rows.filter((c) => !unchecked.has(c.id)));
  const n = $derived(checked.length);

  // A card the contract keeps out of a group would be lost without a word: said once per id, in dev.
  const warned = new Set<string>();
  $effect(() => {
    if (!import.meta.env.DEV) return;
    for (const c of cards) {
      if (fits(c) || warned.has(c.id)) continue;
      warned.add(c.id);
      console.warn(
        `DecisionGroup: card ${c.id} left out, a group takes bulk cards without sends or options only.`,
      );
    }
  });

  let section = $state<HTMLElement>();

  const leave = async (id: string, values: Record<string, string[]>) => {
    const i = rows.findIndex((c) => c.id === id);
    const next = rows[i + 1] ?? rows[i - 1];
    gone.add(id);
    oncorrect?.(id, values);
    await tick();
    const target = next
      ? section?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(next.id)}"] [role="checkbox"]`)
      : section?.querySelector<HTMLElement>('[data-close]');
    target?.focus();
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onclose?.();
  };
</script>

{#if rows.length || gone.size}
  <!-- Escape rises from the boxes and buttons inside: the section only listens, it is not a control. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section bind:this={section} class="group" aria-labelledby="{uid}-titre" onkeydown={keydown}>
    <header>
      <svelte:element this={`h${level}`} class="title" id="{uid}-titre">Valider ensemble</svelte:element>
      <p class="hint">Décocher une {one} pour la laisser à trancher.</p>
      {#if off}<p class="off">{off}</p>{/if}
    </header>
    <fieldset disabled={locked} aria-labelledby="{uid}-titre">
      <ul>
        {#each rows as c (c.id)}
          <li data-id={c.id}>
            <Checkbox
              aria-label={c.title}
              bind:checked={
                () => !unchecked.has(c.id), (on) => (on ? unchecked.delete(c.id) : unchecked.add(c.id))
              }
            />
            <DecisionCard
              narrow
              level={(level + 1) as 3 | 4 | 5}
              title={c.title}
              kind={c.kind}
              meta={c.meta}
              lines={c.lines}
              reason={c.reason}
              importance={c.importance}
              fields={c.fields}
              oncorrect={(values) => leave(c.id, values)}
            />
          </li>
        {/each}
      </ul>
    </fieldset>
    <div class="gestures">
      <Button
        variant="principal"
        size="petit"
        icon={Check}
        loading={busy}
        disabled={!!off || n === 0}
        onclick={() => onaccept?.(checked.map((c) => c.id))}
      >
        {n === 0 ? `Aucune ${one} cochée` : n === 1 ? `Valider la ${one}` : `Valider les ${n} ${many}`}
      </Button>
      <Button variant="fantome" size="petit" data-close onclick={() => onclose?.()}>Fermer</Button>
    </div>
  </section>
{/if}

<style>
  .group {
    display: grid;
    gap: 14px;
  }
  header {
    display: grid;
    gap: 4px;
  }
  .title {
    margin: 0;
    font: 500 21px/1.2 var(--serif);
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--texte-2);
  }
  .off {
    margin: 0;
    font-size: 12.5px;
    color: var(--attention);
  }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  ul {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 12px;
  }
  /* The box stands level with the title of its card. */
  li > :global(.case) {
    margin-top: 16px;
  }
  .gestures {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
