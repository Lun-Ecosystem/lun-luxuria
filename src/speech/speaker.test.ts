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

  it('the soft way lets the sentence end, and only that one', async () => {
    const t = setup();
    t.speaker.add(7, 'Elle finit.');
    t.speaker.add(7, 'Pas celle-ci.');
    await tick();
    expect(t.speaker.stopAfterSentence()).toEqual({ id: 7, said: 'Elle finit.' });
    expect(t.sounds[0]!.stopped).toBe(false);
    t.sounds[0]!.end();
    await tick();
    expect(t.subtitles()).toEqual(['Elle finit.']);
    expect(t.events.at(-1)).toEqual({ type: 'silent' });
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
