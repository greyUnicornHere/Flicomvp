import { describe, expect, it } from 'vitest';
import type { DescribeStepResponse, WorkflowDetail } from '../../shared/api.js';
import { applyOperations } from '../../shared/aiOps.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import { ORIGIN, makeTestApp, signIn, type TestApp } from '../test/helpers.js';
import { Scripted, op } from '../test/scripted.js';
import { FixtureProvider } from './fixture.js';
import type { AiProvider } from './provider.js';

// Start → Log the request → Ask for quotations → Done (refs s1, s2, s3, s4; connections c1, c2, c3)
const GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'n-start', type: 'start', label: 'Request arrives', position: { x: 0, y: 0 } },
    { id: 'n-log', type: 'action', label: 'Log the request', position: { x: 288, y: 0 } },
    { id: 'n-quote', type: 'action', label: 'Ask for quotations', position: { x: 576, y: 0 } },
    { id: 'n-done', type: 'finish', label: 'Done', position: { x: 864, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'n-start', targetId: 'n-log', type: 'normal' },
    { id: 'e2', sourceId: 'n-log', targetId: 'n-quote', type: 'normal' },
    { id: 'e3', sourceId: 'n-quote', targetId: 'n-done', type: 'normal' },
  ],
};

async function setup(ai: AiProvider) {
  const t = await makeTestApp({}, { ai });
  const alice = await signIn(t, 'alice@example.com');
  const created = (await t.app.inject({ method: 'POST', url: '/api/workflows', headers: { ...ORIGIN, cookie: alice.cookie }, payload: { kind: 'manual' } })).json().workflow;
  await t.app.inject({ method: 'PUT', url: `/api/workflows/${created.id}/graph`, headers: { ...ORIGIN, cookie: alice.cookie }, payload: { graph: GRAPH, baseRevision: 1 } });
  const workflow = (await t.app.inject({ method: 'GET', url: `/api/workflows/${created.id}`, headers: { cookie: alice.cookie } })).json().workflow as WorkflowDetail;
  return { t, alice, workflow };
}

const send = (t: TestApp, cookie: string, workflowId: string, stepId: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: `/api/workflows/${workflowId}/steps/${stepId}/describe`, headers: { ...ORIGIN, cookie }, payload });

const scripted = (fields: Record<string, unknown>) =>
  JSON.stringify({ owner: '', tools: [], duration_value: 0, duration_unit: '', notes: '', change_summary: '', operations: [], missing: [], ...fields });

describe('describe a step', () => {
  it('turns the description into the step’s details, proposes the steps it adds, and changes nothing itself', async () => {
    const { t, alice, workflow } = await setup(new FixtureProvider());
    const text = 'Sara in procurement logs each request in the shared sheet, takes about 10 minutes. If the amount is over the limit, the manager has to approve it first.';
    const res = await send(t, alice.cookie, workflow.id, 'n-log', { text, baseRevision: workflow.revision });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DescribeStepResponse;
    expect(body.fields).toMatchObject({ owner: 'Sara (Procurement)', tools: ['Shared sheet'], duration: { value: 10, unit: 'minutes' } });
    expect(body.fields.notes).toMatch(/over the limit/);
    expect(body.source).toBe('fixture');
    expect(body.missing.length).toBeLessThanOrEqual(2);
    // The new decision and approval are a proposal that fits the workflow; the workflow itself is unchanged.
    expect(body.structure!.summary).toMatch(/Over the limit/);
    const applied = applyOperations(workflow.graph, body.structure!.operations);
    expect(applied.ok).toBe(true);
    const now = (await t.app.inject({ method: 'GET', url: `/api/workflows/${workflow.id}`, headers: { cookie: alice.cookie } })).json().workflow as WorkflowDetail;
    expect(now.revision).toBe(workflow.revision);
    expect(now.graph).toEqual(workflow.graph);
  });

  it('a hand-off to someone else becomes a new step after this one (previewed), and its tool stays with that step', async () => {
    const { t, alice, workflow } = await setup(new FixtureProvider());
    const body = (await send(t, alice.cookie, workflow.id, 'n-log', { text: 'Manager directs the supervisor to create a PR in SAP.', baseRevision: workflow.revision })).json() as DescribeStepResponse;
    expect(body.structure!.summary).toBe('Add “Supervisor creates PR in SAP” after this step.');
    const added = body.structure!.operations.find((o) => o.op === 'addStep');
    expect(added).toMatchObject({ type: 'action', label: 'Supervisor creates PR in SAP', notes: 'Owner: Supervisor. Tool: SAP.' });
    // Inserted between this step and the next, so the flow stays connected.
    const applied = applyOperations(workflow.graph, body.structure!.operations);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const id = (added as { id: string }).id;
    expect(applied.graph.edges.filter((e) => e.sourceId === 'n-log').map((e) => e.targetId)).toEqual([id]);
    expect(applied.graph.edges.filter((e) => e.sourceId === id).map((e) => e.targetId)).toEqual(['n-quote']);
    expect(body.fields.tools).toBeUndefined();
    expect(body.fields.notes).toMatch(/directs the supervisor/);
  });

  it('drops a tool from the described step when the model puts it on a new step too', async () => {
    const output = scripted({
      tools: ['SAP', 'Email'],
      notes: 'Directs the supervisor to raise the PR.',
      change_summary: 'Add "Supervisor creates PR in SAP" after this step.',
      operations: [
        op({ op: 'add_step', new_ref: 'n1', type: 'action', label: 'Supervisor creates PR in SAP', notes: 'Owner: Supervisor. Tool: SAP.' }),
        op({ op: 'remove_connection', connection: 'c2' }),
        op({ op: 'add_connection', from: 's2', to: 'n1', connection_type: 'normal' }),
        op({ op: 'add_connection', from: 'n1', to: 's3', connection_type: 'normal' }),
      ],
    });
    const { t, alice, workflow } = await setup(new Scripted([output]));
    const body = (await send(t, alice.cookie, workflow.id, 'n-log', { text: 'Manager emails the supervisor to create a PR in SAP.', baseRevision: workflow.revision })).json() as DescribeStepResponse;
    expect(body.fields.tools).toEqual(['Email']);
    expect(body.structure!.operations).toHaveLength(4);
  });

  it('keeps only what was said: a duration not in the text is dropped; no structure for a plain description', async () => {
    const ai = new Scripted([scripted({ owner: 'Finance', duration_value: 30, duration_unit: 'minutes', notes: 'Checks the totals.' })]);
    const { t, alice, workflow } = await setup(ai);
    const body = (await send(t, alice.cookie, workflow.id, 'n-quote', { text: 'Finance checks the totals.', baseRevision: workflow.revision })).json() as DescribeStepResponse;
    expect(body.fields).toEqual({ owner: 'Finance', notes: 'Checks the totals.' });
    expect(body.structure).toBeNull();
  });

  it('never lets the operations change the selected step itself; retries once, then refuses with nothing changed', async () => {
    const bad = scripted({ operations: [op({ op: 'update_step', step: 's2', label: 'Renamed' })] });
    const ai = new Scripted([bad, bad]);
    const { t, alice, workflow } = await setup(ai);
    const res = await send(t, alice.cookie, workflow.id, 'n-log', { text: 'Rename it.', baseRevision: workflow.revision });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.json().error.message).toMatch(/Nothing was changed/);
  });

  it('checks the revision, the step and the person', async () => {
    const { t, alice, workflow } = await setup(new FixtureProvider());
    expect((await send(t, alice.cookie, workflow.id, 'n-log', { text: 'x', baseRevision: workflow.revision - 1 })).statusCode).toBe(409);
    expect((await send(t, alice.cookie, workflow.id, 'n-missing', { text: 'x', baseRevision: workflow.revision })).statusCode).toBe(404);
    expect((await send(t, alice.cookie, workflow.id, 'n-log', { text: '  ', baseRevision: workflow.revision })).statusCode).toBe(400);
    const bob = await signIn(t, 'bob@example.com');
    expect((await send(t, bob.cookie, workflow.id, 'n-log', { text: 'x', baseRevision: workflow.revision })).statusCode).toBe(404);
  });
});
