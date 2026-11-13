// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openMicrophone } from './audio.ts';

/** A microphone that opens, and a sound context whose `fails` step throws. */
function browser(fails: 'context' | 'addModule' | 'node') {
  const track = { stop: vi.fn() };
  const close = vi.fn(async () => {});
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        if (fails === 'context') throw new Error('context refused');
      }
      audioWorklet = {
        addModule: async () => {
          if (fails === 'addModule') throw new Error('worklet refused');
        },
      };
      close = close;
      createMediaStreamSource = () => ({ connect() {} });
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      constructor() {
        if (fails === 'node') throw new Error('node refused');
      }
      port = {};
    },
  );
  return { track, close };
}

const open = () => openMicrophone({ echoCancellation: true, noiseSuppression: true }, () => {});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a microphone that could not open', () => {
  it.each([
    ['addModule', 'worklet refused'],
    ['node', 'node refused'],
  ] as const)('%s throws: its tracks stop, its context closes, the error comes back', async (fails, said) => {
    const { track, close } = browser(fails);
    await expect(open()).rejects.toThrow(said);
    expect(track.stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('the context itself refused: its tracks stop, the error comes back', async () => {
    const { track } = browser('context');
    await expect(open()).rejects.toThrow('context refused');
    expect(track.stop).toHaveBeenCalled();
  });
});
