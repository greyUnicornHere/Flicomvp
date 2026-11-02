// The Action plan of an analysis (assessment page revamp, owner approved option A on 2026-11-02):
// one list of what to do next, combining the proposed process changes and the automation
// opportunities. Each item shows where it is in its own journey. Advisory only: applying a process
// change updates the workflow in Flico; nothing is ever automated, connected or run.
import type { Analysis, Recommendation } from '../../../../shared/api';
import { orderRecommendations } from '../../../../shared/analysis';
import { BRIEF_KIND, BRIEF_TITLE, briefOutdated, freshness, topOpportunities, type AutomationBrief, type AutomationClass, type Freshness, type StepAssessment } from '../../../../shared/assessment';
import { blueprintOutdated, type Blueprint } from '../../../../shared/blueprint';
import type { WorkflowGraph } from '../../../../shared/graph';

export type StageState = 'done' | 'current' | 'todo';
export type Stage = { label: string; state: StageState };

export type ProcessItem = { type: 'process'; id: string; rec: Recommendation; stages: Stage[]; done: boolean };
export type AutomationItem = {
  type: 'automation';
  id: string;
  assessment: StepAssessment;
  /** The step's brief, if one was written (it may be out of date). */
  brief?: AutomationBrief;
  briefCurrent: boolean;
  /** The step's agent-ready blueprint, if one was written (it may be out of date). */
  blueprint?: Blueprint;
  blueprintCurrent: boolean;
  /** The step itself changed (or was deleted) since it was assessed: reassess it before anything else. */
  outdated: boolean;
  /** current, upstream (only an earlier step changed: still usable) or changed (same as `outdated`). */
  freshness: Freshness;
  /** One of the top automation opportunities. */
  top: boolean;
  stages: Stage[];
  done: boolean;
};
export type PlanItem = ProcessItem | AutomationItem;

export type ActionPlan = {
  process: ProcessItem[];
  rejected: ProcessItem[];
  automation: AutomationItem[];
  /** Items that count towards progress, and how many of them are done. */
  total: number;
  done: number;
};

/** `reached` is the index of the stage the item stands at; at or beyond the end, every stage is done. */
function track(labels: string[], reached: number): Stage[] {
  return labels.map((label, i) => ({ label, state: i < reached || reached >= labels.length ? 'done' : i === reached ? 'current' : 'todo' }));
}

/** A process change: Suggested, then Accepted, then Applied (all accepted changes are applied together). */
export function processStages(rec: Recommendation, applied: boolean): Stage[] {
  const reached = rec.status === 'accepted' ? (applied ? 3 : 1) : 0;
  return track(['Suggested', 'Accepted', 'Applied'], reached);
}

/**
 * An automation opportunity: Assessed, then Clarified (optional), then its agent-ready blueprint
 * (automation candidates and human-assisted steps). A step that needs more information can't get a
 * blueprint until Clarify settles its classification. A human-led step is already settled; support
 * ideas are optional.
 */
export function automationStages(a: StepAssessment, current: { brief: boolean; blueprint: boolean }): Stage[] {
  if (a.classification === 'human') return track(['Assessed', BRIEF_TITLE.support], current.brief ? 2 : 0);
  if (!BRIEF_KIND[a.classification]) return track(['Assessed', 'Clarified'], a.clarified ? 1 : 0);
  return track(['Assessed', 'Clarified', 'Blueprint'], current.blueprint ? 3 : a.clarified ? 1 : 0);
}

export function buildActionPlan(analysis: Pick<Analysis, 'recommendations' | 'assessments' | 'briefs' | 'blueprints' | 'appliedAt'>, currentGraph: WorkflowGraph): ActionPlan {
  const applied = analysis.appliedAt !== null;
  const toItem = (rec: Recommendation): ProcessItem => {
    const stages = processStages(rec, applied);
    return { type: 'process', id: rec.id, rec, stages, done: stages.every((s) => s.state === 'done') };
  };
  const ordered = orderRecommendations(analysis.recommendations);
  const process = ordered.filter((r) => r.status !== 'rejected').map(toItem);
  const rejected = ordered.filter((r) => r.status === 'rejected').map(toItem);

  const assessments = analysis.assessments ?? [];
  const outdated = (a: StepAssessment) => freshness(currentGraph, a) === 'changed';
  const top = topOpportunities(assessments, outdated);
  // Top opportunities first, then by classification (candidates, assisted, needs info, human-led).
  const order: AutomationClass[] = ['full', 'assisted', 'unknown', 'human'];
  const sorted = [...top, ...order.flatMap((c) => assessments.filter((a) => a.classification === c && !top.includes(a)))];
  const automation = sorted.map((a): AutomationItem => {
    const brief = analysis.briefs.find((b) => b.stepId === a.stepId);
    const fresh = freshness(currentGraph, a);
    const isOutdated = fresh === 'changed';
    const briefCurrent = !!brief && !briefOutdated(brief, a, currentGraph);
    const blueprint = analysis.blueprints.find((b) => b.stepId === a.stepId);
    const blueprintCurrent = !!blueprint && !blueprintOutdated(blueprint, a, currentGraph);
    const stages = automationStages(a, { brief: briefCurrent, blueprint: blueprintCurrent });
    const done = !isOutdated && (a.classification === 'human' || stages.every((s) => s.state === 'done'));
    return { type: 'automation', id: a.stepId, assessment: a, brief, briefCurrent, blueprint, blueprintCurrent, outdated: isOutdated, freshness: fresh, top: top.includes(a), stages, done };
  });

  // Once the changes are applied, the ones that weren't accepted are settled too: they no longer count.
  const counted = [...(applied ? process.filter((p) => p.rec.status === 'accepted') : process), ...automation];
  return { process, rejected, automation, total: counted.length, done: counted.filter((i) => i.done).length };
}
