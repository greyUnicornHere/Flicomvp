// Milestone 4 end-to-end: Quick/Guided analysis, credits, one-diagram review, Apply and Undo.
// Analyses come from Flico's deterministic test fixture (AI_PROVIDER=fixture), never a live model.
import { expect, test, type Page } from '@playwright/test';
import type { Analysis, WorkflowDetail } from '../../shared/api';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/m4';

/** Start → Receive order → Check order → Manager approves → Shipped (directives go in the Finish notes). */
const orderGraph = (directive = ''): WorkflowGraph => ({
  nodes: [
    { id: 'n-start', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'n-receive', type: 'action', label: 'Receive order', position: { x: 288, y: 0 } },
    { id: 'n-check', type: 'action', label: 'Check order', position: { x: 576, y: 0 } },
    { id: 'n-approve', type: 'approval', label: 'Manager approves', position: { x: 864, y: 0 } },
    { id: 'n-ship', type: 'finish', label: 'Order shipped', position: { x: 1152, y: 0 }, ...(directive ? { notes: directive } : {}) },
  ],
  edges: [
    { id: 'e1', sourceId: 'n-start', targetId: 'n-receive', type: 'normal' },
    { id: 'e2', sourceId: 'n-receive', targetId: 'n-check', type: 'normal' },
    { id: 'e3', sourceId: 'n-check', targetId: 'n-approve', type: 'normal' },
    { id: 'e4', sourceId: 'n-approve', targetId: 'n-ship', type: 'normal' },
  ],
});

async function openWorkflow(page: Page, directive = '', viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('analysis'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Customer Order Processing' } });
  expect((await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph: orderGraph(directive), baseRevision: 1 } })).status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  return workflow.id as string;
}

const stored = async (page: Page, id: string): Promise<WorkflowDetail> => (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow;
const analyses = async (page: Page, id: string): Promise<Analysis[]> => (await (await page.request.get(`/api/workflows/${id}/analyses`)).json()).analyses;
const credits = async (page: Page): Promise<number> => (await (await page.request.get('/api/credits')).json()).balance;
const recCard = (page: Page, title: RegExp | string) => page.locator('article[data-rec]').filter({ hasText: title });

async function quickAnalysis(page: Page) {
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: 'Quick Analysis' }).click();
}

test('R01/R03/R04/R05/R12: Quick analysis, one-diagram review, synchronized list, one credit', async ({ page }) => {
  await openWorkflow(page);
  await page.getByRole('button', { name: 'Analyze' }).click();
  const menu = page.getByRole('menu', { name: 'Analyze' });
  await expect(menu).toContainText('10 of 10 analyses left');
  await expect(menu.getByRole('menuitem', { name: 'Quick Analysis' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Guided Analysis/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-analyze-menu-1536.png` });
  await menu.getByRole('menuitem', { name: 'Quick Analysis' }).click();

  // Opens the results automatically.
  await expect(page.getByRole('tab', { name: 'Analysis', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'A clearer, leaner way to run this workflow.' })).toBeVisible();
  await expect(page.getByText('No numerical savings assumed')).toBeVisible();
  await expect(page.getByText(/Test fixture, not a live AI analysis/)).toBeVisible();
  const cards = page.locator('article[data-rec]');
  await expect(cards).toHaveCount(3);
  // Highest impact first; categories and evidence labels shown.
  await expect(cards.first()).toContainText('Log every request when it arrives');
  await expect(cards.first()).toContainText('Complex Change');
  await expect(cards.first()).toContainText('Based on assumptions');
  await expect(recCard(page, 'Combine')).toContainText('Quick Win');
  await expect(recCard(page, 'Combine')).toContainText('Supported by your workflow');
  await expect(recCard(page, 'criteria')).toContainText('Requires verification');

  // One diagram with every proposal drawn.
  const diagram = page.locator('[aria-label="Workflow with proposed changes"]');
  await expect(diagram.locator('.fl-node[data-diff="added"]')).toHaveCount(1);
  await expect(diagram.locator('.fl-node[data-diff="modified"]')).toHaveCount(1);
  await expect(diagram.locator('.fl-node[data-diff="removed"]')).toHaveCount(1);
  // Connections are drawn once the steps have been measured; the old path is marked as removed.
  await expect(diagram.locator('.fl-diff-badge[data-diff="removed"]').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/02-results-1536-test-fixture.png` });

  // List → diagram.
  await recCard(page, 'Combine').getByRole('button', { name: /^Combine/ }).click();
  await expect(diagram.locator('.react-flow__node[data-id="n-check"] .fl-node')).toHaveAttribute('data-focus', 'on');
  // Its connected steps stay visible; unrelated steps step back.
  await expect(diagram.locator('.react-flow__node[data-id="n-approve"] .fl-node')).toHaveAttribute('data-focus', 'on');
  await expect(diagram.locator('.react-flow__node[data-id="n-ship"] .fl-node')).toHaveAttribute('data-focus', 'dim');
  // Diagram → list.
  await diagram.locator('.react-flow__node[data-id="n-approve"]').click();
  await expect(recCard(page, 'criteria').getByRole('button', { name: /^Write down/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(recCard(page, 'Combine').getByRole('button', { name: /^Combine/ })).toHaveAttribute('aria-pressed', 'false');
  // Expandable details.
  await recCard(page, 'criteria').getByRole('button', { name: 'Details' }).click();
  await expect(recCard(page, 'criteria')).toContainText('How to verify');
  await page.screenshot({ path: `${SHOTS}/03-selected-recommendation-1536.png` });

  expect(await credits(page)).toBe(9);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('menu', { name: 'Analyze' })).toContainText('9 of 10 analyses left');
  await page.keyboard.press('Escape');
});

test('R06/R07/R08: reject, reconsider, combined preview of accepted only, Confirm & Apply, Undo', async ({ page }) => {
  const id = await openWorkflow(page);
  const before = await stored(page, id);
  await quickAnalysis(page);
  await expect(page.locator('article[data-rec]')).toHaveCount(3);

  await page.getByRole('button', { name: /^Reject: Write down the criteria/ }).click();
  await expect(page.locator('article[data-rec]')).toHaveCount(2); // moved out of the list
  const rejectedToggle = page.getByRole('button', { name: /Rejected recommendations/ });
  await expect(rejectedToggle).toContainText('1');
  await expect(rejectedToggle).toHaveAttribute('aria-expanded', 'false');
  await rejectedToggle.click();
  await expect(recCard(page, 'criteria')).toContainText('Rejected');
  await recCard(page, 'criteria').getByRole('button', { name: /Undecide/ }).click(); // reconsider
  await expect(rejectedToggle).toContainText('0');
  await page.getByRole('button', { name: /^Reject: Write down the criteria/ }).click();

  await page.getByRole('button', { name: /^Accept: Combine/ }).click();
  await page.getByRole('button', { name: /^Accept: Log every request/ }).click();
  await expect(recCard(page, 'Combine')).toContainText('Accepted');

  await page.getByRole('button', { name: 'Review & confirm' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review accepted changes' });
  await expect(dialog).toContainText('Only the 2 accepted recommendations are shown');
  await expect(dialog.locator('.fl-node[data-diff="modified"]')).toHaveCount(0); // the rejected change is not in it
  await expect(dialog.locator('.fl-node[data-diff="added"]')).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/04-final-preview-1536-test-fixture.png` });
  expect((await stored(page, id)).revision).toBe(before.revision); // nothing applied yet
  await dialog.getByRole('button', { name: 'Confirm & apply' }).click();

  // Back in the editor with the change applied, as one undoable step.
  await expect(page.getByRole('tab', { name: 'Editor', selected: true })).toBeVisible();
  const after = await stored(page, id);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.graph.nodes.map((n) => n.label).sort()).toEqual(['Log the request', 'Manager approves', 'Order shipped', 'Receive order', 'Start']);
  expect(after.graph.nodes.find((n) => n.label === 'Manager approves')!.notes).toBeUndefined();
  const [analysis] = await analyses(page, id);
  expect(analysis!.snapshot).toEqual(before.graph); // original preserved
  expect(analysis!.appliedAt).not.toBeNull();
  await page.screenshot({ path: `${SHOTS}/05-applied-editor-1536.png` });

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await stored(page, id)).graph, { timeout: 8000 }).toEqual(before.graph);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await expect(page.getByText(/Accepted changes were applied on/)).toBeVisible();
});

test('R09: incompatible recommendations are reported and cannot be applied', async ({ page }) => {
  const id = await openWorkflow(page, '[fixture:conflict]');
  const before = await stored(page, id);
  await quickAnalysis(page);
  await expect(page.locator('article[data-rec]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Accept all' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review accepted changes' });
  await expect(dialog.getByRole('alert')).toContainText('both change “Check order”. Accept only one of them.');
  await expect(dialog.getByRole('button', { name: 'Confirm & apply' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/06-conflict-1536-test-fixture.png` });
  await dialog.getByRole('button', { name: 'Back to review' }).click();
  await expect(page.getByRole('article', { name: /^Recommendation \d: Clarify/ }).getByRole('alert')).toContainText('Accept only one');
  await page.getByRole('button', { name: /^Reject: Clarify/ }).click();
  await page.getByRole('button', { name: 'Review & confirm' }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm & apply' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Back to review' }).click();
  expect((await stored(page, id)).revision).toBe(before.revision);
});

test('R10: Initial and Latest analysis; a single analysis shows no version switcher', async ({ page }) => {
  await openWorkflow(page);
  await quickAnalysis(page);
  await expect(page.getByRole('tab', { name: 'Analysis', selected: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Show analysis' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Editor' }).click();
  await quickAnalysis(page);
  const versions = page.getByRole('combobox', { name: 'Show analysis' });
  await expect(versions).toHaveValue('latest');
  await versions.selectOption('initial');
  await expect(versions).toHaveValue('initial');
  expect(await credits(page)).toBe(8);
});

test('R11: cancelled and failed analyses use no credit', async ({ page }) => {
  const id = await openWorkflow(page, '[fixture:slow]');
  await quickAnalysis(page);
  const overlay = page.getByRole('dialog', { name: 'Analysing your workflow' });
  await expect(overlay.getByText('Reviewing steps, hand-offs and waits')).toHaveAttribute('aria-current', 'step');
  await page.screenshot({ path: `${SHOTS}/07-progress-1536-test-fixture.png` });
  await overlay.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Analysis cancelled' })).toContainText('no credit was used');
  await page.getByRole('button', { name: 'Close' }).click();
  expect(await credits(page)).toBe(10);
  expect(await analyses(page, id)).toEqual([]);

  // A provider outage fails cleanly too.
  const graph = orderGraph('[fixture:error]');
  const current = await stored(page, id);
  await page.request.put(`/api/workflows/${id}/graph`, { data: { graph, baseRevision: current.revision } });
  await page.reload();
  await quickAnalysis(page);
  await expect(page.getByRole('dialog', { name: 'The analysis didn’t finish' })).toContainText('No credit was used');
  expect(await credits(page)).toBe(10);
});

test('R02: Guided analysis with optional questions; skipping still gives a full analysis', async ({ page }) => {
  const id = await openWorkflow(page);
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: /Guided Analysis/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Guided Analysis' });
  await expect(dialog.getByText('Roughly how often does this process run?')).toBeVisible();
  await expect(dialog.getByText('What decides the outcome at “Manager approves”?')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-guided-questions-1536-test-fixture.png` });
  await dialog.getByRole('button', { name: 'Skip questions' }).click();
  await expect(page.locator('article[data-rec]')).toHaveCount(3);
  const [skipped] = await analyses(page, id);
  expect(skipped).toMatchObject({ mode: 'guided', answers: [] });

  await page.getByRole('tab', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: /Guided Analysis/ }).click();
  await dialog.getByLabel('Roughly how often does this process run?').fill('About 40 orders a week');
  await dialog.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.locator('article[data-rec]')).toHaveCount(3);
  await expect(page.locator('article[data-rec]').first()).toBeVisible();
  const latest = (await analyses(page, id)).find((a) => a.slot === 'latest')!;
  expect(latest.answers).toEqual([{ question: 'Roughly how often does this process run?', answer: 'About 40 orders a week' }]);
  // Equally detailed either way.
  expect(latest.recommendations.length).toBe(skipped!.recommendations.length);
});

test('R13: no invented figures', async ({ page }) => {
  await openWorkflow(page, '[fixture:roi]');
  await quickAnalysis(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Everything Flico wrote (the diagram's zoom percentage is not a claim).
  const text = [await page.getByRole('heading', { level: 1 }).innerText(), await page.locator('[aria-labelledby="exec-summary"]').innerText(), await page.locator('[aria-labelledby="recs-heading"]').innerText()].join(' ');
  expect(text.match(/\d+\s?%|\$\s?\d|\bROI\b/g)).toBeNull();
});

test('R14: a sound workflow gets no forced recommendations', async ({ page }) => {
  await openWorkflow(page, '[fixture:none]');
  await quickAnalysis(page);
  await expect(page.getByRole('heading', { level: 1, name: 'This workflow is already in good shape.' })).toBeVisible();
  await expect(page.getByText('Flico found no changes worth recommending. Your workflow is shown unchanged.')).toBeVisible();
  await expect(page.locator('article[data-rec]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Apply reviewed changes/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/09-no-improvements-1536-test-fixture.png` });
});

test('1280px layout and keyboard: review without a mouse', async ({ page }) => {
  await openWorkflow(page, '', { width: 1280, height: 800 });
  await quickAnalysis(page);
  await expect(page.locator('article[data-rec]')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/10-results-1280-test-fixture.png` });

  // Select a recommendation and accept it with the keyboard.
  const title = recCard(page, 'Combine').getByRole('button', { name: /^Combine/ });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(title).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab'); // Details
  await page.keyboard.press('Tab'); // Accept
  await expect(page.getByRole('button', { name: /^Accept: Combine/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(recCard(page, 'Combine')).toContainText('Accepted');
  // Tabs are keyboard reachable.
  await page.getByRole('tab', { name: 'Editor' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Editor', selected: true })).toBeVisible();
});
