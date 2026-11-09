<script lang="ts">
  import { tick } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import AudioLines from '@lucide/svelte/icons/audio-lines';
  import Ear from '@lucide/svelte/icons/ear';
  import Monitor from '@lucide/svelte/icons/monitor';
  import PersonStanding from '@lucide/svelte/icons/person-standing';
  import Power from '@lucide/svelte/icons/power';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import X from '@lucide/svelte/icons/x';
  import {
    Button,
    IconButton,
    NavLink,
    Segmented,
    SettingsCard,
    SettingsRow,
    Slider,
    TextArea,
    TextInput,
    type IconComponent,
  } from './lib/ui/index.ts';
  import NavGroup from './lib/ui/NavGroup.svelte';
  import Avance from './Avance.svelte';
  import { presetOf, withPreset, type Preset } from './listen/presets.ts';
  import Switch from './lib/ui/Switch.svelte';
  import DossierCorps from './desktop/DossierCorps.svelte';
  import Fenetre from './desktop/Fenetre.svelte';
  import ServiceVoix from './desktop/ServiceVoix.svelte';
  import { quit } from './desktop/window.svelte.ts';
  import { inWindow, serverWarning } from './desktop/net.ts';
  import { DEFAULTS, type Settings, type TalkMode } from './settings.ts';
  import type { Session } from './session.svelte.ts';

  /*
   * Every mechanic of §6.8 has its switch. All act at once; the microphone options at its next opening.
   * A column of themes, one page per theme, as in the other apps. Narrow (the small mode, a phone), the column is
   * the list and a theme opens alone.
   */

  type Theme = 'agent' | 'corps' | 'ecoute' | 'voix' | 'fenetre';
  let { session, close, start = 'agent' }: { session: Session; close: () => void; start?: Theme } = $props();

  interface Page {
    id: Theme;
    label: string;
    icon: IconComponent;
    group: string;
    description: string;
  }
  const PAGES: Page[] = [
    {
      id: 'agent',
      label: 'L’agent',
      icon: Sparkles,
      group: 'Identité',
      description: 'Son nom, son ton, et ce qui produit ses réponses.',
    },
    {
      id: 'corps',
      label: 'Corps',
      icon: PersonStanding,
      group: 'Identité',
      description: 'Ce que la scène montre.',
    },
    {
      id: 'ecoute',
      label: 'Écoute',
      icon: Ear,
      group: 'La conversation',
      description: 'Comment lui parler, et ce qui part.',
    },
    {
      id: 'voix',
      label: 'Voix',
      icon: AudioLines,
      group: 'La conversation',
      description: 'Ce qu’on entend, ce qui est dit à voix haute, et le service qui transcrit et parle.',
    },
    ...(inWindow
      ? [
          {
            id: 'fenetre' as const,
            label: 'Fenêtre',
            icon: Monitor,
            group: 'Ce poste',
            description: 'L’écran, le démarrage, les raccourcis et l’icône près de l’horloge.',
          },
        ]
      : []),
  ];
  const GROUPS = [...new Set(PAGES.map((p) => p.group))];
  // svelte-ignore state_referenced_locally
  let theme = $state<Theme>(start);
  /** Narrow: a theme is open, else the list shows. Opened on a given theme, it is. */
  // svelte-ignore state_referenced_locally
  let opened = $state(start !== 'agent');
  const page = $derived(PAGES.find((p) => p.id === theme) ?? PAGES[0]!);
  let heading = $state<HTMLElement | null>(null);
  let nav = $state<HTMLElement | null>(null);

  /* Changing page moves the focus with it: narrow, the list and the page replace each other. */
  function open(next: Theme) {
    return async (event: MouseEvent) => {
      event.preventDefault();
      theme = next;
      opened = true;
      await tick();
      heading?.focus();
    };
  }
  async function back() {
    opened = false;
    await tick();
    nav?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }
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
  /** Milliseconds kept, seconds read and typed: « 0,5 ». */
  const secs = (ms: number) => String(ms / 1000).replace('.', ',');
  const ms = (text: string, min: number, max: number, fallback: number) =>
    Math.round(number(text, min / 1000, max / 1000, fallback / 1000) * 1000);
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
  const FILTER = 'Seules les phrases qui lui sont adressées partent.';
  const ROOMS = [
    { value: 'calme', label: 'Pièce calme' },
    { value: 'normal', label: 'Normal' },
    { value: 'bruit', label: 'Bruit autour' },
  ];
  const ROOM_SAID: Record<Preset, string> = {
    calme: 'Pièce calme : la fin de phrase vient plus tôt, et une voix basse compte.',
    normal: 'Normal : les valeurs conseillées.',
    bruit: 'Bruit autour : la fin de phrase attend un peu, et le bruit de fond ne compte pas.',
  };
  const CUSTOM = 'Personnalisé : une valeur avancée a été changée à la main.';
  const room = $derived(presetOf(s.endOfSpeech));
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

<section class={['reglages', { ouvert: opened }]} aria-label="Réglages">
  <nav class="themes" aria-label="Thèmes des réglages" bind:this={nav}>
    <div class="tete-nav">
      <h1>Réglages</h1>
      <IconButton icon={X} label="Fermer les réglages" onclick={close} />
    </div>
    {#each GROUPS as group (group)}
      <NavGroup title={group}>
        <div class="bloc">
          {#each PAGES.filter((p) => p.group === group) as p (p.id)}
            <NavLink href="#" label={p.label} icon={p.icon} current={theme === p.id} onclick={open(p.id)} />
          {/each}
        </div>
      </NavGroup>
    {/each}
    {#if inWindow}
      <div class="quitter">
        <Button variant="fantome" size="petit" icon={Power} onclick={() => void quit()}
          >Quitter l’appli</Button
        >
      </div>
    {/if}
  </nav>
  <div class="contenu">
    <div class="colonne">
      <div class="haut">
        <Button variant="fantome" size="petit" icon={ArrowLeft} onclick={back}>Réglages</Button>
        <IconButton icon={X} label="Fermer les réglages" onclick={close} />
      </div>
      <header class="tete">
        <small>{page.group}</small>
        <h2 tabindex="-1" bind:this={heading}>{page.label}</h2>
        <p>{page.description}</p>
      </header>
      {#if page.id === 'agent'}
        <SettingsCard title="Nom et ton">
          {@render field('Nom', 'C’est aussi le mot qui l’appelle.', s.agent.name, undefined, (v) =>
            set((d) => (d.agent.name = v.trim() || d.agent.name)),
          )}
          <SettingsRow
            label="Ton et contexte"
            class="pleine"
            hint={s.brain === 'alone'
              ? 'Son rôle, et ce qu’il faut savoir de toi. Relu à chaque réponse.'
              : 'Relié, le serveur décide du ton : cette zone ne sert qu’en fonctionnement seul.'}
          >
            <TextArea
              value={s.agent.context}
              rows={8}
              disabled={s.brain === 'linked'}
              aria-label="Ton et contexte"
              onchange={(e) => {
                const value = (e.currentTarget as HTMLTextAreaElement).value;
                set((d) => (d.agent.context = value));
              }}
            />
          </SettingsRow>
        </SettingsCard>

        <SettingsCard
          title="Ses réponses"
          description="Seul, d’un modèle que tu choisis ; relié, d’un serveur."
        >
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
        </SettingsCard>

        {#if s.brain === 'alone'}
          <Avance what="le modèle, la clé, le plafond">
            <SettingsCard title="Le modèle">
              {@render field(
                'Adresse du modèle',
                'Compatible OpenAI, souvent terminée par /v1.',
                s.model.url,
                undefined,
                (v) => set((d) => (d.model.url = v.trim() || DEFAULTS.model.url)),
              )}
              {@render field('Nom du modèle', undefined, s.model.name, undefined, (v) =>
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
                'Au-delà, plus de réponse jusqu’au lendemain. 0 : sans plafond.',
                String(s.model.tokensPerDay),
                'jetons',
                (v) => set((d) => (d.model.tokensPerDay = number(v, 0, 100_000_000, d.model.tokensPerDay))),
              )}
            </SettingsCard>
          </Avance>
        {/if}
      {:else if page.id === 'corps'}
        {#if inWindow}
          <DossierCorps {session} {set} />
        {:else}
          <SettingsCard title="Son corps" description="Le souffle, ou des images à leurs adresses.">
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
        {/if}
      {:else if page.id === 'ecoute'}
        <SettingsCard title="Comment lui parler" description="Pour chaque mode d’affichage.">
          <SettingsRow label="Sur la scène">
            <Segmented
              options={TALK}
              value={s.talk.scene}
              label="Façon de parler dans la scène"
              size="petit"
              onchange={(v) => set((d) => (d.talk.scene = v as TalkMode))}
            />
          </SettingsRow>
          {@render toggle('Filtre dans la scène', FILTER, s.filter.scene, (v) =>
            set((d) => (d.filter.scene = v)),
          )}
          <SettingsRow label="En petit mode">
            <Segmented
              options={TALK}
              value={s.talk.small}
              label="Façon de parler en petit mode"
              size="petit"
              onchange={(v) => set((d) => (d.talk.small = v as TalkMode))}
            />
          </SettingsRow>
          {@render toggle('Filtre en petit mode', FILTER, s.filter.small, (v) =>
            set((d) => (d.filter.small = v)),
          )}
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
          {@render toggle(
            'Mention du nom',
            'Son nom et les mots ajoutés ; une transcription proche compte aussi.',
            s.name.on,
            (v) => set((d) => (d.name.on = v)),
          )}
          {@render field(
            'Autres mots reconnus',
            'Séparés par des virgules.',
            s.name.words.join(', '),
            undefined,
            (v) => set((d) => (d.name.words = list(v))),
          )}
        </SettingsCard>

        <SettingsCard title="La pièce" description="Règle d’un coup la fin de phrase et le seuil du silence.">
          <SettingsRow label="Autour de toi" hint={room ? ROOM_SAID[room] : CUSTOM}>
            <Segmented
              options={ROOMS}
              value={room ?? ''}
              label="Autour de toi"
              size="petit"
              onchange={(v) => set((d) => (d.endOfSpeech = withPreset(d.endOfSpeech, v as Preset)))}
            />
          </SettingsRow>
        </SettingsCard>

        <Avance what="fin de phrase, filtre, interruption, applis ignorées, mesures">
          <SettingsCard title="Fin de phrase">
            {@render field(
              'Silence de fin de phrase',
              'Conseillé : 0,5 s.',
              secs(s.endOfSpeech.silenceMs),
              's',
              (v) => set((d) => (d.endOfSpeech.silenceMs = ms(v, 200, 3000, d.endOfSpeech.silenceMs))),
            )}
            {@render toggle(
              'Répondre dès une courte pause',
              'Sa réponse se prépare sans se dire, et se retire si tu continues. Chaque essai coûte un appel.',
              s.endOfSpeech.speculate,
              (v) => set((d) => (d.endOfSpeech.speculate = v)),
            )}
            {@render field('Courte pause', undefined, secs(s.endOfSpeech.pauseMs), 's', (v) =>
              set((d) => (d.endOfSpeech.pauseMs = ms(v, 64, 2000, d.endOfSpeech.pauseMs))),
            )}
            {@render field(
              'Seuil du silence',
              'Plus bas, le micro entend tout ; plus haut, il faut parler plus fort. Conseillé : -50 dB.',
              String(s.endOfSpeech.floorDb),
              'dB',
              (v) => set((d) => (d.endOfSpeech.floorDb = number(v, -90, -10, d.endOfSpeech.floorDb))),
            )}
            {@render field(
              'Durée minimale de phrase',
              'Plus court, c’est un bruit.',
              secs(s.endOfSpeech.minSpeechMs),
              's',
              (v) => set((d) => (d.endOfSpeech.minSpeechMs = ms(v, 32, 3000, d.endOfSpeech.minSpeechMs))),
            )}
          </SettingsCard>

          <SettingsCard
            title="Le filtre"
            description="Une phrase part si elle passe l’une des règles activées."
          >
            {@render field(
              'Tolérance',
              'Lettres d’écart admises avec ce que la transcription a écrit.',
              String(s.name.tolerance),
              undefined,
              (v) => set((d) => (d.name.tolerance = number(v, 0, 4, d.name.tolerance))),
            )}
            {@render toggle(
              'Fenêtre après sa parole',
              'Sans dire son nom, pendant ce temps.',
              s.window.on,
              (v) => set((d) => (d.window.on = v)),
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

          <SettingsCard title="L’interrompre">
            {@render toggle('Couper à la voix', undefined, s.bargeIn.on, (v) =>
              set((d) => (d.bargeIn.on = v)),
            )}
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
              secs(s.bargeIn.holdMs),
              's',
              (v) => set((d) => (d.bargeIn.holdMs = ms(v, 32, 3000, d.bargeIn.holdMs))),
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

          <SettingsCard title="Mesures de cette session">
            <SettingsRow
              label="De ta dernière syllabe à son premier son"
              hint={direct.length
                ? `Médiane ${secs(median(direct)!)} s sur ${direct.length} tours, dernier ${secs(direct[0]!)} s.`
                : 'Pas encore de tour à la voix.'}
            />
          </SettingsCard>
        </Avance>
      {:else if page.id === 'voix'}
        <SettingsCard title="Ce qu’on entend">
          <SettingsRow label="Volume">
            <Slider
              value={Math.round(s.voice.volume * 100)}
              min={0}
              max={100}
              step={5}
              label="Volume"
              onchange={(v) => set((d) => (d.voice.volume = v / 100))}
            />
          </SettingsRow>
        </SettingsCard>

        {#if s.brain === 'linked'}
          <SettingsCard title="Ce qui est dit à voix haute" description="Le fil les garde dans tous les cas.">
            {@render toggle('L’accueil, au lancement et au retour', undefined, s.speak.ritual, (v) =>
              set((d) => (d.speak.ritual = v)),
            )}
            {@render toggle('Les urgences', 'Vaut aussi en sourdine.', s.speak.p0, (v) =>
              set((d) => (d.speak.p0 = v)),
            )}
            {@render toggle(
              'La parole spontanée',
              'À activer aussi sur le serveur relié.',
              s.speak.spontaneous,
              (v) => set((d) => (d.speak.spontaneous = v)),
            )}
          </SettingsCard>
        {/if}

        <ServiceVoix {session} {set} part="courant" />

        <Avance what={inWindow ? 'le service et ses programmes, l’écho et le bruit' : 'l’écho et le bruit'}>
          <ServiceVoix {session} {set} part="avance" />
          <SettingsCard title="Le micro" description="À sa prochaine ouverture.">
            {@render toggle('Annulation d’écho du micro', undefined, s.voice.echoCancellation, (v) =>
              set((d) => (d.voice.echoCancellation = v)),
            )}
            {@render toggle('Suppression de bruit du micro', undefined, s.voice.noiseSuppression, (v) =>
              set((d) => (d.voice.noiseSuppression = v)),
            )}
          </SettingsCard>
        </Avance>
      {:else if page.id === 'fenetre'}
        <Fenetre {session} {set} />
      {/if}
    </div>
  </div>
</section>

<style>
  .reglages {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    background: var(--fond);
    color: var(--texte);
    font-size: 14px;
  }
  .themes {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 10px 18px;
    border-right: 1px solid var(--bordure);
  }
  .tete-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 4px 10px;
  }
  h1 {
    margin: 0;
    font: 500 24px/1.2 var(--serif);
  }
  .bloc {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .quitter {
    margin-top: auto;
    padding-top: 18px;
  }
  .contenu {
    min-height: 0;
    overflow-y: auto;
    padding: 24px 32px 48px;
  }
  .colonne {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 720px;
    margin: 0 auto;
  }
  /* A row whose field needs the whole width: the label above it. */
  .contenu :global(.ligne.pleine) {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  /* Narrow only: the column of themes, and its close button, are not there. */
  .haut {
    display: none;
  }
  .tete small {
    font: 500 10.5px var(--sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--texte-3);
  }
  h2 {
    margin: 4px 0 6px;
    font: 500 32px/1.1 var(--serif);
  }
  /* Focused by the page change, not by the user: no ring around a title. */
  h2:focus {
    outline: none;
  }
  .tete p {
    margin: 0;
    color: var(--texte-2);
  }

  @media (max-width: 767.98px) {
    .reglages {
      grid-template-columns: minmax(0, 1fr);
    }
    .themes {
      gap: 14px;
      padding: 10px 14px 24px;
      border-right: 0;
    }
    .ouvert .themes,
    .reglages:not(.ouvert) .contenu {
      display: none;
    }
    .bloc {
      gap: 0;
      overflow: hidden;
      border: 1px solid var(--bordure);
      border-radius: var(--r-3);
      background: var(--surface-1);
    }
    .themes :global(.lien) {
      height: 46px;
      border-radius: 0;
    }
    .contenu {
      padding: 10px 14px 32px;
    }
    .colonne {
      gap: 14px;
    }
    .haut {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    h2 {
      font-size: 26px;
    }
  }
</style>
