import type { EdgeType, StepType, WorkflowGraph } from '../../../../shared/graph';

/** Deterministic ID generator for tests: n1, n2, ... */
export function counterIds(prefix = 'id') {
  let i = 0;
  return () => `${prefix}${++i}`;
}

type Spec = { nodes: [string, StepType, string][]; edges: [string, string, EdgeType?, string?][] };

/** Small graph builder: nodes as [id, type, label], edges as [source, target, type?, label?]. */
export function graph({ nodes, edges }: Spec): WorkflowGraph {
  return {
    nodes: nodes.map(([id, type, label]) => ({ id, type, label, position: { x: 0, y: 0 } })),
    edges: edges.map(([sourceId, targetId, type = 'normal', label], i) => ({
      id: `e${i + 1}`,
      sourceId,
      targetId,
      type,
      ...(label ? { label } : {}),
      ...(type === 'yes' || type === 'no' ? { branchGroupId: sourceId } : {}),
    })),
  };
}

/** Readable list of connections: "Start → Receive order", "Stock? -yes-> Reserve". */
export function describe(g: WorkflowGraph): string[] {
  const name = (id: string) => g.nodes.find((n) => n.id === id)?.label ?? `?${id}`;
  return g.edges
    .map((e) => `${name(e.sourceId)} ${e.type === 'normal' ? '→' : `-${e.type}->`} ${name(e.targetId)}`)
    .sort();
}

export const startOnly = () => graph({ nodes: [['s', 'start', 'Start']], edges: [] });

/** QA fixture 1: Start → Receive order → Verify stock → Finish. */
export const sequential = () =>
  graph({
    nodes: [
      ['s', 'start', 'Start'],
      ['a', 'action', 'Receive order'],
      ['b', 'action', 'Verify stock'],
      ['f', 'finish', 'Finish'],
    ],
    edges: [
      ['s', 'a'],
      ['a', 'b'],
      ['b', 'f'],
    ],
  });
