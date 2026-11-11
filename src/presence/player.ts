import { vi } from 'vitest';
import { Conversation } from '../conversation.ts';
import { ENDPOINT_DEFAULTS, Endpointer } from '../listen/endpoint.ts';
import { DEFAULTS, type Settings } from '../settings.ts';
import { Speaker } from '../speech/speaker.ts';
import { Trace, TRACE_FORMAT } from '../trace.ts';
import { FausseVoix, FauxServeur, fausseTranscription, Journal, trame } from './fakes.ts';
import { DEFAUTS, type Partie, type Scenario } from './scenario.ts';

/**
 * Plays a scenario through the real `Endpointer`, `Conversation` and `Speaker`, wired as the session wires them, on
 * vitest's false clock: only the voice probability, the transcription, the server, the synthesis and the output are
 * false. It imports `vi`, so it never plays in real time: step 3 takes the scenarios and the bricks, not the player.
 */

const merged = (base: unknown, over: unknown): unknown =>
  over && typeof over === 'object' && !Array.isArray(over)
    ? Object.fromEntries(
        [...new Set([...Object.keys(base as object), ...Object.keys(over)])].map((k) => [
          k,
          merged((base as Record<string, unknown>)[k], (over as Record<string, unknown>)[k]),
        ]),
      )
    : over === undefined
      ? base
      : over;

/** The end of the game: `jusqua`, or `DEFAUTS.finApresMs` after the last planned event. */
function fin(s: Scenario): number {
  if (s.jusqua !== undefined) return s.jusqua;
  const ends = [
    ...s.personne.map((p) => p.a + p.duree),
    ...(s.bruits ?? []).map((b) => b.a + b.duree),
    ...(s.modele?.parle ?? []).map((p) => p.a),
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
  const journal = new Journal(now);
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
  const voix = new FausseVoix(s, journal, sounding, now);
  const serveur = new FauxServeur(s, journal, (ev) => convo.onLive(ev));
  const convo: Conversation = new Conversation({
    brain: serveur,
    stt: fausseTranscription(s, voix, frameMs),
    speaker: new Speaker(voix.synth, voix.output, (ev) => convo.onSpeaker(ev), trace),
    trace,
    settings: () => settings,
    layout: () => layout,
    keyHeld: () => false,
    now,
    on: () => {},
  });

  // The world: what the person says and the noises, in the log at their instants.
  const at = (ms: number, f: () => void) => setTimeout(f, ms);
  for (const [i, p] of s.personne.entries()) {
    at(p.a, () => journal.add('parole', { etape: 'debut', parole: i + 1 }));
    at(p.a + p.duree, () => journal.add('parole', { etape: 'fin', parole: i + 1 }));
  }
  for (const b of s.bruits ?? []) {
    at(b.a, () => journal.add('bruit_joue', { etape: 'debut' }));
    at(b.a + b.duree, () => journal.add('bruit_joue', { etape: 'fin' }));
  }
  serveur.parler();

  /** The microphone's voice at an instant: the highest of what sounds then. */
  const voice = (t: number) => {
    let v = 0;
    for (const p of s.personne) {
      const inHole = (p.trous ?? []).some((h) => t >= p.a + h.a && t < p.a + h.a + h.duree);
      if (t >= p.a && t < p.a + p.duree && !inHole) v = Math.max(v, p.voix ?? DEFAUTS.voix);
    }
    for (const b of s.bruits ?? []) if (t >= b.a && t < b.a + b.duree) v = Math.max(v, b.voix);
    if (s.echo && voix.sonne) v = Math.max(v, s.echo.voix);
    return v;
  };

  // As `session.svelte.ts` (#onFrame, #judged): read when it comes, judged after the frames before it.
  const modeleMs = s.modeleMs ?? DEFAUTS.modeleMs;
  const end = fin(s);
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

  await vi.advanceTimersByTimeAsync(end);
  return {
    format: TRACE_FORMAT,
    page: [...trace.events],
    banc: [...journal.events],
    fin: end,
    ...(erreur !== undefined && { erreur }),
  };
}
