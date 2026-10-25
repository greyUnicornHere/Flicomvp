import { beforeEach, describe, expect, it } from 'vitest';
import { inviteEmail, revokeInvitation } from './service.js';
import { hashToken } from './tokens.js';
import { ORIGIN, latestToken, makeTestApp, requestLink, signIn, verify, type TestApp } from '../test/helpers.js';

const A = 'user.a@example.com';

describe('invite-only magic-link sign-in', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });

  it('sends a link to an invited email (A03)', async () => {
    inviteEmail(t.db, A);
    const response = await requestLink(t, A);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, devOutbox: true });
    expect(t.outbox.list()).toHaveLength(1);
    expect(t.outbox.list()[0]!.link).toMatch(/^http:\/\/localhost:5173\/auth\/verify\?token=/);
  });

  it('gives an uninvited email the identical response and sends nothing (no open sign-up)', async () => {
    inviteEmail(t.db, A);
    const invited = await requestLink(t, A);
    const uninvited = await requestLink(t, 'stranger@example.com');
    expect(uninvited.statusCode).toBe(200);
    expect(uninvited.json().message.replace('stranger@example.com', A)).toBe(invited.json().message);
    expect(t.outbox.list().map((m) => m.to)).toEqual([A]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('normalises email case and whitespace', async () => {
    inviteEmail(t.db, A);
    await requestLink(t, '  User.A@Example.COM ');
    expect(t.outbox.list()[0]!.to).toBe(A);
  });

  it('rejects malformed email input', async () => {
    const response = await requestLink(t, 'not-an-email');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
  });

  it('signs in with a valid link, sets an httpOnly session cookie, and stores only token hashes', async () => {
    inviteEmail(t.db, A);
    await requestLink(t, A);
    const token = latestToken(t, A);
    const response = await verify(t, token);
    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(A);
    const cookie = response.cookies.find((c) => c.name === 'flico_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');

    const stored = t.db.prepare('SELECT token_hash FROM magic_link_tokens').all() as { token_hash: string }[];
    expect(stored.map((r) => r.token_hash)).toEqual([hashToken(token)]);
    const sessions = t.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(sessions[0]!.token_hash).toBe(hashToken(cookie.value));
  });

  it('cannot reuse a consumed link (A04)', async () => {
    inviteEmail(t.db, A);
    await requestLink(t, A);
    const token = latestToken(t, A);
    expect((await verify(t, token)).statusCode).toBe(200);
    const again = await verify(t, token);
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toEqual({
      code: 'link_used',
      message: 'This sign-in link has already been used. Please request a new one.',
    });
  });

  it('rejects an expired link (A04)', async () => {
    inviteEmail(t.db, A);
    await requestLink(t, A);
    const token = latestToken(t, A);
    t.clock.now += 15 * 60 * 1000 + 1;
    const response = await verify(t, token);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('link_expired');
  });

  it('rejects unknown and malformed tokens', async () => {
    expect((await verify(t, 'x'.repeat(43))).json().error.code).toBe('link_invalid');
    expect((await verify(t, '')).json().error.code).toBe('link_invalid');
  });

  it('rejects a link whose invitation was revoked after it was sent', async () => {
    inviteEmail(t.db, A);
    await requestLink(t, A);
    const token = latestToken(t, A);
    revokeInvitation(t.db, A);
    expect((await verify(t, token)).json().error.code).toBe('link_invalid');
  });

  it('limits sign-in links per email address', async () => {
    inviteEmail(t.db, A);
    for (let i = 0; i < 7; i++) await requestLink(t, A);
    expect(t.outbox.list()).toHaveLength(5);
  });

  it('returns the current user from /me and ends the session on logout (A05)', async () => {
    const { cookie } = await signIn(t, A);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(A);

    const logout = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, ...ORIGIN } });
    expect(logout.statusCode).toBe(204);
    const cleared = logout.cookies.find((c) => c.name === 'flico_session')!;
    expect(cleared.value).toBe('');

    // The old cookie value is no longer accepted even if a browser kept it.
    const after = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('expires sessions after SESSION_TTL_DAYS', async () => {
    const { cookie } = await signIn(t, A);
    t.clock.now += 14 * 24 * 60 * 60 * 1000 + 1;
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('revoking an invitation ends existing sessions', async () => {
    const { cookie } = await signIn(t, A);
    revokeInvitation(t.db, A);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});
