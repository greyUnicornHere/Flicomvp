// Deterministic left-to-right layout. Layout only sets positions; it never changes connections.
import type { WorkflowEdge, WorkflowGraph } from './graph.js';

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 72;
export const COLUMN = NODE_WIDTH + 104; // horizontal distance between columns
export const ROW = NODE_HEIGHT + 56; // vertical distance between stacked steps

/** Order of paths leaving one step, top to bottom: Yes above No, exceptions at the bottom. */
const TYPE_ORDER: Record<WorkflowEdge['type'], number> = { yes: 0, normal: 1, parallel: 1, no: 2, exception: 3, loop: 4 };

export function autoLayout(g: WorkflowGraph): WorkflowGraph {
  const ids = g.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const forward = g.edges.filter((e) => e.type !== 'loop' && index.has(e.sourceId) && index.has(e.targetId) && e.sourceId !== e.targetId);

  // Columns: longest path from the start (topological order; anything left over keeps column 0).
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const e of forward) indegree.set(e.targetId, indegree.get(e.targetId)! + 1);
  const column = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0).sort((a, b) => startFirst(g, a, b, index));
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of forward.filter((x) => x.sourceId === id).sort(byType)) {
      column.set(e.targetId, Math.max(column.get(e.targetId)!, column.get(id)! + 1));
      indegree.set(e.targetId, indegree.get(e.targetId)! - 1);
      if (indegree.get(e.targetId) === 0) queue.push(e.targetId);
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id); // defensive: cycles without loop type

  // Rows: each step wants to sit level with its parents; siblings fan out symmetrically.
  const y = new Map<string, number>();
  const columns = new Map<number, string[]>();
  for (const id of order) {
    const c = column.get(id)!;
    columns.set(c, [...(columns.get(c) ?? []), id]);
  }
  for (const c of [...columns.keys()].sort((a, b) => a - b)) {
    const members = columns.get(c)!;
    const wanted = members.map((id) => {
      const parents = forward.filter((e) => e.targetId === id && y.has(e.sourceId));
      if (parents.length === 0) return { id, want: 0, key: 0 };
      const want = parents.reduce((sum, e) => sum + y.get(e.sourceId)!, 0) / parents.length;
      // Fan out siblings of the same parent: Yes above, No below, in creation order.
      const first = parents[0]!;
      const siblings = forward.filter((e) => e.sourceId === first.sourceId).sort(byType);
      const rank = siblings.findIndex((e) => e.id === first.id);
      return { id, want, key: want + (rank - (siblings.length - 1) / 2) * ROW };
    });
    wanted.sort((a, b) => a.key - b.key || index.get(a.id)! - index.get(b.id)!);
    // Place in order without overlaps, then centre the group on where it wanted to be.
    const placed: number[] = [];
    for (const [i, w] of wanted.entries()) placed.push(i === 0 ? w.key : Math.max(w.key, placed[i - 1]! + ROW));
    const shift = wanted.reduce((s, w, i) => s + (w.key - placed[i]!), 0) / wanted.length;
    wanted.forEach((w, i) => y.set(w.id, Math.round(placed[i]! + shift)));
  }

  return {
    nodes: g.nodes.map((n) => ({ ...n, position: { x: column.get(n.id)! * COLUMN, y: y.get(n.id) ?? 0 } })),
    edges: g.edges,
  };
}

function byType(a: WorkflowEdge, b: WorkflowEdge) {
  return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
}

function startFirst(g: WorkflowGraph, a: string, b: string, index: Map<string, number>) {
  const isStart = (id: string) => (g.nodes[index.get(id)!]!.type === 'start' ? 0 : 1);
  return isStart(a) - isStart(b) || index.get(a)! - index.get(b)!;
}

type XY = { x: number; y: number };

/** Steps closer than this (beyond their own size) count as overlapping. */
const GAP = 16;
const overlaps = (a: XY, b: XY) => Math.abs(a.x - b.x) < NODE_WIDTH + GAP && Math.abs(a.y - b.y) < NODE_HEIGHT + GAP;

/**
 * Place the steps an edit added, without tidying anything else (Auto-arrange does that on request).
 * - Existing steps keep their positions.
 * - A new step sits one column to the right of the step it comes from: Yes above, No below,
 *   parallel activities stacked, exceptions underneath; a join sits level with what it joins.
 * - If that spot is taken, the nearest free spot above or below is used.
 * - When steps were inserted into an existing path, only the steps after them on that path
 *   slide right, and only as far as needed to make room.
 */
export function placeNewSteps(before: WorkflowGraph, after: WorkflowGraph): WorkflowGraph {
  const existing = new Map(before.nodes.map((n) => [n.id, n.position]));
  const added = after.nodes.filter((n) => !existing.has(n.id));
  if (added.length === 0) return after;

  const forward = after.edges.filter((e) => e.type !== 'loop');
  const addedIds = new Set(added.map((n) => n.id));

  // Existing steps that follow the new ones: they may need to slide right, so they don't block placement.
  const downstream = new Set<string>();
  const queue = forward.filter((e) => addedIds.has(e.sourceId) && existing.has(e.targetId)).map((e) => e.targetId);
  while (queue.length) {
    const id = queue.shift()!;
    if (downstream.has(id)) continue;
    downstream.add(id);
    for (const e of forward) if (e.sourceId === id && existing.has(e.targetId)) queue.push(e.targetId);
  }

  const placed = new Map<string, XY>();
  for (const [id, p] of existing) if (!downstream.has(id)) placed.set(id, p);
  const position = (id: string) => placed.get(id) ?? existing.get(id);

  const pending = [...added];
  while (pending.length) {
    // Next: a new step whose predecessors that are already known have positions.
    const index = Math.max(0, pending.findIndex((n) => forward.some((e) => e.targetId === n.id && position(e.sourceId))));
    const node = pending.splice(index, 1)[0]!;
    const parents = forward.filter((e) => e.targetId === node.id && position(e.sourceId));
    let want: XY;
    if (parents.length === 0) {
      const rightmost = Math.max(0, ...[...placed.values()].map((p) => p.x));
      want = { x: rightmost + COLUMN, y: 0 };
    } else {
      const x = Math.max(...parents.map((e) => position(e.sourceId)!.x)) + COLUMN;
      const ys = parents.map((e) => position(e.sourceId)!.y + offsetFor(e, after, addedIds));
      want = { x, y: Math.round(ys.reduce((a, b) => a + b, 0) / ys.length) };
    }
    placed.set(node.id, freeSpot(want, [...placed.entries()].filter(([id]) => id !== node.id).map(([, p]) => p)));
  }

  // Make room: slide the following steps right by the largest amount any of them needs.
  let shift = 0;
  for (const e of forward) {
    if (!addedIds.has(e.sourceId) || !downstream.has(e.targetId)) continue;
    shift = Math.max(shift, placed.get(e.sourceId)!.x + COLUMN - existing.get(e.targetId)!.x);
  }
  for (const id of downstream) {
    const p = existing.get(id)!;
    placed.set(id, shift > 0 ? { x: p.x + shift, y: p.y } : p);
  }

  return { nodes: after.nodes.map((n) => ({ ...n, position: placed.get(n.id) ?? n.position })), edges: after.edges };
}

/** Vertical offset of a new step relative to the step it comes from. */
function offsetFor(e: WorkflowEdge, g: WorkflowGraph, addedIds: Set<string>): number {
  if (e.type === 'yes') return -ROW / 2;
  if (e.type === 'no') return ROW / 2;
  if (e.type === 'exception') return ROW;
  if (e.type === 'parallel') {
    const siblings = g.edges.filter((x) => x.sourceId === e.sourceId && x.type === 'parallel' && addedIds.has(x.targetId));
    const i = siblings.findIndex((x) => x.id === e.id);
    return (i - (siblings.length - 1) / 2) * ROW;
  }
  return 0;
}

/** The wanted spot if free, otherwise the nearest free spot above or below it. */
function freeSpot(want: XY, taken: XY[]): XY {
  for (let step = 0; step < 40; step++) {
    for (const dir of step === 0 ? [0] : [1, -1]) {
      const candidate = { x: want.x, y: want.y + dir * step * (ROW / 2) };
      if (!taken.some((p) => overlaps(p, candidate))) return candidate;
    }
  }
  return want;
}
