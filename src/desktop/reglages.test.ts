import { fireEvent, render, screen } from '@testing-library/svelte';
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

const { default: Reglages } = await import('../Reglages.svelte');
const { Session } = await import('../session.svelte.ts');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  where.inWindow = true;
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
    expect(screen.getByText(/Il manque le dossier du service/)).toBeInTheDocument();
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
