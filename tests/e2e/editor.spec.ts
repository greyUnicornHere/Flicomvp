import { expect, test, type Page } from '@playwright/test';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/m2';

// ---------- helpers ----------

async function openNewWorkflow(page: Page, viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('editor'));
  await page.getByRole('button', { name: /Build manually/ }).click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/);
  await expect(step(page, 'Start')).toBeVisible();
  return page.url().split('/').pop()!;
}

/** Open an existing workflow with a deterministic graph saved through the real API. */
async function openWithGraph(page: Page, graph: WorkflowGraph, viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('fixture'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  const saved = await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph, baseRevision: 1 } });
  expect(saved.status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  return workflow.id as string;
}

const step = (page: Page, name: string) => page.locator('.react-flow__node').filter({ hasText: new RegExp(`^${escape(name)}$`) });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function stored(page: Page, id: string): Promise<WorkflowGraph> {
  return (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow.graph;
}

/** Saved connections as readable text, e.g. "Start → Receive order", "In stock? -yes-> Reserve". */
async function connections(page: Page, id: string): Promise<string[]> {
  const g = await stored(page, id);
  const name = (nid: string) => g.nodes.find((n) => n.id === nid)?.label ?? '?';
  return g.edges.map((e) => `${name(e.sourceId)} ${e.type === 'normal' ? '→' : `-${e.type}->`} ${name(e.targetId)}`).sort();
}

/** Wait until autosave has stored exactly these connections. */
const expectSaved = (page: Page, id: string, expected: string[]) =>
  expect.poll(() => connections(page, id), { timeout: 8000 }).toEqual([...expected].sort());

async function addAfter(page: Page, label: string, type: string, name?: string) {
  await page.getByRole('button', { name: `Add a step after “${label}”` }).click();
  await page.getByRole('menuitem', { name: type, exact: true }).click();
  if (name !== undefined) {
    const input = page.getByRole('textbox', { name: 'Step name' });
    await expect(input).toBeFocused();
    await input.fill(name);
    await input.press('Enter');
  }
}

async function selectOnly(page: Page, name: string) {
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await step(page, name).click();
  await page.keyboard.press('Escape'); // close the details, keep the selection
}

async function addDecisionAfter(page: Page, name: string, question: string, yes?: string, no?: string) {
  await selectOnly(page, name);
  await page.getByRole('toolbar').getByRole('button', { name: 'Add decision' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a decision' });
  await dialog.getByLabel('Decision question').fill(question);
  if (yes) await dialog.getByLabel('If yes, what happens next?').fill(yes);
  if (no) await dialog.getByLabel('If no, what happens next?').fill(no);
  await dialog.getByRole('button', { name: 'Add decision' }).click();
  await expect(dialog).toHaveCount(0);
}

const node = (id: string, type: WorkflowGraph['nodes'][number]['type'], label: string, x = 0, y = 0) => ({ id, type, label, position: { x, y } });

// ---------- tests ----------

test('E01/E02: Start only, then + inserts an Action with its name ready to edit', async ({ page }) => {
  const id = await openNewWorkflow(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add a step after “Start”' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/01-start-only-1536.png` });

  await page.getByRole('button', { name: 'Add a step after “Start”' }).click();
  const menu = page.getByRole('menu', { name: 'Add a step' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Action', 'Decision', 'Approval', 'Wait', 'Finish']);
  // AI Quick Add (Milestone 3) sits under the manual types.
  await expect(menu.getByRole('textbox', { name: 'Quick Add with AI' })).toBeEnabled();
  await expect(menu).toContainText('Press Enter to add it right away. You can undo.');
  await page.screenshot({ path: `${SHOTS}/02-insert-menu-1536.png` });
  await menu.getByRole('menuitem', { name: 'Action' }).click();

  const name = page.getByRole('textbox', { name: 'Step name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('New action');
  await name.fill('Receive order');
  await name.press('Enter');
  await expectSaved(page, id, ['Start → Receive order']);
  expect((await stored(page, id)).nodes.some((n) => n.type === 'finish')).toBe(false); // Finish never auto-created
});

test('inserting on a connection with its hover +', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order', 288), node('b', 'action', 'Ship', 576)],
    edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' }, { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' }],
  });
  // Point at the middle of the connection between the two steps.
  const a = (await step(page, 'Receive order').boundingBox())!;
  const b = (await step(page, 'Ship').boundingBox())!;
  await page.mouse.move((a.x + a.width + b.x) / 2, a.y + a.height / 2);
  const plus = page.getByRole('button', { name: 'Add a step between “Receive order” and “Ship”' });
  await expect(plus).toBeVisible();
  await plus.click();
  await expect(page.getByRole('menuitem', { name: 'Finish' })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('menuitem', { name: 'Approval' }).click();
  await page.getByRole('textbox', { name: 'Step name' }).fill('Manager approves');
  await page.keyboard.press('Enter');
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Manager approves', 'Manager approves → Ship']);
});

test('E03/E04: decision with two independent outcomes, then the paths merge at Finish', async ({ page }) => {
  const id = await openNewWorkflow(page);
  await addAfter(page, 'Start', 'Action', 'Receive order');
  await addDecisionAfter(page, 'Receive order', 'Item in stock?', 'Confirm order', 'Request restock');
  await expectSaved(page, id, [
    'Start → Receive order',
    'Receive order → Item in stock?',
    'Item in stock? -yes-> Confirm order',
    'Item in stock? -no-> Request restock',
  ]);
  const g = await stored(page, id);
  const decision = g.nodes.find((n) => n.type === 'decision')!;
  expect(g.edges.filter((e) => e.sourceId === decision.id).map((e) => [e.label, e.branchGroupId])).toEqual(
    expect.arrayContaining([['Yes', decision.id], ['No', decision.id]]),
  );

  await addAfter(page, 'Confirm order', 'Finish');
  await step(page, 'Request restock').click();
  await page.getByRole('dialog', { name: 'Edit step' }).getByRole('button', { name: 'Connect to a step…' }).click();
  const connect = page.getByRole('dialog', { name: 'Connect to a step' });
  await expect(connect.getByRole('combobox').locator('option:checked')).toHaveText('Finish'); // suggested join
  await connect.getByRole('button', { name: 'Connect' }).click();
  await expectSaved(page, id, [
    'Start → Receive order',
    'Receive order → Item in stock?',
    'Item in stock? -yes-> Confirm order',
    'Item in stock? -no-> Request restock',
    'Confirm order → Finish',
    'Request restock → Finish',
  ]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /issue/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/03-decision-merge-1536.png` });
});

test('E05: a branch can end independently (no forced reconnection)', async ({ page }) => {
  const id = await openNewWorkflow(page);
  await addDecisionAfter(page, 'Start', 'Payment received?', 'Ship order', 'Cancel order');
  await addAfter(page, 'Ship order', 'Finish');
  await expectSaved(page, id, ['Start → Payment received?', 'Payment received? -yes-> Ship order', 'Payment received? -no-> Cancel order', 'Ship order → Finish']);
  await expect(page.getByRole('button', { name: /issue/ })).toHaveCount(0);
});

test('E06/E07/E08: loop, parallel with wait-for-all, and exception persist after reload', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [
      node('s', 'start', 'Start'),
      node('pay', 'action', 'Charge payment', 288),
      node('d', 'decision', 'Approved?', 576),
      node('ok', 'action', 'Confirm order', 864, -64),
      node('fix', 'action', 'Request correction', 864, 64),
      node('f', 'finish', 'Finish', 1152, -64),
    ],
    edges: [
      { id: 'e1', sourceId: 's', targetId: 'pay', type: 'normal' },
      { id: 'e2', sourceId: 'pay', targetId: 'd', type: 'normal' },
      { id: 'e3', sourceId: 'd', targetId: 'ok', type: 'yes', label: 'Yes', branchGroupId: 'd' },
      { id: 'e4', sourceId: 'd', targetId: 'fix', type: 'no', label: 'No', branchGroupId: 'd' },
      { id: 'e5', sourceId: 'ok', targetId: 'f', type: 'normal' },
    ],
  });

  // Loop: Request correction → back to Approved?
  await selectOnly(page, 'Request correction');
  await page.getByRole('toolbar').getByRole('button', { name: 'Repeat earlier step' }).click();
  const loop = page.getByRole('dialog', { name: 'Repeat an earlier step' });
  await loop.getByLabel('Go back to').selectOption({ label: 'Approved?' });
  await loop.getByLabel('When does it repeat?').fill('After correction');
  await loop.getByRole('button', { name: 'Add repeat' }).click();

  // Parallel after Confirm order, all must finish before Finish
  await selectOnly(page, 'Confirm order');
  await page.getByRole('toolbar').getByRole('button', { name: 'Parallel activities' }).click();
  const parallel = page.getByRole('dialog', { name: 'Add parallel activities' });
  await parallel.getByLabel('Activity 1').fill('Prepare invoice');
  await parallel.getByLabel('Activity 2').fill('Pack shipment');
  await expect(parallel.getByRole('checkbox')).toBeChecked();
  await parallel.getByRole('button', { name: 'Add activities' }).click();

  // Exception on Charge payment
  await selectOnly(page, 'Charge payment');
  await page.getByRole('toolbar').getByRole('button', { name: 'Add exception' }).click();
  const exception = page.getByRole('dialog', { name: 'Add an exception' });
  await exception.getByLabel(/What can go wrong/).fill('Payment rejected');
  await exception.getByLabel('What happens then?').fill('Contact customer');
  await exception.getByRole('button', { name: 'Add exception' }).click();

  const expected = [
    'Start → Charge payment',
    'Charge payment → Approved?',
    'Charge payment -exception-> Payment rejected',
    'Payment rejected → Contact customer',
    'Approved? -yes-> Confirm order',
    'Approved? -no-> Request correction',
    'Request correction -loop-> Approved?',
    'Confirm order -parallel-> Prepare invoice',
    'Confirm order -parallel-> Pack shipment',
    'Prepare invoice → All activities complete',
    'Pack shipment → All activities complete',
    'All activities complete → Finish',
  ];
  await expectSaved(page, id, expected);
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.screenshot({ path: `${SHOTS}/04-loop-parallel-exception-1536.png` });

  await page.reload();
  await expect(step(page, 'All activities complete')).toBeVisible();
  await expect(step(page, 'Payment rejected')).toBeVisible();
  await expect(page.locator('.react-flow__edge[aria-label*="repeats"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[aria-label*="exception path"]')).toHaveCount(1);
  expect(await connections(page, id)).toEqual([...expected].sort());
  const g = await stored(page, id);
  const groups = new Set(g.edges.filter((e) => e.type === 'parallel').map((e) => e.branchGroupId));
  expect(groups.size).toBe(1);
  expect(g.nodes.find((n) => n.label === 'All activities complete')?.structure?.joinGroupId).toBe([...groups][0]);
});

test('E09: step details popover — all fields, persists, Escape returns focus', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order', 288)],
    edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' }],
  });
  await step(page, 'Receive order').click();
  const pop = page.getByRole('dialog', { name: 'Edit step' });
  await expect(pop.getByLabel('Step name')).toBeFocused();
  await pop.getByLabel('Type').selectOption('Approval');
  await pop.getByLabel('Owner / team').fill('Sales team');
  await pop.getByLabel('Duration', { exact: true }).fill('5');
  await pop.getByLabel('Duration unit').selectOption('hours');
  await pop.getByLabel(/Tools \/ software/).fill('Order system, Email');
  await pop.getByLabel('Notes').fill('Check the PO number');
  await page.screenshot({ path: `${SHOTS}/05-step-popover-1536.png` });
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="a"]')).toBeFocused();

  await expect
    .poll(async () => (await stored(page, id)).nodes.find((n) => n.id === 'a'), { timeout: 8000 })
    .toMatchObject({ type: 'approval', owner: 'Sales team', duration: { value: 5, unit: 'hours' }, tools: ['Order system', 'Email'], notes: 'Check the PO number' });
  await page.reload();
  await step(page, 'Receive order').click();
  await expect(page.getByRole('dialog', { name: 'Edit step' }).getByLabel('Owner / team')).toHaveValue('Sales team');
});

test('E10/E11/E12: delete shows affected connections; cancel, confirm with reconnect, undo/redo exactly', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order', 288), node('b', 'action', 'Verify stock', 576), node('f', 'finish', 'Finish', 864)],
    edges: [
      { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
      { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' },
      { id: 'e3', sourceId: 'b', targetId: 'f', type: 'normal' },
    ],
  });
  const original = await stored(page, id);

  await step(page, 'Verify stock').click();
  await page.getByRole('dialog', { name: 'Edit step' }).getByRole('button', { name: 'Delete' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete this step?' });
  await expect(dialog.getByRole('listitem')).toHaveText(['Receive order → Verify stock', 'Verify stock → Finish']);
  await expect(dialog.getByRole('checkbox', { name: /Keep the path joined: connect Receive order → Finish/ })).toBeChecked();
  await page.screenshot({ path: `${SHOTS}/06-delete-confirmation-1536.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(step(page, 'Verify stock')).toBeVisible();

  await step(page, 'Verify stock').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete'); // keyboard shortcut on the focused step
  dialog = page.getByRole('dialog', { name: 'Delete this step?' });
  await dialog.getByRole('button', { name: 'Delete step' }).click();
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Finish']);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => stored(page, id).then((g) => ({ nodes: g.nodes.map((n) => n.id).sort(), edges: g.edges.map((e) => `${e.sourceId}>${e.targetId}`).sort() }))).toEqual({
    nodes: original.nodes.map((n) => n.id).sort(),
    edges: original.edges.map((e) => `${e.sourceId}>${e.targetId}`).sort(),
  });
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();

  // Standard shortcuts: Ctrl+Shift+Z redoes, Ctrl+Z undoes (when not typing in a field).
  await page.locator('.react-flow__pane').click({ position: { x: 300, y: 600 } });
  await page.keyboard.press('Control+Shift+z');
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Finish']);
  await page.keyboard.press('Control+z');
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Verify stock', 'Verify stock → Finish']);
});

test('E13: autosave, refresh keeps names, topology and dragged positions; title rename', async ({ page }) => {
  const id = await openNewWorkflow(page);
  await addAfter(page, 'Start', 'Action', 'Receive order');
  await expectSaved(page, id, ['Start → Receive order']);

  const box = (await step(page, 'Receive order').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 190, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await stored(page, id)).nodes.find((n) => n.label === 'Receive order')!.position.y, { timeout: 8000 }).toBeGreaterThan(100);
  const position = (await stored(page, id)).nodes.find((n) => n.label === 'Receive order')!.position;

  await page.getByRole('button', { name: 'Untitled workflow' }).click();
  const title = page.getByRole('textbox', { name: 'Workflow name' });
  await title.fill('Order handling');
  await title.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Order handling' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Order handling' })).toBeVisible();
  await expect(step(page, 'Receive order')).toBeVisible();
  expect((await stored(page, id)).nodes.find((n) => n.label === 'Receive order')!.position).toEqual(position);
  expect(await connections(page, id)).toEqual(['Start → Receive order']);
});

test('E14: a failed save stays visible with Retry and nothing is lost; conflicts never overwrite', async ({ page, context }) => {
  const id = await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order', 288)],
    edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' }],
  });
  await page.route('**/api/workflows/*/graph', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'server_error', message: 'Database unavailable.' } }) }),
  );
  await addAfter(page, 'Receive order', 'Wait', 'Wait for payment');
  const status = page.getByRole('status').filter({ hasText: "Couldn't save" });
  await expect(status).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(status).toBeVisible(); // stays until fixed
  await page.screenshot({ path: `${SHOTS}/07-save-error-retry-1536.png` });
  expect(await connections(page, id)).toEqual(['Start → Receive order']);

  await page.unroute('**/api/workflows/*/graph');
  await status.getByRole('button', { name: 'Retry' }).click();
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Wait for payment']);
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  // Same workflow in a second tab: its save is rejected instead of overwriting newer work.
  const other = await context.newPage();
  await other.setViewportSize({ width: 1536, height: 960 });
  await other.goto(`/workflows/${id}`);
  await expect(step(other, 'Wait for payment')).toBeVisible();
  await addAfter(page, 'Wait for payment', 'Finish');
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Wait for payment', 'Wait for payment → Finish']);
  await addAfter(other, 'Wait for payment', 'Action', 'Archive');
  await expect(other.getByRole('status').filter({ hasText: 'Changed in another tab' })).toBeVisible();
  expect(await connections(page, id)).toEqual(['Start → Receive order', 'Receive order → Wait for payment', 'Wait for payment → Finish'].sort());
});

test('E15: validation marker and header summary point to the same problem', async ({ page }) => {
  const id = await openNewWorkflow(page);
  await addAfter(page, 'Start', 'Action', 'Check order');
  await addDecisionAfter(page, 'Check order', 'Complete?', 'Ship');
  await expectSaved(page, id, ['Start → Check order', 'Check order → Complete?', 'Complete? -yes-> Ship']);

  const summary = page.getByRole('button', { name: '1 issue in this workflow' });
  await expect(summary).toBeVisible();
  const decision = page.locator('.react-flow__node').filter({ hasText: 'Complete?' });
  await expect(decision).toHaveAttribute('aria-label', /Decision step: Complete\?\. “Complete\?” has no No path yet\./);
  await expect(decision.locator('.fl-step-issue')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add the No path of “Complete?”' })).toBeVisible();

  await summary.click();
  await expect(page.getByRole('menuitem', { name: 'Suggest fix with AI' })).not.toHaveAttribute('aria-disabled', 'true');
  await page.screenshot({ path: `${SHOTS}/08-validation-summary-1536.png` });
  await page.getByRole('menuitem', { name: '“Complete?” has no No path yet.' }).click();
  await expect(decision).toBeFocused();

  // Fix it manually from the open No path.
  await page.getByRole('button', { name: 'Add the No path of “Complete?”' }).click();
  await page.getByRole('menuitem', { name: 'Action' }).click();
  await page.getByRole('textbox', { name: 'Step name' }).fill('Ask for details');
  await page.keyboard.press('Enter');
  await expect(summary).toHaveCount(0);

  // Pre-analysis check behind Analyze; Quick and Guided analysis are offered once it passes (Milestone 4).
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByRole('menu', { name: 'Analyze' })).toContainText('This workflow is ready for analysis.');
  await expect(page.getByRole('menuitem', { name: 'Quick Analysis' })).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ask Flico' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
});

test('E16: pan, zoom, fit and auto-arrange never change connections', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start', 0, 0), node('a', 'action', 'A', 900, 400), node('b', 'action', 'B', 40, 300)],
    edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' }, { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' }],
  });
  const before = await connections(page, id);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.mouse.wheel(0, 300);
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await expect.poll(async () => (await stored(page, id)).nodes.map((n) => n.position.y)).toEqual([0, 0, 0]);
  expect(await connections(page, id)).toEqual(before);
});

test('E17: keyboard only — details, add, name, delete without a mouse', async ({ page }) => {
  const id = await openNewWorkflow(page);
  const start = page.locator('.react-flow__node').first();
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Edit step' }).getByLabel('Step name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(start).toBeFocused();

  await page.getByRole('button', { name: 'Add a step after “Start”' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Action' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // Approval
  await page.keyboard.press('Enter');
  await page.keyboard.type('Manager approves');
  await page.keyboard.press('Enter');
  await expectSaved(page, id, ['Start → Manager approves']);
  const approval = page.locator('.react-flow__node').filter({ hasText: 'Manager approves' });
  await expect(approval).toBeFocused();

  // The toolbar acts on the selected step and is operable with arrow keys.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('toolbar').getByRole('button', { name: 'Add action' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Add decision' })).toBeFocused();

  await approval.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Delete this step?' })).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expectSaved(page, id, []);
});

test('long names: the block grows so the whole name shows (owner feedback 2026-10-31)', async ({ page }) => {
  const long = 'Check the customer’s purchase order against the signed framework agreement and the regional discount table';
  await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start'), node('a', 'action', long, 288)],
    edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' }],
  });
  const block = page.locator('.react-flow__node[data-id="a"]');
  const size = (await block.boundingBox())!;
  const short = (await page.locator('.react-flow__node[data-id="s"]').boundingBox())!;
  expect(size.width).toBeCloseTo(short.width, 0); // same width, taller
  expect(size.height).toBeGreaterThan(short.height + 40);
  // Nothing is cut off: the label's full text fits inside its box.
  const label = block.locator('.fl-node-label');
  await expect(label).toHaveText(long);
  expect(await label.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).webkitLineClamp !== '2')).toBe(true);
  await expect(block).toHaveAttribute('aria-label', `Action step: ${long}`);
  await block.click();
  await expect(page.getByRole('dialog', { name: 'Edit step' }).getByLabel('Step name')).toHaveValue(long);
  await page.screenshot({ path: 'docs/evidence/feedback-m4/01-long-name-grows-1536.png' });
});

test('Finish is suggested (dismissible), never added automatically', async ({ page }) => {
  const id = await openNewWorkflow(page);
  await addAfter(page, 'Start', 'Action', 'Receive order');
  await expect(page.getByRole('region', { name: 'Suggestion' })).toHaveCount(0);
  await addAfter(page, 'Receive order', 'Action', 'Ship order');
  const suggestion = page.getByRole('region', { name: 'Suggestion' });
  await expect(suggestion).toContainText('Add a Finish step after “Ship order”');
  await suggestion.getByRole('button', { name: 'Add Finish' }).click();
  await expectSaved(page, id, ['Start → Receive order', 'Receive order → Ship order', 'Ship order → Finish']);
  await expect(suggestion).toHaveCount(0);
});

test('E18: 1280px — header fits, floating tools do not cover the diagram', async ({ page }) => {
  await openWithGraph(
    page,
    {
      nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order', 288), node('d', 'decision', 'Item in stock?', 576), node('y', 'action', 'Confirm order', 864, -64), node('n', 'action', 'Request restock', 864, 64), node('f', 'finish', 'Finish', 1152)],
      edges: [
        { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
        { id: 'e2', sourceId: 'a', targetId: 'd', type: 'normal' },
        { id: 'e3', sourceId: 'd', targetId: 'y', type: 'yes', label: 'Yes', branchGroupId: 'd' },
        { id: 'e4', sourceId: 'd', targetId: 'n', type: 'no', label: 'No', branchGroupId: 'd' },
        { id: 'e5', sourceId: 'y', targetId: 'f', type: 'normal' },
        { id: 'e6', sourceId: 'n', targetId: 'f', type: 'normal' },
      ],
    },
    { width: 1280, height: 720 },
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Back to dashboard', 'Undo', 'Redo', 'Ask Flico', 'Analyze', 'Export']) {
    const b = (await page.getByRole(name === 'Back to dashboard' ? 'link' : 'button', { name, exact: true }).first().boundingBox())!;
    expect(b.x + b.width, name).toBeLessThanOrEqual(1280);
    expect(b.y + b.height, name).toBeLessThanOrEqual(76);
  }
  const toolbar = (await page.getByRole('toolbar').boundingBox())!;
  const controls = (await page.getByRole('group', { name: 'Canvas controls' }).boundingBox())!;
  for (const n of await page.locator('.react-flow__node').all()) {
    const b = (await n.boundingBox())!;
    const overlaps = (r: typeof b) => b.x < r.x + r.width && b.x + b.width > r.x && b.y < r.y + r.height && b.y + b.height > r.y;
    expect(overlaps(toolbar), 'toolbar covers a step').toBe(false);
    expect(overlaps(controls), 'controls cover a step').toBe(false);
  }
  await page.screenshot({ path: `${SHOTS}/10-editor-1280.png` });
});

test('opening a workflow never saves it (no phantom edits, no false conflicts)', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order', 288)],
    edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' }],
  });
  const saves: string[] = [];
  page.on('request', (r) => r.url().endsWith('/graph') && saves.push(r.method()));
  await page.reload();
  await expect(step(page, 'Receive order')).toBeVisible();
  await page.waitForTimeout(2000);
  expect(saves).toEqual([]);
  expect((await (await page.request.get(`/api/workflows/${id}`)).json()).workflow.revision).toBe(2);
});

test('adding steps never tidies the layout; only Auto-arrange does (owner feedback)', async ({ page }) => {
  const id = await openWithGraph(page, {
    nodes: [
      node('s', 'start', 'Start', 0, 0),
      node('a', 'action', 'Receive order', 300, 20),
      node('b', 'action', 'Verify stock', 620, 20),
      node('f', 'finish', 'Finish', 940, 0),
      node('x', 'action', 'Archive copy', 310, 400), // placed by hand, not connected to the main path
    ],
    edges: [
      { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
      { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' },
      { id: 'e3', sourceId: 'b', targetId: 'f', type: 'normal' },
    ],
  });
  const positions = async () => Object.fromEntries((await stored(page, id)).nodes.map((n) => [n.label, n.position]));

  // Add after the hand-placed step: nothing else moves.
  await addAfter(page, 'Archive copy', 'Action', 'Notify finance');
  await expect.poll(async () => (await positions())['Notify finance']).toEqual({ x: 310 + 288, y: 400 });
  expect(await positions()).toMatchObject({
    Start: { x: 0, y: 0 },
    'Receive order': { x: 300, y: 20 },
    'Verify stock': { x: 620, y: 20 },
    Finish: { x: 940, y: 0 },
    'Archive copy': { x: 310, y: 400 },
  });

  // Insert on the arrow Receive order → Verify stock: only the steps after it slide right.
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  const a = (await step(page, 'Receive order').boundingBox())!;
  const b = (await step(page, 'Verify stock').boundingBox())!;
  await page.mouse.move((a.x + a.width + b.x) / 2, a.y + a.height / 2);
  await page.getByRole('button', { name: 'Add a step between “Receive order” and “Verify stock”' }).click();
  await page.getByRole('menuitem', { name: 'Approval' }).click();
  await page.getByRole('textbox', { name: 'Step name' }).fill('Manager approves');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await positions())['Manager approves']).toEqual({ x: 588, y: 20 });
  const after = await positions();
  expect(after).toMatchObject({ Start: { x: 0, y: 0 }, 'Receive order': { x: 300, y: 20 }, 'Archive copy': { x: 310, y: 400 }, 'Notify finance': { x: 598, y: 400 } });
  expect(after['Verify stock']).toEqual({ x: 876, y: 20 }); // slid right by exactly the room needed
  expect(after.Finish).toEqual({ x: 1196, y: 0 });
  await page.screenshot({ path: `${SHOTS}/11-no-auto-tidy-1536.png` });

  // Auto-arrange is the only thing that tidies everything.
  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await expect
    .poll(async () => {
      const p = await positions();
      return [p.Start!.x, p['Receive order']!.x, p['Manager approves']!.x, p['Verify stock']!.x, p.Finish!.x];
    })
    .toEqual([0, 288, 576, 864, 1152]); // evenly re-arranged columns
});

test('a long arrow goes around a step that sits in its way (owner feedback)', async ({ page }) => {
  await openWithGraph(page, {
    nodes: [node('s', 'start', 'Start', 0, 0), node('m', 'action', 'Unrelated step', 420, 0), node('f', 'finish', 'Finish', 900, 0)],
    edges: [{ id: 'long', sourceId: 's', targetId: 'f', type: 'normal' }],
  });
  const path = page.locator('.react-flow__edge[data-id="long"] path.react-flow__edge-path');
  await expect(path).toHaveAttribute('d', / Q /); // rounded detour, not a single curve
  // The drawn arrow never passes over the step in between.
  const crosses = await page.evaluate(() => {
    const p = document.querySelector<SVGPathElement>('.react-flow__edge[data-id="long"] path.react-flow__edge-path')!;
    const step = document.querySelector('.react-flow__node[data-id="m"]')!.getBoundingClientRect();
    const m = p.getScreenCTM()!;
    for (let i = 0; i <= 200; i++) {
      const pt = p.getPointAtLength((p.getTotalLength() * i) / 200).matrixTransform(m);
      if (pt.x > step.left && pt.x < step.right && pt.y > step.top && pt.y < step.bottom) return true;
    }
    return false;
  });
  expect(crosses).toBe(false);
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.screenshot({ path: `${SHOTS}/12-long-arrow-detour-1536.png` });

  // Once the step is moved out of the way, the arrow is a simple curve again.
  const box = (await step(page, 'Unrelated step').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect(path).not.toHaveAttribute('d', / Q /);
});
