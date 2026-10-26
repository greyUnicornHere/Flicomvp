// Workflow domain graph, shared by client and server (IMPLEMENTATION_CONTRACTS.md §2).
// Nodes are descriptive steps, never executable triggers or integrations.

export const STEP_TYPES = ['start', 'action', 'decision', 'approval', 'wait', 'finish', 'exception'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const EDGE_TYPES = ['normal', 'yes', 'no', 'parallel', 'exception', 'loop'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export type WorkflowNode = {
  id: string;
  type: StepType;
  label: string;
  owner?: string;
  team?: string;
  duration?: { value: number; unit: string };
  tools?: string[];
  notes?: string;
  position: { x: number; y: number };
  origin?: 'user' | 'ai-inferred';
  assumptionStatus?: 'unconfirmed' | 'confirmed';
  structure?: { branchGroupId?: string; joinGroupId?: string; exitCondition?: string };
};

export type WorkflowEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  label?: string;
  branchGroupId?: string;
};

export type WorkflowGraph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

/** Size limits for a single workflow (documented defaults, see DECISIONS.md). */
export const GRAPH_LIMITS = { maxNodes: 300, maxEdges: 600, maxLabel: 200, maxText: 2000 } as const;
