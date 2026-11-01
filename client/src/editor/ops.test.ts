import { describe as suite, expect, it } from 'vitest';
import {
  addDecision,
  addException,
  addLoop,
  addParallel,
  allowedTypeChanges,
  connectSteps,
  connectTargets,
  deleteStep,
  deletionImpact,
  findNode,
  insertStep,
  joinSuggestions,
  loopTargets,
  openBranches,
  removeConnection,
  slotAfter,
  updateStep,
} from './ops';
import { counterIds, describe, graph, sequential, startOnly } from './test/fixtures';
import { validateWorkflow } from '../../../shared/validation';

const ids = () => counterIds('x');
const noIssues = (g: Parameters<typeof validateWorkflow>[0]) => validateWorkflow(g).filter((i) => i.severity === 'blocker');

suite('insertStep', () => {
  it('adds the first step after Start with a type-based default name (E02)', () => {
    const { graph: g, focusId } = insertStep(startOnly(), { kind: 'after', nodeId: 's' }, 'action', ids());
    expect(findNode(g, focusId!)).toMatchObject({ type: 'action', label: 'New action' });
    expect(describe(g)).toEqual(['Start → New action']);
  });

  it('splits a connection, keeping the step that followed', () => {
    const g0 = sequential();
    const { graph: g } = insertStep(g0, { kind: 'edge', edgeId: 'e2' }, 'approval', ids());
    expect(describe(g)).toEqual(['New approval → Verify stock', 'Receive order → New approval', 'Start → Receive order', 'Verify stock → Finish']);
    expect(g0.edges).toHaveLength(3); // input untouched
  });

  it('keeps Yes/No meaning when inserting on a branch connection', () => {
    const g0 = graph({
      nodes: [['s', 'start', 'Start'], ['d', 'decision', 'In stock?'], ['r', 'action', 'Reserve']],
      edges: [['s', 'd'], ['d', 'r', 'yes', 'Yes']],
    });
    const { graph: g } = insertStep(g0, { kind: 'edge', edgeId: 'e2' }, 'wait', ids());
    const toWait = g.edges.find((e) => e.targetId !== 'r' && e.sourceId === 'd')!;
    expect(toWait).toMatchObject({ type: 'yes', label: 'Yes', branchGroupId: 'd' });
  });

  it('never puts Finish between two steps', () => {
    expect(() => insertStep(sequential(), { kind: 'edge', edgeId: 'e1' }, 'finish', ids())).toThrow(/only end a path/);
  });

  it('does not add after Finish', () => {
    expect(() => insertStep(sequential(), { kind: 'after', nodeId: 'f' }, 'action', ids())).toThrow(/Finish ends/);
  });
});

suite('slotAfter (toolbar insertion point)', () => {
  it('appends, splits a single path, or explains why not', () => {
    const g = sequential();
    expect(slotAfter(g, 'a')).toEqual({ slot: { kind: 'edge', edgeId: 'e2' } });
    expect(slotAfter(startOnly(), 's')).toEqual({ slot: { kind: 'after', nodeId: 's' } });
    expect(slotAfter(g, 'f')).toMatchObject({ reason: expect.stringMatching(/Finish ends/) });
  });
});

suite('addDecision (E03, E04, E05)', () => {
  it('creates two independent labelled outcomes from the end of a path', () => {
    const { graph: g, focusId } = addDecision(
      graph({ nodes: [['s', 'start', 'Start']], edges: [] }),
      { kind: 'after', nodeId: 's' },
      { question: 'Stock available?', yes: 'Reserve item', no: 'Notify customer' },
      ids(),
    );
    expect(findNode(g, focusId!)).toMatchObject({ type: 'decision', label: 'Stock available?' });
    expect(describe(g)).toEqual(['Start → Stock available?', 'Stock available? -no-> Notify customer', 'Stock available? -yes-> Reserve item']);
    for (const e of g.edges.filter((e) => e.type === 'yes' || e.type === 'no')) {
      expect(e.label).toBe(e.type === 'yes' ? 'Yes' : 'No');
      expect(e.branchGroupId).toBe(focusId);
    }
  });

  it('joins both outcomes to the step that followed (suggested join)', () => {
    const { graph: g, focusId } = addDecision(sequential(), { kind: 'edge', edgeId: 'e2' }, { question: 'Paid?', yes: 'Ship', no: 'Send reminder' }, ids());
    expect(describe(g)).toEqual([
      'Paid? -no-> Send reminder',
      'Paid? -yes-> Ship',
      'Receive order → Paid?',
      'Send reminder → Verify stock',
      'Ship → Verify stock',
      'Start → Receive order',
      'Verify stock → Finish',
    ]);
    expect(findNode(g, 'b')!.structure?.joinGroupId).toBe(focusId);
  });

  it('lets only one path continue and the other end separately (no forced reconnection)', () => {
    const { graph: g } = addDecision(sequential(), { kind: 'edge', edgeId: 'e2' }, { question: 'Paid?', yes: 'Ship', no: 'Cancel order', continueWith: 'yes' }, ids());
    expect(describe(g)).toContain('Ship → Verify stock');
    expect(describe(g).some((d) => d.startsWith('Cancel order'))).toBe(false);
  });

  it('never orphans the following step, even with blank outcomes', () => {
    const { graph: g } = addDecision(sequential(), { kind: 'edge', edgeId: 'e2' }, { question: 'Urgent?', continueWith: 'no' }, ids());
    expect(describe(g)).toContain('Urgent? -no-> Verify stock');
    const decision = g.nodes.find((n) => n.type === 'decision')!;
    expect(openBranches(g, decision.id)).toEqual(['yes']);
  });

  it('leaves a blank outcome as an open path that validation reports', () => {
    const { graph: g, focusId } = addDecision(startOnly(), { kind: 'after', nodeId: 's' }, { question: 'Approved?', yes: 'Dispatch' }, ids());
    expect(openBranches(g, focusId!)).toEqual(['no']);
    expect(validateWorkflow(g).map((i) => i.code)).toContain('decision_missing_branch');
  });

  it('requires a question', () => {
    expect(() => addDecision(startOnly(), { kind: 'after', nodeId: 's' }, { question: '  ' }, ids())).toThrow(/question/);
  });
});

suite('joins and reconnection (E04)', () => {
  const branched = () =>
    graph({
      nodes: [
        ['s', 'start', 'Start'],
        ['d', 'decision', 'In stock?'],
        ['y', 'action', 'Reserve item'],
        ['n', 'action', 'Notify customer'],
        ['f', 'finish', 'Finish'],
      ],
      edges: [['s', 'd'], ['d', 'y', 'yes', 'Yes'], ['d', 'n', 'no', 'No'], ['y', 'f']],
    });

  it('suggests rejoining where the other path goes', () => {
    expect(joinSuggestions(branched(), 'n').map((n) => n.label)).toEqual(['Finish']);
  });

  it('connects a path end forward and keeps both Yes/No labels', () => {
    const { graph: g } = connectSteps(branched(), 'n', 'f', ids());
    expect(describe(g)).toEqual(['In stock? -no-> Notify customer', 'In stock? -yes-> Reserve item', 'Notify customer → Finish', 'Reserve item → Finish', 'Start → In stock?']);
    expect(noIssues(g)).toEqual([]);
  });

  it('does not offer backward connections (those are loops)', () => {
    expect(connectTargets(branched(), 'n').map((n) => n.id)).not.toContain('d');
    expect(() => connectSteps(branched(), 'n', 'd', ids())).toThrow(/Repeat earlier step/);
  });

  it('removing a Yes path leaves it open rather than relabelling anything', () => {
    const { graph: g } = removeConnection(branched(), 'e2');
    expect(openBranches(g, 'd')).toEqual(['yes']);
    expect(g.edges.find((e) => e.id === 'e3')).toMatchObject({ type: 'no', label: 'No' });
  });

  it('connecting an open decision path fills that path', () => {
    const g0 = removeConnection(branched(), 'e2').graph;
    const { graph: g } = connectSteps(g0, 'd', 'f', ids(), 'yes');
    expect(describe(g)).toContain('In stock? -yes-> Finish');
  });
});

suite('addLoop (E06)', () => {
  const fixture3 = () =>
    graph({
      nodes: [['s', 'start', 'Start'], ['d', 'decision', 'Approved?'], ['ok', 'action', 'Dispatch'], ['fix', 'action', 'Request correction']],
      edges: [['s', 'd'], ['d', 'ok', 'yes', 'Yes'], ['d', 'fix', 'no', 'No']],
    });

  it('offers only earlier steps and adds an explicit loop connection', () => {
    expect(loopTargets(fixture3(), 'fix').map((n) => n.id).sort()).toEqual(['d', 's']);
    const { graph: g } = addLoop(fixture3(), 'fix', 'd', 'After correction', ids());
    const loop = g.edges.find((e) => e.type === 'loop')!;
    expect(loop).toMatchObject({ sourceId: 'fix', targetId: 'd', label: 'After correction' });
  });

  it('rejects repeating a later step', () => {
    expect(() => addLoop(fixture3(), 'd', 'fix', '', ids())).toThrow(/before it/);
  });

  it('flags a loop whose step has no way to continue', () => {
    const g = addLoop(fixture3(), 'fix', 'd', '', ids()).graph;
    expect(validateWorkflow(g).map((i) => i.code)).not.toContain('loop_no_exit'); // the decision's Yes path is the way out
    const g2 = graph({ nodes: [['s', 'start', 'Start'], ['a', 'action', 'Check']], edges: [['s', 'a'], ['a', 's', 'loop', 'Again']] });
    expect(validateWorkflow(g2).map((i) => i.code)).toContain('loop_no_exit');
  });
});

suite('addParallel (E07)', () => {
  it('stacks activities from one step and joins them before continuing', () => {
    const g0 = graph({ nodes: [['s', 'start', 'Start'], ['p', 'action', 'Order confirmed'], ['dsp', 'action', 'Dispatch']], edges: [['s', 'p'], ['p', 'dsp']] });
    const { graph: g } = addParallel(g0, 'p', { activities: ['Prepare invoice', 'Pack shipment'], waitForAll: true }, ids());
    expect(describe(g)).toEqual([
      'All activities complete → Dispatch',
      'Order confirmed -parallel-> Pack shipment',
      'Order confirmed -parallel-> Prepare invoice',
      'Pack shipment → All activities complete',
      'Prepare invoice → All activities complete',
      'Start → Order confirmed',
    ]);
    const parallel = g.edges.filter((e) => e.type === 'parallel');
    const join = g.nodes.find((n) => n.label === 'All activities complete')!;
    expect(new Set(parallel.map((e) => e.branchGroupId)).size).toBe(1);
    expect(join).toMatchObject({ type: 'wait', structure: { joinGroupId: parallel[0]!.branchGroupId } });
  });

  it('without wait-for-all keeps the main path and lets activities run alongside', () => {
    const g0 = graph({ nodes: [['s', 'start', 'Start'], ['p', 'action', 'Order confirmed'], ['dsp', 'action', 'Dispatch']], edges: [['s', 'p'], ['p', 'dsp']] });
    const { graph: g } = addParallel(g0, 'p', { activities: ['Email receipt', 'Update CRM'], waitForAll: false }, ids());
    expect(describe(g)).toContain('Order confirmed → Dispatch');
    expect(g.nodes.some((n) => n.label === 'All activities complete')).toBe(false);
  });

  it('needs at least two activities', () => {
    expect(() => addParallel(sequential(), 'a', { activities: ['Only one', ' '], waitForAll: true }, ids())).toThrow(/at least two/);
  });
});

suite('addException (E08)', () => {
  it('adds a labelled exception path and response', () => {
    const g0 = graph({ nodes: [['s', 'start', 'Start'], ['pay', 'action', 'Charge payment'], ['f', 'finish', 'Finish']], edges: [['s', 'pay'], ['pay', 'f']] });
    const { graph: g, focusId } = addException(g0, 'pay', { exception: 'Payment rejected', response: 'Contact customer' }, ids());
    expect(findNode(g, focusId!)).toMatchObject({ type: 'exception', label: 'Payment rejected' });
    expect(describe(g)).toContain('Charge payment -exception-> Payment rejected');
    expect(describe(g)).toContain('Payment rejected → Contact customer');
    expect(g.edges.find((e) => e.type === 'exception')!.label).toBe('Exception');
    expect(describe(g)).toContain('Charge payment → Finish'); // normal path untouched
  });
});

suite('deleteStep (E10, E11)', () => {
  it('lists every affected connection and offers to reconnect a single path', () => {
    const impact = deletionImpact(sequential(), 'b');
    expect(impact.removed.map((e) => e.id).sort()).toEqual(['e2', 'e3']);
    expect(impact.reconnect).toEqual({ sourceId: 'a', targetId: 'f' });
  });

  it('reconnects when asked, keeping a Yes label', () => {
    const g0 = graph({
      nodes: [['s', 'start', 'Start'], ['d', 'decision', 'Ok?'], ['x', 'action', 'Check'], ['f', 'finish', 'Finish']],
      edges: [['s', 'd'], ['d', 'x', 'yes', 'Yes'], ['x', 'f']],
    });
    const { graph: g } = deleteStep(g0, 'x', { reconnect: true }, ids());
    expect(describe(g)).toEqual(['Ok? -yes-> Finish', 'Start → Ok?']);
  });

  it('just removes when not reconnecting; validation then shows the gap', () => {
    const { graph: g } = deleteStep(sequential(), 'b', { reconnect: false }, ids());
    expect(describe(g)).toEqual(['Start → Receive order']);
    expect(validateWorkflow(g).find((i) => i.code === 'unreachable')?.nodeId).toBe('f');
  });

  it('does not offer reconnection for a decision', () => {
    const g0 = graph({ nodes: [['s', 'start', 'Start'], ['d', 'decision', 'Ok?'], ['y', 'action', 'Y'], ['n', 'action', 'N']], edges: [['s', 'd'], ['d', 'y', 'yes', 'Yes'], ['d', 'n', 'no', 'No']] });
    expect(deletionImpact(g0, 'd').reconnect).toBeUndefined();
  });

  it("can't delete Start", () => {
    expect(() => deletionImpact(sequential(), 's')).toThrow(/Start/);
  });

  it('removes loops pointing at the deleted step', () => {
    const g0 = graph({ nodes: [['s', 'start', 'Start'], ['a', 'action', 'A'], ['b', 'action', 'B']], edges: [['s', 'a'], ['a', 'b'], ['b', 'a', 'loop', 'Again']] });
    const { graph: g } = deleteStep(g0, 'a', { reconnect: true }, ids());
    expect(g.edges.every((e) => e.sourceId !== 'a' && e.targetId !== 'a')).toBe(true);
    expect(describe(g)).toEqual(['Start → B']);
  });
});

suite('updateStep and type changes (E09)', () => {
  it('updates details and drops emptied optional fields', () => {
    const { graph: g } = updateStep(sequential(), 'a', { owner: 'Sales team', duration: { value: 5, unit: 'minutes' }, tools: ['CRM'], notes: 'Check email' });
    expect(findNode(g, 'a')).toMatchObject({ owner: 'Sales team', duration: { value: 5, unit: 'minutes' }, tools: ['CRM'], notes: 'Check email' });
    const cleared = updateStep(g, 'a', { owner: '', notes: '', tools: [], duration: undefined }).graph;
    expect(findNode(cleared, 'a')).toEqual({ id: 'a', type: 'action', label: 'Receive order', position: { x: 0, y: 0 } });
  });

  it('only allows Finish for steps that end a path, and never turns a step into a decision this way', () => {
    expect(allowedTypeChanges(sequential(), 'a')).toEqual(['action', 'approval', 'wait']);
    expect(allowedTypeChanges(startOnly(), 's')).toEqual(['start']);
    expect(() => updateStep(sequential(), 'a', { type: 'finish' })).toThrow();
    expect(() => updateStep(sequential(), 'a', { type: 'decision' })).toThrow();
  });

  const decided = () =>
    graph({
      nodes: [['s', 'start', 'Start'], ['d', 'decision', 'In stock?'], ['r', 'action', 'Reserve'], ['o', 'action', 'Reorder'], ['f', 'finish', 'Finish']],
      edges: [['s', 'd'], ['d', 'r', 'yes', 'Yes'], ['d', 'o', 'no', 'No'], ['r', 'f'], ['o', 'f']],
    });

  it('turns a decision into an ordinary step, keeping the chosen path as a plain connection', () => {
    expect(allowedTypeChanges(decided(), 'd')).toEqual(['decision', 'action', 'approval', 'wait']);
    expect(() => updateStep(decided(), 'd', { type: 'action' })).toThrow(/which path/);
    const { graph: g } = updateStep(decided(), 'd', { type: 'action', keepBranch: 'no' });
    expect(findNode(g, 'd')).toEqual({ id: 'd', type: 'action', label: 'In stock?', position: expect.anything() });
    expect(g.edges.filter((e) => e.sourceId === 'd')).toEqual([{ id: 'e3', sourceId: 'd', targetId: 'o', type: 'normal' }]);
    expect(describe(g)).toContain('In stock? → Reorder');
    expect(noIssues(g)).toEqual([]);
    // The steps on the dropped path stay; validation points out that they're no longer reached.
    expect(findNode(g, 'r')).toBeDefined();
    expect(validateWorkflow(g).some((i) => i.code === 'unreachable' && i.nodeId === 'r')).toBe(true);
  });

  it('needs no choice when a decision has one path or none, and can become Finish when nothing follows', () => {
    const onePath = graph({ nodes: [['s', 'start', 'Start'], ['d', 'decision', 'Valid?'], ['a', 'action', 'Process']], edges: [['s', 'd'], ['d', 'a', 'yes', 'Yes']] });
    const g = updateStep(onePath, 'd', { type: 'wait' }).graph;
    expect(g.edges.find((e) => e.sourceId === 'd')).toEqual({ id: 'e2', sourceId: 'd', targetId: 'a', type: 'normal' });
    const noPath = graph({ nodes: [['s', 'start', 'Start'], ['d', 'decision', 'Valid?']], edges: [['s', 'd']] });
    expect(allowedTypeChanges(noPath, 'd')).toContain('finish');
    expect(findNode(updateStep(noPath, 'd', { type: 'finish' }).graph, 'd')!.type).toBe('finish');
  });

  it('keeps a decision\'s loop and exception connections when it becomes an ordinary step', () => {
    const g0 = graph({
      nodes: [['s', 'start', 'Start'], ['a', 'action', 'Pick'], ['d', 'decision', 'Complete?'], ['f', 'finish', 'Finish'], ['x', 'exception', 'Lost']],
      edges: [['s', 'a'], ['a', 'd'], ['d', 'f', 'yes', 'Yes'], ['d', 'a', 'loop'], ['d', 'x', 'exception']],
    });
    const g = updateStep(g0, 'd', { type: 'action', keepBranch: 'yes' }).graph;
    expect(g.edges.filter((e) => e.sourceId === 'd').map((e) => e.type).sort()).toEqual(['exception', 'loop', 'normal']);
  });
});
