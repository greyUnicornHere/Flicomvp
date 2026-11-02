import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '../../../../shared/graph';
import { withChanges } from '../flowElements';
import { removedSteps, reviewLayout } from './reviewLayout';

const node = (id: string, label: string, x = 0, y = 0) => ({ id, type: 'action' as const, label, position: { x, y } });
const edge = (id: string, sourceId: string, targetId: string) => ({ id, sourceId, targetId, type: 'normal' as const });

// Start → Receive → Check → Approve → Ship; the proposal adds "Log" after Start and removes "Check".
const before: WorkflowGraph = {
  nodes: [{ ...node('s', 'Start'), type: 'start' }, node('r', 'Receive', 300, 40), node('c', 'Check', 600, -80), node('a', 'Approve', 900, 120), { ...node('f', 'Ship', 1200), type: 'finish' }],
  edges: [edge('e1', 's', 'r'), edge('e2', 'r', 'c'), edge('e3', 'c', 'a'), edge('e4', 'a', 'f')],
};
const after: WorkflowGraph = {
  nodes: [before.nodes[0]!, node('l', 'Log'), before.nodes[1]!, before.nodes[3]!, before.nodes[4]!],
  edges: [edge('n1', 's', 'l'), edge('n2', 'l', 'r'), edge('n3', 'r', 'a'), edge('e4', 'a', 'f')],
};

describe('review diagram: proposed workflow only, removed steps listed', () => {
  const display = withChanges(before, after);
  const laid = reviewLayout(display).graph;
  const at = (id: string) => laid.nodes.find((n) => n.id === id)!.position;

  it('draws only the proposed workflow on one tidy row, in order, ignoring old positions', () => {
    expect(laid.nodes.map((n) => n.id).sort()).toEqual(['a', 'f', 'l', 'r', 's']);
    const row = ['s', 'l', 'r', 'a', 'f'].map(at);
    expect(new Set(row.map((p) => p.y)).size).toBe(1);
    expect(row.map((p) => p.x)).toEqual([...row.map((p) => p.x)].sort((x, y) => x - y));
  });

  it('draws no removed connections (no red lines)', () => {
    expect(laid.edges.map((e) => e.id).sort()).toEqual(['e4', 'n1', 'n2', 'n3']);
  });

  it('lists removed steps with the steps they sat between', () => {
    expect(removedSteps(display)).toEqual([{ id: 'c', label: 'Check', after: [{ id: 'r', label: 'Receive' }], before: [{ id: 'a', label: 'Approve' }] }]);
  });

  it('follows chains of removed steps and keeps their order', () => {
    const chain: WorkflowGraph = {
      nodes: [...before.nodes.slice(0, 2), node('c1', 'Check A', 500), node('c2', 'Check B', 700), ...before.nodes.slice(3)],
      edges: [edge('e1', 's', 'r'), edge('x1', 'r', 'c1'), edge('x2', 'c1', 'c2'), edge('x3', 'c2', 'a'), edge('e4', 'a', 'f')],
    };
    const shortened: WorkflowGraph = { nodes: [...before.nodes.slice(0, 2), ...before.nodes.slice(3)], edges: [edge('e1', 's', 'r'), edge('n3', 'r', 'a'), edge('e4', 'a', 'f')] };
    const list = removedSteps(withChanges(chain, shortened));
    expect(list.map((r) => [r.label, r.after.map((n) => n.label), r.before.map((n) => n.label)])).toEqual([
      ['Check A', ['Receive'], ['Approve']],
      ['Check B', ['Receive'], ['Approve']],
    ]);
  });

  it('has nothing to list when nothing is removed', () => {
    expect(removedSteps(withChanges(before, before))).toEqual([]);
    expect(new Set(reviewLayout(withChanges(before, before)).graph.nodes.map((n) => n.position.y)).size).toBe(1);
  });
});
