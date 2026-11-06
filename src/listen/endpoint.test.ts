import { describe, expect, it } from 'vitest';
import { ENDPOINT_DEFAULTS, Endpointer, levelToVoice, type EndpointEvent } from './endpoint.ts';

const F = ENDPOINT_DEFAULTS.frameMs;
const frame = new Float32Array(4);

/** `v` voice and `s` silence, each one frame. */
function play(pattern: string, e = new Endpointer()): { at: number; event: EndpointEvent }[] {
  const out: { at: number; event: EndpointEvent }[] = [];
  [...pattern].forEach((c, i) => {
    for (const event of e.push(frame, c === 'v' ? 0.9 : 0.1, i * F)) out.push({ at: i * F, event });
  });
  return out;
}
const types = (p: string) => play(p).map((x) => x.event.type);
const n = (ms: number) => Math.ceil(ms / F);

describe('the moments of a sentence', () => {
  it('start, hold, pause, end, in that order', () => {
    expect(types('v'.repeat(n(500)) + 's'.repeat(n(500)))).toEqual(['start', 'held', 'pause', 'end']);
  });

  it('a voice that goes on after a pause is a resume, and only one sentence', () => {
    const p = 'v'.repeat(n(300)) + 's'.repeat(n(200)) + 'v'.repeat(3) + 's'.repeat(n(500));
    expect(types(p).filter((t) => t !== 'held')).toEqual(['start', 'pause', 'resume', 'pause', 'end']);
  });

  it('a click is noise: nothing leaves, no pause', () => {
    expect(types('vv' + 's'.repeat(n(500)))).toEqual(['start', 'noise']);
  });

  it('a cough does not reach the hold', () => {
    expect(types('v'.repeat(n(300)) + 's'.repeat(n(500)))).not.toContain('held');
  });

  it('the level between the thresholds keeps voice going, not starting', () => {
    const e = new Endpointer();
    expect(e.push(frame, 0.5, 0)).toEqual([]);
    expect(e.push(frame, 0.9, F)).toEqual([{ type: 'start' }]);
    for (let i = 0; i < n(1000); i++) expect(e.push(frame, 0.5, i).map((x) => x.type)).not.toContain('end');
  });

  it('dates the last voice for the chronometer, and keeps the words before the start', () => {
    const e = new Endpointer({ ...ENDPOINT_DEFAULTS, prePadMs: F * 2 });
    const events = play('ss' + 'v'.repeat(10) + 's'.repeat(n(500)), e);
    const end = events.at(-1)!;
    if (end.event.type !== 'end') throw new Error(end.event.type);
    expect(end.event.lastVoiceAt).toBe(11 * F);
    expect(end.event.audio.length).toBe((2 + 10 + n(500)) * frame.length);
  });

  it('cuts a sentence that never ends', () => {
    const e = new Endpointer({ ...ENDPOINT_DEFAULTS, maxSpeechMs: F * 40 });
    expect(play('v'.repeat(50), e).map((x) => x.event.type)).toContain('end');
  });
});

describe('the level as voice', () => {
  it('silence is 0, a loud voice is 1, 0 samples do not break it', () => {
    expect(levelToVoice(new Float32Array(512), -50)).toBe(0);
    expect(levelToVoice(new Float32Array(512).fill(0.3), -50)).toBe(1);
    expect(levelToVoice(new Float32Array(0), -50)).toBe(0);
  });
});
