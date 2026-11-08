import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../session.svelte.ts';
import { DEFAULTS, type Settings, type VoiceService } from '../settings.ts';
import { argsOf, missing, readBricks, serviceArgs, startVoice } from './voix.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

const READY: VoiceService = {
  ...DEFAULTS.voice.service,
  launch: true,
  folder: 'D:\\voix',
  piper: 'D:\\v.onnx',
};
const withService = (launch: boolean, folder = 'D:\\voix', over: Partial<VoiceService> = {}) => {
  const session = new Session();
  session.saveSettings({
    ...session.settings,
    voice: { ...session.settings.voice, service: { ...READY, launch, folder, ...over } },
  } as Settings);
  return session;
};
const noBricks = async () => null;
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

describe('the fields of the service', () => {
  it('make its arguments; RVC only when on; the rest after, as typed', () => {
    expect(
      serviceArgs({
        ...READY,
        stt: { kind: 'whisper-server', model: 'small', url: 'http://127.0.0.1:8080' },
        rvc: { on: true, url: 'http://127.0.0.1:18888', gain: 1.5 },
        args: ['--lang', 'en'],
      }),
    ).toEqual([
      '--stt',
      'whisper-server:http://127.0.0.1:8080',
      '--tts',
      'piper:D:\\v.onnx',
      '--rvc',
      'http://127.0.0.1:18888',
      '--rvc-gain',
      '1.5',
      '--lang',
      'en',
    ]);
  });

  it('say what is missing, first the folder', () => {
    expect(missing(READY)).toBeNull();
    expect(missing({ ...READY, folder: '' })).toMatch(/dossier du service/);
    expect(missing({ ...READY, piper: '' })).toMatch(/fichier de la voix/);
    expect(missing({ ...READY, piper: '', args: ['--tts', 'kokoro:a:b'] })).toBeNull();
    expect(missing({ ...READY, stt: { ...READY.stt, kind: 'whisper-server', url: '' } })).toMatch(
      /whisper-server/,
    );
    expect(missing({ ...READY, rvc: { ...READY.rvc, on: true, url: ' ' } })).toMatch(/RVC/);
  });

  it('the state of its programs: read from the service, nothing when it does not answer', async () => {
    const body = { stt: { kind: 'faster', up: true }, rvc: { up: false } };
    const ok = vi.fn(async () => new Response(JSON.stringify(body)));
    expect(await readBricks(ok as unknown as typeof fetch)()).toEqual(body);
    expect(ok).toHaveBeenCalledWith('/voix/etat', expect.anything());
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await readBricks(down)()).toBeNull();
  });
});

describe('startVoice', () => {
  it('a service already answering is left alone', async () => {
    const session = withService(true);
    const call = vi.fn();
    await startVoice(session, async () => true, call, noSleep, noBricks);
    expect(call).not.toHaveBeenCalled();
    expect(session.voiceSaid).toMatch(/répond/);
  });

  it('not asked to launch: nothing starts, and the screen says the voice is missing', async () => {
    const session = withService(false);
    const call = vi.fn();
    await startVoice(session, async () => false, call, noSleep, noBricks);
    expect(call).not.toHaveBeenCalled();
    expect(session.voiceSaid).toMatch(/Lancer le service voix avec l’appli/);
    expect(session.voiceStatus).toBe('down');
  });

  it('a missing folder or voice file is named, and nothing starts', async () => {
    const call = vi.fn();
    const noFolder = withService(true, '');
    await startVoice(noFolder, async () => false, call, noSleep, noBricks);
    expect(noFolder.voiceSaid).toMatch(/Il manque le dossier du service/);
    const noVoice = withService(true, 'D:\voix', { piper: '' });
    await startVoice(noVoice, async () => false, call, noSleep, noBricks);
    expect(noVoice.voiceSaid).toMatch(/Il manque le fichier de la voix/);
    expect(call).not.toHaveBeenCalled();
  });

  it('once it answers, what it says of its programs is kept', async () => {
    const session = withService(true);
    const bricks = { stt: { kind: 'whisper-server' as const, up: false }, rvc: null };
    await startVoice(
      session,
      async () => true,
      vi.fn(),
      noSleep,
      async () => bricks,
    );
    expect(session.bricks).toEqual(bricks);
  });

  it('starts it with its folder and arguments, then waits for its first answer', async () => {
    const session = withService(true);
    const call = vi.fn(async () => 'C:\\logs\\voix.log');
    const answers = [false, false, false, true];
    await startVoice(session, async () => answers.shift()!, call, noSleep, noBricks);
    expect(call).toHaveBeenCalledWith('voice_start', {
      dir: 'D:\\voix',
      args: ['--stt', 'faster:small', '--tts', 'piper:D:\\v.onnx'],
    });
    expect(session.voiceSaid).toMatch(/répond/);
    expect(session.voiceStatus).toBe('up');
  });

  it('a refused start, or a service that never answers, is said with its log', async () => {
    const refused = withService(true);
    await startVoice(
      refused,
      async () => false,
      async () => Promise.reject('uv introuvable'),
      noSleep,
      noBricks,
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
