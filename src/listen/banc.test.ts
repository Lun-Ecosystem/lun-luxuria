// @vitest-environment node
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENDPOINT_DEFAULTS, levelToVoice } from './endpoint.ts';
import { decide } from './filter.ts';
import { FRAME_MS, readWav, replay, writeWav, type Heard } from './replay.ts';
import { FRAME, loadSilero, SileroVoice } from './vad.ts';
import { Conversation } from '../conversation.ts';
import { DEFAULTS } from '../settings.ts';
import { Speaker } from '../speech/speaker.ts';

const MODEL = readFileSync('src/listen/silero/silero_vad.onnx');
const byLevel = (frame: Float32Array) => levelToVoice(frame, DEFAULTS.endOfSpeech.floorDb);
async function byModel() {
  const silero = new SileroVoice(await loadSilero(MODEL));
  return (frame: Float32Array, listening: boolean) => silero.voice(frame, listening);
}

/** The same noise every time. */
function noise(seconds: number, level: number, seed = 1): Float32Array {
  let x = seed;
  return Float32Array.from({ length: seconds * 16000 }, () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return (x / 2147483648 - 1) * level;
  });
}

describe('a file of sound', () => {
  it('is read back as it was written, and brought to 16 kHz', () => {
    const own = Float32Array.from({ length: FRAME * 3 }, (_, i) => Math.sin(i / 10) / 2);
    const back = readWav(writeWav([own.subarray(0, FRAME), own.subarray(FRAME)]));
    expect(back).toHaveLength(own.length);
    expect(Math.abs(back[100]! - own[100]!)).toBeLessThan(1e-4);

    // A slope at 48 kHz keeps its slope at 16 kHz: one sample in three.
    const at48k = writeWav([Float32Array.from({ length: 4800 }, (_, i) => i / 9600)]);
    new DataView(at48k.buffer).setUint32(24, 48000, true);
    const slow = readWav(at48k);
    expect(slow).toHaveLength(1600);
    expect(Math.abs(slow[800]! - 2400 / 9600)).toBeLessThan(1e-3);
  });
});

describe('hearing a voice', () => {
  // Nobody's voice: a breath of two seconds between two silences.
  const breath = Float32Array.from([
    ...new Float32Array(16000),
    ...noise(2, 0.2),
    ...new Float32Array(16000),
  ]);

  it('the level takes a breath for a sentence, the model does not', async () => {
    const level = await replay(breath, byLevel, ENDPOINT_DEFAULTS);
    expect(level.sentences).toHaveLength(1);
    expect(level.held).toBe(1);

    const model = await replay(breath, await byModel(), ENDPOINT_DEFAULTS);
    expect(model.sentences).toHaveLength(0);
    expect(model.held).toBe(0);
  });

  it('gives the model the end of the window before, and clears its memory once it is quiet', async () => {
    const inputs: Float32Array[] = [];
    const states: number[] = [];
    const silero = new SileroVoice(async (input, state) => {
      inputs.push(input);
      states.push(state[0]!);
      return { voice: 0, state: Float32Array.from({ length: 256 }, () => inputs.length) };
    });
    await silero.voice(new Float32Array(FRAME).fill(0.5), false);
    await silero.voice(new Float32Array(FRAME).fill(0.25), false);
    expect(inputs[1]).toHaveLength(64 + FRAME);
    expect([inputs[1]![0], inputs[1]![63], inputs[1]![64]]).toEqual([0.5, 0.5, 0.25]);
    expect(states).toEqual([0, 1]);

    // Two seconds of sound later, quiet all along: its memory starts afresh. Not while a sentence is heard.
    for (let i = 2; i < 80; i++) await silero.voice(new Float32Array(FRAME), i < 70);
    expect(states.filter((s) => s === 0)).toHaveLength(2);
    expect(inputs.at(-1)![0]).toBe(0);
  });

  it('does not clear its memory on one quiet window, nor bring the old one back after a reset', async () => {
    let voice = 0.5;
    let calls = 0;
    let release: (() => void) | undefined;
    const states: number[] = [];
    const silero = new SileroVoice(async (_, state) => {
      states.push(state[0]!);
      calls++;
      if (release === undefined && calls === 71) await new Promise<void>((r) => (release = r));
      return { voice, state: new Float32Array(256).fill(7) };
    });
    // Two seconds of sound that is never clearly quiet: no reset, even with nobody talking.
    for (let i = 0; i < 70; i++) {
      voice = i % 4 === 0 ? 0.05 : 0.5;
      await silero.voice(new Float32Array(FRAME), false);
    }
    expect(states.filter((s) => s === 0)).toHaveLength(1);

    // The listening starts afresh while a window is still being judged: that window does not undo it.
    const late = silero.voice(new Float32Array(FRAME), false);
    await new Promise((r) => setTimeout(r));
    silero.reset();
    release!();
    await late;
    await silero.voice(new Float32Array(FRAME), false);
    expect(states.at(-1)).toBe(0);
  });
});

describe('the clock of a replay', () => {
  it('is the place in the sound, for the listening and the conversation alike', async () => {
    // A breath the level takes for a sentence, from 1 s to 3 s.
    const sound = Float32Array.from([
      ...new Float32Array(16000),
      ...noise(2, 0.2),
      ...new Float32Array(16000),
    ]);
    let soundAt = 0;
    const latencies: number[] = [];
    const ends: { at: number; decidedAt: number; lastVoiceAt: number; now: number }[] = [];
    const convo: Conversation = new Conversation({
      brain: {
        send: async (_text, _opts, on) => {
          on({ type: 'reply', id: 7 });
          convo.onLive({ type: 'speech', id: 7, n: 1, text: 'Oui.', why: 'reply' });
        },
        cut: async () => {},
        withdraw: async () => {},
      },
      stt: async () => ({ text: 'Bonjour', confidence: 0.9 }),
      speaker: new Speaker(
        async () => ({ samples: new Float32Array(1), rate: 16000 }),
        { play: () => ({ stop: () => {}, heard: () => 1 }) },
        (e) => convo.onSpeaker(e),
      ),
      settings: () => DEFAULTS,
      layout: () => 'scene',
      keyHeld: () => false,
      now: () => soundAt,
      on: (e) => void (e.type === 'latency' && latencies.push(e.ms)),
    });
    await replay(
      sound,
      byLevel,
      ENDPOINT_DEFAULTS,
      (e) => {
        if (e.type === 'end')
          ends.push({ at: e.at, decidedAt: e.decidedAt, lastVoiceAt: e.lastVoiceAt, now: soundAt });
        convo.onEndpoint(e);
      },
      (at) => (soundAt = at),
    );
    expect(ends).toHaveLength(1);
    const end = ends[0]!;
    expect(end.lastVoiceAt).toBeGreaterThan(2900);
    expect(end.at).toBe(end.now);
    expect(end.decidedAt).toBe(end.at);
    expect(end.at - end.lastVoiceAt).toBeGreaterThanOrEqual(ENDPOINT_DEFAULTS.silenceMs);
    // The reply sounds at once, at the moment the sentence ended: no more a clock stuck at zero.
    expect(latencies).toHaveLength(1);
    expect(latencies[0]).toBeGreaterThanOrEqual(ENDPOINT_DEFAULTS.silenceMs);
  });
});

/**
 * The bench: `npm run banc`. Every WAV of a folder kept out of the repository, through the listening as it was
 * (the level) and as it is (the model). A `fiche.json` beside the files, or `<name>.json` for one file, says what is
 * expected: `{ "phrases": 1, "textes": ["…"] }`.
 */
const DIR = process.env['BANC_DIR'] ?? '../banc-sons';
const asked = import.meta.env.MODE === 'banc';

interface Fiche {
  phrases?: number;
  textes?: string[];
}
const wavs = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? wavs(path) : name.endsWith('.wav') ? [path] : [];
  });
const json = (path: string): Fiche =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Fiche) : {};
const ms = (n: number) => `${(n / 1000).toFixed(2)} s`;

function row(how: string, heard: Heard, fiche: Fiche): string {
  const sentences = heard.sentences.map((s) => `${ms(s.from)} à ${ms(s.to)}`).join(' ; ') || 'aucune';
  const verdict =
    fiche.phrases === undefined ? '' : heard.sentences.length === fiche.phrases ? 'juste' : '**faux**';
  const filtered = (fiche.textes ?? [])
    .map((text) =>
      decide(text, { layout: 'small', keyHeld: false, lastSpokeAt: null, now: 0 }, DEFAULTS).pass
        ? 'pour elle'
        : 'écartée',
    )
    .join(', ');
  return `| ${how} | ${heard.sentences.length} | ${sentences} | ${heard.noises} | ${heard.resumed} | ${heard.held} | ${verdict} | ${filtered} |`;
}

describe.runIf(asked)('the bench', () => {
  it('replays every recording of the folder, both ways', async () => {
    if (!existsSync(DIR)) {
      console.log(`Pas de dossier d'enregistrements (${DIR}) : rien à rejouer. BANC_DIR en donne un autre.`);
      return;
    }
    const lines = [
      `# Relevé du banc, ${new Date().toISOString().slice(0, 16)}`,
      '',
      `Seuils : ouvre à ${ENDPOINT_DEFAULTS.on}, ferme à ${ENDPOINT_DEFAULTS.off}, pause ${ENDPOINT_DEFAULTS.pauseMs} ms, fin ${ENDPOINT_DEFAULTS.silenceMs} ms, voix tenue ${ENDPOINT_DEFAULTS.holdMs} ms.`,
    ];
    const totals = { niveau: [0, 0], modèle: [0, 0] };
    let frames = 0;
    let spent = 0;
    // What a bound on the speculative turn would take away: sentences with more than three pauses, or over ten seconds.
    const attempts = { files: 0, overThree: 0, most: 0, overTen: 0 };
    for (const file of wavs(DIR).sort()) {
      const samples = readWav(readFileSync(file));
      const fiche = { ...json(join(file, '..', 'fiche.json')), ...json(file.replace(/\.wav$/, '.json')) };
      const level = await replay(samples, byLevel, ENDPOINT_DEFAULTS);
      const started = performance.now();
      const model = await replay(samples, await byModel(), ENDPOINT_DEFAULTS);
      spent += performance.now() - started;
      frames += Math.ceil(samples.length / FRAME);
      const pauses = model.events.filter((e) => e.type === 'pause').length;
      attempts.files++;
      attempts.most = Math.max(attempts.most, pauses);
      if (pauses > 3) attempts.overThree++;
      if (model.sentences.some((s) => s.to - s.from > 10_000)) attempts.overTen++;
      if (fiche.phrases !== undefined) {
        totals.niveau[1]!++;
        totals.modèle[1]!++;
        if (level.sentences.length === fiche.phrases) totals.niveau[0]!++;
        if (model.sentences.length === fiche.phrases) totals.modèle[0]!++;
      }
      lines.push(
        '',
        `## ${relative(DIR, file).replaceAll('\\', '/')} (${ms((samples.length / 16000) * 1000)})`,
        '',
        '| Voix lue par | Phrases | De… à… | Bruits | Reprises | Voix tenue | Verdict | Filtre |',
        '|---|---|---|---|---|---|---|---|',
        row('le niveau', level, fiche),
        row('le modèle', model, fiche),
      );
    }
    lines.splice(
      3,
      0,
      `Justes, sur les fichiers qui ont une fiche : le niveau ${totals.niveau[0]} sur ${totals.niveau[1]}, le modèle ${totals.modèle[0]} sur ${totals.modèle[1]}.`,
      `Le modèle : ${(spent / Math.max(frames, 1)).toFixed(2)} ms par trame de ${FRAME_MS} ms, modèle chargé compris.`,
      `Le tour à l'essai : ${attempts.overThree} fichiers sur ${attempts.files} ont plus de trois pauses (${attempts.most} au plus), ${attempts.overTen} ont une phrase de plus de dix secondes.`,
    );
    writeFileSync(join(DIR, 'releve.md'), `${lines.join('\n')}\n`);
    console.log(lines.slice(0, 5).join('\n'), `\nRelevé complet : ${join(DIR, 'releve.md')}`);
  }, 600_000);
});

/**
 * The same recordings, heard while she is in the middle of a reply, through the whole chain: the voice model, the end
 * of the sentence, the conversation and her voice. Only the transcription is made up: a word for a file that holds a
 * sentence, nothing for one that holds none.
 */
describe.runIf(asked)('the bench: a sound while she speaks', () => {
  it('counts what cuts her for good, what she resumes after, and what she never notices', async () => {
    if (!existsSync(DIR)) return;
    const tally = {
      sentence: { files: 0, suspended: 0, cut: 0 },
      nothing: { files: 0, suspended: 0, cut: 0 },
    };
    const missed: string[] = [];
    for (const file of wavs(DIR).sort()) {
      const fiche = { ...json(join(file, '..', 'fiche.json')), ...json(file.replace(/\.wav$/, '.json')) };
      if (fiche.phrases === undefined) continue;
      const said = fiche.phrases > 0;
      let stops = 0;
      let cut = false;
      let soundAt = 0;
      const convo: Conversation = new Conversation({
        brain: {
          send: async (_text, _opts, on) => on({ type: 'reply', id: 99 }),
          cut: async (id) => void (cut ||= id === 50),
          withdraw: async () => {},
        },
        stt: async () => ({ text: said ? 'Arrête' : '', confidence: 0.9 }),
        speaker: new Speaker(
          async () => ({ samples: new Float32Array(1), rate: 16000 }),
          { play: () => ({ stop: () => void stops++, heard: () => 0.5 }) },
          (e) => convo.onSpeaker(e),
        ),
        settings: () => DEFAULTS,
        layout: () => 'small',
        keyHeld: () => false,
        now: () => soundAt,
        on: () => {},
      });
      convo.onLive({
        type: 'speech',
        id: 50,
        n: 1,
        text: 'Une phrase assez longue pour être coupée.',
        why: 'reply',
      });
      await new Promise((r) => setTimeout(r));
      await replay(
        readWav(readFileSync(file)),
        await byModel(),
        ENDPOINT_DEFAULTS,
        (e) => convo.onEndpoint(e),
        (at) => (soundAt = at),
      );
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
      const t = tally[said ? 'sentence' : 'nothing'];
      t.files++;
      if (stops > 0) t.suspended++;
      if (cut) t.cut++;
      if (cut !== said) missed.push(relative(DIR, file).replaceAll('\\', '/'));
    }
    const lines = [
      '',
      '## Un son pendant qu’elle parle',
      '',
      `Fichiers qui portent une phrase : ${tally.sentence.files} ; sa voix s’arrête pour ${tally.sentence.suspended}, la coupure est réelle pour ${tally.sentence.cut}.`,
      `Fichiers sans phrase : ${tally.nothing.files} ; elle se tait un instant pour ${tally.nothing.suspended}, coupée pour de bon ${tally.nothing.cut} fois.`,
      missed.length ? `À côté : ${missed.join(', ')}.` : 'Aucun à côté.',
    ];
    appendFileSync(join(DIR, 'releve.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  }, 600_000);
});
