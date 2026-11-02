// A path back to an earlier step that isn't a Repeat loop (here a decision's "No" going back to
// "Search Amazon") used to leave Auto-arrange with every later step stacked in one column.
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/back-paths';
const node = (id: string, type: WorkflowGraph['nodes'][number]['type'], label: string, x: number, y: number) => ({ id, type, label, position: { x, y } });

// As it came out before the fix: everything but "Search Amazon" stacked in the first column.
const messy: WorkflowGraph = {
  nodes: [
    node('s', 'start', 'Start product search', 0, 0),
    node('a', 'action', 'Search Amazon for products', 288, 256),
    node('d', 'decision', 'Suitable product found?', 0, 128),
    node('f1', 'finish', 'Product list identified', 0, 256),
    node('r', 'action', 'Refine search terms', 0, 384),
    node('d2', 'decision', 'Retry limit reached?', 0, 512),
    node('f2', 'finish', 'No suitable product found', 0, 640),
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
    { id: 'e2', sourceId: 'a', targetId: 'd', type: 'normal' },
    { id: 'e3', sourceId: 'd', targetId: 'f1', type: 'yes', label: 'Yes', branchGroupId: 'd' },
    { id: 'e4', sourceId: 'd', targetId: 'r', type: 'no', label: 'No', branchGroupId: 'd' },
    { id: 'e5', sourceId: 'r', targetId: 'd2', type: 'normal' },
    { id: 'e6', sourceId: 'd2', targetId: 'f2', type: 'yes', label: 'Yes', branchGroupId: 'd2' },
    { id: 'e7', sourceId: 'd2', targetId: 'a', type: 'no', label: 'No', branchGroupId: 'd2' },
  ],
};

const box = (page: Page, id: string) => page.locator(`[aria-label="Workflow diagram"] .react-flow__node[data-id="${id}"]`).boundingBox();

test('Auto-arrange lays a workflow with a path back to an earlier step out left to right, the way back running under the steps', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await signIn(page, uniqueEmail('back'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  expect((await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph: messy, baseRevision: 1 } })).status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-before-1536.png` });

  await page.getByRole('button', { name: 'Auto-arrange' }).click();
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await page.waitForTimeout(500);
  const order = ['s', 'a', 'd', 'r', 'd2', 'f2'];
  const xs = [];
  for (const id of order) xs.push((await box(page, id))!.x);
  expect(xs).toEqual([...xs].sort((p, q) => p - q)); // left to right, in workflow order
  expect(new Set(xs.map(Math.round)).size).toBe(order.length); // never stacked in one column

  // The "No" path back to "Search Amazon" runs below the steps it passes.
  const back = page.locator('[aria-label="Workflow diagram"] .react-flow__edge[aria-label^="Connection from Retry limit reached? to Search Amazon"]');
  const backPath = (await back.locator('.react-flow__edge-path').boundingBox())!;
  const lowest = Math.max(...(await Promise.all(['a', 'd', 'r', 'd2'].map(async (id) => { const b = (await box(page, id))!; return b.y + b.height; }))));
  expect(backPath.y + backPath.height).toBeGreaterThan(lowest);
  await page.screenshot({ path: `${SHOTS}/02-after-auto-arrange-1536.png` });
});
