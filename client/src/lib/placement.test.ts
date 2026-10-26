import { describe, expect, it } from 'vitest';
import { placeMenu } from './placement';

const viewport = { width: 1280, height: 720 };
const menu = { width: 180, height: 108 };
const trigger = (top: number, right = 1200) => ({ top, bottom: top + 44, left: right - 44, right });

describe('placeMenu', () => {
  it('opens below the trigger when there is room', () => {
    expect(placeMenu(trigger(100), menu, viewport)).toEqual({ top: 152, left: 1020 });
  });

  it('flips above the trigger near the bottom of the window', () => {
    const { top } = placeMenu(trigger(650), menu, viewport);
    expect(top).toBe(650 - 8 - 108);
    expect(top + menu.height).toBeLessThanOrEqual(viewport.height);
  });

  it('stays inside the window when neither side fully fits', () => {
    const tall = { width: 180, height: 700 };
    const { top } = placeMenu(trigger(300), tall, viewport);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + tall.height).toBeLessThanOrEqual(viewport.height);
  });

  it('shifts horizontally to stay on screen', () => {
    expect(placeMenu(trigger(100, 100), menu, viewport).left).toBe(8);
    expect(placeMenu(trigger(100, 1279), menu, viewport).left).toBe(1280 - 8 - 180);
    expect(placeMenu(trigger(100, 1279), { width: 300, height: 100 }, viewport).left).toBe(1280 - 8 - 300);
  });
});
