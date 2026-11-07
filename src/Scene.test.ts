import { fireEvent, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Scene from './Scene.svelte';
import { Session } from './session.svelte.ts';
import type { Settings } from './settings.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

const withImages = (session: Session, rest: string) =>
  session.saveSettings({ ...session.settings, body: { level: 'images', rest, talking: '' } } as Settings);

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
