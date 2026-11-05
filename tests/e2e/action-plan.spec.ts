// Assessment page revamp (option A, owner approved 2026-11-02): the proposed workflow beside one Action
// plan of process changes and automation opportunities with journey stages, and the executive summary
// as a compact card at the bottom. AI output comes from Flico's labelled test fixture, never a live model.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/action-plan';
mkdirSync(SHOTS, { recursive: true });

/** Steps the fixture classifies as full / assisted / human-led / more information needed. */
const graph: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'match', type: 'action', label: 'Match invoice to order', notes: 'Rule: the policy is to match amount and PO number. We have API access to the ERP. Finance can verify every match automatically.', position: { x: 288, y: 0 } },
    { id: 'compare', type: 'action', label: 'Compare supplier quotations', notes: 'The engineer does the technical evaluation and selects the supplier.', position: { x: 576, y: 0 } },
    { id: 'inspect', type: 'action', label: 'Check delivery', notes: 'A physical inspection of the goods is required on arrival.', position: { x: 864, y: 0 } },
    { id: 'quote', type: 'action', label: 'Send quotation', position: { x: 1152, y: 0 } },
    { id: 'f', type: 'finish', label: 'Done', position: { x: 1440, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'match', type: 'normal' },
    { id: 'e2', sourceId: 'match', targetId: 'compare', type: 'normal' },
    { id: 'e3', sourceId: 'compare', targetId: 'inspect', type: 'normal' },
    { id: 'e4', sourceId: 'inspect', targetId: 'quote', type: 'normal' },
    { id: 'e5', sourceId: 'quote', targetId: 'f', type: 'normal' },
  ],
};

async function analysed(page: Page, viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('plan'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Purchasing' } });
  expect((await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph, baseRevision: 1 } })).status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: 'Quick Analysis' }).click();
  await expect(page.getByRole('tab', { name: 'Analysis', selected: true })).toBeVisible();
  await expect(page.getByTestId('action-plan')).toBeVisible();
}

const plan = (page: Page) => page.getByTestId('action-plan');

test('one Action plan beside the diagram; the summary is a compact card at the bottom', async ({ page }) => {
  await analysed(page);
  await expect(page.getByText(/Test fixture, not a live AI analysis/)).toBeVisible();

  // Both kinds of work in one list, process changes first.
  await expect(plan(page).getByRole('heading', { name: 'Process changes' })).toBeVisible();
  await expect(plan(page).getByRole('heading', { name: 'Automation' })).toBeVisible();
  const items = plan(page).locator('li[data-plan-item]');
  await expect(items.first()).toHaveAttribute('data-rec', /.+/);
  await expect(items.last()).toHaveAttribute('data-assessment', /.+/);
  const total = await items.count();
  const progress = page.getByTestId('plan-progress');
  await expect(progress).toHaveText(`1 of ${total} done`); // the human-led step is settled
  await expect(plan(page).getByRole('progressbar', { name: 'Action plan progress' })).toHaveAttribute('aria-valuenow', '1');

  // The summary sits below the diagram and the plan, one line until opened.
  const summary = page.getByTestId('summary-card');
  const review = page.getByTestId('review-section');
  expect((await summary.boundingBox())!.y).toBeGreaterThan((await review.boundingBox())!.y + (await review.boundingBox())!.height - 1);
  expect((await summary.boundingBox())!.height).toBeLessThan(70);
  await expect(summary).toContainText('No savings assumed');
  await expect(summary).not.toContainText('requires verification');
  await page.screenshot({ path: `${SHOTS}/01-action-plan-1536-test-fixture.png` });

  await summary.getByRole('button', { name: 'Details' }).click();
  await expect(summary.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
  await expect(summary).toContainText('No numerical savings assumed');
  await expect(summary).toContainText(/require/);
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/02-summary-details-1536-test-fixture.png` });
  await summary.getByRole('button', { name: 'Details' }).click();

  // Accepting a change moves it along its journey; applying finishes it.
  const first = items.first();
  await first.getByRole('button', { name: /^Accept:/ }).click();
  await expect(first.getByTestId('stage-track')).toHaveAttribute('aria-label', 'Progress: Accepted (step 2 of 3)');
  await expect(progress).toHaveText(`1 of ${total} done`);
  await page.getByRole('button', { name: 'Apply accepted changes' }).click();
  await page.getByRole('dialog', { name: 'Review accepted changes' }).getByRole('button', { name: 'Confirm & apply' }).click();
  await expect(page.getByRole('tab', { name: 'Editor', selected: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await expect(page.getByText(/Accepted changes were applied on/)).toBeVisible();
  // Changes that weren't accepted are settled once the others are applied.
  const automationCount = await plan(page).locator('li[data-assessment]').count();
  await expect(progress).toHaveText(`2 of ${automationCount + 1} done`);
  await expect(plan(page).locator('li[data-rec]').first().getByTestId('stage-track')).toHaveAttribute('aria-label', 'Progress: All stages done');
});

test('filters, and the automation journey: the next action is the filled button', async ({ page }) => {
  await analysed(page);
  await plan(page).getByRole('button', { name: /^Automation \(\d+\)$/ }).click();
  await expect(plan(page).locator('li[data-rec]')).toHaveCount(0);
  const match = plan(page).locator('li[data-assessment="match"]');
  // Not yet clarified: Clarify is the suggested next action, the brief is offered beside it.
  await expect(match.getByRole('button', { name: 'Clarify “Match invoice to order”' })).toHaveClass(/bg-fl-brand /);
  await expect(match.getByRole('button', { name: 'Create automation brief for “Match invoice to order”' })).toBeVisible();
  // Needs info: only Clarify.
  const quote = plan(page).locator('li[data-assessment="quote"]');
  await expect(quote.getByRole('button', { name: /Create/ })).toHaveCount(0);
  await expect(quote.getByRole('button', { name: 'Clarify “Send quotation”' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-automation-filter-1536-test-fixture.png` });

  await plan(page).getByRole('button', { name: /^Process \(\d+\)$/ }).click();
  await expect(plan(page).locator('li[data-assessment]')).toHaveCount(0);
  await expect(plan(page).locator('li[data-rec]').first()).toBeVisible();
  // Selecting an automation step in the diagram shows everything again.
  await plan(page).getByRole('button', { name: /^All/ }).click();
  await page.locator('[aria-label="Workflow with proposed changes"] .react-flow__node[data-id="match"] .fl-auto-badge').click();
  await expect(match.getByRole('button', { name: /^Match invoice to order/ })).toHaveAttribute('aria-pressed', 'true');
});

test('1280px and full screen: the plan stays readable and Apply stays within reach', async ({ page }) => {
  await analysed(page, { width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/04-action-plan-1280-test-fixture.png` });
  await page.getByRole('button', { name: 'Full screen' }).click();
  const section = page.getByTestId('review-section');
  await expect(section).toHaveAttribute('data-expanded', 'true');
  await expect(section.getByRole('button', { name: 'Apply accepted changes' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/05-full-screen-1280-test-fixture.png` });
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(section).not.toHaveAttribute('data-expanded', 'true');
});

test('full screen: an automation card floats beside its block, Clarify works there, and it follows pan and zoom', async ({ page }) => {
  await analysed(page);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.getByTestId('action-plan')).toHaveCount(0);
  const diagram = page.locator('[aria-label="Workflow with proposed changes"]');
  await diagram.locator('.react-flow__node[data-id="match"] .fl-auto-badge').click();
  const floating = page.getByTestId('floating-plan-card');
  await expect(floating).toContainText('Match invoice to order');
  await expect(floating.locator('li[data-assessment="match"]')).toBeVisible();
  // Beside its block.
  const block = (await diagram.locator('.react-flow__node[data-id="match"]').boundingBox())!;
  const card = (await floating.boundingBox())!;
  expect(card.x).toBeLessThan(block.x + block.width);
  expect(card.x + card.width).toBeGreaterThan(block.x);
  await page.screenshot({ path: `${SHOTS}/06-full-screen-floating-card-1536-test-fixture.png` });
  // It follows the block when the diagram zooms.
  const zoomIn = page.getByRole('group', { name: 'Canvas controls' }).getByRole('button', { name: 'Zoom in' });
  await zoomIn.click();
  await expect.poll(async () => Math.round((await floating.boundingBox())!.y)).not.toBe(Math.round(card.y));
  // Clarify runs inside the floating card.
  await floating.getByRole('button', { name: 'Clarify “Match invoice to order”' }).click();
  await expect(floating.getByTestId('interview-panel')).toBeVisible();
  await floating.getByRole('button', { name: 'Close card' }).click();
  await expect(floating).toHaveCount(0);
});

