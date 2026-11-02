import type { WorkflowGraph } from '../../../../shared/graph';
import { autoLayout, COLUMN, NODE_HEIGHT, NODE_WIDTH, ROW, nodeHeight } from '../layout';
import type { Display } from '../flowElements';

/** Space between the proposed workflow and the lane of removed steps below it. */
const LANE_GAP = ROW - NODE_HEIGHT + 24;
/** Minimum horizontal space between two removed steps in the lane. */
const LANE_SPACING = NODE_WIDTH + 32;

/**
 * Change-aware arrangement of a review diagram. The proposed workflow (unchanged, updated and added
 * steps with their current connections) is auto-arranged on its own, so old and new routes never
 * compete for rows. Each removed step goes into a lane below it, under the place it used to be:
 * between the remaining steps it sat between. Its old connections are kept and drawn as removed.
 * View only: nothing here changes the saved workflow.
 */
export function reviewLayout(display: Display): WorkflowGraph {
  const isRemoved = (id: string) => display.nodeChange.get(id) === 'removed';
  const removedNodes = display.graph.nodes.filter((n) => isRemoved(n.id));
  const proposed: WorkflowGraph = {
    nodes: display.graph.nodes.filter((n) => !isRemoved(n.id)),
    edges: display.graph.edges.filter((e) => display.edgeChange.get(e.id) !== 'removed' && !isRemoved(e.sourceId) && !isRemoved(e.targetId)),
  };
  const arranged = autoLayout(proposed);
  if (removedNodes.length === 0) return { nodes: arranged.nodes, edges: display.graph.edges };

  const position = new Map(arranged.nodes.map((n) => [n.id, n.position]));
  const bottom = Math.max(...arranged.nodes.map((n) => n.position.y + nodeHeight(n.label)), 0);
  const laneTop = bottom + LANE_GAP;

  // The remaining steps a removed step sat between, following chains of removed steps.
  const neighbours = (start: string, direction: 'before' | 'after') => {
    const found: { x: number; y: number }[] = [];
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of display.graph.edges) {
        if (e.type === 'loop') continue;
        const next = direction === 'before' ? (e.targetId === id ? e.sourceId : null) : e.sourceId === id ? e.targetId : null;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        const at = position.get(next);
        if (at) found.push(at);
        else if (isRemoved(next)) queue.push(next);
      }
    }
    return found;
  };

  const wanted = removedNodes.map((n) => {
    const before = neighbours(n.id, 'before');
    const after = neighbours(n.id, 'after');
    const fromX = before.length ? Math.max(...before.map((p) => p.x)) : null;
    const toX = after.length ? Math.min(...after.map((p) => p.x)) : null;
    const x = fromX !== null && toX !== null ? (fromX + toX) / 2 : fromX !== null ? fromX + COLUMN : toX !== null ? toX - COLUMN : 0;
    return { node: n, x };
  });
  // Keep the original order where several removed steps want the same place, and never overlap them.
  wanted.sort((a, b) => a.x - b.x || a.node.position.x - b.node.position.x);
  let lastX = -Infinity;
  const placed = new Map<string, { x: number; y: number }>();
  for (const { node, x } of wanted) {
    const at = Math.max(Math.round(x), lastX + LANE_SPACING);
    placed.set(node.id, { x: at, y: laneTop });
    lastX = at;
  }

  return {
    nodes: [...arranged.nodes, ...removedNodes.map((n) => ({ ...n, position: placed.get(n.id)! }))],
    edges: display.graph.edges,
  };
}
