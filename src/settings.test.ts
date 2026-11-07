import { describe, expect, it } from 'vitest';
import { readSettings } from './settings.ts';

describe('readSettings', () => {
  it('an older setting without the mute shortcut takes its default, and keeps the rest', () => {
    const s = readSettings(JSON.stringify({ display: { screen: 'DISPLAY2', shortcut: 'Alt+L' } }));
    expect(s.display).toEqual({ screen: 'DISPLAY2', shortcut: 'Alt+L', muteShortcut: 'Control+Shift+M' });
  });
});
