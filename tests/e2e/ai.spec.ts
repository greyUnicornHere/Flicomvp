// Milestone 3 end-to-end: AI Create, Quick Add, Ask Flico and AI edit previews.
// The E2E server uses Flico's deterministic test fixture (AI_PROVIDER=fixture), never a live model;
// screenshots are labelled accordingly.
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowDetail } from '../../shared/api';
import { signIn, uniqueEmail } from './helpers';

/** Double-clicking a step opens Describe; this opens the details card from there. */
const editFieldsMyself = (page: Page) => page.getByRole('button', { name: 'Edit fields myself' }).click();

const SHOTS = 'docs/evidence/m3';
const DESCRIPTION =
  'A supplier emails an invoice. Finance checks the invoice against the purchase order. If the amount is over 5000, the department head approves it. Finance pays the supplier.';

const node = (page: Page, label: string) => page.locator('.react-flow__node').filter({ has: page.locator('.fl-node-label', { hasText: new RegExp(`^${escape(label)}$`) }) });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const edgeBadges = (page: Page, change: string) => page.locator(`.react-flow__edgelabel-renderer .fl-diff-badge[data-diff="${change}"]`);
const chat = (page: Page) => page.getByRole('dialog', { name: 'Ask Flico' });

async function stored(page: Page, id: string): Promise<WorkflowDetail> {
  return (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow;
}

async function createDraft(page: Page, description = DESCRIPTION) {
  await page.setViewportSize({ width: 1536, height: 960 });
  await signIn(page, uniqueEmail('ai'));
  await page.getByRole('link', { name: /Create with AI/ }).click();
  await expect(page.getByText(/built-in test fixture instead of a live AI model/)).toBeVisible();
  await page.getByLabel('Describe your workflow').fill(description);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  await expect(node(page, 'Start')).toBeVisible();
  return page.url().split('/').pop()!;
}

test.describe('AI Create', () => {
  test('creates a named draft with inferred steps and assumptions to confirm', async ({ page }) => {
    const id = await createDraft(page);
    await expect(page.getByRole('heading', { level: 1, name: 'A supplier emails an invoice' })).toBeVisible();
    await expect(page.getByText("This draft came from Flico's built-in test fixture, not a live AI model.")).toBeVisible();
    await expect(node(page, 'Process complete').locator('.fl-inferred')).toHaveText('Inferred');
    const assumptions = page.getByRole('region', { name: 'Assumptions' });
    await expect(assumptions.getByText('The process ends once the last described step is done.')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-ai-draft-test-fixture.png` });

    // Confirm the assumption, then confirm the inferred step from its details.
    await assumptions.getByRole('button', { name: 'Confirm' }).click();
    await expect(assumptions.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(assumptions.getByText('all confirmed')).toBeVisible();
    await node(page, 'Process complete').dblclick();
    await editFieldsMyself(page);
    await page.getByRole('button', { name: 'Confirm step' }).click();
    await expect(node(page, 'Process complete').locator('.fl-inferred')).toHaveCount(0);
    await expect.poll(async () => (await stored(page, id)).graph.nodes.find((n) => n.label === 'Process complete')?.assumptionStatus, { timeout: 8000 }).toBe('confirmed');
    expect((await stored(page, id)).assumptions[0]!.status).toBe('confirmed');
  });

  test('keeps a partial draft and offers Retry or Continue editing manually', async ({ page }) => {
    await createDraft(page, `${DESCRIPTION} [fixture:partial]`);
    await expect(page.getByText("Flico couldn't complete this draft.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-partial-draft.png` });
    await page.getByRole('button', { name: 'Continue editing manually' }).click();
    await expect(page.getByText("Flico couldn't complete this draft.")).toHaveCount(0);
    await expect(node(page, 'Start')).toBeVisible();
  });

  test('a failed draft keeps the description and creates nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 960 });
    await signIn(page, uniqueEmail('ai'));
    await page.goto('/create/ai');
    await page.getByLabel('Describe your workflow').fill('Orders arrive [fixture:error]');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('alert')).toContainText("Flico's AI service isn't responding right now");
    await expect(page.getByLabel('Describe your workflow')).toHaveValue('Orders arrive [fixture:error]');
    const list = await (await page.request.get('/api/workflows')).json();
    expect(list.workflows).toEqual([]);
  });
});

test.describe('Ask Flico', () => {
  test('generation → correction → preview → approval, as one undoable change', async ({ page }) => {
    const id = await createDraft(page);
    const before = await stored(page, id);

    await page.getByRole('button', { name: 'Ask Flico' }).click();
    await expect(chat(page)).toBeVisible();
    await chat(page).getByLabel('Message Ask Flico').fill('Add a manager approval after the invoice arrives');
    await chat(page).getByRole('button', { name: 'Send' }).click();

    // Explanation in chat + simultaneous highlighted preview on the canvas; nothing saved yet.
    await expect(chat(page).getByTestId('proposal')).toContainText('Add “Manager approval”');
    await expect(chat(page).getByText('Test fixture, not a live AI response')).toBeVisible();
    const bar = page.getByRole('region', { name: 'Suggested change preview' });
    await expect(bar).toContainText('Steps: 1 added');
    await expect(node(page, 'Manager approval').locator('.fl-diff-badge')).toHaveText('+ Added');
    // The old connection is shown as removed (dashed, badge) and the two new ones as added.
    await expect(edgeBadges(page, 'removed')).toHaveCount(1);
    await expect(edgeBadges(page, 'added')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Add action' })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/03-ask-flico-preview-test-fixture.png` });
    expect((await stored(page, id)).revision).toBe(before.revision);

    await bar.getByRole('button', { name: 'Apply' }).click();
    await expect(bar).toHaveCount(0);
    await expect(chat(page).getByText('Applied')).toBeVisible();
    await expect(node(page, 'Manager approval')).toBeVisible();
    await expect(node(page, 'Manager approval').locator('.fl-diff-badge')).toHaveCount(0);
    const after = await stored(page, id);
    expect(after.revision).toBe(before.revision + 1);
    const label = (nid: string) => after.graph.nodes.find((n) => n.id === nid)?.label;
    expect(after.graph.edges.map((e) => `${label(e.sourceId)} → ${label(e.targetId)}`)).toEqual(
      expect.arrayContaining(['A supplier emails an invoice → Manager approval', 'Manager approval → Finance checks the invoice against the']),
    );
    await page.screenshot({ path: `${SHOTS}/04-applied.png` });

    // One undo removes the whole AI change; autosave keeps the server in step.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(node(page, 'Manager approval')).toHaveCount(0);
    await expect.poll(async () => (await stored(page, id)).graph.nodes.some((n) => n.label === 'Manager approval'), { timeout: 8000 }).toBe(false);
  });

  test('removing a selected step: red preview, Apply, then Undo restores the exact graph', async ({ page }) => {
    const id = await createDraft(page);
    const before = await stored(page, id);
    await node(page, 'Finance checks the invoice against the').dblclick();
    await editFieldsMyself(page);
    await page.getByRole('button', { name: 'Ask Flico about this step' }).click();
    await chat(page).getByLabel('Message Ask Flico').fill('Remove this step');
    await chat(page).getByLabel('Message Ask Flico').press('Enter');
    const bar = page.getByRole('region', { name: 'Suggested change preview' });
    await expect(bar).toContainText('Steps: 1 removed');
    const removed = node(page, 'Finance checks the invoice against the');
    await expect(removed.locator('.fl-diff-badge')).toHaveText('− Removed');
    await expect(removed.locator('.fl-node-label')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(edgeBadges(page, 'added')).toHaveCount(1); // predecessor reconnected to successor
    await expect(edgeBadges(page, 'removed')).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/08-remove-step-preview-test-fixture.png` });

    await bar.getByRole('button', { name: 'Apply' }).click();
    await expect(removed).toHaveCount(0);
    await expect.poll(async () => (await stored(page, id)).graph.nodes.length).toBe(before.graph.nodes.length - 1);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(removed).toBeVisible();
    await expect.poll(async () => (await stored(page, id)).graph, { timeout: 8000 }).toEqual(before.graph);
  });

  test('Cancel discards the preview and leaves the workflow untouched', async ({ page }) => {
    const id = await createDraft(page);
    const before = await stored(page, id);
    await page.getByRole('button', { name: 'Ask Flico' }).click();
    await chat(page).getByLabel('Message Ask Flico').fill('Please add an approval');
    await chat(page).getByLabel('Message Ask Flico').press('Enter');
    const bar = page.getByRole('region', { name: 'Suggested change preview' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar).toHaveCount(0);
    await expect(node(page, 'Manager approval')).toHaveCount(0);
    await expect(chat(page).getByText('Cancelled, nothing changed')).toBeVisible();
    const after = await stored(page, id);
    expect(after.revision).toBe(before.revision);
    expect(after.graph).toEqual(before.graph);
  });

  test('conversation persists per workflow, and Clear History keeps the workflow', async ({ page }) => {
    const id = await createDraft(page);
    await page.getByRole('button', { name: 'Ask Flico' }).click();
    await chat(page).getByRole('button', { name: 'Summarize this workflow' }).click();
    await expect(chat(page).getByText(/This workflow has 5 steps after Start/)).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Ask Flico' }).click();
    await expect(chat(page).getByText(/This workflow has 5 steps after Start/)).toBeVisible();
    const graph = (await stored(page, id)).graph;

    await chat(page).getByRole('button', { name: 'Clear history' }).click();
    await chat(page).getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(chat(page).getByText(/This workflow has/)).toHaveCount(0);
    expect((await (await page.request.get(`/api/workflows/${id}/chat`)).json()).messages).toEqual([]);
    expect((await stored(page, id)).graph).toEqual(graph);
  });

  test('the window is compact, expandable, minimizable, movable and stays on screen', async ({ page }) => {
    await createDraft(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Ask Flico' }).click();
    const box = async () => (await chat(page).boundingBox())!;
    expect(await box()).toMatchObject({ width: 360, height: 460 });
    await chat(page).getByRole('button', { name: 'Expand' }).click();
    expect((await box()).width).toBe(520);
    const inView = async () => {
      const b = await box();
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(64);
      expect(b.x + b.width).toBeLessThanOrEqual(1280);
      expect(b.y + b.height).toBeLessThanOrEqual(800);
    };
    await inView();

    // Drag far off-screen: it stays fully visible.
    const header = chat(page).getByRole('heading', { name: 'Ask Flico' });
    const start = (await header.boundingBox())!;
    await page.mouse.move(start.x + 10, start.y + 10);
    await page.mouse.down();
    await page.mouse.move(-500, 2000, { steps: 5 });
    await page.mouse.up();
    await inView();
    expect((await box()).x).toBeLessThan(20);

    // Keyboard alternative to dragging.
    const handle = chat(page).getByRole('button', { name: 'Move Ask Flico window (arrow keys)' });
    const x = (await box()).x;
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    expect((await box()).x).toBe(x + 16);

    await chat(page).getByRole('button', { name: 'Minimize' }).click();
    expect((await box()).height).toBe(52);
    await chat(page).getByRole('button', { name: 'Restore' }).click();
    await chat(page).getByRole('button', { name: 'Close Ask Flico' }).click();
    await expect(chat(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ask Flico' })).toBeFocused();
  });

  test('asks about a selected step and suggests a fix for validation issues', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 960 });
    await signIn(page, uniqueEmail('fix'));
    await page.getByRole('button', { name: /Build manually/ }).click();
    await expect(node(page, 'Start')).toBeVisible();
    const id = page.url().split('/').pop()!;

    // A decision with both outcomes left open: two validation issues.
    await page.getByRole('button', { name: 'Add a step after “Start”' }).click();
    await page.getByRole('menuitem', { name: 'Decision', exact: true }).click();
    await page.getByLabel('Decision question').fill('Order complete?');
    await page.getByRole('dialog').getByRole('button', { name: 'Add decision' }).click();
    await expect(page.getByRole('button', { name: /2 issues/ })).toBeVisible();

    await node(page, 'Order complete?').dblclick();
    await editFieldsMyself(page);
    await page.getByRole('button', { name: 'Ask Flico about this step' }).click();
    await expect(chat(page).getByText('About:')).toContainText('Order complete?');
    await chat(page).getByRole('button', { name: 'Explain this step' }).click();
    await expect(chat(page).getByText(/You asked about “Order complete\?”/)).toBeVisible();
    await chat(page).getByRole('button', { name: 'Stop asking about this step' }).click();

    await page.getByRole('button', { name: /2 issues/ }).click();
    await page.getByRole('menuitem', { name: 'Suggest fix with AI' }).click();
    const bar = page.getByRole('region', { name: 'Suggested change preview' });
    await expect(bar).toContainText('Steps: 2 added');
    await page.screenshot({ path: `${SHOTS}/05-suggest-fix-preview-test-fixture.png` });
    await bar.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('button', { name: /issues?$/ })).toHaveCount(0);
    await expect.poll(async () => (await stored(page, id)).graph.nodes.length, { timeout: 8000 }).toBe(4);
  });
});

test.describe('AI Quick Add', () => {
  test('inserts the described step immediately, marked inferred, with Undo', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 960 });
    await signIn(page, uniqueEmail('quick'));
    await page.getByRole('button', { name: /Build manually/ }).click();
    await expect(node(page, 'Start')).toBeVisible();
    const id = page.url().split('/').pop()!;

    await page.getByRole('button', { name: 'Add a step after “Start”' }).click();
    const input = page.getByRole('textbox', { name: 'Quick Add with AI' });
    await input.fill('the manager approves the request');
    await page.screenshot({ path: `${SHOTS}/06-quick-add-input.png` });
    await input.press('Enter');
    const added = node(page, 'The manager approves the request');
    await expect(added).toBeVisible();
    await expect(added).toHaveAttribute('aria-label', /Approval step: The manager approves the request\. .*Inferred by Flico/);
    await expect(added.locator('.fl-inferred')).toBeVisible();
    const toast = page.getByRole('status').filter({ hasText: 'with Quick Add (test fixture, not live AI)' });
    await expect(toast).toBeVisible();
    await expect.poll(async () => (await stored(page, id)).graph.nodes.length, { timeout: 8000 }).toBe(2);
    await page.screenshot({ path: `${SHOTS}/07-quick-add-inserted.png` });

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(added).toHaveCount(0);
    await expect.poll(async () => (await stored(page, id)).graph.nodes.length, { timeout: 8000 }).toBe(1);
  });
});
