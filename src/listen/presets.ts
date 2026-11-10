import { DEFAULTS, type Settings } from '../settings.ts';

type EndOfSpeech = Settings['endOfSpeech'];
type Room = Pick<EndOfSpeech, 'silenceMs' | 'pauseMs' | 'minSpeechMs' | 'floorDb'>;
export type Preset = 'calme' | 'normal' | 'bruit';

const { silenceMs, pauseMs, minSpeechMs, floorDb } = DEFAULTS.endOfSpeech;

/** The room around: only the end of the sentence and the silence threshold, never a switch. */
export const PRESETS: Record<Preset, Room> = {
  // shortcut: guessed, not measured; set them in the desktop's room (roadmap, § 4, step 4).
  calme: { silenceMs: 400, pauseMs: 140, minSpeechMs: 200, floorDb: -55 },
  normal: { silenceMs, pauseMs, minSpeechMs, floorDb },
  // shortcut: guessed, not measured; set them in the desktop's room (roadmap, § 4, step 4).
  bruit: { silenceMs: 700, pauseMs: 220, minSpeechMs: 350, floorDb: -40 },
};

const KEYS = Object.keys(PRESETS.normal) as (keyof Room)[];

/** The preset these values are, or null when one of them was touched by hand. */
export function presetOf(e: Room): Preset | null {
  return (Object.keys(PRESETS) as Preset[]).find((p) => KEYS.every((k) => PRESETS[p][k] === e[k])) ?? null;
}

export function withPreset(e: EndOfSpeech, preset: Preset): EndOfSpeech {
  return { ...e, ...PRESETS[preset] };
}
