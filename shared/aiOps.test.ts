import { describe, expect, it } from 'vitest';
import { applyOperations, diffGraphs, MAX_OPERATIONS, type ProposalOperation } from './aiOps.js';
import type { WorkflowGraph } from './graph.js';

const base: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', label: 'Receive invoice', position: { x: 288, y: 0 } },
    { id: 'd', type: 'decision', label: 'Over limit?', position: { x: 576, y: 0 } },
    { id: 'f', type: 'finish', label: 'Paid', position: { x: 864, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
    { id: 'e2', sourceId: 'a', targetId: 'd', type: 'normal' },
    { id: 'e3', sourceId: 'd', targetId: 'f', type: 'no', label: 'No' },
  ],
};

const problemsOf = (ops: ProposalOperation[]) => {
  const result = applyOperations(base, ops);
  return result.ok ? [] : result.problems;
};

describe('applyOperations', () => {
  it('applies a valid proposal and leaves the input untouched', () => {
    const before = JSON.stringify(base);
    const result = applyOperations(base, [
      { op: 'addStep', id: 'n1', type: 'approval', label: 'Manager approves' },
      { op: 'addConnection', id: 'c1', sourceId: 'd', targetId: 'n1', type: 'yes' },
      { op: 'addConnection', id: 'c2', sourceId: 'n1', targetId: 'f', type: 'normal' },
      { op: 'updateStep', stepId: 'a', label: 'Receive and log invoice' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(base)).toBe(before);
    expect(result.graph.nodes.find((n) => n.id === 'n1')).toMatchObject({ type: 'approval', origin: 'ai-inferred' });
    expect(result.graph.edges.find((e) => e.id === 'c1')).toMatchObject({ label: 'Yes', branchGroupId: 'd' });
    expect(diffGraphs(base, result.graph)).toEqual({
      addedNodes: ['n1'],
      modifiedNodes: ['a'],
      removedNodes: [],
      addedEdges: ['c1', 'c2'],
      modifiedEdges: [],
      removedEdges: [],
    });
  });

  it('removing a step also removes its connections', () => {
    const result = applyOperations(base, [{ op: 'removeStep', stepId: 'a' }]);
    expect(result.ok && result.graph.edges.map((e) => e.id)).toEqual(['e3']);
  });

  it('rejects references to steps or connections that do not exist', () => {
    expect(problemsOf([{ op: 'updateStep', stepId: 'ghost', label: 'X' }])[0]).toMatch(/doesn't exist/);
    expect(problemsOf([{ op: 'removeConnection', connectionId: 'nope' }])[0]).toMatch(/doesn't exist/);
    expect(problemsOf([{ op: 'addConnection', id: 'c9', sourceId: 'a', targetId: 'ghost', type: 'normal' }]).join()).toMatch(/doesn't exist/);
  });

  it('rejects duplicate IDs', () => {
    expect(problemsOf([{ op: 'addStep', id: 'a', type: 'action', label: 'Dup' }])[0]).toMatch(/already in use/);
    expect(
      problemsOf([
        { op: 'addStep', id: 'n1', type: 'action', label: 'One' },
        { op: 'addStep', id: 'n1', type: 'action', label: 'Two' },
      ])[0],
    ).toMatch(/already in use/);
  });

  it('rejects invalid connections', () => {
    expect(problemsOf([{ op: 'addConnection', id: 'c', sourceId: 'a', targetId: 'a', type: 'normal' }]).join()).toMatch(/itself/);
    expect(problemsOf([{ op: 'addConnection', id: 'c', sourceId: 'a', targetId: 'f', type: 'yes' }]).join()).toMatch(/Only decisions/);
    expect(problemsOf([{ op: 'addConnection', id: 'c', sourceId: 'd', targetId: 'a', type: 'no' }]).join()).toMatch(/more than one No/);
    expect(problemsOf([{ op: 'addConnection', id: 'c', sourceId: 's', targetId: 'a', type: 'normal' }]).join()).toMatch(/identical/);
  });

  it('protects the Start step and step names', () => {
    expect(problemsOf([{ op: 'removeStep', stepId: 's' }])[0]).toMatch(/Start/);
    expect(problemsOf([{ op: 'addStep', id: 'n', type: 'start', label: 'Another start' }]).join()).toMatch(/start/i);
    expect(problemsOf([{ op: 'updateStep', stepId: 'a', label: '   ' }])[0]).toMatch(/needs a name/);
  });

  it('is all-or-nothing and bounded in size', () => {
    const result = applyOperations(base, [
      { op: 'updateStep', stepId: 'a', label: 'Fine' },
      { op: 'removeStep', stepId: 'ghost' },
    ]);
    expect(result.ok).toBe(false);
    expect(problemsOf([])[0]).toMatch(/no changes/);
    const many = Array.from({ length: MAX_OPERATIONS + 1 }, (_, i): ProposalOperation => ({ op: 'addStep', id: `n${i}`, type: 'action', label: 'x' }));
    expect(problemsOf(many)[0]).toMatch(/at most/);
  });
});

describe('diffGraphs', () => {
  it('ignores position-only changes and reports removals', () => {
    const moved: WorkflowGraph = { nodes: base.nodes.map((n) => ({ ...n, position: { x: n.position.x + 5, y: 9 } })), edges: base.edges.slice(1) };
    expect(diffGraphs(base, moved)).toMatchObject({ modifiedNodes: [], removedEdges: ['e1'] });
  });

  it('notices nested field changes', () => {
    const withDuration: WorkflowGraph = { ...base, nodes: base.nodes.map((n) => (n.id === 'a' ? { ...n, duration: { value: 1, unit: 'days' } } : n)) };
    const changed: WorkflowGraph = { ...base, nodes: base.nodes.map((n) => (n.id === 'a' ? { ...n, duration: { value: 2, unit: 'days' } } : n)) };
    expect(diffGraphs(withDuration, changed).modifiedNodes).toEqual(['a']);
  });
});
