import { describe, expect, it } from 'vitest';
import { autoLayout, NODE_HEIGHT, NODE_WIDTH } from './layout';
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
