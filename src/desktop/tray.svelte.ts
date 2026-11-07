import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as autostart from '@tauri-apps/plugin-autostart';
import { untrack } from 'svelte';
import { STATE_LABELS, type BodyState } from '../body/body.ts';
import type { Session } from '../session.svelte.ts';
import type { Settings } from '../settings.ts';

export type TrayState = 'present' | 'silenced' | 'unreachable';

/** The icon tells three things only: she is there, she is silenced, or she cannot be reached. */
export function trayOf(state: BodyState): TrayState {
  return state === 'silenced' || state === 'unreachable' ? state : 'present';
}

export interface TrayDeps {
  call: (
    cmd: 'tray_state',
    args: { state: TrayState; tooltip: string; silenced: boolean },
  ) => Promise<unknown>;
  listen: (event: 'tray', on: (e: { payload: string }) => void) => Promise<() => void>;
  win: () => Pick<ReturnType<typeof getCurrentWindow>, 'show' | 'unminimize' | 'setFocus' | 'close'>;
}

const tauri: TrayDeps = { call: invoke, listen, win: getCurrentWindow };

/** The tray icon follows the state, and its menu shows the window, switches the mute, or quits. */
export function trayFollows(session: Session, deps: TrayDeps = tauri): void {
  const state$ = $derived(trayOf(session.state));
  // The mute entry says the mute itself: unreachable hides it on the icon, not on the entry.
  const silenced$ = $derived(session.silenced);
  $effect(() => {
    const state = state$;
    const silenced = silenced$;
    void deps
      .call('tray_state', { state, tooltip: `Lun'Luxuria : ${STATE_LABELS[state]}`, silenced })
      .catch(() => {});
  });
  void deps.listen('tray', ({ payload }) => {
    const w = deps.win();
    if (payload === 'show') {
      for (const step of [w.unminimize, w.show, w.setFocus]) void step.call(w).catch(() => {});
    } else if (payload === 'mute') session.toggleMute();
    // Quitting goes through the closing of the window: the presence ends the same way.
    else if (payload === 'quit') void w.close().catch(() => {});
  });
}

export type Autostart = Pick<typeof autostart, 'isEnabled' | 'enable' | 'disable'>;

/**
 * Starting with Windows: the system says first (its value is taken at launch), then the switch follows
 * `enable` and `disable`. A refusal is said on the screen and the switch goes back; the other settings stay.
 */
export function autostartFollows(session: Session, plugin: Autostart = autostart): void {
  let known: boolean | undefined;
  const put = (on: boolean) =>
    session.saveSettings({
      ...($state.snapshot(session.settings) as Settings),
      display: { ...session.settings.display, startWithWindows: on },
    });
  void plugin
    .isEnabled()
    .then((on) => {
      known = on;
      if (session.settings.display.startWithWindows !== on) put(on);
    })
    .catch((err: unknown) => (session.startSaid = `Démarrage avec Windows illisible : ${String(err)}`));

  // One call at a time, until Windows says what the switch says: a quick on then off ends off.
  let queue = Promise.resolve();
  const sync = async () => {
    while (known !== undefined) {
      const wanted = untrack(() => session.settings.display.startWithWindows);
      if (wanted === known) return;
      try {
        await (wanted ? plugin.enable() : plugin.disable());
        known = wanted;
        session.startSaid = '';
      } catch (err) {
        session.startSaid = `Démarrage avec Windows refusé : ${err instanceof Error ? err.message : String(err)}`;
        put(known);
        return;
      }
    }
  };
  const wanted$ = $derived(session.settings.display.startWithWindows);
  $effect(() => {
    void wanted$;
    queue = queue.then(sync);
  });
}
