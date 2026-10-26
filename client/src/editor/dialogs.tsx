import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { WorkflowNode } from '../../../shared/graph';
import { Modal } from '../components/Modal';
import type { DecisionInput, DeletionImpact, ExceptionInput, ParallelInput } from './ops';
import { BRANCH_LABEL } from './ops';

type Base = { onCancel: () => void };

/** Shared form scaffold: labelled fields, inline error, Cancel + primary action. */
function FormDialog({
  title,
  submitLabel,
  onCancel,
  onSubmit,
  children,
  danger = false,
}: Base & { title: string; submitLabel: string; onSubmit: () => string | null; children: ReactNode; danger?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(onSubmit());
  };
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="fl-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className={danger ? 'fl-btn border-fl-error bg-fl-error text-white hover:bg-[var(--fl-exception-ink)]' : 'fl-btn fl-btn-primary'}
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="mt-1 space-y-4">
        {children}
        {error && (
          <p role="alert" className="text-[13px] leading-5 text-fl-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-semibold leading-5 text-fl-text">
        {label}
        {hint && <span className="ml-1 font-normal text-fl-text-muted">{hint}</span>}
      </label>
      <div className="mt-1.5">{children(id)}</div>
    </div>
  );
}

// ---------- Decision ----------

export function DecisionDialog({ downstreamLabel, onCancel, onConfirm }: Base & { downstreamLabel?: string; onConfirm: (input: DecisionInput) => string | null }) {
  const [question, setQuestion] = useState('');
  const [yes, setYes] = useState('');
  const [no, setNo] = useState('');
  const [continueWith, setContinueWith] = useState<'both' | 'yes' | 'no'>('both');
  return (
    <FormDialog
      title="Add a decision"
      submitLabel="Add decision"
      onCancel={onCancel}
      onSubmit={() => {
        if (!question.trim()) return 'Please enter the decision question.';
        return onConfirm({ question, yes, no, ...(downstreamLabel ? { continueWith } : {}) });
      }}
    >
      <Field label="Decision question">
        {(id) => <input id={id} className="fl-input" value={question} maxLength={200} autoFocus placeholder="e.g. Item in stock?" onChange={(e) => setQuestion(e.target.value)} />}
      </Field>
      <Field label="If yes, what happens next?" hint="(optional)">
        {(id) => <input id={id} className="fl-input" value={yes} maxLength={200} onChange={(e) => setYes(e.target.value)} />}
      </Field>
      <Field label="If no, what happens next?" hint="(optional)">
        {(id) => <input id={id} className="fl-input" value={no} maxLength={200} onChange={(e) => setNo(e.target.value)} />}
      </Field>
      <p className="text-[12px] leading-[18px] text-fl-text-muted">Leave an outcome blank to add it later. It stays as an open path.</p>
      {downstreamLabel && (
        <fieldset>
          <legend className="text-[13px] font-semibold leading-5 text-fl-text">Afterwards, which paths continue to “{downstreamLabel}”?</legend>
          <div className="mt-1.5 space-y-1">
            {(
              [
                ['both', 'Both paths join again (suggested)'],
                ['yes', 'Only the Yes path; the No path ends separately'],
                ['no', 'Only the No path; the Yes path ends separately'],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="flex min-h-9 items-center gap-2 text-[14px]">
                <input type="radio" name="continue" value={value} checked={continueWith === value} onChange={() => setContinueWith(value)} />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </FormDialog>
  );
}

// ---------- Repeat earlier step ----------

export function LoopDialog({ fromLabel, targets, onCancel, onConfirm }: Base & { fromLabel: string; targets: WorkflowNode[]; onConfirm: (targetId: string, condition: string) => string | null }) {
  const [target, setTarget] = useState(targets.at(-1)?.id ?? '');
  const [condition, setCondition] = useState('');
  return (
    <FormDialog title="Repeat an earlier step" submitLabel="Add repeat" onCancel={onCancel} onSubmit={() => (target ? onConfirm(target, condition) : 'Choose the step to go back to.')}>
      <p>After “{fromLabel}”, the process can go back to an earlier step.</p>
      <Field label="Go back to">
        {(id) => (
          <select id={id} className="fl-input" value={target} autoFocus onChange={(e) => setTarget(e.target.value)}>
            {targets.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label || 'Untitled step'}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="When does it repeat?" hint="(optional)">
        {(id) => <input id={id} className="fl-input" value={condition} maxLength={80} placeholder="e.g. Needs correction" onChange={(e) => setCondition(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---------- Parallel activities ----------

export function ParallelDialog({ fromLabel, continuesTo, onCancel, onConfirm }: Base & { fromLabel: string; continuesTo?: string; onConfirm: (input: ParallelInput) => string | null }) {
  const [activities, setActivities] = useState(['', '']);
  const [waitForAll, setWaitForAll] = useState(true);
  const lastRef = useRef<HTMLInputElement>(null);
  return (
    <FormDialog
      title="Add parallel activities"
      submitLabel="Add activities"
      onCancel={onCancel}
      onSubmit={() => (activities.filter((a) => a.trim()).length < 2 ? 'Describe at least two activities that happen at the same time.' : onConfirm({ activities, waitForAll }))}
    >
      <p>Activities that happen at the same time after “{fromLabel}”.</p>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-semibold leading-5 text-fl-text">Activities</legend>
        {activities.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              ref={index === activities.length - 1 ? lastRef : undefined}
              className="fl-input"
              aria-label={`Activity ${index + 1}`}
              value={value}
              maxLength={200}
              autoFocus={index === 0}
              onChange={(e) => setActivities(activities.map((a, i) => (i === index ? e.target.value : a)))}
            />
            {activities.length > 2 && (
              <button type="button" className="fl-icon-btn flex-none" aria-label={`Remove activity ${index + 1}`} onClick={() => setActivities(activities.filter((_, i) => i !== index))}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {activities.length < 6 && (
          <button
            type="button"
            className="fl-link inline-flex items-center gap-1 no-underline hover:underline"
            onClick={() => {
              setActivities([...activities, '']);
              requestAnimationFrame(() => lastRef.current?.focus());
            }}
          >
            <Plus size={15} aria-hidden="true" /> Add another activity
          </button>
        )}
      </fieldset>
      <label className="flex items-start gap-2 text-[14px]">
        <input type="checkbox" className="mt-1" checked={waitForAll} onChange={(e) => setWaitForAll(e.target.checked)} />
        <span>
          All activities must finish before continuing
          <span className="block text-[12px] text-fl-text-muted">
            {waitForAll
              ? `Adds an “All activities complete” step${continuesTo ? ` before “${continuesTo}”` : ''}.`
              : continuesTo
                ? `The process continues to “${continuesTo}” without waiting.`
                : 'Each activity ends on its own.'}
          </span>
        </span>
      </label>
    </FormDialog>
  );
}

// ---------- Exception ----------

export function ExceptionDialog({ stepLabel, onCancel, onConfirm }: Base & { stepLabel: string; onConfirm: (input: ExceptionInput) => string | null }) {
  const [exception, setException] = useState('');
  const [response, setResponse] = useState('');
  return (
    <FormDialog title="Add an exception" submitLabel="Add exception" onCancel={onCancel} onSubmit={() => (exception.trim() ? onConfirm({ exception, response }) : 'Describe what can go wrong.')}>
      <Field label={`What can go wrong at “${stepLabel}”?`}>
        {(id) => <input id={id} className="fl-input" value={exception} maxLength={200} autoFocus placeholder="e.g. Payment rejected" onChange={(e) => setException(e.target.value)} />}
      </Field>
      <Field label="What happens then?" hint="(optional)">
        {(id) => <input id={id} className="fl-input" value={response} maxLength={200} placeholder="e.g. Contact customer" onChange={(e) => setResponse(e.target.value)} />}
      </Field>
    </FormDialog>
  );
}

// ---------- Delete step ----------

export function DeleteStepDialog({ impact, labelOf, onCancel, onConfirm }: Base & { impact: DeletionImpact; labelOf: (id: string) => string; onConfirm: (reconnect: boolean) => void }) {
  const [reconnect, setReconnect] = useState(true);
  const describe = (sourceId: string, targetId: string, label?: string) =>
    `${labelOf(sourceId)} → ${labelOf(targetId)}${label ? ` (${label})` : ''}`;
  return (
    <FormDialog
      title="Delete this step?"
      submitLabel="Delete step"
      danger
      onCancel={onCancel}
      onSubmit={() => {
        onConfirm(reconnect && !!impact.reconnect);
        return null;
      }}
    >
      <p>
        “{impact.node.label || 'Untitled step'}” will be removed.
        {impact.removed.length === 0 ? ' It has no connections.' : ` These ${impact.removed.length === 1 ? 'connection is' : `${impact.removed.length} connections are`} removed too:`}
      </p>
      {impact.removed.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-fl-text">
          {impact.removed.map((e) => (
            <li key={e.id}>{describe(e.sourceId, e.targetId, e.label)}</li>
          ))}
        </ul>
      )}
      {impact.reconnect && (
        <label className="flex items-start gap-2 text-[14px]">
          <input type="checkbox" className="mt-1" checked={reconnect} onChange={(e) => setReconnect(e.target.checked)} />
          <span>Keep the path joined: connect {describe(impact.reconnect.sourceId, impact.reconnect.targetId, impact.reconnect.label)}</span>
        </label>
      )}
      <p className="text-[12px] text-fl-text-muted">You can undo this.</p>
    </FormDialog>
  );
}

// ---------- Connect to a step ----------

export function ConnectDialog({
  fromLabel,
  suggestions,
  targets,
  branches,
  onCancel,
  onConfirm,
}: Base & {
  fromLabel: string;
  suggestions: WorkflowNode[];
  targets: WorkflowNode[];
  branches: ('yes' | 'no')[];
  onConfirm: (targetId: string, branch?: 'yes' | 'no') => string | null;
}) {
  const others = targets.filter((t) => !suggestions.some((s) => s.id === t.id));
  const [target, setTarget] = useState(suggestions[0]?.id ?? others[0]?.id ?? '');
  const [branch, setBranch] = useState(branches[0]);
  const option = (n: WorkflowNode) => (
    <option key={n.id} value={n.id}>
      {n.label || 'Untitled step'}
    </option>
  );
  return (
    <FormDialog title="Connect to a step" submitLabel="Connect" onCancel={onCancel} onSubmit={() => (target ? onConfirm(target, branch) : 'Choose a step.')}>
      {branches.length > 0 && (
        <fieldset>
          <legend className="text-[13px] font-semibold leading-5 text-fl-text">Which path of “{fromLabel}”?</legend>
          <div className="mt-1.5 flex gap-4">
            {branches.map((b) => (
              <label key={b} className="flex min-h-9 items-center gap-2 text-[14px]">
                <input type="radio" name="branch" checked={branch === b} onChange={() => setBranch(b)} /> {BRANCH_LABEL[b]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label={`After “${fromLabel}”, continue to`}>
        {(id) => (
          <select id={id} className="fl-input" value={target} autoFocus onChange={(e) => setTarget(e.target.value)}>
            {suggestions.length > 0 && <optgroup label="Suggested">{suggestions.map(option)}</optgroup>}
            {others.length > 0 && <optgroup label={suggestions.length ? 'Other steps' : 'Steps'}>{others.map(option)}</optgroup>}
          </select>
        )}
      </Field>
      <p className="text-[12px] text-fl-text-muted">To go back to an earlier step, use Repeat earlier step instead.</p>
    </FormDialog>
  );
}
