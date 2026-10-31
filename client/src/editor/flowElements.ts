// Turns a workflow graph (optionally with proposed changes) into React Flow nodes and edges.
// Shared by the editor canvas and the analysis review diagram so both draw exactly the same way.
import { MarkerType } from '@xyflow/react';
import { diffGraphs, type GraphChanges } from '../../../shared/aiOps';
import type { WorkflowGraph } from '../../../shared/graph';
import type { Issue } from '../../../shared/validation';
import { CHANGE_BADGE, type Change } from './changes';
import type { FlowEdgeType } from './FlowEdge';
import { NODE_WIDTH, nodeHeight } from './layout';
import { findNode } from './ops';
import { curveCrosses, detour, type Box } from './routing';
import type { StepFlowNode } from './StepNode';
import { STEP_META } from './stepMeta';

export type Focus = 'on' | 'dim';
export type Display = { graph: WorkflowGraph; nodeChange: Map<string, Change>; edgeChange: Map<string, Change> };

const CHANGE_COLOUR: Record<Change, string> = { added: 'var(--fl-diff-add)', modified: 'var(--fl-diff-change)', removed: 'var(--fl-diff-remove)' };
const proposed = (change: Change) => CHANGE_BADGE[change].slice(2).toLowerCase();

/** The proposed graph plus what it removes (shown faded and struck through), with each change marked. */
export function withChanges(base: WorkflowGraph, next: WorkflowGraph, changes: GraphChanges = diffGraphs(base, next)): Display {
  const nodeChange = new Map<string, Change>();
  const edgeChange = new Map<string, Change>();
  for (const id of changes.addedNodes) nodeChange.set(id, 'added');
  for (const id of changes.modifiedNodes) nodeChange.set(id, 'modified');
  for (const id of changes.removedNodes) nodeChange.set(id, 'removed');
  for (const id of changes.addedEdges) edgeChange.set(id, 'added');
  for (const id of changes.modifiedEdges) edgeChange.set(id, 'modified');
  for (const id of changes.removedEdges) edgeChange.set(id, 'removed');
  return {
    graph: {
      nodes: [...next.nodes, ...base.nodes.filter((n) => nodeChange.get(n.id) === 'removed')],
      edges: [...next.edges, ...base.edges.filter((e) => edgeChange.get(e.id) === 'removed')],
    },
    nodeChange,
    edgeChange,
  };
}

type Sizes = Record<string, { width: number; height: number }>;
type Positions = Record<string, { x: number; y: number }>;

export function flowNodes(
  display: Display,
  options: { dims: Sizes; dragging?: Positions; selected?: string | null; issuesByNode?: Map<string, Issue[]>; focus?: (id: string) => Focus | undefined },
): StepFlowNode[] {
  return display.graph.nodes.map((n) => {
    const problems = options.issuesByNode?.get(n.id) ?? [];
    const change = display.nodeChange.get(n.id);
    const focus = options.focus?.(n.id);
    return {
      id: n.id,
      type: 'step',
      position: options.dragging?.[n.id] ?? n.position,
      data: { step: n, ...(change ? { change } : {}), ...(focus ? { focus } : {}) },
      selected: n.id === options.selected,
      measured: options.dims[n.id],
      ariaLabel: `${change ? `Proposed: ${proposed(change)}. ` : ''}${STEP_META[n.type].name} step: ${n.label || 'Untitled step'}${problems.length ? `. ${problems.map((p) => p.message).join(' ')}` : ''}${n.origin === 'ai-inferred' && n.assumptionStatus === 'unconfirmed' ? '. Inferred by Flico, not yet confirmed' : ''}`,
    };
  });
}

export function flowEdges(display: Display, options: { dims: Sizes; dragging?: Positions; focus?: (id: string) => Focus | undefined }): FlowEdgeType[] {
  const shown = display.graph;
  const labelIn = (id: string) => findNode(shown, id)?.label || 'Untitled step';
  // Current on-screen boxes of every step (including one being dragged).
  const boxes = new Map<string, Box>(
    shown.nodes.map((n) => {
      const p = options.dragging?.[n.id] ?? n.position;
      const size = options.dims[n.id] ?? { width: NODE_WIDTH, height: nodeHeight(n.label) };
      return [n.id, { left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height }];
    }),
  );
  return shown.edges.map((e): FlowEdgeType => {
    const change = display.edgeChange.get(e.id);
    const focus = options.focus?.(e.id);
    const isLoop = e.type === 'loop';
    const s = boxes.get(e.sourceId);
    const t = boxes.get(e.targetId);
    let loopBottom: number | undefined;
    let route: ReturnType<typeof detour> = null;
    if (s && t && isLoop) {
      const [minX, maxX] = [Math.min(s.left, t.left) - 40, Math.max(s.right, t.right) + 40];
      const between = [...boxes.values()].filter((b) => b.right > minX && b.left < maxX);
      loopBottom = Math.max(...between.map((b) => b.bottom)) + 40;
    } else if (s && t) {
      // Arrows normally curve; only when the curve would pass over a step do they go around it.
      const from = { x: s.right, y: (s.top + s.bottom) / 2 };
      const to = { x: t.left, y: (t.top + t.bottom) / 2 };
      const others = [...boxes.entries()].filter(([id]) => id !== e.sourceId && id !== e.targetId).map(([, b]) => b);
      if (curveCrosses(from, to, others)) route = detour(from, to, others);
    }
    const colour = change ? CHANGE_COLOUR[change] : e.type === 'exception' ? 'var(--fl-exception-stroke)' : 'var(--fl-edge)';
    const kind = e.type === 'yes' || e.type === 'no' ? `, ${e.label ?? e.type}` : e.type === 'loop' ? ', repeats' : e.type === 'exception' ? ', exception path' : '';
    return {
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: 'flow',
      sourceHandle: isLoop ? 'loop-out' : 'out',
      targetHandle: isLoop ? 'loop-in' : 'in',
      markerEnd: { type: MarkerType.Arrow, color: colour, width: 18, height: 18, strokeWidth: 1.6 },
      ariaLabel: `${change ? `Proposed: ${proposed(change)} connection. ` : ''}Connection from ${labelIn(e.sourceId)} to ${labelIn(e.targetId)}${kind}`,
      data: {
        edge: e,
        sourceLabel: labelIn(e.sourceId),
        targetLabel: labelIn(e.targetId),
        ...(change ? { change } : {}),
        ...(focus ? { focus } : {}),
        ...(loopBottom !== undefined ? { loopBottom } : {}),
        ...(route ? { detour: route } : {}),
      },
    };
  });
}
