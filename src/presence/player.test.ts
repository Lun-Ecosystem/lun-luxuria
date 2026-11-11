import { afterEach, describe, expect, it, vi } from 'vitest';
import { Speaker } from '../speech/speaker.ts';
import { Trace, TRACE_FORMAT, type TraceEvent } from '../trace.ts';
import { FausseVoix, Journal } from './fakes.ts';
import { jouer } from './player.ts';
import type { BancEvent, Scenario } from './scenario.ts';

const base = (over: Partial<Scenario>): Scenario => ({
  nom: 'essai',
  source: '',
  apport: '',
  mecanismes: ['ecoute'],
  personne: [],
  attendus: [],
  ...over,
});

const named = (events: readonly (TraceEvent | BancEvent)[], name: string) =>
  events.filter((e) => e.name === name);

describe('the false clock', () => {
  afterEach(() => void vi.useRealTimers());

  // The risk of the plan: the speaker's `then` chain must run between two due timers, or every sound would be late.
  it("follows the speaker's chain of promises to the millisecond", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    const now = () => Date.now();
    const trace = new Trace(now);
    const journal = new Journal(now);
    const s = base({ voix: { syntheseMs: 150, msParCaractere: 60 } });
    const voix = new FausseVoix(s, journal, () => 7, now);
    const speaker = new Speaker(voix.synth, voix.output, () => {}, trace);
    speaker.add(7, 'Un.');
    speaker.add(7, 'Deux.');
    speaker.end(7);
    await vi.advanceTimersByTimeAsync(2000);
    const sons = named(trace.events, 'son').map((e) => [e.at, e['etape']]);
    // 'Un.' made at 150, sounds 3 × 60 ms; 'Deux.' made at 300 meanwhile, sounds at 330 for 5 × 60 ms.
    expect(sons).toEqual([
      [150, 'debut'],
      [330, 'fin'],
      [330, 'debut'],
      [630, 'fin'],
    ]);
    expect(journal.events.map((e) => [e.at, e.name, e['texte']])).toEqual([
      [150, 'joue', 'Un.'],
      [330, 'arrete', undefined],
      [330, 'joue', 'Deux.'],
      [630, 'arrete', undefined],
    ]);
    expect(named(trace.events, 'silence')[0]!.at).toBe(630);
  });
});

describe('jouer', () => {
  const parole = base({ personne: [{ a: 1000, dit: 'bonjour', duree: 1000 }] });

  it('gives the voice, and the end 704 ms after its last frame of voice', async () => {
    const { format, page, banc } = await jouer(parole);
    expect(format).toBe(TRACE_FORMAT);
    // The first frame at or after 1000 ms: 32 × 32.
    expect(named(page, 'voix')[0]!.at).toBe(1024);
    const fin = named(page, 'fin')[0]!;
    expect(fin['dernier_son']).toBe(1984);
    expect(fin.at - (fin['dernier_son'] as number)).toBe(704);
    expect(named(banc, 'parole').map((e) => [e.at, e['etape'], e['parole']])).toEqual([
      [1000, 'debut', 1],
      [2000, 'fin', 1],
    ]);
  });

  it('lets a voice model slower than a frame pile up its delay', async () => {
    const { page } = await jouer({ ...parole, modeleMs: 40 });
    const fin = named(page, 'fin')[0]!;
    // Each frame waits for the one before: the n-th (from 0) is decided at 40 × (n + 1). The last voiced is the
    // 62nd (1984 ms), the one that ends the 84th (2688 ms), decided at 3400 ms.
    expect(fin['dernier_son']).toBe(1984);
    expect(fin['son']).toBe(2688);
    expect(fin.at).toBe(3400);
  });

  it('gives the same lines twice', async () => {
    const s = base({
      mecanismes: ['ecoute', 'serveur', 'voix'],
      personne: [{ a: 500, dit: 'quelle heure', duree: 800 }],
      modele: { reponses: [{ phrases: ['Il est midi.', 'Bonne journée.'] }] },
    });
    const a = await jouer(s);
    const b = await jouer(s);
    expect(a).toEqual(b);
    expect(named(a.page, 'premier_son')).toHaveLength(1);
  });

  it('transcribes at a pause only the speech begun', async () => {
    const { banc } = await jouer(
      base({
        personne: [
          { a: 1000, dit: 'un', duree: 500 },
          { a: 1800, dit: 'deux', duree: 500 },
        ],
      }),
    );
    expect(named(banc, 'envoi_recu').map((e) => e['texte'])).toEqual(['un', 'un deux']);
    expect(named(banc, 'retrait_recu')).toHaveLength(1);
  });

  it('hears its echo while it sounds, and no longer once it stops', async () => {
    const { page, banc } = await jouer(
      base({
        personne: [{ a: 500, dit: 'salut', duree: 600 }],
        echo: { voix: 0.7 },
        // Her own words heard back get no answer: one sound only.
        modele: { reponses: [{ si: 'salut', phrases: ['Il fait beau.'] }] },
      }),
    );
    const echo = named(banc, 'echo');
    expect(echo.map((e) => e['etape'])).toEqual(['debut', 'fin']);
    expect(echo[0]!.at).toBe(named(banc, 'joue')[0]!.at);
    expect(echo[1]!.at).toBe(named(banc, 'arrete')[0]!.at);
    // The next frame (32 ms grid) hears it: her own words, transcribed and sent.
    expect(named(page, 'voix').map((e) => e.at)).toEqual([512, 1952]);
    expect(named(banc, 'envoi_recu').map((e) => e['texte'])).toEqual(['salut', 'Il fait beau.']);
    // Its sentence lasts as long as the echo: its last voice is the frame where the sound stopped.
    expect(named(page, 'fin')[1]!['dernier_son']).toBe(echo[1]!.at);
  });

  it('lets a tool of the PC run between two sentences, and gives its durations', async () => {
    const { page } = await jouer(
      base({
        personne: [{ a: 500, dit: 'des mails', duree: 600 }],
        modele: { reponses: [{ phrases: ['Je regarde.', 'Tu en as deux.'], poste: { apres: 1, ms: 2500 } }] },
      }),
    );
    const [un, deux] = named(page, 'phrase_recue');
    // The tool, then the model's first word again.
    expect(deux!.at - un!.at).toBe(2500 + 400);
    expect(named(page, 'durees')[0]).toMatchObject({ firstWordMs: 400, postMs: 2500, secondWordMs: 400 });
  });

  it('plays 60 virtual seconds in under a second', async () => {
    const personne = Array.from({ length: 10 }, (_, i) => ({
      a: 1000 + i * 5500,
      dit: `phrase ${i}`,
      duree: 1200,
    }));
    const from = performance.now();
    const { page } = await jouer(
      base({
        personne,
        modele: { reponses: [{ phrases: ['Oui.', 'Bien sûr.'] }] },
        jusqua: 60_000,
      }),
    );
    expect(performance.now() - from).toBeLessThan(1000);
    expect(named(page, 'fin')).toHaveLength(10);
  });
});
