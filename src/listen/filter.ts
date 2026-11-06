import type { Layout, Settings } from '../settings.ts';

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** A transcription writes a name in many ways: « Amélie », « Amelia ». */
export function saysName(text: string, words: string[], tolerance: number): boolean {
  const heard = plain(text).split(/[^\p{L}]+/u);
  return words.some((w) => heard.some((h) => h !== '' && distance(h, plain(w)) <= tolerance));
}

// What Whisper makes out of silence, in French.
const HALLUCINATIONS = [
  /sous-titr/,
  /sous titr/,
  /amara\.org/,
  /merci d'avoir regarde/,
  /merci de votre attention/,
  /abonnez-vous/,
  /^\W*merci\W*$/,
];

export function isNoise(text: string): boolean {
  const t = plain(text).trim();
  return !/\p{L}/u.test(t) || HALLUCINATIONS.some((h) => h.test(t));
}

export type Verdict = { pass: true } | { pass: false; reason: 'noise' | 'filtered' };

export function decide(
  text: string,
  ctx: { layout: Layout; keyHeld: boolean; lastSpokeAt: number | null; now: number },
  s: Pick<Settings, 'agent' | 'filter' | 'name' | 'window' | 'key'>,
): Verdict {
  if (isNoise(text)) return { pass: false, reason: 'noise' };
  if (!s.filter[ctx.layout]) return { pass: true };
  if (s.key.on && ctx.keyHeld) return { pass: true };
  if (s.name.on && saysName(text, [s.agent.name, ...s.name.words], s.name.tolerance)) return { pass: true };
  if (s.window.on && ctx.lastSpokeAt !== null && ctx.now - ctx.lastSpokeAt <= s.window.seconds * 1000)
    return { pass: true };
  return { pass: false, reason: 'filtered' };
}
