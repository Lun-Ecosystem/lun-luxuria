import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const where = vi.hoisted(() => ({ inWindow: true }));
vi.mock('./net.ts', async (real) => ({
  ...(await real<typeof import('./net.ts')>()),
  get inWindow() {
    return where.inWindow;
  },
}));
// The window's own card asks the system for its screens: one here, as on a laptop.
vi.mock('./window.svelte.ts', () => ({
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
    expect(screen.getByRole('textbox', { name: 'Raccourci de la sourdine' })).toHaveValue('Control+Shift+M');
    expect(screen.getByText('Vaut aussi en sourdine.')).toBeInTheDocument();
  });
});
