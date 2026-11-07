import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../session.svelte.ts';
import type { Settings } from '../settings.ts';
import { argsOf, startVoice } from './voix.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

const withService = (launch: boolean, folder = 'D:\\voix') => {
  const session = new Session();
  session.saveSettings({
    ...session.settings,
    voice: { ...session.settings.voice, service: { launch, folder, args: ['--stt', 'faster:small'] } },
  } as Settings);
  return session;
};
const noSleep = async () => {};

describe('argsOf', () => {
  it('one argument per line, a path with spaces stays whole', () => {
    expect(argsOf('--tts\r\npiper:D:\\projets perso\\voix fr.onnx\n\n  --stt  \n')).toEqual([
      '--tts',
      'piper:D:\\projets perso\\voix fr.onnx',
      '--stt',
    ]);
  });
});

describe('startVoice', () => {
  it('a service already answering is left alone', async () => {
    const session = withService(true);
    const call = vi.fn();
    await startVoice(session, async () => true, call, noSleep);
    expect(call).not.toHaveBeenCalled();
    expect(session.voiceSaid).toMatch(/répond/);
  });

  it('not asked to launch: nothing starts, and the screen says the voice is missing', async () => {
    const session = withService(false);
    const call = vi.fn();
    await startVoice(session, async () => false, call, noSleep);
    expect(call).not.toHaveBeenCalled();
    expect(session.voiceSaid).toMatch(/ne le lance pas/);
  });

  it('starts it with its folder and arguments, then waits for its first answer', async () => {
    const session = withService(true);
    const call = vi.fn(async () => 'C:\\logs\\voix.log');
    const answers = [false, false, false, true];
    await startVoice(session, async () => answers.shift()!, call, noSleep);
    expect(call).toHaveBeenCalledWith('voice_start', { dir: 'D:\\voix', args: ['--stt', 'faster:small'] });
    expect(session.voiceSaid).toMatch(/répond/);
  });

  it('a refused start, or a service that never answers, is said with its log', async () => {
    const refused = withService(true);
    await startVoice(
      refused,
      async () => false,
      async () => Promise.reject('uv introuvable'),
      noSleep,
    );
    expect(refused.voiceSaid).toBe('uv introuvable');
    const silent = withService(true);
    await startVoice(
      silent,
      async () => false,
      async () => 'C:\\logs\\voix.log',
      noSleep,
    );
    expect(silent.voiceSaid).toMatch(/Journal : C:\\logs\\voix\.log/);
  });
});
