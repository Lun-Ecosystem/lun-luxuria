import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  primaryMonitor,
  type Monitor,
} from '@tauri-apps/api/window';
import type { Session } from '../session.svelte.ts';
import { cornerOf, place, type Corner, type Place, type Screen } from './place.ts';

const CORNER_KEY = 'luxuria.window';
const STOP_WAIT_MS = 2000;

export function toScreen(m: Monitor, primary: Monitor | null): Screen {
  const name = m.name ?? `${m.position.x},${m.position.y}`;
  return {
    name,
    primary: primary !== null && primary.position.x === m.position.x && primary.position.y === m.position.y,
    scale: m.scaleFactor,
    x: m.position.x,
    y: m.position.y,
    width: m.size.width,
    height: m.size.height,
    work: {
      x: m.workArea.position.x,
      y: m.workArea.position.y,
      width: m.workArea.size.width,
      height: m.workArea.size.height,
    },
  };
}

export async function screens(): Promise<Screen[]> {
  const [all, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
  return all.map((m) => toScreen(m, primary));
}

function readCorner(): Corner | null {
  try {
    const c = JSON.parse(localStorage.getItem(CORNER_KEY) ?? 'null') as Corner | null;
    return c && typeof c.right === 'number' && typeof c.bottom === 'number' ? c : null;
  } catch {
    return null;
  }
}

/** The window as the API sees it: what `apply` needs, and nothing else, so a test can stand in for it. */
export interface Win {
  setFullscreen(on: boolean): Promise<void>;
  setAlwaysOnTop(on: boolean): Promise<void>;
  setSize(size: PhysicalSize): Promise<void>;
  setPosition(position: PhysicalPosition): Promise<void>;
}

const samePlace = (a: Place, b: Place) =>
  a.fullscreen === b.fullscreen && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Out of fullscreen before any resize, or the size is lost; into fullscreen from the right screen. Never a focus:
 * the shortcut is pressed from another window, which keeps it. From the place it already has, only what differs:
 * leaving fullscreen for nothing makes the scene flicker.
 */
export async function apply(win: Win, p: Place, from?: Place): Promise<void> {
  if (from && samePlace(from, p)) return;
  if (from && !from.fullscreen && !p.fullscreen) {
    await win.setSize(new PhysicalSize(p.width, p.height));
    await win.setPosition(new PhysicalPosition(p.x, p.y));
  } else if (p.fullscreen) {
    await win.setAlwaysOnTop(false);
    await win.setFullscreen(false);
    await win.setPosition(new PhysicalPosition(p.x, p.y));
    await win.setFullscreen(true);
  } else {
    await win.setFullscreen(false);
    await win.setAlwaysOnTop(true);
    await win.setSize(new PhysicalSize(p.width, p.height));
    await win.setPosition(new PhysicalPosition(p.x, p.y));
  }
}

/**
 * The window follows the layout, the thread and the chosen screen, without reloading the page: the voice goes
 * on. The thumbnail's place is kept where he moves it. Closing the window ends the presence first.
 */
export function windowFollows(session: Session): void {
  const win = getCurrentWindow();
  let corner = readCorner();
  let queue = Promise.resolve();
  let placing = false;
  // Where the window was last put; unknown after a failure, so the next one is applied whole.
  let last: Place | undefined;

  // Saving any setting replaces the whole object: without this, every saved setting would replace the scene.
  const screen = $derived(session.settings.display.screen);
  $effect(() => {
    const layout = session.layout;
    const open = session.threadOpen;
    const wanted = screen;
    queue = queue
      .then(async () => {
        const from = last;
        placing = true;
        const next = place(layout, open, await screens(), wanted, corner);
        last = undefined;
        await apply(win, next, from);
        last = next;
      })
      .catch((err: unknown) => console.error('fenêtre', err))
      .finally(() => setTimeout(() => (placing = false), 300));
  });

  void win.onMoved(async ({ payload }) => {
    if (placing || session.layout !== 'small') return;
    // The inner size: the outer one adds the invisible border Windows keeps around a window.
    const size = await win.innerSize();
    const next = cornerOf(await screens(), payload.x, payload.y, size.width, size.height);
    if (!next) return;
    corner = next;
    try {
      localStorage.setItem(CORNER_KEY, JSON.stringify(next));
    } catch {
      // A private storage: the place lasts until the window closes.
    }
  });

  void win.onCloseRequested(async () => {
    // The window's fetch has no keepalive: the presence ends before the window goes, or after 2 s at most.
    await Promise.race([
      session.brain.presence('stopped').catch(() => {}),
      new Promise((r) => setTimeout(r, STOP_WAIT_MS)),
    ]);
  });
}

/** Quitting goes through the closing of the window: the presence ends first, the voice service stops with the app. */
export const quit = () => getCurrentWindow().close();
