import { describe, expect, it } from 'vitest';
import { apply, toScreen, type Win } from './window.svelte.ts';
import type { Monitor } from '@tauri-apps/api/window';

const recorder = () => {
  const calls: string[] = [];
  const win: Win = {
    setFullscreen: async (on) => void calls.push(`fullscreen ${on}`),
    setAlwaysOnTop: async (on) => void calls.push(`onTop ${on}`),
    setSize: async (s) => void calls.push(`size ${s.width}x${s.height}`),
    setPosition: async (p) => void calls.push(`position ${p.x},${p.y}`),
  };
  return { calls, win };
};

describe('apply', () => {
  it('the thumbnail: out of fullscreen before the size, on top, never a focus', async () => {
    const { calls, win } = recorder();
    await apply(win, { fullscreen: false, onTop: true, x: 10, y: 20, width: 320, height: 240 });
    expect(calls).toEqual(['fullscreen false', 'onTop true', 'size 320x240', 'position 10,20']);
  });

  it('the scene: moved to its screen while windowed, then fullscreen there', async () => {
    const { calls, win } = recorder();
    await apply(win, { fullscreen: true, onTop: false, x: 1920, y: 0, width: 1920, height: 1080 });
    expect(calls).toEqual(['onTop false', 'fullscreen false', 'position 1920,0', 'fullscreen true']);
  });

  it('the same place again: the window is not touched, so the thread opens without leaving fullscreen', async () => {
    const { calls, win } = recorder();
    const scene = { fullscreen: true, onTop: false, x: 1920, y: 0, width: 1920, height: 1080 };
    await apply(win, { ...scene }, scene);
    expect(calls).toEqual([]);
  });

  it('the thumbnail grows into a panel: only its size and place change', async () => {
    const { calls, win } = recorder();
    const thumb = { fullscreen: false, onTop: true, x: 10, y: 20, width: 320, height: 240 };
    await apply(win, { ...thumb, x: 0, y: 0, width: 420, height: 640 }, thumb);
    expect(calls).toEqual(['size 420x640', 'position 0,0']);
  });
});

describe('toScreen', () => {
  it('reads a monitor in physical pixels, and knows the main one by its position', () => {
    const m = (x: number, name: string | null) =>
      ({
        name,
        scaleFactor: 1.25,
        position: { x, y: 0 },
        size: { width: 2560, height: 1440 },
        workArea: { position: { x, y: 0 }, size: { width: 2560, height: 1400 } },
      }) as unknown as Monitor;
    const main = m(0, 'A');
    expect(toScreen(m(2560, null), main)).toMatchObject({ name: '2560,0', primary: false, scale: 1.25 });
    expect(toScreen(main, main)).toMatchObject({ name: 'A', primary: true, work: { height: 1400 } });
  });
});
