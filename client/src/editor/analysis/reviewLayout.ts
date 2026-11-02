import type { WorkflowGraph } from '../../../../shared/graph';
import { autoLayout } from '../layout';
import type { Display } from '../flowElements';

export type RemovedStep = {
  id: string;
  label: string;
  /** The remaining steps it sat after and before (following chains of removed steps). */
  after: { id: string; label: string }[];
  before: { id: string; label: string }[];
};

/**
 * The review diagram shows only the proposed workflow: unchanged, updated and added steps with their
 * current connections, auto-arranged. Removed steps and removed connections are not drawn; removed
 * steps are listed beside the diagram instead (see `removedSteps`). View only: the saved layout is untouched.
 */
export function reviewLayout(display: Display): Display {
  const isRemoved = (id: string) => display.nodeChange.get(id) === 'removed';
  const proposed: WorkflowGraph = {
    nodes: display.graph.nodes.filter((n) => !isRemoved(n.id)),
    edges: display.graph.edges.filter((e) => display.edgeChange.get(e.id) !== 'removed' && !isRemoved(e.sourceId) && !isRemoved(e.targetId)),
  };
  return { ...display, graph: autoLayout(proposed) };
}

/** The removed steps of a review, each with the remaining steps it sat between, in workflow order. */
export function removedSteps(display: Display): RemovedStep[] {
  const isRemoved = (id: string) => display.nodeChange.get(id) === 'removed';
  const byId = new Map(display.graph.nodes.map((n) => [n.id, n]));
  const neighbours = (start: string, direction: 'after' | 'before') => {
    const found = new Map<string, string>();
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of display.graph.edges) {
        if (e.type === 'loop') continue;
        const next = direction === 'after' ? (e.targetId === id ? e.sourceId : null) : e.sourceId === id ? e.targetId : null;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        if (isRemoved(next)) queue.push(next);
        else if (byId.has(next)) found.set(next, byId.get(next)!.label);
      }
    }
    return [...found].map(([id, label]) => ({ id, label }));
  };
  return display.graph.nodes
    .filter((n) => isRemoved(n.id))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map((n) => ({ id: n.id, label: n.label, after: neighbours(n.id, 'after'), before: neighbours(n.id, 'before') }));
}
