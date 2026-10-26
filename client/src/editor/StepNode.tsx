import { useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Plus } from 'lucide-react';
import type { WorkflowNode } from '../../../shared/graph';
import { useEditorUi } from './EditorContext';
import { BRANCH_LABEL, flowOut, openBranches, type Slot } from './ops';
import { focusWhenReady } from './focus';
import { STEP_META } from './stepMeta';

export type StepFlowNode = Node<{ step: WorkflowNode }, 'step'>;

const hiddenHandle = '!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-transparent';

/** Organic step block: icon + up to two lines of name. Selection is an outline only; nodes never move or morph. */
export function StepNode({ id, data, selected }: NodeProps<StepFlowNode>) {
  const ui = useEditorUi();
  const { step } = data;
  const Icon = STEP_META[step.type].icon;
  const issues = ui.issuesByNode.get(id) ?? [];
  const editing = ui.editingId === id;
  const open = openBranches(ui.graph, id);
  const endsPath = step.type !== 'finish' && step.type !== 'decision' && flowOut(ui.graph, id).length === 0;

  const add = (slot: Slot) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    ui.openInsertMenu(slot, event.currentTarget);
  };

  return (
    <div
      className="fl-node fl-step"
      data-type={step.type}
      data-selected={selected ? 'true' : undefined}
      title={step.label}
    >
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} className={hiddenHandle} />
      <Handle type="source" position={Position.Right} id="out" isConnectable={false} className={hiddenHandle} />
      <Handle type="source" position={Position.Right} id="loop-out" isConnectable={false} className={hiddenHandle} style={{ top: '72%' }} />
      <Handle type="target" position={Position.Left} id="loop-in" isConnectable={false} className={hiddenHandle} style={{ top: '72%' }} />

      <span className="fl-node-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={2.25} />
      </span>
      {editing ? (
        <NameInput initial={step.label} onCommit={(label) => ui.commitName(id, label)} onCancel={ui.cancelName} />
      ) : (
        <span className="fl-node-label min-w-0 flex-1 text-left">{step.label || 'Untitled step'}</span>
      )}

      {issues.length > 0 && (
        <span className="fl-step-issue" aria-hidden="true">
          <AlertTriangle size={12} strokeWidth={2.5} />
        </span>
      )}

      {endsPath && (
        <button type="button" className="fl-step-add nodrag nopan" aria-label={`Add a step after “${step.label}”`} onClick={add({ kind: 'after', nodeId: id })}>
          <Plus size={16} aria-hidden="true" />
        </button>
      )}
      {open.map((branch) => (
        <button
          key={branch}
          type="button"
          className="fl-step-branch nodrag nopan"
          data-branch={branch}
          aria-label={`Add the ${BRANCH_LABEL[branch]} path of “${step.label}”`}
          onClick={add({ kind: 'branch', nodeId: id, branch })}
        >
          <Plus size={13} aria-hidden="true" /> {BRANCH_LABEL[branch]}
        </button>
      ))}
    </div>
  );
}

/** Inline name editor for a just-added step: focused and selected; Enter or leaving saves, Escape keeps the default. */
function NameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (label: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onCommit });
  useEffect(() => {
    latest.current = { value, onCommit };
  });
  useEffect(() => focusWhenReady(() => ref.current, { select: true }), []);
  // Clicking elsewhere on the canvas doesn't move focus (dragging prevents it), so save explicitly.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Element)) latest.current.onCommit(latest.current.value);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  return (
    <input
      ref={ref}
      className="nodrag nopan min-w-0 flex-1 rounded-[6px] border border-fl-border-strong bg-white px-1.5 py-0.5 text-[13px] font-[650] leading-[18px] text-fl-text"
      aria-label="Step name"
      value={value}
      maxLength={200}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') onCommit(value);
        if (event.key === 'Escape') onCancel();
      }}
      onBlur={() => onCommit(value)}
    />
  );
}
