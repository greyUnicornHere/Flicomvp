import { describe, expect, it } from 'vitest';
import { applyOperations } from '../../shared/aiOps.js';
import { validateWorkflow } from '../../shared/validation.js';
import { FixtureProvider } from './fixture.js';
import { AiError } from './provider.js';
import { analyzeWorkflow, answerAssistant, generateWorkflow, quickAdd, suggestQuestions } from './service.js';
import { findConflicts, planApply } from '../../shared/analysis.js';
import type { WorkflowGraph } from '../../shared/graph.js';

const fixture = new FixtureProvider();
const DESCRIPTION = 'A supplier emails an invoice. Finance checks the details. If the amount is over 5000, the manager approves it. Finance pays the supplier.';

describe('FixtureProvider (development and tests only)', () => {
  it('produces a valid draft from a description', async () => {
    const draft = await generateWorkflow(fixture, DESCRIPTION, 1000);
    expect(draft.partial).toBe(false);
    expect(draft.graph.nodes.map((n) => n.type)).toEqual(['start', 'action', 'action', 'decision', 'action', 'finish']);
    expect(validateWorkflow(draft.graph).filter((i) => i.severity === 'blocker')).toEqual([]);
    expect(draft.assumptions).toHaveLength(1);
  });

  it('simulates a corrected retry, a partial result and an outage', async () => {
    expect((await generateWorkflow(fixture, `${DESCRIPTION} [fixture:retry]`, 1000)).partial).toBe(false);
    expect((await generateWorkflow(fixture, `${DESCRIPTION} [fixture:partial]`, 1000)).partial).toBe(true);
    await expect(generateWorkflow(fixture, `x [fixture:invalid]`, 1000)).rejects.toThrow(/usable draft/);
    await expect(generateWorkflow(fixture, `x [fixture:error]`, 1000)).rejects.toBeInstanceOf(AiError);
  });

  it('infers Quick Add steps', async () => {
    expect(await quickAdd(fixture, { text: 'manager approves the request', finishAllowed: false }, 1000)).toMatchObject({ type: 'approval', label: 'Manager approves the request' });
    expect(await quickAdd(fixture, { text: 'is the form complete?', finishAllowed: false }, 1000)).toMatchObject({ type: 'decision' });
    expect(await quickAdd(fixture, { text: 'process is done', finishAllowed: true }, 1000)).toMatchObject({ type: 'finish' });
  });

  it('proposes valid edits and fixes', async () => {
    const { graph } = await generateWorkflow(fixture, DESCRIPTION, 1000);
    const approval = await answerAssistant(fixture, { graph, history: [], content: 'Add an approval step', fix: false }, 1000);
    expect(approval.proposal).not.toBeNull();
    expect(applyOperations(graph, approval.proposal!.operations).ok).toBe(true);

    const open = { ...graph, edges: graph.edges.filter((e) => e.type !== 'no') };
    const fix = await answerAssistant(fixture, { graph: open, history: [], content: 'Fix it', fix: true }, 1000);
    const fixed = applyOperations(open, fix.proposal!.operations);
    expect(fixed.ok && validateWorkflow(fixed.graph).some((i) => i.code === 'decision_missing_branch')).toBe(false);

    const history = [
      { role: 'user' as const, content: 'Earlier question' },
      { role: 'assistant' as const, content: 'Earlier answer' },
    ];
    const withHistory = await answerAssistant(fixture, { graph: open, history, content: 'Fix it', fix: true }, 1000);
    expect(withHistory.proposal).not.toBeNull();

    const plain = await answerAssistant(fixture, { graph, history: [], content: 'Summarize this workflow', fix: false }, 1000);
    expect(plain.proposal).toBeNull();
    expect(plain.reply).toMatch(/5 steps after Start/);
  });
});

describe('FixtureProvider analysis (development and tests only)', () => {
  const graph: WorkflowGraph = {
    nodes: [
      { id: 'a', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
      { id: 'b', type: 'action', label: 'Receive order', position: { x: 0, y: 0 } },
      { id: 'c', type: 'action', label: 'Check order', position: { x: 0, y: 0 } },
      { id: 'd', type: 'approval', label: 'Manager approves', position: { x: 0, y: 0 } },
      { id: 'e', type: 'finish', label: 'Shipped', position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: '1', sourceId: 'a', targetId: 'b', type: 'normal' },
      { id: '2', sourceId: 'b', targetId: 'c', type: 'normal' },
      { id: '3', sourceId: 'c', targetId: 'd', type: 'normal' },
      { id: '4', sourceId: 'd', targetId: 'e', type: 'normal' },
    ],
  };
  const withNote = (note: string): WorkflowGraph => ({ ...graph, nodes: graph.nodes.map((n) => (n.id === 'e' ? { ...n, notes: note } : n)) });

  it('produces three compatible, valid recommendations', async () => {
    const result = await analyzeWorkflow(fixture, { graph, answers: [] }, 1000);
    expect(result.recommendations.map((r) => r.category)).toEqual(['quick_win', 'strategic', 'complex']);
    expect(findConflicts(graph, result.recommendations)).toEqual([]);
    expect(planApply(graph, result.recommendations, result.recommendations.map((r) => r.id)).ok).toBe(true);
  });

  it('simulates no improvements, invented figures and a conflict', async () => {
    expect((await analyzeWorkflow(fixture, { graph: withNote('[fixture:none]'), answers: [] }, 1000)).outcome).toBe('no_improvements');
    const roi = await analyzeWorkflow(fixture, { graph: withNote('[fixture:roi]'), answers: [] }, 1000);
    expect(roi.summary).not.toMatch(/30%|\$/);
    const conflict = await analyzeWorkflow(fixture, { graph: withNote('[fixture:conflict]'), answers: [] }, 1000);
    expect(findConflicts(graph, conflict.recommendations)).toHaveLength(1);
  });

  it('asks up to three questions about the workflow', async () => {
    const { questions } = await suggestQuestions(fixture, graph, 1000);
    expect(questions).toHaveLength(3);
    expect(questions[2]!.question).toContain('Manager approves');
  });
});
