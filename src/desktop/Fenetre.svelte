<script lang="ts">
  import { onMount } from 'svelte';
  import { Segmented, SettingsCard, SettingsRow, TextInput } from '../lib/ui/index.ts';
  import type { Session } from '../session.svelte.ts';
  import type { Settings } from '../settings.ts';
  import { sceneScreen, type Screen } from './place.ts';
  import { screens } from './window.svelte.ts';

  /* What only the window has: its screen, its keys, the body's folder, the voice service. */

  let { session, set }: { session: Session; set: (change: (draft: Settings) => void) => void } = $props();
  const s = $derived(session.settings);
  let found = $state<Screen[]>([]);
  onMount(() => {
    void screens().then((all) => (found = all));
  });
  const options = $derived(
    found.map((screen, i) => ({
      value: screen.name,
      label: `Écran ${i + 1}${screen.primary ? ' (principal)' : ''}`,
    })),
  );
</script>

<SettingsCard title="La fenêtre" description="Sur ce poste seulement. Tout agit tout de suite.">
  {#if found.length > 1}
    <SettingsRow label="Écran de la scène" hint="Le petit mode reste là où tu le poses.">
      <Segmented
        {options}
        value={sceneScreen(found, s.display.screen).name}
        label="Écran de la scène"
        size="petit"
        onchange={(v) => set((d) => (d.display.screen = v))}
      />
    </SettingsRow>
  {:else}
    <SettingsRow label="Écran de la scène" hint="Un seul écran branché : la scène le prend." />
  {/if}
  <SettingsRow
    label="Raccourci scène, petit mode"
    hint="Depuis n’importe quelle fenêtre, sans couper sa voix. Exemple : Control+Shift+L."
  >
    <TextInput
      value={s.display.shortcut}
      size="petit"
      aria-label="Raccourci scène, petit mode"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value.trim();
        if (v) set((d) => (d.display.shortcut = v));
      }}
    />
  </SettingsRow>
</SettingsCard>
