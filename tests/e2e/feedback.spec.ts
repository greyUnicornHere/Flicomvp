// Owner feedback after Milestone 4 (2026-10-31): full names in blocks, and full screen for the
// editor, the analysis review (diagram + recommendations) and the final preview.
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/feedback-m4';
const LONG = 'Check the purchase order against the signed framework agreement and the regional discount table';

const orderGraph: WorkflowGraph = {
  nodes: [
    { id: 'n-start', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'n-receive', type: 'action', label: 'Receive order', position: { x: 288, y: 0 } },
    { id: 'n-check', type: 'action', label: LONG, position: { x: 576, y: 0 } },
    { id: 'n-approve', type: 'approval', label: 'Manager approves', position: { x: 864, y: 0 } },
    { id: 'n-ship', type: 'finish', label: 'Order shipped', position: { x: 1152, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 'n-start', targetId: 'n-receive', type: 'normal' },
    { id: 'e2', sourceId: 'n-receive', targetId: 'n-check', type: 'normal' },
    { id: 'e3', sourceId: 'n-check', targetId: 'n-approve', type: 'normal' },
    { id: 'e4', sourceId: 'n-approve', targetId: 'n-ship', type: 'normal' },
  ],
};

async function open(page: Page) {
  await page.setViewportSize({ width: 1536, height: 960 });
  await signIn(page, uniqueEmail('feedback'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Customer Order Processing' } });
  await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph: orderGraph, baseRevision: 1 } });
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
}

const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

test('the editor goes full screen and back, with tools and Ask Flico still available', async ({ page }) => {
  await open(page);
  const button = page.getByRole('button', { name: 'Full screen' });
  await button.click();
  await expect.poll(() => isFullscreen(page)).toBe(true);
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true');
  // Editing still works in full screen: menus and Ask Flico are on top.
  await page.getByRole('button', { name: 'Ask Flico' }).click();
  await expect(page.getByRole('dialog', { name: 'Ask Flico' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Ask Flico' }).click();
  await page.screenshot({ path: `${SHOTS}/02-editor-full-screen.png` });
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => isFullscreen(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Full screen' })).toHaveAttribute('aria-pressed', 'false');
});

test('analysis: diagram and recommendations together in full screen, then the final preview', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: 'Quick Analysis' }).click();
  await expect(page.locator('li[data-rec]')).toHaveCount(3);
  // The long-named step is removed by a recommendation: its full name shows in the diagram's Removed list.
  await expect(page.getByTestId('removed-steps')).toContainText(LONG);

  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => isFullscreen(page)).toBe(true);
  const section = page.getByTestId('review-section');
  await expect(section).toHaveAttribute('data-expanded', 'true');
  const box = (await section.boundingBox())!;
  expect(box.height).toBeGreaterThan(800); // fills the screen below the header
  // Full screen enlarges the workflow only (owner feedback, 2026-11-05): no side list; the diagram takes the width.
  await expect(page.getByTestId('action-plan')).toHaveCount(0);
  const diagram = page.locator('[aria-label="Workflow with proposed changes"]');
  expect((await diagram.boundingBox())!.width).toBeGreaterThan(1400);
  // Selecting a change shows its card floating beside it (here from the Removed list); reviewing works there.
  await page.getByTestId('removed-steps').getByRole('button').first().click();
  const floating = page.getByTestId('floating-plan-card');
  await expect(floating).toBeVisible();
  await expect(page.getByTestId('panel-pointer')).toBeVisible();
  await floating.getByRole('button', { name: /^Accept: Combine/ }).click();
  await expect(floating.getByTestId('stage-track')).toHaveAttribute('aria-label', /Accepted/);
  await page.screenshot({ path: `${SHOTS}/03-analysis-full-screen-test-fixture.png` });
  await page.keyboard.press('Escape');
  await expect(floating).toHaveCount(0);
  // The whole list is one click away, over the diagram.
  await section.getByRole('button', { name: /^Action plan/ }).click();
  await expect(page.getByTestId('plan-drawer').locator('li[data-rec]')).toHaveCount(3);
  await section.getByRole('button', { name: 'Hide action plan' }).click();
  await expect(page.getByTestId('plan-drawer')).toHaveCount(0);
  // Applying stays within reach in full screen.
  await expect(section.getByRole('button', { name: 'Apply accepted changes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => isFullscreen(page)).toBe(false);
  await expect(section).not.toHaveAttribute('data-expanded', 'true');

  await page.getByRole('button', { name: 'Apply accepted changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review accepted changes' });
  await dialog.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => isFullscreen(page)).toBe(true);
  expect((await dialog.boundingBox())!.height).toBeGreaterThan(850);
  await page.screenshot({ path: `${SHOTS}/04-final-preview-full-screen-test-fixture.png` });
  await dialog.getByRole('button', { name: 'Back to review' }).click();
  await expect.poll(() => isFullscreen(page)).toBe(false);
});
