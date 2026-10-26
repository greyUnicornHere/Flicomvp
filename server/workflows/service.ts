import type { WorkflowDetail, WorkflowStatus, WorkflowSummary } from '../../shared/api.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import type { Db } from '../db/database.js';
import { newId } from '../auth/tokens.js';

/** Maximum workflows one person can keep (documented default, see DECISIONS.md). */
export const MAX_WORKFLOWS_PER_USER = 200;

type Row = {
  id: string;
  name: string;
  status: WorkflowStatus;
  revision: number;
  graph_json: string;
  created_at: number;
  updated_at: number;
};

const toSummary = (row: Omit<Row, 'graph_json' | 'revision'>): WorkflowSummary => ({
  id: row.id,
  name: row.name,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const toDetail = (row: Row): WorkflowDetail => ({
  ...toSummary(row),
  revision: row.revision,
  graph: JSON.parse(row.graph_json) as WorkflowGraph,
});

/** A new manual workflow contains exactly one Start step and nothing else (spec §6). */
export function startOnlyGraph(): WorkflowGraph {
  return { nodes: [{ id: newId(), type: 'start', label: 'Start', position: { x: 0, y: 0 }, origin: 'user' }], edges: [] };
}

// Every query below is scoped by owner_id: other people's workflows behave as if they don't exist.

export function listWorkflows(db: Db, ownerId: string): WorkflowSummary[] {
  const rows = db
    .prepare(
      `SELECT id, name, status, created_at, updated_at FROM workflows
        WHERE owner_id = ? ORDER BY updated_at DESC, created_at DESC, id`,
    )
    .all(ownerId) as Row[];
  return rows.map(toSummary);
}

export function countWorkflows(db: Db, ownerId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM workflows WHERE owner_id = ?').get(ownerId) as { n: number }).n;
}

export function getWorkflow(db: Db, ownerId: string, id: string): WorkflowDetail | null {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ? AND owner_id = ?').get(id, ownerId) as Row | undefined;
  return row ? toDetail(row) : null;
}

export function createWorkflow(db: Db, ownerId: string, name: string, graph: WorkflowGraph, now: number): WorkflowDetail {
  const id = newId();
  db.prepare(
    `INSERT INTO workflows (id, owner_id, name, status, revision, graph_json, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', 1, ?, ?, ?)`,
  ).run(id, ownerId, name, JSON.stringify(graph), now, now);
  return getWorkflow(db, ownerId, id)!;
}

export function renameWorkflow(db: Db, ownerId: string, id: string, name: string, now: number): WorkflowSummary | null {
  const changed = db
    .prepare('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(name, now, id, ownerId).changes;
  if (!changed) return null;
  const { revision: _revision, graph: _graph, ...summary } = getWorkflow(db, ownerId, id)!;
  return summary;
}

/** Permanently delete a workflow. Related records (future analyses, chat) are removed by ON DELETE CASCADE. */
export function deleteWorkflow(db: Db, ownerId: string, id: string): boolean {
  return db.prepare('DELETE FROM workflows WHERE id = ? AND owner_id = ?').run(id, ownerId).changes > 0;
}

export type SaveResult =
  | { ok: true; revision: number; updatedAt: string }
  | { ok: false; reason: 'not_found' | 'conflict'; currentRevision?: number };

/** Autosave with optimistic locking: succeeds only if nobody saved since baseRevision. */
export function saveGraph(
  db: Db,
  ownerId: string,
  id: string,
  graph: WorkflowGraph,
  baseRevision: number,
  now: number,
): SaveResult {
  const changed = db
    .prepare(
      `UPDATE workflows SET graph_json = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND owner_id = ? AND revision = ?`,
    )
    .run(JSON.stringify(graph), now, id, ownerId, baseRevision).changes;
  const current = db.prepare('SELECT revision FROM workflows WHERE id = ? AND owner_id = ?').get(id, ownerId) as
    | { revision: number }
    | undefined;
  if (!current) return { ok: false, reason: 'not_found' };
  if (!changed) return { ok: false, reason: 'conflict', currentRevision: current.revision };
  return { ok: true, revision: current.revision, updatedAt: new Date(now).toISOString() };
}
