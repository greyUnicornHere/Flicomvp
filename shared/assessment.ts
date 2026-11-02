// Automation assessment of work steps (Milestone 4.1). Part of an analysis: each assessment is bound
// to a stable step ID, the analysis that produced it and the workflow revision it was made against.
// Classifications are recommendations only: nothing is automated, connected or tested.
import type { WorkflowGraph, WorkflowNode } from './graph.js';

export const AUTOMATION_CLASSES = ['full', 'assisted', 'human', 'unknown'] as const;
export type AutomationClass = (typeof AUTOMATION_CLASSES)[number];

export const CLASS_LABEL: Record<AutomationClass, string> = {
  full: 'Full automation candidate',
  assisted: 'Human-assisted automation',
  human: 'Keep human-led',
  unknown: 'More information needed',
};
/** Short badge text; the full label is always the accessible name. */
export const CLASS_SHORT: Record<AutomationClass, string> = {
  full: 'Automation candidate',
  assisted: 'Human-assisted',
  human: 'Human-led',
  unknown: 'Needs info',
};

/** Where a piece of evidence comes from: the person, the workflow itself, or an AI assumption. */
export const EVIDENCE_SOURCES = ['user', 'workflow', 'assumption'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export const EVIDENCE_LABEL: Record<EvidenceSource, string> = { user: 'You said', workflow: 'From the workflow', assumption: 'Assumption' };

export const DIMENSIONS = ['inputs', 'rules', 'access', 'exceptions', 'verification', 'risk'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIMENSION_LABEL: Record<Dimension, string> = {
  inputs: 'Inputs',
  rules: 'Rules and judgment',
  access: 'System access',
  exceptions: 'Exceptions',
  verification: 'Verification',
  risk: 'Risk and accountability',
};

export type StepAssessment = {
  stepId: string;
  classification: AutomationClass;
  /** A qualifier, not a fifth class: supported by evidence but with prerequisites still unverified. */
  provisional: boolean;
  reasoning: string;
  dimensions: Record<Dimension, string>;
  /** What could be automated and a proposed approach ('' when nothing is supportable). */
  automatable: string;
  /** What remains human and why ('' when nothing does). */
  human: string;
  evidence: { source: EvidenceSource; text: string }[];
  prerequisites: string[];
  questions: string[];
  /** Business value, only where the person supplied the inputs for it ('' otherwise). Never savings or ROI. */
  value: string;
  /** Fingerprint of the step and what feeds it when assessed; a different fingerprint means "needs reassessment". */
  basis: string;
  revision: number;
  updatedAt: string;
};

/**
 * Steps that are work to assess. Start, Finish, waits and structural joins are not tasks; decisions,
 * approvals, actions and exception handling are.
 */
export function isAssessable(node: WorkflowNode): boolean {
  if (node.type === 'start' || node.type === 'finish' || node.type === 'wait') return false;
  return true;
}

const semantic = (n: WorkflowNode) => ({
  type: n.type,
  label: n.label.trim(),
  owner: n.owner ?? '',
  team: n.team ?? '',
  duration: n.duration ?? null,
  tools: n.tools ?? [],
  notes: n.notes ?? '',
});

/** FNV-1a, so server and browser compute the same short fingerprint. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * What an assessment depends on: the step's details and the steps (and connections) that feed it.
 * Moving steps changes nothing here; renaming, retyping, changing tools/notes/owner or rewiring
 * upstream does.
 */
export function assessmentBasis(graph: WorkflowGraph, stepId: string): string | null {
  const node = graph.nodes.find((n) => n.id === stepId);
  if (!node) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const upstream = graph.edges
    .filter((e) => e.targetId === stepId)
    .map((e) => ({ from: e.sourceId, type: e.type, label: e.label ?? '', step: byId.has(e.sourceId) ? semantic(byId.get(e.sourceId)!) : null }))
    .sort((a, b) => (a.from + a.type).localeCompare(b.from + b.type));
  return hash(JSON.stringify({ step: semantic(node), upstream }));
}

/** True when the step was deleted or changed in a way that matters since it was assessed. */
export function needsReassessment(graph: WorkflowGraph, assessment: Pick<StepAssessment, 'stepId' | 'basis'>): boolean {
  return assessmentBasis(graph, assessment.stepId) !== assessment.basis;
}

/** The step's single most useful next action: its first open question, else its first point to verify. */
export function nextStep(a: Pick<StepAssessment, 'questions' | 'prerequisites'>): string {
  return a.questions[0] ?? a.prerequisites[0] ?? '';
}

/**
 * The best automation opportunities, at most `limit`: automation candidates before human-assisted
 * steps, confirmed before provisional, and steps whose business value the person described first.
 * Assessments that need reassessment are left out.
 */
export function topOpportunities<T extends Pick<StepAssessment, 'classification' | 'provisional' | 'value'>>(assessments: T[], isOutdated: (a: T) => boolean, limit = 3): T[] {
  const rank = (a: T) => (a.classification === 'full' ? 0 : 2) + (a.provisional ? 1 : 0) - (a.value ? 0.5 : 0);
  return assessments
    .filter((a) => (a.classification === 'full' || a.classification === 'assisted') && !isOutdated(a))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .slice(0, limit)
    .map(({ a }) => a);
}

// ---------- clarifying an assessment and planning an automation (Ask Flico interviews) ----------

/** The brief a step can get, by its classification: none until "More information needed" is resolved. */
export type BriefKind = 'automation' | 'assist' | 'support';
export const BRIEF_KIND: Record<AutomationClass, BriefKind | null> = { full: 'automation', assisted: 'assist', human: 'support', unknown: null };
export const BRIEF_TITLE: Record<BriefKind, string> = { automation: 'Automation brief', assist: 'Assist brief', support: 'Support ideas' };
/** Every brief of a kind has exactly these sections, in this order. */
export const BRIEF_SECTIONS: Record<BriefKind, readonly string[]> = {
  automation: ['Goal', 'Trigger and inputs', 'Steps to automate', 'Systems and access needed', 'Exceptions and escalation', 'How to test it', 'Owner', 'Risks', 'Possible approaches', 'Assumptions to confirm'],
  assist: ['Goal', 'What gets automated', 'Where a person checks or decides', 'Handover', 'Systems and access needed', 'How to test it', 'Risks', 'Assumptions to confirm'],
  support: ['Goal', 'Ideas', 'Assumptions to confirm'],
};
/** At most this many questions in one Clarify run and in one brief interview. */
export const CLARIFY_MAX_QUESTIONS = 5;
export const BRIEF_MAX_QUESTIONS = 6;

export type AutomationBrief = {
  analysisId: string;
  stepId: string;
  kind: BriefKind;
  /** The classification the brief was made for; a later change makes the brief out of date. */
  classification: AutomationClass;
  summary: string;
  sections: { heading: string; items: string[] }[];
  /** Fingerprint of the step and what feeds it when written (see `assessmentBasis`). */
  basis: string;
  revision: number;
  createdAt: string;
};

/** A brief no longer matches its step: the step changed, or its classification did. */
export function briefOutdated(brief: Pick<AutomationBrief, 'basis' | 'classification' | 'stepId'>, assessment: Pick<StepAssessment, 'classification'> | undefined, graph: WorkflowGraph): boolean {
  return !assessment || assessment.classification !== brief.classification || assessmentBasis(graph, brief.stepId) !== brief.basis;
}
