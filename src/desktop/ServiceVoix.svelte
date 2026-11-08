<script lang="ts">
  import {
    Badge,
    Button,
    Segmented,
    SettingsCard,
    SettingsRow,
    TextArea,
    TextInput,
    toast,
  } from '../lib/ui/index.ts';
  import Switch from '../lib/ui/Switch.svelte';
  import type { Tone } from '../lib/ui/types.ts';
  import type { Session } from '../session.svelte.ts';
  import type { Program, Settings } from '../settings.ts';
  import { inWindow } from './net.ts';
  import {
    argsOf,
    changes,
    checkVoice,
    followPrograms,
    forgetProgram,
    launchProgram,
    missing,
    pickProgram,
    pingVoice,
    PROGRAMS,
    restartVoice,
    runningWith,
    startVoice,
    type ProgramName,
  } from './voix.ts';

  /*
   * The voice service and the programs it calls, each with its state and what to do when it does not answer.
   * In the window, set by named fields and launched with the app; in a browser tab, launched by hand.
   */

  let { session, set }: { session: Session; set: (change: (draft: Settings) => void) => void } = $props();
  const v = $derived(session.settings.voice.service);
  const lack = $derived(v.launch ? missing(v) : null);
  const busy = $derived(session.voiceBusy);
  // Already answering, it can always be checked again.
  const blocked = $derived(lack !== null && session.voiceStatus !== 'up');
  const STT = [
    { value: 'faster', label: 'Locale' },
    { value: 'whisper-server', label: 'whisper-server' },
  ];
  const STT_NAME = { faster: 'Locale', 'whisper-server': 'whisper-server' } as const;

  type State = { tone: Tone; text: string };
  const SERVICE: Record<Session['voiceStatus'], State> = {
    up: { tone: 'ok', text: 'Répond' },
    starting: { tone: 'attention', text: 'En démarrage' },
    down: { tone: 'danger', text: 'Absent' },
    unknown: { tone: 'neutre', text: 'Pas encore vérifié' },
  };
  const service = $derived(SERVICE[session.voiceStatus]);
  const STARTING: State = { tone: 'attention', text: 'En démarrage' };
  /**
   * A brick inside the service answers with it (`own` undefined); one at its own address, as the service saw it
   * (`null`: the service could not say). A program the window is launching is starting, not missing.
   */
  function brick(own: boolean | null | undefined, name?: ProgramName): State {
    if (name && session.programs[name]?.starting) return STARTING;
    if (session.voiceStatus === 'starting') return service;
    if (session.voiceStatus !== 'up') return { tone: 'neutre', text: 'Service absent' };
    if (own === null) return { tone: 'neutre', text: 'Pas vérifié' };
    return own === false ? { tone: 'danger', text: 'Absente' } : { tone: 'ok', text: 'Répond' };
  }
  // What the running service uses wins over the fields, which wait for its next launch, and the screen says so.
  const run = $derived(runningWith(session));
  const sttWaits = $derived(run.stt !== undefined && run.stt !== v.stt.kind);
  const stt = $derived.by((): State => {
    if (run.stt !== undefined && sttWaits)
      return { tone: 'neutre', text: `En marche : ${STT_NAME[run.stt]}` };
    if (v.stt.kind !== 'whisper-server') return brick(undefined);
    return brick(session.bricks ? session.bricks.stt.up : null, 'whisper-server');
  });
  const rvcWaits = $derived(run.rvc === false && v.rvc.on);
  const rvc = $derived(
    rvcWaits
      ? { tone: 'neutre' as const, text: 'En marche : sans RVC' }
      : brick(session.bricks ? (session.bricks.rvc?.up ?? null) : null, 'rvc'),
  );
  const piperWaits = $derived(run.piper !== undefined && run.piper !== v.piper);
  const WAITS = 'attend la relance du service.';
  /** What to do when a program does not answer: launch it from here when it is picked, else by hand. */
  const absent = (name: ProgramName, url: string) =>
    `${PROGRAMS[name]} ne répond pas à ${url}. ` +
    (session.programPaths[name]
      ? `Lance-le avec « Lancer ${PROGRAMS[name]} ».`
      : 'Lance-le, puis « Lancer ou vérifier ».');

  /** Saved as typed, so a click on the button right after counts; a number or a fallback waits for the field to be left. */
  const typed = (on: (d: Settings, value: string) => void) => (e: Event) => {
    const value = (e.currentTarget as HTMLInputElement).value.trim();
    set((d) => on(d, value));
  };
  /** The button that runs says so, and its result comes as a toast; a refusal in the danger tone. */
  async function act(job: () => Promise<boolean>) {
    if (session.voiceBusy) return;
    const done = await job();
    toast(session.voiceSaid, done && session.voiceStatus === 'up' ? {} : { tone: 'danger' });
  }
  const check = () => act(() => startVoice(session, pingVoice(session.voiceFetch)));
  const restart = () => act(() => restartVoice(session, pingVoice(session.voiceFetch)));
  const waiting = $derived(changes(session));

  let launching = $state<ProgramName | null>(null);
  async function launch(name: ProgramName) {
    if (launching) return;
    launching = name;
    try {
      if (await launchProgram(session, name)) void followPrograms(session);
    } finally {
      launching = null;
    }
    const s = session.programs[name];
    if (s) toast(s.said, s.ok ? {} : { tone: 'danger' });
  }
</script>

{#snippet state(s: State)}<Badge tone={s.tone} dot>{s.text}</Badge>{/snippet}

{#snippet program(name: ProgramName, p: Program, edit: (d: Settings) => Program)}
  {@const label = PROGRAMS[name]}
  {@const path = session.programPaths[name]}
  <SettingsRow
    label="Son programme"
    hint={path ?? 'Aucun : tu le lances toi-même. Choisis son .exe pour que l’appli le lance.'}
  >
    <span class="gestes">
      {#if path}
        <Button
          variant="fantome"
          size="petit"
          aria-label="Oublier le programme de {label}"
          onclick={() => void forgetProgram(session, name)}>Oublier</Button
        >
      {/if}
      <Button
        variant="secondaire"
        size="petit"
        aria-label="Choisir le programme de {label}"
        onclick={() => void pickProgram(session, name)}>Choisir…</Button
      >
    </span>
  </SettingsRow>
  {#if path}
    <SettingsRow label="Ses arguments" hint="Un par ligne, tels quels : son modèle, son port.">
      <TextArea
        value={p.args.join('\n')}
        rows={2}
        aria-label="Arguments de {label}"
        oninput={(e) => {
          const lines = argsOf((e.currentTarget as HTMLTextAreaElement).value);
          set((d) => (edit(d).args = lines));
        }}
      />
    </SettingsRow>
    <SettingsRow label="Lancer {label} avec l’appli" hint="Seulement si rien ne répond déjà à son adresse.">
      {#snippet children({ labelId })}
        <Switch
          checked={p.launch}
          aria-labelledby={labelId}
          onchange={(on) => set((d) => (edit(d).launch = on))}
        />
      {/snippet}
    </SettingsRow>
    <SettingsRow label="Maintenant" hint={session.programs[name]?.said}>
      <Button
        variant="secondaire"
        size="petit"
        disabled={launching !== null && launching !== name}
        loading={launching === name}
        onclick={() => void launch(name)}>Lancer {label}</Button
      >
    </SettingsRow>
  {:else if session.programs[name]}
    <SettingsRow label="Maintenant" hint={session.programs[name]?.said} />
  {/if}
{/snippet}

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
      <Button
        variant="secondaire"
        size="petit"
        disabled={blocked || busy === 'restart'}
        loading={busy === 'check'}
        onclick={check}>{busy === 'check' ? 'Vérification en cours' : 'Lancer ou vérifier'}</Button
      >
    </SettingsRow>
    {#if session.voiceArgs}
      <SettingsRow
        label="Relancer le service"
        hint={waiting === 'restart'
          ? 'Des réglages attendent : il tourne encore avec les réglages précédents.'
          : 'L’arrête, puis le relance avec les champs ci-dessous.'}
      >
        <Button
          variant={waiting === 'restart' ? 'principal' : 'secondaire'}
          size="petit"
          disabled={lack !== null || busy === 'check'}
          loading={busy === 'restart'}
          onclick={restart}>Relancer le service</Button
        >
      </SettingsRow>
    {:else if waiting === 'manual'}
      <SettingsRow
        label="Des réglages attendent"
        hint="Il a été lancé hors de l’appli, avec d’autres réglages : relance-le toi-même pour les prendre."
      />
    {/if}
  {:else}
    <SettingsRow
      label="Dans le navigateur"
      hint="Il se lance à la main, dans un terminal : uv run voix/service.py, avec sa transcription et sa voix."
    >
      <Button variant="secondaire" size="petit" onclick={() => void checkVoice(session)}>Vérifier</Button>
    </SettingsRow>
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
        hint="Un programme à part : l’appli le lance si tu choisis son programme, et vérifie qu’il répond."
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
      hint={sttWaits ? `${STT_NAME[v.stt.kind]} ${WAITS}` : undefined}
      error={stt.tone === 'danger' ? absent('whisper-server', v.stt.url) : null}
    >
      {@render state(stt)}
    </SettingsRow>
    {#if v.stt.kind === 'whisper-server'}
      {@render program('whisper-server', v.stt.program, (d) => d.voice.service.stt.program)}
    {/if}
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
    <SettingsRow label="État" hint={piperWaits ? `Ce fichier ${WAITS}` : undefined}>
      {@render state(brick(undefined))}
    </SettingsRow>
  </SettingsCard>

  <SettingsCard
    title="RVC"
    description="Facultatif : sa voix convertie par un programme à part, lancé par toi ou par l’appli."
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
        hint={rvcWaits ? `RVC ${WAITS}` : undefined}
        error={rvc.tone === 'danger' ? absent('rvc', v.rvc.url) : null}
      >
        {@render state(rvc)}
      </SettingsRow>
      {@render program('rvc', v.rvc.program, (d) => d.voice.service.rvc.program)}
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

<style>
  .gestes {
    display: inline-flex;
    gap: 8px;
  }
</style>
