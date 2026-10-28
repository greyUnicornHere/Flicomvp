// Edit proposals: a finite list of operations against existing step and connection IDs
// (IMPLEMENTATION_CONTRACTS.md §3). Shared so the server validates and applies exactly what the
// editor previews. Applying is all-or-nothing: any invalid operation rejects the whole proposal.
import { EDGE_TYPES, GRAPH_LIMITS, STEP_TYPES, type EdgeType, type StepType, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from './graph.js';

export const MAX_OPERATIONS = 40;

export type ProposalOperation =
  | { op: 'addStep'; id: string; type: StepType; label: string; notes?: string }
  | { op: 'updateStep'; stepId: string; label?: string; type?: StepType; notes?: string; owner?: string }
  | { op: 'removeStep'; stepId: string }
  | { op: 'addConnection'; id: string; sourceId: string; targetId: string; type: EdgeType; label?: string }
  | { op: 'removeConnection'; connectionId: string }
  | { op: 'updateConnection'; connectionId: string; type?: EdgeType; label?: string };

export type GraphChanges = {
  addedNodes: string[];
  modifiedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
  modifiedEdges: string[];
  removedEdges: string[];
};

export type ApplyResult = { ok: true; graph: WorkflowGraph } | { ok: false; problems: string[] };

const BRANCH_LABELS = { yes: 'Yes', no: 'No' } as const;

/**
 * Apply operations in order to a copy of the graph. New steps get a placeholder position; the caller
 * places them (placeNewSteps) so existing steps keep their positions.
 */
export function applyOperations(graph: WorkflowGraph, operations: ProposalOperation[]): ApplyResult {
  const problems: string[] = [];
  if (operations.length === 0) return { ok: false, problems: ['The proposal contains no changes.'] };
  if (operations.length > MAX_OPERATIONS) return { ok: false, problems: [`A proposal can contain at most ${MAX_OPERATIONS} changes.`] };

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = new Map(graph.edges.map((e) => [e.id, e]));
  const usedIds = new Set([...nodes.keys(), ...edges.keys()]);
  const label = (value: string | undefined, what: string): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) problems.push(`${what} needs a name.`);
    else if (trimmed.length > GRAPH_LIMITS.maxLabel) problems.push(`${what}: name is too long.`);
    return trimmed;
  };
  const text = (value: string | undefined, what: string) => {
    if (value !== undefined && value.length > GRAPH_LIMITS.maxText) problems.push(`${what} is too long.`);
    return value?.trim();
  };

  for (const [index, op] of operations.entries()) {
    const at = `Change ${index + 1}`;
    switch (op.op) {
      case 'addStep': {
        if (!op.id || usedIds.has(op.id)) problems.push(`${at}: the new step's ID is already in use.`);
        if (!STEP_TYPES.includes(op.type) || op.type === 'start') problems.push(`${at}: a new step can't be a ${op.type} step.`);
        const name = label(op.label, at);
        const notes = text(op.notes, `${at} notes`);
        usedIds.add(op.id);
        const node: WorkflowNode = { id: op.id, type: op.type, label: name ?? '', position: { x: 0, y: 0 }, origin: 'ai-inferred', assumptionStatus: 'confirmed' };
        if (notes) node.notes = notes;
        nodes.set(op.id, node);
        break;
      }
      case 'updateStep': {
        const node = nodes.get(op.stepId);
        if (!node) {
          problems.push(`${at}: step ${op.stepId} doesn't exist.`);
          break;
        }
        const next: WorkflowNode = { ...node };
        if (op.label !== undefined) next.label = label(op.label, at) ?? node.label;
        if (op.type !== undefined && op.type !== node.type) {
          if (!STEP_TYPES.includes(op.type) || op.type === 'start' || node.type === 'start') problems.push(`${at}: the Start step's type can't change.`);
          next.type = op.type;
        }
        if (op.notes !== undefined) {
          const notes = text(op.notes, `${at} notes`);
          if (notes) next.notes = notes;
          else delete next.notes;
        }
        if (op.owner !== undefined) {
          const owner = text(op.owner, `${at} owner`);
          if (owner) next.owner = owner;
          else delete next.owner;
        }
        nodes.set(node.id, next);
        break;
      }
      case 'removeStep': {
        const node = nodes.get(op.stepId);
        if (!node) problems.push(`${at}: step ${op.stepId} doesn't exist.`);
        else if (node.type === 'start') problems.push(`${at}: the Start step can't be removed.`);
        else {
          nodes.delete(node.id);
          for (const [id, e] of edges) if (e.sourceId === node.id || e.targetId === node.id) edges.delete(id);
        }
        break;
      }
      case 'addConnection': {
        if (!op.id || usedIds.has(op.id)) problems.push(`${at}: the new connection's ID is already in use.`);
        if (!EDGE_TYPES.includes(op.type)) problems.push(`${at}: unknown connection type.`);
        usedIds.add(op.id);
        const edge: WorkflowEdge = { id: op.id, sourceId: op.sourceId, targetId: op.targetId, type: op.type };
        const name = op.label?.trim() || (op.type === 'yes' || op.type === 'no' ? BRANCH_LABELS[op.type] : '');
        if (name) edge.label = label(name, at)!;
        if (op.type === 'yes' || op.type === 'no') edge.branchGroupId = op.sourceId;
        edges.set(op.id, edge);
        break;
      }
      case 'removeConnection': {
        if (!edges.delete(op.connectionId)) problems.push(`${at}: connection ${op.connectionId} doesn't exist.`);
        break;
      }
      case 'updateConnection': {
        const edge = edges.get(op.connectionId);
        if (!edge) {
          problems.push(`${at}: connection ${op.connectionId} doesn't exist.`);
          break;
        }
        const next: WorkflowEdge = { ...edge };
        if (op.type !== undefined) {
          if (!EDGE_TYPES.includes(op.type)) problems.push(`${at}: unknown connection type.`);
          next.type = op.type;
        }
        if (op.label !== undefined) {
          const name = op.label.trim();
          if (name) next.label = label(name, at)!;
          else delete next.label;
        }
        edges.set(edge.id, next);
        break;
      }
      default:
        problems.push(`${at}: unknown kind of change.`);
    }
  }

  const result: WorkflowGraph = { nodes: [...nodes.values()], edges: [...edges.values()] };
  problems.push(...structuralProblems(result));
  return problems.length ? { ok: false, problems: [...new Set(problems)] } : { ok: true, graph: result };
}

/** Integrity rules every stored graph must satisfy (mirrors the server's storage validation). */
export function structuralProblems(g: WorkflowGraph): string[] {
  const problems: string[] = [];
  const types = new Map(g.nodes.map((n) => [n.id, n.type]));
  if (g.nodes.length > GRAPH_LIMITS.maxNodes || g.edges.length > GRAPH_LIMITS.maxEdges) problems.push('The workflow would be too large.');
  if (g.nodes.filter((n) => n.type === 'start').length !== 1) problems.push('The workflow must keep exactly one Start step.');
  const branches = new Set<string>();
  const pairs = new Set<string>();
  for (const e of g.edges) {
    if (!types.has(e.sourceId) || !types.has(e.targetId)) {
      problems.push(`A connection points to a step that doesn't exist.`);
      continue;
    }
    if (e.sourceId === e.targetId) problems.push('A connection would connect a step to itself.');
    if (e.type === 'yes' || e.type === 'no') {
      if (types.get(e.sourceId) !== 'decision') problems.push('Only decisions can have Yes/No paths.');
      const key = `${e.sourceId}:${e.type}`;
      if (branches.has(key)) problems.push(`A decision would have more than one ${BRANCH_LABELS[e.type]} path.`);
      branches.add(key);
    }
    const pair = `${e.sourceId}>${e.targetId}:${e.type}`;
    if (pairs.has(pair)) problems.push('Two identical connections between the same steps.');
    pairs.add(pair);
  }
  return problems;
}

/** What differs between two graphs, by stable ID. Positions alone don't count as a change. */
export function diffGraphs(before: WorkflowGraph, after: WorkflowGraph): GraphChanges {
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));
  const stable = (value: object) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  const nodeKey = ({ position: _position, ...rest }: WorkflowNode) => stable(rest);
  const edgeKey = (e: WorkflowEdge) => stable(e);
  return {
    addedNodes: after.nodes.filter((n) => !beforeNodes.has(n.id)).map((n) => n.id),
    removedNodes: before.nodes.filter((n) => !afterNodes.has(n.id)).map((n) => n.id),
    modifiedNodes: after.nodes.filter((n) => beforeNodes.has(n.id) && nodeKey(beforeNodes.get(n.id)!) !== nodeKey(n)).map((n) => n.id),
    addedEdges: after.edges.filter((e) => !beforeEdges.has(e.id)).map((e) => e.id),
    removedEdges: before.edges.filter((e) => !afterEdges.has(e.id)).map((e) => e.id),
    modifiedEdges: after.edges.filter((e) => beforeEdges.has(e.id) && edgeKey(beforeEdges.get(e.id)!) !== edgeKey(e)).map((e) => e.id),
  };
}
