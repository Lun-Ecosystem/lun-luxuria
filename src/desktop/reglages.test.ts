import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const where = vi.hoisted(() => ({ inWindow: true }));
vi.mock('./net.ts', async (real) => ({
  ...(await real<typeof import('./net.ts')>()),
  get inWindow() {
    return where.inWindow;
  },
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
