import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readWav, writeWav } from '../../listen/replay.ts';
import { DEFAUTS, type Apres, type Geste, type Parole, type Reponse, type Scenario } from '../scenario.ts';

/**
 * The person's sounds for the chain, and the game plan the probe reads. Nothing here goes in the repository: the
 * sounds live in `dir/sons/` (`CHAINE_DIR`), laid by hand or synthesized by a voice and cached there, one folder
 * per voice.
 */

/** 16 kHz mono samples from -1 to 1, as `readWav` gives them; `dossier` is the voice's cache folder. */
export type Synth = (texte: string, dossier: string) => Promise<Float32Array>;
/** A voice for the person: `nom` names it in the cache and the report, without a path. */
export type Voix = { nom: string; synth: Synth };

/** `source`: `pose:<fichier>`, `cache:<voix>` or `synthese:<voix>`. */
export type SonPret = { samples: Float32Array; duree: number; source: string };
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
/** Kept on each side of a trimmed sound, as AIRI does: without it, `tiny` eats the first word (plan, task 0). */
const MARGE = 100 * MS;

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

/**
 * The sound between the first and the last 20 ms whose RMS reaches `SILENCE`, cut at their samples that reach it,
 * with `marge` on each side, within the sound; nothing of a silent one. A sound cut to its `duree` keeps none, so that
 * its `duree` is all sound.
 */
function rogner(x: Float32Array, marge = MARGE): Float32Array {
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
  if (a >= b) return x.subarray(0, 0);
  return x.subarray(Math.max(0, a - marge), Math.min(x.length, b + marge));
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

/**
 * One text through the voice's cache, then its synthesis, whose raw sound is kept: trimmed before it is written, the
 * key would have to carry the margin.
 */
async function dire(
  texte: string,
  dir: string,
  voix: Voix,
): Promise<{ samples: Float32Array; cache: boolean }> {
  // Hortense keeps the key and the folder her cache already has.
  const sapi = voix.nom === 'hortense';
  const dossier = join(dir, 'sons', sapi ? 'sapi' : nomDe(voix.nom));
  const cle = `${sapi ? VOIX_SAPI : voix.nom}\n${texte}`;
  const path = join(dossier, `${createHash('sha256').update(cle).digest('hex').slice(0, 16)}.wav`);
  const cached = await lire(path);
  if (cached) return { samples: rogner(cached), cache: true };
  await mkdir(dossier, { recursive: true });
  const samples = await voix.synth(texte, dossier);
  await writeFile(path, writeWav([samples]));
  return { samples: rogner(samples), cache: false };
}

/** A sound laid by hand cut to `duree` of sound, without margin; shorter, it would play shorter: an error names it. */
function coupe(pose: Float32Array, duree: number, nom: string): SonPret {
  const son = rogner(pose, 0);
  if (son.length < duree * MS)
    throw new Error(`${nom} : ${Math.round(son.length / MS)} ms, plus court que sa durée (${duree} ms)`);
  return pret(son.subarray(0, duree * MS), `pose:${nom}`);
}

async function sonDeParole(p: Parole, dir: string, voix: Voix, poses: boolean): Promise<SonDe> {
  const nom = `${nomDe(p.dit)}.wav`;
  // A cough or a sound between parentheses is not a text: its file always, cut to its duration.
  const bruit = /^\(.*\)$/.test(p.dit.trim());
  const pose = bruit || poses ? await lire(join(dir, 'sons', nom)) : undefined;
  if (pose && bruit) return coupe(pose, p.duree, nom);
  if (pose) return pret(rogner(pose), `pose:${nom}`);
  if (bruit) return { manque: `son manquant : ${nom}` };
  const trous = [...(p.trous ?? [])].sort((x, y) => x.a - y.a);
  const pieces = couper(p.dit, trous, p.duree);
  const parts: Float32Array[] = [];
  let cache = true;
  for (const [i, piece] of pieces.entries()) {
    if (i > 0) parts.push(new Float32Array(trous[i - 1]!.duree * MS));
    const said = await dire(piece, dir, voix);
    parts.push(said.samples);
    cache &&= said.cache;
  }
  const out = new Float32Array(parts.reduce((n, x) => n + x.length, 0));
  parts.reduce((at, x) => (out.set(x, at), at + x.length), 0);
  return pret(out, `${cache ? 'cache' : 'synthese'}:${voix.nom}`);
}

/**
 * For each speech and each noise, a sound and its real length (kept when longer than `duree`), or why it is missing.
 * A speech: `dir/sons/<nom>.wav` when `poses`, then the voice's cache, then its synthesis; one between parentheses,
 * its file whatever `poses`, cut to its duration and refused shorter. A noise: `bruit.wav`, the same way.
 * Leading and trailing silences are removed, but for 100 ms on each side; none is kept around a sound cut to its
 * duration.
 */
export async function sonsDe(s: Scenario, dir: string, voix: Voix, poses: boolean): Promise<Sons> {
  const personne: SonDe[] = [];
  for (const p of s.personne) personne.push(await sonDeParole(p, dir, voix, poses));
  const bruits: SonDe[] = [];
  for (const b of s.bruits ?? []) {
    const son = await lire(join(dir, 'sons', 'bruit.wav'));
    bruits.push(son ? coupe(son, b.duree, 'bruit.wav') : { manque: 'son manquant : bruit.wav' });
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

/** A synthesis never takes longer: past it, the child is killed. */
const LIMITE_MS = 30_000;

/**
 * A program at a fixed path, without a shell, the text on its standard input: what it writes on its output. `quoi`
 * names the voice in every error.
 */
function lancer(
  quoi: string,
  exe: string,
  args: string[],
  texte: string,
  cwd = process.cwd(),
): Promise<string> {
  return new Promise((ok, ko) => {
    const p = spawn(exe, args, { windowsHide: true, cwd });
    let out = '';
    let err = '';
    let ecriture: Error | undefined;
    let arrete = false;
    // Rejected at `close`, once the child is gone: until then, Windows refuses to remove the file it writes.
    const limite = setTimeout(() => {
      arrete = true;
      p.kill();
    }, LIMITE_MS);
    p.stdout.setEncoding('ascii').on('data', (d: string) => (out += d));
    p.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    // EPIPE: the child closed its input before reading it; `close` says why, its error output first.
    p.stdin.on('error', (e) => (ecriture = e));
    p.on('error', (e) => {
      clearTimeout(limite);
      ko(new Error(`${quoi} : ${e.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(limite);
      if (arrete) ko(new Error(`${quoi} : rien après ${LIMITE_MS / 1000} s, arrêté`));
      else if (code !== 0) ko(new Error(`${quoi} : ${err.trim() || `code ${code}`}`));
      else if (ecriture) ko(new Error(`${quoi} : ${ecriture.message}`));
      else ok(out);
    });
    p.stdin.end(texte, 'utf8');
  });
}

/** A fixed PowerShell script by `-EncodedCommand`: the bytes it writes in base64. */
async function powershell(quoi: string, script: string, texte: string): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error(`${quoi} : Windows seulement`);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
  return Buffer.from(await lancer(quoi, 'powershell.exe', args, texte), 'base64');
}

/**
 * Windows' French voice Hortense, through `System.Speech`, 16 kHz mono. The script is fixed and the text goes on the
 * standard input, never on the command line.
 */
export const synthSapi: Synth = async (texte) =>
  pcm(await powershell('synthSapi (Hortense)', SCRIPT_SAPI, texte));

/** The voices `System.Speech` does not see, reached through WinRT: a fixed list, since the name is in the script. */
const WINRT = ['Julie', 'Paul'] as const;

const scriptWinRT = (nom: (typeof WINRT)[number]) => `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like '*${nom}*' } | Select-Object -First 1
if (-not $v) { [Console]::Error.Write('${nom} absente'); exit 3 }
$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$s.Voice = $v
$texte = [Console]::In.ReadToEnd()
$st = Await ($s.SynthesizeTextToStreamAsync($texte)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$r = New-Object Windows.Storage.Streams.DataReader($st.GetInputStreamAt(0))
$null = Await ($r.LoadAsync([uint32]$st.Size)) ([uint32])
$b = New-Object byte[] $st.Size
$r.ReadBytes($b)
$s.Dispose()
[Console]::Out.Write([Convert]::ToBase64String($b))
`;

/**
 * Julie or Paul, Windows' OneCore voices, through WinRT: a WAV at 16 kHz, mono, its `fmt` of 18 bytes. The script is
 * fixed, the name from `WINRT` only, the text on the standard input.
 */
export function synthWinRT(nom: (typeof WINRT)[number]): Synth {
  if (!WINRT.includes(nom)) throw new Error(`synthWinRT : ${String(nom)} hors de la liste`);
  const script = scriptWinRT(nom);
  return async (texte) => readWav(await powershell(`synthWinRT (${nom})`, script, texte));
}

/** The speaker's number in `speaker_id_map` of `<modele>.json`, the file Piper reads beside its model. */
export function locuteurDe(modele: string, locuteur: string): number {
  const config = JSON.parse(readFileSync(`${modele}.json`, 'utf8')) as {
    speaker_id_map?: Record<string, unknown>;
  };
  const n = config.speaker_id_map?.[locuteur];
  if (typeof n !== 'number') throw new Error(`synthPiper : ${locuteur} absent de ${basename(modele)}`);
  return n;
}

/** A Piper voice's name, without its path: `piper:fr_FR-upmc-medium#pierre`. */
const nomPiper = (modele: string, locuteur?: string) =>
  `piper:${basename(modele).replace(/\.onnx$/i, '')}${locuteur ? `#${locuteur}` : ''}`;

/**
 * A Piper voice through `piper.exe` (the C++ one, not the service's package) at the path given, without a shell: the
 * text on the standard input, the WAV in a file of the voice's folder, read (22 050 Hz, resampled by `readWav`), then
 * removed.
 */
export function synthPiper(exe: string, modele: string, locuteur?: string): Synth {
  // Both from here: launched from its own folder, a relative path would be read from there.
  const [programme, onnx] = [resolve(exe), resolve(modele)];
  const s = locuteur === undefined ? [] : ['-s', String(locuteurDe(onnx, locuteur))];
  const quoi = `synthPiper (${nomPiper(onnx, locuteur)})`;
  return async (texte, dossier) => {
    const fichier = resolve(dossier, `piper-${randomUUID()}.wav`);
    const args = ['-q', '-m', onnx, ...s, '-f', fichier];
    try {
      // In its own folder, where it finds espeak-ng's data.
      await lancer(quoi, programme, args, texte, dirname(programme));
      return readWav(await readFile(fichier));
    } finally {
      await rm(fichier, { force: true });
    }
  };
}

/**
 * One entry of `CHAINE_VOIX`: `hortense`, `julie`, `paul` or `piper:<exe>|<modèle>[#<locuteur>]`, the speaker after
 * the last `#`, past `.onnx`. Refuses her own voice, `tts` (`CHAINE_TTS`): the same model, and the same speaker, the
 * first one, with which her service speaks.
 */
export function voixDe(spec: string, tts: string): Voix {
  const entree = spec.trim();
  if (entree === 'hortense') return { nom: entree, synth: synthSapi };
  const winrt = WINRT.find((n) => n.toLowerCase() === entree);
  if (winrt) return { nom: entree, synth: synthWinRT(winrt) };
  if (!entree.startsWith('piper:')) throw new Error(`voixDe : voix inconnue : ${entree}`);
  const barre = entree.indexOf('|');
  if (barre < 0) throw new Error(`voixDe : une voix de Piper s'écrit piper:<exe>|<modèle> : ${entree}`);
  const m = /^(.+\.onnx)(?:#([^#]+))?$/i.exec(entree.slice(barre + 1));
  if (!m) throw new Error(`voixDe : le modèle de Piper finit par .onnx : ${entree}`);
  const [modele, locuteur] = [m[1]!, m[2]];
  const nom = nomPiper(modele, locuteur);
  const sienne =
    tts.startsWith('piper:') && basename(tts.slice(6)).toLowerCase() === basename(modele).toLowerCase();
  if (sienne && (locuteur === undefined || locuteurDe(modele, locuteur) === 0))
    throw new Error(`voixDe : ${nom} est sa voix (CHAINE_TTS)`);
  return { nom, synth: synthPiper(entree.slice(6, barre), modele, locuteur) };
}
