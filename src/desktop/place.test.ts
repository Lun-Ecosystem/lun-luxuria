import { describe, expect, it } from 'vitest';
import { cornerOf, place, sceneScreen, type Screen } from './place.ts';

const screen = (name: string, primary: boolean, x: number, scale = 1): Screen => ({
  name,
  primary,
  scale,
  x,
  y: 0,
  width: 1920,
  height: 1080,
  work: { x, y: 0, width: 1920, height: 1040 },
});
const main = screen('\\\\.\\DISPLAY1', true, 0);
const second = screen('\\\\.\\DISPLAY2', false, 1920);

describe('the scene', () => {
  it('fills the chosen screen', () => {
    expect(place('scene', false, [main, second], main.name, null)).toEqual({
      fullscreen: true,
      onTop: false,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('without a choice, or with a screen gone: the first that is not the main one, else the main one', () => {
    expect(sceneScreen([main, second], '')).toBe(second);
    expect(sceneScreen([main, second], '\\\\.\\DISPLAY9')).toBe(second);
    expect(sceneScreen([main], '\\\\.\\DISPLAY2')).toBe(main);
  });
});

describe('the small mode', () => {
  it('first time: a thumbnail on top, in the main screen’s bottom right corner, above the taskbar', () => {
    expect(place('small', false, [second, main], '', null)).toEqual({
      fullscreen: false,
      onTop: true,
      x: 1920 - 24 - 320,
      y: 1040 - 24 - 240,
      width: 320,
      height: 240,
    });
  });

  it('comes back where he left it, and grows into a panel up and left when the thread opens', () => {
    const corner = { screen: second.name, right: 2600, bottom: 900 };
    expect(place('small', false, [main, second], '', corner)).toMatchObject({
      x: 2280,
      y: 660,
      width: 320,
      height: 240,
    });
    expect(place('small', true, [main, second], '', corner)).toMatchObject({
      x: 2180,
      y: 260,
      width: 420,
      height: 640,
    });
  });

  it('a panel near the top stays inside its screen', () => {
    const corner = { screen: main.name, right: 500, bottom: 300 };
    expect(place('small', true, [main], '', corner)).toMatchObject({ x: 80, y: 0, height: 640 });
  });

  it('follows the screen’s scale', () => {
    const hi = screen('\\\\.\\DISPLAY1', true, 0, 1.5);
    expect(place('small', false, [hi], '', null)).toMatchObject({ width: 480, height: 360 });
  });

  it('a renamed screen: the position still counts; a corner off every screen: the main screen’s corner', () => {
    const renamed = { screen: '\\\\.\\DISPLAY7', right: 2600, bottom: 900 };
    expect(place('small', false, [main, second], '', renamed)).toMatchObject({ x: 2280, y: 660 });
    const gone = { screen: second.name, right: 2600, bottom: 900 };
    expect(place('small', false, [main], '', gone)).toMatchObject({ x: 1576, y: 776 });
  });
});

describe('cornerOf', () => {
  it('reads where the thumbnail was moved, by its centre', () => {
    expect(cornerOf([main, second], 2000, 100, 320, 240)).toEqual({
      screen: second.name,
      right: 2320,
      bottom: 340,
    });
    expect(cornerOf([main], 5000, 100, 320, 240)).toBeNull();
  });
});
