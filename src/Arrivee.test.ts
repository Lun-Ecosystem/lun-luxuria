import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const where = vi.hoisted(() => ({ inWindow: false }));
vi.mock('./desktop/net.ts', async (real) => ({
  ...(await real<typeof import('./desktop/net.ts')>()),
  get inWindow() {
    return where.inWindow;
  },
}));

// What the page asks of the window: answered here, by command name.
const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => null));
vi.mock('@tauri-apps/api/core', async (real) => ({
  ...(await real<typeof import('@tauri-apps/api/core')>()),
  invoke,
}));
import Arrivee from './Arrivee.svelte';
import { Session } from './session.svelte.ts';

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async () => null);
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

describe('an address off this computer, confirmed on the arrival', () => {
  const NOTICE = /Cette adresse est hors de ce poste : la fenêtre ne la joint qu.une fois confirmée\./;
  const CONFIRMED = 'Confirmée pour la fenêtre.';
  const SERVER = 'https://serveur.exemple:8443';
  const MODEL = 'https://modele.exemple/v1';
  const confirmButton = () => screen.queryByRole('button', { name: /^Confirmer/ });
  const confirmCalls = () => invoke.mock.calls.filter(([cmd]) => cmd === 'net_host_confirm');

  /** Rust's side: the origins it holds, and its answer to « Confirmer… ». */
  function rust(confirmed: string[], answer: boolean | Error = true) {
    const list = [...confirmed];
    invoke.mockImplementation(async (cmd, args) => {
      const a = (args ?? {}) as { url?: string };
      if (cmd === 'net_hosts') return [...list];
      if (cmd === 'net_host_confirm') {
        // Tauri rejects with Rust's message, a string.
        if (answer instanceof Error) throw answer.message;
        if (answer) list.push(new URL(a.url!).origin);
        return answer;
      }
      return null;
    });
  }
  /** Rust's net_hosts, held until the test answers. */
  function heldHosts() {
    let answer!: (hosts: string[]) => void;
    const held = new Promise<string[]>((resolve) => (answer = resolve));
    invoke.mockImplementation(async (cmd) => (cmd === 'net_hosts' ? held : null));
    return answer;
  }
  const linked = (server = SERVER) => arriving({ brain: 'linked', server });
  const alone = (url = MODEL) => arriving({ brain: 'alone', model: { url, name: 'un-modele', key: '' } });

  it('the server: the notice, then « Confirmer… » asks Rust with the field’s address', async () => {
    where.inWindow = true;
    rust([]);
    linked();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Confirmer/ }));
    expect(invoke).toHaveBeenCalledWith('net_host_confirm', { url: SERVER });
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(confirmButton()).toBeNull();
    expect(screen.getByRole('button', { name: `Oublier l’adresse confirmée ${SERVER}` })).toBeInTheDocument();
  });

  it('the model: the same, with the model’s address', async () => {
    where.inWindow = true;
    rust([]);
    alone();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Confirmer/ }));
    expect(invoke).toHaveBeenCalledWith('net_host_confirm', { url: MODEL });
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
  });

  it('Rust refuses: its message is on the screen, and nothing is confirmed', async () => {
    where.inWindow = true;
    rust([], new Error('Adresse illisible.'));
    linked();
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmer/ }));
    expect(await screen.findByText(/Adresse illisible\./)).toBeInTheDocument();
    expect(screen.queryByText(CONFIRMED)).toBeNull();
  });

  it('already confirmed: says so, no « Confirmer… »', async () => {
    where.inWindow = true;
    rust(['https://modele.exemple']);
    alone();
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(confirmButton()).toBeNull();
  });

  it.each(['http://127.0.0.1:8788', 'http://localhost:8788', 'http://[::1]:8788'])(
    'this computer, %s: nothing to confirm',
    async (address) => {
      where.inWindow = true;
      rust([]);
      // Once Rust has answered, when an address off this computer would show its notice.
      const server = linked(address);
      await waitFor(() => expect(server.hosts).toEqual([]));
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(confirmButton()).toBeNull();
      cleanup();
      const model = alone(address + '/v1');
      await waitFor(() => expect(model.hosts).toEqual([]));
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(confirmButton()).toBeNull();
      expect(confirmCalls()).toEqual([]);
    },
  );

  it('the notice is what blocks: said as the field’s error, as in the settings', async () => {
    where.inWindow = true;
    rust([]);
    linked();
    await screen.findByText(NOTICE);
    expect(screen.getByRole('textbox', { name: 'Adresse du serveur' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Adresse du serveur' })).toHaveAccessibleDescription(NOTICE);
  });

  it('Rust has not answered yet, the address already confirmed: nothing blocks, it checks', async () => {
    where.inWindow = true;
    const answer = heldHosts();
    linked();
    await waitFor(() => expect(invoke.mock.calls.some(([cmd]) => cmd === 'net_hosts')).toBe(true));
    const field = screen.getByRole('textbox', { name: 'Adresse du serveur' });
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Vérification…')).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(confirmButton()).toBeNull();
    answer([SERVER]);
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('net_hosts fails: none confirmed, the closed side, the notice', async () => {
    where.inWindow = true;
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'net_hosts') throw 'hotes.json illisible';
      return null;
    });
    const session = linked();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(confirmButton()).not.toBeNull();
    expect(session.hosts).toEqual([]);
  });

  it.each([
    ['the server in http, off this computer', 'http://serveur.exemple:8788', '', /partirait en clair/],
    ['the model in http, with a key', 'http://modele.exemple/v1', 'une-cle', /La clé ne part pas en clair/],
  ])(
    '%s: the page refuses it already, so no « Confirmer… », its own warning only',
    async (_, url, key, warning) => {
      where.inWindow = true;
      rust([]);
      const session = url.includes('serveur')
        ? linked(url)
        : arriving({ brain: 'alone', model: { url, name: 'un-modele', key } });
      await waitFor(() => expect(session.hosts).toEqual([]));
      expect(screen.getByText(warning)).toBeInTheDocument();
      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(confirmButton()).toBeNull();
    },
  );

  it('the keyboard: after « Confirmer… » the focus is on the « Oublier » that replaces it', async () => {
    where.inWindow = true;
    rust([]);
    linked();
    (await screen.findByRole('button', { name: `Confirmer l’adresse ${SERVER}` })).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `Oublier l’adresse confirmée ${SERVER}` })).toHaveFocus(),
    );
  });

  it('showing the notice asks nothing of the person', async () => {
    where.inWindow = true;
    rust([]);
    alone();
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(confirmCalls()).toEqual([]);
  });

  it('in a browser tab, nothing is shown, and nothing asked of the window', () => {
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
