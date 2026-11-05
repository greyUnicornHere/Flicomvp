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

/**
 * Where to place a panel next to an anchor (e.g. the step details next to a step):
 * below it if it fits, otherwise above, otherwise beside it; always inside the visible area.
 * `minTop` keeps it clear of a fixed header.
 */
export function placePanel(anchor: Rect, panel: Size, viewport: Size, minTop = MARGIN): { top: number; left: number } {
  const centredLeft = (anchor.left + anchor.right) / 2 - panel.width / 2;
  const clampLeft = (left: number) => Math.min(Math.max(MARGIN, left), viewport.width - MARGIN - panel.width);
  const clampTop = (top: number) => Math.min(Math.max(minTop, top), Math.max(minTop, viewport.height - MARGIN - panel.height));

  if (anchor.bottom + GAP + panel.height <= viewport.height - MARGIN) return { top: anchor.bottom + GAP, left: clampLeft(centredLeft) };
  if (anchor.top - GAP - panel.height >= minTop) return { top: anchor.top - GAP - panel.height, left: clampLeft(centredLeft) };
  const right = anchor.right + GAP;
  const left = right + panel.width <= viewport.width - MARGIN ? right : anchor.left - GAP - panel.width;
  return { top: clampTop(anchor.top), left: clampLeft(left) };
}

export type Side = 'below' | 'above' | 'right' | 'left';

/**
 * Like `placePanel`, and also says on which side of the anchor the panel sits and where along that
 * edge a small pointer should point at the anchor's centre (kept clear of the panel's corners).
 */
export function placeAttached(anchor: Rect, panel: Size, viewport: Size, minTop = MARGIN): { top: number; left: number; side: Side; pointer: number } {
  const { top, left } = placePanel(anchor, panel, viewport, minTop);
  const side: Side = top >= anchor.bottom ? 'below' : top + panel.height <= anchor.top ? 'above' : left >= anchor.right ? 'right' : 'left';
  const clamp = (value: number, from: number, to: number) => Math.min(Math.max(value, from + 16), to - 16);
  const pointer =
    side === 'below' || side === 'above'
      ? clamp((anchor.left + anchor.right) / 2, left, left + panel.width)
      : clamp((anchor.top + anchor.bottom) / 2, top, top + panel.height);
  return { top, left, side, pointer };
}

