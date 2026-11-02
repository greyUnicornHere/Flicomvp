// Agent-ready blueprints (assessment page revamp, step 2): questions inside the card, then a full blueprint
// page with what to build, the spec, a readiness check and exports. Advisory only. AI output comes from
// Flico's labelled test fixture (AI_PROVIDER=fixture), never a live model.
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/blueprints';
mkdirSync(SHOTS, { recursive: true });

const graph: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'match', type: 'action', label: 'Match invoice to order', notes: 'Rule: the policy is to match amount and PO number. We have API access to the ERP. Finance can verify every match automatically.', position: { x: 288, y: 0 } },
    { id: 'compare', type: 'action', label: 'Compare supplier quotations', notes: 'The engineer does the technical evaluation and selects the supplier.', position: { x: 576, y: 0 } },
    { id: 'quote', type: 'action', label: 'Send quotation', position: { x: 864, y: 0 } },
    { id: 'f', type: 'finish', label: 'Done', position: { x: 1152, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'match', type: 'normal' },
    { id: 'e2', sourceId: 'match', targetId: 'compare', type: 'normal' },
    { id: 'e3', sourceId: 'compare', targetId: 'quote', type: 'normal' },
    { id: 'e4', sourceId: 'quote', targetId: 'f', type: 'normal' },
  ],
};

async function analysed(page: Page, viewport = { width: 1536, height: 960 }) {
  await page.setViewportSize(viewport);
  await signIn(page, uniqueEmail('blueprint'));
  const { workflow } = await (await page.request.post('/api/workflows', { data: { kind: 'manual' } })).json();
  await page.request.patch(`/api/workflows/${workflow.id}`, { data: { name: 'Purchasing' } });
  expect((await page.request.put(`/api/workflows/${workflow.id}/graph`, { data: { graph, baseRevision: 1 } })).status()).toBe(200);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Analyze' }).click();
  await page.getByRole('menuitem', { name: 'Quick Analysis' }).click();
  await expect(page.getByTestId('action-plan')).toBeVisible();
  await page.getByTestId('action-plan').getByRole('button', { name: /^Automation \(\d+\)$/ }).click();
  return workflow.id as string;
}

const card = (page: Page, id: string) => page.getByTestId('action-plan').locator(`li[data-assessment="${id}"]`);

/** Answer (or skip) the blueprint questions inside the card until the blueprint page opens. */
async function interview(page: Page, id: string, answer: (question: string, i: number) => string | 'skip' | { pick: number }) {
  const panel = card(page, id).getByTestId('interview-panel');
  const done = page.getByTestId('blueprint-page');
  for (let i = 0; i < 8; i++) {
    await expect(panel.getByRole('button', { name: /^Answer/ }).or(done)).toBeVisible();
    if (await done.isVisible()) return;
    const question = (await panel.locator('form p').first().innerText()).trim();
    const reply = answer(question, i);
    if (reply === 'skip') await panel.getByRole('button', { name: 'Skip for now' }).click();
    else if (typeof reply === 'object') {
      await panel.getByRole('radio').nth(reply.pick).click();
      await panel.getByRole('button', { name: /^Answer/ }).click();
    } else {
      await panel.getByLabel(/Other answer|Your answer/).fill(reply);
      await panel.getByRole('button', { name: /^Answer/ }).click();
    }
  }
  await expect(done).toBeVisible();
}

test('a blueprint: questions in the card, then a page with what to build, the spec, readiness and exports', async ({ page }) => {
  await analysed(page);
  const match = card(page, 'match');
  await expect(match.getByTestId('stage-track')).toContainText('Blueprint');
  // The needs-information step can't get a blueprint until it is clarified.
  await expect(card(page, 'quote').getByRole('button', { name: /blueprint/i })).toHaveCount(0);

  await match.getByRole('button', { name: 'Create blueprint for “Match invoice to order”' }).click();
  const panel = match.getByTestId('interview-panel');
  await expect(panel).toHaveAttribute('data-mode', 'blueprint');
  await expect(panel).toContainText('Questions for the blueprint');
  await expect(panel).toContainText('question 1 of up to 6');
  await page.screenshot({ path: `${SHOTS}/01-blueprint-questions-1536-test-fixture.png` });
  await interview(page, 'match', (q) =>
    /rule/i.test(q) ? 'Amount and PO number must match exactly.' : /systems/i.test(q) ? { pick: 0 } : /approve/i.test(q) ? { pick: 0 } : /never/i.test(q) ? 'Never pay an invoice.' : 'Invoice INV-7 for PO-7 is marked matched.',
  );

  // The page opens by itself.
  const bp = page.getByTestId('blueprint-page');
  await expect(bp.getByRole('heading', { level: 1 })).toHaveText('Blueprint · Match invoice to order');
  await expect(bp).toContainText('Test fixture, not a live AI blueprint');
  await expect(bp.getByTestId('build-type')).toHaveText('Rule-based automation');
  await expect(bp.getByRole('region', { name: 'Rules' })).toContainText('Amount and PO number must match exactly.');
  await expect(bp.getByRole('region', { name: 'Never' })).toContainText('Never pay an invoice.');
  await expect(bp.getByRole('region', { name: 'Tools and access' })).toContainText('read_inputs');
  await expect(bp.getByRole('region', { name: 'Test cases' }).getByRole('row')).toHaveCount(3);
  await expect(bp.getByTestId('readiness')).toContainText('Ready to build');
  await page.screenshot({ path: `${SHOTS}/02-blueprint-page-1536-test-fixture.png`, fullPage: true });

  // Exports: the suggested one fits the build type; each is labelled as a starting point.
  const preview = bp.getByTestId('export-preview');
  await expect(bp.getByRole('radio', { name: /n8n \/ Power Automate outline/ })).toHaveAttribute('aria-checked', 'true');
  await expect(bp.getByRole('radio', { name: /n8n \/ Power Automate outline/ })).toContainText('Suggested');
  await expect(preview).toContainText('IF You said: “Amount and PO number must match exactly.”');
  await expect(preview).toContainText('Nothing has been built, connected or tested');
  await bp.getByRole('radio', { name: /Claude agent setup/ }).click();
  await expect(preview).toContainText('## System prompt');
  await expect(preview).toContainText('"name": "read_inputs"');
  const [download] = await Promise.all([page.waitForEvent('download'), bp.getByRole('button', { name: 'Download agent setup' }).click()]);
  expect(download.suggestedFilename()).toBe('match-invoice-to-order-claude-agent.md');
  const saved = readFileSync((await download.path())!, 'utf8');
  expect(saved).toContain('Never pay an invoice.');
  expect(saved).toContain('Test fixture, not a live AI blueprint.');
  await bp.getByRole('radio', { name: /JSON/ }).click();
  expect(JSON.parse(await preview.innerText())).toMatchObject({ format: 'flico-blueprint', buildType: 'rules', readiness: { ready: true } });
  await page.screenshot({ path: `${SHOTS}/03-export-json-1536-test-fixture.png` });

  // Back: the step's journey is complete and View blueprint is its only action.
  await bp.getByRole('button', { name: 'Back to Action plan' }).click();
  await expect(match.getByTestId('stage-track')).toHaveAttribute('aria-label', 'Progress: All stages done');
  await expect(match.getByRole('button', { name: /Clarify|Create/ })).toHaveCount(0);
  await match.getByRole('button', { name: 'View blueprint for “Match invoice to order”' }).click();
  await expect(page.getByTestId('blueprint-page')).toBeVisible();
  expect((await (await page.request.get('/api/credits')).json()).balance).toBe(9);
});

test('an assistant blueprint with gaps: skipped questions stay open and it is not ready; an older brief stays readable', async ({ page }) => {
  const id = await analysed(page);
  // An assist brief written before blueprints existed (through the API, as an older client did).
  const workflow = (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow;
  const [analysis] = (await (await page.request.get(`/api/workflows/${id}/analyses`)).json()).analyses;
  let msg = (await (await page.request.post(`/api/analyses/${analysis.id}/assist`, { data: { stepId: 'compare', mode: 'brief', baseRevision: workflow.revision } })).json()).messages.at(-1);
  for (let i = 0; i < 8 && msg?.assist?.kind === 'question'; i++) {
    msg = (await (await page.request.post(`/api/analyses/${analysis.id}/assist/answer`, { data: { messageId: msg.id, baseRevision: workflow.revision, skip: true } })).json()).messages.at(-1);
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await page.getByTestId('action-plan').getByRole('button', { name: /^Automation \(\d+\)$/ }).click();
  const compare = card(page, 'compare');
  await expect(compare.getByRole('button', { name: 'View assist brief for “Compare supplier quotations”' })).toBeVisible();
  await expect(compare.getByTestId('stage-track')).toHaveAttribute('aria-label', /Assessed/);

  await compare.getByRole('button', { name: 'Create blueprint for “Compare supplier quotations”' }).click();
  await interview(page, 'compare', () => 'skip');
  const bp = page.getByTestId('blueprint-page');
  await expect(bp.getByTestId('build-type')).toHaveText('AI assistant, a person decides');
  await expect(bp.getByTestId('readiness')).toContainText('Not ready yet');
  await expect(bp.getByTestId('readiness').locator('[data-ok="false"]').first()).toBeVisible();
  await expect(bp.getByTestId('open-questions')).toContainText('open question');
  await expect(bp.getByRole('radio', { name: /Claude agent setup/ })).toHaveAttribute('aria-checked', 'true');
  await expect(bp.getByTestId('export-preview')).toContainText('A person makes the decision; you never decide for them.');
  await page.screenshot({ path: `${SHOTS}/04-not-ready-assistant-1536-test-fixture.png`, fullPage: true });
});

test('1280px: the blueprint page stays readable without horizontal scrolling', async ({ page }) => {
  await analysed(page, { width: 1280, height: 800 });
  await card(page, 'match').getByRole('button', { name: 'Create blueprint for “Match invoice to order”' }).click();
  await interview(page, 'match', () => 'skip');
  await expect(page.getByTestId('blueprint-page')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/05-blueprint-page-1280-test-fixture.png` });
});
