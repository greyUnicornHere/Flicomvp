// Describe a step (owner request, 2026-11-05): double-click a step, describe it in your own words; the
// details card fills in, and new steps the description implies are previewed before anything changes.
// AI output comes from Flico's labelled test fixture (AI_PROVIDER=fixture), never a live model.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowDetail } from '../../shared/api';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/describe';
mkdirSync(SHOTS, { recursive: true });

const graph: WorkflowGraph = {
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

async function open(page: Page) {
  await page.setViewportSize({ width: 1536, height: 960 });
  await signIn(page, uniqueEmail('describe'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Purchasing' } });
  expect((await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph, baseRevision: 1 } })).status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  return workflow.id as string;
}

const step = (page: Page, label: string) => page.locator('[aria-label="Workflow diagram"] .react-flow__node').filter({ hasText: label });
const box = (page: Page) => page.getByTestId('describe-box');
const card = (page: Page) => page.getByRole('dialog', { name: 'Edit step' });
const stored = async (page: Page, id: string): Promise<WorkflowDetail> => (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow;
const node = (w: WorkflowDetail, label: string) => w.graph.nodes.find((n) => n.label === label);

const FULL = 'Sara in procurement logs each request in the shared sheet, takes about 10 minutes. If the amount is over the limit, the manager has to approve it first.';

test('double-click, describe: the card fills in, new steps are previewed, then applied; one-click Undo', async ({ page }) => {
  const id = await open(page);
  await step(page, 'Log the request').dblclick();
  await expect(box(page)).toBeVisible();
  const text = box(page).getByLabel('Describe this step in your own words');
  await expect(text).toBeFocused();
  await expect(box(page).getByRole('button', { name: /Update step/ })).toBeDisabled();
  await text.fill(FULL);
  await page.screenshot({ path: `${SHOTS}/01-describe-box-1536-test-fixture.png` });
  await box(page).getByRole('button', { name: /Update step/ }).click();

  // The new decision and approval are only previewed: nothing about the shape changes until Apply.
  const bar = page.getByRole('region', { name: 'Suggested change preview' });
  await expect(bar).toContainText('Add “Over the limit?” and “Manager approves” after this step.');
  await expect(bar).toContainText('2 added');
  await expect(page.locator('[aria-label="Workflow diagram"] .fl-node[data-diff="added"]')).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/02-new-steps-preview-1536-test-fixture.png` });
  await bar.getByRole('button', { name: 'Apply' }).click();

  // The card opens with what was filled in, each new field marked.
  const banner = card(page).getByTestId('filled-banner');
  await expect(banner).toContainText('4 details filled from your description (test fixture)');
  await expect(banner).toContainText('Still useful:');
  await expect(card(page).getByLabel('Owner / team')).toHaveValue('Sara (Procurement)');
  await expect(card(page).getByRole('button', { name: 'Remove Shared sheet' })).toBeVisible();
  await expect(card(page).getByRole('spinbutton')).toHaveValue('10');
  await expect(card(page).getByLabel('Duration unit')).toHaveValue('minutes');
  await expect(card(page).getByLabel('Notes')).toHaveValue(/over the limit/);
  await expect(card(page).locator('[data-filled]')).toHaveCount(4);
  await page.screenshot({ path: `${SHOTS}/03-details-filled-1536-test-fixture.png` });

  await expect
    .poll(async () => {
      const w = await stored(page, id);
      return [node(w, 'Log the request')?.owner, node(w, 'Log the request')?.tools, !!node(w, 'Over the limit?'), !!node(w, 'Manager approves')];
    }, { timeout: 8000 })
    .toEqual(['Sara (Procurement)', ['Shared sheet'], true, true]);

  // Undo in the banner takes back what the description filled in; the applied steps stay.
  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page).getByLabel('Owner / team')).toHaveValue('');
  await expect(card(page).getByTestId('filled-banner')).toHaveCount(0);
  await expect.poll(async () => node(await stored(page, id), 'Log the request')?.owner, { timeout: 8000 }).toBeUndefined();
  expect(node(await stored(page, id), 'Manager approves')).toBeTruthy();
});

test('a description of the step only fills it in (no preview); Discard keeps the details but not new steps; Ctrl+Z undoes the fill', async ({ page }) => {
  const id = await open(page);
  // From the toolbar too, not only by double-clicking.
  await step(page, 'Ask for quotations').click();
  await page.getByRole('toolbar', { name: 'Step tools for the selected step' }).getByRole('button', { name: 'Describe step' }).click();
  await box(page).getByLabel('Describe this step in your own words').fill('Finance in purchasing sends it to suppliers by email.');
  await box(page).getByLabel('Describe this step in your own words').press('Control+Enter');
  await expect(page.getByRole('region', { name: 'Suggested change preview' })).toHaveCount(0);
  await expect(card(page).getByLabel('Owner / team')).toHaveValue('Finance (Purchasing)');
  await expect.poll(async () => node(await stored(page, id), 'Ask for quotations')?.owner, { timeout: 8000 }).toBe('Finance (Purchasing)');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => node(await stored(page, id), 'Ask for quotations')?.owner, { timeout: 8000 }).toBeUndefined();

  // Discard: the details stay, the new steps don't.
  await step(page, 'Log the request').dblclick();
  await box(page).getByLabel('Describe this step in your own words').fill(FULL);
  await box(page).getByRole('button', { name: /Update step/ }).click();
  await page.getByRole('region', { name: 'Suggested change preview' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(card(page).getByLabel('Owner / team')).toHaveValue('Sara (Procurement)');
  await expect(page.locator('[aria-label="Workflow diagram"] .react-flow__node').filter({ hasText: 'Over the limit?' })).toHaveCount(0);
  await expect.poll(async () => node(await stored(page, id), 'Log the request')?.owner, { timeout: 8000 }).toBe('Sara (Procurement)');
  expect(node(await stored(page, id), 'Over the limit?')).toBeUndefined();
});

test('nothing new to add keeps the box open with a hint; Escape closes it and returns to the step; Ask Flico is still in the card', async ({ page }) => {
  const id = await open(page);
  const before = await stored(page, id);
  await step(page, 'Ask for quotations').dblclick();
  await box(page).getByLabel('Describe this step in your own words').fill('Sends it to suppliers by email.');
  await box(page).getByRole('button', { name: /Update step/ }).click();
  await expect(card(page).getByTestId('filled-banner')).toBeVisible();
  await expect.poll(async () => (await stored(page, id)).revision, { timeout: 8000 }).toBe(before.revision + 1);
  await page.keyboard.press('Escape');
  // Saying the same again adds nothing: the box stays open with a hint, and nothing is saved.
  await step(page, 'Ask for quotations').dblclick();
  await box(page).getByLabel('Describe this step in your own words').fill('Sends it to suppliers by email.');
  await box(page).getByRole('button', { name: /Update step/ }).click();
  await expect(box(page).getByRole('status')).toContainText("Flico didn't find anything new to add");
  expect((await stored(page, id)).revision).toBe(before.revision + 1);
  await page.keyboard.press('Escape');
  await expect(box(page)).toHaveCount(0);
  await expect(step(page, 'Ask for quotations')).toBeFocused();
  await step(page, 'Ask for quotations').dblclick();
  await box(page).getByRole('button', { name: 'Edit fields myself' }).click();
  await expect(card(page).getByRole('button', { name: 'Ask Flico about this step' })).toBeVisible();
});
