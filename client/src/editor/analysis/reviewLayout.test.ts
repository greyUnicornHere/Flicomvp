import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '../../../../shared/graph';
import { withChanges } from '../flowElements';
import { NODE_WIDTH } from '../layout';
import { reviewLayout } from './reviewLayout';

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

describe('reviewLayout (change-aware)', () => {
  const laid = reviewLayout(withChanges(before, after));
  const at = (id: string) => laid.nodes.find((n) => n.id === id)!.position;

  it('puts the proposed workflow on one tidy row, in order, ignoring old positions', () => {
    const row = ['s', 'l', 'r', 'a', 'f'].map(at);
    expect(new Set(row.map((p) => p.y)).size).toBe(1);
    expect(row.map((p) => p.x)).toEqual([...row.map((p) => p.x)].sort((x, y) => x - y));
  });

  it('places a removed step in a lane below, between the steps it sat between', () => {
    const removed = at('c');
    expect(removed.y).toBeGreaterThan(at('r').y + 72);
    expect(removed.x).toBeGreaterThan(at('r').x);
    expect(removed.x).toBeLessThan(at('a').x);
  });

  it('keeps every connection, including the removed ones', () => {
    expect(laid.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'n1', 'n2', 'n3']);
  });

  it('never overlaps removed steps that wanted the same place, and keeps their order', () => {
    const chain: WorkflowGraph = {
      nodes: [...before.nodes.slice(0, 2), node('c1', 'Check A', 500), node('c2', 'Check B', 700), ...before.nodes.slice(3)],
      edges: [edge('e1', 's', 'r'), edge('x1', 'r', 'c1'), edge('x2', 'c1', 'c2'), edge('x3', 'c2', 'a'), edge('e4', 'a', 'f')],
    };
    const shortened: WorkflowGraph = { nodes: [...before.nodes.slice(0, 2), ...before.nodes.slice(3)], edges: [edge('e1', 's', 'r'), edge('n3', 'r', 'a'), edge('e4', 'a', 'f')] };
    const out = reviewLayout(withChanges(chain, shortened));
    const a = out.nodes.find((n) => n.id === 'c1')!.position;
    const b = out.nodes.find((n) => n.id === 'c2')!.position;
    expect(a.y).toBe(b.y);
    expect(b.x - a.x).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('changes nothing about a review without removed steps except tidying it', () => {
    const out = reviewLayout(withChanges(before, before));
    expect(out.nodes).toHaveLength(before.nodes.length);
    expect(new Set(out.nodes.map((n) => n.position.y)).size).toBe(1);
  });
});
