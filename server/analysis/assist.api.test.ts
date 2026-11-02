import { describe, expect, it } from 'vitest';
import type { Analysis, ChatMessage, WorkflowDetail } from '../../shared/api.js';
import { BRIEF_SECTIONS } from '../../shared/assessment.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import { FixtureProvider } from '../ai/fixture.js';
import { AiError, AI_ERROR_MESSAGES, type AiProvider, type AiRequest } from '../ai/provider.js';
import { ORIGIN, makeTestApp, signIn, type TestApp } from '../test/helpers.js';

// Start → Match invoice (full, provisional) → Compare quotations (assisted) → Send quotation (needs info) → Done
const GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'n-start', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'n-match', type: 'action', label: 'Match invoice to order', notes: 'Rule: the policy is to match amount and PO number. We have API access to the ERP. Finance can verify every match automatically.', position: { x: 288, y: 0 } },
    { id: 'n-compare', type: 'action', label: 'Compare supplier quotations', notes: 'The engineer does the technical evaluation and selects the supplier.', position: { x: 576, y: 0 } },
    { id: 'n-quote', type: 'action', label: 'Send quotation', position: { x: 864, y: 0 } },
    { id: 'n-done', type: 'finish', label: 'Done', position: { x: 1152, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'n-start', targetId: 'n-match', type: 'normal' },
    { id: 'e2', sourceId: 'n-match', targetId: 'n-compare', type: 'normal' },
    { id: 'e3', sourceId: 'n-compare', targetId: 'n-quote', type: 'normal' },
    { id: 'e4', sourceId: 'n-quote', targetId: 'n-done', type: 'normal' },
  ],
};

/** The fixture, with an optional failure for interview requests. */
class Provider extends FixtureProvider {
  failAssist = false;
  assistCalls = 0;
  override async generate(request: AiRequest) {
    if (request.task === 'assist') {
      this.assistCalls++;
      if (this.failAssist) throw new AiError('unavailable', AI_ERROR_MESSAGES.unavailable);
    }
    return super.generate(request);
  }
}

async function setup() {
  const ai = new Provider();
  const t = await makeTestApp({}, { ai: ai as AiProvider });
  const alice = await signIn(t, 'alice@example.com');
  const created = (await t.app.inject({ method: 'POST', url: '/api/workflows', headers: { ...ORIGIN, cookie: alice.cookie }, payload: { kind: 'manual' } })).json().workflow;
  await t.app.inject({ method: 'PUT', url: `/api/workflows/${created.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: GRAPH, baseRevision: 1 } });
  const workflow = await current(t, alice.cookie, created.id);
  await analyse(t, alice.cookie, workflow, 'quick');
  const [analysis] = await analyses(t, alice.cookie, workflow.id);
  return { t, ai, alice, workflow, analysis: analysis! };
}

async function analyse(t: TestApp, cookie: string, workflow: WorkflowDetail, mode: 'quick' | 'guided') {
  const started = await t.app.inject({
    method: 'POST',
    url: `/api/workflows/${workflow.id}/analysis-runs`,
    headers: { ...ORIGIN, cookie },
    payload: { mode, baseRevision: workflow.revision, idempotencyKey: `k-${Math.random()}`, ...(mode === 'guided' ? { answers: [] } : {}) },
  });
  expect(started.statusCode).toBe(202);
  for (let i = 0; i < 200; i++) {
    const { run } = (await t.app.inject({ method: 'GET', url: `/api/analysis-runs/${started.json().run.id}`, headers: { cookie } })).json();
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 5));
  }
}

const current = async (t: TestApp, cookie: string, id: string): Promise<WorkflowDetail> => (await t.app.inject({ method: 'GET', url: `/api/workflows/${id}`, headers: { cookie } })).json().workflow;
const analyses = async (t: TestApp, cookie: string, id: string): Promise<Analysis[]> => (await t.app.inject({ method: 'GET', url: `/api/workflows/${id}/analyses`, headers: { cookie } })).json().analyses;
const credits = async (t: TestApp, cookie: string) => (await t.app.inject({ method: 'GET', url: '/api/credits', headers: { cookie } })).json().balance as number;
const start = (t: TestApp, cookie: string, analysisId: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: `/api/analyses/${analysisId}/assist`, headers: { ...ORIGIN, cookie }, payload });
const answer = (t: TestApp, cookie: string, analysisId: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: `/api/analyses/${analysisId}/assist/answer`, headers: { ...ORIGIN, cookie }, payload });
const chat = async (t: TestApp, cookie: string, id: string): Promise<ChatMessage[]> => (await t.app.inject({ method: 'GET', url: `/api/workflows/${id}/chat`, headers: { cookie } })).json().messages;

describe('Clarify: one question at a time', () => {
  it('asks one question, keeps it open, updates the assessment from the answer, then asks the next; no credit', async () => {
    const { t, ai, alice, workflow, analysis } = await setup();
    const before = analysis.assessments!.find((a) => a.stepId === 'n-quote')!;
    expect(before.classification).toBe('unknown');
    const first = (await start(t, alice.cookie, analysis.id, { stepId: 'n-quote', mode: 'clarify', baseRevision: workflow.revision })).json();
    expect(first.messages).toHaveLength(1);
    const q = first.messages[0] as ChatMessage;
    expect(q).toMatchObject({ role: 'assistant', assist: { stepId: 'n-quote', mode: 'clarify', kind: 'question', status: 'pending' } });
    expect((q.content.match(/\?/g) ?? []).length).toBe(1);
    // Asking again shows the same open question without another AI call.
    const calls = ai.assistCalls;
    expect((await start(t, alice.cookie, analysis.id, { stepId: 'n-quote', mode: 'clarify', baseRevision: workflow.revision })).json().messages[0].id).toBe(q.id);
    expect(ai.assistCalls).toBe(calls);

    const body = (await answer(t, alice.cookie, analysis.id, { messageId: q.id, baseRevision: workflow.revision, answer: 'From the price list in the ERP; we have API access and the rule is list price minus the agreed discount. Sales checks each one.' })).json();
    const shape = body.messages.map((m: ChatMessage) => [m.role, m.assist?.kind, m.assist?.status]);
    expect(shape.slice(0, 3)).toEqual([
      ['assistant', 'question', 'answered'],
      ['user', 'answer', undefined],
      ['assistant', 'update', undefined],
    ]);
    // Then either the next single question or "done".
    expect([JSON.stringify(['assistant', 'question', 'pending']), JSON.stringify(['assistant', 'done', null])]).toContain(JSON.stringify(shape[3]));
    const after = (body.analysis as Analysis).assessments!.find((a) => a.stepId === 'n-quote')!;
    expect(after.classification).not.toBe('unknown');
    expect(after.evidence.some((e) => e.source === 'user' && /price list/.test(e.text))).toBe(true);
    expect(await credits(t, alice.cookie)).toBe(9); // only the analysis used a credit
  });

  it('Skip for now keeps the uncertainty and is never asked again; a cap ends the run', async () => {
    const { t, alice, workflow, analysis } = await setup();
    let q = (await start(t, alice.cookie, analysis.id, { stepId: 'n-match', mode: 'clarify', baseRevision: workflow.revision })).json().messages[0] as ChatMessage;
    const asked = new Set<string>();
    for (let i = 0; i < 10 && q?.assist?.kind === 'question'; i++) {
      asked.add(q.content);
      const body = (await answer(t, alice.cookie, analysis.id, { messageId: q.id, baseRevision: workflow.revision, skip: true })).json();
      const match = (body.analysis as Analysis).assessments!.find((a) => a.stepId === 'n-match')!;
      expect(match.provisional).toBe(true);
      expect(match.classification).toBe('full');
      q = body.messages.at(-1);
      if (q.assist?.kind === 'question') expect(asked.has(q.content)).toBe(false);
    }
    expect(asked.size).toBeLessThanOrEqual(5);
  });
});

describe('briefs', () => {
  it('interviews, then writes the brief for the step’s class with exactly its sections; saved and readable later', async () => {
    const { t, alice, workflow, analysis } = await setup();
    let q = (await start(t, alice.cookie, analysis.id, { stepId: 'n-compare', mode: 'brief', baseRevision: workflow.revision })).json().messages[0] as ChatMessage;
    expect(q.assist).toMatchObject({ mode: 'brief', kind: 'question' });
    let last: ChatMessage[] = [];
    for (let i = 0; i < 10 && q.assist?.kind === 'question'; i++) {
      const body = (await answer(t, alice.cookie, analysis.id, { messageId: q.id, baseRevision: workflow.revision, ...(i === 1 ? { skip: true } : { answer: `Answer ${i + 1}: the quotes come by email.` }) })).json();
      last = body.messages;
      q = last.at(-1)!;
    }
    expect(q.assist?.kind).toBe('brief');
    const [saved] = await analyses(t, alice.cookie, workflow.id);
    const brief = saved!.briefs.find((b) => b.stepId === 'n-compare')!;
    expect(brief).toMatchObject({ kind: 'assist', classification: 'assisted' });
    expect(brief.sections.map((s) => s.heading)).toEqual([...BRIEF_SECTIONS.assist]);
    expect(brief.sections.every((s) => s.items.length >= 1 && s.items.length <= 4)).toBe(true);
    expect(brief.sections.find((s) => s.heading === 'Assumptions to confirm')!.items.some((i) => /Unanswered/.test(i))).toBe(true);
    expect(await credits(t, alice.cookie)).toBe(9);
  });

  it('a full candidate gets an automation brief; a needs-info step must be clarified first', async () => {
    const { t, alice, workflow, analysis } = await setup();
    const refused = await start(t, alice.cookie, analysis.id, { stepId: 'n-quote', mode: 'brief', baseRevision: workflow.revision });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/Use Clarify/);
    let q = (await start(t, alice.cookie, analysis.id, { stepId: 'n-match', mode: 'brief', baseRevision: workflow.revision })).json().messages[0] as ChatMessage;
    for (let i = 0; i < 10 && q.assist?.kind === 'question'; i++) q = (await answer(t, alice.cookie, analysis.id, { messageId: q.id, baseRevision: workflow.revision, answer: 'Daily, from the ERP.' })).json().messages.at(-1);
    const [saved] = await analyses(t, alice.cookie, workflow.id);
    expect(saved!.briefs.find((b) => b.stepId === 'n-match')!.sections.map((s) => s.heading)).toEqual([...BRIEF_SECTIONS.automation]);
  });
});

describe('safety', () => {
  it('refuses changed steps and older analyses; moving blocks is fine', async () => {
    const { t, alice, workflow, analysis } = await setup();
    const moved = { ...GRAPH, nodes: GRAPH.nodes.map((n) => ({ ...n, position: { x: n.position.x, y: 120 } })) };
    await t.app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: moved, baseRevision: workflow.revision } });
    let now = await current(t, alice.cookie, workflow.id);
    expect((await start(t, alice.cookie, analysis.id, { stepId: 'n-quote', mode: 'clarify', baseRevision: now.revision })).statusCode).toBe(200);
    const changed = { ...moved, nodes: moved.nodes.map((n) => (n.id === 'n-quote' ? { ...n, notes: 'Changed.' } : n)) };
    await t.app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: changed, baseRevision: now.revision } });
    now = await current(t, alice.cookie, workflow.id);
    const stale = await start(t, alice.cookie, analysis.id, { stepId: 'n-quote', mode: 'brief', baseRevision: now.revision });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toMatch(/changed since the analysis/);

    // A newer analysis makes this one view-only.
    await analyse(t, alice.cookie, now, 'guided');
    const old = await start(t, alice.cookie, analysis.id, { stepId: 'n-match', mode: 'clarify', baseRevision: now.revision });
    expect(old.statusCode).toBe(409);
    expect(old.json().error.message).toMatch(/Only the latest analysis/);
  });

  it('keeps the analysis untouched when the AI fails, and keeps everything private', async () => {
    const { t, ai, alice, workflow, analysis } = await setup();
    const q = (await start(t, alice.cookie, analysis.id, { stepId: 'n-quote', mode: 'clarify', baseRevision: workflow.revision })).json().messages[0] as ChatMessage;
    ai.failAssist = true;
    const failed = await answer(t, alice.cookie, analysis.id, { messageId: q.id, baseRevision: workflow.revision, answer: 'From the ERP.' });
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    const [still] = await analyses(t, alice.cookie, workflow.id);
    expect(still!.assessments).toEqual(analysis.assessments);
    expect((await chat(t, alice.cookie, workflow.id)).find((m) => m.id === q.id)!.assist!.status).toBe('pending');

    const bob = await signIn(t, 'bob@example.com');
    expect((await start(t, bob.cookie, analysis.id, { stepId: 'n-quote', mode: 'clarify', baseRevision: workflow.revision })).statusCode).toBe(404);
    expect((await answer(t, bob.cookie, analysis.id, { messageId: q.id, baseRevision: workflow.revision, answer: 'x' })).statusCode).toBe(404);
  });
});
