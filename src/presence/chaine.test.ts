// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings.ts';
import type { TraceEvent, TraceValue } from '../trace.ts';
import { fichiers, planDePartie, sonsDe, synthSapi, temoin, type Sons } from './chaine/sons.ts';
import type { Plan } from './chaine/sonde.ts';
import { juger, passe } from './judge.ts';
import { jouer } from './player.ts';
import { releveChaine, type Jouee, type PartieChaine } from './releve.ts';
import {
  ancre,
  charger,
  DEFAUTS,
  merged,
  type BancEvent,
  type BancNom,
  type Partie,
  type Scenario,
} from './scenario.ts';

/**
 * The real player (plan 2026-11-11-chaine-laptop, task 9): each scenario through the built page in Chrome, the voice
 * service, faster-whisper and the server of the chain (Lun'Anima's `npm run chaine`), in real time. `npm run chaine`
 * only; `npm test` runs the merge and the list of scenarios not played, on lines written by hand.
 */

/** A line of the server's journal, `serveur/journal.jsonl`: `t` is `Date.now()`, never compared with the page. */
interface LigneServeur {
  partie: string | null;
  t: number;
  name: string;
  [valeur: string]: TraceValue | null | undefined;
}

const DU_SERVEUR: readonly string[] = ['envoi_recu', 'coupure_recue', 'retrait_recu', 'modele_appele'];

/** An instant of the page brought to the game's, to the ms: the bounds are in ms. */
const depuis = (at: number, t0: number) => Math.round(at - t0);

/** A page's event brought to the game's: `at`, and the sound instants of the listening. */
const decale = (e: TraceEvent, t0: number): TraceEvent => {
  const out: TraceEvent = { ...e, at: depuis(e.at, t0) };
  for (const k of ['son', 'dernier_son']) if (typeof e[k] === 'number') out[k] = depuis(e[k] as number, t0);
  return out;
};

/**
 * One game from what the page, the probe and the server wrote, shifted to `t0`. The server's clock is never converted:
 * each of its lines takes the instant of the page's event with the same number (`envoi_recu` on `numero`,
 * `coupure_recue` on `coupee`, or on `oubliee` for a reply forgotten unheard, which the page cuts without a `coupee`,
 * `retrait_recu` on the `retiree` of the message's try), `modele_appele` that of the `envoi_recu` of its rank (the
 * server writes them in either order). One the page never matched keeps the instant of the line before.
 * The probe's own `envoi_recu` (its anchors) gives way to the server's.
 */
function fondre(
  trace: readonly TraceEvent[],
  format: number,
  sonde: readonly BancEvent[],
  serveur: readonly LigneServeur[],
  t0: number,
  fin: number,
): Partie {
  const lignes = serveur.filter((l) => DU_SERVEUR.includes(l.name));
  const envois = lignes.filter((l) => l.name === 'envoi_recu');
  const appels = lignes.filter((l) => l.name === 'modele_appele');
  const numero = (k: string, v: unknown) => trace.find((e) => e.name === 'numero' && e[k] === v);
  const instant = (l: LigneServeur | undefined): number | undefined => {
    if (!l) return undefined;
    if (l.name === 'envoi_recu') return numero('reponse', l['reponse'])?.at;
    if (l.name === 'coupure_recue') {
      const de = (n: string) => trace.find((e) => e.name === n && e.reponse === l['reponse']);
      return (de('coupee') ?? de('oubliee'))?.at;
    }
    if (l.name === 'retrait_recu') {
      const n = numero('message', l['message']);
      return n && trace.find((e) => e.name === 'retiree' && e.phrase === n.phrase && e.essai === n.essai)?.at;
    }
    return instant(envois[appels.indexOf(l)]);
  };
  let avant = t0;
  const banc: BancEvent[] = sonde
    .filter((e) => e.name !== 'envoi_recu')
    .map((e) => ({ ...e, at: depuis(e.at, t0) }));
  for (const l of lignes) {
    avant = instant(l) ?? avant;
    const e: BancEvent = { de: 'banc', at: depuis(avant, t0), name: l.name as BancNom };
    for (const [k, v] of Object.entries(l))
      if (k !== 'partie' && k !== 't' && k !== 'name' && v !== null && v !== undefined) e[k] = v;
    banc.push(e);
  }
  return {
    format,
    page: trace.map((e) => decale(e, t0)),
    banc: banc.sort((x, y) => x.at - y.at),
    fin: depuis(fin, t0),
  };
}

/** Why a scenario is not played in the chain (the plan's « Les scénarios à ce niveau »), or undefined. */
function pourquoiPas(s: Scenario): string | undefined {
  if (s.echo) return "l'écho passe par un vrai micro et une vraie sortie, étape 5";
  if (s.disposition === 'small') return 'petit mode, la fenêtre seule (session.svelte.ts:69)';
  if (s.modeleMs !== undefined) return 'modeleMs règle un faux ; ici le temps de Silero est le vrai';
  try {
    charger(s, 'chaine');
  } catch (err) {
    return (err as Error).message;
  }
  return undefined;
}

const scenarios = import.meta.glob<Scenario>('./scenarios/*.ts', { eager: true, import: 'default' });

describe('le joueur réel, sans navigateur', () => {
  it('fond le journal du serveur par numéros, pas par ordre', () => {
    const trace: TraceEvent[] = [
      { at: 1100, name: 'voix', phrase: 1, son: 1020 },
      { at: 1900, name: 'numero', phrase: 1, essai: 1, reponse: 101, message: 7 },
      { at: 3100, name: 'numero', phrase: 2, essai: 1, reponse: 102, message: 8 },
      { at: 3300, name: 'retiree', phrase: 2, essai: 1, reponse: 102 },
      { at: 5000, name: 'coupee', reponse: 101, entendu: '' },
      // Forgotten unheard: the page cuts it without a `coupee`.
      { at: 7000.4, name: 'oubliee', reponse: 102 },
    ];
    const sonde: BancEvent[] = [
      { de: 'banc', at: 1000, name: 'parole', parole: 1, etape: 'debut' },
      { de: 'banc', at: 1880, name: 'envoi_recu', texte: 'bonjour', reponse: 101 },
      { de: 'banc', at: 6000, name: 'joue', reponse: 101, phrase: 1, texte: 'Salut.', tete: 191 },
    ];
    // As the server writes them: each `modele_appele` before its `envoi_recu`, on another clock.
    const serveur: LigneServeur[] = [
      { partie: 'p', t: 9e12, name: 'modele_appele', reponse: 0, texte: 'bonjour' },
      { partie: 'p', t: 9e12 + 5, name: 'envoi_recu', texte: 'bonjour', message: 7, reponse: 101 },
      { partie: 'p', t: 9e12 + 900, name: 'modele_appele', reponse: 1, texte: 'encore' },
      { partie: 'p', t: 9e12 + 905, name: 'envoi_recu', texte: 'encore', message: 8, reponse: 102 },
      { partie: 'p', t: 9e12 + 1000, name: 'retrait_recu', message: 8 },
      { partie: 'p', t: 9e12 + 2000, name: 'coupure_recue', reponse: 101, entendu: '' },
      { partie: 'p', t: 9e12 + 2001, name: 'parle_recu', reponse: 51 },
      { partie: 'p', t: 9e12 + 3000, name: 'coupure_recue', reponse: 102, entendu: '' },
    ];
    const p = fondre(trace, 2, sonde, serveur, 1000, 9000);
    expect(p.fin).toBe(8000);
    expect(p.page[0]).toEqual({ at: 100, name: 'voix', phrase: 1, son: 20 });
    expect(p.banc.map((e) => [e.at, e.name, e.reponse ?? e['message'] ?? e['parole']])).toEqual([
      [0, 'parole', 1],
      [900, 'modele_appele', 0],
      [900, 'envoi_recu', 101],
      [2100, 'modele_appele', 1],
      [2100, 'envoi_recu', 102],
      [2300, 'retrait_recu', 8],
      [4000, 'coupure_recue', 101],
      [5000, 'joue', 101],
      [6000, 'coupure_recue', 102],
    ]);
    // Only the server's `envoi_recu`, with what it read; nothing of its clock.
    expect(p.banc.find((e) => e.name === 'envoi_recu')).toEqual({
      de: 'banc',
      at: 900,
      name: 'envoi_recu',
      texte: 'bonjour',
      message: 7,
      reponse: 101,
    });
  });

  it("garde l'instant de la ligne d'avant à une ligne que la page n'a pas", () => {
    const serveur: LigneServeur[] = [
      { partie: 'p', t: 1, name: 'modele_appele', reponse: 0, texte: 'x' },
      { partie: 'p', t: 2, name: 'envoi_recu', texte: 'x', message: 1, reponse: null },
    ];
    const p = fondre([], 2, [], serveur, 500, 600);
    expect(p.banc).toEqual([
      { de: 'banc', at: 0, name: 'modele_appele', reponse: 0, texte: 'x' },
      { de: 'banc', at: 0, name: 'envoi_recu', texte: 'x', message: 1 },
    ]);
  });

  it('dit chaque scénario non joué et sa raison', () => {
    const non = Object.values(scenarios)
      .map((s) => [s.nom, pourquoiPas(s)] as const)
      .filter(([, r]) => r !== undefined)
      .sort();
    expect(non).toEqual([
      ['aparte-parole-longue', 'petit mode, la fenêtre seule (session.svelte.ts:69)'],
      ['delai-modele-lent', 'modeleMs règle un faux ; ici le temps de Silero est le vrai'],
      ['echo-fort', "l'écho passe par un vrai micro et une vraie sortie, étape 5"],
      ['phrase-ecartee', 'petit mode, la fenêtre seule (session.svelte.ts:69)'],
    ]);
  });
});

// ——— The real game: `npm run chaine` only. ———

const enChaine = import.meta.env.MODE === 'chaine';
const DIR = resolve(process.env['BANC_DIR'] ?? '../banc-sons', 'chaine');
const STT = `faster:${process.env['CHAINE_STT'] ?? 'tiny'}`;
// shortcut: the siwis voice where the laptop keeps it; another poste sets CHAINE_TTS.
const TTS = process.env['CHAINE_TTS'] ?? `piper:${resolve('../../piper/fr_FR-siwis-medium.onnx')}`;
const SERVEUR = 'http://127.0.0.1:8798';
const CHOISIS = process.env['CHAINE_SCENARIOS']?.split(',');
const VITE = resolve('node_modules/vite/bin/vite.js');
/** A game never lasts longer, whatever its anchors wait for. */
const PLAFOND_MS = 90_000;
const SILENCE_TRAME = 0.01;
/** Her voice silent this long after its last sound: no sentence of hers is on its way (two follow within ms). */
const CALME_MS = 1500;

const libre = () =>
  new Promise<number>((ok, ko) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
    s.on('error', ko);
  });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendre(url: string, ms: number, c: ChildProcess): Promise<void> {
  for (const fin = Date.now() + ms; Date.now() < fin; await pause(500)) {
    if (c.exitCode !== null) throw new Error(`${url} : son processus s'est arrêté (code ${c.exitCode})`);
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
  }
  throw new Error(`${url} ne répond pas après ${ms} ms`);
}
// `uv` and `node` start children of their own: the whole tree stops.
const arreter = (c: ChildProcess | undefined) => {
  if (!c?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F']);
  else c.kill();
};
// Vitest's variables would build the page for its tests (svelteTesting, Svelte's server side): not passed on.
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'),
);
const construire = (args: string[]) => {
  const r = spawnSync(process.execPath, [VITE, 'build', ...args], { stdio: 'inherit', env: ENV });
  if (r.status !== 0) throw new Error(`vite build ${args.join(' ')} : code ${r.status}`);
};

/** The fake synthesis (`FausseVoix`'s settings): a flat sound, its number in its first sample. */
let synthesesFausses = 0;
const sonFaux = (s: Scenario, texte: string) => {
  const rate = 22050;
  const ms = texte.length * (s.voix?.msParCaractere ?? DEFAUTS.msParCaractere);
  const x = new Float32Array(Math.round((ms / 1000) * rate)).fill(0.1);
  x[0] = 0.1 + ++synthesesFausses * 1e-4;
  return Buffer.from(x.buffer);
};

describe.runIf(enChaine)('la chaîne', () => {
  let voix: ChildProcess | undefined;
  let apercu: ChildProcess | undefined;
  let navigateur: Browser | undefined;
  let PAGE = '';
  let jeton = '';
  let SONDE = '';
  const parties: PartieChaine[] = [];

  beforeAll(async () => {
    if (
      !(await fetch(SERVEUR).then(
        () => true,
        () => false,
      ))
    )
      throw new Error(
        `Le serveur de la chaîne ne répond pas sur ${SERVEUR} : lance « npm run chaine » dans Lun'Anima, ` +
          `avec CHAINE_DIR=${DIR}.`,
      );
    // The page empties `dist`: it is built before the probe.
    construire([]);
    construire(['--config', 'vite.sonde.config.ts']);
    SONDE = readFileSync('dist/sonde/sonde.js', 'utf8');
    const [pv, pp] = [await libre(), await libre()];
    PAGE = `http://127.0.0.1:${pp}`;
    voix = spawn(
      'uv',
      ['run', 'voix/service.py', '--stt', STT, '--tts', TTS, '--port', String(pv), '--origin', PAGE],
      { stdio: 'inherit' },
    );
    apercu = spawn(process.execPath, [VITE, 'preview', '--port', String(pp), '--strictPort'], {
      env: { ...ENV, CORE_URL: SERVEUR, VOIX_URL: `http://127.0.0.1:${pv}` },
      stdio: 'ignore',
    });
    await attendre(`http://127.0.0.1:${pv}/ping`, 180_000, voix);
    await attendre(PAGE, 30_000, apercu);
    const code = readFileSync(join(DIR, 'serveur', 'code'), 'utf8').trim();
    const r = await fetch(`${SERVEUR}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, client: 'chaine' }),
    });
    jeton = r.ok ? ((await r.json()) as { token: string }).token : '';
    if (!jeton)
      throw new Error(`Appairage refusé (${r.status}) : relance « npm run chaine » dans Lun'Anima.`);
    const { chromium } = await import('playwright-core');
    navigateur = await chromium.launch({ channel: 'chrome', headless: true, args: ARGS });
  }, 600_000);

  afterAll(async () => {
    await navigateur?.close();
    arreter(apercu);
    arreter(voix);
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, 'releve-chaine.md'), releveChaine(parties));
    for (const p of parties)
      if ('chaine' in p)
        writeFileSync(join(DIR, `deroule-chaine-${p.scenario.nom}.jsonl`), deroule(p.chaine));
    console.log(`Relevé et déroulés écrits dans ${DIR}.`);
  });

  /** One game in a fresh context: the probe plays `plan`, or Chromium's fake device plays `fichier`. */
  async function partie(
    s: Scenario,
    plan: Plan,
    sons: Sons,
    temoinDe?: { fichier: string; premier: number; fin: number },
  ): Promise<{ partie: Partie; sortieMs?: number; inattendus: LigneServeur[] }> {
    const nom = temoinDe ? `${s.nom}-temoin` : s.nom;
    writeFileSync(join(DIR, 'serveur', 'partie.json'), JSON.stringify({ nom, reponses: plan.reponses }));
    // The server empties its journal only when it starts: a suite before this one wrote the same `partie`.
    const JOURNAL = join(DIR, 'serveur', 'journal.jsonl');
    const deja = readFileSync(JOURNAL).length;
    const { chromium } = await import('playwright-core');
    const nav = temoinDe
      ? await chromium.launch({
          channel: 'chrome',
          headless: true,
          args: [
            ...ARGS,
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${temoinDe.fichier}%noloop`,
          ],
        })
      : navigateur!;
    const ctx = await nav.newContext({ acceptDownloads: true });
    try {
      await ctx.grantPermissions(['microphone'], { origin: PAGE });
      const reglages = merged(merged(DEFAULTS, s.reglages), {
        brain: 'linked',
        busy: { on: false },
        speak: { ritual: false },
      });
      const stockage = {
        'luxuria.token': jeton,
        'luxuria.mic': 'on',
        'luxuria.settings': JSON.stringify(reglages),
      };
      await ctx.addInitScript(
        (st) => Object.entries(st).forEach(([k, v]) => localStorage.setItem(k, v)),
        stockage,
      );
      await ctx.addInitScript({
        content: temoinDe ? PREMIERE_TRAME : `${SONDE};window.__sonde(${JSON.stringify(plan)});`,
      });
      const wavs = fichiers(sons);
      await ctx.route('**/banc/sons/*', (r) =>
        r.fulfill({
          body: Buffer.from(wavs[Number(r.request().url().split('/').pop()!.split('.')[0])]!),
          contentType: 'audio/wav',
        }),
      );
      if (s.voix)
        await ctx.route('**/voix/tts', async (r) => {
          const { text } = JSON.parse(r.request().postData() ?? '{}') as { text: string };
          await pause(s.voix?.syntheseMs ?? DEFAUTS.syntheseMs);
          if (s.voix?.echoue?.includes(text)) return r.fulfill({ status: 500 });
          return r.fulfill({ body: sonFaux(s, text), headers: { 'x-sample-rate': '22050' } });
        });
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') console.error(`page (${nom}) :`, m.text());
      });
      page.on('pageerror', (err) => console.error(`page (${nom}) :`, err.message));
      await page.goto(PAGE);
      await page
        .getByRole('button', { name: 'Entrer', exact: true })
        .click({ timeout: 15_000 })
        .catch(async (err: Error) => {
          throw new Error(`${err.message}\nLa page : ${await page.locator('body').innerText()}`);
        });

      const t0 = temoinDe
        ? (await page
            .waitForFunction(() => (window as unknown as { __premiere?: number }).__premiere, null, {
              timeout: 60_000,
            })
            .then((h) => h.jsonValue() as Promise<number>)) - temoinDe.premier
        : await page.evaluate(async () => {
            for (let i = 0; i < 300; i++)
              try {
                return await window.__banc!.jouer();
              } catch (err) {
                if (!/micro/.test((err as Error).message)) throw err;
                await new Promise((r) => setTimeout(r, 100));
              }
            throw new Error("le micro de la page ne s'ouvre pas");
          });
      const maintenant = () => page.evaluate(() => performance.now());
      for (const p of s.modele?.parle ?? [])
        setTimeout(
          () =>
            void fetch(`${SERVEUR}/api/chaine/parle`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
              body: JSON.stringify({ pourquoi: p.pourquoi, phrases: p.phrases }),
            }),
          Math.max(0, t0 + p.a - (await maintenant())),
        );
      await finDePartie(page, s, plan, t0, temoinDe?.fin);
      const sonde = temoinDe ? [] : await page.evaluate(() => window.__banc!.fin());
      const sortieMs = temoinDe ? undefined : await page.evaluate(() => window.__banc!.sortieAnnonceeMs);
      const fin = await maintenant();
      const [tete, ...lignes] = (await exporter(page)).trim().split('\n');
      const format = (JSON.parse(tete!) as { format: number }).format;
      const trace = lignes.map((l) => JSON.parse(l) as TraceEvent);
      const serveur = readFileSync(JOURNAL)
        .subarray(deja)
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LigneServeur)
        .filter((l) => l.partie === nom);
      return {
        partie: fondre(trace, format, sonde, serveur, t0, fin),
        ...(sortieMs === undefined ? {} : { sortieMs: Math.round(sortieMs) }),
        inattendus: serveur.filter((l) => l.name === 'modele_inattendu'),
      };
    } finally {
      await ctx.close();
      if (temoinDe) await nav.close();
    }
  }

  it.each(
    Object.values(scenarios)
      .filter((s) => !CHOISIS || CHOISIS.includes(s.nom))
      .map((s) => [s.nom, s] as const),
  )(
    '%s',
    async (_, s) => {
      const raison = pourquoiPas(s);
      if (raison) return void parties.push({ scenario: s, raison });
      const sons = await sonsDe(s, DIR, synthSapi);
      const plan = planDePartie(s, sons);
      if ('manque' in plan) return void parties.push({ scenario: s, raison: plan.manque.join(', ') });
      const jeu = await partie(s, plan, sons);
      const exacte = await jouer(s);
      const jouee: Jouee = {
        scenario: s,
        verdicts: juger(s, jeu.partie, 'chaine'),
        chaine: jeu.partie,
        exacte,
        transcription: STT,
        synthese: s.voix ? 'fausse' : 'piper',
        ...(jeu.sortieMs === undefined ? {} : { latenceSortieMs: jeu.sortieMs }),
      };
      if (s.nom === 'deux-phrases') jouee.temoin = await temoinDeuxPhrases(s, sons, jeu.partie, exacte, plan);
      parties.push(jouee);
      expect(jeu.inattendus, 'demandes au modèle sans réponse prévue').toEqual([]);
      expect(jouee.verdicts.every(passe), releveChaine([jouee])).toBe(true);
    },
    240_000,
  );

  /**
   * The witness: the same speeches at the instants the probe's game gave them (its anchors resolved), in one file
   * Chromium's fake device plays, echo and noise on; re-timed on the first frame of sound the page gets.
   */
  async function temoinDeuxPhrases(s: Scenario, sons: Sons, chaine: Partie, exacte: Partie, plan: Plan) {
    // Each speech where the probe posed it, so both ways hear the same; one it skipped, at its exact instant.
    const pose = (i: number) =>
      chaine.banc.find((e) => e.name === 'parole' && e['parole'] === i + 1 && e['etape'] === 'debut')?.at;
    const absolu: Scenario = {
      ...s,
      personne: s.personne.map(({ apres, ...p }, i) =>
        apres ? { ...p, a: pose(i) ?? Math.round(ancre(apres, exacte.banc) ?? 0) } : p,
      ),
    };
    const fichier = join(DIR, `temoin-${s.nom}.wav`);
    writeFileSync(fichier, temoin(absolu, sons));
    const ends = absolu.personne.map((p, i) => p.a! + (sons.personne[i] as { duree: number }).duree);
    const premier = Math.min(...absolu.personne.map((p) => p.a!));
    const fin = Math.max(...ends) + DEFAUTS.finApresMs;
    return (await partie(absolu, plan, sons, { fichier, premier, fin })).partie;
  }
});

const ARGS = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'];

/** For the witness, no probe: the instant of the first frame of the page that carries sound. */
const PREMIERE_TRAME = `{
  const W = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends W {
    constructor(c, n, o) {
      super(c, n, o);
      if (n !== 'frames') return;
      this.port.addEventListener('message', (e) => {
        if (window.__premiere === undefined && e.data.some((v) => Math.abs(v) > ${SILENCE_TRAME}))
          window.__premiere = performance.now();
      });
    }
  };
}`;

/** The end of a game: every sound posed and `finApresMs` after the last (or `jusqua`), at most `PLAFOND_MS`. */
async function finDePartie(page: Page, s: Scenario, plan: Plan, t0: number, finTemoin?: number) {
  for (;;) {
    await pause(250);
    const [now, j] = await page.evaluate(() => [performance.now(), window.__banc?.journal ?? []] as const);
    if (now >= t0 + PLAFOND_MS) return;
    if (finTemoin !== undefined) {
      if (now >= t0 + finTemoin) return;
      continue;
    }
    if (s.jusqua !== undefined) {
      if (now >= t0 + s.jusqua) return;
      continue;
    }
    const sons = j.filter((e) => e.name === 'parole' || e.name === 'bruit_joue');
    const fins = sons.filter((e) => e['etape'] === 'fin').map((e) => e.at);
    if (fins.length < plan.poses.length || now < Math.max(...fins) + DEFAUTS.finApresMs) continue;
    // Her voice comes later than at the exact level: the game also waits for it to fall silent, every sound stopped.
    const [joue, arrete] = [j.filter((e) => e.name === 'joue'), j.filter((e) => e.name === 'arrete')];
    if (joue.length === arrete.length && now >= Math.max(0, ...arrete.map((e) => e.at)) + CALME_MS) return;
  }
}

/** The page's trace, by its export button (the listening's advanced settings). */
async function exporter(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('link', { name: 'Écoute' }).first().click();
  await page.getByText('Réglages avancés : fin de phrase').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  return readFileSync((await (await dl).path())!, 'utf8');
}

/** The page's trace and the probe's and server's lines in one file, after a line that says the format. */
const deroule = (p: Partie) =>
  [{ format: p.format }, ...[...p.page, ...p.banc].sort((x, y) => x.at - y.at)]
    .map((e) => JSON.stringify(e))
    .join('\n') + '\n';
