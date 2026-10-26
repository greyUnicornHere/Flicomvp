// Deterministic left-to-right layout. Layout only sets positions; it never changes connections.
import type { WorkflowEdge, WorkflowGraph } from '../../../shared/graph';

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 72;
const COLUMN = NODE_WIDTH + 104; // horizontal distance between columns
const ROW = NODE_HEIGHT + 56; // vertical distance between stacked steps

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
