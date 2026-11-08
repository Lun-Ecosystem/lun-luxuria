import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../session.svelte.ts';
import { DEFAULTS, type Settings, type VoiceService } from '../settings.ts';
import {
  addrOf,
  argsOf,
  changes,
  checkVoice,
  followPrograms,
  forgetProgram,
  launchProgram,
  missing,
  pickProgram,
  readBricks,
  readProgramPaths,
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
    expect(call).not.toHaveBeenCalledWith('voice_start', expect.anything());
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
    expect(call).not.toHaveBeenCalledWith('voice_start', expect.anything());
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
  const PROGRAM = { args: ['-m', 'small.bin'], launch: true };
  const PATHS = { 'whisper-server': 'D:\\whisper\\whisper-server.exe', rvc: 'D:\\rvc\\rvc-server.exe' };
  const both = (over: Partial<VoiceService> = {}) => {
    const session = withService(true, 'D:\\voix', {
      stt: { ...READY.stt, kind: 'whisper-server', url: 'http://127.0.0.1:8080', program: PROGRAM },
      rvc: { ...READY.rvc, on: true, url: 'http://localhost:18888', program: PROGRAM },
      ...over,
    });
    session.programPaths = { ...PATHS };
    return session;
  };
  const started = (log = 'C:\\logs\\rvc.log') => vi.fn(async () => ({ outcome: 'started', log }));

  it('the address to probe, with its default port', () => {
    expect(addrOf('http://127.0.0.1:8080')).toBe('127.0.0.1:8080');
    expect(addrOf('http://localhost')).toBe('localhost:80');
    expect(addrOf('https://[::1]/x')).toBe('[::1]:443');
    expect(addrOf('pas une adresse')).toBeNull();
  });

  it('the page never names the program: only its arguments and its address go to the window', async () => {
    const session = both();
    const call = started();
    expect(await startPrograms(session, call)).toBe(true);
    expect(call).toHaveBeenCalledWith('program_start', {
      name: 'whisper-server',
      args: ['-m', 'small.bin'],
      addr: '127.0.0.1:8080',
    });
    expect(call).toHaveBeenCalledWith(
      'program_start',
      expect.objectContaining({ name: 'rvc', addr: 'localhost:18888' }),
    );
    expect(JSON.stringify(call.mock.calls)).not.toContain('.exe');
    expect(session.programs['whisper-server']).toMatchObject({
      said: 'Lancé par l’appli : il se charge.',
      starting: true,
    });
  });

  it('at start: not in use, not asked, or not picked, nothing is launched', async () => {
    const off = both({
      stt: { ...READY.stt, kind: 'faster', program: PROGRAM },
      rvc: { ...READY.rvc, on: true, program: { ...PROGRAM, launch: false } },
    });
    const call = started();
    expect(await startPrograms(off, call)).toBe(false);
    const notPicked = both({ rvc: { ...READY.rvc, on: false, program: PROGRAM } });
    notPicked.programPaths = {};
    expect(await startPrograms(notPicked, call)).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('by hand: launched even when not asked at start; already answering or refused is said', async () => {
    const session = both({ rvc: { ...READY.rvc, on: true, program: { ...PROGRAM, launch: false } } });
    const answering = vi.fn(async () => ({ outcome: 'answering', log: '' }));
    expect(await launchProgram(session, 'rvc', answering)).toBe(false);
    expect(session.programs.rvc).toEqual({
      said: 'Il répond déjà à son adresse : rien n’a été lancé.',
      ok: true,
    });
    const refused = vi.fn(async () =>
      Promise.reject('rvc s’est arrêté aussitôt (code 1). Journal : C:\\l.log'),
    );
    expect(await launchProgram(session, 'rvc', refused)).toBe(false);
    expect(session.programs.rvc).toEqual({ said: 'rvc s’est arrêté aussitôt (code 1). Journal : C:\\l.log' });
    expect(await launchProgram(session, 'rvc', started())).toBe(true);
    session.programPaths = {};
    expect(await launchProgram(session, 'rvc', started())).toBe(false);
    expect(session.programs.rvc?.said).toBe('Choisis d’abord son programme.');
  });

  it('the dialog of the window picks it; cancelled, nothing changes; forgotten, it is gone', async () => {
    const session = both();
    session.programPaths = {};
    await pickProgram(
      session,
      'rvc',
      vi.fn(async () => 'D:\\rvc\\rvc-server.exe'),
    );
    expect(session.programPaths.rvc).toBe('D:\\rvc\\rvc-server.exe');
    await pickProgram(
      session,
      'rvc',
      vi.fn(async () => null),
    );
    expect(session.programPaths.rvc).toBe('D:\\rvc\\rvc-server.exe');
    const forget = vi.fn(async () => null);
    await forgetProgram(session, 'rvc', forget);
    expect(forget).toHaveBeenCalledWith('program_forget', { name: 'rvc' });
    expect(session.programPaths.rvc).toBeUndefined();
    await readProgramPaths(
      session,
      vi.fn(async () => ({ ...PATHS })),
    );
    expect(session.programPaths).toEqual(PATHS);
  });

  it('followed until it answers, ends, or the wait runs out, and each is said with its log', async () => {
    const session = both();
    const call = started('C:\\logs\\whisper-server.log');
    await launchProgram(session, 'whisper-server', call);
    await launchProgram(session, 'rvc', started('C:\\logs\\rvc.log'));
    const states: Record<string, string[]> = {
      'whisper-server': ['starting', 'answering'],
      rvc: ['starting', 'stopped'],
    };
    const follow = vi.fn(async (_cmd: string, a?: Record<string, unknown>) =>
      states[String(a?.name)]!.shift(),
    );
    await followPrograms(session, follow, noSleep, noBricks);
    expect(session.programs['whisper-server']).toMatchObject({ said: 'whisper-server répond.', ok: true });
    expect(session.programs.rvc?.said).toBe('RVC s’est arrêté. Journal : C:\\logs\\rvc.log');
    expect(session.programs.rvc?.starting).toBeUndefined();

    await launchProgram(session, 'rvc', started('C:\\logs\\rvc.log'));
    session.programs.rvc!.left = 2;
    await followPrograms(
      session,
      vi.fn(async () => 'starting'),
      noSleep,
      noBricks,
    );
    expect(session.programs.rvc?.said).toBe('RVC ne répond toujours pas. Journal : C:\\logs\\rvc.log');
  });

  it('a second follow joins the one under way', async () => {
    const session = both();
    session.following = true;
    await launchProgram(session, 'rvc', started());
    const call = vi.fn();
    await followPrograms(session, call, noSleep, noBricks);
    expect(call).not.toHaveBeenCalled();
    expect(session.programs.rvc?.starting).toBe(true);
  });
});

describe('startAll', () => {
  it('the picked programs first, then the service, the programs followed meanwhile', async () => {
    const session = withService(true, 'D:/voix', {
      rvc: { ...READY.rvc, on: true, program: { args: [], launch: true } },
    });
    const order: string[] = [];
    const call = vi.fn(async (cmd: string) => {
      order.push(cmd);
      if (cmd === 'program_paths') return { rvc: 'D:/rvc.exe' };
      if (cmd === 'program_start') return { outcome: 'started', log: 'C:/logs/rvc.log' };
      if (cmd === 'program_state') return 'answering';
      if (cmd === 'voice_running') return ['--stt', 'faster:small'];
      return 'C:/logs/voix.log';
    });
    const answers = [false, true];
    await startAll(
      session,
      call,
      noSleep,
      async () => answers.shift() ?? true,
      async () => ({ stt: { kind: 'faster' as const, up: true }, rvc: { up: true } }),
    );
    expect(order[0]).toBe('program_paths');
    expect(order.indexOf('program_start')).toBeLessThan(order.indexOf('voice_start'));
    expect(session.programs.rvc?.said).toBe('RVC répond.');
    expect(session.voiceStatus).toBe('up');
  });
});

describe('one action on the service at a time', () => {
  it('a second start while one runs starts nothing', async () => {
    const session = withService(true);
    let release = () => {};
    const call = vi.fn(
      (cmd: string) =>
        new Promise<unknown>((r) => {
          if (cmd === 'voice_start') release = () => r('C:/logs/voix.log');
          else r(['--stt', 'faster:small']);
        }),
    );
    const answers = [false, true];
    const first = startVoice(session, async () => answers.shift() ?? true, call, noSleep, noBricks);
    expect(session.voiceBusy).toBe('check');
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('voice_start', expect.anything()));
    expect(await startVoice(session, async () => false, call, noSleep, noBricks)).toBe(false);
    expect(await restartVoice(session, async () => false, call, noSleep, noBricks)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(call.mock.calls.filter(([c]) => c === 'voice_start')).toHaveLength(1);
    expect(session.voiceBusy).toBeNull();
  });

  it('a service of the window that ends while starting is said at once, with its log', async () => {
    const session = withService(true);
    const call = vi.fn(async (cmd: string) => (cmd === 'voice_running' ? null : 'C:/logs/voix.log'));
    await startVoice(session, async () => false, call, noSleep, noBricks);
    expect(session.voiceStatus).toBe('down');
    expect(session.voiceSaid).toBe('Le service voix s’est arrêté au démarrage. Journal : C:/logs/voix.log');
    expect(session.voiceArgs).toBeNull();
  });
});
