import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from './graph';
import { preAnalysisCheck, validateWorkflow } from './validation';

const node = (id: string, type: WorkflowGraph['nodes'][number]['type'], label: string) => ({ id, type, label, position: { x: 0, y: 0 } });
const codes = (g: WorkflowGraph) => validateWorkflow(g).map((i) => i.code).sort();

describe('validateWorkflow', () => {
  it('accepts an unfinished but connected workflow without warnings', () => {
    const g: WorkflowGraph = { nodes: [node('s', 'start', 'Start'), node('a', 'action', 'Receive order')], edges: [{ id: 'e', sourceId: 's', targetId: 'a', type: 'normal' }] };
    expect(validateWorkflow(g)).toEqual([]);
  });

  it('reports disconnected steps, missing branches, dangling and unlabelled paths (QA fixture 7)', () => {
    const g: WorkflowGraph = {
      nodes: [node('s', 'start', 'Start'), node('d', 'decision', 'Approved?'), node('lost', 'action', 'Archive'), node('x', 'action', ' ')],
      edges: [
        { id: 'e1', sourceId: 's', targetId: 'd', type: 'normal' },
        { id: 'e2', sourceId: 'd', targetId: 'x', type: 'yes' },
        { id: 'e3', sourceId: 'd', targetId: 'ghost', type: 'normal' },
      ],
    };
    expect(codes(g)).toEqual(
      ['dangling_connection', 'decision_missing_branch', 'decision_unlabeled_path', 'empty_name', 'missing_branch_label', 'unreachable'].sort(),
    );
    const missing = validateWorkflow(g).find((i) => i.code === 'decision_missing_branch')!;
    expect(missing).toMatchObject({ nodeId: 'd', message: '“Approved?” has no No path yet.' });
    expect(validateWorkflow(g).find((i) => i.code === 'unreachable')).toMatchObject({ nodeId: 'lost', message: '“Archive” isn\'t connected to the rest of the workflow.' });
  });

  it('flags missing or duplicate Start and Finish that continues', () => {
    expect(codes({ nodes: [node('a', 'action', 'A')], edges: [] })).toEqual(['no_start']);
    const g: WorkflowGraph = {
      nodes: [node('s', 'start', 'Start'), node('s2', 'start', 'Start'), node('f', 'finish', 'Finish'), node('a', 'action', 'A')],
      edges: [{ id: 'e1', sourceId: 's', targetId: 'f', type: 'normal' }, { id: 'e2', sourceId: 'f', targetId: 'a', type: 'normal' }],
    };
    // 'A' is still reachable (through Finish), so only these two are reported.
    expect(codes(g)).toEqual(['finish_has_next', 'multiple_start']);
  });

  it('flags a parallel group with a single activity', () => {
    const g: WorkflowGraph = {
      nodes: [node('s', 'start', 'Start'), node('a', 'action', 'A')],
      edges: [{ id: 'e1', sourceId: 's', targetId: 'a', type: 'parallel', branchGroupId: 'p' }],
    };
    expect(codes(g)).toEqual(['parallel_too_few']);
  });

  it('gives each issue a stable id', () => {
    const g: WorkflowGraph = { nodes: [node('s', 'start', 'Start'), node('d', 'decision', 'Q?')], edges: [{ id: 'e', sourceId: 's', targetId: 'd', type: 'normal' }] };
    expect(validateWorkflow(g).map((i) => i.id)).toEqual(['decision_missing_branch:d:yes', 'decision_missing_branch:d:no']);
  });
});

describe('preAnalysisCheck', () => {
  it('blocks a Start-only workflow but not one with warnings', () => {
    expect(preAnalysisCheck({ nodes: [node('s', 'start', 'Start')], edges: [] })).toMatchObject({ canAnalyze: false });
    const withWarning: WorkflowGraph = { nodes: [node('s', 'start', 'Start'), node('d', 'decision', 'Q?')], edges: [{ id: 'e', sourceId: 's', targetId: 'd', type: 'normal' }] };
    const result = preAnalysisCheck(withWarning);
    expect(result.canAnalyze).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });
});
