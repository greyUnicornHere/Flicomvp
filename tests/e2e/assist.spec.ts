// Clarify and briefs: interviews about one step's automation assessment in Ask Flico, one question at
// a time, and the brief that follows. AI output comes from Flico's labelled test fixture, never a live model.
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


const panel = (page: Page) => page.getByTestId('automation-panel');
const card = (page: Page, name: string) => panel(page).locator('li[data-assessment]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) });
const chat = (page: Page) => page.getByRole('dialog', { name: 'Ask Flico' });
const openAutomation = (page: Page) => page.getByRole('tab', { name: /Automation/ }).click();

test('Clarify: Flico asks one question at a time in Ask Flico; answers update the assessment; Skip keeps it open; survives a refresh', async ({ page }) => {
  const id = await analysed(page);
  await openAutomation(page);
  await expect(card(page, 'Send quotation')).toContainText('Next step');
  // A needs-information step can be clarified, but has no brief yet.
  await expect(card(page, 'Send quotation').getByRole('button', { name: /Create .* brief/ })).toHaveCount(0);
  await card(page, 'Send quotation').getByRole('button', { name: 'Clarify “Send quotation”' }).click();

  await expect(chat(page)).toBeVisible();
  await expect(chat(page).getByTestId('interview-banner')).toContainText('Clarifying “Send quotation”');
  const question = chat(page).locator('[data-assist="question"][data-assist-status="pending"]');
  await expect(question).toHaveCount(1);
  await expect(question).toContainText('Where does the information for “Send quotation” come from?');
  await page.screenshot({ path: `${SHOTS}/01-clarify-question-1536-test-fixture.png` });

  await chat(page).getByLabel('Message Ask Flico').fill('From the price list in the ERP. We have API access and the rule is list price minus the agreed discount. Sales checks each one.');
  await chat(page).getByRole('button', { name: 'Send answer' }).click();
  await expect(chat(page).locator('[data-assist="update"]')).toContainText('Send quotation');
  // The assessment moved out of "More information needed".
  await expect(panel(page).getByRole('region', { name: 'More information needed' })).toHaveCount(0);
  await expect(card(page, 'Send quotation')).toContainText('Automate');

  // Skip the next question, if one is open: it stays open in the assessment and is never asked again.
  const next = chat(page).locator('[data-assist="question"][data-assist-status="pending"]');
  if (await next.count()) {
    const asked = await next.innerText();
    await chat(page).getByRole('button', { name: 'Skip for now' }).click();
    await expect(chat(page).locator('[data-assist="question"][data-assist-status="skipped"]')).toContainText(asked.split('\n').at(-1)!.slice(0, 20));
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await openAutomation(page);
  await expect(panel(page).getByRole('region', { name: 'More information needed' })).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/workflows/${id}/chat`)).json()).messages;
  expect(saved.some((m: { assist?: { kind: string } }) => m.assist?.kind === 'answer')).toBe(true);
  expect((await (await page.request.get('/api/credits')).json()).balance).toBe(9);
});

test('a brief: a short interview, then a saved brief with fixed sections, readable later; outdated steps are blocked', async ({ page }) => {
  const id = await analysed(page);
  await openAutomation(page);
  await card(page, 'Compare supplier quotations').getByRole('button', { name: 'Create assist brief for “Compare supplier quotations”' }).click();
  await expect(chat(page).getByTestId('interview-banner')).toContainText('Planning “Compare supplier quotations”');
  for (let i = 0; i < 6; i++) {
    const open = chat(page).locator('[data-assist="question"][data-assist-status="pending"]');
    if ((await open.count()) === 0) break;
    await page.screenshot({ path: `${SHOTS}/02-brief-interview-1536-test-fixture.png` });
    if (i === 1) await chat(page).getByRole('button', { name: 'Skip for now' }).click();
    else {
      await chat(page).getByLabel('Message Ask Flico').fill(`The engineer reviews the comparison and picks the supplier (${i + 1}).`);
      await chat(page).getByRole('button', { name: 'Send answer' }).click();
    }
    await expect(chat(page).getByRole('button', { name: 'Send answer' }).or(chat(page).locator('[data-assist="brief"]')).first()).toBeVisible();
  }
  await expect(chat(page).locator('[data-assist="brief"]')).toContainText('assist brief');
  await expect(chat(page).getByTestId('interview-banner')).toHaveCount(0);

  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await openAutomation(page);
  await card(page, 'Compare supplier quotations').getByRole('button', { name: 'View assist brief for “Compare supplier quotations”' }).click();
  const brief = page.getByRole('dialog', { name: /Assist brief · Compare supplier quotations/ });
  await expect(brief).toBeVisible();
  for (const heading of ['Goal', 'What gets automated', 'Where a person checks or decides', 'Handover', 'Systems and access needed', 'How to test it', 'Risks', 'Assumptions to confirm']) {
    await expect(brief.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(brief).toContainText('Unanswered');
  await expect(brief).toContainText("Flico doesn't build, connect or test automations");
  await expect(brief.getByRole('button', { name: 'Copy as text' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-assist-brief-1536-test-fixture.png` });
  await brief.getByRole('button', { name: 'Close' }).click();

  // A step that changed since the analysis can't be clarified or planned until it's reassessed.
  const current = (await (await page.request.get(`/api/workflows/${id}`)).json()).workflow as WorkflowDetail;
  const changed = { ...current.graph, nodes: current.graph.nodes.map((n) => (n.id === 'inspect' ? { ...n, notes: 'A photo is enough now.' } : n)) };
  expect((await page.request.put(`/api/workflows/${id}/graph`, { data: { graph: changed, baseRevision: current.revision } })).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Analysis' }).click();
  await openAutomation(page);
  await expect(card(page, 'Check delivery').getByRole('button', { name: 'Clarify “Check delivery”' })).toBeDisabled();
  await expect(card(page, 'Check delivery')).toContainText('run a new analysis first');
});
