import { describe, expect, it } from 'vitest';
import { applyOperations } from '../../shared/aiOps.js';
import { validateWorkflow } from '../../shared/validation.js';
import { FixtureProvider } from './fixture.js';
import { AiError } from './provider.js';
import { answerAssistant, generateWorkflow, quickAdd } from './service.js';

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

    const plain = await answerAssistant(fixture, { graph, history: [], content: 'Summarize this workflow', fix: false }, 1000);
    expect(plain.proposal).toBeNull();
    expect(plain.reply).toMatch(/5 steps after Start/);
  });
});
