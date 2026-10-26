import { z } from 'zod';
import { EDGE_TYPES, GRAPH_LIMITS, STEP_TYPES, type WorkflowGraph } from '../../shared/graph.js';

const id = z.string().min(1).max(64);
const text = z.string().max(GRAPH_LIMITS.maxText);
const finite = z.number().finite();

const nodeSchema = z.strictObject({
  id,
  type: z.enum(STEP_TYPES),
  label: z.string().max(GRAPH_LIMITS.maxLabel),
  owner: text.optional(),
  team: text.optional(),
  duration: z.strictObject({ value: finite.nonnegative(), unit: z.string().max(40) }).optional(),
  tools: z.array(z.string().max(GRAPH_LIMITS.maxLabel)).max(50).optional(),
  notes: text.optional(),
  position: z.strictObject({ x: finite, y: finite }),
  origin: z.enum(['user', 'ai-inferred']).optional(),
  assumptionStatus: z.enum(['unconfirmed', 'confirmed']).optional(),
  structure: z
    .strictObject({ branchGroupId: id.optional(), joinGroupId: id.optional(), exitCondition: text.optional() })
    .optional(),
});

const edgeSchema = z.strictObject({
  id,
  sourceId: id,
  targetId: id,
  type: z.enum(EDGE_TYPES),
  label: z.string().max(GRAPH_LIMITS.maxLabel).optional(),
  branchGroupId: id.optional(),
});

export const graphSchema = z.strictObject({
  nodes: z.array(nodeSchema).max(GRAPH_LIMITS.maxNodes),
  edges: z.array(edgeSchema).max(GRAPH_LIMITS.maxEdges),
});

export type GraphValidation = { ok: true; graph: WorkflowGraph } | { ok: false; problems: string[] };

/**
 * Structural integrity required before anything is stored: valid shape, unique IDs, and no
 * edge pointing at a missing step. Unfinished workflows (no Finish, disconnected steps) are allowed;
 * those are editor warnings, not storage errors.
 */
export function validateGraph(input: unknown): GraphValidation {
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const { nodes, edges } = parsed.data;
  const problems: string[] = [];
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) problems.push(`Duplicate step id ${node.id}`);
    nodeIds.add(node.id);
  }
  const types = new Map(nodes.map((n) => [n.id, n.type]));
  const branches = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.type === 'yes' || edge.type === 'no') {
      if (types.get(edge.sourceId) !== 'decision') problems.push(`Connection ${edge.id}: only decisions have Yes/No paths`);
      const key = `${edge.sourceId}:${edge.type}`;
      if (branches.has(key)) problems.push(`A decision has more than one ${edge.type === 'yes' ? 'Yes' : 'No'} path`);
      branches.add(key);
    }
    if (edge.sourceId === edge.targetId) problems.push(`Connection ${edge.id} connects a step to itself`);
    if (edgeIds.has(edge.id)) problems.push(`Duplicate connection id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      problems.push(`Connection ${edge.id} points to a step that doesn't exist`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, graph: parsed.data as WorkflowGraph };
}
