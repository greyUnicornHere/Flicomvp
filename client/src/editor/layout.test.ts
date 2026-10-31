import { describe, expect, it } from 'vitest';
import { autoLayout, NODE_HEIGHT, NODE_WIDTH, nodeHeight, placeNewSteps } from './layout';
import { graph, sequential } from './test/fixtures';
import type { WorkflowGraph } from '../../../shared/graph';

const pos = (g: WorkflowGraph, id: string) => g.nodes.find((n) => n.id === id)!.position;

function noOverlaps(g: WorkflowGraph) {
  for (const a of g.nodes)
    for (const b of g.nodes) {
      if (a.id >= b.id) continue;
      const overlap =
        Math.abs(a.position.x - b.position.x) < NODE_WIDTH && Math.abs(a.position.y - b.position.y) < NODE_HEIGHT;
      expect(overlap, `${a.label} overlaps ${b.label}`).toBe(false);
    }
}

describe('autoLayout', () => {
  it('lays a sequence out left to right on one line', () => {
    const g = autoLayout(sequential());
    const xs = ['s', 'a', 'b', 'f'].map((id) => pos(g, id).x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set(['s', 'a', 'b', 'f'].map((id) => pos(g, id).y)).size).toBe(1);
  });

  it('puts Yes above No, symmetric around the decision, and joins level with it', () => {
    const g = autoLayout(
      graph({
        nodes: [['s', 'start', 'Start'], ['d', 'decision', 'In stock?'], ['n', 'action', 'Notify'], ['y', 'action', 'Reserve'], ['f', 'finish', 'Finish']],
        edges: [['s', 'd'], ['d', 'n', 'no', 'No'], ['d', 'y', 'yes', 'Yes'], ['y', 'f'], ['n', 'f']],
      }),
    );
    expect(pos(g, 'y').y).toBeLessThan(pos(g, 'n').y);
    expect(pos(g, 'y').y + pos(g, 'n').y).toBe(2 * pos(g, 'd').y);
    expect(pos(g, 'f').y).toBe(pos(g, 'd').y);
    expect(pos(g, 'f').x).toBeGreaterThan(pos(g, 'y').x);
    noOverlaps(g);
  });

  it('stacks parallel activities vertically between split and join', () => {
    const g = autoLayout(
      graph({
        nodes: [['s', 'start', 'Start'], ['a', 'action', 'Invoice'], ['b', 'action', 'Pack'], ['c', 'action', 'Label'], ['j', 'wait', 'All activities complete']],
        edges: [['s', 'a', 'parallel'], ['s', 'b', 'parallel'], ['s', 'c', 'parallel'], ['a', 'j'], ['b', 'j'], ['c', 'j']],
      }),
    );
    expect(new Set(['a', 'b', 'c'].map((id) => pos(g, id).x)).size).toBe(1);
    expect(pos(g, 'b').y).toBe(pos(g, 's').y);
    expect(pos(g, 'j').x).toBeGreaterThan(pos(g, 'a').x);
    noOverlaps(g);
  });

  it('ignores loop connections when choosing columns', () => {
    const g = autoLayout(
      graph({ nodes: [['s', 'start', 'Start'], ['a', 'action', 'Draft'], ['b', 'action', 'Review']], edges: [['s', 'a'], ['a', 'b'], ['b', 'a', 'loop', 'Again']] }),
    );
    expect(pos(g, 'b').x).toBeGreaterThan(pos(g, 'a').x);
  });

  it('is deterministic and never changes connections (E16)', () => {
    const input = graph({
      nodes: [['s', 'start', 'Start'], ['d', 'decision', 'Ok?'], ['y', 'action', 'Y'], ['n', 'action', 'N'], ['x', 'exception', 'Fails']],
      edges: [['s', 'd'], ['d', 'y', 'yes', 'Yes'], ['d', 'n', 'no', 'No'], ['y', 'x', 'exception', 'Exception']],
    });
    const once = autoLayout(input);
    expect(autoLayout(once)).toEqual(once);
    expect(once.edges).toEqual(input.edges);
    noOverlaps(once);
  });

  it('places a large 25-step workflow without overlaps (QA fixture 6 shape)', () => {
    const nodes: [string, 'start' | 'action' | 'decision' | 'finish', string][] = [['s', 'start', 'Start']];
    const edges: [string, string, ('normal' | 'yes' | 'no')?, string?][] = [];
    let prev = 's';
    for (let i = 1; i <= 21; i++) {
      const id = `a${i}`;
      nodes.push([id, i === 7 || i === 14 ? 'decision' : 'action', `Step ${i}`]);
      edges.push([prev, id, prev === 'a7' || prev === 'a14' ? 'yes' : 'normal', prev === 'a7' || prev === 'a14' ? 'Yes' : undefined]);
      prev = id;
    }
    nodes.push(['n7', 'action', 'Alt 7'], ['n14', 'action', 'Alt 14'], ['f', 'finish', 'Finish']);
    edges.push(['a7', 'n7', 'no', 'No'], ['n7', 'a9'], ['a14', 'n14', 'no', 'No'], ['n14', 'a16'], [prev, 'f']);
    noOverlaps(autoLayout(graph({ nodes, edges })));
  });
});

describe('long step names (owner feedback 2026-10-31)', () => {
  const LONG = 'Check the customer purchase order against the signed framework agreement and the regional discount table';
  const boxOverlap = (g: WorkflowGraph) => {
    const h = (label: string) => nodeHeight(label);
    for (const a of g.nodes)
      for (const b of g.nodes) {
        if (a.id >= b.id || Math.abs(a.position.x - b.position.x) >= NODE_WIDTH) continue;
        const apart = a.position.y + h(a.label) <= b.position.y || b.position.y + h(b.label) <= a.position.y;
        expect(apart, `${a.label} overlaps ${b.label}`).toBe(true);
      }
  };

  it('estimates a taller block for a longer name', () => {
    expect(nodeHeight('Start')).toBe(NODE_HEIGHT);
    expect(nodeHeight('Receive the order')).toBe(NODE_HEIGHT); // two lines fit the standard block
    expect(nodeHeight(LONG)).toBeGreaterThan(NODE_HEIGHT + 80);
    expect(nodeHeight('x'.repeat(60))).toBeGreaterThan(NODE_HEIGHT); // one very long word wraps too
  });

  it('keeps steps of different heights level by their middles on a straight path', () => {
    const g = autoLayout(graph({ nodes: [['s', 'start', 'Start'], ['a', 'action', LONG], ['f', 'finish', 'Finish']], edges: [['s', 'a'], ['a', 'f']] }));
    const mid = (id: string) => pos(g, id).y + nodeHeight(g.nodes.find((n) => n.id === id)!.label) / 2;
    expect(mid('a')).toBe(mid('s'));
    expect(mid('f')).toBe(mid('s'));
  });

  it('stacks tall branches without overlapping', () => {
    const g = autoLayout(
      graph({
        nodes: [['s', 'start', 'Start'], ['d', 'decision', 'In stock?'], ['y', 'action', LONG], ['n', 'action', LONG], ['f', 'finish', 'Finish']],
        edges: [['s', 'd'], ['d', 'y', 'yes', 'Yes'], ['d', 'n', 'no', 'No'], ['y', 'f'], ['n', 'f']],
      }),
    );
    boxOverlap(g);
    expect(pos(g, 'y').y).toBeLessThan(pos(g, 'n').y);
  });

  it('places a new step clear of a tall neighbour', () => {
    const before = autoLayout(
      graph({ nodes: [['s', 'start', 'Start'], ['d', 'decision', 'In stock?'], ['y', 'action', LONG]], edges: [['s', 'd'], ['d', 'y', 'yes', 'Yes']] }),
    );
    const after = { ...before, nodes: [...before.nodes, { id: 'n', type: 'action' as const, label: LONG, position: { x: 0, y: 0 } }], edges: [...before.edges, { id: 'en', sourceId: 'd', targetId: 'n', type: 'no' as const, label: 'No' }] };
    boxOverlap(placeNewSteps(before, after));
  });
});
