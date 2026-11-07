import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Scene from './Scene.svelte';
import { Session } from './session.svelte.ts';
import type { Settings } from './settings.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  // jsdom has no scrollTo; the open thread scrolls to its last message.
  Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo;
});

const withImages = (session: Session, rest: string) =>
  session.saveSettings({ ...session.settings, body: { level: 'images', rest, talking: '' } } as Settings);

describe('the desk mute', () => {
  it('the button says what it does and is pressed while muted; the thread field says why it waits', async () => {
    const session = new Session();
    session.threadOpen = true;
    render(Scene, { session, openSettings: () => {} });
    const button = screen.getByRole('button', { name: 'Mettre en sourdine' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('textbox', { name: 'Lui écrire' })).toBeEnabled();

    await fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Sortir de la sourdine' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Lui écrire' })).toBeDisabled();
    expect(screen.getByText(/Sortir de la sourdine pour lui écrire/)).toBeInTheDocument();
    expect(screen.getByText('En sourdine')).toBeInTheDocument();
  });
});

describe('the body in images', () => {
  it('a broken image gives the breath, and a repaired address brings the image back without a reload', () => {
    const session = new Session();
    withImages(session, '/manque.png');
    const { container } = render(Scene, { session, openSettings: () => {} });
    fireEvent.error(container.querySelector('img')!);
    flushSync();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.souffle')).not.toBeNull();

    withImages(session, '/repos.png');
    flushSync();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/repos.png');
  });
});
