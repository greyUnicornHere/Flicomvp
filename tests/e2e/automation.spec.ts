// Automation assessment in the Action plan of the Analysis tab: top opportunities first, compact cards
// with journey stages, explanation in place, linked to the diagram. AI output comes from Flico's labelled
// test fixture (AI_PROVIDER=fixture), never a live model.
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowDetail } from '../../shared/api';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/automation';

/** Four work steps the fixture classifies as full / assisted / human-led / more information needed, plus a wait. */
const graph: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'match', type: 'action', label: 'Match invoice to order', notes: 'Rule: the policy is to match amount and PO number. We have API access to the ERP. Finance can verify every match automatically.', position: { x: 288, y: 0 } },
    { id: 'compare', type: 'action', label: 'Compare supplier quotations', notes: 'The engineer does the technical evaluation and selects the supplier.', position: { x: 576, y: 0 } },
    { id: 'wait', type: 'wait', label: 'Wait for delivery', position: { x: 864, y: 0 } },
    { id: 'inspect', type: 'action', label: 'Check delivery', notes: 'A physical inspection of the goods is required on arrival.', position: { x: 1152, y: 0 } },
    { id: 'quote', type: 'action', label: 'Send quotation', position: { x: 1440, y: 0 } },
    { id: 'f', type: 'finish', label: 'Done', position: { x: 1728, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'match', type: 'normal' },
    { id: 'e2', sourceId: 'match', targetId: 'compare', type: 'normal' },
    { id: 'e3', sourceId: 'compare', targetId: 'wait', type: 'normal' },
    { id: 'e4', sourceId: 'wait', targetId: 'inspect', type: 'normal' },
    { id: 'e5', sourceId: 'inspect', targetId: 'quote', type: 'normal' },
    { id: 'e6', sourceId: 'quote', targetId: 'f', type: 'normal' },
  ],
};

async function analysed(page: Page, viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('automation'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Purchasing' } });
  expect((await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph, baseRevision: 1 } })).status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: 'Quick Analysis' }).click();
  await expect(page.getByRole('tab', { name: 'Analysis', selected: true })).toBeVisible();
  return workflow.id as string;
}

const panel = (page: Page) => page.getByTestId('action-plan');
const showAutomation = (page: Page) => panel(page).getByRole('button', { name: /^Automation \(\d+\)$/ }).click();
const row = (page: Page, name: string) => panel(page).locator('li[data-assessment]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) });
const label = (page: Page, id: string) => page.locator(`[aria-label="Workflow with proposed changes"] .react-flow__node[data-id="${id}"] .fl-auto-badge`);
const diagramStep = (page: Page, id: string) => page.locator(`[aria-label="Workflow with proposed changes"] .react-flow__node[data-id="${id}"] .fl-step`);

test('Automation in the Action plan: top opportunities first, compact cards, explanation in place, linked to the diagram; no extra credit', async ({ page }) => {
  await analysed(page);
  await expect(page.getByTestId('summary-card')).toContainText('4 steps assessed');
  // Everything is shown by default; the Automation filter shows only the assessed steps.
  await expect(panel(page).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  await showAutomation(page);
  await expect(panel(page).locator('li[data-rec]')).toHaveCount(0);

  // Top opportunities first: the candidate, then the human-assisted step, each with what to automate and the next step.
  const rows = panel(page).locator('li[data-assessment]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Match invoice to order');
  await expect(rows.nth(0)).toContainText('Top opportunity');
  await expect(rows.nth(0)).toContainText('Next:');
  await expect(rows.nth(1)).toContainText('Compare supplier quotations');
  await expect(rows.nth(1)).toContainText('Top opportunity');
  await expect(rows.nth(1)).toContainText('Extract prices');
  await expect(rows.filter({ hasText: 'Top opportunity' })).toHaveCount(2);
  await expect(row(page, 'Compare supplier quotations')).toContainText('Human-assisted');
  await expect(row(page, 'Check delivery')).toContainText('Human-led');
  await expect(row(page, 'Send quotation')).toContainText('Needs info');
  // Start, Finish and the wait are not work, so they are not assessed.
  await expect(panel(page)).not.toContainText('Wait for delivery');
  // Each step shows where it is in its journey: assessed, then clarified, then its brief.
  await expect(row(page, 'Match invoice to order').getByTestId('stage-track')).toHaveAttribute('aria-label', 'Progress: Assessed (step 1 of 3)');
  await expect(row(page, 'Match invoice to order').getByTestId('stage-track')).toContainText('Automation brief');
  await expect(row(page, 'Send quotation').getByTestId('stage-track')).not.toContainText('brief');
  // Human-led steps are settled: they count as done.
  await expect(row(page, 'Check delivery').getByTestId('stage-track')).toContainText('Support ideas');
  await expect(page.getByTestId('plan-progress')).toHaveText('1 of 6 done');

  // Compact card: the verdict line and the next step; the rest is under "Why".
  const open = row(page, 'Compare supplier quotations');
  await expect(open).not.toContainText('Business value');
  // Selecting a step highlights it in the diagram (here: in the Removed list, as a recommendation removes it).
  await open.getByRole('button').first().click();
  await expect(open.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await open.getByRole('button', { name: 'Why' }).click();
  await expect(open).toContainText('Keep human');
  await expect(open).toContainText('You said');
  await expect(open).toContainText('Business value');
  // This step is removed by a recommendation, so it isn't drawn: its entry in the Removed list is highlighted.
  const removedEntry = page.getByTestId('removed-steps').getByRole('button', { name: /Compare supplier quotations/ });
  await expect(removedEntry).toHaveClass(/shadow/);
  await expect(removedEntry).toContainText('Human-assisted');
  await expect(open).toContainText('Rules and judgment');
  await page.screenshot({ path: `${SHOTS}/01-automation-tab-1536-test-fixture.png` });

  // Clicking a step in the diagram opens its assessment.
  await page.locator('[aria-label="Workflow with proposed changes"] .react-flow__node[data-id="inspect"]').click();
  await expect(row(page, 'Check delivery').getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'Check delivery')).toContainText('physical');
  await expect(diagramStep(page, 'inspect')).toHaveAttribute('data-focus', 'on');
  await expect(diagramStep(page, 'quote')).toHaveAttribute('data-focus', 'dim');
  // A removed step's entry opens its assessment too.
  await removedEntry.click();
  await expect(row(page, 'Compare supplier quotations').getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');

  // Process changes only: the diagram follows recommendation selection again.
  await panel(page).getByRole('button', { name: /^Process/ }).click();
  await expect(page.locator('li[data-rec]').first()).toBeVisible();
  await expect(panel(page).locator('li[data-assessment]')).toHaveCount(0);
  // One analysis, one credit: the assessment needed no extra credit.
  expect((await (await page.request.get('/api/credits')).json()).balance).toBe(9);
});

test('changing a step (or what feeds it) shows Needs reassessment; moving blocks does not', async ({ page }) => {
  const id = await analysed(page);
  const current = (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow as WorkflowDetail;
  const next: WorkflowGraph = {
    nodes: current.graph.nodes.map((n) =>
      n.id === 'inspect' ? { ...n, notes: 'A photo of the goods is enough now.' } : n.id === 'match' ? { ...n, position: { x: n.position.x + 40, y: n.position.y + 200 } } : n,
    ),
    edges: current.graph.edges,
  };
  expect((await page.request.put(`/api/workflows/${id}/graph`, { data: { graph: next, baseRevision: current.revision } })).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await expect(row(page, 'Check delivery')).toContainText('Needs reassessment');
  await expect(row(page, 'Send quotation')).toContainText('Needs reassessment'); // fed by the changed step
  await expect(row(page, 'Match invoice to order')).not.toContainText('Needs reassessment'); // only moved
  // The labels on the diagram say so too.
  await expect(label(page, 'inspect')).toHaveAttribute('data-stale', 'true');
  await expect(label(page, 'match')).not.toHaveAttribute('data-stale', 'true');
  await row(page, 'Check delivery').getByRole('button').first().click();
  await expect(row(page, 'Check delivery')).toContainText('run a new analysis first');
  await page.screenshot({ path: `${SHOTS}/02-needs-reassessment-1536-test-fixture.png` });
});

test('an analysis made before assessments existed still opens and says it has none', async ({ page }) => {
  const id = await analysed(page);
  const db = new DatabaseSync('tests/e2e/.tmp/e2e.db');
  db.prepare('UPDATE analyses SET assessments_json = NULL WHERE workflow_id = ?').run(id);
  db.close();
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await expect(page.getByTestId('summary-card')).toContainText('No automation assessment');
  await expect(page.getByText(/made before automation assessments were added/)).toBeVisible();
  // The process changes are still there.
  await expect(page.locator('li[data-rec]').first()).toBeVisible();
  await showAutomation(page);
  await expect(page.getByText(/made before automation assessments were added/)).toBeVisible();
  await expect(page.locator('li[data-rec]')).toHaveCount(0);
});

test('1280px: the Action plan stays readable next to the diagram', async ({ page }) => {
  await analysed(page, { width: 1280, height: 800 });
  await showAutomation(page);
  await row(page, 'Match invoice to order').getByRole('button').first().click();
  await expect(row(page, 'Match invoice to order')).toContainText('provisional');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/03-automation-tab-1280-test-fixture.png` });
});

test('labels on the analysis diagram: hidden when only process changes are shown; a label opens its assessment', async ({ page }) => {
  await analysed(page);
  const labels = page.locator('[aria-label="Workflow with proposed changes"] .fl-auto-badge');
  // Process changes only: change highlighting only.
  await panel(page).getByRole('button', { name: /^Process/ }).click();
  await expect(labels).toHaveCount(0);
  await panel(page).getByRole('button', { name: /^All/ }).click();
  await expect(labels).toHaveCount(3); // Start, Finish and the wait have none; the removed step is listed instead
  await expect(page.getByTestId('removed-steps').getByTestId('removed-automation')).toHaveText('Human-assisted');
  await expect(label(page, 'match')).toHaveAttribute('data-provisional', 'true');
  await expect(label(page, 'inspect')).toHaveText('Human-led');
  await expect(label(page, 'inspect')).toHaveAttribute('aria-label', /Keep human-led/);
  await expect(label(page, 'quote')).toHaveText('Needs info');
  await expect(page.locator('[aria-label="Workflow with proposed changes"] .react-flow__node[data-id="wait"] .fl-auto-badge')).toHaveCount(0);

  // A label opens that step's assessment and highlights the step; no recommendation gets selected.
  await label(page, 'inspect').click();
  await expect(row(page, 'Check delivery').getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(diagramStep(page, 'inspect')).toHaveAttribute('data-focus', 'on');
  await page.screenshot({ path: `${SHOTS}/04-labels-on-diagram-1536-test-fixture.png` });
  // Zoomed in, the labels read clearly next to the change highlighting.
  const zoomIn = page.getByRole('group', { name: 'Canvas controls' }).getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 4; i++) await zoomIn.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/05-labels-zoomed-in-1536-test-fixture.png` });
  await expect(page.locator('li[data-rec] button[aria-pressed="true"]')).toHaveCount(0);
  await panel(page).getByRole('button', { name: /^Process/ }).click();
  await expect(labels).toHaveCount(0);

  // The editor never shows them.
  await page.getByRole('tab', { name: 'Editor' }).click();
  await expect(page.locator('[aria-label="Workflow diagram"] .fl-auto-badge')).toHaveCount(0);
});
