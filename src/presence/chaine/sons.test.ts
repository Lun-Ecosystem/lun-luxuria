// @vitest-environment node
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWav, writeWav } from '../../listen/replay.ts';
import type { Scenario } from '../scenario.ts';
import {
  couper,
  fichiers,
  locuteurDe,
  nomDe,
  planDePartie,
  sonsDe,
  synthPiper,
  synthSapi,
  synthWinRT,
  temoin,
  voixDe,
  type SonDe,
  type Synth,
  type Voix,
} from './sons.ts';

// No child is ever launched here: the launcher's own test sets what `spawn` returns.
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

/** A tone, never a voice: `ms` of sound at 0.5, with `blanc` ms of silence on each side. */
const ton = (ms: number, blanc = 0) => {
  const out = new Float32Array(((ms + 2 * blanc) * 16) | 0);
  for (let i = blanc * 16; i < (blanc + ms) * 16; i++) out[i] = 0.5 * Math.sin(i / 3);
  return out;
};

let dir: string;
let dits: string[];
let dossiers: string[];
/** 10 ms of tone per character, with 300 ms of silence on each side: more than the margin. */
const synth: Synth = (texte, dossier) => {
  dits.push(texte);
  dossiers.push(dossier);
  return Promise.resolve(ton(texte.length * 10, 300));
};
const hortense: Voix = { nom: 'hortense', synth };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chaine-sons-'));
  await mkdir(join(dir, 'sons'));
  dits = [];
  dossiers = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const base: Scenario = {
  nom: 'essai',
  source: '',
  apport: '',
  mecanismes: ['ecoute'],
  personne: [],
  attendus: [],
};

describe('nomDe', () => {
  it('lowers, strips accents and joins words by dashes', () => {
    expect(nomDe('Et aussi la météo de demain')).toBe('et-aussi-la-meteo-de-demain');
    expect(nomDe('(toux)')).toBe('toux');
    expect(nomDe("  Non, c'est ça !  ")).toBe('non-c-est-ca');
  });
});

describe('couper', () => {
  it('cuts at the word nearest each silence', () => {
    // 640 ms of 1280: the middle of the text.
    expect(couper('un deux trois quatre', [{ a: 640, duree: 300 }], 1280)).toEqual([
      'un deux',
      'trois quatre',
    ]);
    expect(couper('un deux trois quatre', [{ a: 100, duree: 300 }], 1280)).toEqual([
      'un',
      'deux trois quatre',
    ]);
  });
  it('drops a silence that has no word left to cut at', () => {
    expect(couper('seul', [{ a: 600, duree: 300 }], 1280)).toEqual(['seul']);
  });
});

describe('sonsDe', () => {
  it('takes the sound laid by hand first, trimmed to 100 ms of margin, and never synthesizes it', async () => {
    await writeFile(join(dir, 'sons', 'non.wav'), writeWav([ton(500, 200)]));
    const s = { ...base, personne: [{ a: 0, dit: 'Non.', duree: 300 }] };
    const [son] = (await sonsDe(s, dir, hortense, true)).personne;
    expect(son).toMatchObject({ source: 'pose:non.wav', duree: 700 });
    expect(dits).toEqual([]);
  });

  it('ignores a speech laid by hand without `poses`: the voice says it', async () => {
    await writeFile(join(dir, 'sons', 'non.wav'), writeWav([ton(500, 200)]));
    const s = { ...base, personne: [{ a: 0, dit: 'Non.', duree: 300 }] };
    const [son] = (await sonsDe(s, dir, hortense, false)).personne;
    expect(son).toMatchObject({ source: 'synthese:hortense', duree: 240 });
    expect(dits).toEqual(['Non.']);
  });

  it('takes a click in the leading silence for silence: the sound starts 100 ms before the voice', async () => {
    // A click of a few samples at 33 ms (as loud as a recording's, -34 dB), silence, then 300 ms of tone at 500 ms;
    // another click after it.
    const x = new Float32Array(1000 * 16);
    x.set(ton(300), 500 * 16);
    x.set([0.02, -0.02, 0.015], 33 * 16);
    x.set([0.02, -0.02, 0.015], 950 * 16);
    await writeFile(join(dir, 'sons', 'non.wav'), writeWav([x]));
    const s = { ...base, personne: [{ a: 0, dit: 'Non.', duree: 300 }] };
    const [son] = (await sonsDe(s, dir, hortense, true)).personne;
    expect(son).toMatchObject({ source: 'pose:non.wav', duree: 500 });
  });

  it('keeps the margin within the sound, and a silent sound empty', async () => {
    await writeFile(join(dir, 'sons', 'non.wav'), writeWav([ton(500, 30)]));
    await writeFile(join(dir, 'sons', 'oui.wav'), writeWav([new Float32Array(500 * 16)]));
    const s = {
      ...base,
      personne: [
        { a: 0, dit: 'Non.', duree: 300 },
        { a: 1000, dit: 'Oui.', duree: 300 },
      ],
    };
    const [non, oui] = (await sonsDe(s, dir, hortense, true)).personne;
    expect(non).toMatchObject({ duree: 560 });
    expect(oui).toMatchObject({ duree: 0 });
  });

  it("keeps Hortense's cache, raw, under today's key and folder, and trims it at each reading", async () => {
    const s = { ...base, personne: [{ a: 0, dit: 'Bonjour', duree: 300 }] };
    const first = (await sonsDe(s, dir, hortense, true)).personne[0]!;
    // Longer than its `duree`: kept, with its real length.
    expect(first).toMatchObject({ source: 'synthese:hortense', duree: 270 });
    const cle = createHash('sha256').update('sapi-hortense-16k\nBonjour').digest('hex').slice(0, 16);
    const brut = readWav(await readFile(join(dir, 'sons', 'sapi', `${cle}.wav`)));
    expect(brut.length / 16).toBe(670);
    const again = (await sonsDe(s, dir, hortense, true)).personne[0]!;
    expect(again).toMatchObject({ source: 'cache:hortense', duree: 270 });
    expect(dits).toEqual(['Bonjour']);
  });

  it('keeps a cache per voice, keyed by its name, in a folder without ":"', async () => {
    const pierre: Voix = { nom: 'piper:fr_FR-upmc-medium#pierre', synth };
    const s = { ...base, personne: [{ a: 0, dit: 'Bonjour', duree: 300 }] };
    const [son] = (await sonsDe(s, dir, pierre, true)).personne;
    expect(son).toMatchObject({ source: 'synthese:piper:fr_FR-upmc-medium#pierre', duree: 270 });
    const dossier = join(dir, 'sons', 'piper-fr-fr-upmc-medium-pierre');
    // The synthesis gets the voice's folder, where Piper writes its file.
    expect(dossiers).toEqual([dossier]);
    const cle = createHash('sha256').update(`${pierre.nom}\nBonjour`).digest('hex').slice(0, 16);
    expect(await readdir(dossier)).toEqual([`${cle}.wav`]);
    expect((await sonsDe(s, dir, pierre, true)).personne[0]).toMatchObject({ source: `cache:${pierre.nom}` });
    // Another voice does not take it.
    await sonsDe(s, dir, hortense, true);
    expect(dits).toEqual(['Bonjour', 'Bonjour']);
    expect((await readdir(join(dir, 'sons'))).filter((d) => d.includes(':'))).toEqual([]);
  });

  it('never synthesizes a cough: without its sound, it says which file is missing', async () => {
    const s = { ...base, personne: [{ a: 0, dit: '(toux)', duree: 300 }] };
    expect((await sonsDe(s, dir, hortense, true)).personne).toEqual([{ manque: 'son manquant : toux.wav' }]);
    expect(dits).toEqual([]);
  });

  /** Sound in each of its ms: no silence at its head, nor anywhere. */
  const plein = (son: SonDe | undefined) => {
    if (!son || !('samples' in son)) return false;
    for (let i = 0; i < son.samples.length; i += 16)
      if (!son.samples.subarray(i, i + 16).some((x) => Math.abs(x) >= 0.01)) return false;
    return true;
  };

  it('cuts a cough laid by hand to its duration of sound, with or without `poses`, and refuses it shorter', async () => {
    // 200 ms of silence at its head: none of it is kept, the 450 ms are of sound.
    await writeFile(join(dir, 'sons', 'toux.wav'), writeWav([ton(600, 200)]));
    const s = (duree: number) => ({ ...base, personne: [{ a: 0, dit: '(toux)', duree }] });
    for (const poses of [true, false]) {
      const [toux] = (await sonsDe(s(450), dir, hortense, poses)).personne;
      expect(toux).toMatchObject({ source: 'pose:toux.wav', duree: 450 });
      expect(plein(toux)).toBe(true);
    }
    // 600 ms of sound, and no margin on either side.
    await expect(sonsDe(s(900), dir, hortense, true)).rejects.toThrow(/toux\.wav.*600.*900/);
    // 400 ms of sound, then silence: its end's silence does not make up a duration of 450.
    await writeFile(join(dir, 'sons', 'toux.wav'), writeWav([ton(400, 200)]));
    await expect(sonsDe(s(450), dir, hortense, true)).rejects.toThrow(/toux\.wav.*400.*450/);
    expect(dits).toEqual([]);
  });

  it('cuts a noise to its duration of sound, refuses it shorter, and says when bruit.wav is missing', async () => {
    const s = (duree: number) => ({ ...base, bruits: [{ a: 0, duree, voix: 0.9 }] });
    expect((await sonsDe(s(200), dir, hortense, true)).bruits).toEqual([
      { manque: 'son manquant : bruit.wav' },
    ]);
    await writeFile(join(dir, 'sons', 'bruit.wav'), writeWav([ton(1000, 200)]));
    for (const poses of [true, false]) {
      const [bruit] = (await sonsDe(s(200), dir, hortense, poses)).bruits;
      expect(bruit).toMatchObject({ source: 'pose:bruit.wav', duree: 200 });
      expect(plein(bruit)).toBe(true);
    }
    // 300 ms of sound, its silences aside, would play shorter than 450: refused, as a cough is.
    await writeFile(join(dir, 'sons', 'bruit.wav'), writeWav([ton(300, 200)]));
    await expect(sonsDe(s(450), dir, hortense, true)).rejects.toThrow(/bruit\.wav.*300.*450/);
  });

  it('synthesizes each piece around the silences, each with its margin, and inserts them', async () => {
    const s = {
      ...base,
      personne: [{ a: 0, dit: 'un deux trois quatre', duree: 1280, trous: [{ a: 640, duree: 300 }] }],
    };
    const son = (await sonsDe(s, dir, hortense, true)).personne[0]!;
    expect(dits).toEqual(['un deux', 'trois quatre']);
    // 100 + 70 + 100 ms, 300 ms of silence, 100 + 120 + 100 ms.
    expect(son).toMatchObject({ source: 'synthese:hortense', duree: 890 });
    if (!('samples' in son)) throw new Error('no sound');
    expect(son.samples.subarray(170 * 16 + 10, 670 * 16 - 10).every((x) => x === 0)).toBe(true);
  });
});

describe('voixDe', () => {
  const upmc = () => join(dir, 'fr_FR-upmc-medium.onnx');
  const siwis = (d: string) => join(d, 'fr_FR-siwis-medium.onnx');
  const tts = () => `piper:${siwis(join(dir, 'service'))}`;
  const exe = () => join(dir, 'piper.exe');
  beforeEach(() =>
    writeFile(`${upmc()}.json`, JSON.stringify({ speaker_id_map: { jessica: 0, pierre: 1 } })),
  );

  it("reads Windows' voices and a Piper voice by its two paths, named without them", () => {
    expect(voixDe('hortense', tts())).toEqual({ nom: 'hortense', synth: synthSapi });
    expect(voixDe('julie', tts()).nom).toBe('julie');
    expect(voixDe('paul', tts()).nom).toBe('paul');
    expect(voixDe(`piper:${exe()}|${upmc()}#pierre`, tts()).nom).toBe('piper:fr_FR-upmc-medium#pierre');
    expect(voixDe(`piper:${exe()}|${upmc()}`, tts()).nom).toBe('piper:fr_FR-upmc-medium');
    // The speaker follows the last "#", after ".onnx": one in a folder is part of the path.
    expect(voixDe(`piper:${exe()}|${join(dir, 'a#b', 'fr_FR-gilles-low.onnx')}`, tts()).nom).toBe(
      'piper:fr_FR-gilles-low',
    );
  });

  it('refuses her voice: the same model and the same speaker as CHAINE_TTS', () => {
    expect(() => voixDe(`piper:${exe()}|${siwis(dir)}`, tts())).toThrow(/sa voix/);
    // Hers speaks with the model's first speaker.
    const sienne = `piper:${upmc()}`;
    expect(() => voixDe(`piper:${exe()}|${upmc()}`, sienne)).toThrow(/sa voix/);
    expect(() => voixDe(`piper:${exe()}|${upmc()}#jessica`, sienne)).toThrow(/sa voix/);
    expect(voixDe(`piper:${exe()}|${upmc()}#pierre`, sienne).nom).toBe('piper:fr_FR-upmc-medium#pierre');
  });

  it('refuses an unknown entry, a Piper voice without "|", and a speaker its model does not have', () => {
    expect(() => voixDe('zira', tts())).toThrow(/zira/);
    expect(() => voixDe(`piper:${upmc()}#pierre`, tts())).toThrow(/\|/);
    expect(() => voixDe(`piper:${exe()}|${join(dir, 'modele')}`, tts())).toThrow(/\.onnx/);
    expect(() => voixDe(`piper:${exe()}|${upmc()}#marc`, tts())).toThrow(/marc/);
  });

  it("reads the speaker's number in the model's .onnx.json", () => {
    expect([locuteurDe(upmc(), 'jessica'), locuteurDe(upmc(), 'pierre')]).toEqual([0, 1]);
    expect(() => locuteurDe(upmc(), 'constructor')).toThrow(/constructor/);
  });

  it('takes the name of a Windows voice from its fixed list only', () => {
    expect(() => synthWinRT('Zira' as 'Julie')).toThrow(/Zira/);
  });
});

describe('synthPiper', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects past its limit once the killed child has closed, not before: its WAV is removed after it', async () => {
    vi.useFakeTimers();
    const enfant = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    spawn.mockReturnValueOnce(enfant);
    const dit = synthPiper(join(dir, 'piper.exe'), join(dir, 'voix.onnx'))('Bonjour.', dir);
    const fini = vi.fn();
    dit.then(fini, fini);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(enfant.kill).toHaveBeenCalled();
    vi.useRealTimers();
    // Longer than a removal of a file that is not there.
    await new Promise((r) => setTimeout(r, 100));
    expect(fini).not.toHaveBeenCalled();
    enfant.emit('close', null);
    await expect(dit).rejects.toThrow('rien après 30 s, arrêté');
  });
});

describe('planDePartie', () => {
  const s: Scenario = {
    ...base,
    personne: [
      { a: 320, dit: 'Un', duree: 300 },
      { apres: { joue: 1, ms: 1000 }, dit: 'Deux', duree: 300 },
    ],
    bruits: [{ a: 50, duree: 100, voix: 0.9 }],
    gestes: [{ geste: 'silence', apres: { joue: 1, phrase: 1, ms: 1000 } }],
    modele: { reponses: [{ si: 'un', phrases: ['Oui.'] }] },
  };

  it('gives data only: each sound by its number, at its instant or its anchor, unresolved', async () => {
    await writeFile(join(dir, 'sons', 'bruit.wav'), writeWav([ton(1000)]));
    const sons = await sonsDe(s, dir, hortense, true);
    const plan = planDePartie(s, sons);
    expect(plan).toEqual({
      nom: 'essai',
      poses: [
        { son: 0, de: 'parole', numero: 1, duree: 220, a: 320 },
        { son: 1, de: 'parole', numero: 2, duree: 240, apres: { joue: 1, ms: 1000 } },
        { son: 2, de: 'bruit', numero: 1, duree: 100, a: 50 },
      ],
      gestes: [{ geste: 'silence', apres: { joue: 1, phrase: 1, ms: 1000 } }],
      reponses: [{ si: 'un', phrases: ['Oui.'] }],
    });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    // The files served under /banc/sons/<n>.wav, in the same numbers.
    expect(fichiers(sons).map((f) => Math.round(readWav(f).length / 16))).toEqual([220, 240, 100]);
  });

  it('is not played when a sound is missing, and says why', async () => {
    const sons = await sonsDe(s, dir, hortense, true);
    expect(planDePartie(s, sons)).toEqual({ nom: 'essai', manque: ['son manquant : bruit.wav'] });
  });
});

describe('temoin', () => {
  it('lays every sound at its instant after the opening wait, in one WAV', async () => {
    await writeFile(join(dir, 'sons', 'un.wav'), writeWav([ton(100)]));
    const s = { ...base, personne: [{ a: 200, dit: 'Un', duree: 100 }], jusqua: 1000 };
    const wav = readWav(temoin(s, await sonsDe(s, dir, hortense, true), 500));
    expect(wav.length).toBe(1500 * 16);
    expect(wav.subarray(0, 700 * 16).every((x) => x === 0)).toBe(true);
    expect(wav.subarray(700 * 16, 800 * 16).some((x) => x !== 0)).toBe(true);
    expect(wav.subarray(800 * 16).every((x) => x === 0)).toBe(true);
  });

  it('refuses an anchored speech: the witness plays absolute instants only', async () => {
    const s: Scenario = { ...base, personne: [{ apres: { envoi: 1, ms: 0 }, dit: 'Un', duree: 100 }] };
    expect(() => temoin(s, { personne: [], bruits: [] })).toThrow(/ancr/);
  });
});
