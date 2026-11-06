// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
/*
 * Keyboard shortcuts shared by every view. Keys are written `j`, `Shift+v`, `Ctrl+k`, `Escape`, `#`.
 * - Modifiers must match exactly: `Shift+v` never triggers `v`. `Ctrl` also matches Cmd on macOS.
 * - For a symbol (`#`, `?`), Shift and AltGr only serve to type it and are not part of the combo.
 * - Nothing triggers from a field (input, textarea, select, editable zone), except a Ctrl combo
 *   typed in the command palette search, marked `data-palette`, and the combos given in `fromFields`.
 * - An action that returns `false` declines the key: its default (scrolling, focus...) goes on.
 */

const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isLetter(key: string): boolean {
  return key.length === 1 && key.toLowerCase() !== key.toUpperCase();
}

function canonical(mods: Set<Modifier>, key: string): string {
  const name = key.length === 1 ? key.toLowerCase() : key;
  return [...MODIFIERS.filter((m) => mods.has(m)), name].join('+');
}

/** `Shift+V`, `shift+v` and `Shift+v` all give `Shift+v`. */
export function normalizeCombo(combo: string): string {
  // A trailing `+` is the key itself (`Ctrl++`).
  const parts = combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set<Modifier>();
  for (const part of parts) {
    const mod = MODIFIERS.find((m) => m.toLowerCase() === part.toLowerCase());
    if (!mod) throw new Error(`Unknown modifier "${part}" in shortcut "${combo}"`);
    mods.add(mod);
  }
  return canonical(mods, key);
}

/** The combo of a keyboard event, in the same form as `normalizeCombo`. */
export function comboOf(event: KeyboardEvent): string {
  const altGraph = event.getModifierState?.('AltGraph') ?? false;
  const mods = new Set<Modifier>();
  if (!altGraph && (event.ctrlKey || event.metaKey)) mods.add('Ctrl');
  if (!altGraph && event.altKey) mods.add('Alt');
  const symbol = event.key.length === 1 && !isLetter(event.key);
  if (event.shiftKey && !symbol) mods.add('Shift');
  return canonical(mods, event.key);
}

function fromField(event: Event): Element | null {
  const target = event.target;
  return target instanceof Element ? target.closest(FIELD) : null;
}

export function bindShortcuts(
  map: Record<string, () => void | boolean>,
  target: EventTarget = window,
  opts: { fromFields?: string[] } = {},
): () => void {
  const actions = new Map(Object.entries(map).map(([combo, run]) => [normalizeCombo(combo), run]));
  const anywhere = new Set((opts.fromFields ?? []).map(normalizeCombo));

  const onKeydown = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || event.isComposing || event.repeat) return;
    const combo = comboOf(event);
    const run = actions.get(combo);
    if (!run) return;
    const field = fromField(event);
    if (field && !anywhere.has(combo) && !(combo.startsWith('Ctrl+') && field.closest('[data-palette]')))
      return;
    if (run() !== false) event.preventDefault();
  };

  target.addEventListener('keydown', onKeydown);
  return () => target.removeEventListener('keydown', onKeydown);
}
