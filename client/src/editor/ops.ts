// Pure graph operations for the manual editor. Every function returns a new graph and never mutates
// its input, so each user action can be one undoable step. IDs come from an injectable generator.
import type { EdgeType, StepType, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../../shared/graph';

export type IdGen = () => string;
export const randomId: IdGen = () => crypto.randomUUID();

/** Where a new step goes. */
export type Slot =
  | { kind: 'edge'; edgeId: string } // on an existing connection
  | { kind: 'after'; nodeId: string } // after a step that doesn't continue yet
  | { kind: 'branch'; nodeId: string; branch: 'yes' | 'no' }; // an open Yes/No path of a decision

export type InsertableType = 'action' | 'approval' | 'wait' | 'finish';

export const DEFAULT_NAMES: Record<StepType, string> = {
  start: 'Start',
  action: 'New action',
  decision: 'New decision',
  approval: 'New approval',
  wait: 'New wait',
  finish: 'Finish',
  exception: 'New exception',
};

export const BRANCH_LABEL = { yes: 'Yes', no: 'No' } as const;
export const JOIN_LABEL = 'All activities complete';

export class GraphOpError extends Error {}

// ---------- queries ----------

export const findNode = (g: WorkflowGraph, id: string) => g.nodes.find((n) => n.id === id);
export const findEdge = (g: WorkflowGraph, id: string) => g.edges.find((e) => e.id === id);

/** Connections that carry the main flow (everything except loops and exception paths). */
export const isFlowEdge = (e: WorkflowEdge) => e.type !== 'loop' && e.type !== 'exception';

export const outgoing = (g: WorkflowGraph, id: string) => g.edges.filter((e) => e.sourceId === id);
export const incoming = (g: WorkflowGraph, id: string) => g.edges.filter((e) => e.targetId === id);
export const flowOut = (g: WorkflowGraph, id: string) => outgoing(g, id).filter(isFlowEdge);

/** Which Yes/No paths of a decision don't lead anywhere yet. */
export function openBranches(g: WorkflowGraph, decisionId: string): ('yes' | 'no')[] {
  const node = findNode(g, decisionId);
  if (node?.type !== 'decision') return [];
  const out = outgoing(g, decisionId);
  return (['yes', 'no'] as const).filter((b) => !out.some((e) => e.type === b));
}

/** Steps that lead to this one (following everything except loop connections). */
export function ancestors(g: WorkflowGraph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const e of incoming(g, current)) {
      if (e.type === 'loop' || seen.has(e.sourceId)) continue;
      seen.add(e.sourceId);
      stack.push(e.sourceId);
    }
  }
  seen.delete(id);
  return seen;
}

export function descendants(g: WorkflowGraph, id: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of outgoing(g, current)) {
      if (e.type === 'loop' || seen.has(e.targetId)) continue;
      seen.add(e.targetId);
      order.push(e.targetId);
      queue.push(e.targetId);
    }
  }
  return order.filter((n) => n !== id);
}

/**
 * Where the toolbar's "add after the selected step" goes, or why it can't.
 * Finish ends a path; branching steps need a specific + on one of their paths.
 */
export function slotAfter(g: WorkflowGraph, nodeId: string): { slot: Slot } | { reason: string } {
  const node = findNode(g, nodeId);
  if (!node) return { reason: 'Select a step first.' };
  if (node.type === 'finish') return { reason: 'Finish ends the workflow. Select another step.' };
  if (node.type === 'decision') {
    const open = openBranches(g, nodeId);
    if (open[0]) return { slot: { kind: 'branch', nodeId, branch: open[0] } };
    return { reason: 'Use the + on the Yes or No path to add a step there.' };
  }
  const flows = flowOut(g, nodeId);
  if (flows.length === 0) return { slot: { kind: 'after', nodeId } };
  if (flows.length === 1) return { slot: { kind: 'edge', edgeId: flows[0]!.id } };
  return { reason: 'This step splits into several paths. Use the + on one of its connections.' };
}

/** The step that currently follows an insertion point, if any. */
export function slotDownstream(g: WorkflowGraph, slot: Slot): string | undefined {
  return slot.kind === 'edge' ? findEdge(g, slot.edgeId)?.targetId : undefined;
}

// ---------- building blocks ----------

function newNode(idGen: IdGen, type: StepType, label: string, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id: idGen(), type, label, position: { x: 0, y: 0 }, origin: 'user', ...extra };
}

function edge(idGen: IdGen, sourceId: string, targetId: string, type: EdgeType = 'normal', extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
  const e: WorkflowEdge = { id: idGen(), sourceId, targetId, type };
  return { ...e, ...extra };
}

/**
 * Connect a new step into a slot. Returns the graph (with the step added) and the step that used to
 * follow the slot, so callers can continue the path to it.
 */
function attach(g: WorkflowGraph, slot: Slot, node: WorkflowNode, idGen: IdGen): { graph: WorkflowGraph; downstream?: string } {
  if (slot.kind === 'edge') {
    const e = findEdge(g, slot.edgeId);
    if (!e) throw new GraphOpError('That connection no longer exists.');
    if (e.type === 'loop') throw new GraphOpError("Steps can't be added on a repeat connection.");
    const incomingEdge = { ...e, id: idGen(), targetId: node.id };
    return {
      graph: { nodes: [...g.nodes, node], edges: [...g.edges.filter((x) => x.id !== e.id), incomingEdge] },
      downstream: e.targetId,
    };
  }
  const source = findNode(g, slot.nodeId);
  if (!source) throw new GraphOpError('That step no longer exists.');
  if (source.type === 'finish') throw new GraphOpError('Finish ends the workflow.');
  if (slot.kind === 'branch') {
    if (source.type !== 'decision') throw new GraphOpError('Only decisions have Yes/No paths.');
    if (!openBranches(g, source.id).includes(slot.branch)) throw new GraphOpError(`The ${BRANCH_LABEL[slot.branch]} path already continues.`);
    const branchEdge = edge(idGen, source.id, node.id, slot.branch, { label: BRANCH_LABEL[slot.branch], branchGroupId: source.id });
    return { graph: { nodes: [...g.nodes, node], edges: [...g.edges, branchEdge] } };
  }
  if (source.type === 'decision') throw new GraphOpError('Add steps after a decision on its Yes or No path.');
  return { graph: { nodes: [...g.nodes, node], edges: [...g.edges, edge(idGen, source.id, node.id)] } };
}

// ---------- operations ----------

export type OpResult = { graph: WorkflowGraph; focusId?: string };

/** Add a manual step (Action, Approval, Wait, Finish) at a slot. */
export function insertStep(g: WorkflowGraph, slot: Slot, type: InsertableType, idGen: IdGen = randomId): OpResult {
  if (type === 'finish' && slot.kind === 'edge') {
    throw new GraphOpError('Finish can only end a path, not sit between two steps.');
  }
  const node = newNode(idGen, type, DEFAULT_NAMES[type]);
  const { graph, downstream } = attach(g, slot, node, idGen);
  const edges = downstream ? [...graph.edges, edge(idGen, node.id, downstream)] : graph.edges;
  return { graph: { nodes: graph.nodes, edges }, focusId: node.id };
}

export type DecisionInput = {
  question: string;
  yes?: string;
  no?: string;
  /** When the slot already continues to a step: which paths continue there afterwards. */
  continueWith?: 'both' | 'yes' | 'no';
};

/**
 * Guided decision: a question with Yes/No paths. Filled outcomes become steps; a blank outcome stays
 * an open path to fill later. If the slot already led somewhere, that step is never orphaned:
 * it is joined from both paths (default) or from the chosen one.
 */
export function addDecision(g: WorkflowGraph, slot: Slot, input: DecisionInput, idGen: IdGen = randomId): OpResult {
  const question = input.question.trim();
  if (!question) throw new GraphOpError('Please enter the decision question.');
  const decision = newNode(idGen, 'decision', question);
  const attached = attach(g, slot, decision, idGen);
  let { nodes, edges } = attached.graph;
  const downstream = attached.downstream;
  const continueWith = downstream ? (input.continueWith ?? 'both') : undefined;

  for (const branch of ['yes', 'no'] as const) {
    const text = input[branch]?.trim();
    const continues = continueWith === 'both' || continueWith === branch;
    const branchEdge = (targetId: string) =>
      edge(idGen, decision.id, targetId, branch, { label: BRANCH_LABEL[branch], branchGroupId: decision.id });
    if (text) {
      const outcome = newNode(idGen, 'action', text);
      nodes = [...nodes, outcome];
      edges = [...edges, branchEdge(outcome.id)];
      if (continues && downstream) edges = [...edges, edge(idGen, outcome.id, downstream)];
    } else if (continues && downstream) {
      edges = [...edges, branchEdge(downstream)];
    }
  }
  if (downstream && continueWith === 'both') {
    nodes = nodes.map((n) => (n.id === downstream ? { ...n, structure: { ...n.structure, joinGroupId: decision.id } } : n));
  }
  return { graph: { nodes, edges }, focusId: decision.id };
}

/** Steps the guided loop can repeat from a given step: those that lead to it. */
export function loopTargets(g: WorkflowGraph, fromId: string): WorkflowNode[] {
  const before = ancestors(g, fromId);
  const existing = new Set(outgoing(g, fromId).filter((e) => e.type === 'loop').map((e) => e.targetId));
  return g.nodes.filter((n) => before.has(n.id) && !existing.has(n.id));
}

/** Guided "Repeat earlier step": an explicit loop connection back to an earlier step. */
export function addLoop(g: WorkflowGraph, fromId: string, toId: string, condition: string, idGen: IdGen = randomId): OpResult {
  if (!findNode(g, fromId) || !findNode(g, toId)) throw new GraphOpError('That step no longer exists.');
  if (!ancestors(g, fromId).has(toId)) throw new GraphOpError('A step can only repeat a step that comes before it.');
  if (outgoing(g, fromId).some((e) => e.type === 'loop' && e.targetId === toId)) {
    throw new GraphOpError('This repeat already exists.');
  }
  const label = condition.trim() || 'Repeat';
  return { graph: { nodes: g.nodes, edges: [...g.edges, edge(idGen, fromId, toId, 'loop', { label })] }, focusId: fromId };
}

export type ParallelInput = { activities: string[]; waitForAll: boolean };

/**
 * Guided parallel activities from a step. With wait-for-all, every activity joins a visible
 * "All activities complete" step that then continues to whatever followed. Without it, the
 * activities run alongside and the main path continues unchanged.
 */
export function addParallel(g: WorkflowGraph, fromId: string, input: ParallelInput, idGen: IdGen = randomId): OpResult {
  const source = findNode(g, fromId);
  if (!source) throw new GraphOpError('That step no longer exists.');
  if (source.type === 'decision' || source.type === 'finish') {
    throw new GraphOpError('Parallel activities start from a regular step, not a decision or Finish.');
  }
  const names = input.activities.map((a) => a.trim()).filter(Boolean);
  if (names.length < 2) throw new GraphOpError('Describe at least two activities that happen at the same time.');
  const flows = flowOut(g, fromId);
  if (flows.length > 1) throw new GraphOpError('This step already splits into several paths.');

  const group = idGen();
  const activities = names.map((name) => newNode(idGen, 'action', name));
  let edges = [...g.edges];
  let nodes = [...g.nodes, ...activities];
  edges = [...edges, ...activities.map((a) => edge(idGen, fromId, a.id, 'parallel', { branchGroupId: group }))];

  if (input.waitForAll) {
    const join = newNode(idGen, 'wait', JOIN_LABEL, { structure: { joinGroupId: group } });
    nodes = [...nodes, join];
    edges = [...edges, ...activities.map((a) => edge(idGen, a.id, join.id))];
    const continuation = flows[0];
    if (continuation) {
      edges = edges.filter((e) => e.id !== continuation.id);
      edges = [...edges, edge(idGen, join.id, continuation.targetId)];
    }
  }
  return { graph: { nodes, edges }, focusId: activities[0]!.id };
}

export type ExceptionInput = { exception: string; response?: string };

/** Dedicated exception path: what can go wrong at this step and what happens then (dashed). */
export function addException(g: WorkflowGraph, nodeId: string, input: ExceptionInput, idGen: IdGen = randomId): OpResult {
  const source = findNode(g, nodeId);
  if (!source) throw new GraphOpError('That step no longer exists.');
  if (source.type === 'start' || source.type === 'finish') throw new GraphOpError('Exceptions belong to a step in the middle of the workflow.');
  const text = input.exception.trim();
  if (!text) throw new GraphOpError('Describe what can go wrong.');
  const exception = newNode(idGen, 'exception', text);
  let nodes = [...g.nodes, exception];
  let edges = [...g.edges, edge(idGen, nodeId, exception.id, 'exception', { label: 'Exception' })];
  const response = input.response?.trim();
  if (response) {
    const responseNode = newNode(idGen, 'action', response);
    nodes = [...nodes, responseNode];
    edges = [...edges, edge(idGen, exception.id, responseNode.id)];
  }
  return { graph: { nodes, edges }, focusId: exception.id };
}

export type DeletionImpact = {
  node: WorkflowNode;
  /** Every connection that will be removed. */
  removed: WorkflowEdge[];
  /** When the step sits on a single path, the connection that would keep the path joined. */
  reconnect?: { sourceId: string; targetId: string; label?: string };
};

export function deletionImpact(g: WorkflowGraph, nodeId: string): DeletionImpact {
  const node = findNode(g, nodeId);
  if (!node) throw new GraphOpError('That step no longer exists.');
  if (node.type === 'start') throw new GraphOpError("The Start step can't be deleted.");
  const removed = g.edges.filter((e) => e.sourceId === nodeId || e.targetId === nodeId);
  const ins = incoming(g, nodeId).filter((e) => e.type !== 'loop');
  const outs = outgoing(g, nodeId).filter(isFlowEdge);
  let reconnect: DeletionImpact['reconnect'];
  if (node.type !== 'decision' && ins.length === 1 && outs.length === 1) {
    const before = ins[0]!;
    const after = outs[0]!;
    const duplicate = g.edges.some((e) => e.sourceId === before.sourceId && e.targetId === after.targetId);
    if (before.sourceId !== after.targetId && !duplicate) {
      reconnect = { sourceId: before.sourceId, targetId: after.targetId, ...(before.label ? { label: before.label } : {}) };
    }
  }
  return { node, removed, ...(reconnect ? { reconnect } : {}) };
}

/** Delete a step and its connections; optionally keep its path joined (keeping Yes/No meaning). */
export function deleteStep(g: WorkflowGraph, nodeId: string, options: { reconnect: boolean }, idGen: IdGen = randomId): OpResult {
  const impact = deletionImpact(g, nodeId);
  let edges = g.edges.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId);
  if (options.reconnect && impact.reconnect) {
    const before = incoming(g, nodeId).find((e) => e.type !== 'loop')!;
    edges = [...edges, { ...before, id: idGen(), targetId: impact.reconnect.targetId }];
  }
  const nodes = g.nodes.filter((n) => n.id !== nodeId);
  return { graph: { nodes, edges } };
}

/** Steps a step may connect forward to (no cycles; repeats use the guided loop instead). */
export function connectTargets(g: WorkflowGraph, fromId: string): WorkflowNode[] {
  const before = ancestors(g, fromId);
  const already = new Set(outgoing(g, fromId).map((e) => e.targetId));
  return g.nodes.filter((n) => n.id !== fromId && n.type !== 'start' && !before.has(n.id) && !already.has(n.id));
}

/**
 * Suggested places for a path that ends here to rejoin: steps reached by the other paths of the
 * nearest decision above it, nearest first.
 */
export function joinSuggestions(g: WorkflowGraph, fromId: string): WorkflowNode[] {
  const before = ancestors(g, fromId);
  const allowed = new Set(connectTargets(g, fromId).map((n) => n.id));
  const decisions = g.nodes.filter((n) => n.type === 'decision' && before.has(n.id));
  const mine = new Set([fromId, ...before]);
  const suggestions: string[] = [];
  for (const d of decisions) {
    for (const e of outgoing(g, d.id).filter(isFlowEdge)) {
      if (mine.has(e.targetId)) continue;
      // The other path's own first step isn't a natural meeting point unless paths already meet there.
      const first = findNode(g, e.targetId)!;
      const firstIsJoin = first.type === 'finish' || incoming(g, first.id).filter((x) => x.type !== 'loop').length > 1;
      for (const id of [...(firstIsJoin ? [e.targetId] : []), ...descendants(g, e.targetId)]) {
        if (allowed.has(id) && !suggestions.includes(id)) suggestions.push(id);
      }
    }
  }
  // Steps several paths already lead into (existing joins) are the most natural continuation.
  suggestions.sort((a, b) => incoming(g, b).length - incoming(g, a).length);
  return suggestions.slice(0, 3).map((id) => findNode(g, id)!);
}

/** Connect a step (or a decision's open Yes/No path) forward to an existing step. */
export function connectSteps(
  g: WorkflowGraph,
  fromId: string,
  toId: string,
  idGen: IdGen = randomId,
  branch?: 'yes' | 'no',
): OpResult {
  const from = findNode(g, fromId);
  if (!from || !findNode(g, toId)) throw new GraphOpError('That step no longer exists.');
  if (!connectTargets(g, fromId).some((n) => n.id === toId)) {
    throw new GraphOpError("That connection isn't possible. To go back to an earlier step, use Repeat earlier step.");
  }
  if (from.type === 'finish') throw new GraphOpError('Finish ends the workflow.');
  if (from.type === 'decision') {
    const open = openBranches(g, fromId);
    const which = branch ?? open[0];
    if (!which || !open.includes(which)) throw new GraphOpError('Both paths of this decision already continue.');
    return {
      graph: { nodes: g.nodes, edges: [...g.edges, edge(idGen, fromId, toId, which, { label: BRANCH_LABEL[which], branchGroupId: fromId })] },
    };
  }
  return { graph: { nodes: g.nodes, edges: [...g.edges, edge(idGen, fromId, toId)] } };
}

/** Remove one connection. Removing a Yes/No path leaves that path open (it is never relabeled). */
export function removeConnection(g: WorkflowGraph, edgeId: string): OpResult {
  if (!findEdge(g, edgeId)) throw new GraphOpError('That connection no longer exists.');
  return { graph: { nodes: g.nodes, edges: g.edges.filter((e) => e.id !== edgeId) } };
}

export type StepPatch = Partial<Pick<WorkflowNode, 'label' | 'type' | 'owner' | 'duration' | 'tools' | 'notes' | 'assumptionStatus'>>;

/** Types a step can be switched to in its details (decisions and exceptions use their guided flows). */
export function allowedTypeChanges(g: WorkflowGraph, nodeId: string): StepType[] {
  const node = findNode(g, nodeId);
  if (!node || node.type === 'start' || node.type === 'decision' || node.type === 'exception') return node ? [node.type] : [];
  const canFinish = flowOut(g, nodeId).length === 0;
  return (['action', 'approval', 'wait', 'finish'] as StepType[]).filter((t) => t !== 'finish' || canFinish);
}

export function updateStep(g: WorkflowGraph, nodeId: string, patch: StepPatch): OpResult {
  const node = findNode(g, nodeId);
  if (!node) throw new GraphOpError('That step no longer exists.');
  if (patch.type && patch.type !== node.type && !allowedTypeChanges(g, nodeId).includes(patch.type)) {
    throw new GraphOpError("This step's type can't be changed that way.");
  }
  const next: WorkflowNode = { ...node, ...patch };
  for (const key of ['owner', 'notes'] as const) if (next[key] === '') delete next[key];
  if (next.tools && next.tools.length === 0) delete next.tools;
  if (patch.duration === undefined && 'duration' in patch) delete next.duration;
  return { graph: { nodes: g.nodes.map((n) => (n.id === nodeId ? next : n)), edges: g.edges } };
}

export function setPositions(g: WorkflowGraph, positions: Record<string, { x: number; y: number }>): WorkflowGraph {
  return {
    nodes: g.nodes.map((n) => (positions[n.id] ? { ...n, position: { x: Math.round(positions[n.id]!.x), y: Math.round(positions[n.id]!.y) } } : n)),
    edges: g.edges,
  };
}
