// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ENDPOINT_DEFAULTS, levelToVoice } from './endpoint.ts';
import { banc, dansLeBruit, ecouter, lireListe, NIVEAUX, voixDuBanc, type Ecoute } from './gestes.ts';
import { FRAME_MS, noise, replay, writeWav } from './replay.ts';
import { loadSilero, SileroVoice } from './vad.ts';
import type { Voix } from '../presence/chaine/sons.ts';
import { DEFAULTS } from '../settings.ts';
import { transcribe } from '../voice.ts';

const byLevel = (frame: Float32Array) => levelToVoice(frame, DEFAULTS.endOfSpeech.floorDb);
const bonne = { id: 'oui', dit: 'oui', attendu: 'accepter', prises: 1 };

describe('the list of the bench of gestures', () => {
  it('is read, and a line without its text or with another expected gesture is refused, by its rank', () => {
    const lignes = [
      { id: 'oui', dit: 'oui', attendu: 'accepter', prises: 5 },
      { id: 'toux-courte', dit: "toux d'au moins 300 ms", attendu: 'aucun', prises: 2, parole: false },
    ];
    expect(lireListe(JSON.stringify(lignes))).toEqual(lignes);

    const fautes: [unknown, RegExp][] = [
      [{ ...bonne, dit: undefined }, /dit/],
      [{ ...bonne, dit: ' ' }, /dit/],
      [{ ...bonne, attendu: 'valider' }, /attendu/],
      [{ ...bonne, id: 'Oui' }, /id/],
      [{ ...bonne, id: 'ok' }, /id/],
      [{ ...bonne, prises: 0 }, /prises/],
      [{ ...bonne, prises: 1.5 }, /prises/],
      [{ ...bonne, parole: 'non' }, /parole/],
      [{ ...bonne, motprive: 'x' }, /clé inconnue/],
    ];
    for (const [faute, raison] of fautes) {
      const essai = () => lireListe(JSON.stringify([{ ...bonne, id: 'ok' }, faute]));
      expect(essai).toThrow(/ligne 2/);
      expect(essai).toThrow(raison);
    }
    expect(() => lireListe('{}')).toThrow(/tableau/);
  });

  it('never says what a line holds, not even a key, nor what an unreadable list holds', () => {
    expect(() => lireListe(JSON.stringify([{ ...bonne, motprive: 'x' }]))).not.toThrow(/motprive/);
    const illisible = () => lireListe('[{"id": motprive}]');
    expect(illisible).toThrow(/mots\.json/);
    expect(illisible).not.toThrow(/motprive/);
  });
});

describe('the voices of the bench', () => {
  it('refuse hers, the voice of the service in use, not of this one', () => {
    const p = (onnx: string) => `piper:${join('p', 'piper.exe')}|${join('p', onnx)}`;
    const siwis = p('fr_FR-siwis-medium.onnx');
    const x = `piper:${join('ailleurs', 'fr_FR-x.onnx')}`;
    // Without CHAINE_TTS, hers is siwis, as for the chain.
    expect(() => voixDuBanc(siwis, undefined)).toThrow(/sa voix/);
    expect(() => voixDuBanc(`hortense,${p('fr_FR-x.onnx')}`, x)).toThrow(/sa voix/);
    expect(voixDuBanc(`hortense,${siwis}`, x).map((v) => v.nom)).toEqual([
      'hortense',
      'piper:fr_FR-siwis-medium',
    ]);
  });
});

const dossiers: string[] = [];
const temp = () => (dossiers.push(mkdtempSync(join(tmpdir(), 'gestes-'))), dossiers.at(-1)!);
afterAll(() => dossiers.forEach((d) => rmSync(d, { recursive: true, force: true })));

const jsonl = (dir: string) =>
  readFileSync(join(dir, 'gestes.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/** A folder of the bench: its list, and a take of noise for each one asked. */
function dossier(lignes: unknown[], prises: string[]): string {
  const dir = temp();
  writeFileSync(join(dir, 'mots.json'), JSON.stringify(lignes));
  mkdirSync(join(dir, 'prises'));
  for (const p of prises) writeFileSync(join(dir, 'prises', p), writeWav([noise(1, 0.2).subarray(0, 8000)]));
  return dir;
}

describe('the takes', () => {
  it('a missing one is named, and nothing is played', async () => {
    const synth = vi.fn(async () => noise(1, 0.2));
    const ouvrir = vi.fn();
    const dir = dossier(
      [
        { ...bonne, prises: 2 },
        { id: 'mmh', dit: 'mmh', attendu: 'aucun', prises: 1, parole: false },
      ],
      ['oui-1.wav'],
    );
    await expect(banc(dir, [{ nom: 'fausse', synth }], 'faux', ouvrir)).rejects.toThrow(
      /oui-2\.wav, mmh-1\.wav/,
    );
    expect(synth).not.toHaveBeenCalled();
    expect(ouvrir).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'gestes.jsonl'))).toBe(false);

    // Without a list, it says so.
    await expect(banc(temp(), [], 'faux', ouvrir)).rejects.toThrow(/mots\.json/);
  });

  it('an unreadable one is named, and nothing is played', async () => {
    const ouvrir = vi.fn();
    const dir = dossier([bonne], []);
    writeFileSync(join(dir, 'prises', 'oui-1.wav'), 'pas un son');
    await expect(banc(dir, [], 'faux', ouvrir)).rejects.toThrow(/oui-1\.wav/);
    expect(ouvrir).not.toHaveBeenCalled();
  });

  it('a witness whose name ends in capitals is played all the same', async () => {
    const dir = dossier([], []);
    mkdirSync(join(dir, 'temoins'));
    writeFileSync(join(dir, 'temoins', 'TOUX.WAV'), writeWav([new Float32Array(1600)]));
    const rien: Ecoute = { ecoute: [], transcriptions: [], envoye: [], repris: [] };
    await banc(dir, [], 'faux', async () => async () => rien);
    expect(jsonl(dir).map((l) => [l['id'], l['source']])).toContainEqual(['TOUX', 'temoin']);
  });
});

describe('the noise of the bench', () => {
  it('and its three levels are the same from one draw to the next', () => {
    const son = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 10) / 4);
    const avant = son.slice();
    const une = NIVEAUX.map((db) => dansLeBruit(son, db));
    const autre = NIVEAUX.map((db) => dansLeBruit(son, db));
    expect(NIVEAUX).toEqual([-6, 0, 6]);
    expect(une).toEqual(autre);
    expect(son).toEqual(avant);

    // The noise alone, level by level: 6 dB is twice its amplitude.
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v, i) => s + (v - son[i]!) ** 2, 0) / x.length);
    const [bas, fixe, haut] = une.map(rms) as [number, number, number];
    expect(fixe).toBeGreaterThan(0);
    expect(haut / fixe).toBeCloseTo(10 ** (6 / 20), 3);
    expect(bas / fixe).toBeCloseTo(10 ** (-6 / 20), 3);
  });

  it('is laid on each sound at the level of its line', async () => {
    const dir = dossier(
      [{ id: 'mmh', dit: 'mmh', attendu: 'aucun', prises: 1, parole: false }],
      ['mmh-1.wav'],
    );
    const recus: Float32Array[] = [];
    const rien: Ecoute = { ecoute: [], transcriptions: [], envoye: [], repris: [] };
    await banc(dir, [], 'faux', async () => async (s) => (recus.push(s), rien));
    const [propre, ...bruits] = recus.slice(0, 4) as [Float32Array, ...Float32Array[]];
    // Sample by sample, without a diff of 24 000 numbers when it fails.
    const pareil = (a: Float32Array, b: Float32Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    expect(bruits.map((b, k) => pareil(b, dansLeBruit(propre, NIVEAUX[k]!)))).toEqual([true, true, true]);
    expect(pareil(bruits[1]!, propre)).toBe(false);
  });
});

// Nobody's voice: half a second of noise the level takes for a word, between two silences.
const mot = Float32Array.from([
  ...new Float32Array(8000),
  ...noise(1, 0.2).subarray(0, 8000),
  ...new Float32Array(8000),
]);

describe('a word through a new conversation', () => {
  it('is transcribed from the sound of its pause, shorter than its end by about silenceMs - pauseMs', async () => {
    const recus: number[] = [];
    const e = await ecouter(mot, byLevel, async (audio) => {
      recus.push(audio.length);
      return { text: 'Oui.', confidence: 0.8 };
    });
    let fin = 0;
    await replay(
      mot,
      byLevel,
      ENDPOINT_DEFAULTS,
      (ev) => void (ev.type === 'end' && (fin = ev.audio.length)),
    );

    expect(e.ecoute).toEqual(['start', 'held', 'pause', 'end']);
    expect(recus).toHaveLength(1);
    expect(e.transcriptions).toMatchObject([
      { texte: 'Oui.', confiance: 0.8, son: Math.round(recus[0]! / 16) },
    ]);
    const { silenceMs, pauseMs } = DEFAULTS.endOfSpeech;
    expect(Math.abs((fin - recus[0]!) / 16 - (silenceMs - pauseMs))).toBeLessThanOrEqual(FRAME_MS);
    expect(e.envoye).toEqual([{ texte: 'Oui.', confiance: 0.8 }]);
    expect(e.repris).toEqual([]);
  });

  it('notes what withdraw takes back: a try sent at a pause, and the sentence goes on', async () => {
    // Two half seconds of noise, half a second apart: longer than the pause, shorter than the end.
    const repris = Float32Array.from([...mot, ...mot.subarray(8000)]);
    const textes = ['Un.', 'Un, deux.'];
    const e = await ecouter(repris, byLevel, async () => ({ text: textes.shift()!, confidence: 0.8 }));
    expect(e.ecoute).toContain('resume');
    expect(e.envoye.map((x) => x.texte)).toEqual(['Un.', 'Un, deux.']);
    expect(e.repris).toEqual([{ texte: 'Un.', confiance: 0.8 }]);
  });

  it('waits for every transcription on its way before it gives the sound back', async () => {
    const lente = () =>
      new Promise<{ text: string; confidence: number }>((r) =>
        setTimeout(() => r({ text: 'Oui.', confidence: 0.8 }), 100),
      );
    const e = await ecouter(mot, byLevel, lente);
    expect(e.transcriptions).toMatchObject([{ texte: 'Oui.', verdict: 'pour_elle' }]);
    expect(e.envoye).toEqual([{ texte: 'Oui.', confiance: 0.8 }]);
  });

  it('keeps the verdict of every try of a long sound, past twenty sentences', async () => {
    // A long witness: twenty-five times 0.3 s of noise and 0.8 s of silence.
    const une = Float32Array.from([...noise(1, 0.2).subarray(0, 4800), ...new Float32Array(12800)]);
    const long = new Float32Array(une.length * 25);
    for (let k = 0; k < 25; k++) long.set(une, k * une.length);
    const e = await ecouter(long, byLevel, async () => ({ text: 'Oui.', confidence: 0.8 }));
    expect(e.transcriptions).toHaveLength(25);
    expect(e.transcriptions.filter((t) => 'verdict' in t && t.verdict === 'pour_elle')).toHaveLength(25);
  });

  it('a text the noise filter sets aside never reaches send, and its line says so', async () => {
    const dir = dossier([bonne], ['oui-1.wav']);
    const texte = "Sous-titres réalisés par la communauté d'Amara.org";
    const send = vi.fn();
    await banc(dir, [], 'faux', async () => async (samples) => {
      const e = await ecouter(samples, byLevel, async () => ({ text: texte, confidence: 0.4 }));
      if (e.envoye.length > 0) send();
      return e;
    });
    const [ligne] = readFileSync(join(dir, 'gestes.jsonl'), 'utf8').trim().split('\n');
    const lue = JSON.parse(ligne!) as Ecoute;
    expect(send).not.toHaveBeenCalled();
    expect(lue.envoye).toEqual([]);
    expect(lue.transcriptions).toMatchObject([{ texte, confiance: 0.4, verdict: 'bruit' }]);
  });

  it('the line carries the text and the confidence send received, as they were', async () => {
    const dir = dossier(
      [bonne, { id: 'mmh', dit: 'mmh', attendu: 'aucun', prises: 1, parole: false }],
      ['oui-1.wav', 'mmh-1.wav'],
    );
    mkdirSync(join(dir, 'temoins'));
    writeFileSync(join(dir, 'temoins', 'silence-1.wav'), writeWav([new Float32Array(16000)]));
    const fausse: Voix = { nom: 'fausse', synth: async () => noise(1, 0.2).subarray(0, 8000) };
    const n = await banc(
      dir,
      [fausse],
      'faux',
      async () => (samples) =>
        ecouter(samples, byLevel, async () => ({ text: ' Oui ?', confidence: 0.612345678901 })),
    );
    const lignes = jsonl(dir);
    const fin = lignes.pop()!;
    expect(n).toBe(lignes.length);
    expect(fin).toMatchObject({ fin: true, sons: n, echecs: 0, brique: 'faux', duree: expect.any(Number) });
    expect(lignes.map((l) => [l['id'], l['source'], l['condition'], l['niveau'], l['attendu']])).toEqual([
      ['oui', 'fausse', 'propre', undefined, 'accepter'],
      ['oui', 'fausse', 'bruit', 0, 'accepter'],
      ['oui', 'prise:1', 'propre', undefined, 'accepter'],
      ['mmh', 'prise:1', 'propre', undefined, 'aucun'],
      ['mmh', 'prise:1', 'bruit', -6, 'aucun'],
      ['mmh', 'prise:1', 'bruit', 0, 'aucun'],
      ['mmh', 'prise:1', 'bruit', 6, 'aucun'],
      ['silence-1', 'temoin', 'propre', undefined, 'aucun'],
      ['silence-1', 'temoin', 'bruit', -6, 'aucun'],
      ['silence-1', 'temoin', 'bruit', 0, 'aucun'],
      ['silence-1', 'temoin', 'bruit', 6, 'aucun'],
      ['nul', 'code', 'propre', undefined, 'aucun'],
      ['nul', 'code', 'bruit', -6, 'aucun'],
      ['nul', 'code', 'bruit', 0, 'aucun'],
      ['nul', 'code', 'bruit', 6, 'aucun'],
    ]);
    const premiere = lignes[0]!;
    expect(Object.keys(premiere).sort()).toEqual(
      [
        'attendu',
        'brique',
        'condition',
        'date',
        'ecoute',
        'envoye',
        'id',
        'repris',
        'source',
        'transcriptions',
      ].sort(),
    );
    expect(premiere['envoye']).toEqual([{ texte: ' Oui ?', confiance: 0.612345678901 }]);
    expect(premiere['brique']).toBe('faux');
  });
});

describe('a failed transcription', () => {
  it('makes its line a failure, as the conversation wrote it, counted at the end, and fails the command', async () => {
    const dir = dossier([bonne], ['oui-1.wav']);
    const panne = async (): Promise<never> => {
      throw new Error('le service voix ne répond pas');
    };
    await expect(banc(dir, [], 'faux', async () => (s) => ecouter(s, byLevel, panne))).rejects.toThrow(
      /sur 5 sons ont une transcription en échec/,
    );
    const lignes = jsonl(dir);
    const fin = lignes.pop()!;
    expect(lignes[0]).toMatchObject({
      id: 'oui',
      echec: true,
      transcriptions: [{ echec: 'le service voix ne répond pas' }],
      envoye: [],
    });
    expect(lignes[0]!['transcriptions']).not.toMatchObject([{ texte: expect.anything() }]);
    const echecs = lignes.filter((l) => l['echec'] === true).length;
    expect(echecs).toBeGreaterThan(0);
    expect(fin).toMatchObject({ fin: true, sons: 5, echecs, brique: 'faux', duree: expect.any(Number) });
  });
});

/**
 * The bench of gestures: `npm run gestes`. Every sound of `BANC_DIR/gestes`, kept out of the repository, through the
 * listening, a new conversation and the real transcription of the voice service it launches (`GESTES_STT`).
 */
const asked = import.meta.env.MODE === 'gestes';

const libre = () =>
  new Promise<number>((ok, ko) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
    s.on('error', ko);
  });
async function attendre(url: string, c: ChildProcess): Promise<void> {
  for (const fin = Date.now() + 180_000; Date.now() < fin; await new Promise((r) => setTimeout(r, 500))) {
    if (c.exitCode !== null) throw new Error(`${url} : son processus s'est arrêté (code ${c.exitCode})`);
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
  }
  throw new Error(`${url} ne répond pas après 180 s`);
}

describe.runIf(asked)('the bench of gestures', () => {
  it(
    'plays every sound through the listening, a new conversation and the real transcription',
    async () => {
      const stt = process.env['GESTES_STT'];
      if (!stt)
        throw new Error(
          'GESTES_STT : la brique à mesurer (faster:small, whisper-server:<url>…), sans défaut.',
        );
      const dir = resolve(process.env['BANC_DIR'] ?? '../banc-sons', 'gestes');
      const voix = voixDuBanc(process.env['GESTES_VOIX'], process.env['CHAINE_TTS']);
      let service: ChildProcess | undefined;
      const debut = performance.now();
      try {
        const n = await banc(dir, voix, stt, async () => {
          const port = await libre();
          service = spawn(
            'uv',
            ['run', 'voix/service.py', '--stt', stt, '--tts', 'aucun', '--port', String(port)],
            {
              stdio: 'inherit',
            },
          );
          await attendre(`http://127.0.0.1:${port}/ping`, service);
          // As Vite's proxy does: `/voix/stt` is the service's `/stt`. Without an `Origin`, the service takes it.
          const f: typeof fetch = (url, init) =>
            fetch(`http://127.0.0.1:${port}${String(url).replace(/^\/voix/, '')}`, init);
          const infer = await loadSilero(readFileSync('src/listen/silero/silero_vad.onnx'));
          return (samples) => {
            const silero = new SileroVoice(infer);
            return ecouter(
              samples,
              (frame, listening) => silero.voice(frame, listening),
              (audio) => transcribe(audio, f),
            );
          };
        });
        const s = ((performance.now() - debut) / 1000).toFixed(0);
        console.log(`${n} sons en ${s} s, sur ${stt} : ${join(dir, 'gestes.jsonl')}`);
      } finally {
        // `uv` starts a child of its own: the whole tree stops.
        if (service?.pid && process.platform === 'win32')
          spawnSync('taskkill', ['/pid', String(service.pid), '/T', '/F']);
        else service?.kill();
      }
    },
    6 * 3_600_000,
  );
});
