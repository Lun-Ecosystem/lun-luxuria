import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readWav, writeWav } from '../../listen/replay.ts';
import { DEFAUTS, type Apres, type Geste, type Parole, type Reponse, type Scenario } from '../scenario.ts';

/**
 * The person's sounds for the chain, and the game plan the probe reads. Nothing here goes in the repository: the
 * sounds live in `dir/sons/` (`CHAINE_DIR`), laid by hand or synthesized by Windows and cached there.
 */

/** 16 kHz mono samples from -1 to 1, as `readWav` gives them. */
export type Synth = (texte: string) => Promise<Float32Array>;

export type SonPret = { samples: Float32Array; duree: number; source: 'pose' | 'cache' | 'synthese' };
export type SonDe = SonPret | { manque: string };
export interface Sons {
  personne: SonDe[];
  bruits: SonDe[];
}

const MS = 16; // samples per ms at 16 kHz
/**
 * shortcut: a fixed level, about -40 dB, for the RMS over 20 ms and the edge's samples; a sound laid by hand with a
 * louder floor keeps its edges.
 */
const SILENCE = 0.01;
const VOIX_SAPI = 'sapi-hortense-16k';

/** The file name of a `dit`: lower case, no accents, words joined by dashes. */
export function nomDe(dit: string): string {
  return dit
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The text cut at the word nearest each silence, in proportion of `duree`; a silence with no word left is dropped. */
export function couper(texte: string, trous: NonNullable<Parole['trous']>, duree: number): string[] {
  const pieces: string[] = [];
  let from = 0;
  for (const t of [...trous].sort((x, y) => x.a - y.a)) {
    const want = (t.a / duree) * texte.length;
    let best = -1;
    for (let i = texte.indexOf(' ', from); i >= 0; i = texte.indexOf(' ', i + 1))
      if (best < 0 || Math.abs(i - want) < Math.abs(best - want)) best = i;
    if (best < 0) continue;
    pieces.push(texte.slice(from, best).trim());
    from = best + 1;
  }
  pieces.push(texte.slice(from).trim());
  return pieces;
}

/** The envelope's step: a click of a few samples is no louder than silence over it. */
const BLOC = 20 * MS;

/** The sound between the first and the last 20 ms whose RMS reaches `SILENCE`, cut at their samples that reach it. */
function rogner(x: Float32Array): Float32Array {
  const fort = (k: number) => {
    const [de, a] = [k * BLOC, Math.min(x.length, (k + 1) * BLOC)];
    let s = 0;
    for (let i = de; i < a; i++) s += x[i]! ** 2;
    return Math.sqrt(s / (a - de)) >= SILENCE;
  };
  const blocs = Math.ceil(x.length / BLOC);
  let [p, d] = [0, blocs];
  while (p < d && !fort(p)) p++;
  while (d > p && !fort(d - 1)) d--;
  let a = p * BLOC;
  let b = Math.min(x.length, d * BLOC);
  while (a < b && Math.abs(x[a]!) < SILENCE) a++;
  while (b > a && Math.abs(x[b - 1]!) < SILENCE) b--;
  return x.subarray(a, b);
}

const pret = (samples: Float32Array, source: SonPret['source']): SonPret => ({
  samples,
  duree: Math.round(samples.length / MS),
  source,
});

async function lire(path: string): Promise<Float32Array | undefined> {
  try {
    return readWav(await readFile(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** One text through the cache, then the synthesis, whose result is kept. */
async function dire(
  texte: string,
  dir: string,
  synth: Synth,
): Promise<{ samples: Float32Array; cache: boolean }> {
  const empreinte = createHash('sha256').update(`${VOIX_SAPI}\n${texte}`).digest('hex').slice(0, 16);
  const path = join(dir, 'sons', 'sapi', `${empreinte}.wav`);
  const cached = await lire(path);
  if (cached) return { samples: rogner(cached), cache: true };
  const samples = await synth(texte);
  await mkdir(join(dir, 'sons', 'sapi'), { recursive: true });
  await writeFile(path, writeWav([samples]));
  return { samples: rogner(samples), cache: false };
}

async function sonDeParole(p: Parole, dir: string, synth: Synth): Promise<SonDe> {
  const nom = `${nomDe(p.dit)}.wav`;
  const pose = await lire(join(dir, 'sons', nom));
  if (pose) return pret(rogner(pose), 'pose');
  // A cough or a sound between parentheses is not a text.
  if (/^\(.*\)$/.test(p.dit.trim())) return { manque: `son manquant : ${nom}` };
  const trous = [...(p.trous ?? [])].sort((x, y) => x.a - y.a);
  const pieces = couper(p.dit, trous, p.duree);
  const parts: Float32Array[] = [];
  let cache = true;
  for (const [i, piece] of pieces.entries()) {
    if (i > 0) parts.push(new Float32Array(trous[i - 1]!.duree * MS));
    const said = await dire(piece, dir, synth);
    parts.push(said.samples);
    cache &&= said.cache;
  }
  const out = new Float32Array(parts.reduce((n, x) => n + x.length, 0));
  parts.reduce((at, x) => (out.set(x, at), at + x.length), 0);
  return pret(out, cache ? 'cache' : 'synthese');
}

/**
 * For each speech and each noise, a sound and its real length (kept when longer than `duree`), or why it is missing.
 * A speech: `dir/sons/<nom>.wav`, then the cache `dir/sons/sapi/`, then `synth`. A noise: `bruit.wav`, cut to its
 * duration. Leading and trailing silences are removed.
 */
export async function sonsDe(s: Scenario, dir: string, synth: Synth): Promise<Sons> {
  const personne: SonDe[] = [];
  for (const p of s.personne) personne.push(await sonDeParole(p, dir, synth));
  const bruits: SonDe[] = [];
  for (const b of s.bruits ?? []) {
    const son = await lire(join(dir, 'sons', 'bruit.wav'));
    bruits.push(
      son ? pret(rogner(son).subarray(0, b.duree * MS), 'pose') : { manque: 'son manquant : bruit.wav' },
    );
  }
  return { personne, bruits };
}

/** A sound laid in the game: `son` is its number, served as `/banc/sons/<son>.wav`. */
export type Pose = { son: number; de: 'parole' | 'bruit'; numero: number; duree: number } & (
  { a: number } | { apres: Apres }
);

export type PlanDePartie =
  { nom: string; poses: Pose[]; gestes: Geste[]; reponses: Reponse[] } | { nom: string; manque: string[] };

const prets = (sons: Sons) => [...sons.personne, ...sons.bruits];

/** The plan the probe plays, data only; the anchors are left for the probe to resolve. */
export function planDePartie(s: Scenario, sons: Sons): PlanDePartie {
  const manque = prets(sons).flatMap((x) => ('manque' in x ? [x.manque] : []));
  if (manque.length > 0) return { nom: s.nom, manque: [...new Set(manque)] };
  const duree = (n: number) => (prets(sons)[n] as SonPret).duree;
  const poses: Pose[] = [
    ...s.personne.map((p, i): Pose => {
      // `charger` refuses a speech with neither `a` nor `apres`.
      const at = p.apres ? { apres: p.apres } : { a: p.a! };
      return { son: i, de: 'parole', numero: i + 1, duree: duree(i), ...at };
    }),
    ...(s.bruits ?? []).map((b, j): Pose => {
      const n = s.personne.length + j;
      return { son: n, de: 'bruit', numero: j + 1, duree: duree(n), a: b.a };
    }),
  ];
  return {
    nom: s.nom,
    poses,
    gestes: s.gestes ?? [],
    reponses: s.modele?.reponses ?? [],
  };
}

/** The WAV files of the plan, in the numbers of its `son`. */
export function fichiers(sons: Sons): Uint8Array[] {
  return prets(sons).map((x) => writeWav('samples' in x ? [x.samples] : []));
}

/**
 * The witness through Chromium's fake device: every sound at `attenteMs + a` in one WAV, `attenteMs` the opening
 * wait the task 0 measured, which the player takes off when it realigns. Absolute instants only.
 */
export function temoin(s: Scenario, sons: Sons, attenteMs = 8000): Uint8Array {
  const paroles = s.personne;
  if (paroles.some((p) => p.apres))
    throw new Error(`${s.nom} : une parole ancrée ne se pose pas dans le témoin`);
  const poses = [
    ...paroles.map((p, i) => ({ a: p.a!, son: sons.personne[i] })),
    ...(s.bruits ?? []).map((b, j) => ({ a: b.a, son: sons.bruits[j] })),
  ];
  const fin = poses.reduce((m, x) => Math.max(m, x.a + (x.son && 'duree' in x.son ? x.son.duree : 0)), 0);
  const out = new Float32Array((attenteMs + (s.jusqua ?? fin + DEFAUTS.finApresMs)) * MS);
  for (const { a, son } of poses) {
    if (!son || 'manque' in son) throw new Error(`${s.nom} : ${son ? son.manque : 'son absent'}`);
    const at = (attenteMs + a) * MS;
    for (let i = 0; i < son.samples.length && at + i < out.length; i++) out[at + i]! += son.samples[i]!;
  }
  return writeWav([out]);
}

const SCRIPT_SAPI = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like '*Hortense*' } | Select-Object -First 1
if (-not $v) { [Console]::Error.Write('Hortense absente'); exit 3 }
$s.SelectVoice($v.VoiceInfo.Name)
$m = New-Object System.IO.MemoryStream
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToAudioStream($m, $f)
$s.Speak([Console]::In.ReadToEnd())
$s.Dispose()
[Console]::Out.Write([Convert]::ToBase64String($m.ToArray()))
`;

/** Raw 16-bit PCM without a header, as `SetOutputToAudioStream` writes it. */
function pcm(bytes: Uint8Array): Float32Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true) / 32768;
  return out;
}

/**
 * Windows' French voice Hortense, through `System.Speech`, 16 kHz mono. The script is fixed and the text goes on the
 * standard input, never on the command line.
 */
export const synthSapi: Synth = (texte) => {
  if (process.platform !== 'win32') return Promise.reject(new Error('synthSapi : Windows seulement'));
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT_SAPI, 'utf16le').toString('base64');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    ps.stdout.setEncoding('ascii').on('data', (d: string) => (out += d));
    ps.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) reject(new Error(`synthSapi : ${err.trim() || `code ${code}`}`));
      else resolve(pcm(Buffer.from(out, 'base64')));
    });
    ps.stdin.end(texte, 'utf8');
  });
};
