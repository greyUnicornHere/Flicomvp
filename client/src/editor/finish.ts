import type { WorkflowGraph } from '../../../shared/graph';
import { flowOut } from './ops';

/**
 * When the process looks complete — at least two steps, no Finish yet, and exactly one path end —
 * suggest adding Finish there. Never added automatically.
 */
export function finishCandidate(g: WorkflowGraph): string | null {
  if (g.nodes.some((n) => n.type === 'finish')) return null;
  const steps = g.nodes.filter((n) => n.type !== 'start');
  if (steps.length < 2) return null;
  const ends = g.nodes.filter((n) => n.type !== 'decision' && n.type !== 'exception' && flowOut(g, n.id).length === 0);
  const openDecision = g.nodes.some((n) => n.type === 'decision' && g.edges.filter((e) => e.sourceId === n.id && (e.type === 'yes' || e.type === 'no')).length < 2);
  return ends.length === 1 && !openDecision ? ends[0]!.id : null;
}
