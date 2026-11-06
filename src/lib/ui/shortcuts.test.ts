// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts } from './shortcuts.ts';

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

let unbind: (() => void) | undefined;
afterEach(() => {
  unbind?.();
  unbind = undefined;
  document.body.innerHTML = '';
});

describe('bindShortcuts', () => {
  it('a plain key triggers its action and prevents the default', () => {
    const next = vi.fn();
    unbind = bindShortcuts({ j: next });
    const event = press(document.body, 'j');
    expect(next).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('an action that returns false keeps the default', () => {
    const scroll = vi.fn(() => false);
    unbind = bindShortcuts({ ArrowDown: scroll });
    const event = press(document.body, 'ArrowDown');
    expect(scroll).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('a letter typed with Caps Lock on still triggers its bare key', () => {
    const validate = vi.fn();
    unbind = bindShortcuts({ v: validate, 'Shift+v': vi.fn() });
    press(document.body, 'V');
    expect(validate).toHaveBeenCalledOnce();
  });

  it('a held key triggers once, not on every repeat', () => {
    const validate = vi.fn();
    unbind = bindShortcuts({ v: validate });
    press(document.body, 'v');
    press(document.body, 'v', { repeat: true });
    expect(validate).toHaveBeenCalledOnce();
  });

  it('Shift+v triggers Shift+v, never v', () => {
    const validate = vi.fn();
    const validateAll = vi.fn();
    unbind = bindShortcuts({ v: validate, 'Shift+v': validateAll });
    press(document.body, 'V', { shiftKey: true });
    expect(validateAll).toHaveBeenCalledOnce();
    expect(validate).not.toHaveBeenCalled();
    press(document.body, 'v');
    expect(validate).toHaveBeenCalledOnce();
  });

  it('a key with a modifier does not trigger the bare key', () => {
    const validate = vi.fn();
    unbind = bindShortcuts({ v: validate });
    press(document.body, 'V', { shiftKey: true });
    press(document.body, 'v', { ctrlKey: true });
    press(document.body, 'v', { altKey: true });
    expect(validate).not.toHaveBeenCalled();
  });

  it('Ctrl+k triggers, and so does Cmd+k', () => {
    const palette = vi.fn();
    unbind = bindShortcuts({ 'Ctrl+k': palette });
    press(document.body, 'k', { ctrlKey: true });
    press(document.body, 'k', { metaKey: true });
    expect(palette).toHaveBeenCalledTimes(2);
  });

  it('named keys and symbols: Escape, #', () => {
    const close = vi.fn();
    const spam = vi.fn();
    unbind = bindShortcuts({ Escape: close, '#': spam });
    press(document.body, 'Escape');
    // US layout: Shift+3. AZERTY on Windows: AltGr+3 (reported as Ctrl+Alt).
    press(document.body, '#', { shiftKey: true });
    press(document.body, '#', { ctrlKey: true, altKey: true, modifierAltGraph: true });
    expect(close).toHaveBeenCalledOnce();
    expect(spam).toHaveBeenCalledTimes(2);
  });

  it('a key typed in an input, a textarea, a select or an editable zone triggers nothing', () => {
    const next = vi.fn();
    const palette = vi.fn();
    unbind = bindShortcuts({ j: next, 'Ctrl+k': palette });
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea><select id="s"></select>
      <div contenteditable="true"><p id="c">texte</p></div>`;
    for (const id of ['i', 't', 's', 'c']) {
      const field = document.getElementById(id)!;
      const event = press(field, 'j');
      press(field, 'k', { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(next).not.toHaveBeenCalled();
    expect(palette).not.toHaveBeenCalled();
  });

  it('Ctrl+k triggers even from the search field marked data-palette, plain keys still do not', () => {
    const next = vi.fn();
    const palette = vi.fn();
    unbind = bindShortcuts({ j: next, 'Ctrl+k': palette });
    document.body.innerHTML = `<div data-palette><input id="q" type="search" /></div>`;
    const search = document.getElementById('q')!;
    press(search, 'k', { ctrlKey: true });
    press(search, 'j');
    expect(palette).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it('listens on the given target only', () => {
    const next = vi.fn();
    const zone = document.createElement('div');
    document.body.append(zone);
    unbind = bindShortcuts({ j: next }, zone);
    press(document.body, 'j');
    expect(next).not.toHaveBeenCalled();
    press(zone, 'j');
    expect(next).toHaveBeenCalledOnce();
  });

  it('the returned function removes every shortcut', () => {
    const next = vi.fn();
    const palette = vi.fn();
    const remove = bindShortcuts({ j: next, 'Ctrl+k': palette });
    remove();
    press(document.body, 'j');
    press(document.body, 'k', { ctrlKey: true });
    expect(next).not.toHaveBeenCalled();
    expect(palette).not.toHaveBeenCalled();
  });

  it('ignores a key being composed (IME)', () => {
    const next = vi.fn();
    unbind = bindShortcuts({ j: next });
    press(document.body, 'j', { isComposing: true });
    expect(next).not.toHaveBeenCalled();
  });
});
