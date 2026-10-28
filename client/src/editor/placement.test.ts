import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '../../../shared/graph';
import { COLUMN, NODE_HEIGHT, NODE_WIDTH, ROW, placeNewSteps } from './layout';
import { addDecision, addException, addParallel, connectSteps, deleteStep, insertStep, updateStep } from './ops';
import { counterIds, graph } from './test/fixtures';

const pos = (g: WorkflowGraph, id: string) => g.nodes.find((n) => n.id === id)!.position;
const byLabel = (g: WorkflowGraph, label: string) => g.nodes.find((n) => n.label === label)!.position;

/** A hand-arranged workflow: the person dragged "Archive" somewhere unusual. */
function arranged(): WorkflowGraph {
  const g = graph({
    nodes: [
      ['s', 'start', 'Start'],
      ['a', 'action', 'Receive order'],
      ['b', 'action', 'Verify stock'],
      ['f', 'finish', 'Finish'],
      ['x', 'action', 'Archive'],
    ],
    edges: [['s', 'a'], ['a', 'b'], ['b', 'f']],
  });
  const at: Record<string, { x: number; y: number }> = { s: { x: 0, y: 0 }, a: { x: 300, y: 20 }, b: { x: 620, y: 20 }, f: { x: 940, y: 0 }, x: { x: 310, y: 400 } };
  return { nodes: g.nodes.map((n) => ({ ...n, position: at[n.id]! })), edges: g.edges };
}

function noOverlaps(g: WorkflowGraph) {
  for (const a of g.nodes)
    for (const b of g.nodes)
      if (a.id < b.id) {
        const hit = Math.abs(a.position.x - b.position.x) < NODE_WIDTH && Math.abs(a.position.y - b.position.y) < NODE_HEIGHT;
        expect(hit, `${a.label} overlaps ${b.label}`).toBe(false);
      }
}

describe('placeNewSteps (no automatic tidying)', () => {
  it('adds a step after the end of a path without moving anything else', () => {
    const end = graph({ nodes: [['s', 'start', 'Start'], ['a', 'action', 'A']], edges: [['s', 'a']] });
    end.nodes[1]!.position = { x: 333, y: 77 };
    const added = placeNewSteps(end, insertStep(end, { kind: 'after', nodeId: 'a' }, 'action', counterIds()).graph);
    expect(byLabel(added, 'New action')).toEqual({ x: 333 + COLUMN, y: 77 });
    expect(pos(added, 's')).toEqual({ x: 0, y: 0 });
    expect(pos(added, 'a')).toEqual({ x: 333, y: 77 });
  });

  it('inserting on an arrow slides only the following steps right; other steps stay put', () => {
    const before = arranged();
    const after = placeNewSteps(before, insertStep(before, { kind: 'edge', edgeId: 'e2' }, 'approval', counterIds()).graph);
    const added = byLabel(after, 'New approval');
    expect(added).toEqual({ x: 300 + COLUMN, y: 20 });
    // before the insertion point: unchanged
    expect(pos(after, 's')).toEqual({ x: 0, y: 0 });
    expect(pos(after, 'a')).toEqual({ x: 300, y: 20 });
    expect(pos(after, 'x')).toEqual({ x: 310, y: 400 }); // unrelated, hand-placed: unchanged
    // after it: slid right by exactly the room needed, keeping their own arrangement
    const shift = added.x + COLUMN - 620;
    expect(pos(after, 'b')).toEqual({ x: 620 + shift, y: 20 });
    expect(pos(after, 'f')).toEqual({ x: 940 + shift, y: 0 });
    noOverlaps(after);
  });

  it('does not move following steps when there is already room', () => {
    const before = arranged();
    before.nodes.find((n) => n.id === 'b')!.position = { x: 1200, y: 20 };
    before.nodes.find((n) => n.id === 'f')!.position = { x: 1500, y: 0 };
    const after = placeNewSteps(before, insertStep(before, { kind: 'edge', edgeId: 'e2' }, 'wait', counterIds()).graph);
    expect(pos(after, 'b')).toEqual({ x: 1200, y: 20 });
    expect(pos(after, 'f')).toEqual({ x: 1500, y: 0 });
  });

  it('places decision outcomes Yes above and No below, and makes room for the joined step', () => {
    const before = arranged();
    const after = placeNewSteps(before, addDecision(before, { kind: 'edge', edgeId: 'e2' }, { question: 'Paid?', yes: 'Ship', no: 'Remind' }, counterIds()).graph);
    const d = byLabel(after, 'Paid?');
    expect(d).toEqual({ x: 300 + COLUMN, y: 20 });
    expect(byLabel(after, 'Ship')).toEqual({ x: d.x + COLUMN, y: 20 - ROW / 2 });
    expect(byLabel(after, 'Remind')).toEqual({ x: d.x + COLUMN, y: 20 + ROW / 2 });
    expect(pos(after, 'b').x).toBe(d.x + 2 * COLUMN);
    expect(pos(after, 'x')).toEqual({ x: 310, y: 400 });
    noOverlaps(after);
  });

  it('stacks parallel activities and puts the join after them', () => {
    const before = arranged();
    const after = placeNewSteps(before, addParallel(before, 'a', { activities: ['Invoice', 'Pack', 'Label'], waitForAll: true }, counterIds()).graph);
    const ys = ['Invoice', 'Pack', 'Label'].map((l) => byLabel(after, l).y);
    expect(ys).toEqual([20 - ROW, 20, 20 + ROW]);
    expect(byLabel(after, 'All activities complete')).toEqual({ x: 300 + 2 * COLUMN, y: 20 });
    expect(pos(after, 'b').x).toBe(300 + 3 * COLUMN);
    noOverlaps(after);
  });

  it('puts an exception underneath, finding free space when that spot is taken', () => {
    const before = arranged();
    // Something already sits where the exception would go.
    before.nodes.find((n) => n.id === 'x')!.position = { x: 300 + COLUMN, y: 20 + ROW };
    const after = placeNewSteps(before, addException(before, 'a', { exception: 'Order incomplete', response: 'Ask customer' }, counterIds()).graph);
    expect(pos(after, 'x')).toEqual({ x: 300 + COLUMN, y: 20 + ROW });
    expect(byLabel(after, 'Order incomplete').x).toBe(300 + COLUMN);
    noOverlaps(after);
  });

  it('leaves positions untouched for edits that add no steps', () => {
    const before = arranged();
    for (const next of [
      updateStep(before, 'a', { label: 'Renamed' }).graph,
      deleteStep(before, 'b', { reconnect: true }, counterIds()).graph,
      connectSteps(before, 'x', 'f', counterIds()).graph,
    ]) {
      const placed = placeNewSteps(before, next);
      for (const n of placed.nodes) expect(n.position).toEqual(pos(before, n.id));
    }
  });
});
