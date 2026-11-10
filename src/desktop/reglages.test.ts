import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const where = vi.hoisted(() => ({ inWindow: true }));
vi.mock('./net.ts', async (real) => ({
  ...(await real<typeof import('./net.ts')>()),
  get inWindow() {
    return where.inWindow;
  },
}));
// The window's own card asks the system for its screens: one here, as on a laptop.
const quit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./window.svelte.ts', () => ({
  quit,
  screens: async () => [
    {
      name: 'DISPLAY1',
      primary: true,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      scale: 1,
      work: { x: 0, y: 0, width: 1920, height: 1040 },
    },
  ],
}));

// What the page asks of the window: answered here, by command name.
const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => null));
vi.mock('@tauri-apps/api/core', async (real) => ({
  ...(await real<typeof import('@tauri-apps/api/core')>()),
  invoke,
}));

const { default: Reglages } = await import('../Reglages.svelte');
const { toasts, dismissAll } = await import('../lib/ui/toasts.svelte.ts');
const { Session } = await import('../session.svelte.ts');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  where.inWindow = true;
  invoke.mockReset();
  invoke.mockImplementation(async () => null);
  dismissAll();
});

describe('the server’s address', () => {
  it('shows in the window, linked, and warns of a token in clear', () => {
    localStorage.setItem(
      'luxuria.settings',
      JSON.stringify({ brain: 'linked', server: 'http://machine.exemple:8788' }),
    );
    render(Reglages, { session: new Session(), close: () => {} });
    expect(screen.getByRole('textbox', { name: 'Adresse du serveur' })).toHaveValue(
      'http://machine.exemple:8788',
    );
    expect(screen.getByText(/partirait en clair/)).toBeInTheDocument();
  });

  it('never shows in a browser tab, nor alone', () => {
    where.inWindow = false;
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    const { unmount } = render(Reglages, { session: new Session(), close: () => {} });
    expect(screen.queryByRole('textbox', { name: 'Adresse du serveur' })).toBeNull();
    unmount();
    where.inWindow = true;
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'alone' }));
    render(Reglages, { session: new Session(), close: () => {} });
    expect(screen.queryByRole('textbox', { name: 'Adresse du serveur' })).toBeNull();
  });

  it('a new address forgets the token: it never goes to another server', () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    localStorage.setItem('luxuria.token', 'jeton');
    const session = new Session();
    session.setServer('http://127.0.0.1:8788');
    expect(session.token).toBe('jeton'); // the same address changes nothing
    session.setServer('https://serveur.exemple');
    expect(session.token).toBeNull();
    expect(localStorage.getItem('luxuria.token')).toBeNull();
    expect(session.core.token).toBeNull();
    expect(JSON.parse(localStorage.getItem('luxuria.settings')!).server).toBe('https://serveur.exemple');
  });
});

describe('the desk mute', () => {
  it('its shortcut is set in the window, and the urgent switch says it holds in the mute too', () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    const session = new Session();
    render(Reglages, { session, close: () => {} });
    void fireEvent.click(screen.getByRole('link', { name: 'Fenêtre' }));
    flushSync();
    expect(screen.getByRole('textbox', { name: 'Raccourci de la sourdine' })).toHaveValue('Control+Shift+M');
    void fireEvent.click(screen.getByRole('link', { name: 'Voix' }));
    flushSync();
    expect(screen.getByText('Vaut aussi en sourdine.')).toBeInTheDocument();
  });
});

describe('the absence', () => {
  it('linked, its switch and its delay are in the window’s theme, and saved as typed', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    const session = new Session();
    render(Reglages, { session, close: () => {} });
    await fireEvent.click(screen.getByRole('link', { name: 'Fenêtre' }));
    expect(screen.getByRole('switch', { name: 'Absence' })).toBeChecked();
    const delay = screen.getByRole('textbox', { name: 'Délai d’absence' });
    expect(delay).toHaveValue('15');
    await fireEvent.change(delay, { target: { value: '30' } });
    expect(session.settings.away.minutes).toBe(30);
    await fireEvent.change(delay, { target: { value: '7,6' } });
    expect(session.settings.away.minutes).toBe(8);
    await fireEvent.change(delay, { target: { value: '0' } });
    expect(session.settings.away.minutes).toBe(1);
    await fireEvent.change(delay, { target: { value: '' } });
    expect(session.settings.away.minutes).toBe(1);
    await fireEvent.click(screen.getByRole('switch', { name: 'Absence' }));
    expect(session.settings.away.on).toBe(false);
  });

  it('alone, nobody to tell: no absence', async () => {
    render(Reglages, { session: new Session(), close: () => {} });
    await fireEvent.click(screen.getByRole('link', { name: 'Fenêtre' }));
    expect(screen.queryByRole('switch', { name: 'Absence' })).toBeNull();
  });
});

describe('the themes', () => {
  it('one page at a time, from the kit’s navigation; the window’s theme only in the window', async () => {
    render(Reglages, { session: new Session(), close: () => {}, start: 'voix' });
    expect(screen.getByRole('link', { name: 'Voix' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Voix' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Nom' })).toBeNull();
    await fireEvent.click(screen.getByRole('link', { name: 'L’agent' }));
    expect(screen.getByRole('textbox', { name: 'Nom' })).toBeInTheDocument();
  });

  it('a browser tab has no window theme, and no quitting', () => {
    where.inWindow = false;
    render(Reglages, { session: new Session(), close: () => {} });
    expect(screen.queryByRole('link', { name: 'Fenêtre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitter l’appli' })).toBeNull();
  });

  it('quitting is offered in the window, from every theme', async () => {
    render(Reglages, { session: new Session(), close: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Quitter l’appli' }));
    expect(quit).toHaveBeenCalledOnce();
  });
});

describe('the voice theme', () => {
  const service = (over: object) =>
    localStorage.setItem(
      'luxuria.settings',
      JSON.stringify({ voice: { service: { launch: true, ...over } } }),
    );

  it('named fields, no argument line to write; what is missing is said, and the button waits for it', () => {
    service({ folder: '', piper: '' });
    render(Reglages, { session: new Session(), close: () => {}, start: 'voix' });
    expect(screen.getByRole('textbox', { name: 'Fichier de la voix' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'whisper-server' })).toBeInTheDocument();
    // Said by the button that waits, and in the folded block, by the fields.
    expect(screen.getAllByText(/Il manque le dossier du service/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Lancer ou vérifier' })).toBeDisabled();
  });

  it('a field counts as typed, without leaving it', async () => {
    service({ folder: '' });
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'voix' });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Dossier du service' }), {
      target: { value: 'D:\\voix' },
    });
    expect(session.settings.voice.service.folder).toBe('D:\\voix');
  });

  it('a program the service could not check is not shown as answering', () => {
    service({
      folder: 'D:/voix',
      piper: 'D:/v.onnx',
      stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' },
    });
    const session = new Session();
    session.voiceStatus = 'up';
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText('Pas vérifié')).toBeInTheDocument();
  });

  it('a browser tab checks again on demand', () => {
    where.inWindow = false;
    render(Reglages, { session: new Session(), close: () => {}, start: 'voix' });
    expect(screen.getByRole('button', { name: 'Vérifier' })).toBeEnabled();
  });

  it('each brick says its state, and what to do when it does not answer', () => {
    service({
      folder: 'D:\\voix',
      piper: 'D:\\v.onnx',
      stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' },
      rvc: { on: true, url: 'http://127.0.0.1:18888', gain: 2 },
    });
    const session = new Session();
    session.voiceStatus = 'up';
    session.bricks = { stt: { kind: 'whisper-server', up: false }, rvc: { up: true } };
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText(/whisper-server ne répond pas à http:\/\/127\.0\.0\.1:8080/)).toBeInTheDocument();
    expect(screen.getAllByText('Répond').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the voice theme, after a change', () => {
  const READY = { launch: true, folder: 'D:/voix', piper: 'D:/v.onnx' };
  const service = (over: object = {}) =>
    localStorage.setItem('luxuria.settings', JSON.stringify({ voice: { service: { ...READY, ...over } } }));
  const answering = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ stt: { kind: 'faster', up: true }, rvc: null }), { status: 200 }),
      ),
    );

  it('the button says it works, then gives its result', async () => {
    service();
    answering();
    let release = () => {};
    invoke.mockImplementation(() => new Promise((r) => (release = () => r(null))));
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'voix' });
    await fireEvent.click(screen.getByRole('button', { name: 'Lancer ou vérifier' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /Vérification/ })).toHaveAttribute('aria-busy', 'true'),
    );
    release();
    await vi.waitFor(() => expect(toasts().map((t) => t.message)).toContain('Le service voix répond.'));
    expect(screen.getByRole('button', { name: 'Lancer ou vérifier' })).not.toHaveAttribute('aria-busy');
  });

  it('started by the app with other fields: says it waits, and restarts it', async () => {
    service({ stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' } });
    answering();
    const session = new Session();
    session.voiceStatus = 'up';
    session.voiceArgs = ['--stt', 'faster:small', '--tts', 'piper:D:/v.onnx'];
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText(/tourne encore avec les réglages précédents/)).toBeInTheDocument();
    invoke.mockImplementation(async (cmd: string) => (cmd === 'voice_running' ? null : 'C:/logs/voix.log'));
    await fireEvent.click(screen.getByRole('button', { name: 'Relancer le service' }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('voice_restart', {
        dir: 'D:/voix',
        args: ['--stt', 'whisper-server:http://127.0.0.1:8080', '--tts', 'piper:D:/v.onnx'],
      }),
    );
  });

  it('started by hand with another transcription: says to restart it by hand, no restart button', () => {
    service({ stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' } });
    const session = new Session();
    session.voiceStatus = 'up';
    session.bricks = { stt: { kind: 'faster', up: true }, rvc: null };
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText(/lancé hors de l’appli/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Relancer le service' })).toBeNull();
  });

  it('the running service wins over the fields, and each card says what waits for its restart', () => {
    service({
      stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' },
      rvc: { on: true, url: 'http://127.0.0.1:18888', gain: 2 },
    });
    const session = new Session();
    session.voiceStatus = 'up';
    session.voiceArgs = ['--stt', 'faster:small', '--tts', 'piper:D:/v.onnx'];
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText('En marche : Locale')).toBeInTheDocument();
    expect(screen.getByText('whisper-server attend la relance du service.')).toBeInTheDocument();
    expect(screen.getByText('En marche : sans RVC')).toBeInTheDocument();
    expect(screen.getByText('RVC attend la relance du service.')).toBeInTheDocument();
  });

  it('started by hand with RVC, RVC switched off: says other settings wait, not another transcription', () => {
    service({ rvc: { on: false, url: 'http://127.0.0.1:18888', gain: 2 } });
    const session = new Session();
    session.voiceStatus = 'up';
    session.bricks = { stt: { kind: 'faster', up: true }, rvc: { up: true } };
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText(/lancé hors de l’appli, avec d’autres réglages/)).toBeInTheDocument();
  });

  it('whisper-server and RVC: picked in the system’s dialog, then arguments, a switch, and a launch by hand', async () => {
    service({
      stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' },
      rvc: { on: true, url: 'http://127.0.0.1:18888', gain: 2 },
    });
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'program_pick'
        ? 'D:/whisper/whisper-server.exe'
        : cmd === 'program_start'
          ? { outcome: 'answering', log: '' }
          : null,
    );
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'voix' });
    // Not picked: no path field to type, nothing to launch from here.
    expect(screen.queryByRole('textbox', { name: /Programme/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Arguments de whisper-server' })).toBeNull();
    expect(screen.getAllByText(/Choisis son \.exe pour que l’appli le lance/)).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: 'Choisir le programme de whisper-server' }));
    expect(invoke).toHaveBeenCalledWith('program_pick', { name: 'whisper-server' });
    await vi.waitFor(() => expect(screen.getByText('D:/whisper/whisper-server.exe')).toBeInTheDocument());
    await fireEvent.input(screen.getByRole('textbox', { name: 'Arguments de whisper-server' }), {
      target: { value: '-m\nmodels/small.bin' },
    });
    expect(session.settings.voice.service.stt.program).toEqual({
      args: ['-m', 'models/small.bin'],
      launch: false,
    });
    expect(screen.getByRole('switch', { name: 'Lancer whisper-server avec l’appli' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Lancer whisper-server' }));
    await vi.waitFor(() =>
      expect(screen.getByText('Il répond déjà à son adresse : rien n’a été lancé.')).toBeInTheDocument(),
    );
    expect(invoke).toHaveBeenCalledWith('program_start', {
      name: 'whisper-server',
      args: ['-m', 'models/small.bin'],
      addr: '127.0.0.1:8080',
    });
    expect(screen.queryByRole('button', { name: 'Lancer RVC' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Oublier le programme de whisper-server' }));
    expect(invoke).toHaveBeenCalledWith('program_forget', { name: 'whisper-server' });
    await vi.waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Arguments de whisper-server' })).toBeNull(),
    );
  });
});

type Theme = 'agent' | 'corps' | 'ecoute' | 'voix' | 'fenetre';
/** The settings opened on a theme, with these settings saved. */
function opened(start: Theme, settings: object = {}) {
  localStorage.setItem('luxuria.settings', JSON.stringify(settings));
  const session = new Session();
  render(Reglages, { session, close: () => {}, start });
  return session;
}
/** The page's folded block. */
const advanced = () => screen.getByText(/^Réglages avancés/).closest('details')!;

describe('everyday first', () => {
  it('the agent: its name, its tone and how it answers; the model folded', () => {
    opened('agent');
    expect(advanced()).not.toHaveAttribute('open');
    for (const label of ['Nom', 'Ton et contexte', 'Fonctionnement'])
      expect(within(advanced()).queryByLabelText(label)).toBeNull();
    for (const label of ['Adresse du modèle', 'Nom du modèle', 'Clé', 'Plafond par jour'])
      expect(within(advanced()).getByLabelText(label)).toBeInTheDocument();
  });

  it('linked, nothing to fold on the agent', () => {
    opened('agent', { brain: 'linked' });
    expect(screen.queryByText(/^Réglages avancés/)).toBeNull();
  });

  it('listening: how to talk, the name, the key and the room; the fine tuning folded, measures last', () => {
    opened('ecoute');
    for (const label of [
      'Façon de parler dans la scène',
      'Façon de parler en petit mode',
      'Filtre dans la scène',
      'Filtre en petit mode',
      'Touche à tenir',
      'Code de la touche',
      'Son nom l’appelle',
      'Autres mots reconnus',
      'Autour de toi',
    ])
      expect(within(advanced()).queryByLabelText(label)).toBeNull();
    for (const label of [
      'Silence de fin de phrase',
      'Tolérance sur son nom',
      'L’interrompre à la voix',
      'Applis ignorées',
    ])
      expect(within(advanced()).getByLabelText(label)).toBeInTheDocument();
    expect(within(advanced()).getByText('Mesures de cette session')).toBeInTheDocument();
  });

  it('the voice: the volume, what is said, the service’s state; its programs and the microphone folded', () => {
    opened('voix', { brain: 'linked' });
    for (const label of ['Volume', 'Les urgences'])
      expect(within(advanced()).queryByLabelText(label)).toBeNull();
    expect(screen.getByRole('button', { name: 'Lancer ou vérifier' })).toBeInTheDocument();
    expect(within(advanced()).queryByRole('button', { name: 'Lancer ou vérifier' })).toBeNull();
    for (const label of [
      'Lancer le service voix avec l’appli',
      'Moteur de transcription',
      'Annulation d’écho du micro',
    ])
      expect(within(advanced()).getByLabelText(label)).toBeInTheDocument();
  });
});

describe('nothing disappears', () => {
  const EVERY: Record<'agent' | 'ecoute' | 'voix', string[]> = {
    agent: [
      'Nom',
      'Ton et contexte',
      'Fonctionnement',
      'Adresse du modèle',
      'Nom du modèle',
      'Clé',
      'Plafond par jour',
    ],
    ecoute: [
      'Façon de parler dans la scène',
      'Façon de parler en petit mode',
      'Touche à tenir',
      'Code de la touche',
      'Filtre dans la scène',
      'Filtre en petit mode',
      'Son nom l’appelle',
      'Autres mots reconnus',
      'Tolérance sur son nom',
      'L’écouter après sa phrase',
      'Durée de l’écoute après sa phrase',
      'Trace d’une phrase ignorée',
      'Silence de fin de phrase',
      'Répondre dès une courte pause',
      'Courte pause',
      'Seuil du silence',
      'Parole la plus courte',
      'L’interrompre à la voix',
      'Façon de l’interrompre',
      'Voix tenue avant de l’interrompre',
      'Applis qui prennent le micro',
      'Applis ignorées',
      'Délai de retour',
    ],
    voix: [
      'Volume',
      'Annulation d’écho du micro',
      'Suppression de bruit du micro',
      'Lancer le service voix avec l’appli',
      'Moteur de transcription',
      'Modèle de transcription',
      'Fichier de la voix',
      'Passer par RVC',
      'Autres arguments du service',
    ],
  };
  for (const [theme, labels] of Object.entries(EVERY))
    it(`every field of « ${theme} » is still there`, () => {
      opened(theme as Theme);
      for (const label of labels) expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    });

  it('the rows that show only once set: the launch, whisper-server, RVC', () => {
    opened('voix', {
      voice: { service: { launch: true, stt: { kind: 'whisper-server' }, rvc: { on: true } } },
    });
    for (const label of ['Dossier du service', 'Adresse de whisper-server', 'Adresse de RVC', 'Gain de RVC'])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('in a tab: the body by its images, and the service checked by hand', () => {
    where.inWindow = false;
    opened('corps');
    for (const label of ['Image au repos', 'Image pendant la parole'])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    cleanup();
    opened('voix');
    expect(screen.getByRole('button', { name: 'Vérifier' })).toBeInTheDocument();
  });

  it('linked: the server’s address and what is said aloud', () => {
    opened('agent', { brain: 'linked' });
    expect(screen.getByLabelText('Adresse du serveur')).toBeInTheDocument();
    cleanup();
    opened('voix', { brain: 'linked' });
    for (const label of ['L’accueil, au lancement et au retour', 'Les urgences', 'La parole spontanée'])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
});

describe('folded, as rows', () => {
  it('the listening: rows and no card, a value and its switch on one row', () => {
    opened('ecoute');
    expect(within(advanced()).queryAllByRole('heading')).toEqual([]);
    for (const [toggle, value] of [
      ['Répondre dès une courte pause', 'Courte pause'],
      ['L’écouter après sa phrase', 'Durée de l’écoute après sa phrase'],
      ['Applis qui prennent le micro', 'Applis ignorées'],
    ] as const)
      expect(screen.getByRole('switch', { name: toggle }).closest('.ligne')).toContainElement(
        screen.getByRole('textbox', { name: value }),
      );
  });

  it('the voice in a tab: rows too; in the window, its programs keep their cards', () => {
    where.inWindow = false;
    opened('voix');
    expect(within(advanced()).queryAllByRole('heading')).toEqual([]);
    cleanup();
    where.inWindow = true;
    opened('voix');
    expect(within(advanced()).getAllByRole('heading').length).toBeGreaterThan(1);
  });

  it('the interruption, in the mockup’s words', () => {
    opened('ecoute');
    for (const name of ['Doucement', 'Tout de suite'])
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
  });

  it('the agent, alone: rows and no card', () => {
    opened('agent');
    expect(within(advanced()).queryAllByRole('heading')).toEqual([]);
  });
});

describe('folded, never hiding what blocks', () => {
  it('the launch lacks a field: the block opens by itself, and says what', () => {
    opened('voix', { voice: { service: { launch: true, folder: '' } } });
    expect(advanced()).toHaveAttribute('open');
    expect(within(advanced()).getByText(/Il manque le dossier du service/)).toBeInTheDocument();
  });

  it('nothing lacks: it stays folded', () => {
    opened('voix', { voice: { service: { launch: true, folder: 'C:/voix', piper: 'voix.onnx' } } });
    expect(advanced()).not.toHaveAttribute('open');
  });
});

describe('the room', () => {
  it('a preset fills the end of the sentence and the silence threshold', async () => {
    const session = opened('ecoute');
    expect(screen.getByText(/^Normal :/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('radio', { name: 'Bruit autour' }));
    expect(session.settings.endOfSpeech).toMatchObject({
      silenceMs: 700,
      pauseMs: 220,
      minSpeechMs: 350,
      floorDb: -40,
    });
  });

  it('a value touched by hand shows « Personnalisé »; an ignored app added does not', async () => {
    const session = opened('ecoute');
    const apps = screen.getByRole('textbox', { name: 'Applis ignorées' });
    await fireEvent.change(apps, { target: { value: 'obs64.exe' } });
    expect(session.settings.busy.ignored).toEqual(['obs64.exe']);
    expect(screen.queryByText(/^Personnalisé/)).toBeNull();
    const silence = screen.getByRole('textbox', { name: 'Silence de fin de phrase' });
    await fireEvent.change(silence, { target: { value: '0,9' } });
    expect(screen.getByText(/^Personnalisé/)).toBeInTheDocument();
  });
});

describe('what reads', () => {
  it('seconds with a comma, not milliseconds', async () => {
    const session = opened('ecoute');
    const silence = screen.getByRole('textbox', { name: 'Silence de fin de phrase' });
    expect(silence).toHaveValue('0,5');
    await fireEvent.change(silence, { target: { value: '0,8' } });
    expect(session.settings.endOfSpeech.silenceMs).toBe(800);
    expect(screen.getByRole('textbox', { name: 'Courte pause' })).toHaveValue('0,16');
    expect(screen.getByText(/Conseillé : -50 dB/)).toBeInTheDocument();
  });

  it('every duration in seconds reads with a comma', () => {
    opened('ecoute', { window: { seconds: 2.5 }, busy: { returnSeconds: 1.5 } });
    expect(screen.getByRole('textbox', { name: 'Durée de l’écoute après sa phrase' })).toHaveValue('2,5');
    expect(screen.getByRole('textbox', { name: 'Délai de retour' })).toHaveValue('1,5');
  });

  it('the volume is a slider', () => {
    opened('voix');
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuenow', '100');
  });

  it('tone and context on eight lines; linked, greyed, saying the server decides', () => {
    opened('agent');
    expect(screen.getByRole('textbox', { name: 'Ton et contexte' })).toHaveAttribute('rows', '8');
    cleanup();
    opened('agent', { brain: 'linked' });
    expect(screen.getByRole('textbox', { name: 'Ton et contexte' })).toBeDisabled();
    expect(screen.getByText(/le serveur décide du ton/)).toBeInTheDocument();
  });

  it('no bench text: no terminal command, no « figé dans le code », no card named like its theme', () => {
    where.inWindow = false;
    for (const start of ['agent', 'ecoute', 'voix'] as const) {
      opened(start);
      expect(document.body.textContent).not.toMatch(/uv run|figé dans le code/);
      expect(screen.queryByRole('heading', { level: 3, name: 'L’agent' })).toBeNull();
      cleanup();
    }
  });
});

describe('neutral', () => {
  const GENDERED = [
    'ce qu’il sait de lui',
    'Qui il est',
    'Ce que la scène montre de lui',
    'quand il se tait',
    'il ne t’entend pas',
    'Ce qui le fait répondre',
  ];
  it('no settings page gives the agent a gender: « Identité », not « Lui »', () => {
    for (const brain of ['alone', 'linked'])
      for (const start of ['agent', 'corps', 'ecoute', 'voix', 'fenetre'] as const) {
        opened(start, { brain });
        const text = (document.body.textContent ?? '').replace(/'/g, '’');
        for (const words of GENDERED) expect(text).not.toContain(words);
        expect(screen.queryByText('Lui')).toBeNull();
        expect(screen.getAllByText('Identité')[0]).toBeInTheDocument();
        cleanup();
      }
  });
});
