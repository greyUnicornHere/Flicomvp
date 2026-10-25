import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';

const SHOTS = 'docs/evidence/m0';
const env = { ...process.env, DATABASE_PATH: E2E.dbPath, APP_URL: E2E.appUrl, NODE_ENV: 'development' };

/** Uses the real invitation script, exactly as an operator would. */
function invite(email: string) {
  return execFileSync('npx', ['tsx', 'server/scripts/invite.ts', email], { env, encoding: 'utf8' });
}

async function requestLink(page: Page, email: string) {
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

/** Opens the newest sign-in link for this email from the dev outbox and returns it. */
async function linkFromOutbox(page: Page, email: string): Promise<string> {
  const response = await page.request.get('/api/dev/outbox');
  const { messages } = (await response.json()) as { messages: { to: string; link: string }[] };
  const message = messages.find((m) => m.to === email);
  expect(message, `sign-in email for ${email}`).toBeTruthy();
  return message!.link;
}

async function signIn(page: Page, email: string) {
  invite(email);
  await requestLink(page, email);
  await page.goto(await linkFromOutbox(page, email));
  await page.getByRole('button', { name: 'Continue to Flico' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Flico' })).toBeVisible();
}

test('A01: health endpoint and status page are reachable without secrets', async ({ page }) => {
  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok', database: 'ok', mail: 'dev-outbox' });

  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByText('Operational')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-status-1536.png` });
});

test('A02: signed-out visitors cannot reach the app or private API', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Flico' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-sign-in-1536.png` });

  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  expect((await page.request.get('/api/workflows/anything')).status()).toBe(401);
});

test('A03–A05: invited sign-in, one-time link, sign out', async ({ page }) => {
  const email = 'user.a@example.com';
  expect(invite(email)).toContain('Invited user.a@example.com');

  await requestLink(page, email);
  await page.screenshot({ path: `${SHOTS}/02-check-email-1536.png` });

  await page.getByRole('link', { name: 'local outbox' }).click();
  await expect(page.getByRole('heading', { name: 'Development outbox' })).toBeVisible();
  await expect(page.getByText(`To: ${email}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-dev-outbox-1536.png` });
  const link = await linkFromOutbox(page, email);

  // A03: the link signs in; the token is removed from the address bar first.
  await page.getByRole('link', { name: 'Open sign-in link' }).first().click();
  await expect(page.getByRole('heading', { name: 'Finish signing in' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await page.getByRole('button', { name: 'Continue to Flico' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Flico' })).toBeVisible();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Flico' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-signed-in-1536.png` });

  await page.getByRole('button', { name: `Account menu for ${email}` }).click();
  await expect(page.getByRole('menu')).toContainText(email);
  await page.screenshot({ path: `${SHOTS}/06-account-menu-1536.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${SHOTS}/07-account-menu-1280.png` });

  // A05: sign out, then the protected page requires sign-in again.
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByText("You've been signed out.")).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);

  // A04: the same link cannot be used again.
  await page.goto(link);
  await page.getByRole('button', { name: 'Continue to Flico' }).click();
  await expect(page.getByRole('alert')).toContainText('already been used');
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.screenshot({ path: `${SHOTS}/08-link-already-used-1536.png` });
});

test('uninvited email gets the same confirmation and no email', async ({ page }) => {
  await requestLink(page, 'stranger@example.com');
  const { messages } = (await (await page.request.get('/api/dev/outbox')).json()) as { messages: { to: string }[] };
  expect(messages.some((m) => m.to === 'stranger@example.com')).toBe(false);
});

test("A06: User B cannot read User A's workflow", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await signIn(pageA, 'owner.a@example.com');
  await signIn(pageB, 'other.b@example.com');

  // Seed one private workflow for User A directly (workflow creation UI arrives in Milestone 1).
  const db = new DatabaseSync(E2E.dbPath);
  const owner = db.prepare('SELECT id FROM users WHERE email = ?').get('owner.a@example.com') as { id: string };
  const workflowId = randomUUID();
  db.prepare('INSERT INTO workflows (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    workflowId,
    owner.id,
    'Private payroll process',
    Date.now(),
    Date.now(),
  );
  db.close();

  const asA = await pageA.request.get(`/api/workflows/${workflowId}`);
  expect(asA.status()).toBe(200);
  const asB = await pageB.request.get(`/api/workflows/${workflowId}`);
  expect(asB.status()).toBe(404);
  expect(await asB.text()).not.toContain('Private payroll process');

  await contextA.close();
  await contextB.close();
});
