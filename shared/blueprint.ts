// Agent-ready blueprints (assessment page revamp, step 2; owner approved 2026-11-02). For automation
// candidates and human-assisted steps, the end of the automation journey: what to build (plain
// rule-based automation, an AI agent with checkpoints, or an AI assistant), with exact rules, tools
// and access, human checkpoints, hard limits and test cases, plus a readiness check. Advisory only:
// Flico never builds, connects or runs anything; the exports are a starting point for the team's own tools.
import { freshness, type AutomationClass, type StepAssessment } from './assessment.js';
import type { AiSource } from './api.js';
import type { WorkflowGraph } from './graph.js';

export const BUILD_TYPES = ['rules', 'agent', 'assistant'] as const;
export type BuildType = (typeof BUILD_TYPES)[number];
export const BUILD_LABEL: Record<BuildType, string> = {
  rules: 'Rule-based automation',
  agent: 'AI agent with checkpoints',
  assistant: 'AI assistant, a person decides',
};
export const BUILD_HINT: Record<BuildType, string> = {
  rules: 'Fixed rules and structured data: a plain automation (for example in n8n or Power Automate) is cheaper and more predictable than AI.',
  agent: 'Unstructured input or judgement within clear limits: an AI agent does the work and a person approves at set points.',
  assistant: 'The decision stays with a person: AI prepares the information and a draft, the person decides.',
};

/** Steps that get a blueprint; human-led steps keep the shorter "Support ideas". */
export const BLUEPRINT_CLASSES: readonly AutomationClass[] = ['full', 'assisted'];
export const BLUEPRINT_MAX_QUESTIONS = 6;

export type BlueprintTool = { name: string; purpose: string; system: string; access: 'read' | 'write' };
export type BlueprintTest = { name: string; input: string; expected: string };

export type Blueprint = {
  analysisId: string;
  stepId: string;
  /** The classification it was made for; a later change makes it out of date. */
  classification: AutomationClass;
  buildType: BuildType;
  /** Why this build type fits (one sentence). */
  buildReason: string;
  goal: string;
  /** What starts it. */
  trigger: string;
  inputs: string[];
  tools: BlueprintTool[];
  /** What the automation, agent or assistant does, in order. */
  steps: string[];
  /** Exact decision rules. */
  rules: string[];
  /** Where a person checks or approves. */
  checkpoints: string[];
  /** When it must stop and hand over to a person. */
  handover: string[];
  /** What it must never do. */
  guardrails: string[];
  tests: BlueprintTest[];
  /** What is still missing before it can be built. */
  openQuestions: string[];
  /** Who wrote it: the live model or Flico's test fixture (labelled as such everywhere). */
  source: AiSource;
  basis: string;
  stepBasis?: string;
  revision: number;
  createdAt: string;
};

export type ReadinessCheck = { key: string; label: string; ok: boolean; detail: string };

/** Whether the blueprint has what a builder needs. Computed, never claimed by the model. */
export function readiness(bp: Pick<Blueprint, 'buildType' | 'goal' | 'trigger' | 'inputs' | 'tools' | 'steps' | 'rules' | 'checkpoints' | 'handover' | 'guardrails' | 'tests' | 'openQuestions'>): { ready: boolean; checks: ReadinessCheck[] } {
  const filled = (list: string[]) => list.filter((x) => x.trim()).length;
  const checks: ReadinessCheck[] = [
    { key: 'trigger', label: 'Trigger and inputs named', ok: !!bp.trigger.trim() && filled(bp.inputs) > 0, detail: 'Say what starts it and what it reads.' },
    { key: 'tools', label: 'Tools and access listed', ok: bp.tools.length > 0, detail: 'Name each system it uses and whether it reads or writes.' },
    { key: 'rules', label: 'Rules written down', ok: filled(bp.rules) > 0, detail: 'Write the exact rule that decides the result.' },
    {
      key: 'people',
      label: bp.buildType === 'rules' ? 'Exceptions go to a person' : 'Human checkpoints set',
      ok: filled(bp.checkpoints) + filled(bp.handover) > 0,
      detail: 'Say where a person checks, approves or takes over.',
    },
    { key: 'limits', label: 'Hard limits set', ok: filled(bp.guardrails) > 0, detail: 'Say what it must never do.' },
    { key: 'tests', label: 'At least 2 test cases', ok: bp.tests.filter((t) => t.input.trim() && t.expected.trim()).length >= 2, detail: 'Add real examples with the expected result.' },
    { key: 'open', label: 'No open questions', ok: filled(bp.openQuestions) === 0, detail: 'Answer the open questions.' },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}

/** A blueprint no longer matches its step: the step itself changed, or its classification did. */
export function blueprintOutdated(bp: Pick<Blueprint, 'basis' | 'stepBasis' | 'classification' | 'stepId'>, assessment: Pick<StepAssessment, 'classification'> | undefined, graph: WorkflowGraph): boolean {
  return !assessment || assessment.classification !== bp.classification || freshness(graph, bp) === 'changed';
}

/** A safe tool name for exports: lower case, words joined by underscores. */
export function toolName(text: string): string {
  const name = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return /^[a-z]/.test(name) ? name : `tool_${name || 'action'}`;
}
