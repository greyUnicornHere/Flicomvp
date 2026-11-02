import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../../../../shared/api';
import { assessmentBasis, basesOf, type AutomationBrief, type StepAssessment } from '../../../../shared/assessment';
import type { Blueprint } from '../../../../shared/blueprint';
import type { WorkflowGraph } from '../../../../shared/graph';
import { automationStages, buildActionPlan, processStages } from './actionPlan';

const graph: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', label: 'Match invoice', position: { x: 200, y: 0 } },
    { id: 'b', type: 'action', label: 'Compare quotes', position: { x: 400, y: 0 } },
    { id: 'c', type: 'approval', label: 'Manager approves', position: { x: 600, y: 0 } },
    { id: 'd', type: 'action', label: 'Send quotation', position: { x: 800, y: 0 } },
    { id: 'f', type: 'finish', label: 'Done', position: { x: 1000, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
    { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' },
    { id: 'e3', sourceId: 'b', targetId: 'c', type: 'normal' },
    { id: 'e4', sourceId: 'c', targetId: 'd', type: 'normal' },
    { id: 'e5', sourceId: 'd', targetId: 'f', type: 'normal' },
  ],
};

const rec = (id: string, status: Recommendation['status'], category: Recommendation['category'] = 'quick_win'): Recommendation => ({
  id,
  title: id,
  problem: '',
  proposal: '',
  reason: '',
  category,
  impact: 'medium',
  effort: 'low',
  evidence: 'supported',
  benefits: '',
  risks: '',
  assumptions: '',
  verification: '',
  dependsOn: [],
  operations: [],
  status,
});

const assess = (stepId: string, classification: StepAssessment['classification'], extra: Partial<StepAssessment> = {}): StepAssessment => ({
  stepId,
  classification,
  provisional: false,
  reasoning: '',
  dimensions: { inputs: '', rules: '', access: '', exceptions: '', verification: '', risk: '' },
  automatable: '',
  human: '',
  evidence: [],
  prerequisites: [],
  questions: [],
  value: '',
  basis: assessmentBasis(graph, stepId)!,
  revision: 1,
  updatedAt: '2026-11-02T10:00:00.000Z',
  ...extra,
});

const brief = (stepId: string, kind: AutomationBrief['kind'], classification: AutomationBrief['classification']): AutomationBrief => ({
  analysisId: 'x',
  stepId,
  kind,
  classification,
  summary: '',
  sections: [],
  basis: assessmentBasis(graph, stepId)!,
  revision: 1,
  createdAt: '2026-11-02T10:00:00.000Z',
});

const blueprint = (stepId: string, classification: Blueprint['classification'], extra: Partial<Blueprint> = {}): Blueprint => ({
  analysisId: 'x',
  stepId,
  classification,
  buildType: 'rules',
  buildReason: '',
  goal: '',
  trigger: '',
  inputs: [],
  tools: [],
  steps: [],
  rules: [],
  checkpoints: [],
  handover: [],
  guardrails: [],
  tests: [],
  openQuestions: [],
  source: 'fixture',
  basis: assessmentBasis(graph, stepId)!,
  revision: 1,
  createdAt: '2026-11-02T10:00:00.000Z',
  ...extra,
});

const states = (stages: { label: string; state: string }[]) => stages.map((s) => `${s.label}:${s.state}`);

describe('action plan stages', () => {
  it('walks a process change from Suggested to Applied', () => {
    expect(states(processStages(rec('r', 'pending'), false))).toEqual(['Suggested:current', 'Accepted:todo', 'Applied:todo']);
    expect(states(processStages(rec('r', 'accepted'), false))).toEqual(['Suggested:done', 'Accepted:current', 'Applied:todo']);
    expect(states(processStages(rec('r', 'accepted'), true))).toEqual(['Suggested:done', 'Accepted:done', 'Applied:done']);
  });

  it('walks an automation candidate from Assessed through Clarified to its brief', () => {
    const none = { brief: false, blueprint: false };
    expect(states(automationStages(assess('a', 'full'), none))).toEqual(['Assessed:current', 'Clarified:todo', 'Blueprint:todo']);
    expect(states(automationStages(assess('a', 'full', { clarified: true }), none))).toEqual(['Assessed:done', 'Clarified:current', 'Blueprint:todo']);
    expect(states(automationStages(assess('a', 'assisted'), { brief: false, blueprint: true }))).toEqual(['Assessed:done', 'Clarified:done', 'Blueprint:done']);
    // An older brief no longer finishes the journey: the blueprint does.
    expect(states(automationStages(assess('a', 'assisted'), { brief: true, blueprint: false }))).toEqual(['Assessed:current', 'Clarified:todo', 'Blueprint:todo']);
  });

  it('offers no brief while more information is needed, and optional support ideas for human-led steps', () => {
    expect(states(automationStages(assess('d', 'unknown'), { brief: false, blueprint: false }))).toEqual(['Assessed:current', 'Clarified:todo']);
    expect(states(automationStages(assess('c', 'human'), { brief: false, blueprint: false }))).toEqual(['Assessed:current', 'Support ideas:todo']);
    expect(states(automationStages(assess('c', 'human'), { brief: true, blueprint: false }))).toEqual(['Assessed:done', 'Support ideas:done']);
  });
});

describe('buildActionPlan', () => {
  const assessments = [assess('c', 'human'), assess('d', 'unknown'), assess('b', 'assisted'), assess('a', 'full')];

  it('lists process changes, then automation with the top opportunities first', () => {
    const plan = buildActionPlan({ recommendations: [rec('r1', 'pending'), rec('r2', 'rejected'), rec('r3', 'accepted')], assessments, briefs: [], blueprints: [], appliedAt: null }, graph);
    expect(plan.process.map((p) => p.id)).toEqual(['r1', 'r3']);
    expect(plan.rejected.map((p) => p.id)).toEqual(['r2']);
    expect(plan.automation.map((a) => [a.id, a.top])).toEqual([
      ['a', true],
      ['b', true],
      ['d', false],
      ['c', false],
    ]);
    // Human-led steps are settled; the rest is still to do. Rejected changes don't count.
    expect([plan.done, plan.total]).toEqual([1, 6]);
  });

  it('counts applied changes and current blueprints as done; settles unaccepted changes once applied', () => {
    const plan = buildActionPlan({ recommendations: [rec('r1', 'pending'), rec('r3', 'accepted')], assessments, briefs: [brief('b', 'assist', 'assisted')], blueprints: [blueprint('a', 'full')], appliedAt: '2026-11-02T11:00:00.000Z' }, graph);
    expect(plan.process.find((p) => p.id === 'r3')!.done).toBe(true);
    expect(plan.automation.find((a) => a.id === 'a')!.done).toBe(true);
    expect([plan.done, plan.total]).toEqual([3, 5]);
  });

  it('does not count an out-of-date brief or a changed step as done', () => {
    const changed: WorkflowGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'a' ? { ...n, label: 'Match invoices daily' } : n)) };
    const plan = buildActionPlan({ recommendations: [], assessments, briefs: [brief('a', 'automation', 'full'), brief('b', 'automation', 'full')], blueprints: [], appliedAt: null }, changed);
    const a = plan.automation.find((i) => i.id === 'a')!;
    expect([a.outdated, a.briefCurrent, a.done, a.top]).toEqual([true, false, false, false]);
    // The brief for "b" was written for another classification, so it is out of date.
    expect(plan.automation.find((i) => i.id === 'b')!.briefCurrent).toBe(false);
  });

  it('a change to an earlier step only keeps the step usable and its brief current', () => {
    const withBases = (x: StepAssessment) => ({ ...x, ...basesOf(graph, x.stepId)! });
    const list = [withBases(assess('a', 'full')), withBases(assess('b', 'assisted'))];
    const written = { ...brief('b', 'assist', 'assisted'), ...basesOf(graph, 'b')! };
    const planned = { ...blueprint('b', 'assisted'), ...basesOf(graph, 'b')! };
    // "a" feeds "b": change a's notes.
    const changed: WorkflowGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'a' ? { ...n, notes: 'Weekly batch.' } : n)) };
    const plan = buildActionPlan({ recommendations: [], assessments: list, briefs: [written], blueprints: [planned], appliedAt: null }, changed);
    const [a, b] = [plan.automation.find((i) => i.id === 'a')!, plan.automation.find((i) => i.id === 'b')!];
    expect([a.freshness, a.outdated]).toEqual(['changed', true]);
    expect([b.freshness, b.outdated, b.briefCurrent, b.blueprintCurrent, b.done]).toEqual(['upstream', false, true, true, true]);
  });

  it('copes with analyses made before automation assessments', () => {
    const plan = buildActionPlan({ recommendations: [rec('r1', 'pending')], assessments: null, briefs: [], blueprints: [], appliedAt: null }, graph);
    expect(plan.automation).toEqual([]);
    expect([plan.done, plan.total]).toEqual([0, 1]);
  });
});
