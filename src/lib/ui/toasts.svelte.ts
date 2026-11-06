// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
/*
 * Toasts of the views: one store for the page, shown by the Toaster, one at a time. An action that
 * can be undone gives its `undo` and stays 5 s, run by « Annuler » or Ctrl Z; a new toast replaces
 * the one on screen (the replaced undo is dropped: that gesture becomes final). Information stays 3 s
 * and, while an undoable toast counts down, waits for it to leave (the latest one wins; a new
 * undoable toast does not drop it). An undo that
 * fails replaces its toast by the error, in the danger tone.
 */

/** An undoable toast, in ms. */
export const UNDO_DURATION = 5000;
/** An information toast, in ms. */
export const INFO_DURATION = 3000;
export const DANGER_DURATION = 5000;

export interface ToastOptions {
  undo?: (() => Promise<void>) | undefined;
  tone?: 'ok' | 'danger' | undefined;
}

export interface Toast {
  readonly id: number;
  message: string;
  tone: 'ok' | 'danger' | undefined;
  undo: (() => Promise<void>) | undefined;
  /** The undo is running: the button waits, Ctrl Z does nothing more. */
  undoing: boolean;
  /** Epoch ms when it leaves. */
  endsAt: number;
}

const shown = $state<Toast[]>([]);
let waiting: { message: string; options: ToastOptions } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;

function duration(t: Pick<Toast, 'undo' | 'tone'>): number {
  return t.undo ? UNDO_DURATION : t.tone === 'danger' ? DANGER_DURATION : INFO_DURATION;
}

function arm(t: Toast): void {
  clearTimeout(timer);
  t.endsAt = Date.now() + duration(t);
  timer = setTimeout(() => dismiss(t.id), duration(t));
}

function show(message: string, options: ToastOptions): void {
  const t: Toast = {
    id: nextId++,
    message,
    tone: options.tone,
    undo: options.undo,
    undoing: false,
    endsAt: 0,
  };
  shown.splice(0, shown.length, t);
  // `shown[0]` is the reactive proxy: arm it, not the raw object.
  const live = shown[0];
  if (live) arm(live);
}

/** The toast on screen: at most one. */
export function toasts(): readonly Toast[] {
  return shown;
}

export function toast(message: string, options: ToastOptions = {}): void {
  const current = shown[0];
  if (!options.undo && current?.undo && !current.undoing) {
    waiting = { message, options };
    return;
  }
  // A notice kept for later survives a new undoable toast; a plain toast replacing the screen is newer.
  if (!options.undo) waiting = undefined;
  show(message, options);
}

export function dismiss(id: number): void {
  if (shown[0]?.id !== id) return;
  clearTimeout(timer);
  shown.length = 0;
  const next = waiting;
  waiting = undefined;
  if (next) show(next.message, next.options);
}

export function dismissAll(): void {
  clearTimeout(timer);
  shown.length = 0;
  waiting = undefined;
}

/** The toast on screen if it can be undone (target of Ctrl Z). */
export function lastUndoable(): Toast | undefined {
  const t = shown[0];
  return t?.undo && !t.undoing ? t : undefined;
}

/** Runs the undo of a toast: it leaves on success, and becomes the error on failure. */
export async function undo(id: number): Promise<void> {
  const target = shown[0];
  if (target?.id !== id || !target.undo || target.undoing) return;
  target.undoing = true;
  clearTimeout(timer);
  try {
    await target.undo();
    dismiss(id);
  } catch (error) {
    const current = shown[0];
    if (current?.id !== id) return;
    current.message = error instanceof Error && error.message ? error.message : 'L’annulation a échoué.';
    current.tone = 'danger';
    current.undo = undefined;
    current.undoing = false;
    arm(current);
  }
}

/** Undoes the toast on screen (Ctrl Z). */
export function undoLast(): void {
  const target = lastUndoable();
  if (target) void undo(target.id);
}
