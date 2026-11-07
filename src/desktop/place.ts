import type { Layout } from '../settings.ts';

/** A screen, in physical pixels; `work` leaves out the taskbar. */
export interface Screen {
  name: string;
  primary: boolean;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  work: { x: number; y: number; width: number; height: number };
}

/** Where the thumbnail was left: its screen, and its bottom right corner (it grows up and left from there). */
export interface Corner {
  screen: string;
  right: number;
  bottom: number;
}

export interface Place {
  fullscreen: boolean;
  onTop: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Logical sizes: the thumbnail, and the panel it becomes with the thread open. */
export const THUMBNAIL = { width: 320, height: 240 };
export const PANEL = { width: 420, height: 640 };
const MARGIN = 24;

const contains = (s: Screen, x: number, y: number) =>
  x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height;

/** The scene's screen: the one chosen, else the first that is not the main one, else the main one. */
export function sceneScreen(screens: Screen[], wanted: string): Screen {
  return (
    screens.find((s) => s.name === wanted) ??
    screens.find((s) => !s.primary) ??
    screens.find((s) => s.primary) ??
    screens[0]!
  );
}

/** The thumbnail's screen and corner: as left, while it still lands on a screen, else the main screen's corner. */
function smallCorner(
  screens: Screen[],
  corner: Corner | null,
): { screen: Screen; right: number; bottom: number } {
  if (corner) {
    // A screen's name can change from one start to the next: the position alone still counts.
    const screen =
      screens.find((s) => s.name === corner.screen && contains(s, corner.right - 1, corner.bottom - 1)) ??
      screens.find((s) => contains(s, corner.right - 1, corner.bottom - 1));
    if (screen) return { screen, right: corner.right, bottom: corner.bottom };
  }
  const screen = screens.find((s) => s.primary) ?? screens[0]!;
  const m = MARGIN * screen.scale;
  return {
    screen,
    right: screen.work.x + screen.work.width - m,
    bottom: screen.work.y + screen.work.height - m,
  };
}

export function place(
  layout: Layout,
  threadOpen: boolean,
  screens: Screen[],
  wantedScene: string,
  corner: Corner | null,
): Place {
  if (layout === 'scene') {
    const s = sceneScreen(screens, wantedScene);
    return { fullscreen: true, onTop: false, x: s.x, y: s.y, width: s.width, height: s.height };
  }
  const { screen, right, bottom } = smallCorner(screens, corner);
  const size = threadOpen ? PANEL : THUMBNAIL;
  const width = Math.round(Math.min(size.width * screen.scale, screen.work.width));
  const height = Math.round(Math.min(size.height * screen.scale, screen.work.height));
  // Grown into a panel, it stays inside its screen.
  const x = Math.max(screen.work.x, Math.min(right - width, screen.work.x + screen.work.width - width));
  const y = Math.max(screen.work.y, Math.min(bottom - height, screen.work.y + screen.work.height - height));
  return { fullscreen: false, onTop: true, x, y, width, height };
}

/** Where the thumbnail now sits, after he moved it; null when it left every screen. */
export function cornerOf(
  screens: Screen[],
  x: number,
  y: number,
  width: number,
  height: number,
): Corner | null {
  const screen = screens.find((s) => contains(s, x + width / 2, y + height / 2));
  return screen ? { screen: screen.name, right: x + width, bottom: y + height } : null;
}
