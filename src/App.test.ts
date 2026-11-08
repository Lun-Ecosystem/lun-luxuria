import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import Reglages from './Reglages.svelte';
import { Session } from './session.svelte.ts';
import { readSettings } from './settings.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

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
