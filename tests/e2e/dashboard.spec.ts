import { expect, test, type Page } from '@playwright/test';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/m1';

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Waits (with retries) until the table shows exactly these names, in order. */
const expectNames = (page: Page, names: string[]) =>
  expect(page.getByRole('table').locator('tbody td:first-child a')).toHaveText(names);

/** Create workflows through the real API (as Build manually does) and give them names. */
async function seed(page: Page, names: string[]) {
  for (const name of names) {
    const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
    await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name } });
    await page.waitForTimeout(15); // distinct "last modified" times
  }
}

test('D01/D09: empty dashboard — hero, two equal cards, empty state instead of table', async ({ page }) => {
  await signIn(page, uniqueEmail('empty'));
  await expect(page.getByText('Map your workflows, uncover inefficiencies, and discover better ways to work.')).toBeVisible();
  await expect(page.getByText('Your workflows will appear here once you create one.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  // Two equally sized creation cards.
  const manual = await page.getByRole('button', { name: /Build manually/ }).boundingBox();
  const ai = await page.getByRole('link', { name: /Create with AI/ }).boundingBox();
  expect(Math.abs(manual!.width - ai!.width)).toBeLessThan(1);
  expect(Math.abs(manual!.height - ai!.height)).toBeLessThan(1);

  // No sidebar; content centred within 1200px.
  await expect(page.locator('nav, aside')).toHaveCount(0);
  const main = await page.locator('main').boundingBox();
  expect(main!.width).toBeLessThanOrEqual(1200);
  expect(Math.abs(main!.x - (1536 - main!.x - main!.width))).toBeLessThan(2);
  await page.screenshot({ path: `${SHOTS}/01-dashboard-empty-1536.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/02-dashboard-empty-1280.png` });
});

test('D02/D03: Build manually creates a Start-only "Untitled workflow" that persists', async ({ page }) => {
  await signIn(page, uniqueEmail('manual'));
  await page.getByRole('button', { name: /Build manually/ }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Untitled workflow' })).toBeVisible();
  await expect(page.getByText('The workflow editor is coming next')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-workflow-placeholder-1536.png` });

  const id = page.url().split('/').pop()!;
  const { workflow } = await (await page.request.get(`/api/workflows/${id}`)).json();
  expect(workflow.graph.nodes).toHaveLength(1);
  expect(workflow.graph.nodes[0]).toMatchObject({ type: 'start', label: 'Start' });
  expect(workflow.graph.edges).toEqual([]);

  await page.getByRole('link', { name: 'Back to dashboard' }).first().click();
  await expect(page.getByRole('table')).toBeVisible();
  await expectNames(page, ['Untitled workflow']);
  await expect(page.getByRole('table').getByText('Draft')).toBeVisible();
  await expect(page.getByText('Your workflows will appear here once you create one.')).toHaveCount(0);

  await page.reload();
  await expectNames(page, ['Untitled workflow']);
});

test('D04/D08/D09: populated table, live search, account menu at 1536 and 1280', async ({ page }) => {
  await signIn(page, uniqueEmail('jane'));
  await seed(page, ['Vendor management', 'Customer onboarding', 'Invoice approval']);
  await page.reload();

  await expectNames(page, ['Invoice approval', 'Customer onboarding', 'Vendor management']);
  await expect(page.getByRole('columnheader')).toHaveText(['Name', 'Status', 'Last modified', 'Actions']);
  await page.screenshot({ path: `${SHOTS}/03-dashboard-populated-1536.png` });

  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Feedback, Coming soon', 'Sign Out']);
  await page.screenshot({ path: `${SHOTS}/04-dashboard-account-menu-1536.png` });
  await page.keyboard.press('Escape');

  const search = page.getByRole('searchbox', { name: 'Search workflows' });
  await search.fill('ON');
  await expectNames(page, ['Customer onboarding']);
  await search.fill('payroll');
  await expect(page.getByText('No workflows match “payroll”.')).toBeVisible();
  await search.fill('');

  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/06-dashboard-populated-1280.png` });
});

test('D05: rename from the row menu persists after reload', async ({ page }) => {
  await signIn(page, uniqueEmail('rename'));
  await seed(page, ['Untitled workflow']);
  await page.reload();

  await page.getByRole('button', { name: 'Actions for Untitled workflow' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = page.getByRole('dialog').getByLabel('Workflow name');
  await expect(input).toBeFocused();
  await input.fill('Expense claims');
  await page.screenshot({ path: `${SHOTS}/07-rename-dialog-1536.png` });
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNames(page, ['Expense claims']);

  await page.reload();
  await expectNames(page, ['Expense claims']);
});

test('D06/D07: delete needs confirmation; Cancel keeps it, confirm removes it permanently', async ({ page }) => {
  await signIn(page, uniqueEmail('delete'));
  await seed(page, ['Keep me', 'Delete me']);
  await page.reload();

  await page.getByRole('button', { name: 'Actions for Delete me' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete workflow permanently?' });
  await expect(dialog).toContainText("can't be undone");
  await page.screenshot({ path: `${SHOTS}/08-delete-confirmation-1536.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await expectNames(page, ['Delete me', 'Keep me']);

  const workflows = (await (await page.request.get('/api/workflows')).json()).workflows as { id: string; name: string }[];
  const target = workflows.find((w) => w.name === 'Delete me')!;

  await page.getByRole('button', { name: 'Actions for Delete me' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNames(page, ['Keep me']);

  await page.reload();
  await expectNames(page, ['Keep me']);
  expect((await page.request.get(`/api/workflows/${target.id}`)).status()).toBe(404);
  await expect(page.getByText(/trash|restore/i)).toHaveCount(0);
});

test('keyboard only: open a workflow from the table and use Create with AI screen', async ({ page }) => {
  await signIn(page, uniqueEmail('keys'));
  await seed(page, ['Purchase requests']);
  await page.reload();

  await page.getByRole('link', { name: 'Purchase requests' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Purchase requests' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: /Create with AI/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Create with AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/09-create-with-ai-1536.png` });
});
