import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus, Repeat } from 'lucide-react';
import type { WorkflowEdge } from '../../../shared/graph';
import { useEditorUi } from './EditorContext';
import { CHANGE_BADGE, type Change } from './changes';
import { cubic, curvePoints, roundedPath, type Detour, type Point } from './routing';

export type FlowEdgeType = Edge<
  { edge: WorkflowEdge; sourceLabel: string; targetLabel: string; loopBottom?: number; detour?: Detour; change?: Change },
  'flow'
>;

/** Smooth left-to-right connector. */
function curve(source: Point, target: Point) {
  const [p0, p1, p2, p3] = curvePoints(source, target);
  return {
    path: `M ${p0.x},${p0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
    at: (t: number) => cubic(p0, p1, p2, p3, t),
  };
}

/**
 * Around the steps: out from the source, along a clear horizontal lane, and back in to the target
 * from the left. Used for repeat connections (lane below) and for arrows a curve would draw over a step.
 */
function laneRoute(source: Point, target: Point, { out, back, lane }: Detour) {
  const path = roundedPath([source, { x: out, y: source.y }, { x: out, y: lane }, { x: back, y: lane }, { x: back, y: target.y }, target]);
  return { path, at: (t: number) => ({ x: out + (back - out) * t, y: lane }) };
}

const chipClass: Record<string, string> = {
  yes: 'bg-fl-brand-pale text-fl-brand-active',
  no: 'bg-[var(--fl-approval-fill)] text-[var(--fl-approval-ink)]',
  exception: 'bg-[var(--fl-exception-fill)] text-[var(--fl-exception-ink)] border border-dashed border-[var(--fl-exception-stroke)]',
  loop: 'bg-white text-fl-text-secondary border border-fl-border',
};

export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data, selected }: EdgeProps<FlowEdgeType>) {
  const ui = useEditorUi();
  if (!data) return null;
  const { edge } = data;
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const route =
    edge.type === 'loop' && data.loopBottom !== undefined
      ? laneRoute(source, target, { out: source.x + 30, back: target.x - 30, lane: data.loopBottom })
      : data.detour
        ? laneRoute(source, target, data.detour)
        : curve(source, target);
  const path = route.path;

  const isLoop = edge.type === 'loop';
  const canInsert = edge.type !== 'loop' && edge.type !== 'exception' && !ui.previewing;
  const showPlus = ui.hoveredEdgeId === id || selected || ui.selectedEdgeId === id;
  const labelAt = route.at(0.5);
  const plusAt = route.at(edge.label ? 0.82 : 0.5);
  const change = data.change;
  const stroke = change
    ? { added: 'var(--fl-diff-add)', modified: 'var(--fl-diff-change)', removed: 'var(--fl-diff-remove)' }[change]
    : selected
      ? 'var(--fl-brand)'
      : edge.type === 'exception'
        ? 'var(--fl-exception-stroke)'
        : 'var(--fl-edge)';
  const dashed = change === 'removed' ? '3 5' : edge.type === 'exception' ? '6 5' : undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{ stroke, strokeWidth: selected || change ? 2.25 : 1.85, strokeDasharray: dashed, opacity: change === 'removed' ? 0.75 : undefined }}
      />
      <EdgeLabelRenderer>
        {change && (
          <span
            className="fl-diff-badge pointer-events-none"
            data-diff={change}
            style={{ top: 0, left: 0, transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y + (edge.label ? -20 : 0)}px)` }}
            aria-hidden="true"
          >
            {CHANGE_BADGE[change]}
          </span>
        )}
        {edge.label && (
          <span
            className={`pointer-events-none absolute inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-[650] leading-4 ${chipClass[edge.type] ?? chipClass.loop}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
            aria-hidden="true"
          >
            {isLoop && <Repeat size={11} />}
            {edge.label}
          </span>
        )}
        {canInsert && (
          <button
            type="button"
            className={`fl-edge-add nodrag nopan ${showPlus ? 'is-visible' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${plusAt.x}px, ${plusAt.y}px)` }}
            aria-label={`Add a step between “${data.sourceLabel}” and “${data.targetLabel}”`}
            onMouseEnter={() => ui.hoverEdge(id)}
            onMouseLeave={() => ui.hoverEdge(null)}
            onClick={(event) => {
              event.stopPropagation();
              ui.openInsertMenu({ kind: 'edge', edgeId: id }, event.currentTarget);
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
