import { invoke } from '@tauri-apps/api/core';
import { untrack } from 'svelte';
import type { Session } from '../session.svelte.ts';

/** The thumbnail's framing of the face: a zoom, and the point kept in view, in percent of the image. */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

/** What the scene shows: the same shape as the browser's settings, the images as `blob:` addresses. */
export interface BodyView {
  level: 'breath' | 'images';
  rest: string;
  talking: string;
  crop: Crop | null;
}

interface BodyFile {
  niveau: 'souffle' | 'images';
  repos: string;
  parole: string;
  vignette: Crop | null;
}

export const BREATH: BodyView = { level: 'breath', rest: '', talking: '', crop: null };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const percent = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback;

/** `corps.json`, read strictly: a wrong field is said, never guessed. */
export function readBodyFile(text: string): BodyFile | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'corps.json illisible : ce n’est pas du JSON.';
  }
  if (!isObject(raw)) return 'corps.json illisible.';
  const niveau = raw.niveau ?? 'images';
  if (niveau !== 'souffle' && niveau !== 'images')
    return 'corps.json : « niveau » vaut « souffle » ou « images ».';
  if (niveau === 'images' && (typeof raw.repos !== 'string' || raw.repos === ''))
    return 'corps.json : « repos » nomme l’image au repos.';
  const v = raw.vignette;
  const vignette = isObject(v)
    ? {
        zoom: typeof v.zoom === 'number' && v.zoom >= 1 && v.zoom <= 8 ? v.zoom : 1,
        x: percent(v.x, 50),
        y: percent(v.y, 50),
      }
    : null;
  return {
    niveau,
    repos: typeof raw.repos === 'string' ? raw.repos : '',
    parole: typeof raw.parole === 'string' ? raw.parole : '',
    vignette,
  };
}

export type Call = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * The body from its folder. Anything missing, unreadable or refused gives the breath and says why; a missing
 * talking image only keeps the mouth still.
 */
export async function loadBody(
  folder: string,
  call: Call = invoke,
  toUrl: (bytes: ArrayBuffer) => string = (b) => URL.createObjectURL(new Blob([b])),
): Promise<{ view: BodyView; said: string }> {
  if (!folder.trim()) return { view: BREATH, said: 'Aucun dossier : le souffle.' };
  const reason = (err: unknown) =>
    typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
  let file: BodyFile | string;
  try {
    file = readBodyFile((await call('body_config', { folder })) as string);
  } catch (err) {
    return { view: BREATH, said: `${reason(err)} Le souffle en attendant.` };
  }
  if (typeof file === 'string') return { view: BREATH, said: `${file} Le souffle en attendant.` };
  if (file.niveau === 'souffle') return { view: BREATH, said: 'Le souffle, comme le dit corps.json.' };
  let rest: string;
  try {
    rest = toUrl((await call('body_image', { folder, name: file.repos })) as ArrayBuffer);
  } catch (err) {
    return { view: BREATH, said: `${reason(err)} Le souffle en attendant.` };
  }
  let talking = '';
  let said = 'Les images du dossier.';
  if (file.parole) {
    try {
      talking = toUrl((await call('body_image', { folder, name: file.parole })) as ArrayBuffer);
    } catch (err) {
      said = `${reason(err)} La bouche reste fermée.`;
    }
  }
  return { view: { level: 'images', rest, talking, crop: file.vignette }, said };
}

/** Reads the folder again, and lets the previous images go. */
export async function reloadBody(session: Session, load = loadBody): Promise<void> {
  const mine = ++readings;
  const { view, said } = await load(session.settings.body.folder);
  // Two readings crossed (a double click on « Relire »): only the last one shows, the other lets its images go.
  const old = mine === readings ? session.bodyView : view;
  if (mine === readings) {
    session.bodyView = view;
    session.bodySaid = said;
  }
  for (const url of [old?.rest, old?.talking]) if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}
let readings = 0;

/** In the window, the folder decides the body: read when the window opens and when the folder changes. */
export function bodyFollows(session: Session): void {
  // Saving any setting replaces the whole object: the derived value stops what did not change.
  const folder = $derived(session.settings.body.folder);
  $effect(() => {
    void folder;
    // Only the folder counts: the reading itself touches the body it replaces, which must not loop back here.
    untrack(() => void reloadBody(session));
  });
}
