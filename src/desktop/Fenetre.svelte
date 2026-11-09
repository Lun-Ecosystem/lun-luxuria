<script lang="ts">
  import { onMount } from 'svelte';
  import { Segmented, SettingsCard, SettingsRow, TextInput } from '../lib/ui/index.ts';
  import Switch from '../lib/ui/Switch.svelte';
  import type { Session } from '../session.svelte.ts';
  import type { Settings } from '../settings.ts';
  import { sceneScreen, type Screen } from './place.ts';
  import { screens } from './window.svelte.ts';

  /* What only the window has: its screen, starting with Windows, its keys, its icon near the clock. */

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
    label="Démarrer avec Windows"
    hint="À l’ouverture de la session, la fenêtre et son icône près de l’horloge."
    error={session.startSaid || null}
  >
    {#snippet children({ labelId })}
      <Switch
        checked={s.display.startWithWindows}
        aria-labelledby={labelId}
        onchange={(v) => set((d) => (d.display.startWithWindows = v))}
      />
    {/snippet}
  </SettingsRow>
  {#if s.brain === 'linked'}
    <SettingsRow
      label="Absence"
      hint="Sans clavier, souris ni parole pendant ce délai, les urgences partent au téléphone jusqu’à ton retour."
    >
      {#snippet children({ labelId })}
        <Switch checked={s.away.on} aria-labelledby={labelId} onchange={(v) => set((d) => (d.away.on = v))} />
      {/snippet}
    </SettingsRow>
    {#if s.away.on}
      <SettingsRow label="Délai d’absence" hint="De 1 à 240 minutes.">
        <TextInput
          value={String(s.away.minutes)}
          suffix="min"
          size="petit"
          aria-label="Délai d’absence"
          onchange={(e) => {
            const text = (e.currentTarget as HTMLInputElement).value;
            const n = Math.round(Number(text.replace(',', '.')));
            if (text.trim() !== '' && Number.isFinite(n))
              set((d) => (d.away.minutes = Math.min(240, Math.max(1, n))));
          }}
        />
      </SettingsRow>
    {/if}
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
  <SettingsRow
    label="Raccourci de la sourdine"
    hint="Coupe l’écoute et la parole d’un geste, sauf les urgences si elles sont dites. Exemple : Control+Shift+M."
  >
    <TextInput
      value={s.display.muteShortcut}
      size="petit"
      aria-label="Raccourci de la sourdine"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value.trim();
        if (v) set((d) => (d.display.muteShortcut = v));
      }}
    />
  </SettingsRow>
</SettingsCard>

<SettingsCard
  title="L’icône près de l’horloge"
  description="Afficher, la sourdine et Quitter, depuis la barre des tâches."
>
  <SettingsRow
    label="La trouver"
    hint="Windows range une nouvelle icône sous la flèche ^ de la barre des tâches. Glisse-la sur la barre pour la garder visible."
  />
  <SettingsRow
    label="Ses trois états"
    hint="Pleine et colorée : présente. Pleine et grise : en sourdine. Creuse : injoignable."
  />
  <SettingsRow
    label="En mode scène"
    hint="La scène couvre la barre des tâches : la sourdine est sur la scène, Quitter dans ces réglages."
  />
</SettingsCard>
