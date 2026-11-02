// Recommendation review rules shared by the analysis screen (live checks) and the server (Apply).
// Each recommendation is a list of operations against the analysed snapshot. Accepted ones are
// combined in order; overlapping or dependent choices are reported, never guessed.
import type { Analysis, Level, Recommendation } from './api.js';
import { applyOperations, diffGraphs, type ProposalOperation } from './aiOps.js';
import type { WorkflowGraph } from './graph.js';

type Rec = Pick<Recommendation, 'id' | 'title' | 'operations' | 'dependsOn'>;

/** The workflow is the same as the analysed one: steps, details and connections; where blocks sit doesn't count. */
export function unchangedSince(snapshot: WorkflowGraph, graph: WorkflowGraph): boolean {
  return Object.values(diffGraphs(snapshot, graph)).every((ids) => ids.length === 0);
}

/**
 * A Quick Analysis would only repeat the current one: the workflow hasn't changed since it, and it
 * already has the automation assessment. Guided Analysis stays possible (new answers add information).
 */
export function quickRepeatBlocked(current: Pick<Analysis, 'snapshot' | 'assessments'> | null, graph: WorkflowGraph): boolean {
  return !!current && current.assessments !== null && unchangedSince(current.snapshot, graph);
}

export const NO_CHANGES_MESSAGE =
  "Nothing has changed since the latest analysis, so a Quick Analysis would repeat it. Change the workflow, or use Guided Analysis to add information.";

export type Touched = { added: Set<string>; modified: Set<string>; removed: Set<string>; referenced: Set<string> };

/** Which existing steps/connections a recommendation adds, changes, removes or connects to. */
export function touched(base: WorkflowGraph, operations: ProposalOperation[]): Touched {
  const t: Touched = { added: new Set(), modified: new Set(), removed: new Set(), referenced: new Set() };
  for (const op of operations) {
    switch (op.op) {
      case 'addStep':
        t.added.add(op.id);
        break;
      case 'addConnection':
        t.added.add(op.id);
        for (const id of [op.sourceId, op.targetId]) if (base.nodes.some((n) => n.id === id)) t.referenced.add(id);
        break;
      case 'updateStep':
        t.modified.add(op.stepId);
        break;
      case 'updateConnection':
        t.modified.add(op.connectionId);
        break;
      case 'removeStep':
        t.removed.add(op.stepId);
        for (const e of base.edges) if (e.sourceId === op.stepId || e.targetId === op.stepId) t.removed.add(e.id);
        break;
      case 'removeConnection':
        t.removed.add(op.connectionId);
        break;
    }
  }
  return t;
}

export type Conflict = { ids: [string, string]; message: string };

/** Pairs of recommendations that change the same steps or connections and can't both be applied. */
export function findConflicts(base: WorkflowGraph, recs: Rec[]): Conflict[] {
  const label = (id: string) => base.nodes.find((n) => n.id === id)?.label;
  const sets = recs.map((r) => touched(base, r.operations));
  const conflicts: Conflict[] = [];
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      const clash = [
        ...[...a.removed].filter((id) => b.removed.has(id) || b.modified.has(id) || b.referenced.has(id)),
        ...[...b.removed].filter((id) => a.modified.has(id) || a.referenced.has(id)),
        ...[...a.modified].filter((id) => b.modified.has(id)),
      ];
      if (!clash.length) continue;
      const named = clash.map(label).find(Boolean);
      conflicts.push({
        ids: [recs[i]!.id, recs[j]!.id],
        message: `“${recs[i]!.title}” and “${recs[j]!.title}” both change ${named ? `“${named}”` : 'the same connection'}. Accept only one of them.`,
      });
    }
  }
  return conflicts;
}

export type ApplyPlan =
  | { ok: true; graph: WorkflowGraph }
  | { ok: false; conflicts: Conflict[]; missing: { id: string; message: string }[]; problems: string[] };

/**
 * Combine the accepted recommendations (in list order) into one graph, all or nothing.
 * Fails when accepted choices overlap, when one depends on a recommendation that isn't accepted,
 * or when the combined result would break the workflow's integrity rules.
 */
export function planApply(base: WorkflowGraph, recs: Rec[], acceptedIds: string[]): ApplyPlan {
  const accepted = recs.filter((r) => acceptedIds.includes(r.id));
  const conflicts = findConflicts(base, accepted);
  const missing = accepted.flatMap((r) =>
    r.dependsOn
      .filter((dep) => !acceptedIds.includes(dep))
      .map((dep) => ({ id: r.id, message: `“${r.title}” needs “${recs.find((x) => x.id === dep)?.title ?? 'another recommendation'}” to be accepted too.` })),
  );
  if (accepted.length === 0) return { ok: false, conflicts, missing, problems: ['Accept at least one recommendation first.'] };
  if (conflicts.length || missing.length) return { ok: false, conflicts, missing, problems: [] };
  const result = applyOperations(base, accepted.flatMap((r) => r.operations));
  if (!result.ok) return { ok: false, conflicts, missing, problems: result.problems };
  return { ok: true, graph: result.graph };
}

/**
 * The review diagram: every recommendation still in play drawn on one graph. A recommendation that
 * clashes with one already drawn is left out of the combined picture (and shown when selected).
 */
export function overlayGraph(base: WorkflowGraph, recs: Rec[]): { graph: WorkflowGraph; included: string[]; skipped: string[] } {
  let graph = base;
  const included: Rec[] = [];
  const skipped: string[] = [];
  for (const rec of recs) {
    const clash = findConflicts(base, [...included, rec]).length > 0;
    const result = clash ? null : applyOperations(graph, rec.operations);
    if (result?.ok) {
      graph = result.graph;
      included.push(rec);
    } else {
      skipped.push(rec.id);
    }
  }
  return { graph, included: included.map((r) => r.id), skipped };
}

const LEVEL: Record<Level, number> = { high: 0, medium: 1, low: 2 };

/** Highest impact first, then least effort; ties keep the model's order. No scores are shown. */
export function orderRecommendations<T extends Pick<Recommendation, 'impact' | 'effort'>>(recs: T[]): T[] {
  return recs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => LEVEL[a.r.impact] - LEVEL[b.r.impact] || LEVEL[b.r.effort] - LEVEL[a.r.effort] || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * Figures that look like savings or ROI and aren't in what the person provided. Flico never invents
 * percentages, money amounts or time savings (spec §11).
 */
export function unsupportedFigures(text: string, source: string): string[] {
  const found = [
    ...text.matchAll(/\d[\d,.]*\s?%|[$€£¥]\s?\d[\d,.]*|\d[\d,.]*\s?(?:dollars|euros|pounds|usd|eur|gbp)\b/gi),
    ...text.matchAll(/\b\d[\d,.]*\s?(?:x|times)\s+(?:faster|quicker|cheaper)\b/gi),
    ...text.matchAll(/\b(?:save|saves|saving|saved|cut|cuts|reduce|reduces|reducing)\s+(?:about\s+|around\s+|up to\s+|roughly\s+)?\d[\d,.]*\s?(?:hours?|hrs?|minutes?|mins?|days?|weeks?)\b/gi),
    ...text.matchAll(/\bROI\b|\breturn on investment\b/gi),
  ].map((m) => m[0].trim());
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const allowed = normalise(source);
  return [...new Set(found)].filter((f) => !allowed.includes(normalise(f)));
}
