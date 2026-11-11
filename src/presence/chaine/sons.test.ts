// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWav, writeWav } from '../../listen/replay.ts';
import type { Scenario } from '../scenario.ts';
import { couper, fichiers, nomDe, planDePartie, sonsDe, temoin } from './sons.ts';

/** A tone, never a voice: `ms` of sound at 0.5, with `blanc` ms of silence on each side. */
const ton = (ms: number, blanc = 0) => {
  const out = new Float32Array(((ms + 2 * blanc) * 16) | 0);
  for (let i = blanc * 16; i < (blanc + ms) * 16; i++) out[i] = 0.5 * Math.sin(i / 3);
  return out;
};

let dir: string;
let dits: string[];
const synth = (texte: string) => {
  dits.push(texte);
  return Promise.resolve(ton(texte.length * 10, 100));
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chaine-sons-'));
  await mkdir(join(dir, 'sons'));
  dits = [];
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
  it('takes the sound laid by hand first, its silences removed, and never synthesizes it', async () => {
    await writeFile(join(dir, 'sons', 'non.wav'), writeWav([ton(500, 200)]));
    const s = { ...base, personne: [{ a: 0, dit: 'Non.', duree: 300 }] };
    const [son] = (await sonsDe(s, dir, synth)).personne;
    expect(son).toMatchObject({ source: 'pose', duree: 500 });
    expect(dits).toEqual([]);
  });

  it('synthesizes, keeps the cache, and reads it the next time', async () => {
    const s = { ...base, personne: [{ a: 0, dit: 'Bonjour', duree: 300 }] };
    const first = (await sonsDe(s, dir, synth)).personne[0]!;
    // Longer than its `duree`: kept, with its real length.
    expect(first).toMatchObject({ source: 'synthese', duree: 70 });
    expect(await readdir(join(dir, 'sons', 'sapi'))).toHaveLength(1);
    const again = (await sonsDe(s, dir, synth)).personne[0]!;
    expect(again).toMatchObject({ source: 'cache', duree: 70 });
    expect(dits).toEqual(['Bonjour']);
  });

  it('never synthesizes a cough: without its sound, it says which file is missing', async () => {
    const s = { ...base, personne: [{ a: 0, dit: '(toux)', duree: 300 }] };
    expect((await sonsDe(s, dir, synth)).personne).toEqual([{ manque: 'son manquant : toux.wav' }]);
    expect(dits).toEqual([]);
  });

  it('cuts a noise to its duration, and says when bruit.wav is missing', async () => {
    const s = { ...base, bruits: [{ a: 0, duree: 200, voix: 0.9 }] };
    expect((await sonsDe(s, dir, synth)).bruits).toEqual([{ manque: 'son manquant : bruit.wav' }]);
    await writeFile(join(dir, 'sons', 'bruit.wav'), writeWav([ton(1000)]));
    const [bruit] = (await sonsDe(s, dir, synth)).bruits;
    expect(bruit).toMatchObject({ source: 'pose', duree: 200 });
  });

  it('synthesizes each piece around the silences, and inserts them', async () => {
    const s = {
      ...base,
      personne: [{ a: 0, dit: 'un deux trois quatre', duree: 1280, trous: [{ a: 640, duree: 300 }] }],
    };
    const son = (await sonsDe(s, dir, synth)).personne[0]!;
    expect(dits).toEqual(['un deux', 'trois quatre']);
    // 70 ms, 300 ms of silence, 120 ms.
    expect(son).toMatchObject({ source: 'synthese', duree: 490 });
    if (!('samples' in son)) throw new Error('no sound');
    expect(son.samples.subarray(70 * 16 + 10, 370 * 16 - 10).every((x) => x === 0)).toBe(true);
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
    const sons = await sonsDe(s, dir, synth);
    const plan = planDePartie(s, sons);
    expect(plan).toEqual({
      nom: 'essai',
      poses: [
        { son: 0, de: 'parole', numero: 1, duree: 20, a: 320 },
        { son: 1, de: 'parole', numero: 2, duree: 40, apres: { joue: 1, ms: 1000 } },
        { son: 2, de: 'bruit', numero: 1, duree: 100, a: 50 },
      ],
      gestes: [{ geste: 'silence', apres: { joue: 1, phrase: 1, ms: 1000 } }],
      reponses: [{ si: 'un', phrases: ['Oui.'] }],
    });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    // The files served under /banc/sons/<n>.wav, in the same numbers.
    expect(fichiers(sons).map((f) => Math.round(readWav(f).length / 16))).toEqual([20, 40, 100]);
  });

  it('is not played when a sound is missing, and says why', async () => {
    const sons = await sonsDe(s, dir, synth);
    expect(planDePartie(s, sons)).toEqual({ nom: 'essai', manque: ['son manquant : bruit.wav'] });
  });
});

describe('temoin', () => {
  it('lays every sound at its instant after the opening wait, in one WAV', async () => {
    await writeFile(join(dir, 'sons', 'un.wav'), writeWav([ton(100)]));
    const s = { ...base, personne: [{ a: 200, dit: 'Un', duree: 100 }], jusqua: 1000 };
    const wav = readWav(temoin(s, await sonsDe(s, dir, synth), 500));
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
