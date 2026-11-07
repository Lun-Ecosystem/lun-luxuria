<script lang="ts">
  import { Button, CodeInput, Segmented, Toaster } from './lib/ui/index.ts';
  import { inWindow } from './desktop/net.ts';
  import { bodyFollows } from './desktop/corps.svelte.ts';
  import { keysFollow } from './desktop/keys.svelte.ts';
  import { pingVoice, startVoice } from './desktop/voix.ts';
  import { windowFollows } from './desktop/window.svelte.ts';
  import Reglages from './Reglages.svelte';
  import Scene from './Scene.svelte';
  import { Session } from './session.svelte.ts';

  const session = new Session();
  if (inWindow) {
    windowFollows(session);
    keysFollow(session);
    bodyFollows(session);
    void startVoice(session, pingVoice(session.voiceFetch));
  }
  let code = $state('');
  let refused = $state('');
  let settingsOpen = $state(false);
  const BRAINS = [
    { value: 'alone', label: 'Seul' },
    { value: 'linked', label: 'Relié à un serveur' },
  ];
  const needsCode = $derived(session.settings.brain === 'linked' && !session.token);

  async function pair(value: string) {
    refused = '';
    try {
      await session.pair(value);
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err);
      code = '';
    }
  }
</script>

<div class="monde" data-monde="luxuria">
  {#if !session.entered}
    <main class="seuil">
      <h1>{session.settings.agent.name}</h1>
      <Segmented
        options={BRAINS}
        value={session.settings.brain}
        label="Ce qui le fait répondre"
        onchange={(v) => session.switchBrain(v as 'alone' | 'linked')}
      />
      {#if needsCode}
        <p>Le code d’appairage se demande au serveur à relier.</p>
        <CodeInput bind:value={code} aria-label="Code d’appairage" oncomplete={pair} />
        {#if refused}<p class="refus" role="alert">{refused}</p>{/if}
      {:else}
        <Button onclick={() => session.enter()}>Entrer</Button>
      {/if}
    </main>
  {:else}
    <Scene {session} openSettings={() => (settingsOpen = true)} />
    {#if settingsOpen}
      <Reglages {session} close={() => (settingsOpen = false)} />
    {/if}
  {/if}
  <Toaster />
</div>

<style>
  .monde {
    position: fixed;
    inset: 0;
    background: var(--scene);
    color: var(--texte);
    font-family: var(--sans);
    color-scheme: dark;
    overflow: hidden;
  }
  .seuil {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    padding: 16px;
    text-align: center;
  }
  h1 {
    font-family: 'Cormorant Garamond', serif;
    font-weight: 500;
    font-size: 44px;
    margin: 0;
    letter-spacing: 0.02em;
  }
  p {
    margin: 0;
    color: var(--texte-2);
    font-size: 14px;
  }
  .refus {
    color: var(--attention);
  }
</style>
