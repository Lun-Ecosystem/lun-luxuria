import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./audio.ts', () => ({
  openMicrophone: vi.fn(async () => ({ stop: vi.fn() })),
  webOutput: () => ({ play: () => ({ stop() {}, heard: () => 0 }), level: () => 0 }),
}));

import App from './App.svelte';
import Reglages from './Reglages.svelte';
import { Session } from './session.svelte.ts';
import { readSettings } from './settings.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
// A failing test must not leave its stubs to the next ones.
afterEach(() => vi.unstubAllGlobals());

describe('the door', () => {
  it('alone by default: enters without a code', () => {
    render(App);
    expect(screen.getByRole('button', { name: 'Entrer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('linked, asks for a code first, and a refused code says so', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Code refusé' }, { status: 401 })),
    );
    render(App);
    const first = screen.getAllByRole('textbox')[0]!;
    await userEvent.click(first);
    await userEvent.keyboard('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('Code refusé');
  });

  it('a token the server no longer knows is forgotten, and the arrival asks for a code and says why', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    localStorage.setItem('luxuria.token', 't');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Jeton inconnu' }, { status: 401 })),
    );
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const session = new Session();
    await session.enter();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(localStorage.getItem('luxuria.token')).toBeNull();
    // What the reload shows: the code again, and the reason.
    render(App);
    expect(screen.getByRole('alert')).toHaveTextContent('Ce poste n’est plus reconnu par le serveur');
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });

  it('a token another tab just got is not the one forgotten', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    localStorage.setItem('luxuria.token', 'ancien');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Jeton inconnu' }, { status: 401 })),
    );
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const session = new Session();
    localStorage.setItem('luxuria.token', 'nouveau'); // paired meanwhile, elsewhere
    await session.enter();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(localStorage.getItem('luxuria.token')).toBe('nouveau');
  });

  it('a tab, linked and paired: its threshold as before, never entering by itself', () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    localStorage.setItem('luxuria.token', 't');
    render(App);
    expect(screen.getByRole('button', { name: 'Entrer' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Entrer sans attendre' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('with a token, nothing runs before the click: no microphone, no presence', () => {
    localStorage.setItem('luxuria.token', 't');
    localStorage.setItem('luxuria.mic', 'on');
    render(App);
    expect(screen.getByRole('button', { name: 'Entrer' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the settings', () => {
  it('a switch saves at once and comes back on the next launch', async () => {
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'ecoute' });
    expect(session.settings.filter.small).toBe(true);
    await userEvent.click(screen.getByRole('switch', { name: 'Filtre en petit mode' }));
    await waitFor(() => expect(session.settings.filter.small).toBe(false));
    expect(readSettings(localStorage.getItem('luxuria.settings')).filter.small).toBe(false);
  });

  it('every mechanic of the perception has its switch', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ brain: 'linked' }));
    render(Reglages, { session: new Session(), close: () => {}, start: 'ecoute' });
    for (const name of [
      'Touche à maintenir',
      'Mention du nom',
      'Fenêtre après sa parole',
      'Trace d’une phrase ignorée',
      'Détection',
      'Répondre dès une courte pause',
      'Couper à la voix',
    ])
      expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Voix' }));
    expect(screen.getByRole('switch', { name: 'Les urgences' })).toBeInTheDocument();
  });

  it('alone, sets its name and model; what only a server can say is not offered', async () => {
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'voix' });
    expect(screen.queryByRole('switch', { name: 'Les urgences' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'L’agent' }));
    const name = screen.getByRole('textbox', { name: 'Nom' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Mira');
    await userEvent.tab();
    await waitFor(() => expect(session.settings.agent.name).toBe('Mira'));
    expect(screen.getByLabelText('Clé')).toHaveAttribute('type', 'password');
  });

  it('a value out of range is brought back in range, garbage leaves it unchanged', async () => {
    const session = new Session();
    render(Reglages, { session, close: () => {}, start: 'ecoute' });
    const box = screen.getByRole('textbox', { name: 'Durée de la fenêtre' });
    await userEvent.clear(box);
    await userEvent.type(box, '9999');
    await userEvent.tab();
    await waitFor(() => expect(session.settings.window.seconds).toBe(300));
    const again = screen.getByRole('textbox', { name: 'Durée de la fenêtre' });
    await userEvent.clear(again);
    await userEvent.type(again, 'abc');
    await userEvent.tab();
    expect(session.settings.window.seconds).toBe(300);
  });
});
