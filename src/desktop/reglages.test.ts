import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// jsdom applies no stylesheet of a component: the rule is read in the source of the row's component, and must reach the element.
// From the repository's root: Vite rewrites `new URL('./…', import.meta.url)` to the page's address.
const wraps = (el: Element, component = 'src/desktop/DossierFenetre.svelte') => {
  const css = readFileSync(component, 'utf8')
    .match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1]
    // A comment before a rule would be read with its selector, which the DOM then refuses.
    ?.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...(css ?? '').matchAll(/([^{}]+)\{([^}]*)\}/g)].some(
    ([, selectors, body]) =>
      /overflow-wrap:\s*anywhere/.test(body ?? '') &&
      (selectors ?? '').split(',').some((sel) => {
        try {
          return el.matches(sel.trim());
        } catch {
          return false; // an at-rule or a selector the DOM does not read
        }
      }),
  );
};

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
    service({ piper: '' });
    render(Reglages, { session: new Session(), close: () => {}, start: 'voix' });
    expect(screen.getByRole('textbox', { name: 'Fichier de la voix' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'whisper-server' })).toBeInTheDocument();
    // Said by the button that waits, and in the folded block, by the fields.
    expect(screen.getAllByText(/Il manque le dossier du service/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Lancer ou vérifier' })).toBeDisabled();
  });

  it('a field counts as typed, without leaving it', async () => {
    service({});
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'voix' });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Fichier de la voix' }), {
      target: { value: 'D:\\v.onnx' },
    });
    expect(session.settings.voice.service.piper).toBe('D:\\v.onnx');
  });

  it('the folder is no field to type in: « Choisir… » only, the window keeps what is chosen', () => {
    service({});
    render(Reglages, { session: new Session(), close: () => {}, start: 'voix' });
    expect(screen.queryByRole('textbox', { name: 'Dossier du service' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choisir le dossier du service' })).toBeInTheDocument();
  });

  it('a program the service could not check is not shown as answering', () => {
    service({
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
  const READY = { launch: true, piper: 'D:/v.onnx' };
  // The window keeps the service's folder: the page only shows it.
  const kept = () => {
    const session = new Session();
    session.folders.voix = 'D:/voix';
    return session;
  };
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
    const session = kept();
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
    const session = kept();
    session.voiceStatus = 'up';
    session.voiceArgs = ['--stt', 'faster:small', '--tts', 'piper:D:/v.onnx'];
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.getByText(/tourne encore avec les réglages précédents/)).toBeInTheDocument();
    invoke.mockImplementation(async (cmd: string) => (cmd === 'voice_running' ? null : 'C:/logs/voix.log'));
    await fireEvent.click(screen.getByRole('button', { name: 'Relancer le service' }));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('voice_restart', {
        args: ['--stt', 'whisper-server:http://127.0.0.1:8080', '--tts', 'piper:D:/v.onnx'],
      }),
    );
  });

  it('started by hand with another transcription: says to restart it by hand, no restart button', () => {
    service({ stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' } });
    const session = kept();
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
    const session = kept();
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
    const session = kept();
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
    const session = kept();
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
    // The window runs the arguments it holds as confirmed: the page names none.
    expect(invoke).toHaveBeenCalledWith('program_start', {
      name: 'whisper-server',
      url: 'http://127.0.0.1:8080',
    });
    expect(screen.queryByRole('button', { name: 'Lancer RVC' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Oublier le programme de whisper-server' }));
    expect(invoke).toHaveBeenCalledWith('program_forget', { name: 'whisper-server' });
    await vi.waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Arguments de whisper-server' })).toBeNull(),
    );
  });

  it('refused while followed, then « Lancer » again: launched and followed anew, without reloading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      service({ stt: { kind: 'whisper-server', url: 'http://127.0.0.1:8080' } });
      const refusal = 'Adresse refusée : http://127.0.0.1:8080 (127.0.0.1, localhost ou [::1] seulement).';
      let probes = 0;
      invoke.mockImplementation(async (cmd: string) =>
        cmd === 'program_start'
          ? { outcome: 'started', log: 'C:/logs/whisper-server.log' }
          : cmd === 'program_state'
            ? probes++ === 0
              ? Promise.reject(refusal)
              : 'answering'
            : null,
      );
      const session = kept();
      session.programPaths = { 'whisper-server': 'D:/whisper/whisper-server.exe' };
      render(Reglages, { session, close: () => {}, start: 'voix' });
      const calls = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd).length;

      await fireEvent.click(screen.getByRole('button', { name: 'Lancer whisper-server' }));
      await vi.waitFor(() => expect(session.following).toBe(true));
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(screen.getByText(refusal)).toBeInTheDocument());
      expect(session.following).toBe(false);

      await fireEvent.click(screen.getByRole('button', { name: 'Lancer whisper-server' }));
      await vi.waitFor(() => expect(session.following).toBe(true));
      expect(calls('program_start')).toBe(2);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(screen.getByText('whisper-server répond.')).toBeInTheDocument());
      expect(calls('program_state')).toBe(2);
      expect(session.following).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the arguments of a program, confirmed in the window', () => {
  const EXE = 'D:/whisper/whisper-server.exe';
  const NAME = 'whisper-server';
  const SAVED = ['-m', 'models/small.bin'];
  /** What the window keeps as confirmed; `program_args` writes it, `program_arguments` reads it. */
  let confirmed: Record<string, string[]> = {};
  let args: (name: string, list: string[]) => unknown | Promise<unknown> = () => true;
  let pick: () => Promise<unknown> | unknown = () => EXE;
  let forget: () => Promise<unknown> | unknown = () => null;
  beforeEach(() => {
    confirmed = {};
    args = (name, list) => ((confirmed[name] = list), true);
    pick = () => EXE;
    forget = () => null;
    invoke.mockImplementation(async (cmd: string, a?: unknown) => {
      const { name, args: list } = (a ?? {}) as { name: string; args: string[] };
      if (cmd === 'program_arguments') return { ...confirmed };
      if (cmd === 'program_args') return args(name, list);
      if (cmd === 'program_pick') return pick();
      if (cmd === 'program_forget') return forget();
      return null;
    });
  });
  const asked = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd);
  const open = (
    over: { saved?: string[]; confirmed?: Record<string, string[]>; path?: boolean; launch?: boolean } = {},
  ) => {
    localStorage.setItem(
      'luxuria.settings',
      JSON.stringify({
        voice: {
          service: {
            launch: true,
            piper: 'D:/v.onnx',
            stt: {
              kind: NAME,
              url: 'http://127.0.0.1:8080',
              program: { args: over.saved ?? SAVED, launch: over.launch ?? false },
            },
          },
        },
      }),
    );
    confirmed = { ...over.confirmed };
    const session = new Session();
    session.folders.voix = 'D:/voix';
    if (over.path !== false) session.programPaths = { [NAME]: EXE };
    session.programArgs = { ...over.confirmed };
    render(Reglages, { session, close: () => {}, start: 'voix' });
    return session;
  };
  const confirm = () => screen.getByRole('button', { name: /^Confirmer/ });
  const draft = () => screen.getByRole('textbox', { name: `Arguments de ${NAME}` });
  const choose = () => screen.getByRole('button', { name: `Choisir le programme de ${NAME}` });
  const forgetButton = () => screen.getByRole('button', { name: `Oublier le programme de ${NAME}` });

  it('never confirmed: the arguments saved by an older page are the first draft, nothing is migrated', () => {
    const session = open();
    expect(draft()).toHaveValue('-m\nmodels/small.bin');
    expect(screen.getByText(/Pas encore confirmés/)).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
    expect(session.programArgs).toEqual({});
    expect(asked('program_args')).toHaveLength(0);
  });

  it('launched with the app, never confirmed: the folded block opens on them, said without an alert', async () => {
    open({ launch: true });
    await waitFor(() => expect(advanced()).toHaveAttribute('open'));
    const notice = within(advanced()).getByText(/Pas encore confirmés/);
    // A fixed text: an alert would be announced each time the screen opens.
    expect(notice.closest('[role="alert"]')).toBeNull();
  });

  it('never confirmed but not launched with the app: nothing blocks, the block stays folded', () => {
    open();
    expect(screen.getByText(/Pas encore confirmés/)).toBeInTheDocument();
    expect(advanced()).not.toHaveAttribute('open');
  });

  it('a confirmation the window no longer keeps, while the screen is open: the block opens then', async () => {
    const session = open({ launch: true, confirmed: { [NAME]: SAVED } });
    expect(advanced()).not.toHaveAttribute('open');
    session.programArgs = {};
    await waitFor(() => expect(advanced()).toHaveAttribute('open'));
  });

  it('confirmed: « Confirmés : … » says them, and a draft equal to them offers no « Confirmer… »', () => {
    open({ confirmed: { [NAME]: SAVED } });
    expect(screen.getByText(/Confirmés/)).toHaveTextContent(/-m.*models\/small\.bin/);
    expect(screen.queryByText(/Pas encore confirmés/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
  });

  it('the button follows the draft: typing another one offers it, typing back takes it away', async () => {
    open({ confirmed: { [NAME]: SAVED } });
    await fireEvent.input(draft(), { target: { value: '-m\nmodels/large.bin' } });
    expect(confirm()).toBeEnabled();
    expect(screen.getByText(/Confirmés/)).toHaveTextContent(/small\.bin/);
    await fireEvent.input(draft(), { target: { value: '-m\nmodels/small.bin\n' } });
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
  });

  it('never confirmed is not confirmed empty: an empty draft still offers « Confirmer… », not once confirmed empty', async () => {
    open({ saved: [] });
    expect(screen.getByText(/Pas encore confirmés/)).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
    cleanup();
    open({ saved: [], confirmed: { [NAME]: [] } });
    expect(screen.queryByText(/Pas encore confirmés/)).toBeNull();
    expect(screen.getByText(/Confirmés/)).toHaveTextContent(/^Confirmés : aucun argument$/);
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
  });

  it('« Confirmer… » sends the draft, one argument per line without the empty ones, and says it confirmed', async () => {
    const session = open();
    await fireEvent.input(draft(), {
      target: { value: '  -m \n\n models/my model.bin\r\n  \n--port 8081\n' },
    });
    await fireEvent.click(confirm());
    expect(invoke).toHaveBeenCalledWith('program_args', {
      name: NAME,
      args: ['-m', 'models/my model.bin', '--port 8081'],
    });
    await vi.waitFor(() => expect(screen.getByText(/Confirmés/)).toHaveTextContent(/my model\.bin/));
    expect(session.programArgs[NAME]).toEqual(['-m', 'models/my model.bin', '--port 8081']);
    expect(screen.queryByText(/Pas encore confirmés/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refused by the window: its words on the line, nothing confirmed, the button back', async () => {
    args = () => Promise.reject('Une boîte est déjà ouverte.');
    const session = open();
    await fireEvent.click(confirm());
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Une boîte est déjà ouverte.'),
    );
    expect(session.programArgs).toEqual({});
    expect(screen.getByText(/Pas encore confirmés/)).toBeInTheDocument();
    await vi.waitFor(() => expect(confirm()).toBeEnabled());
    expect(draft()).toHaveValue('-m\nmodels/small.bin');
  });

  it('refused in the dialog (false): said on the line in the neutral tone, the person’s own answer, nothing changes', async () => {
    args = () => false;
    const session = open({ confirmed: { [NAME]: ['-m', 'old.bin'] } });
    const row = within(screen.getByText('Confirmation').parentElement!);
    await fireEvent.click(confirm());
    await vi.waitFor(() => expect(row.getByRole('status')).toHaveTextContent(/^Arguments non confirmés\.$/));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(session.programArgs).toEqual({ [NAME]: ['-m', 'old.bin'] });
    expect(screen.getByText(/Confirmés/)).toHaveTextContent(/old\.bin/);
    expect(draft()).toHaveValue('-m\nmodels/small.bin');
    await vi.waitFor(() => expect(confirm()).toBeEnabled());
    // A new try clears it.
    args = (name, list) => ((confirmed[name] = list), true);
    await fireEvent.click(confirm());
    await vi.waitFor(() => expect(row.getByRole('status').textContent).toBe(''));
  });

  it('« Choisir… » or « Oublier » refused: said beside the exe, on its row, once, never as the program’s state', async () => {
    pick = () => Promise.reject('Une boîte est déjà ouverte.');
    forget = () => Promise.reject('Oubli refusé.');
    const session = open({ confirmed: { [NAME]: SAVED } });
    const row = within(screen.getByText('Son programme').parentElement!);
    await fireEvent.click(choose());
    await vi.waitFor(() => expect(row.getByRole('alert')).toHaveTextContent('Une boîte est déjà ouverte.'));
    expect(row.getByText(EXE)).toBeInTheDocument();
    expect(screen.getAllByText('Une boîte est déjà ouverte.')).toHaveLength(1);
    expect(session.programs[NAME]).toBeUndefined();
    await vi.waitFor(() => expect(forgetButton()).toBeEnabled());
    await fireEvent.click(forgetButton());
    await vi.waitFor(() => expect(row.getByRole('alert')).toHaveTextContent('Oubli refusé.'));
    expect(screen.queryByText('Une boîte est déjà ouverte.')).toBeNull();
    expect(session.programs[NAME]).toBeUndefined();
    // The next try clears it.
    pick = () => EXE;
    await vi.waitFor(() => expect(choose()).toBeEnabled());
    await fireEvent.click(choose());
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a long exe path breaks anywhere instead of passing under the buttons', () => {
    const LONG = `D:\\${'un-dossier-sans-espace\\'.repeat(12)}whisper-server.exe`;
    const session = open();
    session.programPaths = { [NAME]: LONG };
    flushSync();
    expect(wraps(screen.getByText(LONG), 'src/desktop/ServiceVoix.svelte')).toBe(true);
  });

  it('not answering, never confirmed: the state says to confirm its arguments first, not to launch it', async () => {
    const session = open();
    session.voiceStatus = 'up';
    session.bricks = { stt: { kind: 'whisper-server', up: false }, rvc: null };
    await vi.waitFor(() =>
      expect(
        screen.getByText(/whisper-server ne répond pas à http:\/\/127\.0\.0\.1:8080\./),
      ).toHaveTextContent(/Confirme d’abord ses arguments, plus bas\.$/),
    );
    expect(screen.queryByText(/Lance-le avec « Lancer whisper-server »/)).toBeNull();
    session.programArgs = { [NAME]: SAVED };
    await vi.waitFor(() =>
      expect(screen.getByText(/whisper-server ne répond pas à/)).toHaveTextContent(
        /Lance-le avec « Lancer whisper-server »\.$/,
      ),
    );
  });

  it('a new try clears the old refusal', async () => {
    args = () => Promise.reject('Une boîte est déjà ouverte.');
    open();
    await fireEvent.click(confirm());
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    args = (name, list) => ((confirmed[name] = list), true);
    await fireEvent.click(await screen.findByRole('button', { name: /^Confirmer/ }));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a new draft clears what « Confirmer… » said: no « non confirmés » under the arguments it shows as confirmed', async () => {
    args = () => false;
    open({ confirmed: { [NAME]: ['-m', 'old.bin'] } });
    await fireEvent.click(confirm());
    await vi.waitFor(() => expect(screen.getByText('Arguments non confirmés.')).toBeInTheDocument());
    // Typed back to what the window confirmed: « Confirmer… » goes, and so does the dialog's « no ».
    await fireEvent.input(draft(), { target: { value: '-m\nold.bin' } });
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
    expect(screen.getByText(/Confirmés/)).toHaveTextContent(/old\.bin/);
    expect(screen.queryByText('Arguments non confirmés.')).toBeNull();
  });

  it('a new draft clears the window’s refusal of « Confirmer… »', async () => {
    args = () => Promise.reject('Une boîte est déjà ouverte.');
    open();
    await fireEvent.click(confirm());
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Une boîte est déjà ouverte.'),
    );
    await fireEvent.input(draft(), { target: { value: '-m\nmodels/large.bin' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(confirm()).toBeEnabled();
  });

  it('« Oublier » reads the confirmed arguments again, after the window forgot', async () => {
    forget = () => ((confirmed = {}), null);
    const session = open({ confirmed: { [NAME]: SAVED } });
    await fireEvent.click(forgetButton());
    expect(invoke).toHaveBeenCalledWith('program_forget', { name: NAME });
    await vi.waitFor(() => expect(asked('program_arguments').length).toBeGreaterThan(0));
    const order = invoke.mock.calls.map(([c]) => c);
    expect(order.indexOf('program_arguments')).toBeGreaterThan(order.indexOf('program_forget'));
    await vi.waitFor(() => expect(session.programArgs).toEqual({}));
  });

  it('« Choisir… » reads them again: another exe, and the window dropped its confirmation', async () => {
    pick = () => ((confirmed = {}), 'D:/other/whisper-server.exe');
    const session = open({ confirmed: { [NAME]: SAVED } });
    await fireEvent.click(choose());
    expect(invoke).toHaveBeenCalledWith('program_pick', { name: NAME });
    await vi.waitFor(() => expect(screen.getByText('D:/other/whisper-server.exe')).toBeInTheDocument());
    await vi.waitFor(() => expect(screen.getByText(/Pas encore confirmés/)).toBeInTheDocument());
    expect(session.programArgs).toEqual({});
    expect(asked('program_arguments').length).toBeGreaterThan(0);
  });

  it('after « Oublier » worked, the focus goes to « Choisir… », whose neighbour just went', async () => {
    forget = () => ((confirmed = {}), null);
    open({ confirmed: { [NAME]: SAVED } });
    await fireEvent.click(forgetButton());
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Oublier le programme/ })).toBeNull(),
    );
    await vi.waitFor(() => expect(choose()).toHaveFocus());
  });

  it('after « Confirmer… » worked, it is gone and the focus goes to the draft, not to the page', async () => {
    open();
    confirm().focus();
    await fireEvent.click(confirm());
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull());
    await vi.waitFor(() => expect(document.body).not.toHaveFocus());
    expect(document.activeElement).not.toBeNull();
    await vi.waitFor(() => expect(draft()).toHaveFocus());
  });

  describe('one call at a time', () => {
    const later = () => {
      const at: { done: (v: unknown) => void } = { done: () => {} };
      const wait = () => new Promise((r) => (at.done = r));
      return { at, wait };
    };

    it('two clicks on « Choisir… » make one call, and « Oublier » and « Confirmer… » wait meanwhile', async () => {
      const { at, wait } = later();
      pick = wait;
      open({ confirmed: { [NAME]: SAVED }, saved: ['-x'] });
      await fireEvent.click(choose());
      await fireEvent.click(choose());
      expect(asked('program_pick')).toHaveLength(1);
      expect(forgetButton()).toBeDisabled();
      await fireEvent.click(forgetButton());
      expect(asked('program_forget')).toHaveLength(0);
      expect(confirm()).toBeDisabled();
      await fireEvent.click(confirm());
      expect(asked('program_args')).toHaveLength(0);
      at.done(null);
      await vi.waitFor(() => expect(forgetButton()).toBeEnabled());
      expect(confirm()).toBeEnabled();
    });

    it('two clicks on « Confirmer… » make one call, and the other two buttons wait meanwhile', async () => {
      const { at, wait } = later();
      args = wait;
      open();
      const button = confirm();
      await fireEvent.click(button);
      await fireEvent.click(button);
      expect(asked('program_args')).toHaveLength(1);
      expect(choose()).toBeDisabled();
      expect(forgetButton()).toBeDisabled();
      at.done(true);
      await vi.waitFor(() => expect(choose()).toBeEnabled());
      expect(asked('program_args')).toHaveLength(1);
    });

    it('two clicks on « Oublier » make one call, and the other two buttons wait meanwhile', async () => {
      const { at, wait } = later();
      forget = wait;
      open({ saved: ['-x'] });
      const button = forgetButton();
      await fireEvent.click(button);
      await fireEvent.click(button);
      expect(asked('program_forget')).toHaveLength(1);
      expect(choose()).toBeDisabled();
      expect(confirm()).toBeDisabled();
      at.done(null);
      await vi.waitFor(() => expect(asked('program_arguments').length).toBeGreaterThan(0));
      expect(asked('program_forget')).toHaveLength(1);
    });

    it('« Lancer » waits too, while « Choisir… », « Confirmer… » or « Oublier » is under way on the same program', async () => {
      const launch = () => screen.getByRole('button', { name: `Lancer ${NAME}` });
      for (const gesture of ['choose', 'confirm', 'forget'] as const) {
        const { at, wait } = later();
        if (gesture === 'choose') pick = wait;
        else if (gesture === 'confirm') args = wait;
        else forget = wait;
        open({ saved: ['-x'] });
        expect(launch()).toBeEnabled();
        await fireEvent.click({ choose, confirm, forget: forgetButton }[gesture]());
        expect(launch()).toBeDisabled();
        await fireEvent.click(launch());
        expect(asked('program_start')).toHaveLength(0);
        at.done(gesture === 'confirm' ? true : null);
        // Forgotten, the program has no « Lancer » any more.
        if (gesture !== 'forget') await vi.waitFor(() => expect(launch()).toBeEnabled());
        cleanup();
        pick = () => EXE;
        args = (name, list) => ((confirmed[name] = list), true);
        forget = () => null;
      }
    });

    it('a refusal gives every button back, or nothing could be tried again', async () => {
      args = () => Promise.reject('Une boîte est déjà ouverte.');
      forget = () => Promise.reject('Oubli refusé.');
      open();
      await fireEvent.click(confirm());
      await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      await vi.waitFor(() => expect(forgetButton()).toBeEnabled());
      await fireEvent.click(forgetButton());
      await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Oubli refusé.'));
      await vi.waitFor(() => expect(choose()).toBeEnabled());
      expect(confirm()).toBeEnabled();
    });
  });
});

describe('the body’s folder, chosen in the system’s dialog and kept by the window', () => {
  /** The window's answers by command name. */
  function window_(answers: Record<string, unknown> = {}) {
    invoke.mockImplementation(async (cmd: string) => {
      const answer = answers[cmd];
      if (answer instanceof Error) throw answer.message;
      return cmd === 'body_config' && answer === undefined ? '{"niveau":"souffle"}' : (answer ?? null);
    });
  }
  const open = (settings: object = {}) => {
    localStorage.setItem('luxuria.settings', JSON.stringify(settings));
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'corps' });
    return session;
  };
  const asked = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd);
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  // jsdom has no clipboard of its own: the one set here must not reach the tests after these.
  afterEach(() => void Reflect.deleteProperty(navigator, 'clipboard'));

  it('no folder kept: no field to type in, « Choisir… » and « Relire », nothing to forget', () => {
    window_();
    open();
    expect(screen.queryByRole('textbox', { name: 'Dossier du corps' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Choisir/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Relire' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Oublier/ })).toBeNull();
  });

  it('« Choisir… » asks the window for « corps », shows the path it keeps, and reads the body again', async () => {
    window_({ folder_pick: 'C:\\corps' });
    const session = open();
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    expect(invoke).toHaveBeenCalledWith('folder_pick', { name: 'corps' });
    await vi.waitFor(() => expect(screen.getByText('C:\\corps')).toBeInTheDocument());
    expect(session.folders.corps).toBe('C:\\corps');
    await vi.waitFor(() => expect(asked('body_config').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /^Oublier/ })).toBeInTheDocument();
  });

  it('cancelled: nothing changes and nothing is read', async () => {
    window_({ folder_pick: null });
    const session = open();
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    await vi.waitFor(() => expect(asked('folder_pick')).toHaveLength(1));
    expect(session.folders.corps).toBeUndefined();
    expect(asked('body_config')).toHaveLength(0);
  });

  it('refused by the window: its message is shown, no folder is kept', async () => {
    window_({ folder_pick: new Error('Ce dossier n’a pas de corps.json.') });
    const session = open();
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    await vi.waitFor(() =>
      expect(screen.getByText(/Ce dossier n’a pas de corps\.json\./)).toBeInTheDocument(),
    );
    expect(session.folders.corps).toBeUndefined();
  });

  it('refused: announced on the folder’s row, and the body’s state stays beside « Relire »', async () => {
    window_({ folder_pick: new Error('Une boîte est déjà ouverte.') });
    const session = open();
    session.bodySaid = 'Les images du dossier.';
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Une boîte est déjà ouverte.'),
    );
    expect(screen.getByText(/Choisis le dossier qui contient son corps\.json\./)).toBeInTheDocument();
    expect(screen.getByText('Les images du dossier.')).toBeInTheDocument();
    expect(session.bodySaid).toBe('Les images du dossier.');
  });

  it('refused while a folder is kept: announced beside its path, which stays with « Oublier »', async () => {
    window_({ folder_pick: new Error('Ce dossier n’a pas de corps.json.') });
    const session = open();
    session.folders.corps = 'C:\\corps';
    await fireEvent.click(await screen.findByRole('button', { name: /^Choisir/ }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ce dossier n’a pas de corps.json.'),
    );
    expect(screen.getByText('C:\\corps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Oublier/ })).toBeInTheDocument();
    expect(session.folders.corps).toBe('C:\\corps');
  });

  it('a new « Choisir… » lifts the refusal: none while the dialog is open, none after the choice', async () => {
    let answer: (path: string) => void = () => {};
    let tries = 0;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd !== 'folder_pick') return cmd === 'body_config' ? '{"niveau":"souffle"}' : null;
      if (++tries === 1) throw 'Ce dossier n’a pas de corps.json.';
      return new Promise((r) => (answer = r));
    });
    open();
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    expect(asked('folder_pick')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    answer('C:\\corps');
    await vi.waitFor(() => expect(screen.getByText('C:\\corps')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('one call at a time: a second click sends nothing, and « Oublier » waits for « Choisir… »', async () => {
    let answer: (path: string | null) => void = () => {};
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'folder_pick' ? new Promise((r) => (answer = r)) : null,
    );
    const session = open();
    session.folders.corps = 'C:\\corps';
    const choose = await screen.findByRole('button', { name: /^Choisir/ });
    await fireEvent.click(choose);
    await fireEvent.click(choose);
    expect(asked('folder_pick')).toHaveLength(1);
    const forget = screen.getByRole('button', { name: /^Oublier/ });
    expect(forget).toBeDisabled();
    await fireEvent.click(forget);
    expect(asked('folder_forget')).toHaveLength(0);
    answer(null);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Oublier/ })).toBeEnabled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('« Oublier » refused: announced, the folder stays kept and shown, and nothing is read', async () => {
    window_({ folder_forget: new Error('Oubli refusé.') });
    const session = open();
    session.folders.corps = 'C:\\corps';
    await fireEvent.click(await screen.findByRole('button', { name: /^Oublier/ }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Oubli refusé.'));
    expect(session.folders.corps).toBe('C:\\corps');
    expect(screen.getByText('C:\\corps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Oublier/ })).toBeInTheDocument();
    expect(asked('body_config')).toHaveLength(0);
    // The guard of « Oublier » gives both buttons back, or no folder could be chosen again.
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Choisir/ })).toBeEnabled());
  });

  it('« Oublier » asks the window to forget « corps », the path goes, the body is read again', async () => {
    window_({ folder_paths: { corps: 'C:\\corps' } });
    const session = open();
    session.folders.corps = 'C:\\corps';
    await fireEvent.click(await screen.findByRole('button', { name: /^Oublier/ }));
    expect(invoke).toHaveBeenCalledWith('folder_forget', { name: 'corps' });
    await vi.waitFor(() => expect(screen.queryByText('C:\\corps')).toBeNull());
    expect(session.folders.corps).toBeUndefined();
    await vi.waitFor(() => expect(asked('body_config').length).toBeGreaterThan(0));
  });

  it('after « Oublier » worked, the focus goes to « Choisir… », whose neighbour just went', async () => {
    window_({ folder_paths: {} });
    const session = open();
    session.folders.corps = 'C:\\corps';
    await fireEvent.click(await screen.findByRole('button', { name: /^Oublier/ }));
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /^Oublier/ })).toBeNull());
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /^Choisir/ })).toHaveFocus());
  });

  it('no command of the window is ever called with a folder', async () => {
    window_({ folder_pick: 'C:\\corps' });
    open({ body: { folder: 'C:\\ancien' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Relire' }));
    await vi.waitFor(() => expect(asked('body_config').length).toBeGreaterThan(1));
    for (const [, args] of invoke.mock.calls) {
      expect(Object.keys((args as object | undefined) ?? {})).not.toContain('folder');
      expect(JSON.stringify(args ?? {})).not.toContain('ancien');
    }
  });

  describe('the folder an older page saved', () => {
    const former = { body: { folder: 'C:\\corps' } };

    it('while the window keeps none: the notice, the path as selectable text, and « Copier »', async () => {
      window_();
      open(former);
      expect(
        screen.getByText(/Le dossier se choisit maintenant dans la boîte de dialogue du système\./),
      ).toBeInTheDocument();
      expect(screen.getByText(/Choisis de nouveau celui-ci/)).toBeInTheDocument();
      expect(screen.getByText('C:\\corps')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: /^Copier/ }));
      expect(writeText).toHaveBeenCalledExactlyOnceWith('C:\\corps');
    });

    it('the clipboard refuses: a toast in the danger tone, and the path stays on the screen', async () => {
      window_();
      open(former);
      writeText.mockRejectedValueOnce(new Error('refusé'));
      await fireEvent.click(screen.getByRole('button', { name: /^Copier/ }));
      await vi.waitFor(() =>
        expect(toasts()).toContainEqual(
          expect.objectContaining({ message: 'Copie impossible : sélectionne le chemin.', tone: 'danger' }),
        ),
      );
      expect(screen.getByText('C:\\corps')).toBeInTheDocument();
    });

    it('is never sent to the window, whatever is clicked', async () => {
      window_();
      open(former);
      await fireEvent.click(screen.getByRole('button', { name: /^Copier/ }));
      await fireEvent.click(screen.getByRole('button', { name: 'Relire' }));
      await vi.waitFor(() => expect(asked('body_config').length).toBeGreaterThan(0));
      expect(JSON.stringify(invoke.mock.calls)).not.toContain('corps');
    });

    it('the first folder chosen empties it, on the screen and in what is saved', async () => {
      window_({ folder_pick: 'C:\\autre' });
      const session = open(former);
      await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
      await vi.waitFor(() => expect(screen.queryByText(/Le dossier se choisit maintenant/)).toBeNull());
      expect(session.settings.body.formerFolder).toBe('');
      const saved = JSON.parse(localStorage.getItem('luxuria.settings') ?? '{}');
      expect(saved.body).not.toHaveProperty('folder');
      expect(saved.body.formerFolder).toBe('');
    });

    it('a cancelled choice keeps it', async () => {
      window_({ folder_pick: null });
      const session = open(former);
      await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
      await vi.waitFor(() => expect(asked('folder_pick')).toHaveLength(1));
      expect(session.settings.body.formerFolder).toBe('C:\\corps');
      expect(screen.getByText(/Le dossier se choisit maintenant/)).toBeInTheDocument();
    });

    it('a refused choice: announced beside the notice, the old path and « Copier » stay', async () => {
      window_({ folder_pick: new Error('Ce dossier n’a pas de corps.json.') });
      const session = open(former);
      await fireEvent.click(screen.getByRole('button', { name: /^Choisir/ }));
      await vi.waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Ce dossier n’a pas de corps.json.'),
      );
      expect(
        screen.getByText(/Le dossier se choisit maintenant dans la boîte de dialogue du système\./),
      ).toBeInTheDocument();
      expect(screen.getByText('C:\\corps')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Copier/ })).toBeInTheDocument();
      expect(session.settings.body.formerFolder).toBe('C:\\corps');
    });

    it('no notice once the window keeps a folder', async () => {
      window_({ folder_paths: { corps: 'C:\\autre' } });
      const session = open(former);
      session.folders.corps = 'C:\\autre';
      await vi.waitFor(() => expect(screen.getByText('C:\\autre')).toBeInTheDocument());
      expect(screen.queryByText(/Le dossier se choisit maintenant/)).toBeNull();
    });
  });
});

describe('the service’s folder, chosen in the system’s dialog and kept by the window', () => {
  const LONG = `D:\\${'un-dossier-sans-espace\\'.repeat(12)}voix`;
  /** The window's answers by command name. */
  function window_(answers: Record<string, unknown> = {}) {
    invoke.mockImplementation(async (cmd: string) => {
      const answer = answers[cmd];
      if (answer instanceof Error) throw answer.message;
      return answer ?? null;
    });
  }
  const open = (service: object = {}, kept?: string) => {
    localStorage.setItem(
      'luxuria.settings',
      JSON.stringify({ voice: { service: { launch: true, piper: 'D:/v.onnx', ...service } } }),
    );
    const session = new Session();
    if (kept) session.folders.voix = kept;
    render(Reglages, { session, close: () => {}, start: 'voix' });
    return session;
  };
  const asked = (cmd: string) => invoke.mock.calls.filter(([c]) => c === cmd);
  const choose = () => screen.getByRole('button', { name: 'Choisir le dossier du service' });
  const forget = () => screen.getByRole('button', { name: 'Oublier le dossier du service' });
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => void Reflect.deleteProperty(navigator, 'clipboard'));

  it('no folder kept: « Choisir… » only, nothing to forget, no field', () => {
    window_();
    open();
    expect(screen.queryByRole('textbox', { name: 'Dossier du service' })).toBeNull();
    expect(choose()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Oublier le dossier du service/ })).toBeNull();
  });

  it('« Choisir… » asks the window for « voix » and shows the path it keeps', async () => {
    window_({ folder_pick: 'D:\\voix' });
    const session = open();
    await fireEvent.click(choose());
    expect(invoke).toHaveBeenCalledWith('folder_pick', { name: 'voix' });
    await vi.waitFor(() => expect(screen.getByText('D:\\voix')).toBeInTheDocument());
    expect(session.folders.voix).toBe('D:\\voix');
    expect(forget()).toBeInTheDocument();
  });

  it('« Oublier » asks the window to forget « voix », and the path goes', async () => {
    window_();
    const session = open({}, 'D:\\voix');
    await fireEvent.click(forget());
    expect(invoke).toHaveBeenCalledWith('folder_forget', { name: 'voix' });
    await vi.waitFor(() => expect(screen.queryByText('D:\\voix')).toBeNull());
    expect(session.folders.voix).toBeUndefined();
  });

  it('after « Oublier » worked, the focus goes to « Choisir… »', async () => {
    window_();
    open({}, 'D:\\voix');
    await fireEvent.click(forget());
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /^Oublier le dossier/ })).toBeNull());
    await vi.waitFor(() => expect(choose()).toHaveFocus());
  });

  it('refused beside the path, which stays with « Oublier » and its name', async () => {
    window_({ folder_pick: new Error('Ce dossier n’a pas de service.py.') });
    const session = open({}, 'D:\\voix');
    await fireEvent.click(choose());
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Ce dossier n’a pas de service.py.'),
    );
    expect(screen.getByText('D:\\voix')).toBeInTheDocument();
    expect(forget()).toBeInTheDocument();
    expect(session.folders.voix).toBe('D:\\voix');
  });

  it('refused with no folder kept: beside what tells to choose, not in its place', async () => {
    window_({ folder_pick: new Error('Une boîte est déjà ouverte.') });
    open();
    // The rows that wait for the folder say it too, as alerts of their own: the folder's row is read alone.
    const row = within(screen.getByText('Dossier du service').parentElement!);
    await fireEvent.click(choose());
    await vi.waitFor(() => expect(row.getByRole('alert')).toHaveTextContent('Une boîte est déjà ouverte.'));
    expect(row.getByText(/service\.py/)).toBeInTheDocument();
  });

  it('« Oublier » refused: announced, the path stays, and both buttons come back', async () => {
    window_({ folder_forget: new Error('Oubli refusé.') });
    const session = open({}, 'D:\\voix');
    await fireEvent.click(forget());
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Oubli refusé.'));
    expect(screen.getByText('D:\\voix')).toBeInTheDocument();
    expect(session.folders.voix).toBe('D:\\voix');
    await vi.waitFor(() => expect(choose()).toBeEnabled());
    expect(forget()).toBeEnabled();
  });

  it('one call at a time: two clicks make one call, and « Oublier » waits meanwhile', async () => {
    let answer: (path: string | null) => void = () => {};
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'folder_pick' ? new Promise((r) => (answer = r)) : null,
    );
    open({}, 'D:\\voix');
    await fireEvent.click(choose());
    await fireEvent.click(choose());
    expect(asked('folder_pick')).toHaveLength(1);
    expect(forget()).toBeDisabled();
    await fireEvent.click(forget());
    expect(asked('folder_forget')).toHaveLength(0);
    answer(null);
    await vi.waitFor(() => expect(forget()).toBeEnabled());
  });

  it('two « Oublier » make one call, and « Choisir… » waits meanwhile', async () => {
    let done: () => void = () => {};
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'folder_forget' ? new Promise<null>((r) => (done = () => r(null))) : null,
    );
    open({}, 'D:\\voix');
    const button = forget();
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(asked('folder_forget')).toHaveLength(1);
    expect(choose()).toBeDisabled();
    done();
    await vi.waitFor(() => expect(asked('folder_forget')).toHaveLength(1));
  });

  it('a long path, and a long refusal, break anywhere instead of passing under the buttons', async () => {
    window_({ folder_pick: new Error(LONG) });
    open({}, LONG);
    expect(wraps(screen.getByText(LONG))).toBe(true);
    await fireEvent.click(choose());
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(wraps(screen.getByRole('alert'))).toBe(true);
  });

  it('a long old path breaks anywhere too', () => {
    window_();
    open({ folder: LONG });
    expect(wraps(screen.getByText(LONG))).toBe(true);
  });

  it('no command of the window is ever called with a folder', async () => {
    window_({ folder_pick: 'D:\\voix' });
    open({ folder: 'D:\\ancien' });
    await fireEvent.click(choose());
    await vi.waitFor(() => expect(screen.getByText('D:\\voix')).toBeInTheDocument());
    await fireEvent.click(forget());
    await vi.waitFor(() => expect(asked('folder_forget')).toHaveLength(1));
    for (const [, args] of invoke.mock.calls) {
      expect(Object.keys((args as object | undefined) ?? {})).not.toContain('folder');
      expect(JSON.stringify(args ?? {})).not.toContain('ancien');
    }
  });

  describe('the folder an older page saved', () => {
    const former = { folder: 'D:\\ancien\\voix' };

    it('while the window keeps none: the notice, the path as selectable text, and « Copier »', async () => {
      window_();
      open(former);
      expect(screen.getByText(/Choisis de nouveau celui-ci/)).toBeInTheDocument();
      expect(screen.getByText('D:\\ancien\\voix')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: /^Copier/ }));
      expect(writeText).toHaveBeenCalledExactlyOnceWith('D:\\ancien\\voix');
    });

    it('the clipboard refuses: a toast in the danger tone, and the path stays', async () => {
      window_();
      open(former);
      writeText.mockRejectedValueOnce(new Error('refusé'));
      await fireEvent.click(screen.getByRole('button', { name: /^Copier/ }));
      await vi.waitFor(() =>
        expect(toasts()).toContainEqual(
          expect.objectContaining({ message: 'Copie impossible : sélectionne le chemin.', tone: 'danger' }),
        ),
      );
      expect(screen.getByText('D:\\ancien\\voix')).toBeInTheDocument();
    });

    it('the first folder chosen empties it, on the screen and in what is saved', async () => {
      window_({ folder_pick: 'D:\\voix' });
      const session = open(former);
      await fireEvent.click(choose());
      await vi.waitFor(() => expect(screen.queryByText('D:\\ancien\\voix')).toBeNull());
      expect(session.settings.voice.service.formerFolder).toBe('');
      const saved = JSON.parse(localStorage.getItem('luxuria.settings') ?? '{}');
      expect(saved.voice.service).not.toHaveProperty('folder');
      expect(saved.voice.service.formerFolder).toBe('');
    });

    it('a cancelled or refused choice keeps it', async () => {
      window_({ folder_pick: null });
      const session = open(former);
      await fireEvent.click(choose());
      await vi.waitFor(() => expect(asked('folder_pick')).toHaveLength(1));
      expect(session.settings.voice.service.formerFolder).toBe('D:\\ancien\\voix');
      expect(screen.getByRole('button', { name: /^Copier/ })).toBeInTheDocument();
    });

    it('no notice once the window keeps a folder', () => {
      window_();
      open(former, 'D:\\voix');
      expect(screen.queryByText(/Choisis de nouveau celui-ci/)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Copier/ })).toBeNull();
    });
  });
});

type Theme = 'agent' | 'corps' | 'ecoute' | 'voix' | 'fenetre';
/** The settings opened on a theme, with these settings saved. */
function opened(start: Theme, settings: object = {}, folders: Record<string, string> = {}) {
  localStorage.setItem('luxuria.settings', JSON.stringify(settings));
  const session = new Session();
  Object.assign(session.folders, folders);
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

  it('in a browser tab, the trace of the turns leaves as a file, one line per event, after its format', async () => {
    where.inWindow = false;
    const files: Blob[] = [];
    const names: string[] = [];
    URL.createObjectURL = (file: Blob) => (files.push(file), 'blob:deroule');
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const session = opened('ecoute');
    session.turns.add('voix', { phrase: session.turns.phrase() }, { son: 12 });
    await fireEvent.click(within(advanced()).getByRole('button', { name: 'Télécharger' }));
    click.mockRestore();
    expect(names[0]).toMatch(/^deroule-.*\.jsonl$/);
    const lines = (await files[0]!.text()).trimEnd().split('\n');
    expect(lines.map((l) => JSON.parse(l) as object)).toEqual([
      { format: 2 },
      expect.objectContaining({ name: 'voix', phrase: 1, son: 12 }),
    ]);
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
    for (const label of [
      'Choisir le dossier du service',
      'Adresse de whisper-server',
      'Adresse de RVC',
      'Gain de RVC',
    ])
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
    opened('voix', { voice: { service: { launch: true } } });
    expect(advanced()).toHaveAttribute('open');
    expect(within(advanced()).getByText(/Il manque le dossier du service/)).toBeInTheDocument();
  });

  it('nothing lacks: it stays folded', () => {
    opened('voix', { voice: { service: { launch: true, piper: 'voix.onnx' } } }, { voix: 'C:/voix' });
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
    expect(silence).toHaveValue('0,7');
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

describe('an address off this computer, confirmed in the settings', () => {
  const SERVER = 'https://serveur.exemple:8443';
  const MODEL = 'https://modele.exemple/v1';
  const NOTICE = /Cette adresse est hors de ce poste : la fenêtre ne la joint qu.une fois confirmée\./;
  const CONFIRMED = 'Confirmée pour la fenêtre.';
  const confirmButton = () => screen.queryByRole('button', { name: /^Confirmer/ });
  /** « Oublier » says what it forgets. */
  const forget = (origin: string) => ({ name: `Oublier l’adresse confirmée ${origin}` });

  /** Rust's side: the confirmed origins, what « Confirmer… » answers, and what « Oublier » forgets. */
  function rust(confirmed: string[], answer: boolean | Error = true) {
    const list = [...confirmed];
    invoke.mockImplementation(async (cmd, args) => {
      const a = (args ?? {}) as { url?: string; origin?: string };
      if (cmd === 'net_hosts') return [...list];
      if (cmd === 'net_host_confirm') {
        // Tauri rejects with Rust's message, a string.
        if (answer instanceof Error) throw answer.message;
        if (answer) list.push(new URL(a.url!).origin);
        return answer;
      }
      if (cmd === 'net_host_forget') {
        list.splice(list.indexOf(a.origin!), 1);
        return null;
      }
      return null;
    });
  }
  /** Rust's net_hosts, held until the test answers: the window has not said yet what it keeps. */
  function heldHosts() {
    let answer!: (hosts: string[]) => void;
    const held = new Promise<string[]>((resolve) => (answer = resolve));
    invoke.mockImplementation(async (cmd) => (cmd === 'net_hosts' ? held : null));
    return answer;
  }
  const asked = () =>
    waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === 'net_hosts')).toBe(true));
  /** A turn for the folded block to watch what it holds. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const CHECKING = 'Vérification…';
  const confirmCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === 'net_host_confirm');
  const linked = (server = SERVER) => opened('agent', { brain: 'linked', server });
  const alone = (url = MODEL) =>
    opened('agent', { brain: 'alone', model: { url, name: 'un-modele', key: '' } });

  it('the server: warns it is off this computer, and « Confirmer… » asks Rust with the field’s address', async () => {
    rust([]);
    linked();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Confirmer/ }));
    expect(invoke).toHaveBeenCalledWith('net_host_confirm', { url: SERVER });
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(confirmButton()).toBeNull();
    expect(screen.getByRole('button', forget(SERVER))).toBeInTheDocument();
  });

  it('the model: the same, with the model’s address as typed', async () => {
    rust([]);
    alone();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Confirmer/ }));
    expect(invoke).toHaveBeenCalledWith('net_host_confirm', { url: MODEL });
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
  });

  it('the person says no in the system’s box: nothing is confirmed', async () => {
    rust([], false);
    linked();
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmer/ }));
    await waitFor(() => expect(confirmCalls()).toHaveLength(1));
    expect(screen.queryByText(CONFIRMED)).toBeNull();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(confirmButton()).not.toBeNull();
  });

  it('Rust refuses: its message is on the screen, and nothing is confirmed', async () => {
    rust([], new Error('Adresse illisible.'));
    linked();
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmer/ }));
    expect(await screen.findByText(/Adresse illisible\./)).toBeInTheDocument();
    expect(screen.queryByText(CONFIRMED)).toBeNull();
  });

  it('already confirmed, by its origin: says so, offers « Oublier » and no « Confirmer… »', async () => {
    rust(['https://modele.exemple']);
    alone();
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(confirmButton()).toBeNull();
  });

  it('« Oublier » forgets the origin, and the notice is back', async () => {
    rust([SERVER]);
    linked();
    await userEvent.click(await screen.findByRole('button', forget(SERVER)));
    expect(invoke).toHaveBeenCalledWith('net_host_forget', { origin: SERVER });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(CONFIRMED)).toBeNull();
  });

  it('the confirmed origins Rust holds are read from Rust, into the session', async () => {
    rust([SERVER]);
    const session = linked();
    // Not known until Rust answers: neither confirmed nor refused.
    expect(session.hosts).toBeNull();
    await asked();
    await waitFor(() => expect(session.hosts).toEqual([SERVER]));
  });

  it.each(['http://127.0.0.1:8788', 'http://localhost:8788', 'http://[::1]:8788'])(
    'this computer, %s: nothing to confirm, nothing asked',
    async (address) => {
      rust([]);
      // Once Rust has answered, when an address off this computer would show its notice.
      const server = linked(address);
      await waitFor(() => expect(server.hosts).toEqual([]));
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(screen.queryByText(CONFIRMED)).toBeNull();
      expect(screen.queryByText(CHECKING)).toBeNull();
      expect(confirmButton()).toBeNull();
      cleanup();
      const model = alone(address + '/v1');
      await waitFor(() => expect(model.hosts).toEqual([]));
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(confirmButton()).toBeNull();
      expect(confirmCalls()).toEqual([]);
    },
  );

  it.each([
    ['http://127.0.0.1@example.com:8788', 'http://example.com:8788'],
    ['http://127.0.0.1.example:8788', 'http://127.0.0.1.example:8788'],
    ['http://localhost.example:8788', 'http://localhost.example:8788'],
  ])(
    '%s only looks local: its host is read by the URL parser, and it is off this computer',
    async (address, origin) => {
      // The model, in http without a key: the page lets it go, so the window asks.
      rust([]);
      alone(address + '/v1');
      expect(await screen.findByText(NOTICE)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /^Confirmer/ }));
      expect(invoke).toHaveBeenCalledWith('net_host_confirm', { url: address + '/v1' });
      // Confirmed by the origin Rust keeps, the parser's: never by the text that looked local.
      expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
      cleanup();
      // The server, in https: the same reading.
      const secure = address.replace('http:', 'https:');
      rust([origin.replace('http:', 'https:')]);
      linked(secure);
      expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
      cleanup();
      rust([]);
      linked(secure);
      expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    },
  );

  it.each([
    ['the server in http, off this computer', 'http://serveur.exemple:8788', '', /partirait en clair/],
    ['the model in http, with a key', 'http://modele.exemple/v1', 'une-cle', /La clé ne part pas en clair/],
  ])(
    '%s: the page refuses it already, so no « Confirmer… », its own warning only',
    async (_, url, key, warning) => {
      rust([]);
      const session = url.includes('serveur')
        ? linked(url)
        : opened('agent', { brain: 'alone', model: { url, name: 'un-modele', key } });
      await waitFor(() => expect(session.hosts).toEqual([]));
      expect(screen.getByText(warning)).toBeInTheDocument();
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(confirmButton()).toBeNull();
      expect(confirmCalls()).toEqual([]);
    },
  );

  it.each([true, false])(
    'the model in http with a key, in the window: %s: the page refuses it, the block opens on the alert',
    async (window) => {
      where.inWindow = window;
      rust([]);
      opened('agent', {
        brain: 'alone',
        model: { url: 'http://modele.exemple/v1', name: 'un-modele', key: 'k' },
      });
      await waitFor(() => expect(advanced()).toHaveAttribute('open'));
      expect(within(advanced()).getByRole('alert')).toHaveTextContent(/La clé ne part pas en clair/);
    },
  );

  it('the server in http off this computer: the page’s refusal is the row’s error, as on the arrival', () => {
    rust([]);
    linked('http://serveur.exemple:8788');
    expect(screen.getByText(/partirait en clair/).closest('[role="alert"]')).not.toBeNull();
  });

  it('the list cannot be read: « Confirmer… » is still offered, the closed side, and it says why, in grey', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'net_hosts') throw 'hotes.json illisible';
      return null;
    });
    linked();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(confirmButton()).not.toBeNull();
    const said = screen.getByText('Liste illisible');
    expect(said.closest('[role="alert"]')).toBeNull();
    expect(screen.getByText('hotes.json illisible').closest('[role="alert"]')).toBeNull();
  });

  it('a list read fine says nothing of it', async () => {
    rust([]);
    linked();
    await screen.findByText(NOTICE);
    expect(screen.queryByText(/Liste illisible/)).toBeNull();
  });

  it('« Confirmer… » names the address it confirms', async () => {
    rust([]);
    linked();
    expect(await screen.findByRole('button', { name: `Confirmer l’adresse ${SERVER}` })).toBeInTheDocument();
  });

  it('two clicks on « Confirmer… », one call: the button waits for the box', async () => {
    let answer!: (ok: boolean) => void;
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'net_hosts') return [];
      if (cmd === 'net_host_confirm') return new Promise<boolean>((resolve) => (answer = resolve));
      return null;
    });
    linked();
    const button = await screen.findByRole('button', { name: /^Confirmer/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(confirmCalls()).toHaveLength(1);
    answer(false);
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('two clicks on « Oublier », one call', async () => {
    let done!: () => void;
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'net_hosts') return [SERVER];
      if (cmd === 'net_host_forget') return new Promise<null>((resolve) => (done = () => resolve(null)));
      return null;
    });
    linked();
    const button = await screen.findByRole('button', forget(SERVER));
    await userEvent.click(button);
    await userEvent.click(button);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'net_host_forget')).toHaveLength(1);
    done();
  });

  it('Rust refuses to forget: its message is on the line, and the origin stays', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'net_hosts') return [SERVER];
      if (cmd === 'net_host_forget') throw 'Une boîte est déjà ouverte.';
      return null;
    });
    linked();
    await userEvent.click(await screen.findByRole('button', forget(SERVER)));
    expect(await screen.findByText('Une boîte est déjà ouverte.')).toBeInTheDocument();
    expect(screen.getByRole('button', forget(SERVER))).toBeInTheDocument();
    cleanup();
    opened('fenetre');
    await userEvent.click(await screen.findByRole('button', forget(SERVER)));
    expect(await screen.findByText('Une boîte est déjà ouverte.')).toBeInTheDocument();
    expect(screen.getByText(SERVER)).toBeInTheDocument();
  });

  it('the keyboard: after « Confirmer… » the focus is on the « Oublier » that replaces it, and back', async () => {
    rust([]);
    linked();
    (await screen.findByRole('button', { name: /^Confirmer/ })).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByText(CONFIRMED);
    await waitFor(() => expect(screen.getByRole('button', forget(SERVER))).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Confirmer/ })).toHaveFocus());
  });

  it('the model’s address unconfirmed opens the folded block: it never hides what blocks', async () => {
    rust([]);
    alone();
    await waitFor(() => expect(advanced()).toHaveAttribute('open'));
    expect(within(advanced()).getByText(NOTICE)).toBeInTheDocument();
  });

  it('the notice is what blocks: it is said as an error, as Rust’s refusal is', async () => {
    rust([]);
    linked();
    expect((await screen.findByText(NOTICE)).closest('[role="alert"]')).not.toBeNull();
  });

  it('net_hosts not answered yet, the address already confirmed: no alert, the block stays folded', async () => {
    heldHosts();
    alone();
    await asked();
    await settle();
    expect(within(advanced()).getByText(CHECKING)).toBeInTheDocument();
    expect(within(advanced()).queryByRole('alert')).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(confirmButton()).toBeNull();
    expect(advanced()).not.toHaveAttribute('open');
  });

  it('net_hosts answers with its origin: « Confirmée pour la fenêtre. », and never an alert', async () => {
    const answer = heldHosts();
    alone();
    await asked();
    await settle();
    answer(['https://modele.exemple']);
    expect(await within(advanced()).findByText(CONFIRMED)).toBeInTheDocument();
    await settle();
    expect(within(advanced()).queryByRole('alert')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    // The folded block never closes by itself: still folded, nothing blocked on the way.
    expect(advanced()).not.toHaveAttribute('open');
  });

  it('net_hosts fails: none confirmed, the closed side', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'net_hosts') throw 'hotes.json illisible';
      return null;
    });
    const session = linked();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(session.hosts).toEqual([]);
  });

  describe('the window’s theme lists the confirmed origins', () => {
    const card = () => screen.getByRole('heading', { name: 'Adresses hors de ce poste' }).closest('section')!;

    it('net_hosts fails: « Liste illisible », with the refusal, in grey, never « Aucune »', async () => {
      invoke.mockImplementation(async (cmd) => {
        if (cmd === 'net_hosts') throw 'hotes.json illisible';
        return null;
      });
      const session = opened('fenetre');
      expect(await within(card()).findByText('Liste illisible')).toBeInTheDocument();
      expect(within(card()).getByText('hotes.json illisible')).toBeInTheDocument();
      expect(within(card()).queryByText(/Aucune/)).toBeNull();
      expect(within(card()).queryByRole('alert')).toBeNull();
      // To decide what blocks, none: the closed side.
      expect(session.hosts).toEqual([]);
    });

    it('one call for the whole screen: two different « Oublier » while one waits, one call', async () => {
      let done!: () => void;
      invoke.mockImplementation(async (cmd) => {
        if (cmd === 'net_hosts') return [SERVER, 'https://modele.exemple'];
        if (cmd === 'net_host_forget') return new Promise<null>((resolve) => (done = () => resolve(null)));
        return null;
      });
      opened('fenetre');
      await userEvent.click(await screen.findByRole('button', forget(SERVER)));
      await userEvent.click(screen.getByRole('button', forget('https://modele.exemple')));
      expect(invoke.mock.calls.filter(([cmd]) => cmd === 'net_host_forget')).toEqual([
        ['net_host_forget', { origin: SERVER }],
      ]);
      done();
    });

    it('an origin Rust repeats, or what is not one, is listed once, or not at all', async () => {
      invoke.mockImplementation(async (cmd) =>
        cmd === 'net_hosts' ? [SERVER, SERVER, 7, null, 'https://modele.exemple'] : null,
      );
      const session = opened('fenetre');
      await waitFor(() => expect(session.hosts).toEqual([SERVER, 'https://modele.exemple']));
      expect(within(card()).getAllByRole('button', { name: /^Oublier/ })).toHaveLength(2);
    });

    it('the keyboard: forgetting a line moves the focus to the next « Oublier », then to the card’s title', async () => {
      rust([SERVER, 'https://modele.exemple']);
      opened('fenetre');
      (await screen.findByRole('button', forget(SERVER))).focus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByRole('button', forget('https://modele.exemple'))).toHaveFocus());
      await userEvent.keyboard('{Enter}');
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Adresses hors de ce poste' })).toHaveFocus(),
      );
      expect(within(card()).getByText(/Aucune/)).toBeInTheDocument();
    });

    it('one confirmed, then replaced in the field: still listed, and « Oublier » there forgets it', async () => {
      rust([]);
      const session = linked();
      await userEvent.click(await screen.findByRole('button', { name: /^Confirmer/ }));
      await screen.findByText(CONFIRMED);
      session.setServer('https://autre.exemple');
      cleanup();
      render(Reglages, { session, close: () => {}, start: 'fenetre' });
      const card = screen.getByRole('heading', { name: 'Adresses hors de ce poste' }).closest('section')!;
      expect(await within(card).findByText(SERVER)).toBeInTheDocument();
      await userEvent.click(within(card).getByRole('button', forget(SERVER)));
      expect(invoke).toHaveBeenCalledWith('net_host_forget', { origin: SERVER });
      expect(await within(card).findByText(/Aucune/)).toBeInTheDocument();
      expect(within(card).queryByText(SERVER)).toBeNull();
    });

    it('each origin has its own « Oublier »', async () => {
      rust([SERVER, 'https://modele.exemple']);
      opened('fenetre', { brain: 'linked', server: 'http://127.0.0.1:8788' });
      expect(await screen.findByRole('button', forget(SERVER))).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', forget('https://modele.exemple')));
      expect(invoke).toHaveBeenCalledWith('net_host_forget', { origin: 'https://modele.exemple' });
      await waitFor(() => expect(screen.queryByRole('button', forget('https://modele.exemple'))).toBeNull());
      expect(screen.getByRole('button', forget(SERVER))).toBeInTheDocument();
    });

    it('none confirmed: a line says so', async () => {
      rust([]);
      opened('fenetre');
      const card = screen.getByRole('heading', { name: 'Adresses hors de ce poste' }).closest('section')!;
      expect(await within(card).findByText(/Aucune/)).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: /^Oublier/ })).toBeNull();
    });

    it('while Rust has not answered: a grey line that checks, never « Aucune »', async () => {
      const answer = heldHosts();
      opened('fenetre');
      const card = screen.getByRole('heading', { name: 'Adresses hors de ce poste' }).closest('section')!;
      await asked();
      expect(within(card).getByText(CHECKING)).toBeInTheDocument();
      expect(within(card).queryByText(/Aucune/)).toBeNull();
      expect(within(card).queryByRole('alert')).toBeNull();
      answer([]);
      expect(await within(card).findByText(/Aucune/)).toBeInTheDocument();
      expect(within(card).queryByText(CHECKING)).toBeNull();
    });
  });

  it('showing the notice asks nothing of the person: only the click does', async () => {
    rust([]);
    linked();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(confirmCalls()).toEqual([]);
  });

  it('in a browser tab, nothing is shown, and nothing asked of the window', () => {
    where.inWindow = false;
    rust([]);
    alone();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(confirmButton()).toBeNull();
    cleanup();
    linked();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(invoke.mock.calls.filter(([cmd]) => String(cmd).startsWith('net_host'))).toEqual([]);
  });
});
