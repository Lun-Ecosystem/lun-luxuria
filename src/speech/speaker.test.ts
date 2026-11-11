import { describe, expect, it, vi } from 'vitest';
import { readingMs, Speaker, wordsHeard, type Clip, type Output, type SpeakerEvent } from './speaker.ts';

const CLIP: Clip = { samples: new Float32Array(1), rate: 16000 };
const tick = () => new Promise((r) => setTimeout(r));

function setup(synth: (t: string) => Promise<Clip> = async () => CLIP) {
  const sounds: { end: () => void; stopped: boolean; ratio: number }[] = [];
  const out: Output = {
    play(_, onEnd) {
      const s = { end: onEnd, stopped: false, ratio: 0.5 };
      sounds.push(s);
      return { stop: () => void (s.stopped = true), heard: () => s.ratio };
    },
  };
  const events: SpeakerEvent[] = [];
  const speaker = new Speaker(synth, out, (e) => events.push(e));
  const subtitles = () => events.flatMap((e) => (e.type === 'subtitle' ? [e.text] : []));
  return { speaker, sounds, events, subtitles };
}

describe('one sentence after the other', () => {
  it('in order, the next only when the previous ended, then silent', async () => {
    const t = setup();
    t.speaker.add(1, 'Un.');
    t.speaker.add(1, 'Deux.');
    t.speaker.end(1);
    await tick();
    expect(t.subtitles()).toEqual(['Un.']);
    t.sounds[0]!.end();
    await tick();
    expect(t.subtitles()).toEqual(['Un.', 'Deux.']);
    t.sounds[1]!.end();
    await tick();
    expect(t.events.at(-1)).toEqual({ type: 'silent' });
    expect(t.events.filter((e) => e.type === 'first-sound')).toHaveLength(1);
  });

  it('prepares the next sentence while the previous plays', async () => {
    const synth = vi.fn(async () => CLIP);
    const t = setup(synth);
    t.speaker.add(1, 'Un.');
    t.speaker.add(1, 'Deux.');
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it('a turn held is ready but silent, until released', async () => {
    const synth = vi.fn(async () => CLIP);
    const t = setup(synth);
    t.speaker.hold(1);
    t.speaker.add(1, 'Prêt.');
    await tick();
    expect(synth).toHaveBeenCalled();
    expect(t.sounds).toHaveLength(0);
    t.speaker.release(1);
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('speaking holds between two sentences of a turn already heard, not before its first sound', async () => {
    const t = setup();
    expect(t.speaker.speaking).toBe(false);
    t.speaker.add(1, 'Un.');
    await tick();
    t.sounds[0]!.end();
    expect(t.speaker.speaking).toBe(true);
    t.speaker.end(1);
    await tick();
    expect(t.speaker.speaking).toBe(false);
  });

  it('a turn held while its sentence was being made stays silent, until released', async () => {
    const t = setup();
    t.speaker.add(1, 'Attends.');
    t.speaker.hold(1);
    await tick();
    expect(t.sounds).toHaveLength(0);
    t.speaker.release(1);
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('a held turn dropped never sounds', async () => {
    const t = setup();
    t.speaker.hold(1);
    t.speaker.add(1, 'Non.');
    t.speaker.drop(1);
    t.speaker.add(2, 'Oui.');
    await tick();
    expect(t.subtitles()).toEqual(['Oui.']);
  });

  it('a voice that fails says so, shows its words without sound for the time to read them, then goes on', async () => {
    vi.useFakeTimers();
    try {
      const t = setup(async (x) => {
        if (x === 'Un.') throw new Error('boom');
        return CLIP;
      });
      t.speaker.add(1, 'Un.');
      t.speaker.add(1, 'Deux.');
      await vi.advanceTimersByTimeAsync(0);
      expect(t.events.some((e) => e.type === 'failed')).toBe(true);
      expect(t.events).toContainEqual({ type: 'subtitle', id: 1, text: 'Un.', mute: true });
      expect(t.sounds).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(readingMs('Un.') - 1);
      expect(t.subtitles()).toEqual(['Un.']);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.subtitles()).toEqual(['Un.', 'Deux.']);
      expect(t.sounds).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cutting it off', () => {
  it('words shown without a voice count as speaking, and a cut ends them at once', async () => {
    vi.useFakeTimers();
    try {
      const t = setup(async (x) => {
        if (x === 'Un.') throw new Error('boom');
        return CLIP;
      });
      t.speaker.add(1, 'Un.');
      t.speaker.end(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(t.speaker.speaking).toBe(true);
      expect(t.speaker.stop()).toEqual({ id: 1, said: '' });
      expect(t.events.at(-1)).toEqual({ type: 'silent', cut: true });
      expect(t.speaker.speaking).toBe(false);
      t.speaker.add(2, 'Deux.');
      await vi.advanceTimersByTimeAsync(0);
      expect(t.sounds).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the sound now and tells what was heard', async () => {
    const t = setup();
    t.speaker.add(7, 'Une phrase entière.');
    t.speaker.add(7, 'Celle-ci coupée en deux.');
    t.speaker.add(7, 'Jamais dite.');
    await tick();
    t.sounds[0]!.end();
    await tick();
    expect(t.speaker.stop()).toEqual({ id: 7, said: 'Une phrase entière. Celle-ci coupée' });
    expect(t.sounds[1]!.stopped).toBe(true);
    expect(t.events.at(-1)).toEqual({ type: 'silent', cut: true });
    await tick();
    expect(t.subtitles()).not.toContain('Jamais dite.');
  });

  it('cut before the first sound, nothing was heard', async () => {
    const t = setup(() => new Promise(() => {}));
    t.speaker.add(7, 'Jamais.');
    expect(t.speaker.stop()).toEqual({ id: 7, said: '' });
  });

  it('nothing under way, nothing to tell', () => {
    expect(setup().speaker.stop()).toBeUndefined();
  });

  it('words still on their way after a cut stay unheard, and block nothing', async () => {
    const t = setup();
    t.speaker.add(7, 'Un.');
    await tick();
    t.speaker.stop();
    t.speaker.add(7, 'En retard.');
    t.speaker.end(7);
    t.speaker.add(8, 'Suivante.');
    await tick();
    expect(t.subtitles()).toEqual(['Un.', 'Suivante.']);
  });

  it('counts the words by the ratio heard', () => {
    expect(wordsHeard('un deux trois quatre', 0.5)).toBe('un deux');
    expect(wordsHeard('un deux', 0)).toBe('');
    expect(wordsHeard('un deux', 2)).toBe('un deux');
  });
});

describe('suspended by a sound that may be nothing', () => {
  async function midSecond() {
    const t = setup();
    t.speaker.add(7, 'Une phrase entière.');
    t.speaker.add(7, 'Celle-ci coupée en deux.');
    t.speaker.add(7, 'La suite.');
    t.speaker.end(7);
    await tick();
    t.sounds[0]!.end();
    await tick();
    return t;
  }

  it('falls silent, and resumed says the sentence again from its start, then the rest', async () => {
    const t = await midSecond();
    t.speaker.suspend();
    expect(t.sounds[1]!.stopped).toBe(true);
    expect(t.speaker.speaking).toBe(false);
    await tick();
    expect(t.sounds).toHaveLength(2);
    t.speaker.resume();
    await tick();
    expect(t.subtitles()).toEqual([
      'Une phrase entière.',
      'Celle-ci coupée en deux.',
      'Celle-ci coupée en deux.',
    ]);
    t.sounds[2]!.end();
    await tick();
    t.sounds[3]!.end();
    await tick();
    expect(t.subtitles().at(-1)).toBe('La suite.');
    expect(t.events.at(-1)).toEqual({ type: 'silent' });
    expect(t.events.filter((e) => e.type === 'first-sound')).toHaveLength(1);
  });

  it('cut for good, tells what was heard before, and the answer kept behind it sounds', async () => {
    const t = await midSecond();
    t.speaker.hold(8);
    t.speaker.add(9, 'Une autre, jamais dite.');
    t.speaker.suspend();
    expect(t.speaker.cutSuspended(8)).toEqual({ id: 7, said: 'Une phrase entière. Celle-ci coupée' });
    expect(t.events.at(-1)).toEqual({ type: 'silent', cut: true });
    t.speaker.add(8, 'La réponse.');
    t.speaker.release(8);
    t.speaker.end(8);
    t.speaker.add(7, 'Trop tard.');
    await tick();
    expect(t.subtitles().slice(2)).toEqual(['La réponse.']);
  });

  it('suspended between two sentences, the one being made waits for the resume', async () => {
    let made!: (c: Clip) => void;
    const t = setup((text) => (text === 'Deux.' ? new Promise((r) => (made = r)) : Promise.resolve(CLIP)));
    t.speaker.add(7, 'Un.');
    t.speaker.add(7, 'Deux.');
    await tick();
    t.sounds[0]!.end();
    await tick();
    expect(t.speaker.speaking).toBe(true);
    t.speaker.suspend();
    made(CLIP);
    await tick();
    expect(t.sounds).toHaveLength(1);
    t.speaker.resume();
    await tick();
    expect(t.subtitles()).toEqual(['Un.', 'Deux.']);
  });

  it('the button during a suspension is for good', async () => {
    const t = await midSecond();
    t.speaker.suspend();
    expect(t.speaker.stop()).toEqual({ id: 7, said: 'Une phrase entière. Celle-ci coupée' });
    expect(t.events.at(-1)).toEqual({ type: 'silent', cut: true });
    t.speaker.resume();
    await tick();
    expect(t.sounds).toHaveLength(2);
  });

  it('the soft way lets the sentence end; cut for good, it was the last', async () => {
    const t = await midSecond();
    t.speaker.suspend(true);
    expect(t.sounds[1]!.stopped).toBe(false);
    expect(t.speaker.cutSuspended()).toEqual({ id: 7, said: 'Une phrase entière. Celle-ci coupée en deux.' });
    t.sounds[1]!.end();
    await tick();
    expect(t.sounds).toHaveLength(2);
    expect(t.events.at(-1)).toEqual({ type: 'silent' });
  });

  it('the soft way, resumed after its sentence ended, goes on with the next', async () => {
    const t = await midSecond();
    t.speaker.suspend(true);
    t.sounds[1]!.end();
    await tick();
    expect(t.sounds).toHaveLength(2);
    t.speaker.resume();
    await tick();
    expect(t.subtitles().at(-1)).toBe('La suite.');
  });
});

describe('an urgency goes first', () => {
  it('after the sentence that sounds, before the rest of the reply', async () => {
    const t = setup();
    t.speaker.add(7, 'Un.');
    t.speaker.add(7, 'Deux.');
    t.speaker.end(7);
    await tick();
    t.speaker.add(1, 'Alerte.', true);
    t.speaker.add(2, 'Autre alerte.', true);
    t.speaker.end(1);
    t.speaker.end(2);
    for (let i = 0; i < 4; i++) {
      t.sounds[i]!.end();
      await tick();
    }
    expect(t.subtitles()).toEqual(['Un.', 'Alerte.', 'Autre alerte.', 'Deux.']);
    expect(t.events.at(-1)).toEqual({ type: 'silent' });
  });

  it('sounds during a suspension', async () => {
    const t = setup();
    t.speaker.add(7, 'Un.');
    await tick();
    t.speaker.suspend();
    t.speaker.add(1, 'Alerte.', true);
    await tick();
    expect(t.subtitles()).toEqual(['Un.', 'Alerte.']);
  });

  it('the button while an urgency waits tells the turn that sounded, and its words', async () => {
    const t = setup();
    t.speaker.add(7, 'Une phrase assez longue.');
    await tick();
    t.speaker.add(1, 'Alerte.', true);
    expect(t.speaker.stop()).toEqual({ id: 7, said: 'Une phrase' });
  });
});
