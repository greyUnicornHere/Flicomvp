// Clarify and briefs: interviews about one step's automation assessment inside its Action plan card, one
// question at a time with suggested answers, and the brief that follows. AI output comes from Flico's labelled
// test fixture, never a live model.
import { expect, test, type Page } from '@playwright/test';
import type { WorkflowDetail } from '../../shared/api';
import type { WorkflowGraph } from '../../shared/graph';
import { signIn, uniqueEmail } from './helpers';

const SHOTS = 'docs/evidence/clarify-briefs';

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
  await signIn(page, uniqueEmail('assist'));
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
const card = (page: Page, name: string) => panel(page).locator('li[data-assessment]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Ask Flico' });
const openAutomation = (page: Page) => panel(page).getByRole('button', { name: /^Automation \(\d+\)$/ }).click();

test('Clarify inside the card: one question at a time with suggested answers; answers update the assessment; Skip keeps it open; not in Ask Flico', async ({ page }) => {
  const id = await analysed(page);
  await openAutomation(page);
  const quote = card(page, 'Send quotation');
  await expect(quote).toContainText('Next:');
  // A needs-information step can be clarified, but has no brief yet.
  await expect(quote.getByRole('button', { name: /Create .* brief/ })).toHaveCount(0);
  await quote.getByRole('button', { name: 'Clarify “Send quotation”' }).click();

  // The questions appear inside the card; no chat window opens.
  const panel = quote.getByTestId('interview-panel');
  await expect(panel).toContainText('Where does the information for “Send quotation” come from?');
  await expect(panel).toContainText('question 1 of up to 5');
  await expect(chat(page)).toHaveCount(0);
  const choices = panel.getByRole('radiogroup', { name: 'Suggested answers' }).getByRole('radio');
  await expect(choices).toHaveCount(3);
  await expect(panel.getByRole('button', { name: /^Answer/ })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/01-clarify-question-1536-test-fixture.png` });

  // Type your own answer ("Other").
  await panel.getByLabel('Other answer').fill('From the price list in the ERP. We have API access and the rule is list price minus the agreed discount. Sales checks each one.');
  await panel.getByRole('button', { name: /^Answer/ }).click();
  // The assessment moved out of "More information needed" and shows as clarified.
  await expect(quote).not.toContainText('Needs info');
  await expect(quote.getByTestId('stage-track')).toHaveAttribute('aria-label', 'Progress: Clarified (step 2 of 3)');

  // Next question: pick a suggested answer.
  await expect(panel).toContainText('question 2 of up to 5');
  await choices.first().click();
  await expect(choices.first()).toHaveAttribute('aria-checked', 'true');
  await quote.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'docs/evidence/action-plan/07-clarify-inline-1536-test-fixture.png' });
  await panel.getByRole('button', { name: /^Answer/ }).click();

  // Skip whatever is left: skipped questions stay open and are never asked again.
  const outcome = quote.getByTestId('interview-outcome');
  for (let i = 0; i < 5 && !(await outcome.isVisible()); i++) {
    await expect(panel.getByRole('button', { name: 'Skip for now' }).or(outcome)).toBeVisible();
    if (await outcome.isVisible()) break;
    await panel.getByRole('button', { name: 'Skip for now' }).click();
  }
  await expect(outcome).toContainText('Assessment updated');
  await expect(outcome.getByRole('button', { name: 'Create blueprint for “Send quotation”' })).toBeVisible();
  // No brief exists yet, so there is no talk of an outdated one.
  await expect(outcome).not.toContainText('out of date');
  await quote.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'docs/evidence/action-plan/08-clarify-outcome-1536-test-fixture.png' });
  await outcome.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toHaveCount(0);

  // Saved: still clarified after a refresh, and none of it shows in Ask Flico.
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await openAutomation(page);
  await expect(card(page, 'Send quotation')).not.toContainText('Needs info');
  const saved = (await (await page.request.get(`/api/workflows/${id}/chat`)).json()).messages;
  expect(saved.some((m: { assist?: { kind: string } }) => m.assist?.kind === 'answer')).toBe(true);
  await page.getByRole('button', { name: 'Ask Flico' }).click();
  await expect(chat(page)).toBeVisible();
  await expect(chat(page)).not.toContainText('Send quotation');
  expect((await (await page.request.get('/api/credits')).json()).balance).toBe(9);
});

test('support ideas (human-led steps): a few questions inside the card, then they open; saved with fixed sections, readable later; changed steps need Reassess', async ({ page }) => {
  const id = await analysed(page);
  await openAutomation(page);
  const compare = card(page, 'Check delivery');
  await compare.getByRole('button', { name: 'Create support ideas for “Check delivery”' }).click();
  const panel = compare.getByTestId('interview-panel');
  await expect(panel).toHaveAttribute('data-mode', 'brief');
  await expect(panel).toContainText('Questions for the brief');
  const written = page.getByRole('dialog', { name: /Support ideas · Check delivery/ });
  for (let i = 0; i < 6 && !(await written.isVisible()); i++) {
    await expect(panel.getByRole('button', { name: /^Answer/ }).or(written)).toBeVisible();
    if (await written.isVisible()) break;
    if (i === 0) await page.screenshot({ path: `${SHOTS}/02-brief-interview-1536-test-fixture.png` });
    if (i === 1) await panel.getByRole('button', { name: 'Skip for now' }).click();
    else {
      await panel.getByLabel('Other answer').fill(`Labels are hard to read in the warehouse (${i + 1}).`);
      await panel.getByRole('button', { name: /^Answer/ }).click();
    }
  }
  // The brief opens by itself once written.
  await expect(written).toBeVisible();
  await written.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);

  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await openAutomation(page);
  await expect(card(page, 'Check delivery').getByTestId('stage-track')).toHaveAttribute('aria-label', 'Progress: All stages done');
  // With the ideas ready, viewing them is the only action on the card.
  await expect(card(page, 'Check delivery').getByRole('button', { name: /^Clarify/ })).toHaveCount(0);
  await card(page, 'Check delivery').getByRole('button', { name: 'View support ideas for “Check delivery”' }).click();
  const brief = page.getByRole('dialog', { name: /Support ideas · Check delivery/ });
  await expect(brief).toBeVisible();
  for (const heading of ['Goal', 'Ideas', 'Assumptions to confirm']) {
    await expect(brief.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(brief).toContainText('Unanswered');
  await expect(brief).toContainText("Flico doesn't build, connect or test automations");
  await expect(brief.getByRole('button', { name: 'Copy as text' })).toBeVisible();
  // A long brief scrolls inside the window: its title and buttons stay on screen.
  const box = (await brief.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(960);
  await expect(brief.getByRole('button', { name: 'Close' })).toBeInViewport();
  await expect(brief.getByRole('heading', { level: 2 })).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/03-assist-brief-1536-test-fixture.png` });
  // In a small window the brief scrolls inside the dialog; the title and the buttons stay on screen.
  await page.setViewportSize({ width: 1280, height: 400 });
  await expect(brief.getByRole('button', { name: 'Close' })).toBeInViewport();
  await expect(brief.getByRole('heading', { level: 2 })).toBeInViewport();
  expect(await brief.getByTestId('modal-body').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 1536, height: 960 });
  await brief.getByRole('button', { name: 'Close' }).click();

  // A step that changed since the analysis must be reassessed first (no credit); a step fed by it only gets a note.
  const current = (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow as WorkflowDetail;
  const changed = { ...current.graph, nodes: current.graph.nodes.map((n) => (n.id === 'inspect' ? { ...n, notes: 'A photo is enough now.' } : n)) };
  expect((await page.request.put(`/api/workflows/${id}/graph`, { data: { graph: changed, baseRevision: current.revision } })).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await openAutomation(page);
  const inspect = card(page, 'Check delivery');
  await expect(inspect).toContainText('Needs reassessment');
  await expect(inspect.getByTestId('freshness-note')).toContainText('Reassess it to continue');
  await expect(inspect.getByRole('button', { name: 'Clarify “Check delivery”' })).toHaveCount(0);
  await expect(card(page, 'Send quotation').getByTestId('freshness-note')).toContainText('An earlier step changed');
  await expect(card(page, 'Send quotation').getByRole('button', { name: 'Clarify “Send quotation”' })).toBeEnabled();
  await inspect.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/evidence/action-plan/06-needs-reassessment-1536-test-fixture.png' });
  await inspect.getByRole('button', { name: 'Reassess “Check delivery”' }).first().click();
  await expect(inspect).not.toContainText('Needs reassessment');
  await expect(inspect.getByTestId('freshness-note')).toHaveCount(0);
  await expect(inspect.getByRole('button', { name: 'Clarify “Check delivery”' })).toBeEnabled();
  expect((await (await page.request.get('/api/credits')).json()).balance).toBe(9);
});
