<script lang="ts">
  import { tick } from 'svelte';
  import { Button, SettingsRow, toast } from '../lib/ui/index.ts';
  import type { Session } from '../session.svelte.ts';
  import type { Settings } from '../settings.ts';
  import { forgetFolder, formerOf, formerWaiting, pickFolder, type FolderName } from './dossiers.ts';

  /*
   * A folder the person chose in the system's dialog, kept by the window under its name: the body's, the voice
   * service's. The page shows its path, and only asks to choose or forget it.
   */

  let {
    session,
    set,
    name,
    of,
    none,
    after,
  }: {
    session: Session;
    set: (change: (draft: Settings) => void) => void;
    name: FolderName;
    /** The folder in its labels: « du corps », « du service ». */
    of: string;
    /** Said while the window keeps none and none waits. */
    none: string;
    /** What follows a choice or a forget that worked: the body reads itself again; the service, nothing. */
    after?: () => void;
  } = $props();
  const path = $derived(session.folders[name]);
  // Kept by an older page: shown until the window keeps a folder, never sent.
  const former = $derived(formerWaiting(session, name));
  /** The window's refusal, announced on the folder's row until the next try. */
  let refused = $state('');
  // One call at a time: two clicks before the dialog shows would open a second, refused one.
  let working = $state<'choose' | 'forget' | null>(null);
  // Null once the settings close: the window may answer after.
  let gestes: HTMLSpanElement | null = null;

  async function choose() {
    if (working) return;
    working = 'choose';
    refused = '';
    try {
      const done = await pickFolder(session, name);
      if (typeof done === 'string') refused = done;
      else if (done) {
        set((d) => (formerOf(d, name).formerFolder = ''));
        after?.();
      }
    } finally {
      working = null;
    }
  }
  async function forget() {
    if (working) return;
    working = 'forget';
    refused = '';
    try {
      const done = await forgetFolder(session, name);
      if (done !== true) return void (refused = done);
      after?.();
      // « Oublier » went with the folder: the focus goes to « Choisir… », once it is enabled again.
      working = null;
      await tick();
      gestes?.querySelector<HTMLElement>(`[aria-label="Choisir le dossier ${of}"]`)?.focus();
    } finally {
      working = null;
    }
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

<!-- The refusal goes beside the path or the notice, never in their place: the old path is the fallback to copy. -->
{#snippet folder()}
  {#if path}<span class="garde">{path}</span>{:else if former}Le dossier se choisit maintenant dans la boîte
    de dialogue du système. Choisis de nouveau celui-ci : <span class="chemin">{former}</span
    >.{:else}{none}{/if}
  {#if refused}<span class="refus" role="alert">{refused}</span>{/if}
{/snippet}

<SettingsRow label="Dossier {of}" hint={folder}>
  <span class="gestes" bind:this={gestes}>
    {#if path}
      <Button
        variant="fantome"
        size="petit"
        aria-label="Oublier le dossier {of}"
        disabled={working === 'choose'}
        loading={working === 'forget'}
        onclick={forget}>Oublier</Button
      >
    {:else if former}
      <Button variant="fantome" size="petit" aria-label="Copier l’ancien dossier {of}" onclick={copy}
        >Copier</Button
      >
    {/if}
    <Button
      variant="secondaire"
      size="petit"
      aria-label="Choisir le dossier {of}"
      disabled={working === 'forget'}
      loading={working === 'choose'}
      onclick={choose}>Choisir…</Button
    >
  </span>
</SettingsRow>

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
  /* The kit's tone for a refused value, on its own line under the path. */
  .refus {
    display: block;
    color: var(--danger);
  }
  /* A Windows path has no space to break at: it wraps anywhere rather than pass under the buttons. */
  .garde,
  .refus {
    overflow-wrap: anywhere;
  }
</style>
