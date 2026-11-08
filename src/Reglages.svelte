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
    TextArea,
    TextInput,
    type IconComponent,
  } from './lib/ui/index.ts';
  import NavGroup from './lib/ui/NavGroup.svelte';
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
      group: 'Lui',
      description: 'Qui il est, et ce qui le fait répondre.',
    },
    {
      id: 'corps',
      label: 'Corps',
      icon: PersonStanding,
      group: 'Lui',
      description: 'Ce que la scène montre de lui.',
    },
    {
      id: 'ecoute',
      label: 'Écoute',
      icon: Ear,
      group: 'La conversation',
      description: 'Comment lui parler, ce qui part, et quand il se tait.',
    },
    {
      id: 'voix',
      label: 'Voix',
      icon: AudioLines,
      group: 'La conversation',
      description: 'Le service qui transcrit et parle, ses programmes, et ce qui est dit à voix haute.',
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
      <Button variant="fantome" size="petit" icon={ArrowLeft} class="retour" onclick={back}>Réglages</Button>
      <header class="tete">
        <small>{page.group}</small>
        <h2 tabindex="-1" bind:this={heading}>{page.label}</h2>
        <p>{page.description}</p>
      </header>
      {#if page.id === 'agent'}
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
        <SettingsCard
          title="Lui parler"
          description="Tout agit tout de suite. Rien ne reste figé dans le code."
        >
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
          {@render field(
            'Durée minimale de phrase',
            undefined,
            String(s.endOfSpeech.minSpeechMs),
            'ms',
            (v) => set((d) => (d.endOfSpeech.minSpeechMs = number(v, 32, 3000, d.endOfSpeech.minSpeechMs))),
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
      {:else if page.id === 'voix'}
        <ServiceVoix {session} {set} />

        {#if s.brain === 'linked'}
          <SettingsCard title="Ce qui est dit à voix haute" description="Le fil les garde dans tous les cas.">
            {@render toggle('L’accueil, à ton arrivée', undefined, s.speak.ritual, (v) =>
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

        <SettingsCard title="Ce qu’on entend">
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
        </SettingsCard>

        <SettingsCard title="Mesures de cette session">
          <SettingsRow
            label="De ta dernière syllabe à son premier son"
            hint={direct.length
              ? `Médiane ${median(direct)} ms sur ${direct.length} tours, dernier ${direct[0]} ms.`
              : 'Pas encore de tour à la voix.'}
          />
        </SettingsCard>
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
    grid-template-columns: 236px minmax(0, 1fr);
    background: var(--fond);
    color: var(--texte);
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
    max-width: 780px;
    margin: 0 auto;
  }
  .colonne :global(.retour) {
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
    .colonne :global(.retour) {
      display: inline-flex;
      align-self: flex-start;
    }
    h2 {
      font-size: 26px;
    }
  }
</style>
