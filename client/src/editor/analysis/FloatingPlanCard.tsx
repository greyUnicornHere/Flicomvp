import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { placeAttached } from '../../lib/placement';
import { PanelPointer } from '../PanelPointer';
import type { Placed } from '../useAttachedPanel';

const WIDTH = 400;

type Props = {
  /** The diagram the card belongs to (its aria-label). */
  diagramLabel: string;
  /** Steps to point at, best first; when none is drawn (a removed step), the Removed list is used. */
  anchorIds: string[];
  /** Changes whenever the diagram pans or zooms, so the card follows its block. */
  viewTick: number;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Full screen analysis (owner feedback, 2026-11-05): the selected process change or automation step
 * shows its card floating beside its block, with a pointer to it, instead of a fixed side panel.
 */
export function FloatingPlanCard({ diagramLabel, anchorIds, viewTick, title, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const anchorKey = anchorIds.join('|');

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const diagram = document.querySelector(`[aria-label="${CSS.escape(diagramLabel)}"]`);
      const ids = anchorKey ? anchorKey.split('|') : [];
      const target =
        ids.map((id) => diagram?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)).find(Boolean) ??
        document.querySelector('[data-testid="removed-steps"]') ??
        diagram;
      if (!target) return;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      setPlaced({ ...placeAttached(target.getBoundingClientRect(), size, { width: innerWidth, height: innerHeight }, 120), ...size });
    };
    place();
    addEventListener('resize', place);
    const el = ref.current;
    const resized = typeof ResizeObserver === 'undefined' || !el ? null : new ResizeObserver(place);
    if (resized && el) resized.observe(el);
    return () => {
      removeEventListener('resize', place);
      resized?.disconnect();
    };
  }, [diagramLabel, anchorKey, viewTick]);

  // Escape closes the card even when focus has left it (for example after its button changed), unless a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        className="fl-popover fixed z-40 overflow-y-auto !p-0"
        style={{ width: WIDTH, top: placed?.top ?? 0, left: placed?.left ?? 0, maxHeight: 'calc(100vh - 140px)', visibility: placed ? 'visible' : 'hidden' }}
        data-testid="floating-plan-card"
      >
        <div className="flex items-center gap-2 border-b border-fl-border px-3.5 py-2">
          <p className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-[0.04em] text-fl-text-secondary">{title}</p>
          <button type="button" className="grid h-7 w-7 place-items-center rounded-[8px] text-fl-text-secondary hover:bg-fl-surface-subtle" aria-label="Close card" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="p-2.5">{children}</div>
      </div>
      <PanelPointer pointer={placed} colour="white" />
    </>
  );
}
