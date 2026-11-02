// Credits ledger, analysis runs and stored analyses. Every query is scoped by owner.
import type {
  AiSource,
  Analysis,
  AnalysisMode,
  AnalysisRun,
  AnalysisRunStage,
  AnalysisRunStatus,
  AnalysisSlot,
  Recommendation,
  ReviewStatus,
} from '../../shared/api.js';
import type { AutomationBrief, BriefKind, StepAssessment } from '../../shared/assessment.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import type { Db } from '../db/database.js';
import { newId } from '../auth/tokens.js';
import type { AnalysisResult } from '../ai/service.js';

// ---------- credits ----------

/** Give a person their starting credits once (idempotent). */
export function ensureInitialGrant(db: Db, userId: string, amount: number, now: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO credit_ledger (id, user_id, delta, reason, idempotency_key, note, created_at)
     VALUES (?, ?, ?, 'initial_grant', ?, 'Pilot starting credits', ?)`,
  ).run(newId(), userId, amount, `initial:${userId}`, now);
}

export function creditBalance(db: Db, userId: string): number {
  return (db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE user_id = ?').get(userId) as { n: number }).n;
}

/** Debit one credit for a completed analysis run. The unique run id makes a second debit impossible. */
export function debitForRun(db: Db, userId: string, runId: string, now: number): void {
  db.prepare(
    `INSERT INTO credit_ledger (id, user_id, delta, reason, analysis_run_id, note, created_at) VALUES (?, ?, -1, 'analysis', ?, NULL, ?)`,
  ).run(newId(), userId, runId, now);
}

export function topUp(db: Db, userId: string, amount: number, note: string, now: number): void {
  db.prepare(`INSERT INTO credit_ledger (id, user_id, delta, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    newId(),
    userId,
    amount,
    amount >= 0 ? 'top_up' : 'adjustment',
    note,
    now,
  );
}

// ---------- runs ----------

type RunRow = {
  id: string;
  workflow_id: string;
  status: AnalysisRunStatus;
  stage: AnalysisRunStage;
  error: string | null;
  analysis_id: string | null;
  idempotency_key: string;
};

const toRun = (row: RunRow): AnalysisRun => ({
  id: row.id,
  workflowId: row.workflow_id,
  status: row.status,
  stage: row.stage,
  error: row.error,
  analysisId: row.analysis_id,
});

export function getRun(db: Db, ownerId: string, id: string): AnalysisRun | null {
  const row = db.prepare('SELECT * FROM analysis_runs WHERE id = ? AND owner_id = ?').get(id, ownerId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function findRunByKey(db: Db, ownerId: string, key: string): AnalysisRun | null {
  const row = db.prepare('SELECT * FROM analysis_runs WHERE owner_id = ? AND idempotency_key = ?').get(ownerId, key) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function runningRun(db: Db, ownerId: string): AnalysisRun | null {
  const row = db.prepare("SELECT * FROM analysis_runs WHERE owner_id = ? AND status = 'running' LIMIT 1").get(ownerId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function startRun(db: Db, ownerId: string, workflowId: string, key: string, mode: AnalysisMode, now: number): AnalysisRun {
  // A failed or cancelled attempt with the same key may be retried: reuse its row.
  db.prepare("DELETE FROM analysis_runs WHERE owner_id = ? AND idempotency_key = ? AND status IN ('failed', 'cancelled')").run(ownerId, key);
  const id = newId();
  db.prepare(
    `INSERT INTO analysis_runs (id, owner_id, workflow_id, idempotency_key, mode, status, stage, created_at)
     VALUES (?, ?, ?, ?, ?, 'running', 'checking', ?)`,
  ).run(id, ownerId, workflowId, key, mode, now);
  return getRun(db, ownerId, id)!;
}

export function setStage(db: Db, id: string, stage: AnalysisRunStage): void {
  db.prepare("UPDATE analysis_runs SET stage = ? WHERE id = ? AND status = 'running'").run(stage, id);
}

/** Finish a run that is still running. Returns false if it was already cancelled or finished. */
export function finishRun(db: Db, id: string, status: Exclude<AnalysisRunStatus, 'running'>, now: number, extra: { error?: string; analysisId?: string } = {}): boolean {
  return (
    db
      .prepare("UPDATE analysis_runs SET status = ?, error = ?, analysis_id = ?, finished_at = ? WHERE id = ? AND status = 'running'")
      .run(status, extra.error ?? null, extra.analysisId ?? null, now, id).changes > 0
  );
}

/** Runs interrupted by a server restart never complete and never charge. */
export function failInterruptedRuns(db: Db, now: number): void {
  db.prepare("UPDATE analysis_runs SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'").run(
    'Flico restarted during the analysis. No credit was used. Please try again.',
    now,
  );
}

// ---------- analyses ----------

type AnalysisRow = {
  id: string;
  workflow_id: string;
  slot: AnalysisSlot;
  mode: AnalysisMode;
  source: AiSource;
  base_revision: number;
  snapshot_json: string;
  result_json: string;
  answers_json: string;
  review_json: string;
  assessments_json: string | null;
  created_at: number;
  applied_at: number | null;
};

type StoredResult = Omit<AnalysisResult, 'usage' | 'dropped' | 'recommendations' | 'assessments'> & { recommendations: Omit<Recommendation, 'status'>[] };

const toAnalysis = (row: AnalysisRow): Analysis => {
  const result = JSON.parse(row.result_json) as StoredResult;
  const review = JSON.parse(row.review_json) as Record<string, ReviewStatus>;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    slot: row.slot,
    mode: row.mode,
    source: row.source,
    baseRevision: row.base_revision,
    snapshot: JSON.parse(row.snapshot_json) as WorkflowGraph,
    headline: result.headline,
    summary: result.summary,
    outcome: result.outcome,
    assumptions: result.assumptions,
    answers: JSON.parse(row.answers_json) as Analysis['answers'],
    recommendations: result.recommendations.map((r) => ({ ...r, status: review[r.id] ?? 'pending' })),
    assessments: row.assessments_json === null ? null : (JSON.parse(row.assessments_json) as StepAssessment[]),
    briefs: [],
    createdAt: new Date(row.created_at).toISOString(),
    appliedAt: row.applied_at === null ? null : new Date(row.applied_at).toISOString(),
  };
};

export function listAnalyses(db: Db, ownerId: string, workflowId: string): Analysis[] {
  const rows = db
    .prepare("SELECT * FROM analyses WHERE workflow_id = ? AND owner_id = ? ORDER BY CASE slot WHEN 'initial' THEN 0 ELSE 1 END")
    .all(workflowId, ownerId) as AnalysisRow[];
  return rows.map((row) => withBriefs(db, toAnalysis(row)));
}

export function getAnalysis(db: Db, ownerId: string, id: string): Analysis | null {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ? AND owner_id = ?').get(id, ownerId) as AnalysisRow | undefined;
  return row ? withBriefs(db, toAnalysis(row)) : null;
}

type BriefRow = {
  analysis_id: string;
  step_id: string;
  kind: BriefKind;
  classification: AutomationBrief['classification'];
  summary: string;
  sections_json: string;
  basis: string;
  revision: number;
  created_at: number;
};

function withBriefs(db: Db, analysis: Analysis): Analysis {
  const rows = db.prepare('SELECT * FROM automation_briefs WHERE analysis_id = ? ORDER BY created_at').all(analysis.id) as BriefRow[];
  return {
    ...analysis,
    briefs: rows.map((r) => ({
      analysisId: r.analysis_id,
      stepId: r.step_id,
      kind: r.kind,
      classification: r.classification,
      summary: r.summary,
      sections: JSON.parse(r.sections_json) as AutomationBrief['sections'],
      basis: r.basis,
      revision: r.revision,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

/** Replace an analysis's assessments (after Clarify). Other analyses and the snapshot are untouched. */
export function saveAssessments(db: Db, ownerId: string, id: string, assessments: StepAssessment[]): void {
  db.prepare('UPDATE analyses SET assessments_json = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(assessments), id, ownerId);
}

/** Save a step's brief, replacing an earlier one for the same step of the same analysis. */
export function saveBrief(db: Db, ownerId: string, brief: Omit<AutomationBrief, 'createdAt'>, now: number): void {
  db.prepare(
    `INSERT INTO automation_briefs (analysis_id, owner_id, step_id, kind, classification, summary, sections_json, basis, revision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (analysis_id, step_id) DO UPDATE SET kind = excluded.kind, classification = excluded.classification, summary = excluded.summary,
       sections_json = excluded.sections_json, basis = excluded.basis, revision = excluded.revision, created_at = excluded.created_at`,
  ).run(brief.analysisId, ownerId, brief.stepId, brief.kind, brief.classification, brief.summary, JSON.stringify(brief.sections), brief.basis, brief.revision, now);
}

/** The analysis Ask Flico and the editor treat as current: the latest, or the only one. */
export function currentAnalysis(db: Db, ownerId: string, workflowId: string): Analysis | null {
  const list = listAnalyses(db, ownerId, workflowId);
  return list.find((a) => a.slot === 'latest') ?? list[0] ?? null;
}

/**
 * Keep the initial and the latest analysis only. The first ever is "initial"; each later one replaces
 * "latest". With a single analysis there is a single record, never a duplicate.
 */
export function saveAnalysis(
  db: Db,
  ownerId: string,
  workflowId: string,
  input: {
    mode: AnalysisMode;
    source: AiSource;
    baseRevision: number;
    snapshot: WorkflowGraph;
    result: StoredResult;
    answers: Analysis['answers'];
    assessments: StepAssessment[];
  },
  now: number,
): string {
  const hasInitial = db.prepare("SELECT 1 FROM analyses WHERE workflow_id = ? AND slot = 'initial'").get(workflowId);
  const slot: AnalysisSlot = hasInitial ? 'latest' : 'initial';
  if (slot === 'latest') db.prepare("DELETE FROM analyses WHERE workflow_id = ? AND slot = 'latest'").run(workflowId);
  const id = newId();
  db.prepare(
    `INSERT INTO analyses (id, workflow_id, owner_id, slot, mode, source, base_revision, snapshot_json, result_json, answers_json, assessments_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workflowId,
    ownerId,
    slot,
    input.mode,
    input.source,
    input.baseRevision,
    JSON.stringify(input.snapshot),
    JSON.stringify(input.result),
    JSON.stringify(input.answers),
    JSON.stringify(input.assessments),
    now,
  );
  db.prepare("UPDATE workflows SET status = 'analyzed' WHERE id = ? AND owner_id = ?").run(workflowId, ownerId);
  return id;
}

export function setReview(db: Db, ownerId: string, analysis: Analysis, statuses: Record<string, ReviewStatus>): void {
  const review = Object.fromEntries(analysis.recommendations.map((r) => [r.id, statuses[r.id] ?? r.status]));
  db.prepare('UPDATE analyses SET review_json = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(review), analysis.id, ownerId);
}

export function markApplied(db: Db, ownerId: string, id: string, now: number): void {
  db.prepare('UPDATE analyses SET applied_at = ? WHERE id = ? AND owner_id = ?').run(now, id, ownerId);
}
