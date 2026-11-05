import type { Placed } from './useAttachedPanel';

/** The small pointer from an attached panel to its step (drawn as a separate layer so it isn't clipped). */
export function PanelPointer({ pointer, colour = 'var(--fl-surface, #fff)' }: { pointer: Placed | null; colour?: string }) {
  if (!pointer) return null;
  const { side, top, left, width, height } = pointer;
  const at =
    side === 'below'
      ? { left: pointer.pointer - 7, top: top - 7, borders: 'border-l border-t' }
      : side === 'above'
        ? { left: pointer.pointer - 7, top: top + height - 7, borders: 'border-b border-r' }
        : side === 'right'
          ? { left: left - 7, top: pointer.pointer - 7, borders: 'border-b border-l' }
          : { left: left + width - 7, top: pointer.pointer - 7, borders: 'border-r border-t' };
  return (
    <span
      aria-hidden="true"
      data-testid="panel-pointer"
      data-side={side}
      className={`pointer-events-none fixed z-[41] h-3.5 w-3.5 rotate-45 border-fl-border-strong ${at.borders}`}
      style={{ left: at.left, top: at.top, background: colour }}
    />
  );
}
