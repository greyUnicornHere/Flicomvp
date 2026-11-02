import { describe, expect, it } from 'vitest';
import type { Analysis, WorkflowDetail } from '../../shared/api.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import { ORIGIN, makeTestApp, signIn, type TestApp } from '../test/helpers.js';
import { Scripted, op } from '../test/scripted.js';

// s1 Start → s2 Send quotation → s3 Manager approves → s4 Done
const GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'n-start', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'n-quote', type: 'action', label: 'Send quotation', position: { x: 288, y: 0 } },
    { id: 'n-approve', type: 'approval', label: 'Manager approves', position: { x: 576, y: 0 } },
    { id: 'n-done', type: 'finish', label: 'Done', position: { x: 864, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'n-start', targetId: 'n-quote', type: 'normal' },
    { id: 'e2', sourceId: 'n-quote', targetId: 'n-approve', type: 'normal' },
    { id: 'e3', sourceId: 'n-approve', targetId: 'n-done', type: 'normal' },
  ],
};

const assessment = (step: string, classification: string, extra: Record<string, unknown> = {}) => ({
  step,
  classification,
  provisional: false,
  reasoning: 'Because of the evidence.',
  inputs: 'i',
  rules: 'r',
  access: 'a',
  exceptions: 'x',
  verification: 'v',
  risk: 'k',
  automatable: classification === 'full' || classification === 'assisted' ? 'Prepare the request.' : '',
  human: classification === 'assisted' || classification === 'human' ? 'The decision stays human.' : '',
  evidence: [{ source: 'workflow', text: 'An approval step.' }],
  prerequisites: [],
  questions: classification === 'unknown' ? ['Where does the price come from?'] : [],
  value: '',
  ...extra,
});

const analysis = (automation: unknown[]) =>
  JSON.stringify({
    headline: 'Clearer quotations.',
    summary: 'A short summary.',
    outcome: 'improvements',
    assumptions: [],
    recommendations: [
      {
        key: 'r1',
        title: 'Write down the approval criteria',
        problem: 'p',
        proposal: 'q',
        reason: 'r',
        category: 'strategic',
        impact: 'medium',
        effort: 'low',
        evidence: 'verify',
        benefits: '',
        risks: '',
        assumptions: '',
        verification: '',
        depends_on: [],
        operations: [op({ op: 'update_step', step: 's3', notes: 'Criteria.' })],
      },
    ],
    automation,
  });

const VALID = analysis([assessment('s2', 'unknown'), assessment('s3', 'assisted')]);

async function setup(outputs: ConstructorParameters<typeof Scripted>[0] = [VALID]) {
  const ai = new Scripted(outputs);
  const t = await makeTestApp({}, { ai });
  const alice = await signIn(t, 'alice@example.com');
  const created = (await t.app.inject({ method: 'POST', url: '/api/workflows', headers: { ...ORIGIN, cookie: alice.cookie }, payload: { kind: 'manual' } })).json().workflow;
  await t.app.inject({ method: 'PUT', url: `/api/workflows/${created.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: GRAPH, baseRevision: 1 } });
  const workflow = await current(t, alice.cookie, created.id);
  const started = await t.app.inject({
    method: 'POST',
    url: `/api/workflows/${workflow.id}/analysis-runs`,
    headers: { ...ORIGIN, cookie: alice.cookie },
    payload: { mode: 'quick', baseRevision: workflow.revision, idempotencyKey: `k-${Math.random()}` },
  });
  for (let i = 0; i < 100; i++) {
    const { run } = (await t.app.inject({ method: 'GET', url: `/api/analysis-runs/${started.json().run.id}`, headers: { cookie: alice.cookie } })).json();
    if (run.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return { t, ai, alice, workflow };
}

const current = async (t: TestApp, cookie: string, id: string): Promise<WorkflowDetail> => (await t.app.inject({ method: 'GET', url: `/api/workflows/${id}`, headers: { cookie } })).json().workflow;
const analyses = async (t: TestApp, cookie: string, id: string): Promise<Analysis[]> => (await t.app.inject({ method: 'GET', url: `/api/workflows/${id}/analyses`, headers: { cookie } })).json().analyses;
describe('assessments in an analysis', () => {
  it('binds each assessment to a stable step ID, the analysis and the analysed revision', async () => {
    const { t, alice, workflow } = await setup();
    const [a] = await analyses(t, alice.cookie, workflow.id);
    expect(a!.assessments!.map((x) => [x.stepId, x.classification, x.revision])).toEqual([
      ['n-quote', 'unknown', workflow.revision],
      ['n-approve', 'assisted', workflow.revision],
    ]);
    expect(a!.assessments![0]!.basis).toMatch(/^[0-9a-f]{8}$/);
  });

  it('rejects invalid assessments once, then keeps only the valid ones (the analysis still completes)', async () => {
    const bad = analysis([
      assessment('s1', 'full'), // Start is not work
      assessment('s99', 'assisted'), // no such step
      assessment('s2', 'unknown', { questions: [] }), // unknown needs a question
      assessment('s3', 'assisted', { value: 'Saves 30% and $5,000 a year.' }), // invented figures
    ]);
    const { t, ai, alice, workflow } = await setup([bad, bad]);
    expect(ai.calls).toHaveLength(2);
    const problems = ai.calls[1]!.messages.at(-1)!.content;
    expect(problems).toMatch(/start steps are not work/);
    expect(problems).toMatch(/"s99": that step doesn't exist/);
    expect(problems).toMatch(/lists no question/);
    expect(problems).toMatch(/figures that the workflow doesn't support/);
    const [a] = await analyses(t, alice.cookie, workflow.id);
    expect(a!.assessments).toEqual([]);
    expect(a!.recommendations).toHaveLength(1);
  });

  it('stores concise assessments: one-sentence reasoning, at most two points to verify (questions first), at most three pieces of evidence', async () => {
    const wordy = analysis([
      assessment('s2', 'unknown', {
        reasoning: 'The price source is unknown. It might come from a list. Or from a person.',
        questions: ['Where does the price come from?', 'Who approves discounts?', 'Is there a template?'],
        prerequisites: ['Check the price list is current.'],
        evidence: [1, 2, 3, 4].map((i) => ({ source: 'workflow', text: `Fact ${i}.` })),
      }),
      assessment('s3', 'assisted', { prerequisites: ['Confirm the approver.', 'Confirm the limit.', 'Confirm the backup.'] }),
    ]);
    const { t, alice, workflow } = await setup([wordy]);
    const [a] = await analyses(t, alice.cookie, workflow.id);
    const [quote, approve] = a!.assessments!;
    expect(quote!.reasoning).toBe('The price source is unknown.');
    expect(quote!.questions).toEqual(['Where does the price come from?', 'Who approves discounts?']);
    expect(quote!.prerequisites).toEqual([]);
    expect(quote!.evidence).toHaveLength(3);
    expect(approve!.prerequisites).toEqual(['Confirm the approver.', 'Confirm the limit.']);
  });

  it('older analyses stay readable and say they have no assessments', async () => {
    const { t, alice, workflow } = await setup();
    t.db.prepare('UPDATE analyses SET assessments_json = NULL').run();
    const [a] = await analyses(t, alice.cookie, workflow.id);
    expect(a!.assessments).toBeNull();
  });

  it('comes with the same analysis: one AI call and one credit', async () => {
    const { t, ai, alice } = await setup();
    expect(ai.calls).toHaveLength(1);
    const credits = (await t.app.inject({ method: 'GET', url: '/api/credits', headers: { cookie: alice.cookie } })).json();
    expect(credits.balance).toBe(credits.initial - 1);
  });

  it('keeps assessments private to the workflow owner', async () => {
    const { t, workflow } = await setup();
    const bob = await signIn(t, 'bob@example.com');
    expect((await t.app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}/analyses`, headers: { cookie: bob.cookie } })).statusCode).toBe(404);
  });

});
