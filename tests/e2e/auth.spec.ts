import { expect, test } from '@playwright/test';
import { invite, linkFromOutbox, requestLink, signIn } from './helpers';

// Milestone 0 evidence lives in docs/evidence/m0; re-runs write to the ignored test-results folder.
const SHOTS = 'test-results/screenshots';

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
  await expect(page.getByRole('heading', { name: 'A better way to work.' })).toBeVisible();
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

  const created = await pageA.request.post('/api/workflows', { data: { kind: 'manual' } });
  const { workflow } = await created.json();
  await pageA.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Private payroll process' } });

  expect((await pageA.request.get(`/api/workflows/${workflow.id}`)).status()).toBe(200);
  const asB = await pageB.request.get(`/api/workflows/${workflow.id}`);
  expect(asB.status()).toBe(404);
  expect(await asB.text()).not.toContain('Private payroll process');

  // Entering the URL directly shows "not found" and no private details.
  await pageB.goto(`/workflows/${workflow.id}`);
  await expect(pageB.getByRole('heading', { name: 'Workflow not found' })).toBeVisible();
  await expect(pageB.getByText('Private payroll process')).toHaveCount(0);
  await pageB.goto('/');
  await expect(pageB.getByText('Your workflows will appear here once you create one.')).toBeVisible();

  await contextA.close();
  await contextB.close();
});
