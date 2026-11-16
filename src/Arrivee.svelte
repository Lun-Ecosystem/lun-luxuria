<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Button, CodeInput, Field, TextInput } from './lib/ui/index.ts';
  import { missingToEnter } from './arrival.ts';
  import {
    CHECKING,
    CONFIRMED,
    confirmHost,
    forgetHost,
    hostCall,
    OFF_MACHINE,
    offMachine,
    readHosts,
    type HostButtons,
  } from './desktop/hotes.ts';
  import { inWindow, serverWarning } from './desktop/net.ts';
  import { unsafeAddress } from './local.ts';
  import type { Session } from './session.svelte.ts';
  import type { Settings } from './settings.ts';

  /* Before entering: what the app is, its two ways of answering, and the fields of the one chosen. */

  let { session }: { session: Session } = $props();
  const uid = $props.id();
  const s = $derived(session.settings);
  const missing = $derived(missingToEnter(s, session.token));
  const urlMissing = $derived(!s.model.url.trim());
  const needsCode = $derived(s.brain === 'linked' && !session.token);
  let code = $state('');
  // A token the server forgot comes back here, with its reason: read once, at the arrival.
  let refused = $state(untrack(() => session.arrivalSaid));

  // The non-breaking hyphen keeps « là-bas » on one line.
  const CARDS = [
    {
      value: 'alone',
      title: 'Seul',
      text: 'Ses réponses viennent d’un modèle que tu choisis : un modèle local, ou un service en ligne avec sa clé.',
      needs: 'Il faut : l’adresse du modèle et son nom. Le coût est celui du modèle.',
    },
    {
      value: 'linked',
      title: 'Relié à un serveur',
      text: 'Un serveur pense à sa place : la mémoire et les décisions restent là‑bas.',
      needs: 'Il faut : l’adresse du serveur et un code d’appairage.',
    },
  ] as const;

  function set(change: (draft: Settings) => void) {
    const draft = $state.snapshot(session.settings) as Settings;
    change(draft);
    session.saveSettings(draft);
  }
  const typed = (e: Event) => (e.currentTarget as HTMLInputElement).value;

  async function pair(value: string) {
    refused = '';
    try {
      await session.pair(value);
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err);
      code = '';
      return;
    }
    await session.enter();
  }

  /** The host buttons: one call at a time, Rust's refusal said in its address's field only. */
  const access = $state<HostButtons>({ busy: '', said: {} });
  /** What the page refuses already: said as the field's error, and the window is never asked to reach it. */
  const serverRefused = $derived(serverWarning(s.server));
  const modelRefused = $derived(urlMissing ? undefined : unsafeAddress(s.model.url, s.model.key));
  onMount(() => {
    if (inWindow) void readHosts(session);
  });
  /** An address off this computer blocks until confirmed: the field's error says it, after its own. */
  function hostError(url: string): string | undefined {
    const origin = inWindow ? offMachine(url) : null;
    if (!origin || !session.hosts) return undefined;
    return access.said[origin] || (session.hosts.includes(origin) ? undefined : OFF_MACHINE);
  }
</script>

<!-- Under an address off this computer: « Confirmer… » opens the system's box, from the window. One the page refuses
already is never offered. -->
{#snippet host(url: string, refused: string | undefined)}
  {@const origin = inWindow && !refused ? offMachine(url) : null}
  {#if origin}
    <div class="hote">
      {#if !session.hosts}
        <p class="aide">{CHECKING}</p>
      {:else if session.hosts.includes(origin)}
        <p class="aide">{CONFIRMED}</p>
        <Button
          variant="fantome"
          size="petit"
          aria-label="Oublier l’adresse confirmée {origin}"
          loading={access.busy === origin}
          onclick={(e) => void hostCall(access, origin, e.currentTarget, () => forgetHost(session, origin))}
          >Oublier</Button
        >
      {:else}
        <Button
          variant="secondaire"
          size="petit"
          aria-label="Confirmer l’adresse {origin}"
          loading={access.busy === origin}
          onclick={(e) => void hostCall(access, origin, e.currentTarget, () => confirmHost(session, url))}
          >Confirmer…</Button
        >
        <!-- Closed side, but said: the person knows why the box may come back. -->
        {#if session.hostsSaid}<p class="aide">Liste illisible : {session.hostsSaid}</p>{/if}
      {/if}
    </div>
  {/if}
{/snippet}

<main class="seuil">
  <div class="colonne">
    <header>
      <h1>{s.agent.name}</h1>
      <p class="sous">Un compagnon qui t’écoute et te répond à voix haute, sur ce poste.</p>
    </header>

    <div class="choix" role="radiogroup" aria-label="Sa façon de répondre">
      {#each CARDS as card (card.value)}
        <label class="carte">
          <input
            type="radio"
            name="{uid}-brain"
            value={card.value}
            checked={s.brain === card.value}
            aria-labelledby="{uid}-{card.value}"
            aria-describedby="{uid}-{card.value}-text {uid}-{card.value}-needs"
            onchange={() => session.switchBrain(card.value)}
          />
          <span class="titre" id="{uid}-{card.value}"
            ><span class="rond" aria-hidden="true"></span>{card.title}</span
          >
          <span class="texte" id="{uid}-{card.value}-text">{card.text}</span>
          <span class="texte faut" id="{uid}-{card.value}-needs">{card.needs}</span>
        </label>
      {/each}
    </div>

    {#if s.brain === 'alone' || inWindow || needsCode}
      <section class="champs" aria-label={s.brain === 'alone' ? 'Le modèle' : 'Le serveur'}>
        {#if s.brain === 'alone'}
          <div class="bloc">
            <Field
              label="Adresse du modèle"
              hint="Compatible OpenAI, souvent terminée par /v1."
              error={urlMissing ? undefined : (modelRefused ?? hostError(s.model.url))}
            >
              <TextInput value={s.model.url} oninput={(e) => set((d) => (d.model.url = typed(e).trim()))} />
            </Field>
            {#if urlMissing}<p class="manque" id="{uid}-missing">{missing}</p>{/if}
            {@render host(s.model.url, modelRefused)}
          </div>
          <div class="bloc">
            <Field label="Nom du modèle">
              <TextInput
                value={s.model.name}
                placeholder="par exemple llama3.1:8b"
                oninput={(e) => set((d) => (d.model.name = typed(e).trim()))}
              />
            </Field>
            {#if missing && !urlMissing}<p class="manque" id="{uid}-missing">{missing}</p>{/if}
          </div>
          <Field label="Clé (facultative)" hint="Elle reste sur ce poste.">
            <TextInput
              type="password"
              value={s.model.key}
              placeholder="Seulement pour un service en ligne"
              autocomplete="off"
              oninput={(e) => set((d) => (d.model.key = typed(e).trim()))}
            />
          </Field>
        {:else}
          {#if inWindow}
            <div class="bloc">
              <Field
                label="Adresse du serveur"
                hint="Sur ce poste, l’adresse par défaut convient. Pour un autre poste, son adresse en https."
                error={serverRefused ?? hostError(s.server)}
              >
                <TextInput
                  value={s.server}
                  onchange={(e) => {
                    const url = typed(e).trim();
                    if (url) session.setServer(url);
                  }}
                />
              </Field>
              {@render host(s.server, serverRefused)}
            </div>
          {/if}
          {#if needsCode}
            <div class="bloc">
              <Field
                label="Code d’appairage"
                hint="Le code s’affiche sur le serveur, là où on ajoute un appareil. Un seul usage, quelques minutes."
              >
                <CodeInput class="code-ici" bind:value={code} error={Boolean(refused)} oncomplete={pair} />
              </Field>
              {#if refused}<p class="manque" role="alert">{refused}</p>{/if}
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    <footer class="pied">
      {#if needsCode}
        <p class="aide">Le code complet fait entrer.</p>
      {:else}
        <Button
          variant="principal"
          size="grand"
          disabled={Boolean(missing)}
          aria-describedby={missing ? `${uid}-missing` : undefined}
          onclick={() => session.enter()}
        >
          Entrer
        </Button>
        <p class="aide">Tout se change ensuite dans ses réglages.</p>
      {/if}
    </footer>
  </div>
</main>

<style>
  /* The world is fixed and does not scroll: the arrival does, on a small window. */
  .seuil {
    height: 100%;
    overflow-y: auto;
    display: flex;
  }
  /* Centred on a tall screen; auto margins fall to zero on a short one, which then scrolls from the top. */
  .colonne {
    width: 100%;
    max-width: 640px;
    margin: auto;
    padding: 72px 16px 48px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    line-height: 1.5;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 8px;
    text-align: center;
  }
  h1 {
    margin: 0;
    font: 500 44px/1.1 var(--serif);
    letter-spacing: 0.01em;
    text-wrap: balance;
  }
  p {
    margin: 0;
  }
  .sous {
    text-wrap: balance;
    color: var(--texte-2);
    font-size: 14.5px;
  }
  .choix {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .carte {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 16px 16px 18px;
    border-radius: var(--r-3);
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    cursor: pointer;
  }
  .carte:hover {
    background: color-mix(in srgb, var(--surface-1), var(--ivoire) 3%);
  }
  .carte:has(input:checked) {
    border-color: var(--accent-bord);
    box-shadow: inset 0 0 0 1px var(--accent-bord);
    background: color-mix(in srgb, var(--surface-1), var(--accent) 10%);
  }
  .carte:has(input:focus-visible) {
    outline: 2px solid var(--accent-texte);
    outline-offset: 2px;
  }
  /* The real radio, under the card: the keyboard and the screen readers find it, the card shows its state. */
  .carte input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .titre {
    display: flex;
    align-items: center;
    gap: 10px;
    font: 500 15px var(--sans);
  }
  .rond {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 50%;
    border: 1.5px solid var(--bordure-forte);
  }
  .carte:has(input:checked) .rond {
    border-color: var(--accent-texte);
    background: var(--accent-texte);
    box-shadow: inset 0 0 0 3.5px var(--surface-1);
  }
  .texte {
    margin: 8px 0 0 26px;
    font-size: 13px;
    color: var(--texte-2);
  }
  .faut {
    margin-top: 10px;
    font-size: 12.5px;
    color: var(--texte-3);
  }
  .champs {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px;
    border-radius: var(--r-3);
    background: var(--surface-1);
    border: 1px solid var(--bordure);
  }
  /* Under its label, as the other fields: the kit centres it for a page of its own. */
  .champs :global(.code-ici) {
    justify-content: flex-start;
  }
  .bloc {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .manque {
    font-size: 12.5px;
    color: var(--attention);
  }
  .hote {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
  }
  .pied {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .pied :global(button) {
    min-width: 200px;
  }
  .aide {
    font-size: 12px;
    color: var(--texte-3);
  }
  @media (max-width: 560px) {
    .choix {
      grid-template-columns: 1fr;
    }
    h1 {
      font-size: 36px;
    }
  }
</style>
