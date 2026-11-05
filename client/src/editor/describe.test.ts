import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../../../shared/graph';
import { describedPatch } from './describe';
import { updateStep } from './ops';

const node: WorkflowNode = { id: 'a', type: 'action', label: 'Log the request', position: { x: 0, y: 0 } };

describe('describedPatch', () => {
  it('fills an empty step from the description', () => {
    const { patch, filled } = describedPatch(node, { owner: 'Sara (Procurement)', tools: ['Shared sheet'], duration: { value: 10, unit: 'minutes' }, notes: 'Logs each request.' });
    expect(patch).toEqual({ owner: 'Sara (Procurement)', tools: ['Shared sheet'], duration: { value: 10, unit: 'minutes' }, notes: 'Logs each request.' });
    expect(filled).toEqual(['owner', 'tools', 'duration', 'notes']);
  });

  it('keeps what is there: adds tools, appends notes, skips what is unchanged', () => {
    const existing = { ...node, owner: 'Sara', tools: ['Excel'], notes: 'Urgent ones first.', duration: { value: 10, unit: 'minutes' } };
    const { patch, before, filled } = describedPatch(existing, { owner: 'Sara', tools: ['excel', 'SAP'], duration: { value: 10, unit: 'minutes' }, notes: 'Then checks the budget.' });
    expect(patch).toEqual({ tools: ['Excel', 'SAP'], notes: 'Urgent ones first.\nThen checks the budget.' });
    expect(before).toEqual({ tools: ['Excel'], notes: 'Urgent ones first.' });
    expect(filled).toEqual(['tools', 'notes']);
    // Saying the same thing again changes nothing.
    expect(describedPatch({ ...existing, ...patch }, { notes: 'Then checks the budget.', tools: ['SAP'] }).filled).toEqual([]);
  });

  it('the "before" values undo it exactly', () => {
    const { patch, before } = describedPatch(node, { owner: 'Finance', duration: { value: 2, unit: 'hours' }, notes: 'Checks totals.' });
    const filled = updateStep({ nodes: [node], edges: [] }, 'a', patch).graph;
    const undone = updateStep(filled, 'a', before).graph;
    expect(undone.nodes[0]).toEqual(node);
  });
});
