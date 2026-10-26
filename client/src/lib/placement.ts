export type Rect = { top: number; bottom: number; left: number; right: number };
export type Size = { width: number; height: number };

const GAP = 8; // space between trigger and menu
const MARGIN = 8; // minimum distance from the window edge

/**
 * Where to place a dropdown so it stays fully inside the window:
 * below the trigger if it fits, otherwise above it, otherwise as close as possible.
 * Right-aligned with the trigger, shifted horizontally to stay on screen.
 */
export function placeMenu(trigger: Rect, menu: Size, viewport: Size): { top: number; left: number } {
  const below = trigger.bottom + GAP;
  const above = trigger.top - GAP - menu.height;
  let top: number;
  if (below + menu.height <= viewport.height - MARGIN) top = below;
  else if (above >= MARGIN) top = above;
  else top = Math.max(MARGIN, viewport.height - MARGIN - menu.height);

  const left = Math.min(Math.max(MARGIN, trigger.right - menu.width), viewport.width - MARGIN - menu.width);
  return { top, left: Math.max(MARGIN, left) };
}
