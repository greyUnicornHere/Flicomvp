import { beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, makeTestApp, signIn, type TestApp } from '../test/helpers.js';
import { MAX_WORKFLOWS_PER_USER } from './service.js';

type Session = { cookie: string; userId: string };

describe('workflow persistence API', () => {
  let t: TestApp;
  let a: Session;
  let b: Session;

  const call = (s: Session, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { cookie: s.cookie, ...ORIGIN }, payload: payload as object });
  const create = async (s: Session) => (await call(s, 'POST', '/api/workflows', { kind: 'manual' })).json().workflow;
  const rename = (s: Session, id: string, name: string) => call(s, 'PATCH', `/api/workflows/${id}`, { name });
  const list = async (s: Session) => (await call(s, 'GET', '/api/workflows')).json().workflows as { id: string; name: string }[];

  beforeEach(async () => {
    t = await makeTestApp();
    a = await signIn(t, 'a@example.com');
    b = await signIn(t, 'b@example.com');
  });

  it('Build manually creates an "Untitled workflow" with exactly one Start step (D02)', async () => {
    const response = await call(a, 'POST', '/api/workflows', { kind: 'manual' });
    expect(response.statusCode).toBe(201);
    const workflow = response.json().workflow;
    expect(workflow).toMatchObject({ name: 'Untitled workflow', status: 'draft', revision: 1 });
    expect(workflow.graph.edges).toEqual([]);
    expect(workflow.graph.nodes).toHaveLength(1);
    expect(workflow.graph.nodes[0]).toMatchObject({ type: 'start', label: 'Start' });

    // Persisted: a fresh read returns the same graph.
    const reread = (await call(a, 'GET', `/api/workflows/${workflow.id}`)).json().workflow;
    expect(reread.graph).toEqual(workflow.graph);
  });

  it('rejects unsupported creation kinds (AI creation arrives later)', async () => {
    expect((await call(a, 'POST', '/api/workflows', { kind: 'ai', description: 'x' })).statusCode).toBe(400);
  });

  it('lists only my workflows, most recently modified first (D04 sorting)', async () => {
    const first = await create(a);
    t.clock.now += 1000;
    const second = await create(a);
    t.clock.now += 1000;
    await create(b);
    expect((await list(a)).map((w) => w.id)).toEqual([second.id, first.id]);

    // Renaming counts as a modification and moves the workflow to the top.
    t.clock.now += 1000;
    await rename(a, first.id, 'Invoice approval');
    expect((await list(a)).map((w) => w.name)).toEqual(['Invoice approval', 'Untitled workflow']);
  });

  it('renames with trimming and validation (D05)', async () => {
    const { id } = await create(a);
    const ok = await rename(a, id, '  Customer onboarding  ');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().workflow.name).toBe('Customer onboarding');
    expect((await call(a, 'GET', `/api/workflows/${id}`)).json().workflow.name).toBe('Customer onboarding');

    const empty = await rename(a, id, '   ');
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toBe('Please enter a name.');
    expect((await rename(a, id, 'x'.repeat(121))).statusCode).toBe(400);
  });

  it('deletes permanently: gone from list and detail, cannot be deleted twice (D07)', async () => {
    const keep = await create(a);
    const gone = await create(a);
    expect((await call(a, 'DELETE', `/api/workflows/${gone.id}`)).statusCode).toBe(204);
    expect((await list(a)).map((w) => w.id)).toEqual([keep.id]);
    expect((await call(a, 'GET', `/api/workflows/${gone.id}`)).statusCode).toBe(404);
    expect((await call(a, 'DELETE', `/api/workflows/${gone.id}`)).statusCode).toBe(404);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get(gone.id)).toEqual({ n: 0 });
  });

  it("keeps users separate: B cannot read, rename, save or delete A's workflow", async () => {
    const { id } = await create(a);
    expect(await list(b)).toEqual([]);
    expect((await call(b, 'GET', `/api/workflows/${id}`)).statusCode).toBe(404);
    expect((await rename(b, id, 'Hijacked')).statusCode).toBe(404);
    expect((await call(b, 'PUT', `/api/workflows/${id}/graph`, { graph: { nodes: [], edges: [] }, baseRevision: 1 })).statusCode).toBe(404);
    expect((await call(b, 'DELETE', `/api/workflows/${id}`)).statusCode).toBe(404);

    const mine = (await call(a, 'GET', `/api/workflows/${id}`)).json().workflow;
    expect(mine).toMatchObject({ name: 'Untitled workflow', revision: 1 });
  });

  it.each([
    ['GET', '/api/workflows'],
    ['POST', '/api/workflows'],
    ['PATCH', '/api/workflows/x'],
    ['DELETE', '/api/workflows/x'],
    ['PUT', '/api/workflows/x/graph'],
  ])('requires sign-in for %s %s', async (method, url) => {
    const response = await t.app.inject({ method: method as 'GET', url, headers: ORIGIN, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
    expect(response.statusCode).toBe(401);
  });

  it(`limits each person to ${MAX_WORKFLOWS_PER_USER} workflows`, async () => {
    const insert = t.db.prepare("INSERT INTO workflows (id, owner_id, name, created_at, updated_at) VALUES (?, ?, 'x', 1, 1)");
    for (let i = 0; i < MAX_WORKFLOWS_PER_USER; i++) insert.run(`w${i}`, a.userId);
    const response = await call(a, 'POST', '/api/workflows', { kind: 'manual' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('limit_reached');
  });

  describe('autosave storage contract (PUT /:id/graph)', () => {
    const graphWith = (startId: string) => ({
      nodes: [
        { id: startId, type: 'start', label: 'Start', position: { x: 0, y: 0 } },
        { id: 'n2', type: 'action', label: 'Receive order', position: { x: 240, y: 0 }, owner: 'Sales' },
      ],
      edges: [{ id: 'e1', sourceId: startId, targetId: 'n2', type: 'normal' }],
    });

    it('saves against the current revision and bumps it', async () => {
      const wf = await create(a);
      const graph = graphWith(wf.graph.nodes[0].id);
      const saved = await call(a, 'PUT', `/api/workflows/${wf.id}/graph`, { graph, baseRevision: 1 });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().revision).toBe(2);
      const reread = (await call(a, 'GET', `/api/workflows/${wf.id}`)).json().workflow;
      expect(reread.graph).toEqual(graph);
      expect(reread.revision).toBe(2);
    });

    it('rejects a stale save with 409 instead of overwriting newer work', async () => {
      const wf = await create(a);
      const graph = graphWith(wf.graph.nodes[0].id);
      await call(a, 'PUT', `/api/workflows/${wf.id}/graph`, { graph, baseRevision: 1 });
      const stale = await call(a, 'PUT', `/api/workflows/${wf.id}/graph`, { graph: { nodes: [], edges: [] }, baseRevision: 1 });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('conflict');
      expect((await call(a, 'GET', `/api/workflows/${wf.id}`)).json().workflow.graph).toEqual(graph);
    });

    it.each([
      ['a connection to a missing step', { nodes: [{ id: 'a', type: 'start', label: 'Start', position: { x: 0, y: 0 } }], edges: [{ id: 'e', sourceId: 'a', targetId: 'ghost', type: 'normal' }] }],
      ['duplicate step ids', { nodes: [{ id: 'a', type: 'start', label: 'S', position: { x: 0, y: 0 } }, { id: 'a', type: 'action', label: 'A', position: { x: 1, y: 0 } }], edges: [] }],
      ['an unknown step type', { nodes: [{ id: 'a', type: 'trigger', label: 'Run', position: { x: 0, y: 0 } }], edges: [] }],
      ['unexpected fields', { nodes: [], edges: [], script: 'run()' }],
    ])('rejects %s without changing stored data', async (_name, graph) => {
      const wf = await create(a);
      const response = await call(a, 'PUT', `/api/workflows/${wf.id}/graph`, { graph, baseRevision: 1 });
      expect(response.statusCode).toBe(400);
      expect((await call(a, 'GET', `/api/workflows/${wf.id}`)).json().workflow).toMatchObject({ revision: 1, graph: wf.graph });
    });
  });
});
