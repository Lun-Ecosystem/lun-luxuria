import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
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

describe('a voice that does not answer', () => {
  it('is said on the scene, with the way to its setting', async () => {
    const session = new Session();
    const openSettings = vi.fn();
    render(Scene, { session, openSettings });
    expect(screen.queryByText(/Sa voix ne répond pas/)).toBeNull();
    session.voiceStatus = 'down';
    flushSync();
    expect(screen.getByText(/Sa voix ne répond pas/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Régler la voix' }));
    expect(openSettings).toHaveBeenCalledWith('voix');
  });

  it('says it without a gender', () => {
    const session = new Session();
    render(Scene, { session, openSettings: () => {} });
    session.voiceStatus = 'down';
    flushSync();
    expect(screen.getByText(/Sa voix ne répond pas/).textContent).not.toMatch(/\bil\b/);
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

/** A scene on these settings, its instruction region, and the session. */
function scene(settings: object = {}, before: (s: Session) => void = () => {}) {
  localStorage.setItem('luxuria.settings', JSON.stringify(settings));
  localStorage.setItem('luxuria.mic', 'on');
  const session = new Session();
  before(session);
  render(Scene, { session, openSettings: () => {} });
  const said = () => screen.queryByRole('region', { name: 'Pour lui parler' });
  return { session, said };
}

describe('the instruction under the body', () => {
  it('filter off: just talk', () => {
    const { said } = scene({ filter: { scene: false, small: true } });
    expect(said()).toHaveTextContent('Parle-lui.');
  });

  it('the name filter: its name, or right after its answer', () => {
    const { said } = scene({ filter: { scene: true, small: true } });
    expect(said()).toHaveTextContent('Dis son nom, ou parle juste après sa réponse.');
  });

  it('the key: the one set, as it is written on it', () => {
    const { said } = scene({ talk: { scene: 'key', small: 'open' }, key: { on: true, code: 'F8' } });
    expect(said()).toHaveTextContent('Tiens F8 pour lui parler.');
    cleanup();
    expect(
      scene({ talk: { scene: 'key', small: 'open' }, key: { on: true, code: 'KeyF' } }).said(),
    ).toHaveTextContent('Tiens F pour lui parler.');
  });

  it('the microphone off: write, or turn it back on, with its button', async () => {
    const { session, said } = scene({}, (s) => (s.micOn = false));
    expect(said()).toHaveTextContent('Écris-lui, ou rallume le micro.');
    await fireEvent.click(within(said()!).getByRole('button', { name: 'Rallumer le micro' }));
    expect(session.micOn).toBe(true);
  });

  it('nothing heard in this mode: only writing', () => {
    const { said } = scene({ talk: { scene: 'key', small: 'open' }, key: { on: false, code: 'F9' } });
    expect(said()).toHaveTextContent('Écris-lui, depuis le fil.');
  });

  it('nothing heard in this mode, the microphone off too: writing, not the microphone', () => {
    const { said } = scene({ talk: { scene: 'muted', small: 'open' } }, (s) => (s.micOn = false));
    expect(said()).toHaveTextContent('Écris-lui, depuis le fil.');
  });

  it('the microphone held by another app, or the voice down: writing', () => {
    const { session, said } = scene({}, (s) => (s.busy = true));
    expect(said()).toHaveTextContent('Écris-lui, depuis le fil.');
    session.busy = false;
    session.voiceStatus = 'down';
    flushSync();
    expect(said()).toHaveTextContent('Écris-lui, depuis le fil.');
  });

  it('its button gone with what it did, the focus goes to the same control, at the top', async () => {
    scene({}, (s) => (s.micOn = false));
    await fireEvent.click(screen.getByRole('button', { name: 'Rallumer le micro' }));
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Couper le micro' }));
  });

  it('muted: nothing reaches it, writing neither, with the way out', async () => {
    const { session, said } = scene({}, (s) => (s.silenced = true));
    expect(said()).toHaveTextContent('En sourdine : rien ne lui parvient, l’écrit non plus.');
    await fireEvent.click(within(said()!).getByRole('button', { name: 'Sortir de la sourdine' }));
    expect(session.silenced).toBe(false);
  });

  it('goes at the first turn of the person, not at the welcome', () => {
    const { session, said } = scene();
    session.subtitle = 'Bonjour.';
    flushSync();
    expect(said()).not.toBeNull();
    session.spoke = true;
    flushSync();
    expect(said()).toBeNull();
  });

  it('a phrase written is a turn too', async () => {
    const { session, said } = scene();
    expect(said()).not.toBeNull();
    await session.write('bonjour');
    flushSync();
    expect(said()).toBeNull();
  });

  it('the open thread says what is written there instead', () => {
    const { said } = scene({}, (s) => ((s.threadOpen = true), (s.threadRead = true)));
    expect(said()).toBeNull();
    expect(screen.getByText('Rien encore aujourd’hui.')).toBeInTheDocument();
    expect(
      screen.getByText('Ce que vous vous dites s’écrit ici, à la voix comme à l’écrit.'),
    ).toBeInTheDocument();
  });

  it('linked, the thread is not the day’s: nothing yet, without the day', () => {
    scene({ brain: 'linked' }, (s) => ((s.threadOpen = true), (s.threadRead = true)));
    expect(screen.getByText('Rien encore.')).toBeInTheDocument();
  });

  it('a thread not read yet, or not reached: it does not say it is empty', () => {
    scene({ brain: 'linked' }, (s) => (s.threadOpen = true));
    expect(screen.queryByText('Rien encore.')).toBeNull();
  });
});

describe('the state', () => {
  it('a badge, in the tone of the state', () => {
    const { session } = scene({}, (s) => (s.capturing = true));
    expect(screen.getByText('Disponible')).toHaveClass('accent');
    session.capturing = false;
    flushSync();
    expect(screen.getByText('Micro coupé')).toHaveClass('attention');
  });
});

describe('in a browser tab', () => {
  it('the scene always, even with a small mode saved, and no small mode button', () => {
    localStorage.setItem('luxuria.layout', 'small');
    const { session } = scene();
    expect(session.layout).toBe('scene');
    expect(screen.queryByRole('button', { name: 'Passer en petit mode' })).toBeNull();
  });
});
