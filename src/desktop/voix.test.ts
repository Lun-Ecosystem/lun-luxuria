import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../session.svelte.ts';
import { DEFAULTS, type Settings, type VoiceService } from '../settings.ts';
import {
  addrOf,
  argsOf,
  changes,
  checkVoice,
  launchProgram,
  missing,
  readBricks,
  restartVoice,
  serviceArgs,
  startAll,
  startPrograms,
  startVoice,
} from './voix.ts';

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
        stt: { ...READY.stt, kind: 'whisper-server', url: 'http://127.0.0.1:8080' },
        rvc: { ...READY.rvc, on: true, url: 'http://127.0.0.1:18888', gain: 1.5 },
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
    const call = vi.fn(async () => null);
    await startVoice(session, async () => true, call, noSleep, noBricks);
    expect(call).not.toHaveBeenCalledWith('voice_start', expect.anything());
    expect(session.voiceSaid).toMatch(/répond/);
    // Started by hand: the app cannot say what it runs with.
    expect(session.voiceArgs).toBeNull();
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

  it('keeps the arguments the app started it with', async () => {
    const session = withService(true);
    const args = ['--stt', 'faster:small', '--tts', 'piper:D:\\v.onnx'];
    const call = vi.fn(async (cmd: string) => (cmd === 'voice_running' ? args : 'C:\\logs\\voix.log'));
    const answers = [false, true];
    await startVoice(session, async () => answers.shift()!, call, noSleep, noBricks);
    expect(session.voiceArgs).toEqual(args);
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

describe('checkVoice', () => {
  it('only asks: up with what it says of its programs, or down; nothing is launched', async () => {
    const session = withService(true);
    const bricks = { stt: { kind: 'faster' as const, up: true }, rvc: null };
    await checkVoice(
      session,
      async () => true,
      async () => bricks,
    );
    expect(session.voiceStatus).toBe('up');
    expect(session.bricks).toEqual(bricks);
    await checkVoice(
      session,
      async () => false,
      async () => bricks,
    );
    expect(session.voiceStatus).toBe('down');
    expect(session.bricks).toBeNull();
  });
});

describe('a change of settings', () => {
  const up = (session: Session, args: string[] | null, kind: 'faster' | 'whisper-server' = 'faster') => {
    session.voiceStatus = 'up';
    session.voiceArgs = args;
    session.bricks = { stt: { kind, up: true }, rvc: null };
    return session;
  };
  it('started here: the same arguments wait for nothing, others wait for a restart', () => {
    const session = withService(true);
    const now = serviceArgs(session.settings.voice.service);
    expect(changes(up(session, now))).toBe('none');
    expect(changes(up(session, ['--stt', 'whisper-server:http://127.0.0.1:8080']))).toBe('restart');
  });
  it('started by hand: only what it says of itself can differ, and it restarts by hand', () => {
    const session = withService(true);
    expect(changes(up(session, null))).toBe('none');
    expect(changes(up(session, null, 'whisper-server'))).toBe('manual');
  });
  it('a service that does not answer has nothing waiting', () => {
    const session = withService(true);
    session.voiceStatus = 'down';
    session.voiceArgs = ['--x'];
    expect(changes(session)).toBe('none');
  });
});

describe('restartVoice', () => {
  it('restarts with the fields, then waits for its answer and says so', async () => {
    const session = withService(true);
    const args = serviceArgs(session.settings.voice.service);
    const call = vi.fn(async (cmd: string) => (cmd === 'voice_running' ? args : 'C:\\logs\\voix.log'));
    const answers = [false, true];
    await restartVoice(session, async () => answers.shift()!, call, noSleep, noBricks);
    expect(call).toHaveBeenCalledWith('voice_restart', { dir: 'D:\\voix', args });
    expect(session.voiceStatus).toBe('up');
    expect(session.voiceArgs).toEqual(args);
  });
  it('a refused restart is said, and the running service is kept', async () => {
    const session = withService(true);
    session.voiceStatus = 'up';
    const call = vi.fn(async () => Promise.reject('arrête-le toi-même'));
    await restartVoice(session, async () => true, call, noSleep, noBricks);
    expect(session.voiceSaid).toBe('arrête-le toi-même');
    expect(session.voiceStatus).toBe('up');
  });
});

describe('whisper-server and RVC', () => {
  const PROGRAM = { path: 'D:\\whisper\\whisper-server.exe', args: ['-m', 'small.bin'], launch: true };
  const both = (over: Partial<VoiceService> = {}) =>
    withService(true, 'D:\\voix', {
      stt: { ...READY.stt, kind: 'whisper-server', url: 'http://127.0.0.1:8080', program: PROGRAM },
      rvc: {
        ...READY.rvc,
        on: true,
        url: 'http://localhost:18888',
        program: { ...PROGRAM, path: 'D:\\rvc.exe' },
      },
      ...over,
    });

  it('the address to probe, with its default port', () => {
    expect(addrOf('http://127.0.0.1:8080')).toBe('127.0.0.1:8080');
    expect(addrOf('http://localhost')).toBe('localhost:80');
    expect(addrOf('https://[::1]/x')).toBe('[::1]:443');
    expect(addrOf('pas une adresse')).toBeNull();
  });

  it('at start: each one in use and asked to launch, with its path, arguments and address', async () => {
    const session = both();
    const call = vi.fn(async () => 'started');
    expect(await startPrograms(session, call)).toBe(true);
    expect(call).toHaveBeenCalledWith('program_start', {
      name: 'whisper-server',
      path: 'D:\\whisper\\whisper-server.exe',
      args: ['-m', 'small.bin'],
      addr: '127.0.0.1:8080',
    });
    expect(call).toHaveBeenCalledWith(
      'program_start',
      expect.objectContaining({ name: 'rvc', addr: 'localhost:18888' }),
    );
    expect(session.programs['whisper-server']).toBe('Lancé par l’appli.');
  });

  it('at start: not in use, not asked, or without a path, nothing is launched', async () => {
    const off = both({
      stt: { ...READY.stt, kind: 'faster', program: PROGRAM },
      rvc: { ...READY.rvc, on: true, program: { ...PROGRAM, launch: false } },
    });
    const call = vi.fn(async () => 'started');
    expect(await startPrograms(off, call)).toBe(false);
    const noPath = both({ rvc: { ...READY.rvc, on: false, program: PROGRAM } });
    noPath.settings.voice.service.stt.program.path = '';
    expect(await startPrograms(noPath, call)).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('by hand: launched even when not asked at start; already answering or refused is said', async () => {
    const session = both({ rvc: { ...READY.rvc, on: true, program: { ...PROGRAM, launch: false } } });
    const answering = vi.fn(async () => 'answering');
    expect(await launchProgram(session, 'rvc', answering)).toBe(false);
    expect(session.programs.rvc).toBe('Il répond déjà à son adresse : rien n’a été lancé.');
    const refused = vi.fn(async () => Promise.reject('Ce n’est pas un programme .exe.'));
    expect(await launchProgram(session, 'rvc', refused)).toBe(false);
    expect(session.programs.rvc).toBe('Ce n’est pas un programme .exe.');
    const started = vi.fn(async () => 'started');
    expect(await launchProgram(session, 'rvc', started)).toBe(true);
  });
});

describe('startAll', () => {
  it('the programs first, then the service; what they say is read until they answer', async () => {
    const session = withService(true, 'D:/voix', {
      rvc: { ...READY.rvc, on: true, program: { path: 'D:/rvc.exe', args: [], launch: true } },
    });
    const order: string[] = [];
    const call = vi.fn(async (cmd: string) => {
      order.push(cmd);
      return cmd === 'program_start' ? 'started' : cmd === 'voice_running' ? null : 'C:/logs/voix.log';
    });
    const states = [
      { stt: { kind: 'faster' as const, up: true }, rvc: { up: false } },
      { stt: { kind: 'faster' as const, up: true }, rvc: { up: true } },
    ];
    const answers = [false, true];
    await startAll(
      session,
      call,
      noSleep,
      async () => answers.shift() ?? true,
      async () => states.shift() ?? null,
    );
    expect(order.slice(0, 2)).toEqual(['program_start', 'voice_start']);
    expect(session.bricks?.rvc?.up).toBe(true);
  });
});
