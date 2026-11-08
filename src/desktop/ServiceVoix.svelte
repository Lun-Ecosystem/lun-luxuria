<script lang="ts">
  import {
    Badge,
    Button,
    Segmented,
    SettingsCard,
    SettingsRow,
    TextArea,
    TextInput,
  } from '../lib/ui/index.ts';
  import Switch from '../lib/ui/Switch.svelte';
  import type { Tone } from '../lib/ui/types.ts';
  import type { Session } from '../session.svelte.ts';
  import type { Settings } from '../settings.ts';
  import { inWindow } from './net.ts';
  import { argsOf, missing, pingVoice, startVoice } from './voix.ts';

  /*
   * The voice service and the programs it calls, each with its state and what to do when it does not answer.
   * In the window, set by named fields and launched with the app; in a browser tab, launched by hand.
   */

  let { session, set }: { session: Session; set: (change: (draft: Settings) => void) => void } = $props();
  const v = $derived(session.settings.voice.service);
  const lack = $derived(v.launch ? missing(v) : null);
  const STT = [
    { value: 'faster', label: 'Locale' },
    { value: 'whisper-server', label: 'whisper-server' },
  ];

  type State = { tone: Tone; text: string };
  const SERVICE: Record<Session['voiceStatus'], State> = {
    up: { tone: 'ok', text: 'Répond' },
    starting: { tone: 'attention', text: 'En démarrage' },
    down: { tone: 'danger', text: 'Absent' },
    unknown: { tone: 'neutre', text: 'Pas encore vérifié' },
  };
  const service = $derived(SERVICE[session.voiceStatus]);
  /** A brick inside the service answers with it (`own` undefined); one at its own address, as the service saw it. */
  function brick(own: boolean | undefined): State {
    if (session.voiceStatus === 'starting') return service;
    if (session.voiceStatus !== 'up') return { tone: 'neutre', text: 'Service absent' };
    return own === false ? { tone: 'danger', text: 'Absente' } : { tone: 'ok', text: 'Répond' };
  }
  const stt = $derived(brick(v.stt.kind === 'whisper-server' ? session.bricks?.stt.up : undefined));
  const rvc = $derived(brick(session.bricks?.rvc?.up));
  const AFTER = 'Lance-le, puis « Lancer ou vérifier ».';

  /** Saved as typed, so a click on the button right after counts; a number or a fallback waits for the field to be left. */
  const typed = (on: (d: Settings, value: string) => void) => (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value.trim();
    set((d) => on(d, value));
  };
  const check = () => void startVoice(session, pingVoice(session.voiceFetch));
</script>

{#snippet state(s: State)}<Badge tone={s.tone} dot>{s.text}</Badge>{/snippet}

<SettingsCard
  title="Le service voix"
  description="Il transcrit ce que tu dis et fabrique sa voix, sur ce poste seulement."
>
  <SettingsRow label="État" hint={session.voiceSaid || undefined}>{@render state(service)}</SettingsRow>
  {#if inWindow}
    <SettingsRow label="Lancer le service voix avec l’appli" hint="Seulement s’il ne répond pas déjà.">
      {#snippet children({ labelId })}
        <Switch
          checked={v.launch}
          aria-labelledby={labelId}
          onchange={(on) => set((d) => (d.voice.service.launch = on))}
        />
      {/snippet}
    </SettingsRow>
    {#if v.launch}
      <SettingsRow label="Dossier du service" hint="Celui qui contient service.py.">
        <TextInput
          value={v.folder}
          size="petit"
          aria-label="Dossier du service"
          oninput={typed((d, x) => (d.voice.service.folder = x))}
        />
      </SettingsRow>
    {/if}
    <SettingsRow label="Maintenant" hint="Le lance s’il le faut, sinon vérifie qu’il répond." error={lack}>
      <Button variant="secondaire" size="petit" disabled={lack !== null} onclick={check}
        >Lancer ou vérifier</Button
      >
    </SettingsRow>
  {:else}
    <SettingsRow
      label="Dans le navigateur"
      hint="Il se lance à la main, dans un terminal : uv run voix/service.py, avec sa transcription et sa voix."
    />
  {/if}
</SettingsCard>

{#if inWindow}
  <SettingsCard
    title="Transcription"
    description="Ce qui écrit ce que tu dis. Au prochain lancement du service."
  >
    <SettingsRow label="Moteur">
      <Segmented
        options={STT}
        value={v.stt.kind}
        label="Moteur de transcription"
        size="petit"
        onchange={(k) => set((d) => (d.voice.service.stt.kind = k as 'faster' | 'whisper-server'))}
      />
    </SettingsRow>
    {#if v.stt.kind === 'faster'}
      <SettingsRow label="Modèle" hint="Chargé dans le service : tiny, base, small, medium.">
        <TextInput
          value={v.stt.model}
          size="petit"
          aria-label="Modèle de transcription"
          onchange={typed((d, x) => (d.voice.service.stt.model = x || 'small'))}
        />
      </SettingsRow>
    {:else}
      <SettingsRow
        label="Adresse de whisper-server"
        hint="Un programme à part, que tu lances toi-même : l’appli vérifie qu’il répond."
      >
        <TextInput
          value={v.stt.url}
          size="petit"
          aria-label="Adresse de whisper-server"
          oninput={typed((d, x) => (d.voice.service.stt.url = x))}
        />
      </SettingsRow>
    {/if}
    <SettingsRow
      label="État"
      error={stt.tone === 'danger' ? `whisper-server ne répond pas à ${v.stt.url}. ${AFTER}` : null}
    >
      {@render state(stt)}
    </SettingsRow>
  </SettingsCard>

  <SettingsCard
    title="Sa voix"
    description="Une voix Piper, installée par toi. Au prochain lancement du service."
  >
    <SettingsRow label="Fichier de la voix" hint="Le chemin complet du fichier .onnx, son .onnx.json à côté.">
      <TextInput
        value={v.piper}
        size="petit"
        aria-label="Fichier de la voix"
        oninput={typed((d, x) => (d.voice.service.piper = x))}
      />
    </SettingsRow>
    <SettingsRow label="État">{@render state(brick(undefined))}</SettingsRow>
  </SettingsCard>

  <SettingsCard
    title="RVC"
    description="Facultatif : sa voix convertie par un programme à part, que tu lances toi-même."
  >
    <SettingsRow label="Passer par RVC">
      {#snippet children({ labelId })}
        <Switch
          checked={v.rvc.on}
          aria-labelledby={labelId}
          onchange={(on) => set((d) => (d.voice.service.rvc.on = on))}
        />
      {/snippet}
    </SettingsRow>
    {#if v.rvc.on}
      <SettingsRow label="Adresse de RVC">
        <TextInput
          value={v.rvc.url}
          size="petit"
          aria-label="Adresse de RVC"
          oninput={typed((d, x) => (d.voice.service.rvc.url = x))}
        />
      </SettingsRow>
      <SettingsRow label="Gain" hint="Sa sortie multipliée, puis bornée. De 0 à 10.">
        <TextInput
          value={String(v.rvc.gain)}
          size="petit"
          aria-label="Gain de RVC"
          onchange={typed((d, x) => {
            const n = Number(x.replace(',', '.'));
            if (x !== '' && Number.isFinite(n)) d.voice.service.rvc.gain = Math.min(10, Math.max(0, n));
          })}
        />
      </SettingsRow>
      <SettingsRow
        label="État"
        error={rvc.tone === 'danger' ? `RVC ne répond pas à ${v.rvc.url}. ${AFTER}` : null}
      >
        {@render state(rvc)}
      </SettingsRow>
    {/if}
  </SettingsCard>

  <SettingsCard title="Autres arguments du service">
    <SettingsRow
      label="Lignes ajoutées"
      hint="Un par ligne, tels quels, après les champs. Exemple : --lang, puis en."
    >
      <TextArea
        value={v.args.join('\n')}
        rows={3}
        aria-label="Autres arguments du service"
        oninput={(e) => {
          const lines = argsOf((e.currentTarget as HTMLTextAreaElement).value);
          set((d) => (d.voice.service.args = lines));
        }}
      />
    </SettingsRow>
  </SettingsCard>
{/if}
