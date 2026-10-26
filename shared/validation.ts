// Workflow validation shared by the editor (continuous warnings) and the pre-analysis check.
// Unfinished workflows are allowed while editing; only blockers prevent a meaningful analysis.
import type { WorkflowGraph, WorkflowNode } from './graph.js';

export type IssueSeverity = 'blocker' | 'warning';

export type IssueCode =
  | 'no_start'
  | 'multiple_start'
  | 'dangling_connection'
  | 'nothing_to_analyze'
  | 'unreachable'
  | 'decision_missing_branch'
  | 'decision_unlabeled_path'
  | 'missing_branch_label'
  | 'empty_name'
  | 'loop_no_exit'
  | 'finish_has_next'
  | 'parallel_too_few';

export type Issue = {
  /** Stable per problem, so the UI can keep focus on it across re-validation. */
  id: string;
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

const isFlow = (type: string) => type !== 'loop' && type !== 'exception';

/** Steps that repeat: everything from the loop's target that leads to its source (inclusive). */
function repeatedSection(g: WorkflowGraph, targetId: string, sourceId: string): Set<string> {
  const walk = (start: string, next: (id: string) => string[]) => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      for (const id of next(stack.pop()!)) {
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(id);
      }
    }
    return seen;
  };
  const nonLoop = g.edges.filter((e) => e.type !== 'loop');
  const fromTarget = walk(targetId, (id) => nonLoop.filter((e) => e.sourceId === id).map((e) => e.targetId));
  const toSource = walk(sourceId, (id) => nonLoop.filter((e) => e.targetId === id).map((e) => e.sourceId));
  return new Set([...fromTarget].filter((id) => toSource.has(id)));
}

const quote = (n: WorkflowNode | undefined) => (n?.label.trim() ? `“${n.label.trim()}”` : 'A step');

/** Continuous structural checks while editing. */
export function validateWorkflow(g: WorkflowGraph): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const add = (issue: Omit<Issue, 'id'>) =>
    issues.push({ ...issue, id: `${issue.code}:${issue.nodeId ?? issue.edgeId ?? ''}` });

  const starts = g.nodes.filter((n) => n.type === 'start');
  if (starts.length === 0) add({ code: 'no_start', severity: 'blocker', message: 'The workflow needs a Start step.' });
  if (starts.length > 1) {
    for (const s of starts.slice(1)) add({ code: 'multiple_start', severity: 'blocker', nodeId: s.id, message: 'A workflow can have only one Start step.' });
  }

  for (const e of g.edges) {
    if (!byId.has(e.sourceId) || !byId.has(e.targetId)) {
      add({ code: 'dangling_connection', severity: 'blocker', edgeId: e.id, message: 'A connection points to a step that no longer exists.' });
    }
  }

  // Reachability from Start (repeat connections don't make a step reachable on their own).
  const reachable = new Set<string>();
  const queue = starts.slice(0, 1).map((s) => s.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of g.edges) if (e.sourceId === id && e.type !== 'loop' && byId.has(e.targetId)) queue.push(e.targetId);
  }

  for (const n of g.nodes) {
    const out = g.edges.filter((e) => e.sourceId === n.id);
    if (!n.label.trim()) add({ code: 'empty_name', severity: 'warning', nodeId: n.id, message: 'A step has no name.' });
    if (starts.length && n.type !== 'start' && !reachable.has(n.id)) {
      add({ code: 'unreachable', severity: 'warning', nodeId: n.id, message: `${quote(n)} isn't connected to the rest of the workflow.` });
    }
    if (n.type === 'decision') {
      for (const branch of ['yes', 'no'] as const) {
        if (!out.some((e) => e.type === branch)) {
          add({
            code: 'decision_missing_branch',
            severity: 'warning',
            nodeId: n.id,
            message: `${quote(n)} has no ${branch === 'yes' ? 'Yes' : 'No'} path yet.`,
          });
          issues[issues.length - 1]!.id += `:${branch}`;
        }
      }
      for (const e of out.filter((e) => e.type === 'normal' || e.type === 'parallel')) {
        add({ code: 'decision_unlabeled_path', severity: 'warning', edgeId: e.id, nodeId: n.id, message: `A path from ${quote(n)} isn't labelled Yes or No.` });
      }
    }
    if (n.type === 'finish' && out.some((e) => e.type !== 'loop' && e.type !== 'exception')) {
      add({ code: 'finish_has_next', severity: 'warning', nodeId: n.id, message: `${quote(n)} is a Finish step but continues to another step.` });
    }
  }

  // A repeat needs a way out: some step in the repeated section must lead somewhere outside it.
  for (const loop of g.edges.filter((e) => e.type === 'loop' && byId.has(e.sourceId) && byId.has(e.targetId))) {
    const section = repeatedSection(g, loop.targetId, loop.sourceId);
    const hasExit = g.edges.some((e) => isFlow(e.type) && section.has(e.sourceId) && !section.has(e.targetId));
    if (!hasExit) {
      add({
        code: 'loop_no_exit',
        severity: 'warning',
        nodeId: loop.sourceId,
        edgeId: loop.id,
        message: `The repeat from ${quote(byId.get(loop.sourceId))} back to ${quote(byId.get(loop.targetId))} has no way out once it's done.`,
      });
    }
  }

  for (const e of g.edges) {
    if ((e.type === 'yes' || e.type === 'no') && !e.label?.trim()) {
      add({ code: 'missing_branch_label', severity: 'warning', edgeId: e.id, nodeId: e.sourceId, message: 'A decision path is missing its label.' });
    }
  }

  const groups = new Map<string, number>();
  for (const e of g.edges) if (e.type === 'parallel') groups.set(e.branchGroupId ?? e.sourceId, (groups.get(e.branchGroupId ?? e.sourceId) ?? 0) + 1);
  for (const [group, count] of groups) {
    if (count < 2) {
      const e = g.edges.find((x) => x.type === 'parallel' && (x.branchGroupId ?? x.sourceId) === group)!;
      add({ code: 'parallel_too_few', severity: 'warning', nodeId: e.sourceId, edgeId: e.id, message: 'Parallel activities need at least two activities.' });
    }
  }

  return issues;
}

export type PreAnalysisResult = { canAnalyze: boolean; blockers: Issue[]; warnings: Issue[] };

/** Comprehensive check before analysis. Warnings don't block; blockers prevent a meaningful assessment. */
export function preAnalysisCheck(g: WorkflowGraph): PreAnalysisResult {
  const issues = validateWorkflow(g);
  if (g.nodes.filter((n) => n.type !== 'start').length === 0) {
    issues.push({ id: 'nothing_to_analyze:', code: 'nothing_to_analyze', severity: 'blocker', message: 'Add at least one step after Start.' });
  }
  const blockers = issues.filter((i) => i.severity === 'blocker');
  return { canAnalyze: blockers.length === 0, blockers, warnings: issues.filter((i) => i.severity === 'warning') };
}
