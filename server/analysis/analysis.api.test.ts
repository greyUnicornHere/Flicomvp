import { describe, expect, it } from 'vitest';
import type { Analysis, AnalysisRun, WorkflowDetail } from '../../shared/api.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import { AiError, AI_ERROR_MESSAGES } from '../ai/provider.js';
import { ORIGIN, makeTestApp, signIn, type TestApp } from '../test/helpers.js';
import { Scripted, op } from '../test/scripted.js';
import { topUp } from './store.js';

// Start → Receive order (s2) → Check order (s3) → Manager approves (s4) → Shipped (s5)
const GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'n-start', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'n-receive', type: 'action', label: 'Receive order', position: { x: 288, y: 0 } },
    { id: 'n-check', type: 'action', label: 'Check order', position: { x: 576, y: 0 } },
    { id: 'n-approve', type: 'approval', label: 'Manager approves', position: { x: 864, y: 0 } },
    { id: 'n-ship', type: 'finish', label: 'Shipped', position: { x: 1152, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'n-start', targetId: 'n-receive', type: 'normal' },
    { id: 'e2', sourceId: 'n-receive', targetId: 'n-check', type: 'normal' },
    { id: 'e3', sourceId: 'n-check', targetId: 'n-approve', type: 'normal' },
    { id: 'e4', sourceId: 'n-approve', targetId: 'n-ship', type: 'normal' },
  ],
};

const rec = (key: string, operations: ReturnType<typeof op>[], extra: Record<string, unknown> = {}) => ({
  key,
  title: `Recommendation ${key}`,
  problem: 'A problem.',
  proposal: 'A proposal.',
  reason: 'A reason.',
  category: 'quick_win',
  impact: 'medium',
  effort: 'low',
  evidence: 'supported',
  benefits: 'Fewer hand-offs.',
  risks: 'Some risk.',
  assumptions: 'An assumption.',
  verification: 'Check with the team.',
  depends_on: [],
  operations,
  ...extra,
});

/** Combine the two checks: remove "Check order" and connect Receive → Approve. */
const combine = rec('r1', [op({ op: 'remove_step', step: 's3' }), op({ op: 'add_connection', from: 's2', to: 's4', connection_type: 'normal' })]);
/** Write down approval criteria. */
const criteria = rec('r2', [op({ op: 'update_step', step: 's4', notes: 'Criteria written down.' })], { category: 'strategic', evidence: 'verify' });
/** Log requests after Start. */
const log = rec(
  'r3',
  [
    op({ op: 'add_step', new_ref: 'n1', type: 'action', label: 'Log the request' }),
    op({ op: 'remove_connection', connection: 'c1' }),
    op({ op: 'add_connection', from: 's1', to: 'n1', connection_type: 'normal' }),
    op({ op: 'add_connection', from: 'n1', to: 's2', connection_type: 'normal' }),
  ],
  { category: 'complex', impact: 'high', effort: 'high', evidence: 'assumption' },
);
/** Renames "Check order": clashes with r1, which removes it. */
const rename = rec('r4', [op({ op: 'update_step', step: 's3', label: 'Check order carefully' })]);

const analysis = (recommendations: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    headline: 'A leaner order process.',
    summary: 'The process is clear but repeats a check. These are proposals, not applied changes.',
    outcome: recommendations.length ? 'improvements' : 'no_improvements',
    assumptions: ['The diagram shows every step.'],
    recommendations,
    ...extra,
  });

async function setup(outputs: ConstructorParameters<typeof Scripted>[0] = [], env: Record<string, string> = {}) {
  const ai = new Scripted(outputs);
  const t = await makeTestApp(env, { ai });
  const alice = await signIn(t, 'alice@example.com');
  const workflow = await createWorkflow(t, alice.cookie);
  return { t, ai, alice, workflow };
}

async function createWorkflow(t: TestApp, cookie: string, graph = GRAPH): Promise<WorkflowDetail> {
  const created = (await t.app.inject({ method: 'POST', url: '/api/workflows', headers: { ...ORIGIN, cookie }, payload: { kind: 'manual' } })).json().workflow;
  const saved = await t.app.inject({ method: 'PUT', url: `/api/workflows/${created.id}/graph`, headers: { ...ORIGIN, cookie }, payload: { graph, baseRevision: 1 } });
  expect(saved.statusCode).toBe(200);
  return (await t.app.inject({ method: 'GET', url: `/api/workflows/${created.id}`, headers: { cookie } })).json().workflow;
}

let keys = 0;
const start = (t: TestApp, cookie: string, workflow: WorkflowDetail, extra: Record<string, unknown> = {}) =>
  t.app.inject({
    method: 'POST',
    url: `/api/workflows/${workflow.id}/analysis-runs`,
    headers: { ...ORIGIN, cookie },
    payload: { mode: 'quick', baseRevision: workflow.revision, idempotencyKey: `key-${++keys}-${Date.now()}`, ...extra },
  });

async function waitForRun(t: TestApp, cookie: string, id: string): Promise<AnalysisRun> {
  for (let i = 0; i < 200; i++) {
    const { run } = (await t.app.inject({ method: 'GET', url: `/api/analysis-runs/${id}`, headers: { cookie } })).json();
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Run did not finish');
}

async function analyze(t: TestApp, cookie: string, workflow: WorkflowDetail, extra: Record<string, unknown> = {}) {
  const response = await start(t, cookie, workflow, extra);
  expect(response.statusCode).toBe(202);
  return waitForRun(t, cookie, response.json().run.id);
}

const credits = async (t: TestApp, cookie: string) => (await t.app.inject({ method: 'GET', url: '/api/credits', headers: { cookie } })).json().balance as number;
const analyses = async (t: TestApp, cookie: string, id: string): Promise<Analysis[]> =>
  (await t.app.inject({ method: 'GET', url: `/api/workflows/${id}/analyses`, headers: { cookie } })).json().analyses;
const ledger = (t: TestApp, userId: string) => t.db.prepare('SELECT delta, reason FROM credit_ledger WHERE user_id = ? ORDER BY rowid').all(userId);

describe('credits', () => {
  it('everyone starts with 10 and a completed analysis uses exactly one', async () => {
    const { t, alice, workflow } = await setup([analysis([combine, criteria, log])]);
    expect(await credits(t, alice.cookie)).toBe(10);
    const run = await analyze(t, alice.cookie, workflow);
    expect(run.status).toBe('succeeded');
    expect(await credits(t, alice.cookie)).toBe(9);
    expect(ledger(t, alice.userId)).toEqual([
      { delta: 10, reason: 'initial_grant' },
      { delta: -1, reason: 'analysis' },
    ]);
  });

  it('a retried request with the same key never runs or charges twice', async () => {
    const { t, ai, alice, workflow } = await setup([analysis([combine])]);
    const payload = { mode: 'quick', baseRevision: workflow.revision, idempotencyKey: 'same-key-123' };
    const first = await t.app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/analysis-runs`, headers: { ...ORIGIN, cookie: alice.cookie }, payload });
    const again = await t.app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/analysis-runs`, headers: { ...ORIGIN, cookie: alice.cookie }, payload });
    expect(again.json().run.id).toBe(first.json().run.id);
    await waitForRun(t, alice.cookie, first.json().run.id);
    const afterSuccess = await t.app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/analysis-runs`, headers: { ...ORIGIN, cookie: alice.cookie }, payload });
    expect(afterSuccess.statusCode).toBe(200);
    expect(afterSuccess.json().run).toMatchObject({ id: first.json().run.id, status: 'succeeded' });
    expect(ai.calls).toHaveLength(1);
    expect(await credits(t, alice.cookie)).toBe(9);
  });

  it('failed and cancelled analyses are free', async () => {
    const { t, ai, alice, workflow } = await setup(['nope', 'still nope', new AiError('timeout', AI_ERROR_MESSAGES.timeout)]);
    const failed = await analyze(t, alice.cookie, workflow);
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringMatching(/No credit was used/) });
    const outage = await analyze(t, alice.cookie, workflow);
    expect(outage.error).toMatch(/took too long.*No credit was used/);

    let aborted = false;
    ai.push(
      (request) =>
        new Promise((_, reject) => {
          request.signal!.addEventListener('abort', () => {
            aborted = true;
            reject(new AiError('cancelled', AI_ERROR_MESSAGES.cancelled));
          });
        }),
    );
    const started = (await start(t, alice.cookie, workflow)).json().run;
    await new Promise((r) => setTimeout(r, 10));
    const cancelled = await t.app.inject({ method: 'POST', url: `/api/analysis-runs/${started.id}/cancel`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: {} });
    expect(cancelled.json().run.status).toBe('cancelled');
    expect(aborted).toBe(true);
    expect((await waitForRun(t, alice.cookie, started.id)).status).toBe('cancelled');
    expect(await credits(t, alice.cookie)).toBe(10);
    expect(await analyses(t, alice.cookie, workflow.id)).toEqual([]);
  });

  it('refuses to start without credits, without calling the model', async () => {
    const { t, ai, alice, workflow } = await setup();
    await t.app.inject({ method: 'GET', url: '/api/credits', headers: { cookie: alice.cookie } }); // initial grant
    topUp(t.db, alice.userId, -10, 'test', Date.now());
    const response = await start(t, alice.cookie, workflow);
    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('no_credits');
    expect(ai.calls).toHaveLength(0);
  });

  it('allows one running analysis per person', async () => {
    const { t, ai, alice, workflow } = await setup();
    ai.push((request) => new Promise((_, reject) => request.signal!.addEventListener('abort', () => reject(new AiError('cancelled', 'x')))));
    const first = (await start(t, alice.cookie, workflow)).json().run;
    expect((await start(t, alice.cookie, workflow)).statusCode).toBe(409);
    await t.app.inject({ method: 'POST', url: `/api/analysis-runs/${first.id}/cancel`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: {} });
  });
});

describe('running an analysis', () => {
  it('stores a reviewable analysis with the original snapshot', async () => {
    const { t, ai, alice, workflow } = await setup([analysis([combine, criteria, log])]);
    await analyze(t, alice.cookie, workflow);
    const [stored] = await analyses(t, alice.cookie, workflow.id);
    expect(stored).toMatchObject({ slot: 'initial', mode: 'quick', source: 'live', baseRevision: workflow.revision, outcome: 'improvements', appliedAt: null });
    expect(stored!.snapshot).toEqual(workflow.graph);
    expect(stored!.recommendations.map((r) => [r.title, r.status, r.category, r.evidence])).toEqual([
      ['Recommendation r1', 'pending', 'quick_win', 'supported'],
      ['Recommendation r2', 'pending', 'strategic', 'verify'],
      ['Recommendation r3', 'pending', 'complex', 'assumption'],
    ]);
    expect(stored!.recommendations[0]!.operations[0]).toEqual({ op: 'removeStep', stepId: 'n-check' });
    const detail = (await t.app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}`, headers: { cookie: alice.cookie } })).json().workflow;
    expect(detail.status).toBe('analyzed');
    expect(ai.calls[0]!.task).toBe('analysis');
    expect(ai.calls[0]!.messages[0]!.content).toContain('"label": "Check order"');
  });

  it('refuses stale revisions and blocked workflows', async () => {
    const { t, alice, workflow } = await setup();
    expect((await start(t, alice.cookie, workflow, { baseRevision: workflow.revision - 1 })).statusCode).toBe(409);
    const empty = await createWorkflow(t, alice.cookie, { nodes: [GRAPH.nodes[0]!], edges: [] });
    const blocked = await start(t, alice.cookie, empty);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.message).toMatch(/Add at least one step after Start/);
  });

  it('retries once on invalid recommendations and keeps only valid ones', async () => {
    const ghost = rec('r9', [op({ op: 'update_step', step: 's99', label: 'X' })]);
    const { t, ai, alice, workflow } = await setup([analysis([combine, ghost]), analysis([combine, ghost])]);
    await analyze(t, alice.cookie, workflow);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]!.messages.at(-1)!.content).toMatch(/Recommendation r9: Step "s99" doesn't exist/);
    const [stored] = await analyses(t, alice.cookie, workflow.id);
    expect(stored!.recommendations.map((r) => r.title)).toEqual(['Recommendation r1']);
  });

  it('fails without charge when every recommendation stays invalid', async () => {
    const ghost = rec('r9', [op({ op: 'remove_step', step: 's1' })]);
    const { t, alice, workflow } = await setup([analysis([ghost]), analysis([ghost])]);
    const run = await analyze(t, alice.cookie, workflow);
    expect(run.status).toBe('failed');
    expect(await credits(t, alice.cookie)).toBe(10);
  });

  it('never stores invented savings or ROI', async () => {
    const roi = analysis([rec('r1', combine.operations, { benefits: 'Saves 30% of the time and $12,000 a year with great ROI.' })], {
      summary: 'Clear process. This will cut 4 hours per order. These are proposals.',
    });
    const { t, ai, alice, workflow } = await setup([roi, roi]);
    await analyze(t, alice.cookie, workflow);
    expect(ai.calls[1]!.messages.at(-1)!.content).toMatch(/figures that the workflow doesn't support/);
    const stored = (await analyses(t, alice.cookie, workflow.id))[0]!;
    const text = JSON.stringify({ s: stored.summary, h: stored.headline, r: stored.recommendations });
    expect(text).not.toMatch(/30%|\$12,000|ROI|4 hours/);
    expect(stored.summary).toBe('Clear process. These are proposals.');
  });

  it('accepts an honest "no improvements" result', async () => {
    const { t, alice, workflow } = await setup([analysis([], { headline: 'Already in good shape.', summary: 'Nothing worth changing.' })]);
    await analyze(t, alice.cookie, workflow);
    const [stored] = await analyses(t, alice.cookie, workflow.id);
    expect(stored).toMatchObject({ outcome: 'no_improvements', recommendations: [] });
    expect(await credits(t, alice.cookie)).toBe(9);
  });

  it('guided analysis: questions are optional and answers reach the model', async () => {
    const { t, ai, alice, workflow } = await setup([JSON.stringify({ questions: [{ question: 'How often?', hint: 'e.g. weekly' }, { question: 'Where does it wait?', hint: '' }] })]);
    const questions = await t.app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/analysis-questions`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { baseRevision: workflow.revision } });
    expect(questions.json()).toEqual({ questions: [{ id: 'q1', question: 'How often?', hint: 'e.g. weekly' }, { id: 'q2', question: 'Where does it wait?', hint: '' }], source: 'live' });
    expect(await credits(t, alice.cookie)).toBe(10);

    ai.push(analysis([combine]), analysis([combine]));
    await analyze(t, alice.cookie, workflow, { mode: 'guided', answers: [{ questionId: 'q1', question: 'How often?', answer: 'About 40 a week' }, { questionId: 'q2', question: 'Where does it wait?', answer: '' }] });
    expect(ai.calls.at(-1)!.messages[0]!.content).toContain('About 40 a week');
    // Unanswered: still a full analysis.
    await analyze(t, alice.cookie, workflow, { mode: 'guided', answers: [] });
    const list = await analyses(t, alice.cookie, workflow.id);
    expect(list.map((a) => [a.slot, a.mode, a.answers.length])).toEqual([
      ['initial', 'guided', 1],
      ['latest', 'guided', 0],
    ]);
  });

  it('keeps only the initial and the latest analysis', async () => {
    const { t, alice, workflow } = await setup([analysis([combine]), analysis([criteria]), analysis([log])]);
    await analyze(t, alice.cookie, workflow);
    expect((await analyses(t, alice.cookie, workflow.id)).map((a) => a.slot)).toEqual(['initial']);
    await analyze(t, alice.cookie, workflow);
    await analyze(t, alice.cookie, workflow);
    const list = await analyses(t, alice.cookie, workflow.id);
    expect(list.map((a) => [a.slot, a.recommendations[0]!.title])).toEqual([
      ['initial', 'Recommendation r1'],
      ['latest', 'Recommendation r3'],
    ]);
    expect(await credits(t, alice.cookie)).toBe(7);
  });

  it('gives Ask Flico the latest analysis', async () => {
    const { t, ai, alice, workflow } = await setup([analysis([combine])]);
    await analyze(t, alice.cookie, workflow);
    ai.push(JSON.stringify({ reply: 'Sure.', change_summary: '', operations: [] }));
    await t.app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/chat`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { content: 'What did the analysis say?', baseRevision: workflow.revision, mode: 'chat' } });
    const prompt = ai.calls.at(-1)!.messages.at(-1)!.content;
    expect(prompt).toContain('"title": "Recommendation r1"');
    expect(prompt).toContain('"status": "pending"');
  });
});

describe('review and apply', () => {
  async function analysed(recs: unknown[]) {
    const ctx = await setup([analysis(recs)]);
    await analyze(ctx.t, ctx.alice.cookie, ctx.workflow);
    const [a] = await analyses(ctx.t, ctx.alice.cookie, ctx.workflow.id);
    const review = (statuses: Record<string, string>, cookie = ctx.alice.cookie) =>
      ctx.t.app.inject({ method: 'PATCH', url: `/api/analyses/${a!.id}/review`, headers: { ...ORIGIN, cookie }, payload: { statuses } });
    const apply = (cookie = ctx.alice.cookie) => ctx.t.app.inject({ method: 'POST', url: `/api/analyses/${a!.id}/apply`, headers: { ...ORIGIN, cookie }, payload: {} });
    const current = async () => (await ctx.t.app.inject({ method: 'GET', url: `/api/workflows/${ctx.workflow.id}`, headers: { cookie: ctx.alice.cookie } })).json().workflow as WorkflowDetail;
    const id = (title: string) => a!.recommendations.find((r) => r.title === title)!.id;
    return { ...ctx, a: a!, review, apply, current, id };
  }

  it('applies accepted recommendations only, atomically, keeping the original snapshot', async () => {
    const { a, review, apply, current, id, workflow } = await analysed([combine, criteria, log]);
    const reviewed = await review({ [id('Recommendation r1')]: 'accepted', [id('Recommendation r2')]: 'rejected', [id('Recommendation r3')]: 'accepted' });
    expect(reviewed.json().analysis.recommendations.map((r: { status: string }) => r.status)).toEqual(['accepted', 'rejected', 'accepted']);
    const response = await apply();
    expect(response.statusCode).toBe(200);
    const after = await current();
    expect(after.revision).toBe(workflow.revision + 1);
    expect(after.graph.nodes.map((n) => n.label)).toEqual(['Start', 'Receive order', 'Manager approves', 'Shipped', 'Log the request']);
    expect(after.graph.nodes.find((n) => n.label === 'Manager approves')!.notes).toBeUndefined(); // rejected one not applied
    const name = (nid: string) => after.graph.nodes.find((n) => n.id === nid)!.label;
    expect(after.graph.edges.map((e) => `${name(e.sourceId)} → ${name(e.targetId)}`).sort()).toEqual(
      ['Start → Log the request', 'Log the request → Receive order', 'Receive order → Manager approves', 'Manager approves → Shipped'].sort(),
    );
    // Existing steps keep their positions; the new one gets a free spot.
    expect(after.graph.nodes.find((n) => n.label === 'Start')!.position).toEqual({ x: 0, y: 0 });
    expect(response.json().analysis.appliedAt).not.toBeNull();
    expect(response.json().analysis.snapshot).toEqual(a.snapshot);
    expect((await apply()).statusCode).toBe(409);
  });

  it('refuses conflicting or incomplete choices and leaves the workflow untouched', async () => {
    const dependent = rec('r5', [op({ op: 'update_step', step: 's2', label: 'Receive and log order' })], { depends_on: ['r3'] });
    const { review, apply, current, id, workflow } = await analysed([combine, rename, log, dependent]);
    await review({ [id('Recommendation r1')]: 'accepted', [id('Recommendation r4')]: 'accepted' });
    const conflict = await apply();
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.message).toMatch(/Nothing was applied.*both change “Check order”. Accept only one/);
    await review({ [id('Recommendation r4')]: 'rejected', [id('Recommendation r5')]: 'accepted' });
    expect((await apply()).json().error.message).toMatch(/needs “Recommendation r3”/);
    await review({ [id('Recommendation r1')]: 'rejected', [id('Recommendation r5')]: 'rejected' });
    expect((await apply()).json().error.message).toMatch(/Accept at least one/);
    expect((await current()).revision).toBe(workflow.revision);
  });

  it('refuses when the workflow changed after the analysis, but not for moved steps', async () => {
    const { t, alice, review, apply, current, id, workflow } = await analysed([criteria]);
    await review({ [id('Recommendation r2')]: 'accepted' });
    const moved = { ...workflow.graph, nodes: workflow.graph.nodes.map((n) => ({ ...n, position: { x: n.position.x, y: 40 } })) };
    await t.app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: moved, baseRevision: workflow.revision } });
    const renamed = { ...moved, nodes: moved.nodes.map((n) => (n.id === 'n-receive' ? { ...n, label: 'Get order' } : n)) };
    await t.app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: renamed, baseRevision: workflow.revision + 1 } });
    const stale = await apply();
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toMatch(/changed after this analysis/);
    expect((await current()).graph).toEqual(renamed);
    // Undo the rename (positions still moved): applies on top of the moved layout.
    await t.app.inject({ method: 'PUT', url: `/api/workflows/${workflow.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: moved, baseRevision: workflow.revision + 2 } });
    expect((await apply()).statusCode).toBe(200);
    expect((await current()).graph.nodes.every((n) => n.position.y === 40)).toBe(true);
  });

  it('keeps everything private to its owner', async () => {
    const { t, a, review, apply, workflow } = await analysed([combine]);
    const bob = await signIn(t, 'bob@example.com');
    expect((await t.app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}/analyses`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
    expect((await review({ x: 'accepted' }, bob.cookie)).statusCode).toBe(404);
    expect((await apply(bob.cookie)).statusCode).toBe(404);
    expect((await start(t, bob.cookie, workflow)).statusCode).toBe(404);
    const run = t.db.prepare('SELECT id FROM analysis_runs').get() as { id: string };
    expect((await t.app.inject({ method: 'GET', url: `/api/analysis-runs/${run.id}`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'POST', url: `/api/analysis-runs/${run.id}/cancel`, headers: { ...ORIGIN, cookie: bob.cookie }, payload: {} })).statusCode).toBe(404);
    expect(await credits(t, bob.cookie)).toBe(10);
    expect(a.recommendations).toHaveLength(1);
  });
});

describe('without AI', () => {
  it('says analysis is unavailable and charges nothing', async () => {
    const t = await makeTestApp({}, { ai: null });
    const alice = await signIn(t, 'alice@example.com');
    const workflow = await createWorkflow(t, alice.cookie);
    const response = await start(t, alice.cookie, workflow);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('ai_not_configured');
    expect(await credits(t, alice.cookie)).toBe(10);
  });
});
