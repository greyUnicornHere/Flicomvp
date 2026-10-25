import { beforeEach, describe, expect, it } from 'vitest';
import { insertWorkflow, makeTestApp, signIn, type TestApp } from './test/helpers.js';

describe('authorization (A02, A06)', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });

  it.each([
    ['GET', '/api/auth/me'],
    ['GET', '/api/workflows/some-id'],
  ])('denies unauthenticated %s %s with 401', async (method, url) => {
    const response = await t.app.inject({ method: method as 'GET', url });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
  });

  it('denies a forged or garbage session cookie', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'flico_session=forged-session-token-value' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lets the owner read their workflow', async () => {
    const a = await signIn(t, 'a@example.com');
    const id = insertWorkflow(t.db, a.userId, 'Order handling');
    const response = await t.app.inject({ method: 'GET', url: `/api/workflows/${id}`, headers: { cookie: a.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().workflow).toMatchObject({ id, name: 'Order handling' });
  });

  it("denies User B access to User A's workflow without leaking that it exists", async () => {
    const a = await signIn(t, 'a@example.com');
    const b = await signIn(t, 'b@example.com');
    const id = insertWorkflow(t.db, a.userId, 'Confidential process name');

    const asB = await t.app.inject({ method: 'GET', url: `/api/workflows/${id}`, headers: { cookie: b.cookie } });
    const missing = await t.app.inject({ method: 'GET', url: '/api/workflows/does-not-exist', headers: { cookie: b.cookie } });

    expect(asB.statusCode).toBe(404);
    expect(asB.body).not.toContain('Confidential process name');
    expect(asB.json()).toEqual(missing.json());
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
  });
});
