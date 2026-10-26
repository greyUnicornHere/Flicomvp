import type {
  SaveGraphResponse,
  WorkflowDetail,
  WorkflowListResponse,
  WorkflowResponse,
  WorkflowSummary,
} from '../../../shared/api';
import type { WorkflowGraph } from '../../../shared/graph';
import { api } from './api';

export async function fetchWorkflows(): Promise<WorkflowSummary[]> {
  return (await api<WorkflowListResponse>('/api/workflows')).workflows;
}

export async function createManualWorkflow(): Promise<WorkflowDetail> {
  return (await api<WorkflowResponse>('/api/workflows', { method: 'POST', body: { kind: 'manual' } })).workflow;
}

export async function fetchWorkflow(id: string): Promise<WorkflowDetail> {
  return (await api<WorkflowResponse>(`/api/workflows/${encodeURIComponent(id)}`)).workflow;
}

export async function renameWorkflow(id: string, name: string): Promise<WorkflowSummary> {
  const path = `/api/workflows/${encodeURIComponent(id)}`;
  return (await api<{ workflow: WorkflowSummary }>(path, { method: 'PATCH', body: { name } })).workflow;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api(`/api/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Autosave storage contract: full graph + the revision it was based on. A stale revision fails with 409. */
export async function saveWorkflowGraph(id: string, graph: WorkflowGraph, baseRevision: number): Promise<SaveGraphResponse> {
  return api<SaveGraphResponse>(`/api/workflows/${encodeURIComponent(id)}/graph`, {
    method: 'PUT',
    body: { graph, baseRevision },
  });
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Live name search: case-insensitive, whitespace-tolerant substring match. Keeps the existing order. */
export function filterWorkflows<T extends { name: string }>(workflows: T[], query: string): T[] {
  const needle = normalize(query);
  if (!needle) return workflows;
  return workflows.filter((workflow) => normalize(workflow.name).includes(needle));
}

/** Most recently modified first (the API already returns this order; used after local updates). */
export function sortByModified<T extends { updatedAt: string; createdAt: string }>(workflows: T[]): T[] {
  return [...workflows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}

export function formatModified(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export function formatModifiedFull(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
}
