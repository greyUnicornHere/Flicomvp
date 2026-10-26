import { expect, test, type Page } from '@playwright/test';
import { signIn, uniqueEmail } from './helpers';

async function seed(page: Page, count: number) {
  for (let i = 1; i <= count; i++) {
    const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
    await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: `Workflow ${String(i).padStart(2, '0')}` } });
  }
}

/** The open menu is fully inside the visible window, without the page needing to scroll. */
async function expectMenuFullyVisible(page: Page) {
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  // Both options can actually be clicked where they are (not hidden behind or clipped by anything).
  for (const name of ['Rename', 'Delete']) {
    const item = page.getByRole('menuitem', { name });
    const b = (await item.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="menuitem"]')?.textContent, [b.x + b.width / 2, b.y + b.height / 2]);
    expect(hit).toBe(name);
  }
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1536, height: 864 }]) {
  test(`row ⋯ menu stays fully on screen near the bottom edge (${viewport.width}×${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, uniqueEmail('menu'));
    await seed(page, 3);
    await page.reload();
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(3);

    // Scroll so the last row sits right at the bottom of the window, as when browsing a list.
    const lastRow = page.getByRole('table').locator('tbody tr').last();
    await lastRow.evaluate((row) => row.scrollIntoView({ block: 'end' }));
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await lastRow.getByRole('button', { name: /^Actions for/ }).click();
    await expectMenuFullyVisible(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.screenshot({ path: `docs/evidence/m1/10-row-menu-near-bottom-${viewport.width}.png` });

    // Keyboard still works from the repositioned menu.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
}
