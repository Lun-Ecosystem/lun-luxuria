<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { IconButton, Segmented, SettingsCard, SettingsRow, TextArea, TextInput } from './lib/ui/index.ts';
  import Switch from './lib/ui/Switch.svelte';
  import Fenetre from './desktop/Fenetre.svelte';
  import { inWindow, serverWarning } from './desktop/net.ts';
  import { DEFAULTS, type Settings, type TalkMode } from './settings.ts';
  import type { Session } from './session.svelte.ts';

  /* Every mechanic of §6.8 has its switch. All act at once; the microphone options at its next opening. */

  let { session, close }: { session: Session; close: () => void } = $props();
  const s = $derived(session.settings);

  /** Saves a copy with `change` applied: the session keeps the only state. */
  function set(change: (draft: Settings) => void) {
    const draft = $state.snapshot(session.settings) as Settings;
    change(draft);
    session.saveSettings(draft);
  }

  function number(text: string, min: number, max: number, fallback: number): number {
    const n = Number(text.replace(',', '.'));
    return text.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  const list = (text: string) =>
    text
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const BRAINS = [
    { value: 'alone', label: 'Seul' },
    { value: 'linked', label: 'Relié à un serveur' },
  ];
  const TALK = [
    { value: 'open', label: 'Micro ouvert' },
    { value: 'key', label: 'Touche' },
    { value: 'muted', label: 'Coupé' },
  ];
  const BARGE = [
    { value: 'now', label: 'Immédiate' },
    { value: 'soft', label: 'À la fin de la phrase' },
  ];
  const BODY = [
    { value: 'breath', label: 'Le souffle' },
    { value: 'images', label: 'Les images' },
  ];
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const direct = $derived(session.latencies.map((l) => l.ms));
</script>

{#snippet toggle(label: string, hint: string | undefined, checked: boolean, on: (v: boolean) => void)}
  <SettingsRow {label} {hint}>
    {#snippet children({ labelId })}
      <Switch {checked} aria-labelledby={labelId} onchange={on} />
    {/snippet}
  </SettingsRow>
{/snippet}

{#snippet field(
  label: string,
  hint: string | undefined,
  value: string,
  suffix: string | undefined,
  on: (v: string) => void,
)}
  <SettingsRow {label} {hint}>
    <TextInput
      {value}
      {suffix}
      size="petit"
      aria-label={label}
      onchange={(e) => on((e.currentTarget as HTMLInputElement).value)}
    />
  </SettingsRow>
{/snippet}

<section class="reglages" aria-label="Réglages">
  <header>
    <h2>Réglages</h2>
    <IconButton icon={X} label="Fermer les réglages" onclick={close} />
  </header>
  <div class="cartes">
    <SettingsCard title="L’agent" description="Son nom est aussi le mot qui l’appelle.">
      {@render field('Nom', undefined, s.agent.name, undefined, (v) =>
        set((d) => (d.agent.name = v.trim() || d.agent.name)),
      )}
      {#if s.brain === 'alone'}
        <SettingsRow label="Ton et contexte" hint="Ce qu’il sait de lui et de toi, à chaque réponse.">
          <TextArea
            value={s.agent.context}
            rows={3}
            aria-label="Ton et contexte"
            onchange={(e) => {
              const value = (e.currentTarget as HTMLTextAreaElement).value;
              set((d) => (d.agent.context = value));
            }}
          />
        </SettingsRow>
      {/if}
    </SettingsCard>

    <SettingsCard title="Ce qui le fait répondre">
      <SettingsRow label="Fonctionnement" hint="Changer recharge la page.">
        <Segmented
          options={BRAINS}
          value={s.brain}
          label="Fonctionnement"
          size="petit"
          onchange={(v) => session.switchBrain(v as 'alone' | 'linked')}
        />
      </SettingsRow>
      {#if inWindow && s.brain === 'linked'}
        {@render field(
          'Adresse du serveur',
          serverWarning(s.server) ?? 'Changer efface l’appairage : un nouveau code sera demandé.',
          s.server,
          undefined,
          (v) => v.trim() && session.setServer(v.trim()),
        )}
      {/if}
      {#if s.brain === 'alone'}
        {@render field(
          'Adresse du modèle',
          'Un service compatible OpenAI, sur ce poste ou en ligne.',
          s.model.url,
          undefined,
          (v) => set((d) => (d.model.url = v.trim() || DEFAULTS.model.url)),
        )}
        {@render field('Modèle', undefined, s.model.name, undefined, (v) =>
          set((d) => (d.model.name = v.trim())),
        )}
        <SettingsRow label="Clé" hint="Facultative. Gardée dans ce navigateur, sur ce poste seulement.">
          <TextInput
            type="password"
            value={s.model.key}
            size="petit"
            autocomplete="off"
            aria-label="Clé"
            onchange={(e) => {
              const value = (e.currentTarget as HTMLInputElement).value.trim();
              set((d) => (d.model.key = value));
            }}
          />
        </SettingsRow>
        {@render field(
          'Plafond par jour',
          'Vérifié avant chaque appel. 0 : pas de plafond.',
          String(s.model.tokensPerDay),
          'jetons',
          (v) => set((d) => (d.model.tokensPerDay = number(v, 0, 100_000_000, d.model.tokensPerDay))),
        )}
      {/if}
    </SettingsCard>

    {#if inWindow}
      <Fenetre {session} {set} />
    {/if}

    <SettingsCard title="Lui parler" description="Tout agit tout de suite. Rien ne reste figé dans le code.">
      <SettingsRow label="Dans la scène">
        <Segmented
          options={TALK}
          value={s.talk.scene}
          label="Façon de parler dans la scène"
          size="petit"
          onchange={(v) => set((d) => (d.talk.scene = v as TalkMode))}
        />
      </SettingsRow>
      <SettingsRow label="En petit mode">
        <Segmented
          options={TALK}
          value={s.talk.small}
          label="Façon de parler en petit mode"
          size="petit"
          onchange={(v) => set((d) => (d.talk.small = v as TalkMode))}
        />
      </SettingsRow>
      {@render toggle('Touche à maintenir', undefined, s.key.on, (v) => set((d) => (d.key.on = v)))}
      {@render field(
        'Code de la touche',
        inWindow
          ? session.keysSaid || 'Depuis n’importe quelle fenêtre.'
          : 'Dans cette fenêtre seulement : l’appli de bureau la prend depuis toutes.',
        s.key.code,
        undefined,
        (v) => set((d) => (d.key.code = v.trim() || DEFAULTS.key.code)),
      )}
    </SettingsCard>

    <SettingsCard
      title="Ce qui est écouté"
      description="Le filtre ne laisse partir qu’une phrase qui passe l’une des règles activées."
    >
      {@render toggle('Filtre dans la scène', undefined, s.filter.scene, (v) =>
        set((d) => (d.filter.scene = v)),
      )}
      {@render toggle('Filtre en petit mode', undefined, s.filter.small, (v) =>
        set((d) => (d.filter.small = v)),
      )}
      {@render toggle('Mention du nom', undefined, s.name.on, (v) => set((d) => (d.name.on = v)))}
      {@render field(
        'Autres mots reconnus',
        'Séparés par des virgules.',
        s.name.words.join(', '),
        undefined,
        (v) => set((d) => (d.name.words = list(v))),
      )}
      {@render field(
        'Tolérance',
        'Lettres d’écart admises avec ce que la transcription a écrit.',
        String(s.name.tolerance),
        undefined,
        (v) => set((d) => (d.name.tolerance = number(v, 0, 4, d.name.tolerance))),
      )}
      {@render toggle('Fenêtre après sa parole', undefined, s.window.on, (v) =>
        set((d) => (d.window.on = v)),
      )}
      {@render field('Durée de la fenêtre', undefined, String(s.window.seconds), 's', (v) =>
        set((d) => (d.window.seconds = number(v, 1, 300, d.window.seconds))),
      )}
      {@render toggle(
        'Trace d’une phrase ignorée',
        'Sur cet écran seulement, rien ne part.',
        s.traceIgnored,
        (v) => set((d) => (d.traceIgnored = v)),
      )}
    </SettingsCard>

    <SettingsCard title="Une autre appli sur le micro">
      {@render toggle(
        'Détection',
        'L’écoute s’arrête et la voix se tait. Un serveur relié reçoit « occupé », jamais le nom de l’appli.',
        s.busy.on,
        (v) => set((d) => (d.busy.on = v)),
      )}
      {@render field(
        'Applis ignorées',
        'Séparées par des virgules.',
        s.busy.ignored.join(', '),
        undefined,
        (v) => set((d) => (d.busy.ignored = list(v))),
      )}
      {@render field('Délai de retour', undefined, String(s.busy.returnSeconds), 's', (v) =>
        set((d) => (d.busy.returnSeconds = number(v, 0, 120, d.busy.returnSeconds))),
      )}
    </SettingsCard>

    <SettingsCard title="Fin de phrase et coupure">
      {@render field('Silence de fin de phrase', undefined, String(s.endOfSpeech.silenceMs), 'ms', (v) =>
        set((d) => (d.endOfSpeech.silenceMs = number(v, 200, 3000, d.endOfSpeech.silenceMs))),
      )}
      {@render toggle(
        'Répondre dès une courte pause',
        'Sa réponse se prépare sans se dire, et se retire si tu continues. Chaque essai coûte un appel.',
        s.endOfSpeech.speculate,
        (v) => set((d) => (d.endOfSpeech.speculate = v)),
      )}
      {@render field('Courte pause', undefined, String(s.endOfSpeech.pauseMs), 'ms', (v) =>
        set((d) => (d.endOfSpeech.pauseMs = number(v, 64, 2000, d.endOfSpeech.pauseMs))),
      )}
      {@render field(
        'Seuil du silence',
        'Plus bas, le micro entend tout ; plus haut, il faut parler plus fort.',
        String(s.endOfSpeech.floorDb),
        'dB',
        (v) => set((d) => (d.endOfSpeech.floorDb = number(v, -90, -10, d.endOfSpeech.floorDb))),
      )}
      {@render field('Durée minimale de phrase', undefined, String(s.endOfSpeech.minSpeechMs), 'ms', (v) =>
        set((d) => (d.endOfSpeech.minSpeechMs = number(v, 32, 3000, d.endOfSpeech.minSpeechMs))),
      )}
      {@render toggle('Couper à la voix', undefined, s.bargeIn.on, (v) => set((d) => (d.bargeIn.on = v)))}
      <SettingsRow label="Façon de couper">
        <Segmented
          options={BARGE}
          value={s.bargeIn.mode}
          label="Façon de couper"
          size="petit"
          onchange={(v) => set((d) => (d.bargeIn.mode = v as 'soft' | 'now'))}
        />
      </SettingsRow>
      {@render field(
        'Voix tenue avant de couper',
        'Une toux plus courte ne coupe rien.',
        String(s.bargeIn.holdMs),
        'ms',
        (v) => set((d) => (d.bargeIn.holdMs = number(v, 32, 3000, d.bargeIn.holdMs))),
      )}
    </SettingsCard>

    {#if s.brain === 'linked'}
      <SettingsCard title="Ce qui est dit à voix haute" description="Le fil les garde dans tous les cas.">
        {@render toggle('L’accueil, à ton arrivée', undefined, s.speak.ritual, (v) =>
          set((d) => (d.speak.ritual = v)),
        )}
        {@render toggle('Les urgences', undefined, s.speak.p0, (v) => set((d) => (d.speak.p0 = v)))}
        {@render toggle(
          'La parole spontanée',
          'À activer aussi sur le serveur relié.',
          s.speak.spontaneous,
          (v) => set((d) => (d.speak.spontaneous = v)),
        )}
      </SettingsCard>
    {/if}

    <SettingsCard title="Sa voix et son corps">
      {@render field('Volume', 'De 0 à 1.', String(s.voice.volume), undefined, (v) =>
        set((d) => (d.voice.volume = number(v, 0, 1, d.voice.volume))),
      )}
      {@render toggle(
        'Annulation d’écho du micro',
        'À la prochaine ouverture.',
        s.voice.echoCancellation,
        (v) => set((d) => (d.voice.echoCancellation = v)),
      )}
      {@render toggle(
        'Suppression de bruit du micro',
        'À la prochaine ouverture.',
        s.voice.noiseSuppression,
        (v) => set((d) => (d.voice.noiseSuppression = v)),
      )}
      <SettingsRow label="Corps">
        <Segmented
          options={BODY}
          value={s.body.level}
          label="Corps"
          size="petit"
          onchange={(v) => set((d) => (d.body.level = v as 'breath' | 'images'))}
        />
      </SettingsRow>
      {@render field(
        'Image au repos',
        'Adresse de l’image. Sans elle, le souffle.',
        s.body.rest,
        undefined,
        (v) => set((d) => (d.body.rest = v.trim())),
      )}
      {@render field('Image pendant la parole', undefined, s.body.talking, undefined, (v) =>
        set((d) => (d.body.talking = v.trim())),
      )}
    </SettingsCard>

    <SettingsCard title="Mesures de cette session">
      <SettingsRow
        label="De ta dernière syllabe à son premier son"
        hint={direct.length
          ? `Médiane ${median(direct)} ms sur ${direct.length} tours, dernier ${direct[0]} ms.`
          : 'Pas encore de tour à la voix.'}
      />
    </SettingsCard>
  </div>
</section>

<style>
  .reglages {
    position: absolute;
    inset: 0;
    z-index: 10;
    overflow-y: auto;
    background: var(--fond);
    padding: 12px 16px 48px;
  }
  header {
    max-width: 760px;
    margin: 0 auto 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
  }
  .cartes {
    max-width: 760px;
    margin: 0 auto;
    display: grid;
    gap: 14px;
  }
</style>
