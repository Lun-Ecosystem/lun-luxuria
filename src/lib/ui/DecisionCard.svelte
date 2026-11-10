<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import Button from './Button.svelte';
  import { Check, Clock, ICON_STROKE, TriangleAlert, Undo, X } from './Icon.ts';
  import Kbd from './Kbd.svelte';

  /*
   * A card, in the sense of the dictionary: a proposal a post prepared, which waits in a queue to be decided. Drawn
   * as a sheet that says everything without a gesture: a filet in the tone of what it is, an eyebrow, a title, the
   * lines, the reason set apart, then the gestures. Once its status is final it folds into one line.
   *
   * The sheet is fixed; what differs between apps is theirs: the body (`children`), more gestures (`actions`), what a
   * done card still offers (`doneActions`). A gesture without its function is not shown. The keys are the app's: the
   * card only shows the hint it is given.
   */
  type Props = Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> & {
    /** What accepting does: a proposal (`ia`), a question (`attention`), a deletion (`danger`). */
    tone?: 'ia' | 'attention' | 'danger' | undefined;
    /** Short label of the kind (« Rangement »), first in the eyebrow. */
    kind?: string | undefined;
    /** The rest of the eyebrow: the post, the time. */
    meta?: string[] | undefined;
    title: string;
    /** Heading level of the title, to fit where the card stands. */
    level?: 2 | 3 | 4 | 5 | undefined;
    /** The lines of the card, as the contract of the posts gives them. */
    lines?: string[] | undefined;
    /** Why the card was raised. */
    reason?: string | undefined;
    /** What accepting sends out of the post, said before the gesture. */
    note?: string | undefined;
    /** The status of the contract. Anything but `pending` is final: one line. */
    status?: 'pending' | 'done' | 'refused' | 'failed' | 'expired' | undefined;
    /** What the line says once done; the title by default. */
    doneText?: string | undefined;
    /** Pending: the last gesture did not go through. Failed: why. */
    error?: string | undefined;
    /** A gesture is on its way: the main one spins, the others wait. */
    busy?: boolean | undefined;
    /** Read only: the gestures stay in sight, disabled, under this line that says why. */
    off?: string | undefined;
    /** The answers of a question, in place of accept and refuse. */
    options?: string[] | undefined;
    acceptLabel?: string | undefined;
    /** The keys the app listens to, shown as a hint (« V », « R »). */
    shortcuts?: string[] | undefined;
    /** In a conversation or a side panel: smaller title, no hint. */
    narrow?: boolean | undefined;
    onaccept?: ((answer?: string) => void) | undefined;
    onrefuse?: (() => void) | undefined;
    onedit?: (() => void) | undefined;
    onlater?: (() => void) | undefined;
    /** Runs the failed gesture again; never the accept itself. */
    onretry?: (() => void) | undefined;
    /** Takes a decision back, from the folded line. */
    onundo?: (() => void) | undefined;
    /** Removes a card that no longer stands. */
    ondismiss?: (() => void) | undefined;
    /** The body, in place of the lines. */
    children?: Snippet | undefined;
    /** More gestures, after the card's own. */
    actions?: Snippet | undefined;
    /** What a done card still offers, on its line. */
    doneActions?: Snippet | undefined;
  };

  let {
    tone = 'ia',
    kind,
    meta = [],
    title,
    level = 4,
    lines = [],
    reason,
    note,
    status = 'pending',
    doneText,
    error,
    busy = false,
    off,
    options,
    acceptLabel = 'Valider',
    shortcuts = [],
    narrow = false,
    onaccept,
    onrefuse,
    onedit,
    onlater,
    onretry,
    onundo,
    ondismiss,
    children,
    actions,
    doneActions,
    class: className,
    ...rest
  }: Props = $props();

  const locked = $derived(busy || !!off);
</script>

{#if status === 'pending'}
  <article {...rest} class={['card', tone, { narrow }, className]} aria-busy={busy}>
    {#if kind || meta.length}
      <p class="eyebrow">
        {#if kind}<span class="kind">{kind}</span>{/if}
        {#each meta as m (m)}<span>{m}</span>{/each}
      </p>
    {/if}
    <svelte:element this={`h${level}`} class="title">{title}</svelte:element>
    {#if children}
      {@render children()}
    {:else if lines.length}
      <div class="lines">
        {#each lines as line, i (i)}<p>{line}</p>{/each}
      </div>
    {/if}
    {#if reason}<p class="reason"><span>Pourquoi</span>{reason}</p>{/if}
    {#if error}
      <p class="note danger" role="alert">
        <TriangleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
        <span>N’a pas abouti : {error}</span>
      </p>
    {:else if note}
      <p class="note">{note}</p>
    {/if}
    {#if off}<p class="note">{off}</p>{/if}
    <div class="gestures">
      {#if onretry}
        <Button variant="principal" size="petit" disabled={locked} onclick={onretry}>Réessayer</Button>
      {/if}
      {#if options?.length && onaccept}
        {#each options as option, i (option)}
          <Button
            variant={i === 0 && !onretry ? 'principal' : 'secondaire'}
            size="petit"
            disabled={locked}
            onclick={() => onaccept(option)}>{option}</Button
          >
        {/each}
      {:else if onaccept}
        <Button
          variant={tone === 'danger' ? 'danger' : onretry ? 'secondaire' : 'principal'}
          size="petit"
          icon={Check}
          loading={busy}
          disabled={!!off}
          onclick={() => onaccept()}>{acceptLabel}</Button
        >
      {/if}
      {#if onedit}
        <Button variant="secondaire" size="petit" disabled={locked} onclick={onedit}>Modifier</Button>
      {/if}
      {#if onrefuse}
        <Button variant="fantome" size="petit" disabled={locked} onclick={onrefuse}>Refuser</Button>
      {/if}
      {#if onlater}
        <Button variant="fantome" size="petit" disabled={locked} onclick={onlater}>Plus tard</Button>
      {/if}
      {@render actions?.()}
      {#if shortcuts.length && !narrow}
        <span class="keys" aria-hidden="true">
          {#each shortcuts as key (key)}<Kbd>{key}</Kbd>{/each}
        </span>
      {/if}
    </div>
  </article>
{:else}
  <div {...rest} class={['line', status, className]}>
    {#if status === 'done'}
      <Check size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span>{doneText ?? title}</span>
    {:else if status === 'refused'}
      <X size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span>Refusée : {title}</span>
    {:else if status === 'failed'}
      <TriangleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span
        >N’a pas abouti : {title}{#if error}. {error}{/if}</span
      >
    {:else}
      <Clock size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <span>Expirée : {title}</span>
    {/if}
    {#if status === 'done'}{@render doneActions?.()}{/if}
    {#if onundo && (status === 'done' || status === 'refused')}
      <Button variant="fantome" size="petit" icon={Undo} onclick={onundo}>Annuler</Button>
    {/if}
    {#if ondismiss && (status === 'failed' || status === 'expired')}
      <Button variant="fantome" size="petit" icon={X} onclick={ondismiss}>Retirer</Button>
    {/if}
  </div>
{/if}

<style>
  .card {
    --filet: var(--ia);
    display: grid;
    gap: 10px;
    padding: 16px 18px 14px;
    border: 1px solid var(--bordure);
    border-top: 2px solid var(--filet);
    border-radius: var(--r-2);
    background: var(--surface-1);
  }
  .card.attention {
    --filet: var(--attention);
  }
  .card.danger {
    --filet: var(--danger);
  }
  .card.narrow {
    padding: 12px 14px;
  }
  .eyebrow {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    font-size: 12px;
    color: var(--texte-3);
  }
  .kind {
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--filet);
  }
  .title {
    margin: 0;
    font: 500 21px/1.2 var(--serif);
  }
  .narrow .title {
    font-size: 18px;
  }
  .lines {
    display: grid;
    gap: 3px;
    font-size: 13.5px;
    color: var(--texte-2);
  }
  .lines p {
    margin: 0;
  }
  .reason {
    margin: 0;
    padding-left: 10px;
    border-left: 2px solid var(--bordure-forte);
    font-size: 13px;
    color: var(--texte-2);
  }
  .reason span {
    margin-right: 8px;
    font-size: 11.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font-size: 12.5px;
    color: var(--attention);
  }
  .note :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .note.danger {
    color: var(--danger);
  }
  .gestures {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-top: 4px;
  }
  .keys {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  /* A final status folds the sheet into one line. */
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
    padding: 8px 12px;
    border: 1px solid var(--bordure);
    border-radius: var(--r-2);
    font-size: 13px;
    color: var(--texte-2);
  }
  .line > span {
    flex: 1;
    min-width: 0;
  }
  .line > :global(svg) {
    flex: none;
    color: var(--texte-3);
  }
  .line.done > :global(svg) {
    color: var(--ok);
  }
  .line.failed > :global(svg) {
    color: var(--danger);
  }

  /* No keyboard on a phone: the hint goes. */
  @media (max-width: 767.98px) {
    .keys {
      display: none;
    }
  }
</style>
