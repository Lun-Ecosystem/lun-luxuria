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
      folder: 'D:\voix',
      stt: {
        kind: 'whisper-server',
        model: 'small',
        url: 'http://127.0.0.1:8080',
        program: { path: '', args: [], launch: false },
      },
      piper: 'D:\v fr.onnx',
      rvc: {
        on: true,
        url: 'http://127.0.0.1:18888',
        gain: 1.5,
        program: { path: '', args: [], launch: false },
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
      program: { path: '', args: [], launch: false },
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

  it('fields already named are read as they are', () => {
    const service = { ...DEFAULTS.voice.service, piper: 'D:\v.onnx', args: ['--lang', 'en'] };
    expect(readSettings(JSON.stringify({ voice: { service } })).voice.service).toEqual(service);
  });
});
