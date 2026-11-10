<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import Button from './Button.svelte';
  import DecisionCard from './DecisionCard.svelte';
  import { Shield } from './Icon.ts';

  /*
   * A permission, in the sense of the dictionary: an immediate action on a post, which waits for an answer (once,
   * always, refuse). Not a card: nothing was prepared and nothing waits in a queue. It is drawn on the same sheet,
   * shorter, in the color of the world, and folds into one line once answered.
   *
   * It only draws: asking, remembering an « always » and taking it back are the app's. Without `onanswer` it shows no
   * answer. An answered permission offers nothing but taking an « always » back: no undo, no dismissal.
   */
  type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
    /** The action that asks (« Ouvrir le dossier Téléchargements »). */
    what: string;
    /** What it acts on: a path, a command, an address. */
    target?: string | undefined;
    /** Why it is needed now. */
    reason?: string | undefined;
    /** The eyebrow after « Permission »: the post, the moment. */
    meta?: string[] | undefined;
    /** What an « always » covers, as a whole phrase with its preposition (« pour ce dossier »); « Toujours » alone without it. */
    scope?: string | undefined;
    status?: 'pending' | 'once' | 'always' | 'refused' | 'unanswered' | undefined;
    /** The answer is on its way: it spins, the others wait. */
    busy?: boolean | undefined;
    /** Heading level of the action, to fit where the permission stands. */
    level?: 2 | 3 | 4 | 5 | undefined;
    narrow?: boolean | undefined;
    onanswer?: ((answer: 'once' | 'always' | 'refuse') => void) | undefined;
    /** Takes an « always » back, from its line. */
    onrevoke?: (() => void) | undefined;
  };

  let {
    what,
    target,
    reason,
    meta = [],
    scope,
    status = 'pending',
    busy = false,
    level,
    narrow,
    onanswer,
    onrevoke,
    ...rest
  }: Props = $props();

  const toujours = $derived(scope ? `Toujours ${scope}` : 'Toujours');
  // The sheet knows the statuses of a card: an answer given is done, no answer in time is expired.
  const sheet = $derived(
    (
      {
        pending: { status: 'pending' },
        once: { status: 'done', lineText: `Autorisé une fois : ${what}` },
        always: {
          status: 'done',
          lineText: `${scope ? `Toujours autorisé ${scope}` : 'Toujours autorisé'} : ${what}`,
        },
        refused: { status: 'refused', lineText: `Refusé : ${what}` },
        unanswered: { status: 'expired', lineText: `Sans réponse, rien n’a eu lieu : ${what}` },
      } as const
    )[status],
  );
</script>

<DecisionCard
  {...rest}
  tone="accent"
  kind="Permission"
  {meta}
  title={what}
  icon={Shield}
  {level}
  {reason}
  {busy}
  {narrow}
  {...sheet}
>
  {#if target}<p class="target"><span>Cible</span><code>{target}</code></p>{/if}
  {#snippet actions()}
    {#if onanswer}
      <Button variant="principal" size="petit" loading={busy} onclick={() => onanswer('once')}
        >Une fois</Button
      >
      <Button variant="secondaire" size="petit" disabled={busy} onclick={() => onanswer('always')}
        >{toujours}</Button
      >
      <Button variant="fantome" size="petit" disabled={busy} onclick={() => onanswer('refuse')}
        >Refuser</Button
      >
    {/if}
  {/snippet}
  {#snippet doneActions()}
    {#if status === 'always' && onrevoke}
      <Button variant="fantome" size="petit" onclick={onrevoke}>Ne plus autoriser</Button>
    {/if}
  {/snippet}
</DecisionCard>

<style>
  .target {
    display: flex;
    gap: 16px;
    margin: 0;
    font-size: 13.5px;
  }
  .target span {
    color: var(--texte-3);
  }
  code {
    min-width: 0;
    font:
      12.5px ui-monospace,
      Consolas,
      monospace;
    overflow-wrap: anywhere;
  }
</style>
