import { describe, expect, it } from 'vitest';
import { DEFAULTS, readSettings } from './settings.ts';

describe('readSettings', () => {
  it('an older setting without the mute shortcut takes its default, and keeps the rest', () => {
    const s = readSettings(JSON.stringify({ display: { screen: 'DISPLAY2', shortcut: 'Alt+L' } }));
    expect(s.display).toEqual({
      screen: 'DISPLAY2',
      shortcut: 'Alt+L',
      muteShortcut: 'Control+Shift+M',
      startWithWindows: false,
    });
  });
});

describe('starting with Windows', () => {
  it('is off by default, also for an older setting', () => {
    expect(readSettings(JSON.stringify({ display: { shortcut: 'Alt+L' } })).display.startWithWindows).toBe(
      false,
    );
  });
});

describe('the voice service', () => {
  it('older argument lines become named fields; what is not known stays as typed', () => {
    const s = readSettings(
      JSON.stringify({
        voice: {
          service: {
            launch: true,
            folder: 'D:\voix',
            args: [
              '--stt',
              'whisper-server:http://127.0.0.1:8080',
              '--tts',
              'piper:D:\v fr.onnx',
              '--rvc',
              'http://127.0.0.1:18888',
              '--rvc-gain',
              '1.5',
              '--lang',
              'en',
            ],
          },
        },
      }),
    );
    expect(s.voice.service).toEqual({
      launch: true,
      formerFolder: 'D:\voix',
      stt: {
        kind: 'whisper-server',
        model: 'small',
        url: 'http://127.0.0.1:8080',
        program: { args: [], launch: false },
      },
      piper: 'D:\v fr.onnx',
      rvc: {
        on: true,
        url: 'http://127.0.0.1:18888',
        gain: 1.5,
        program: { args: [], launch: false },
      },
      args: ['--lang', 'en'],
    });
  });

  it('a local model by its name; without RVC, it stays off', () => {
    const s = readSettings(JSON.stringify({ voice: { service: { args: ['--stt', 'faster:medium'] } } }));
    expect(s.voice.service.stt).toEqual({
      kind: 'faster',
      model: 'medium',
      url: 'http://127.0.0.1:8080',
      program: { args: [], launch: false },
    });
    expect(s.voice.service.rvc.on).toBe(false);
    expect(s.voice.service.args).toEqual([]);
  });

  it('a flag written with = or on one line is read too; an address is never another flag', () => {
    const s = readSettings(
      JSON.stringify({
        voice: {
          service: { args: ['--stt=faster:medium', '--tts piper:D:/v.onnx', '--rvc', '--lang', 'en'] },
        },
      }),
    );
    expect(s.voice.service.stt.model).toBe('medium');
    expect(s.voice.service.piper).toBe('D:/v.onnx');
    expect(s.voice.service.rvc.on).toBe(false);
    expect(s.voice.service.args).toEqual(['--rvc', '--lang', 'en']);
  });

  it('an unknown transcription comes back to the local one', () => {
    const service = { ...DEFAULTS.voice.service, stt: { ...DEFAULTS.voice.service.stt, kind: 'autre' } };
    expect(readSettings(JSON.stringify({ voice: { service } })).voice.service.stt.kind).toBe('faster');
  });

  it('saved before its programs, or with a program that is not one, each takes its defaults', () => {
    const before = { kind: 'whisper-server', model: 'small', url: 'http://127.0.0.1:9000' };
    const service = {
      ...DEFAULTS.voice.service,
      stt: before,
      rvc: { ...DEFAULTS.voice.service.rvc, program: null },
    };
    const read = readSettings(JSON.stringify({ voice: { service } })).voice.service;
    expect(read.stt).toEqual({ ...before, program: { args: [], launch: false } });
    expect(read.rvc.program).toEqual({ args: [], launch: false });
  });

  it('fields already named are read as they are', () => {
    const service = { ...DEFAULTS.voice.service, piper: 'D:\v.onnx', args: ['--lang', 'en'] };
    expect(readSettings(JSON.stringify({ voice: { service } })).voice.service).toEqual(service);
  });
});

describe('the service’s folder, which the window keeps now', () => {
  const service = (over: object) => readSettings(JSON.stringify({ voice: { service: over } })).voice.service;
  const lines = ['--stt', 'faster:small'];

  it('a default has no folder to send: only a reminder, empty', () => {
    expect(DEFAULTS.voice.service).not.toHaveProperty('folder');
    expect(DEFAULTS.voice.service.formerFolder).toBe('');
  });

  it('a folder saved with argument lines is the former folder, and no folder', () => {
    const read = service({ launch: true, folder: 'D:\\voix', args: lines });
    expect(read.formerFolder).toBe('D:\\voix');
    expect(read).not.toHaveProperty('folder');
  });

  it('a folder saved with named fields is the former folder too, kept at the next load', () => {
    const read = service({ ...DEFAULTS.voice.service, folder: 'D:\\voix', formerFolder: undefined });
    expect(read.formerFolder).toBe('D:\\voix');
    expect(read).not.toHaveProperty('folder');
    const again = readSettings(JSON.stringify({ voice: { service: read } })).voice.service;
    expect(again.formerFolder).toBe('D:\\voix');
    expect(again).not.toHaveProperty('folder');
  });

  it('a former folder already saved wins; an empty or odd one gives way to the folder, then to nothing', () => {
    const both = (formerFolder: unknown, folder: unknown = 'D:\\ancien') =>
      service({ ...DEFAULTS.voice.service, folder, formerFolder }).formerFolder;
    expect(both('D:\\voix')).toBe('D:\\voix');
    expect(both('')).toBe('D:\\ancien');
    expect(both(7)).toBe('D:\\ancien');
    expect(both('', '')).toBe('');
    expect(both('', 7)).toBe('');
    expect(readSettings(null).voice.service.formerFolder).toBe('');
  });
});

describe('the gain taken from older argument lines', () => {
  const gain = (value: string) =>
    readSettings(
      JSON.stringify({
        voice: { service: { args: ['--rvc', 'http://127.0.0.1:18888', '--rvc-gain', value] } },
      }),
    ).voice.service.rvc.gain;

  it('stays within 0 to 10, as the screen does: Rust refuses the rest', () => {
    expect(gain('1.5')).toBe(1.5);
    expect(gain('0')).toBe(0);
    expect(gain('10')).toBe(10);
    expect(gain('25')).toBe(10);
    expect(gain('-3')).toBe(0);
  });
});

describe('the body’s folder, which the window keeps now', () => {
  it('a default has no folder to send: only a reminder, empty', () => {
    expect(DEFAULTS.body).not.toHaveProperty('folder');
    expect(DEFAULTS.body.formerFolder).toBe('');
  });

  it('a folder saved by an older page is read as the former folder, and kept at the next load', () => {
    const s = readSettings(JSON.stringify({ body: { level: 'images', folder: 'C:\\corps' } }));
    expect(s.body.formerFolder).toBe('C:\\corps');
    expect(s.body).not.toHaveProperty('folder');
    const again = readSettings(JSON.stringify(s));
    expect(again.body.formerFolder).toBe('C:\\corps');
    expect(again.body).not.toHaveProperty('folder');
  });

  it('a former folder already saved wins over nothing, and an empty or odd folder gives an empty reminder', () => {
    expect(readSettings(JSON.stringify({ body: { formerFolder: 'C:\\corps' } })).body.formerFolder).toBe(
      'C:\\corps',
    );
    expect(readSettings(JSON.stringify({ body: { folder: '' } })).body.formerFolder).toBe('');
    expect(readSettings(JSON.stringify({ body: { folder: 7 } })).body.formerFolder).toBe('');
    expect(readSettings(null).body.formerFolder).toBe('');
  });

  it('both saved: a former folder that is not empty wins, an empty one gives way to the folder', () => {
    const both = (formerFolder: unknown) =>
      readSettings(JSON.stringify({ body: { folder: 'C:\\ancien', formerFolder } })).body;
    expect(both('C:\\corps').formerFolder).toBe('C:\\corps');
    expect(both('').formerFolder).toBe('C:\\ancien');
    expect(both(7).formerFolder).toBe('C:\\ancien');
    expect(both('C:\\corps')).not.toHaveProperty('folder');
  });
});

describe('the wait before she resumes her voice', () => {
  it('is 300 ms by default, also for an older setting that has none', () => {
    expect(DEFAULTS.bargeIn.resumeMs).toBe(300);
    const older = readSettings(JSON.stringify({ bargeIn: { on: true, mode: 'soft', holdMs: 500 } }));
    expect(older.bargeIn).toEqual({ on: true, mode: 'soft', holdMs: 500, resumeMs: 300 });
  });

  it('keeps a value the person set, 0 included', () => {
    expect(readSettings(JSON.stringify({ bargeIn: { resumeMs: 0 } })).bargeIn.resumeMs).toBe(0);
    expect(readSettings(JSON.stringify({ bargeIn: { resumeMs: 800 } })).bargeIn.resumeMs).toBe(800);
  });
});
