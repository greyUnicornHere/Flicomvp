import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { openDatabase, type Db } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { DevOutbox } from '../mail/mailer.js';
import { inviteEmail } from '../auth/service.js';
import { newId } from '../auth/tokens.js';

export const APP_URL = 'http://localhost:5173';
export const ORIGIN = { origin: APP_URL };

export type TestApp = {
  app: FastifyInstance;
  db: Db;
  outbox: DevOutbox;
  config: Config;
  clock: { now: number };
};

export async function makeTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({ NODE_ENV: 'test', APP_URL, DATABASE_PATH: ':memory:', ...env });
  const db = openDatabase(':memory:');
  runMigrations(db);
  const outbox = new DevOutbox();
  const clock = { now: Date.UTC(2026, 9, 25, 12, 0, 0) };
  const app = await buildApp({ config, db, mailer: outbox, now: () => clock.now });
  return { app, db, outbox, config, clock };
}

export async function requestLink(t: TestApp, email: string) {
  return t.app.inject({ method: 'POST', url: '/api/auth/request-link', headers: ORIGIN, payload: { email } });
}

/** Latest sign-in token delivered to the outbox for this email. */
export function latestToken(t: TestApp, email: string): string {
  const message = t.outbox.list().find((m) => m.to === email);
  if (!message?.link) throw new Error(`No sign-in email for ${email}`);
  return new URL(message.link).searchParams.get('token')!;
}

export async function verify(t: TestApp, token: string) {
  return t.app.inject({ method: 'POST', url: '/api/auth/verify', headers: ORIGIN, payload: { token } });
}

/** Invite, request a link and verify it. Returns a Cookie header value for the new session. */
export async function signIn(t: TestApp, email: string): Promise<{ cookie: string; userId: string }> {
  inviteEmail(t.db, email);
  await requestLink(t, email);
  const response = await verify(t, latestToken(t, email));
  if (response.statusCode !== 200) throw new Error(`Sign-in failed: ${response.body}`);
  const setCookie = response.cookies.find((c) => c.name === 'flico_session')!;
  return { cookie: `flico_session=${setCookie.value}`, userId: response.json().user.id };
}

export function insertWorkflow(db: Db, ownerId: string, name: string): string {
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO workflows (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    ownerId,
    name,
    now,
    now,
  );
  return id;
}
