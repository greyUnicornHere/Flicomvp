import { useReactFlow, useStore } from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { motionDuration } from './motion';

/** Bottom-right canvas utilities: zoom, fit to screen, auto-arrange (editor only). */
export function CanvasControls({ onAutoArrange, compact = false }: { onAutoArrange?: () => void; compact?: boolean }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const btn = 'grid h-11 w-11 place-items-center text-fl-text-secondary hover:bg-fl-brand-pale hover:text-fl-brand';
  return (
    <div className={`absolute z-10 flex items-center gap-3 ${compact ? 'bottom-4 right-4' : 'bottom-6 right-6'}`} role="group" aria-label="Canvas controls">
      <div className="flex items-center overflow-hidden rounded-[12px] border border-fl-border bg-fl-surface shadow-fl-card">
        <button type="button" className={btn} aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: motionDuration(150) })}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <span className="w-14 text-center text-[13px] font-semibold tabular-nums text-fl-text" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className={btn} aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: motionDuration(150) })}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className={`${btn} rounded-[12px] border border-fl-border bg-fl-surface shadow-fl-card`}
        aria-label="Fit to screen"
        title="Fit to screen"
        onClick={() => rf.fitView({ padding: 0.25, maxZoom: 1, duration: motionDuration(200) })}
      >
        <Maximize size={16} aria-hidden="true" />
      </button>
      {onAutoArrange && (
        <button type="button" className="fl-btn !text-fl-text-secondary shadow-fl-card" onClick={onAutoArrange}>
          Auto-arrange
        </button>
      )}
    </div>
  );
}
