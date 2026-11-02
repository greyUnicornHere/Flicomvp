// Deterministic left-to-right layout. Layout only sets positions; it never changes connections.
import type { WorkflowEdge, WorkflowGraph } from './graph.js';

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 72;
export const COLUMN = NODE_WIDTH + 104; // horizontal distance between columns
export const ROW = NODE_HEIGHT + 56; // vertical distance between stacked steps
const ROW_GAP = ROW - NODE_HEIGHT;

/**
 * Height a step needs so its whole name shows (names wrap; blocks never cut them off).
 * Estimated from the text so the server and the browser place steps identically: about 14
 * characters per line at the node's width, 18 px per line, at least the standard 72 px.
 */
export function nodeHeight(label: string): number {
  const perLine = 14;
  let lines = 1;
  let used = 0;
  for (const word of label.trim().split(/\s+/).filter(Boolean)) {
    let rest = word.length;
    if (used > 0 && used + 1 + rest > perLine) {
      lines += 1;
      used = 0;
    }
    if (used > 0) used += 1;
    // A single word longer than a line breaks across lines.
    while (used + rest > perLine) {
      rest -= perLine - used;
      lines += 1;
      used = 0;
    }
    used += rest;
  }
  return Math.max(NODE_HEIGHT, 28 + 18 * lines); // even, so middles stay on whole pixels
}

/**
 * Steps of different heights are lined up by their middles, so straight arrows stay straight.
 * "mid" is expressed in the same units as a standard step's top, so standard layouts don't move.
 */
const midOf = (top: number, h: number) => top + h / 2 - NODE_HEIGHT / 2;
const topOf = (mid: number, h: number) => Math.round(mid - h / 2 + NODE_HEIGHT / 2);

/** Order of paths leaving one step, top to bottom: Yes above No, exceptions at the bottom. */
const TYPE_ORDER: Record<WorkflowEdge['type'], number> = { yes: 0, normal: 1, parallel: 1, no: 2, exception: 3, loop: 4 };

/**
 * Connections that go back to an earlier step (for example "Retry limit reached? → No → Search"),
 * found by walking the workflow from Start. They close a cycle, so layout treats them like Repeat
 * loops: left out when ordering steps left to right, and drawn as a return path under the steps.
 * Repeat (loop) connections themselves are not included: they are always return paths.
 */
export function backEdges(g: WorkflowGraph): Set<string> {
  const ids = g.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const back = new Set<string>();
  const out = new Map<string, WorkflowEdge[]>(ids.map((id) => [id, []]));
  for (const e of g.edges) {
    if (e.type === 'loop' || !index.has(e.sourceId) || !index.has(e.targetId)) continue;
    if (e.sourceId === e.targetId) back.add(e.id);
    else out.get(e.sourceId)!.push(e);
  }
  for (const list of out.values()) list.sort(byType);
  const state = new Map<string, 'open' | 'done'>();
  for (const root of [...ids].sort((a, b) => startFirst(g, a, b, index))) {
    if (state.has(root)) continue;
    state.set(root, 'open');
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    while (stack.length) {
      const top = stack.at(-1)!;
      const edge = out.get(top.id)![top.next++];
      if (!edge) {
        state.set(top.id, 'done');
        stack.pop();
      } else if (state.get(edge.targetId) === 'open') {
        back.add(edge.id); // points to a step still on the current path: it goes back
      } else if (!state.has(edge.targetId)) {
        state.set(edge.targetId, 'open');
        stack.push({ id: edge.targetId, next: 0 });
      }
    }
  }
  return back;
}

export function autoLayout(g: WorkflowGraph): WorkflowGraph {
  const ids = g.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const back = backEdges(g);
  const forward = g.edges.filter((e) => e.type !== 'loop' && !back.has(e.id) && index.has(e.sourceId) && index.has(e.targetId) && e.sourceId !== e.targetId);

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
  for (const id of ids) if (!order.includes(id)) order.push(id); // defensive: nothing should be left over

  // Rows: each step wants to sit level with its parents; siblings fan out symmetrically.
  const heights = new Map(g.nodes.map((n) => [n.id, nodeHeight(n.label)]));
  const y = new Map<string, number>(); // middles (see midOf)
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
    for (const [i, w] of wanted.entries()) {
      const room = i === 0 ? 0 : (heights.get(wanted[i - 1]!.id)! + heights.get(w.id)!) / 2 + ROW_GAP;
      placed.push(i === 0 ? w.key : Math.max(w.key, placed[i - 1]! + room));
    }
    const shift = wanted.reduce((s, w, i) => s + (w.key - placed[i]!), 0) / wanted.length;
    wanted.forEach((w, i) => y.set(w.id, Math.round(placed[i]! + shift)));
  }

  return {
    nodes: g.nodes.map((n) => ({ ...n, position: { x: column.get(n.id)! * COLUMN, y: topOf(y.get(n.id) ?? 0, heights.get(n.id)!) } })),
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
type Box = XY & { h: number };
const overlaps = (a: Box, b: Box) => Math.abs(a.x - b.x) < NODE_WIDTH + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

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

  const back = backEdges(after);
  const forward = after.edges.filter((e) => e.type !== 'loop' && !back.has(e.id));
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

  const heights = new Map([...before.nodes, ...after.nodes].map((n) => [n.id, nodeHeight(n.label)]));
  const height = (id: string) => heights.get(id) ?? NODE_HEIGHT;
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
    const h = height(node.id);
    if (parents.length === 0) {
      const rightmost = Math.max(0, ...[...placed.values()].map((p) => p.x));
      want = { x: rightmost + COLUMN, y: 0 };
    } else {
      // Level with the middle of the step(s) it comes from.
      const x = Math.max(...parents.map((e) => position(e.sourceId)!.x)) + COLUMN;
      const mids = parents.map((e) => midOf(position(e.sourceId)!.y, height(e.sourceId)) + offsetFor(e, after, addedIds));
      want = { x, y: topOf(mids.reduce((a, b) => a + b, 0) / mids.length, h) };
    }
    const taken = [...placed.entries()].filter(([id]) => id !== node.id).map(([id, p]) => ({ ...p, h: height(id) }));
    placed.set(node.id, freeSpot({ ...want, h }, taken));
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
function freeSpot(want: Box, taken: Box[]): XY {
  for (let step = 0; step < 40; step++) {
    for (const dir of step === 0 ? [0] : [1, -1]) {
      const candidate = { x: want.x, y: want.y + dir * step * (ROW / 2), h: want.h };
      if (!taken.some((p) => overlaps(p, candidate))) return { x: candidate.x, y: candidate.y };
    }
  }
  return { x: want.x, y: want.y };
}
