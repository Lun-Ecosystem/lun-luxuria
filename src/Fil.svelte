<script lang="ts">
  import { tick } from 'svelte';
  import { TextArea } from './lib/ui/index.ts';
  import type { Session } from './session.svelte.ts';

  /* Only a view of the core's main thread, and a small field to write in it. */

  let { session }: { session: Session } = $props();
  let draft = $state('');
  let list = $state<HTMLElement | null>(null);

  const hour = (iso: string) =>
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  $effect(() => {
    void session.thread.length;
    void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function send() {
    const text = draft.trim();
    if (!text) return;
    draft = '';
    void session.write(text);
  }
</script>

<aside class="fil" aria-label="Le fil">
  <h2>Le fil</h2>
  {#if session.thread.length === 0}
    {#if session.threadRead}
      <div class="vide">
        <!-- Linked, the thread is the server's, not the day's. -->
        <p class="rien">{session.settings.brain === 'alone' ? 'Rien encore aujourd’hui.' : 'Rien encore.'}</p>
        <p>Ce que vous vous dites s’écrit ici, à la voix comme à l’écrit.</p>
      </div>
    {/if}
  {:else}
    <ol bind:this={list}>
      {#each session.thread as m (m.id)}
        <li class={m.role}>
          {#if m.status === 'pending'}<span class="attente">…</span>
          {:else if m.status === 'error'}<span class="erreur">{m.error ?? 'Pas de réponse.'}</span>
          {:else}{m.text}{/if}
          {#if m.status !== 'pending'}<time datetime={m.at}>{hour(m.at)}</time>{/if}
        </li>
      {/each}
    </ol>
  {/if}
  {#if session.silenced}
    <p class="sourdine" id="fil-sourdine">En sourdine. Sortir de la sourdine pour lui écrire.</p>
  {/if}
  <TextArea
    bind:value={draft}
    rows={2}
    aria-label="Lui écrire"
    placeholder="Lui écrire"
    disabled={session.silenced}
    aria-describedby={session.silenced ? 'fil-sourdine' : undefined}
    onkeydown={(e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    }}
  />
</aside>

<style>
  .fil {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100%);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px 16px;
    background: var(--surface);
    border-left: 1px solid var(--bordure);
  }
  /* The scene's controls stay above the panel, on the same line: the thread button closes it. */
  h2 {
    margin: 0;
    height: 32px;
    line-height: 32px;
    font-size: 14px;
    font-weight: 500;
  }
  ol {
    flex: 1;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  li {
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  li.assistant {
    font-family: 'Cormorant Garamond', serif;
    font-size: 19px;
  }
  li.user {
    color: var(--texte-2);
    font-size: 14px;
    align-self: flex-end;
    text-align: right;
    max-width: 85%;
  }
  time {
    display: block;
    margin-top: 2px;
    color: var(--texte-3);
    font-family: Inter, sans-serif;
    font-size: 11.5px;
  }
  .vide {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 24px 16px;
    text-align: center;
    font-family: Inter, sans-serif;
  }
  .vide p {
    margin: 0;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .vide .rien {
    font-size: 14px;
    font-weight: 500;
    color: var(--texte-2);
  }
  .attente {
    color: var(--texte-3);
  }
  .sourdine {
    margin: 0;
    color: var(--texte-3);
    font-family: Inter, sans-serif;
    font-size: 13px;
  }
  .erreur {
    color: var(--attention);
    font-family: Inter, sans-serif;
    font-size: 13px;
  }
</style>
