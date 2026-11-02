import { describe, expect, it } from 'vitest';
import type { ProposalOperation } from './aiOps.js';
import { findConflicts, orderRecommendations, overlayGraph, planApply, quickRepeatBlocked, touched, unchangedSince, unsupportedFigures } from './analysis.js';
import type { WorkflowGraph } from './graph.js';

const base: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', label: 'Receive order', position: { x: 288, y: 0 } },
    { id: 'b', type: 'action', label: 'Check stock', position: { x: 576, y: 0 } },
    { id: 'c', type: 'action', label: 'Check stock again', position: { x: 864, y: 0 } },
    { id: 'f', type: 'finish', label: 'Shipped', position: { x: 1152, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
    { id: 'e2', sourceId: 'a', targetId: 'b', type: 'normal' },
    { id: 'e3', sourceId: 'b', targetId: 'c', type: 'normal' },
    { id: 'e4', sourceId: 'c', targetId: 'f', type: 'normal' },
  ],
};

const rec = (id: string, operations: ProposalOperation[], dependsOn: string[] = []) => ({ id, title: id.toUpperCase(), operations, dependsOn });

const removeDuplicate = rec('remove', [
  { op: 'removeStep', stepId: 'c' },
  { op: 'addConnection', id: 'x1', sourceId: 'b', targetId: 'f', type: 'normal' },
]);
const renameCheck = rec('rename', [{ op: 'updateStep', stepId: 'b', label: 'Check stock automatically' }]);
const notesOnDuplicate = rec('notes', [{ op: 'updateStep', stepId: 'c', notes: 'Second look' }]);
const addNotify = rec('notify', [
  { op: 'addStep', id: 'n1', type: 'action', label: 'Notify customer' },
  { op: 'addConnection', id: 'x2', sourceId: 'a', targetId: 'n1', type: 'parallel' },
  { op: 'addConnection', id: 'x3', sourceId: 'a', targetId: 'b', type: 'parallel' },
]);

describe('touched', () => {
  it('counts the connections of a removed step as removed', () => {
    const t = touched(base, removeDuplicate.operations);
    expect([...t.removed].sort()).toEqual(['c', 'e3', 'e4']);
    expect([...t.referenced].sort()).toEqual(['b', 'f']);
    expect([...t.added]).toEqual(['x1']);
  });
});

describe('findConflicts', () => {
  it('flags overlapping changes with a readable message', () => {
    const conflicts = findConflicts(base, [removeDuplicate, notesOnDuplicate, renameCheck]);
    // Removing a step clashes with changing it; renaming a step another one connects to is fine.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ ids: ['remove', 'notes'], message: expect.stringContaining('“Check stock again”') });
  });

  it('allows independent recommendations', () => {
    expect(findConflicts(base, [renameCheck, addNotify])).toEqual([]);
  });
});

describe('planApply', () => {
  it('combines accepted recommendations only, all or nothing', () => {
    const plan = planApply(base, [removeDuplicate, renameCheck, addNotify], ['remove', 'notify']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.graph.nodes.map((n) => n.label)).toEqual(['Start', 'Receive order', 'Check stock', 'Shipped', 'Notify customer']);
  });

  it('refuses conflicting choices', () => {
    const plan = planApply(base, [removeDuplicate, notesOnDuplicate], ['remove', 'notes']);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.conflicts).toHaveLength(1);
  });

  it('refuses a recommendation whose dependency is not accepted', () => {
    const dependent = rec('dep', [{ op: 'updateStep', stepId: 'a', label: 'Log order' }], ['remove']);
    const plan = planApply(base, [removeDuplicate, dependent], ['dep']);
    expect(!plan.ok && plan.missing[0]!.message).toMatch(/needs “REMOVE”/);
    expect(planApply(base, [removeDuplicate, dependent], ['dep', 'remove']).ok).toBe(true);
  });

  it('reports an empty selection and invalid combined results', () => {
    expect(!planApply(base, [renameCheck], []).ok).toBe(true);
    // Two recommendations that each add a Start-protection-breaking change are rejected by integrity rules.
    const yes1 = rec('y1', [{ op: 'updateStep', stepId: 'a', type: 'decision' }, { op: 'updateConnection', connectionId: 'e2', type: 'yes' }]);
    const plan = planApply(base, [yes1], ['y1']);
    expect(plan.ok).toBe(true);
    const bad = rec('bad', [{ op: 'addConnection', id: 'z', sourceId: 'a', targetId: 'c', type: 'yes' }]);
    const combined = planApply(base, [bad], ['bad']);
    expect(!combined.ok && combined.problems.join()).toMatch(/Only decisions/);
  });
});

describe('overlayGraph', () => {
  it('draws every compatible recommendation and skips clashing ones', () => {
    const { graph, included, skipped } = overlayGraph(base, [removeDuplicate, notesOnDuplicate, addNotify]);
    expect(included).toEqual(['remove', 'notify']);
    expect(skipped).toEqual(['notes']);
    expect(graph.nodes.some((n) => n.id === 'c')).toBe(false);
  });
});

describe('orderRecommendations', () => {
  it('puts high impact, low effort first and keeps ties stable', () => {
    const list = [
      { id: '1', impact: 'medium', effort: 'low' },
      { id: '2', impact: 'high', effort: 'high' },
      { id: '3', impact: 'high', effort: 'low' },
      { id: '4', impact: 'medium', effort: 'low' },
    ] as const;
    expect(orderRecommendations([...list]).map((r) => r.id)).toEqual(['3', '2', '1', '4']);
  });
});

describe('unsupportedFigures', () => {
  it('catches invented savings and ROI', () => {
    expect(unsupportedFigures('This could save 30% of the time and $5,000 a year.', '')).toEqual(['30%', '$5,000']);
    expect(unsupportedFigures('It will save 3 hours per order and be 2x faster. Great ROI.', '')).toEqual(['2x faster', 'save 3 hours', 'ROI']);
  });

  it('allows figures the person provided and ordinary numbers', () => {
    expect(unsupportedFigures('Orders over 5,000 need approval; the 10% discount stays.', 'Discount 10% for orders over 5,000')).toEqual([]);
    expect(unsupportedFigures('Step 2 waits for 3 days.', '')).toEqual([]);
  });
});

describe('repeat Quick Analysis', () => {
  const base: WorkflowGraph = {
    nodes: [
      { id: 'a', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
      { id: 'b', type: 'action', label: 'Check order', position: { x: 288, y: 0 } },
    ],
    edges: [{ id: 'e', sourceId: 'a', targetId: 'b', type: 'normal' }],
  };
  const moved: WorkflowGraph = { ...base, nodes: base.nodes.map((n) => ({ ...n, position: { x: n.position.x + 50, y: 90 } })) };
  const renamed: WorkflowGraph = { ...base, nodes: base.nodes.map((n) => (n.id === 'b' ? { ...n, notes: 'Use the checklist' } : n)) };

  it('ignores where blocks sit, but not names, details or connections', () => {
    expect(unchangedSince(base, moved)).toBe(true);
    expect(unchangedSince(base, renamed)).toBe(false);
    expect(unchangedSince(base, { ...base, edges: [] })).toBe(false);
  });

  it('blocks only when the current analysis already has the automation assessment and nothing changed', () => {
    expect(quickRepeatBlocked(null, base)).toBe(false);
    expect(quickRepeatBlocked({ snapshot: base, assessments: [] }, moved)).toBe(true);
    expect(quickRepeatBlocked({ snapshot: base, assessments: [] }, renamed)).toBe(false);
    expect(quickRepeatBlocked({ snapshot: base, assessments: null }, moved)).toBe(false);
  });
});
