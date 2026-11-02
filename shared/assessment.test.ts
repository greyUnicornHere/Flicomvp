import { describe, expect, it } from 'vitest';
import { assessmentBasis, isAssessable, needsReassessment } from './assessment.js';
import { nextStep, topOpportunities } from './assessment.js';
import type { WorkflowGraph } from './graph.js';

const g: WorkflowGraph = {
  nodes: [
    { id: 's', type: 'start', label: 'Start', position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', label: 'Receive request', position: { x: 288, y: 0 } },
    { id: 'q', type: 'action', label: 'Send quotation', notes: 'Price from the price list', tools: ['ERP'], position: { x: 576, y: 0 } },
    { id: 'w', type: 'wait', label: 'Wait for reply', position: { x: 864, y: 0 } },
    { id: 'f', type: 'finish', label: 'Done', position: { x: 1152, y: 0 } },
  ],
  edges: [
    { id: 'e1', sourceId: 's', targetId: 'a', type: 'normal' },
    { id: 'e2', sourceId: 'a', targetId: 'q', type: 'normal' },
    { id: 'e3', sourceId: 'q', targetId: 'w', type: 'normal' },
    { id: 'e4', sourceId: 'w', targetId: 'f', type: 'normal' },
  ],
};
const edit = (id: string, change: object): WorkflowGraph => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...change } : n)) });

describe('which steps are assessed', () => {
  it('assesses work, not Start, Finish or waits', () => {
    expect(g.nodes.filter(isAssessable).map((n) => n.id)).toEqual(['a', 'q']);
  });
});

describe('assessment basis (what an assessment depends on)', () => {
  const basis = assessmentBasis(g, 'q')!;

  it('ignores layout: moving steps never makes an assessment stale', () => {
    const moved: WorkflowGraph = { ...g, nodes: g.nodes.map((n) => ({ ...n, position: { x: n.position.x + 40, y: 99 } })) };
    expect(assessmentBasis(moved, 'q')).toBe(basis);
    expect(needsReassessment(moved, { stepId: 'q', basis })).toBe(false);
  });

  it('changes when the task, its tools, notes or owner change', () => {
    for (const change of [{ label: 'Send quote' }, { tools: ['ERP', 'Email'] }, { notes: 'Price negotiated' }, { owner: 'Sales' }, { type: 'approval' }]) {
      expect(needsReassessment(edit('q', change), { stepId: 'q', basis })).toBe(true);
    }
  });

  it('changes when what feeds the step changes, but not what follows it', () => {
    expect(needsReassessment(edit('a', { notes: 'Requests now arrive by phone' }), { stepId: 'q', basis })).toBe(true);
    const rewired: WorkflowGraph = { ...g, edges: g.edges.map((e) => (e.id === 'e2' ? { ...e, sourceId: 's' } : e)) };
    expect(needsReassessment(rewired, { stepId: 'q', basis })).toBe(true);
    expect(needsReassessment(edit('w', { label: 'Wait for the customer' }), { stepId: 'q', basis })).toBe(false);
  });

  it('a deleted step needs reassessment', () => {
    const without: WorkflowGraph = { nodes: g.nodes.filter((n) => n.id !== 'q'), edges: g.edges.filter((e) => e.sourceId !== 'q' && e.targetId !== 'q') };
    expect(assessmentBasis(without, 'q')).toBeNull();
    expect(needsReassessment(without, { stepId: 'q', basis })).toBe(true);
  });
});

describe('concise summaries', () => {
  const a = (classification: 'full' | 'assisted' | 'human' | 'unknown', provisional = false, value = '', id: string = classification) => ({ id, classification, provisional, value });

  it('next step: the first open question, else the first point to verify', () => {
    expect(nextStep({ questions: ['Where does the price come from?'], prerequisites: ['Test access.'] })).toBe('Where does the price come from?');
    expect(nextStep({ questions: [], prerequisites: ['Test access.'] })).toBe('Test access.');
    expect(nextStep({ questions: [], prerequisites: [] })).toBe('');
  });

  it('top opportunities: candidates before assisted, confirmed before provisional, described value first; never human-led, unknown or outdated', () => {
    const list = [a('assisted', false, '', 'A'), a('human'), a('full', true, '', 'B'), a('unknown'), a('full', false, '', 'C'), a('assisted', true, 'Runs 40 times a week.', 'D'), a('full', false, '', 'E')];
    expect(topOpportunities(list, () => false).map((x) => x.id)).toEqual(['C', 'E', 'B']);
    expect(topOpportunities(list, (x) => x.id === 'C', 5).map((x) => x.id)).toEqual(['E', 'B', 'A', 'D']);
    expect(topOpportunities([a('human'), a('unknown')], () => false)).toEqual([]);
  });
});
