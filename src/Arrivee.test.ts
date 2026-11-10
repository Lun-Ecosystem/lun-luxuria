import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const where = vi.hoisted(() => ({ inWindow: false }));
vi.mock('./desktop/net.ts', async (real) => ({
  ...(await real<typeof import('./desktop/net.ts')>()),
  get inWindow() {
    return where.inWindow;
  },
}));

import Arrivee from './Arrivee.svelte';
import { Session } from './session.svelte.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  where.inWindow = false;
});

/** A session whose switching and entering are only counted. */
function arriving(settings: object = {}, token?: string) {
  localStorage.setItem('luxuria.settings', JSON.stringify(settings));
  if (token) localStorage.setItem('luxuria.token', token);
  const session = new Session();
  session.enter = vi.fn(async () => {});
  session.switchBrain = vi.fn((next) => session.saveSettings({ ...session.settings, brain: next }));
  render(Arrivee, { session });
  return session;
}

describe('the arrival', () => {
  it('says what the app is, under its name', () => {
    arriving();
    expect(screen.getByRole('heading', { level: 1, name: 'Agent' })).toBeInTheDocument();
    expect(
      screen.getByText('Un compagnon qui t’écoute et te répond à voix haute, sur ce poste.'),
    ).toBeInTheDocument();
  });

  it('two cards, each with what it needs; choosing one switches', async () => {
    const session = arriving();
    const alone = screen.getByRole('radio', { name: 'Seul' });
    const linked = screen.getByRole('radio', { name: 'Relié à un serveur' });
    expect(alone).toBeChecked();
    expect(alone).toHaveAccessibleDescription(/Il faut : l’adresse du modèle et son nom/);
    expect(linked).toHaveAccessibleDescription(/Il faut : l’adresse du serveur et un code d’appairage/);
    await userEvent.click(linked);
    expect(session.switchBrain).toHaveBeenCalledWith('linked');
  });
});

describe('alone', () => {
  it('its fields on the page, saved as typed, and « Entrer » once nothing is missing', async () => {
    const session = arriving();
    expect(screen.getByRole('textbox', { name: 'Adresse du modèle' })).toHaveValue(
      'http://127.0.0.1:11434/v1',
    );
    expect(screen.getByLabelText('Clé (facultative)')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Entrer' })).toBeDisabled();
    expect(screen.getByText('Il manque le nom du modèle.')).toBeInTheDocument();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Nom du modèle' }), {
      target: { value: 'qwen3:8b' },
    });
    expect(session.settings.model.name).toBe('qwen3:8b');
    expect(screen.getByText('Tout se change ensuite dans ses réglages.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entrer' }));
    expect(session.enter).toHaveBeenCalledOnce();
  });

  it('a missing address is said too', () => {
    arriving({ model: { url: ' ', name: 'qwen3:8b' } });
    expect(screen.getByRole('button', { name: 'Entrer' })).toBeDisabled();
    expect(screen.getByText('Il manque l’adresse du modèle.')).toBeInTheDocument();
  });
});

describe('linked', () => {
  it('the code and where it shows; no server address in a tab, and no « Entrer »', () => {
    arriving({ brain: 'linked' });
    expect(
      screen.getByText(/Le code s’affiche sur le serveur, là où on ajoute un appareil/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Adresse du serveur' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Entrer' })).toBeNull();
    expect(screen.getByText('Le code complet fait entrer.')).toBeInTheDocument();
  });

  it('in the window, the server address on the page, with its warning', async () => {
    where.inWindow = true;
    const session = arriving({ brain: 'linked' });
    session.setServer = vi.fn();
    const address = screen.getByRole('textbox', { name: 'Adresse du serveur' });
    expect(address).toHaveValue('http://127.0.0.1:8788');
    await fireEvent.change(address, { target: { value: ' http://nas.lan:8788 ' } });
    expect(session.setServer).toHaveBeenCalledWith('http://nas.lan:8788');
  });

  it('an http address off this computer is warned about', () => {
    where.inWindow = true;
    arriving({ brain: 'linked', server: 'http://nas.lan:8788' });
    expect(screen.getByText(/cette adresse doit être en https/)).toBeInTheDocument();
  });

  it('a complete code pairs, then enters', async () => {
    const session = arriving({ brain: 'linked' });
    session.pair = vi.fn(async () => {});
    await userEvent.click(screen.getByRole('textbox', { name: 'Code d’appairage' }));
    await userEvent.keyboard('123456');
    expect(session.pair).toHaveBeenCalledWith('123456');
    await waitFor(() => expect(session.enter).toHaveBeenCalledOnce());
  });

  it('a refused code says so, and enters nothing', async () => {
    const session = arriving({ brain: 'linked' });
    session.pair = vi.fn(async () => Promise.reject(new Error('Code refusé')));
    await userEvent.click(screen.getByRole('textbox', { name: 'Code d’appairage' }));
    await userEvent.keyboard('123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('Code refusé');
    expect(session.enter).not.toHaveBeenCalled();
  });

  it('already paired: « Entrer », as alone', () => {
    arriving({ brain: 'linked' }, 't');
    expect(screen.getByRole('button', { name: 'Entrer' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: 'Code d’appairage' })).toBeNull();
  });
});
