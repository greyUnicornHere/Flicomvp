// Describe a step: how the details Flico read from the person's description combine with what the
// step already has. Nothing already there is lost: tools are added to, notes are appended to, and the
// owner and duration are replaced only when the description says something different.
import type { DescribedFields } from '../../../shared/api';
import { GRAPH_LIMITS, type WorkflowNode } from '../../../shared/graph';
import type { StepPatch } from './ops';

export type FilledField = 'owner' | 'tools' | 'duration' | 'notes';

export function describedPatch(node: WorkflowNode, fields: DescribedFields): { patch: StepPatch; before: StepPatch; filled: FilledField[] } {
  const patch: StepPatch = {};
  const before: StepPatch = {};
  const filled: FilledField[] = [];
  if (fields.owner && fields.owner !== node.owner) {
    patch.owner = fields.owner;
    before.owner = node.owner ?? '';
    filled.push('owner');
  }
  if (fields.tools?.length) {
    const have = node.tools ?? [];
    const added = fields.tools.filter((t) => !have.some((h) => h.toLowerCase() === t.toLowerCase()));
    if (added.length) {
      patch.tools = [...have, ...added];
      before.tools = have;
      filled.push('tools');
    }
  }
  if (fields.duration && (node.duration?.value !== fields.duration.value || node.duration?.unit !== fields.duration.unit)) {
    patch.duration = fields.duration;
    before.duration = node.duration;
    filled.push('duration');
  }
  const notes = fields.notes?.trim();
  if (notes && !(node.notes ?? '').includes(notes)) {
    patch.notes = (node.notes ? `${node.notes}\n${notes}` : notes).slice(0, GRAPH_LIMITS.maxText);
    before.notes = node.notes ?? '';
    filled.push('notes');
  }
  return { patch, before, filled };
}
