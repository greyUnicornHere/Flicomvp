import { useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { AlertTriangle, CircleHelp, Handshake, Plus, RefreshCw, User, Zap } from 'lucide-react';
import { CLASS_LABEL, CLASS_SHORT, type AutomationClass } from '../../../shared/assessment';
import type { WorkflowNode } from '../../../shared/graph';
import { CHANGE_BADGE, type Change } from './changes';
import { useEditorUi } from './EditorContext';
import { BRANCH_LABEL, flowOut, openBranches, type Slot } from './ops';
import { focusWhenReady } from './focus';
import { STEP_META } from './stepMeta';

export type StepFlowNode = Node<{ step: WorkflowNode; change?: Change; focus?: 'on' | 'dim' }, 'step'>;

const hiddenHandle = '!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-transparent';

/** Organic step block: icon + up to two lines of name. Selection is an outline only; nodes never move or morph. */
export function StepNode({ id, data, selected }: NodeProps<StepFlowNode>) {
  const ui = useEditorUi();
  const { step, change, focus } = data;
  const Icon = STEP_META[step.type].icon;
  const issues = ui.issuesByNode.get(id) ?? [];
  const editing = ui.editingId === id;
  // While an AI proposal is previewed the canvas is read-only: no add buttons.
  const open = ui.previewing ? [] : openBranches(ui.graph, id);
  const endsPath = !ui.previewing && step.type !== 'finish' && step.type !== 'decision' && flowOut(ui.graph, id).length === 0;
  const inferred = step.origin === 'ai-inferred' && step.assumptionStatus === 'unconfirmed';
  const assessed = ui.assessments?.get(id);

  const add = (slot: Slot) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    ui.openInsertMenu(slot, event.currentTarget);
  };

  return (
    <div
      className="fl-node fl-step"
      data-type={step.type}
      data-selected={selected ? 'true' : undefined}
      data-diff={change}
      data-focus={focus}
      title={step.label}
    >
      {change && (
        <span className="fl-diff-badge" data-diff={change} aria-hidden="true">
          {CHANGE_BADGE[change]}
        </span>
      )}
      {inferred && !change && (
        <span className="fl-inferred" aria-hidden="true">
          Inferred
        </span>
      )}
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

      {assessed && (
        <button
          type="button"
          className="fl-auto-badge nodrag nopan"
          data-class={assessed.assessment.classification}
          data-provisional={assessed.assessment.provisional || undefined}
          data-stale={assessed.stale || undefined}
          aria-label={`Automation assessment for “${step.label}”: ${automationLabel(assessed.assessment.classification, assessed.assessment.provisional, assessed.stale)}`}
          title={automationLabel(assessed.assessment.classification, assessed.assessment.provisional, assessed.stale)}
          // The label has its own action: it never selects the step or a recommendation.
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ui.openAssessment?.(id);
          }}
        >
          {assessed.stale ? <RefreshCw size={12} aria-hidden="true" /> : <ClassIcon kind={assessed.assessment.classification} />}
          <span>{CLASS_SHORT[assessed.assessment.classification]}</span>
        </button>
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

const CLASS_ICON = { full: Zap, assisted: Handshake, human: User, unknown: CircleHelp } as const;

function ClassIcon({ kind }: { kind: AutomationClass }) {
  const Icon = CLASS_ICON[kind];
  return <Icon size={12} aria-hidden="true" />;
}

/** The full meaning of an automation label (its visible text is shorter). */
function automationLabel(kind: AutomationClass, provisional: boolean, stale: boolean): string {
  if (stale) return `${CLASS_LABEL[kind]}, needs reassessment (the step changed after the analysis)`;
  return `${CLASS_LABEL[kind]}${provisional ? ' (provisional)' : ''}`;
}
