import * as plugin from '@tauri-apps/plugin-global-shortcut';
import type { ShortcutEvent } from '@tauri-apps/plugin-global-shortcut';
import type { Session } from '../session.svelte.ts';

/** A key that types something: taken globally, no other app would see it again. */
const PRINTABLE =
  /^(Key[A-Z]|Digit\d|Numpad\d|Space|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|Enter|Tab|Backspace)$/;

/** Why a key cannot be held from any window; undefined when it can. */
export function refusedGlobally(code: string): string | undefined {
  if (PRINTABLE.test(code))
    return 'Cette touche écrit quelque chose : prise pour tout le poste, plus aucune appli ne la verrait. Elle ne marche que fenêtre active.';
  return undefined;
}

export type Shortcuts = Pick<typeof plugin, 'register' | 'unregister'>;

/**
 * The window's keys, from any window: the shortcut switches scene and small mode, the held key opens the
 * microphone. Windows gives a global key to one app only: a key already taken stays on the window's own
 * listener, and the screen says so.
 */
export function keysFollow(session: Session, shortcuts: Shortcuts = plugin): void {
  let taken: string[] = [];
  let queue = Promise.resolve();

  $effect(() => {
    const toggle = session.settings.display.shortcut;
    const { on, code } = session.settings.key;
    queue = queue.then(async () => {
      if (taken.length) await shortcuts.unregister(taken).catch(() => {});
      taken = [];
      const said: string[] = [];
      try {
        await shortcuts.register(toggle, (e: ShortcutEvent) => {
          if (e.state === 'Pressed') session.setLayout(session.layout === 'small' ? 'scene' : 'small');
        });
        taken.push(toggle);
      } catch {
        said.push(`Raccourci ${toggle} déjà pris par une autre appli.`);
      }
      const refused = on ? refusedGlobally(code) : undefined;
      if (on && refused) said.push(refused);
      else if (on) {
        try {
          await shortcuts.register(code, (e: ShortcutEvent) => session.holdKey(e.state === 'Pressed'));
          taken.push(code);
        } catch {
          said.push(`Touche ${code} déjà prise par une autre appli : elle ne marche que fenêtre active.`);
        }
      }
      session.keysSaid = said.join(' ');
    });
  });
}
