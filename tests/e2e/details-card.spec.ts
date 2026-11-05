// Block interactions and the draggable details card with reliable saving: single click selects,
// double-click / Edit details / Enter open the card; card-local save status, Done, and safe switching.
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowDetail } from '../../shared/api';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

/** Double-clicking a step opens Describe; this opens the details card from there. */
const editFieldsMyself = (page: Page) => page.getByRole('button', { name: 'Edit fields myself' }).click();

const SHOTS = 'docs/evidence/details-card';

const step = (page: Page, label: string) => page.locator('[aria-label="Workflow diagram"]').locator('.react-flow__node').filter({ has: page.locator('.fl-node-label', { hasText: new RegExp(`^${label}$`) }) });

const simple: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', label: 'Receive order', position: { x: 288, y: 0 } },
    { id: 'b', type: 'action', label: 'Pack order', position: { x: 576, y: 0 } },
    { id: 'f', type: 'finish', label: 'Shipped', position: { x: 864, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
    { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' },
    { id: 'e3', sourceId: 'b', targetId: 'f', type: 'normal' },
  ],
};

async function open(page: Page, graph: WorkflowGraph, viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('card'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph, baseRevision: 1 } });
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  return workflow.id as string;
}

const stored = async (page: Page, id: string): Promise<WorkflowDetail> => (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow;
const details = (page: Page) => page.getByRole('dialog', { name: 'Edit step' });
/** Duration, tools and notes are folded away under More details until the step has any. */
const openMore = (page: Page) => details(page).getByRole('button', { name: /^More details/ }).click();

test.describe('block interactions', () => {
  test('single click selects; double-click opens Describe (then Edit fields myself); Edit details / Enter open the card', async ({ page }) => {
    await open(page, simple);
    await step(page, 'Receive order').click();
    await expect(details(page)).toHaveCount(0);
    await expect(step(page, 'Receive order').locator('.fl-step')).toHaveAttribute('data-selected', 'true');
    // The toolbar acts on the selection.
    const toolbar = page.getByRole('toolbar', { name: 'Step tools for the selected step' });
    await expect(toolbar.getByRole('button', { name: 'Edit details' })).not.toHaveAttribute('aria-disabled', 'true');
    await toolbar.getByRole('button', { name: 'Edit details' }).click();
    await expect(details(page).getByLabel('Step name')).toHaveValue('Receive order');
    await details(page).getByRole('button', { name: 'Close step details' }).click();

    await step(page, 'Pack order').dblclick();
    await expect(page.getByRole('dialog', { name: 'Describe Pack order' })).toBeVisible();
    await expect(details(page)).toHaveCount(0);
    await editFieldsMyself(page);
    await expect(page.getByTestId('describe-box')).toHaveCount(0);
    await expect(details(page).getByLabel('Step name')).toHaveValue('Pack order');
    await page.keyboard.press('Escape');
    await expect(details(page)).toHaveCount(0);
    await expect(step(page, 'Pack order')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(details(page).getByLabel('Step name')).toHaveValue('Pack order');
  });

  test('the card drags inside the window without moving blocks or adding undo steps', async ({ page }) => {
    const id = await open(page, simple);
    const before = await stored(page, id);
    await step(page, 'Receive order').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    const header = page.getByTestId('details-header');
    const start = (await header.boundingBox())!;
    await page.mouse.move(start.x + 60, start.y + 10);
    await page.mouse.down();
    await page.mouse.move(-400, 2000, { steps: 6 });
    await page.mouse.up();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(76);
    expect(box.x + box.width).toBeLessThanOrEqual(1536);
    expect(box.y).toBeLessThan(960 - 100);
    // Fields still work after dragging; the close control stays reachable.
    await expect(card.getByRole('button', { name: 'Close step details' })).toBeInViewport();
    await page.screenshot({ path: `${SHOTS}/01-details-card-dragged.png` });
    await card.getByRole('button', { name: 'Close step details' }).click();
    expect((await stored(page, id)).graph).toEqual(before.graph);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    // Owner feedback (2026-11-05): a card always opens next to its step, with a pointer to it; a drag lasts until it closes.
    await step(page, 'Pack order').dblclick();
    await editFieldsMyself(page);
    const blockBox = (await step(page, 'Pack order').boundingBox())!;
    const reopened = (await card.boundingBox())!;
    expect(reopened.x).toBeLessThan(blockBox.x + blockBox.width);
    expect(reopened.x + reopened.width).toBeGreaterThan(blockBox.x);
    expect(Math.min(Math.abs(reopened.y - (blockBox.y + blockBox.height)), Math.abs(reopened.y + reopened.height - blockBox.y))).toBeLessThan(24);
    await expect(page.getByTestId('panel-pointer')).toBeVisible();
    // Keyboard alternative: the grip moves the card with arrow keys (and the pointer goes).
    await card.getByRole('button', { name: 'Move step details (arrow keys)' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await card.boundingBox())!.x).toBeGreaterThan(reopened.x + 5);
    await expect(page.getByTestId('panel-pointer')).toHaveCount(0);
    expect((await stored(page, id)).graph).toEqual(before.graph);
  });
});

test.describe('saving block details', () => {
  test('Saved only after persistence; Done closes once saved; edits survive a refresh', async ({ page }) => {
    const id = await open(page, simple);
    await step(page, 'Receive order').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    const status = page.getByTestId('details-save-status');
    await card.getByLabel('Owner / team').fill('Sales desk');
    await expect(status).toHaveAttribute('data-state', 'saving');
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 8000 });
    expect((await stored(page, id)).graph.nodes.find((n) => n.id === 'a')!.owner).toBe('Sales desk');

    await openMore(page);
    await card.getByLabel('Notes').fill('Check the PO number first');
    await card.getByRole('button', { name: 'Done', exact: true }).click(); // saves the pending edit, then closes
    await expect(card).toHaveCount(0);
    expect((await stored(page, id)).graph.nodes.find((n) => n.id === 'a')!.notes).toBe('Check the PO number first');
    // A whole card session is one undo step: one Undo removes both edits, one Redo restores them.
    const fields = async () => {
      const n = (await stored(page, id)).graph.nodes.find((x) => x.id === 'a')!;
      return [n.owner ?? '', n.notes ?? ''];
    };
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(fields, { timeout: 8000 }).toEqual(['', '']);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(fields, { timeout: 8000 }).toEqual(['Sales desk', 'Check the PO number first']);
    await page.reload();
    await step(page, 'Receive order').dblclick();
    await editFieldsMyself(page);
    await openMore(page);
    await expect(details(page).getByLabel('Notes')).toHaveValue('Check the PO number first');
    await expect(details(page).getByLabel('Owner / team')).toHaveValue('Sales desk');
  });

  test('a failed save keeps the card open with the draft and Retry', async ({ page }) => {
    const id = await open(page, simple);
    let failing = true;
    await page.route('**/api/workflows/*/graph', (route) =>
      failing ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'server_error', message: 'Flico is not responding right now.' } }) }) : route.continue(),
    );
    await step(page, 'Pack order').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    await openMore(page);
    await card.getByLabel('Tools / software').fill('Shipping portal');
    await card.getByRole('button', { name: 'Done', exact: true }).click();
    const status = page.getByTestId('details-save-status');
    await expect(status).toHaveAttribute('data-state', 'error');
    await expect(status).toContainText('Could not save');
    await expect(status).toContainText('Your changes are kept here.');
    await expect(card.getByLabel('Tools / software')).toHaveValue('Shipping portal');
    await page.screenshot({ path: `${SHOTS}/02-details-save-failed.png` });
    failing = false;
    await status.getByRole('button', { name: 'Retry' }).click();
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 8000 });
    await card.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(card).toHaveCount(0);
    expect((await stored(page, id)).graph.nodes.find((n) => n.id === 'b')!.tools).toEqual(['Shipping portal']);
  });

  test('switching blocks and slow saves never put an edit on the wrong block', async ({ page }) => {
    const id = await open(page, simple);
    // Slow saves: each takes a while, so responses arrive after the next edits.
    await page.route('**/api/workflows/*/graph', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    // (The card opens to the right of its step, so switch to the step on the left.)
    await step(page, 'Pack order').dblclick();
    await editFieldsMyself(page);
    await openMore(page);
    await details(page).getByLabel('Notes').fill('Note for packing');
    await step(page, 'Receive order').dblclick(); // switch straight away
    await editFieldsMyself(page);
    await expect(details(page).getByLabel('Step name')).toHaveValue('Receive order');
    await openMore(page);
    await details(page).getByLabel('Notes').fill('Note for receiving');
    await details(page).getByRole('button', { name: 'Done', exact: true }).click();
    await expect(details(page)).toHaveCount(0, { timeout: 10000 });
    await expect
      .poll(async () => (await stored(page, id)).graph.nodes.filter((n) => n.notes).map((n) => [n.id, n.notes]), { timeout: 10000 })
      .toEqual([
        ['a', 'Note for receiving'],
        ['b', 'Note for packing'],
      ]);
  });
});


test.describe('compact card layout', () => {
  const CARD_SHOTS = 'docs/evidence/step-card';
  const detailed: WorkflowGraph = {
    nodes: [
      { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
      { id: 'a', type: 'action', label: 'Receive order', position: { x: 288, y: 0 } },
      { id: 'b', type: 'approval', label: 'Manager approves', owner: 'Finance', duration: { value: 2, unit: 'days' }, tools: ['ERP'], notes: 'Over 5000 only', position: { x: 576, y: 0 } },
      { id: 'd', type: 'decision', label: 'Check stock', position: { x: 864, y: 0 } },
      { id: 'f', type: 'finish', label: 'Shipped', position: { x: 1152, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
      { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' },
      { id: 'e3', sourceId: 'b', targetId: 'd', type: 'normal' },
      { id: 'e4', sourceId: 'd', targetId: 'f', type: 'normal', label: 'Yes', branchGroupId: 'd' },
    ],
  };

  test('header shows type, name and save state; Type and Owner shown; the rest folds with a summary', async ({ page }) => {
    await open(page, detailed);
    await step(page, 'Receive order').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    const header = page.getByTestId('details-header');
    await expect(header.getByLabel('Step name')).toHaveValue('Receive order');
    await expect(page.getByTestId('details-save-status')).toContainText('Action');
    await expect(card.getByLabel('Type')).toBeVisible();
    await expect(card.getByLabel('Owner / team')).toBeVisible();
    // A step without duration, tools or notes keeps them folded; connections are folded with a summary.
    const more = card.getByRole('button', { name: /^More details/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toContainText('Duration, tools, notes');
    await expect(card.getByLabel('Notes')).toHaveCount(0);
    const connections = card.getByRole('button', { name: /^Connections/ });
    await expect(connections).toHaveAttribute('aria-expanded', 'false');
    await expect(connections).toContainText('→ Manager approves');
    await page.screenshot({ path: `${CARD_SHOTS}/01-compact-card-1536.png` });

    // Changing the type updates the header straight away.
    await card.getByLabel('Type').selectOption('Wait');
    await expect(page.getByTestId('details-save-status')).toContainText('Wait');
    await card.getByRole('button', { name: 'Done', exact: true }).click();

    // More details always starts folded, even when the step has details; the summary shows what's inside.
    await step(page, 'Manager approves').dblclick();
    await editFieldsMyself(page);
    await expect(card.getByRole('button', { name: /^More details/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(card.getByRole('button', { name: /^More details/ })).toContainText('2 days · ERP · Notes');
    await openMore(page);
    await expect(card.getByLabel('Notes')).toHaveValue('Over 5000 only');
    await page.screenshot({ path: `${CARD_SHOTS}/02-more-details-open-1536.png` });
    await card.getByRole('button', { name: 'Close step details' }).click();

    // A decision with a path still to set opens Connections by itself.
    await step(page, 'Check stock').dblclick();
    await editFieldsMyself(page);
    await expect(card.getByRole('button', { name: /^Connections/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(card).toContainText('No path: not set yet');
  });

  test('tools are tags: Enter or a comma adds, × and Backspace remove, a half-typed tool is still saved', async ({ page }) => {
    const id = await open(page, detailed);
    await step(page, 'Receive order').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    await openMore(page);
    const tools = card.getByLabel('Tools / software');
    await tools.fill('ERP');
    await tools.press('Enter');
    await tools.fill('Excel, Email');
    await expect(card.getByRole('button', { name: 'Remove ERP' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Remove Email' })).toBeVisible();
    await expect.poll(async () => (await stored(page, id)).graph.nodes.find((n) => n.id === 'a')!.tools, { timeout: 8000 }).toEqual(['ERP', 'Excel', 'Email']);
    await card.getByRole('button', { name: 'Remove Excel' }).click();
    await tools.press('Backspace'); // empty input: removes the last tag
    await expect.poll(async () => (await stored(page, id)).graph.nodes.find((n) => n.id === 'a')!.tools, { timeout: 8000 }).toEqual(['ERP']);
    await tools.fill('Shipping portal'); // not confirmed with Enter
    await page.screenshot({ path: `${CARD_SHOTS}/03-tools-as-tags-1536.png` });
    await card.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(card).toHaveCount(0);
    expect((await stored(page, id)).graph.nodes.find((n) => n.id === 'a')!.tools).toEqual(['ERP', 'Shipping portal']);
  });

  test('1280px: the card fits and Done stays reachable with everything open', async ({ page }) => {
    await open(page, detailed, { width: 1280, height: 720 });
    await step(page, 'Manager approves').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    await openMore(page);
    await card.getByRole('button', { name: /^Connections/ }).click();
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    await card.getByRole('button', { name: 'Done', exact: true }).scrollIntoViewIfNeeded();
    await expect(card.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${CARD_SHOTS}/04-everything-open-1280.png` });
  });
});

test.describe('changing a decision into another type', () => {
  const decided: WorkflowGraph = {
    nodes: [
      { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
      { id: 'd', type: 'decision', label: 'Check stock', position: { x: 288, y: 0 } },
      { id: 'r', type: 'action', label: 'Reserve items', position: { x: 576, y: -120 } },
      { id: 'o', type: 'action', label: 'Reorder', position: { x: 576, y: 120 } },
      { id: 'f', type: 'finish', label: 'Shipped', position: { x: 864, y: 0 } },
    ],
    edges: [
      { id: 'e1', sourceId: 's', targetId: 'd', type: 'normal' },
      { id: 'e2', sourceId: 'd', targetId: 'r', type: 'yes', label: 'Yes', branchGroupId: 'd' },
      { id: 'e3', sourceId: 'd', targetId: 'o', type: 'no', label: 'No', branchGroupId: 'd' },
      { id: 'e4', sourceId: 'r', targetId: 'f', type: 'normal' },
      { id: 'e5', sourceId: 'o', targetId: 'f', type: 'normal' },
    ],
  };

  test('asks which path to keep; Cancel changes nothing; the change saves and one Undo restores the decision', async ({ page }) => {
    const id = await open(page, decided);
    await step(page, 'Check stock').dblclick();
    await editFieldsMyself(page);
    const card = details(page);
    await card.getByLabel('Type').selectOption('Action');
    const choice = card.getByRole('group', { name: /Which path should it keep/ });
    await expect(choice).toContainText('An action has one way on');
    await expect(choice.getByRole('radio', { name: 'Yes → Reserve items' })).toBeChecked();
    await choice.getByRole('button', { name: 'Cancel' }).click();
    await expect(choice).toHaveCount(0);
    await expect(card.getByLabel('Type')).toHaveValue('decision');

    await card.getByLabel('Type').selectOption('Approval');
    await choice.getByRole('radio', { name: 'No → Reorder' }).check();
    await page.screenshot({ path: 'docs/evidence/step-card/05-decision-keep-which-path-1536.png' });
    await choice.getByRole('button', { name: 'Change to Approval' }).click();
    await expect(page.getByTestId('details-save-status')).toContainText('Approval');
    await expect(page.getByTestId('details-save-status')).toHaveAttribute('data-state', 'saved', { timeout: 8000 });
    const g = (await stored(page, id)).graph;
    expect(g.nodes.find((n) => n.id === 'd')!.type).toBe('approval');
    expect(g.edges.filter((e) => e.sourceId === 'd')).toEqual([{ id: 'e3', sourceId: 'd', targetId: 'o', type: 'normal' }]);
    // The dropped path's steps stay on the canvas, flagged as no longer connected.
    await expect(step(page, 'Reserve items')).toBeVisible();

    await card.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(async () => {
        const back = (await stored(page, id)).graph;
        return [back.nodes.find((n) => n.id === 'd')!.type, back.edges.filter((e) => e.sourceId === 'd').map((e) => e.type).sort()];
      }, { timeout: 8000 })
      .toEqual(['decision', ['no', 'yes']]);
  });
});

test('a long step name wraps in the card header and is shown in full', async ({ page }) => {
  const long = 'Check the supplier invoice against the purchase order and the delivery note';
  const id = await open(page, simple);
  await step(page, 'Receive order').dblclick();
  await editFieldsMyself(page);
  const name = details(page).getByLabel('Step name');
  await name.fill(long);
  await name.press('Enter'); // finishes the name, never adds a line break
  await expect(name).toHaveValue(long);
  // Every line is visible: the box is as tall as its content, and taller than one line.
  const fits = await name.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.clientHeight > 40);
  expect(fits).toBe(true);
  await expect(page.getByTestId('details-save-status')).toBeInViewport();
  await page.screenshot({ path: 'docs/evidence/step-card/06-long-name-wraps-1536.png' });
  await expect.poll(async () => (await stored(page, id)).graph.nodes.find((n) => n.id === 'a')!.label, { timeout: 8000 }).toBe(long);
});
