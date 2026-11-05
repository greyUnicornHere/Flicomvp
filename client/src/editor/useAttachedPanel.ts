import { useLayoutEffect, useState, type RefObject } from 'react';
import { useStore } from '@xyflow/react';
import { placeAttached, type Side } from '../lib/placement';

const MARGIN = 8;
/** Flico's top bar and a little air: panels never go under it. */
export const PANEL_MIN_TOP = 84;

export type Placed = { top: number; left: number; side: Side; pointer: number; width: number; height: number };

/**
 * A panel attached to a step on the canvas (the details card, the Describe box). Every time it opens it
 * sits right next to its step with a small pointer to it, and follows the canvas as it pans or zooms.
 * It can be dragged by its header (or moved with arrow keys from its grip) until it closes; it always
 * stays fully inside the window, below Flico's top bar. A dragged panel has no pointer.
 */
export function useAttachedPanel(ref: RefObject<HTMLElement | null>, anchor: () => HTMLElement | null, extra?: unknown) {
  const transform = useStore((s) => s.transform);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [dragged, setDragged] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      const target = anchor();
      if (!el || !target) return;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      setPlaced({ ...placeAttached(target.getBoundingClientRect(), size, { width: innerWidth, height: innerHeight }, PANEL_MIN_TOP), ...size });
    };
    place();
    addEventListener('resize', place);
    const el = ref.current;
    // The panel's height changes as sections open and close: placed again so it stays on screen.
    const resized = typeof ResizeObserver === 'undefined' || !el ? null : new ResizeObserver(place);
    if (resized && el) resized.observe(el);
    return () => {
      removeEventListener('resize', place);
      resized?.disconnect();
    };
  }, [ref, anchor, transform, extra]);

  const clamp = (p: { left: number; top: number }) => {
    const width = placed?.width ?? 340;
    const height = Math.min(placed?.height ?? 400, innerHeight - PANEL_MIN_TOP - MARGIN);
    return {
      left: Math.round(Math.min(Math.max(MARGIN, p.left), innerWidth - width - MARGIN)),
      top: Math.round(Math.min(Math.max(PANEL_MIN_TOP, p.top), innerHeight - height - MARGIN)),
    };
  };
  const position = placed ? (dragged ? clamp(dragged) : { left: placed.left, top: placed.top }) : null;

  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a') || !position) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...position };
    const move = (e: PointerEvent) => setDragged(clamp({ left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y }));
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const moveWithKeys = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta || !position) return;
    event.preventDefault();
    setDragged(clamp({ left: position.left + delta[0]!, top: position.top + delta[1]! }));
  };

  const pointer = placed && !dragged ? placed : null;
  return { position, pointer, dragged: !!dragged, startDrag, moveWithKeys };
}
