import { describe, expect, it } from 'vitest';
import { historyReducer, type HistoryState } from './history';
import { insertStep, updateStep } from './ops';
import { counterIds, sequential, startOnly } from './test/fixtures';

const init = (g = startOnly()): HistoryState => ({ past: [], present: g, future: [] });

describe('historyReducer (E12)', () => {
  it('undoes and redoes several edits exactly, without dropping connections', () => {
    const ids = counterIds();
    const g0 = sequential();
    const g1 = insertStep(g0, { kind: 'edge', edgeId: 'e1' }, 'approval', ids).graph;
    const g2 = updateStep(g1, 'b', { label: 'Check stock' }).graph;
    let s = init(g0);
    s = historyReducer(s, { type: 'commit', graph: g1 });
    s = historyReducer(s, { type: 'commit', graph: g2 });

    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe(g1);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe(g0);
    expect(s.present.edges).toHaveLength(3);
    s = historyReducer(s, { type: 'undo' }); // nothing more to undo
    expect(s.present).toBe(g0);

    s = historyReducer(s, { type: 'redo' });
    s = historyReducer(s, { type: 'redo' });
    expect(s.present).toBe(g2);
    expect(historyReducer(s, { type: 'redo' })).toBe(s);
  });

  it('a new edit after undo discards the redo branch', () => {
    const a = sequential();
    const b = updateStep(a, 'a', { label: 'B' }).graph;
    const c = updateStep(a, 'a', { label: 'C' }).graph;
    let s = historyReducer(init(a), { type: 'commit', graph: b });
    s = historyReducer(s, { type: 'undo' });
    s = historyReducer(s, { type: 'commit', graph: c });
    expect(s.future).toEqual([]);
    expect(s.present).toBe(c);
  });

  it('merges naming a just-added step into the same undo step', () => {
    const g0 = startOnly();
    const added = insertStep(g0, { kind: 'after', nodeId: 's' }, 'action', counterIds());
    const named = updateStep(added.graph, added.focusId!, { label: 'Receive order' }).graph;
    let s = historyReducer(init(g0), { type: 'commit', graph: added.graph });
    s = historyReducer(s, { type: 'commit', graph: named, merge: true });
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe(g0);
  });

  it('keeps at most 100 steps', () => {
    let s = init();
    for (let i = 0; i < 120; i++) s = historyReducer(s, { type: 'commit', graph: updateStep(sequential(), 'a', { label: `L${i}` }).graph });
    expect(s.past).toHaveLength(100);
  });
});
