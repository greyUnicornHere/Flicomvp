import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { runMigrations } from './db/migrations.js';
import type { Mailer } from './mail/mailer.js';
import { inviteEmail } from './auth/service.js';
import { ORIGIN, makeTestApp } from './test/helpers.js';

describe('health (A01)', () => {
  it('reports status without secrets', async () => {
    const t = await makeTestApp({ SMTP_PASS: 'do-not-leak' });
    const response = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'flico-api', database: 'ok', mail: 'dev-outbox' });
    expect(response.body).not.toContain('do-not-leak');
  });

  it('reports a degraded database with 503', async () => {
    const t = await makeTestApp();
    t.db.close();
    const response = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'error' });
  });
});

describe('development outbox (A07)', () => {
  it('is available in development/test', async () => {
    const t = await makeTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/dev/outbox' })).statusCode).toBe(200);
  });

  it('does not exist in production', async () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      APP_URL: 'https://flico.example',
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.example',
      MAIL_FROM: 'no-reply@example.com',
    });
    const db = openDatabase(':memory:');
    runMigrations(db);
    const sent: string[] = [];
    const mailer: Mailer = { kind: 'smtp', send: async (m) => void sent.push(m.to) };
    const app = await buildApp({ config, db, mailer, clientDir: '/nonexistent' });

    expect((await app.inject({ method: 'GET', url: '/api/dev/outbox' })).statusCode).toBe(404);

    inviteEmail(db, 'a@example.com');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      headers: { origin: 'https://flico.example' },
      payload: { email: 'a@example.com' },
    });
    expect(response.json().devOutbox).toBe(false);
    expect(response.body).not.toContain('token');
    expect(sent).toEqual(['a@example.com']);
  });
});

describe('request hardening', () => {
  it('rejects state-changing requests from another origin', async () => {
    const t = await makeTestApp();
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'a@example.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects non-JSON bodies such as cross-site form posts', async () => {
    const t = await makeTestApp();
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      headers: { 'content-type': 'text/plain', ...ORIGIN },
      payload: '{"email":"a@example.com"}',
    });
    expect(response.statusCode).toBe(415);
  });

  it('rate-limits repeated sign-in requests from one client', async () => {
    const t = await makeTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const response = await t.app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        headers: ORIGIN,
        payload: { email: `p${i}@example.com` },
      });
      codes.push(response.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('uses the configured sign-in rate limit', async () => {
    const t = await makeTestApp({ AUTH_RATE_LIMIT: '2' });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await t.app.inject({ method: 'POST', url: '/api/auth/request-link', headers: ORIGIN, payload: { email: `p${i}@example.com` } });
      codes.push(response.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
  });

  it('sets security headers', async () => {
    const t = await makeTestApp();
    const response = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
