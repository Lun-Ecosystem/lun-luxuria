/** The states of §5.3: what is shown is what is true. */
export type BodyState =
  'present' | 'listening' | 'thinking' | 'speaking' | 'busy' | 'muted' | 'unreachable' | 'capped';

export const STATE_LABELS: Record<BodyState, string> = {
  present: 'Disponible',
  listening: 'Écoute',
  thinking: 'Réfléchit',
  speaking: 'Parle',
  busy: 'Micro occupé',
  muted: 'Micro coupé',
  unreachable: 'Injoignable',
  capped: 'Plafond atteint',
};

/** The two images swap on the sound really played; two thresholds keep it from flickering. */
export class Mouth {
  #open = false;
  #opens: number;
  #closes: number;

  constructor(opens = 0.04, closes = 0.02) {
    this.#opens = opens;
    this.#closes = closes;
  }

  next(level: number): boolean {
    if (this.#open ? level < this.#closes : level >= this.#opens) this.#open = !this.#open;
    return this.#open;
  }
}

/** The worst fact wins: an unreachable core is not hidden by a microphone that listens. */
export function stateOf(f: {
  linked: boolean;
  capped: boolean;
  speaking: boolean;
  thinking: boolean;
  micOn: boolean;
  busy: boolean;
  hearing: boolean;
}): BodyState {
  if (!f.linked) return 'unreachable';
  if (f.speaking) return 'speaking';
  if (f.capped) return 'capped';
  if (f.busy) return 'busy';
  if (f.thinking) return 'thinking';
  if (!f.micOn) return 'muted';
  return f.hearing ? 'listening' : 'present';
}
