import { vi } from 'vitest';
import { Conversation } from '../conversation.ts';
import { ENDPOINT_DEFAULTS, Endpointer } from '../listen/endpoint.ts';
import { DEFAULTS, type Settings } from '../settings.ts';
import { Speaker } from '../speech/speaker.ts';
import { Trace, TRACE_FORMAT } from '../trace.ts';
import { FausseVoix, FauxServeur, fausseTranscription, Journal, trame } from './fakes.ts';
import { ancre, DEFAUTS, merged, type Apres, type Partie, type Scenario } from './scenario.ts';

/**
 * Plays a scenario through the real `Endpointer`, `Conversation` and `Speaker`, wired as the session wires them, on
 * vitest's false clock: only the voice probability, the transcription, the server, the synthesis and the output are
 * false. It imports `vi`, so it never plays in real time: step 3 takes the scenarios and the bricks, not the player.
 */

/**
 * The end of the game: `jusqua`, or `DEFAUTS.finApresMs` after the last event planned at an instant. An anchored
 * speech or gesture pushes it back when it is placed.
 */
function fin(s: Scenario): number {
  if (s.jusqua !== undefined) return s.jusqua;
  const ends = [
    ...s.personne.flatMap((p) => (p.a === undefined ? [] : [p.a + p.duree])),
    ...(s.bruits ?? []).map((b) => b.a + b.duree),
    ...(s.modele?.parle ?? []).map((p) => p.a),
    ...(s.gestes ?? []).flatMap((g) => (g.a === undefined ? [] : [g.a])),
  ];
  return Math.max(0, ...ends) + DEFAUTS.finApresMs;
}

export async function jouer(s: Scenario): Promise<Partie> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(0);
  try {
    return await partie(s);
  } finally {
    vi.useRealTimers();
  }
}

async function partie(s: Scenario): Promise<Partie> {
  const now = () => Date.now();
  const settings = merged(DEFAULTS, s.reglages) as Settings;
  const layout = s.disposition ?? DEFAUTS.disposition;
  // A game keeps every turn it plays.
  const trace = new Trace(now, Infinity);
  // The bricks read the speeches' instants when they need them: an anchored one gets its own once placed.
  const personne = s.personne.map((p) => ({ ...p }));
  const jeu: Scenario = { ...s, personne };
  /** What waits for its anchor: a line of the log may bring it. */
  const attente: { apres: Apres; poser: (a: number) => void }[] = [];
  const journal = new Journal(now, () => {
    for (const w of [...attente]) {
      const a = ancre(w.apres, journal.events);
      if (a === undefined) continue;
      attente.splice(attente.indexOf(w), 1);
      w.poser(Math.max(a, now()));
    }
  });
  // As `session.svelte.ts` (#params).
  const e = settings.endOfSpeech;
  const endpointer = new Endpointer({
    ...ENDPOINT_DEFAULTS,
    pauseMs: e.pauseMs,
    silenceMs: e.silenceMs,
    minSpeechMs: e.minSpeechMs,
    holdMs: settings.bargeIn.holdMs,
  });
  const frameMs = ENDPOINT_DEFAULTS.frameMs;

  // The speaker writes `son` for the reply just before it gives the sound to the output.
  const sounding = () => {
    const last = trace.events.at(-1);
    return last?.name === 'son' ? last.reponse : undefined;
  };
  const voix = new FausseVoix(jeu, journal, sounding, now);
  const serveur = new FauxServeur(jeu, journal, (ev) => convo.onLive(ev));
  const convo: Conversation = new Conversation({
    brain: serveur,
    stt: fausseTranscription(jeu, voix, frameMs),
    speaker: new Speaker(voix.synth, voix.output, (ev) => convo.onSpeaker(ev), trace),
    trace,
    settings: () => settings,
    layout: () => layout,
    keyHeld: () => false,
    now,
    on: () => {},
  });

  // The world: what the person says, her gestures and the noises, in the log at their instants.
  const at = (ms: number, f: () => void) => setTimeout(f, ms);
  let end = fin(s);
  const plusTard = (ms: number) => {
    if (s.jusqua === undefined) end = Math.max(end, ms + DEFAUTS.finApresMs);
  };
  const sautes: (() => void)[] = [];
  for (const [i, p] of personne.entries()) {
    const poser = (a: number) => {
      p.a = a;
      at(a - now(), () => journal.add('parole', { etape: 'debut', parole: i + 1 }));
      at(a + p.duree - now(), () => journal.add('parole', { etape: 'fin', parole: i + 1 }));
      plusTard(a + p.duree);
    };
    if (p.apres) {
      const w = { apres: p.apres, poser };
      attente.push(w);
      sautes.push(() => attente.includes(w) && journal.add('parole_sautee', { parole: i + 1 }));
    } else poser(p.a!);
  }
  for (const g of s.gestes ?? []) {
    // As the « Faire taire » button (`session.svelte.ts`, `silence`).
    const poser = (a: number) => {
      at(a - now(), () => {
        journal.add('geste', { geste: g.geste, etape: 'fait' });
        convo.silence();
      });
      plusTard(a);
    };
    if (g.apres) {
      const w = { apres: g.apres, poser };
      attente.push(w);
      sautes.push(() => attente.includes(w) && journal.add('geste', { geste: g.geste, etape: 'saute' }));
    } else poser(g.a!);
  }
  for (const b of s.bruits ?? []) {
    at(b.a, () => journal.add('bruit_joue', { etape: 'debut' }));
    at(b.a + b.duree, () => journal.add('bruit_joue', { etape: 'fin' }));
  }
  serveur.parler();

  /** The microphone's voice at an instant: the highest of what sounds then. */
  const voice = (t: number) => {
    let v = 0;
    for (const p of personne) {
      const a = p.a;
      if (a === undefined) continue;
      const inHole = (p.trous ?? []).some((h) => t >= a + h.a && t < a + h.a + h.duree);
      if (t >= a && t < a + p.duree && !inHole) v = Math.max(v, p.voix ?? DEFAUTS.voix);
    }
    for (const b of s.bruits ?? []) if (t >= b.a && t < b.a + b.duree) v = Math.max(v, b.voix);
    if (s.echo && voix.sonne) v = Math.max(v, s.echo.voix);
    return v;
  };

  // As `session.svelte.ts` (#onFrame, #judged): read when it comes, judged after the frames before it.
  const modeleMs = s.modeleMs ?? DEFAUTS.modeleMs;
  let frames: Promise<void> = Promise.resolve();
  let erreur: string | undefined;
  const frame = (t: number) => {
    const v = voice(t);
    frames = frames.then(async () => {
      // The page stopped deciding: nothing after this frame would mean anything.
      if (erreur !== undefined) return;
      try {
        if (modeleMs > 0) await new Promise((r) => setTimeout(r, modeleMs));
        for (const ev of endpointer.push(trame(t), v, t, now())) convo.onEndpoint(ev);
      } catch (err) {
        erreur = `trame ${t} : ${err instanceof Error ? err.message : String(err)}`;
      }
    });
    if (t + frameMs < end) at(frameMs, () => frame(t + frameMs));
  };
  at(0, () => frame(0));

  // A speech placed late pushes the end back while the game runs.
  while (now() < end) await vi.advanceTimersByTimeAsync(end - now());
  for (const saute of sautes) saute();
  return {
    format: TRACE_FORMAT,
    page: [...trace.events],
    banc: [...journal.events],
    fin: end,
    ...(erreur !== undefined && { erreur }),
  };
}
