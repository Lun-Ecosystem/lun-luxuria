import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ENDPOINT_DEFAULTS, type EndpointParams } from './endpoint.ts';
import { noise, readWav, replay } from './replay.ts';
import { Conversation, type Heard } from '../conversation.ts';
import { dire, voixDe, type Voix } from '../presence/chaine/sons.ts';
import { DEFAULTS } from '../settings.ts';
import { Speaker } from '../speech/speaker.ts';
import { Trace, type TraceEvent } from '../trace.ts';

/**
 * The bench of gestures (`npm run gestes`): what the page sends to the server, text and confidence, for each sound of
 * a folder kept out of the repository. Nothing here tells a gesture from a word: the server does, on these lines.
 */

const ATTENDUS = ['accepter', 'refuser', 'envoyer', 'annuler', 'aucun'] as const;
export interface Ligne {
  id: string;
  dit: string;
  attendu: (typeof ATTENDUS)[number];
  prises: number;
  /** `false`: a sound that is not speech, never synthesized. */
  parole?: boolean;
}

const CLES = ['id', 'dit', 'attendu', 'prises', 'parole'];

/** The lines of `mots.json`; a wrong one is refused by its rank and why, never by what it says. */
export function lireListe(texte: string): Ligne[] {
  let lignes: unknown;
  try {
    lignes = JSON.parse(texte);
  } catch {
    // The parser's message copies a piece of the file: one of its words could be in it.
    throw new Error('mots.json : JSON illisible');
  }
  if (!Array.isArray(lignes)) throw new Error('mots.json : un tableau de lignes');
  const ids = new Set<string>();
  return lignes.map((l: Record<string, unknown>, i) => {
    const faute = (raison: string) => new Error(`mots.json, ligne ${i + 1} : ${raison}`);
    if (typeof l !== 'object' || l === null || Array.isArray(l)) throw faute('un objet');
    // A key could be one of its words: it is not named.
    if (Object.keys(l).some((k) => !CLES.includes(k))) throw faute('clé inconnue');
    if (typeof l['id'] !== 'string' || !/^[a-z0-9-]+$/.test(l['id'])) throw faute('« id » en [a-z0-9-]+');
    if (ids.has(l['id'])) throw faute('« id » déjà pris');
    ids.add(l['id']);
    if (typeof l['dit'] !== 'string' || l['dit'].trim() === '') throw faute('« dit » vide ou absent');
    if (!ATTENDUS.includes(l['attendu'] as Ligne['attendu']))
      throw faute(`« attendu » parmi ${ATTENDUS.join(', ')}`);
    if (!Number.isInteger(l['prises']) || (l['prises'] as number) < 1)
      throw faute('« prises » entier d’au moins 1');
    if (l['parole'] !== undefined && typeof l['parole'] !== 'boolean') throw faute('« parole » vrai ou faux');
    return l as unknown as Ligne;
  });
}

// shortcut: Piper and her voice where the laptop keeps them, as `npm run chaine`; elsewhere GESTES_VOIX and CHAINE_TTS.
const PIPER = resolve('../../piper');
const UPMC = `${join(PIPER, 'piper.exe')}|${join(PIPER, 'fr_FR-upmc-medium.onnx')}`;
const CINQ = `hortense,julie,paul,piper:${UPMC}#jessica,piper:${UPMC}#pierre`;
const SIENNE = `piper:${join(PIPER, 'fr_FR-siwis-medium.onnx')}`;

/**
 * The voices of `GESTES_VOIX`, in the format of `CHAINE_VOIX`, the five by default. Hers is refused: the voice her
 * service speaks with in use (`CHAINE_TTS`), not this bench's, which speaks with none.
 */
export function voixDuBanc(voix = CINQ, tts = SIENNE): Voix[] {
  return voix.split(',').map((v) => voixDe(v, tts));
}

/** shortcut: a fixed level chosen, not measured in a room (about -39 dBFS RMS); set it from a room recording if needed. */
const BRUIT = 0.02;
/** The noise's levels around a sound that is not speech, in dB from `BRUIT`. */
export const NIVEAUX = [-6, 0, 6];

/** The sound in the noise of the bench, `db` from its fixed level: the same noise at every draw. */
export function dansLeBruit(son: Float32Array, db: number): Float32Array {
  const bruit = noise(Math.ceil(son.length / 16000), BRUIT * 10 ** (db / 20));
  return son.map((x, i) => x + bruit[i]!);
}

// As `session.svelte.ts` (#params): the page's own end of sentence, by default.
const e = DEFAULTS.endOfSpeech;
const PARAMS: EndpointParams = {
  ...ENDPOINT_DEFAULTS,
  pauseMs: e.pauseMs,
  silenceMs: e.silenceMs,
  minSpeechMs: e.minSpeechMs,
  holdMs: DEFAULTS.bargeIn.holdMs,
};

/** `duree`: what the transcription took (ms); `son`: the length of the sound it got (ms); `verdict`: the page's. */
export type Transcription = { duree: number; son: number } & (
  { texte: string; confiance: number; verdict?: string | undefined } | { echec: string }
);
export type Envoi = { texte: string; confiance: number | undefined };
export interface Ecoute {
  /** What the listening found, in order. */
  ecoute: string[];
  transcriptions: Transcription[];
  /** What `send` received, as it received it; `repris`, what `withdraw` took back of it. */
  envoye: Envoi[];
  repris: Envoi[];
}

/**
 * One sound through the listening and a new conversation, as the page hears it in the scene with its settings by
 * default: only the noise filter sets a text aside. Returns once every transcription on its way is back.
 */
export async function ecouter(
  samples: Float32Array,
  voice: (frame: Float32Array, listening: boolean) => number | Promise<number>,
  stt: (audio: Float32Array) => Promise<Heard>,
): Promise<Ecoute> {
  let soundAt = 0;
  const trace = new Trace(() => soundAt);
  const out: Ecoute = { ecoute: [], transcriptions: [], envoye: [], repris: [] };
  const faites: { t: Transcription; essai: TraceEvent | undefined }[] = [];
  const enRoute: Promise<unknown>[] = [];
  const mesurer = async (audio: Float32Array) => {
    // The try the conversation has just written: its verdict will say what the page did with this text.
    const dernier = trace.events.at(-1);
    const essai = dernier?.name === 'essai' ? dernier : undefined;
    const de = performance.now();
    const fin = (t: { texte: string; confiance: number } | { echec: string }) =>
      faites.push({
        t: { ...t, duree: Math.round(performance.now() - de), son: Math.round(audio.length / 16) },
        essai,
      });
    try {
      const h = await stt(audio);
      fin({ texte: h.text, confiance: h.confidence });
      return h;
    } catch (err) {
      fin({ echec: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
  const convo: Conversation = new Conversation({
    brain: {
      send: async (texte, opts, on) => {
        out.envoye.push({ texte, confiance: opts.confidence });
        const id = out.envoye.length;
        on({
          type: 'user',
          message: { id, role: 'user', text: texte, status: 'ok', surface: opts.surface, at: '' },
        });
      },
      cut: async () => {},
      withdraw: async (id) => void out.repris.push(out.envoye[id - 1]!),
    },
    stt: (audio) => {
      const t = mesurer(audio);
      enRoute.push(t.catch(() => {}));
      return t;
    },
    speaker: new Speaker(
      async () => ({ samples: new Float32Array(1), rate: 16000 }),
      { play: () => ({ stop: () => {}, heard: () => 1 }) },
      (ev) => convo.onSpeaker(ev),
    ),
    settings: () => DEFAULTS,
    layout: () => 'scene',
    keyHeld: () => false,
    now: () => soundAt,
    on: () => {},
    trace,
  });
  const heard = await replay(
    samples,
    voice,
    PARAMS,
    (ev) => convo.onEndpoint(ev),
    (at) => (soundAt = at),
  );
  out.ecoute = heard.events.map((ev) => ev.type);
  await Promise.all(enRoute);
  await new Promise((r) => setTimeout(r));
  // In the order they came back; a try withdrawn before its verdict has none.
  const verdict = (essai: TraceEvent | undefined) =>
    essai &&
    trace.events.find((v) => v.name === 'verdict' && v.phrase === essai.phrase && v.essai === essai.essai);
  out.transcriptions = faites.map(({ t, essai }) =>
    'texte' in t ? { ...t, verdict: verdict(essai)?.['resultat'] as string | undefined } : t,
  );
  return out;
}

/** Half a second of silence on each side, as the microphone hears before and after: the noise covers them too. */
const autour = (son: Float32Array) => {
  const out = new Float32Array(son.length + 16000);
  out.set(son, 8000);
  return out;
};

type Son = { id: string; source: string; attendu: Ligne['attendu'] };

/**
 * Every sound of `dir` (`BANC_DIR/gestes`), each through `ouvrir`'s listening, one line each in `gestes.jsonl`:
 * - a speech of `mots.json`, said by each voice, clean then in the noise at its fixed level; then each of its takes;
 * - a sound that is not speech, each take clean then in the noise at the three levels, as each file of `temoins/` and
 *   a silent sound made here.
 * The list and every take are read before anything plays: a missing one stops it all, and is named.
 */
export async function banc(
  dir: string,
  voix: Voix[],
  brique: string,
  ouvrir: () => Promise<(samples: Float32Array) => Promise<Ecoute>>,
): Promise<number> {
  const liste = join(dir, 'mots.json');
  if (!existsSync(liste)) throw new Error(`Pas de liste des gestes : ${liste}`);
  const lignes = lireListe(readFileSync(liste, 'utf8'));
  const prises = lignes.map((l) =>
    Array.from({ length: l.prises }, (_, k) => join(dir, 'prises', `${l.id}-${k + 1}.wav`)),
  );
  const manque = prises.flat().filter((p) => !existsSync(p));
  if (manque.length > 0)
    throw new Error(`Prises manquantes, rien n'est joué : ${manque.map((p) => basename(p)).join(', ')}`);
  const lire = (p: string) => {
    try {
      return readWav(readFileSync(p));
    } catch (err) {
      throw new Error(`${basename(p)} : ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  };
  const sons = prises.map((ps) => ps.map(lire));
  const dossier = join(dir, 'temoins');
  const temoins = (existsSync(dossier) ? readdirSync(dossier) : [])
    .filter((f) => f.endsWith('.wav'))
    .sort()
    .map((f) => ({ id: f.slice(0, -4), samples: lire(join(dossier, f)) }));

  const ecoute = await ouvrir();
  const sortie = join(dir, 'gestes.jsonl');
  writeFileSync(sortie, '');
  let n = 0;
  const jouer = async (son: Son, samples: Float32Array, niveau?: number) => {
    const pose = autour(samples);
    const e = await ecoute(niveau === undefined ? pose : dansLeBruit(pose, niveau));
    const condition = niveau === undefined ? 'propre' : 'bruit';
    const date = new Date().toISOString();
    appendFileSync(sortie, `${JSON.stringify({ ...son, condition, niveau, ...e, brique, date })}\n`);
    n++;
  };
  const nonParole = async (son: Son, samples: Float32Array) => {
    await jouer(son, samples);
    for (const db of NIVEAUX) await jouer(son, samples, db);
  };
  for (const [i, l] of lignes.entries()) {
    if (l.parole !== false)
      for (const v of voix) {
        const { samples } = await dire(l.dit, dir, v);
        await jouer({ id: l.id, source: v.nom, attendu: l.attendu }, samples);
        await jouer({ id: l.id, source: v.nom, attendu: l.attendu }, samples, 0);
      }
    for (const [k, samples] of sons[i]!.entries()) {
      const son = { id: l.id, source: `prise:${k + 1}`, attendu: l.attendu };
      if (l.parole === false) await nonParole(son, samples);
      else await jouer(son, samples);
    }
  }
  for (const t of temoins) await nonParole({ id: t.id, source: 'temoin', attendu: 'aucun' }, t.samples);
  await nonParole({ id: 'nul', source: 'code', attendu: 'aucun' }, new Float32Array(2 * 16000));
  return n;
}
