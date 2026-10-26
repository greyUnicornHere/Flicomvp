import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus, Repeat } from 'lucide-react';
import type { WorkflowEdge } from '../../../shared/graph';
import { useEditorUi } from './EditorContext';

export type FlowEdgeType = Edge<{ edge: WorkflowEdge; sourceLabel: string; targetLabel: string; loopBottom?: number }, 'flow'>;

type Point = { x: number; y: number };

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Smooth left-to-right connector. */
function curve(source: Point, target: Point) {
  const dx = Math.max(Math.abs(target.x - source.x) / 2, 48);
  const points = [source, { x: source.x + dx, y: source.y }, { x: target.x - dx, y: target.y }, target] as const;
  const [p0, p1, p2, p3] = points;
  return {
    path: `M ${p0.x},${p0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
    at: (t: number) => cubic(p0, p1, p2, p3, t),
  };
}

/**
 * Repeat connections go around the steps: out to the gap after the source's column, down to a lane
 * below every step they pass, back to the gap before the target, and into its left side.
 * The gaps between columns never contain steps, so the route doesn't cross any.
 */
function loopRoute(source: Point, target: Point, lane: number) {
  const out = source.x + 30;
  const back = target.x - 30;
  const r = 18;
  const d = [
    `M ${source.x},${source.y}`,
    `L ${out - r},${source.y}`,
    `Q ${out},${source.y} ${out},${source.y + r}`,
    `L ${out},${lane - r}`,
    `Q ${out},${lane} ${out - r},${lane}`,
    `L ${back + r},${lane}`,
    `Q ${back},${lane} ${back},${lane - r}`,
    `L ${back},${target.y + r}`,
    `Q ${back},${target.y} ${back + r},${target.y}`,
    `L ${target.x},${target.y}`,
  ].join(' ');
  return { path: d, at: () => ({ x: (out + back) / 2, y: lane }) };
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
  const route = edge.type === 'loop' && data.loopBottom !== undefined ? loopRoute(source, target, data.loopBottom) : curve(source, target);
  const path = route.path;

  const isLoop = edge.type === 'loop';
  const canInsert = edge.type !== 'loop' && edge.type !== 'exception';
  const showPlus = ui.hoveredEdgeId === id || selected || ui.selectedEdgeId === id;
  const labelAt = route.at(0.5);
  const plusAt = route.at(edge.label ? 0.82 : 0.5);
  const stroke = selected ? 'var(--fl-brand)' : edge.type === 'exception' ? 'var(--fl-exception-stroke)' : 'var(--fl-edge)';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{ stroke, strokeWidth: selected ? 2.25 : 1.85, strokeDasharray: edge.type === 'exception' ? '6 5' : undefined }}
      />
      <EdgeLabelRenderer>
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
