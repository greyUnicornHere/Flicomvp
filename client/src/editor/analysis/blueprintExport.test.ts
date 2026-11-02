import { describe, expect, it } from 'vitest';
import { blueprintOutdated, readiness, toolName, type Blueprint } from '../../../../shared/blueprint';
import { basesOf } from '../../../../shared/assessment';
import type { WorkflowGraph } from '../../../../shared/graph';
import { defaultFormat, exportClaude, exportFileName, exportJson, exportMarkdown, exportOutline } from './blueprintExport';

const graph: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'm', type: 'action', label: 'Match invoice', position: { x: 200, y: 0 } },
  ],
  edges: [{ id: 'e', sourceId: 's', targetId: 'm', type: 'normal' }],
};

const bp: Blueprint = {
  analysisId: 'a1',
  stepId: 'm',
  classification: 'full',
  buildType: 'agent',
  buildReason: 'Invoices arrive as PDFs that need reading.',
  goal: 'Match each invoice to its order.',
  trigger: 'An invoice arrives in the finance inbox.',
  inputs: ['Invoice PDF', 'Purchase order'],
  tools: [
    { name: 'read_invoice', purpose: 'Read the invoice', system: 'Finance inbox', access: 'read' },
    { name: 'notify_finance', purpose: 'Send mismatches to finance', system: 'Teams', access: 'write' },
  ],
  steps: ['Read the invoice.', 'Find the order.', 'Compare.'],
  rules: ['Amount and PO number match exactly.'],
  checkpoints: ['Finance approves every mismatch.'],
  handover: ['The PDF is unreadable.'],
  guardrails: ['Never pay an invoice.'],
  tests: [
    { name: 'Match', input: 'INV-7 for PO-7, same amount', expected: 'Marked matched' },
    { name: 'Mismatch', input: 'Amount differs', expected: 'Sent to finance' },
  ],
  openQuestions: [],
  source: 'fixture',
  ...basesOf(graph, 'm')!,
  revision: 3,
  createdAt: '2026-11-02T10:00:00.000Z',
};
const ctx = { stepName: 'Match invoice', workflowName: 'Purchasing' };

describe('readiness', () => {
  it('is ready when every part a builder needs is there', () => {
    expect(readiness(bp)).toMatchObject({ ready: true });
  });

  it('lists exactly what is missing', () => {
    const r = readiness({ ...bp, rules: [], tests: bp.tests.slice(0, 1), openQuestions: ['Who approves?'] });
    expect(r.ready).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(['rules', 'tests', 'open']);
  });
});

describe('blueprint helpers', () => {
  it('makes safe tool names', () => {
    expect(toolName('Read the Invoice (PDF)')).toBe('read_the_invoice_pdf');
    expect(toolName('123')).toBe('tool_123');
  });

  it('is out of date when the step itself or its classification changes, not when only an earlier step does', () => {
    expect(blueprintOutdated(bp, { classification: 'full' }, graph)).toBe(false);
    expect(blueprintOutdated(bp, { classification: 'assisted' }, graph)).toBe(true);
    const renamed = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'm' ? { ...n, label: 'Match invoices' } : n)) };
    expect(blueprintOutdated(bp, { classification: 'full' }, renamed)).toBe(true);
    const earlier = { ...graph, nodes: graph.nodes.map((n) => (n.id === 's' ? { ...n, notes: 'Weekly.' } : n)) };
    expect(blueprintOutdated(bp, { classification: 'full' }, earlier)).toBe(false);
  });
});

describe('exports', () => {
  it('Claude agent setup: instructions with rules, checkpoints and limits; tool list as JSON; tests; labelled as a starting point', () => {
    const text = exportClaude(bp, ctx);
    expect(text).toContain('Nothing has been built, connected or tested');
    expect(text).toContain('Test fixture, not a live AI blueprint.');
    expect(text).toContain('You handle “Match invoice” in the “Purchasing” workflow.');
    expect(text).toContain('- Never pay an invoice.');
    expect(text).toContain('- Finance approves every mismatch.');
    const json = text.split('```json\n')[1]!.split('\n```')[0]!;
    expect(JSON.parse(json)).toEqual([
      expect.objectContaining({ name: 'read_invoice', description: expect.stringContaining('read only') }),
      expect.objectContaining({ name: 'notify_finance', description: expect.stringContaining('can make changes') }),
    ]);
    expect(text).toContain('| Match | INV-7 for PO-7, same amount | Marked matched |');
  });

  it('an assistant never decides', () => {
    expect(exportClaude({ ...bp, buildType: 'assistant' }, ctx)).toContain('A person makes the decision; you never decide for them.');
  });

  it('automation outline: trigger, read steps, the rule as a branch, approvals and the hand-over', () => {
    const text = exportOutline(bp, ctx);
    expect(text).toContain('Trigger: An invoice arrives in the finance inbox.');
    expect(text).toContain('1. Get data: Read the invoice [Finance inbox, read]');
    expect(text).toContain('IF Amount and PO number match exactly.');
    expect(text).toContain('-> hand over to a person (notify_finance)');
    expect(exportOutline({ ...bp, rules: [] }, ctx)).toContain('IF (rule not confirmed yet)');
  });

  it('Markdown says whether it is ready; JSON has no internal fingerprints', () => {
    expect(exportMarkdown(bp, ctx)).toContain('**Readiness:** Ready to build');
    expect(exportMarkdown({ ...bp, rules: [] }, ctx)).toContain('Not ready: rules written down');
    const data = JSON.parse(exportJson(bp, ctx));
    expect(data).toMatchObject({ format: 'flico-blueprint', version: 1, step: 'Match invoice', buildType: 'agent', readiness: { ready: true } });
    expect(data.basis).toBeUndefined();
    expect(data.stepBasis).toBeUndefined();
  });

  it('suggests the export that fits the build type, and safe file names', () => {
    expect(defaultFormat('rules')).toBe('outline');
    expect(defaultFormat('agent')).toBe('claude');
    expect(exportFileName('claude', 'Match invoice / PO')).toBe('match-invoice-po-claude-agent.md');
  });
});
