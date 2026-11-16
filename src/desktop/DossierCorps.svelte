<script lang="ts">
  import { Button, SettingsCard, SettingsRow, toast } from '../lib/ui/index.ts';
  import type { Session } from '../session.svelte.ts';
  import type { Settings } from '../settings.ts';
  import { reloadBody } from './corps.svelte.ts';
  import { forgetFolder, pickFolder } from './dossiers.ts';

  /*
   * In the window, the body comes from the folder the person chose in the system's dialog: the window keeps it,
   * its corps.json decides the level and the images.
   */

  let { session, set }: { session: Session; set: (change: (draft: Settings) => void) => void } = $props();
  const path = $derived(session.folders.corps);
  // Kept by an older page: shown until the window keeps a folder, never sent.
  const former = $derived(path ? '' : session.settings.body.formerFolder);

  /** A refusal of the window is said where the body's state is. */
  async function choose() {
    const done = await pickFolder(session, 'corps');
    if (typeof done === 'string') session.bodySaid = done;
    else if (done) {
      set((d) => (d.body.formerFolder = ''));
      void reloadBody(session);
    }
  }
  async function forget() {
    const done = await forgetFolder(session, 'corps');
    if (done === true) void reloadBody(session);
    else session.bodySaid = done;
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(former);
      toast('Chemin copié.');
    } catch {
      toast('Copie impossible : sélectionne le chemin.', { tone: 'danger' });
    }
  }
</script>

{#snippet notice()}Le dossier se choisit maintenant dans la boîte de dialogue du système. Choisis de nouveau
  celui-ci : <span class="chemin">{former}</span>.{/snippet}

<SettingsCard title="Son corps" description="Sur ce poste seulement.">
  <SettingsRow
    label="Dossier du corps"
    hint={path ?? (former ? notice : 'Aucun : le souffle. Choisis le dossier de son corps.json.')}
  >
    <span class="gestes">
      {#if path}
        <Button variant="fantome" size="petit" aria-label="Oublier le dossier du corps" onclick={forget}
          >Oublier</Button
        >
      {:else if former}
        <Button variant="fantome" size="petit" aria-label="Copier l’ancien dossier du corps" onclick={copy}
          >Copier</Button
        >
      {/if}
      <Button variant="secondaire" size="petit" aria-label="Choisir le dossier du corps" onclick={choose}
        >Choisir…</Button
      >
    </span>
  </SettingsRow>
  <SettingsRow label="Maintenant" hint={session.bodySaid || 'Son corps.json décide du niveau et des images.'}>
    <Button variant="secondaire" size="petit" onclick={() => void reloadBody(session)}>Relire</Button>
  </SettingsRow>
</SettingsCard>

<style>
  .gestes {
    display: inline-flex;
    gap: 8px;
  }
  /* One click takes the whole path, for the system's dialog when the clipboard refuses. */
  .chemin {
    user-select: all;
    overflow-wrap: anywhere;
    color: var(--texte-2);
  }
</style>
