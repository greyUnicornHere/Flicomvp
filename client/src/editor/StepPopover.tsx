import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';
import { Check, CircleAlert, GripHorizontal, Link2, Repeat, Sparkles, Trash2, X } from 'lucide-react';
import type { StepType, WorkflowGraph, WorkflowNode } from '../../../shared/graph';
import { placePanel } from '../lib/placement';
import { allowedTypeChanges, BRANCH_LABEL, connectTargets, findNode, openBranches, outgoing, type StepPatch } from './ops';
import { DURATION_UNITS, STEP_META } from './stepMeta';

type Props = {
  graph: WorkflowGraph;
  node: WorkflowNode;
  anchor: () => HTMLElement | null;
  onChange: (patch: StepPatch) => void;
  onClose: (returnFocus: boolean) => void;
  onDelete: () => void;
  onConnect: () => void;
  onRemoveConnection: (edgeId: string) => void;
  onAsk: () => void;
  /** Persistence of this step's details: Saved only once the server has acknowledged them. */
  saveState: 'saving' | 'saved' | 'error';
  saveError: string | null;
  onRetry: () => void;
  /** Save these pending edits (if any) now; resolves true once persisted. */
  onDone: (patch: StepPatch | null) => Promise<boolean>;
  /** Where the person dragged the card this session (null: next to the step). */
  position: { left: number; top: number } | null;
  onMove: (position: { left: number; top: number }) => void;
};

const HEADER = 76;
const MARGIN = 8;

/** Contextual step details next to the selected step (never a permanent inspector). */
export function StepPopover(props: Props) {
  const { graph, node, anchor, onChange, onClose, onDelete, onConnect, onRemoveConnection, onAsk } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [autoPosition, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const transform = useStore((s) => s.transform);
  const titleId = useId();

  const [fields, setFields] = useState(() => toFields(node));
  const latest = useRef(fields);
  useEffect(() => {
    latest.current = fields;
  });

  // Save whatever changed (shortly after typing stops, on blur, Enter, select changes, Done and when closing).
  const commit = (next = latest.current) => {
    const patch = diff(node, next);
    if (patch) onChange(patch);
  };
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  // Typing pauses save automatically; leaving the card (or switching to another step) saves too.
  const pending = diff(node, fields) !== null;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => commitRef.current(), 600);
    return () => clearTimeout(timer);
  }, [fields, pending]);
  useEffect(() => () => commitRef.current(), []);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      const target = anchor();
      if (!el || !target) return;
      setPosition(
        placePanel(target.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight }, 84),
      );
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchor, transform, graph]);

  useEffect(() => {
    if (autoPosition) ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    // Focus once when first shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPosition === null]);

  const close = (returnFocus: boolean) => {
    commit();
    onClose(returnFocus);
  };

  /** Done: save pending edits and close once they are persisted; on failure stay open with Retry. */
  const done = async () => {
    setFinishing(true);
    const ok = await props.onDone(diff(node, latest.current));
    setFinishing(false);
    if (ok) onClose(true);
  };

  // The card can be dragged by its header; it always stays fully inside the window, below Flico's top bar.
  const clamp = (p: { left: number; top: number }) => {
    const width = 320; // the card's fixed width
    const height = Math.min(ref.current?.offsetHeight ?? 400, innerHeight - HEADER - 2 * MARGIN);
    return {
      left: Math.round(Math.min(Math.max(MARGIN, p.left), innerWidth - width - MARGIN)),
      top: Math.round(Math.min(Math.max(HEADER + MARGIN, p.top), innerHeight - height - MARGIN)),
    };
  };
  // Positions are clamped when dragged; on show, just keep the header on screen.
  const position = props.position && autoPosition ? { left: Math.min(props.position.left, innerWidth - 328), top: Math.min(props.position.top, innerHeight - 120) } : autoPosition;
  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea') || !position) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...position };
    const move = (e: PointerEvent) => props.onMove(clamp({ left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y }));
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const moveWithKeys = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta || !position) return;
    event.preventDefault();
    props.onMove(clamp({ left: position.left + delta[0]!, top: position.top + delta[1]! }));
  };

  // Edits still being typed count as saving; otherwise the state of this step's last acknowledged save.
  const status: 'saving' | 'saved' | 'error' = pending ? 'saving' : props.saveState;

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || target.closest?.('[role="dialog"]')) return;
      if (target.closest?.(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  });

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFields({ ...fields, [key]: e.target.value });
  const commitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) commit();
  };

  const types = allowedTypeChanges(graph, node.id);
  const outs = outgoing(graph, node.id);
  const open = openBranches(graph, node.id);
  const canConnect = node.type !== 'finish' && connectTargets(graph, node.id).length > 0 && (node.type !== 'decision' || open.length > 0);
  const label = (id: string) => findNode(graph, id)?.label || 'Untitled step';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      className="fl-popover fixed z-40 w-[320px] overflow-y-auto !p-0"
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: 'calc(100vh - 100px)', visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
        e.stopPropagation(); // keep typing out of canvas shortcuts
      }}
    >
      <div className="flex cursor-move select-none items-center gap-1 px-[10px] pb-1 pt-3" onPointerDown={startDrag} data-testid="details-header">
        <button
          type="button"
          className="grid h-8 w-8 cursor-move place-items-center rounded-[8px] text-fl-text-muted hover:bg-fl-surface-subtle"
          aria-label="Move step details (arrow keys)"
          onKeyDown={moveWithKeys}
        >
          <GripHorizontal size={15} aria-hidden="true" />
        </button>
        <h2 id={titleId} className="flex-1 text-[15px] font-bold leading-[22px]">
          Edit step
        </h2>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-[8px] text-fl-text-secondary hover:bg-fl-surface-subtle" aria-label="Close step details" onClick={() => close(true)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="px-[18px] pb-2 text-[12px]" role="status" aria-live="polite" data-testid="details-save-status" data-state={status}>
        {status === 'saving' && <span className="text-fl-text-muted">Saving…</span>}
        {status === 'saved' && (
          <span className="inline-flex items-center gap-1 text-fl-text-muted">
            <Check size={13} aria-hidden="true" className="text-fl-success" /> Saved
          </span>
        )}
        {status === 'error' && (
          <span className="inline-flex flex-wrap items-center gap-x-2 text-fl-error">
            <CircleAlert size={13} aria-hidden="true" /> Could not save
            <button
              type="button"
              className="fl-link text-[12px]"
              onClick={props.onRetry}
            >
              Retry
            </button>
            {props.saveError && <span className="basis-full text-fl-text-muted">{props.saveError} Your changes are kept here.</span>}
          </span>
        )}
      </div>

      {node.origin === 'ai-inferred' && node.assumptionStatus === 'unconfirmed' && (
        <div className="mx-[18px] mb-2 flex items-center gap-2 rounded-[10px] border border-dashed border-fl-brand bg-fl-brand-pale px-3 py-2 text-[12.5px] leading-[18px] text-fl-brand-active">
          <span className="flex-1">Flico inferred this step. Check it, then confirm.</span>
          <button type="button" className="fl-btn !min-h-8 !px-2.5 !text-[12px]" onClick={() => onChange({ assumptionStatus: 'confirmed' })}>
            Confirm step
          </button>
        </div>
      )}

      <div className="space-y-3 px-[18px] pb-4" onBlur={() => commit()} onKeyDown={commitOnEnter}>
        <Labeled label="Step name">
          {(id) => <input id={id} className="fl-input !min-h-10" value={fields.label} maxLength={200} onChange={set('label')} />}
        </Labeled>
        <Labeled label="Type">
          {(id) =>
            types.length > 1 ? (
              <select
                id={id}
                className="fl-input !min-h-10"
                value={fields.type}
                onChange={(e) => {
                  const next = { ...fields, type: e.target.value as StepType };
                  setFields(next);
                  commit(next);
                }}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {STEP_META[t].name}
                  </option>
                ))}
              </select>
            ) : (
              <p id={id} className="text-[14px] text-fl-text">
                {STEP_META[node.type].name}
              </p>
            )
          }
        </Labeled>
        <Labeled label="Owner / team">
          {(id) => <input id={id} className="fl-input !min-h-10" value={fields.owner} maxLength={200} onChange={set('owner')} />}
        </Labeled>
        <Labeled label="Duration">
          {(id) => (
            <div className="flex gap-2">
              <input id={id} className="fl-input !min-h-10 w-[96px]" type="number" min={0} step="any" inputMode="decimal" value={fields.durationValue} onChange={set('durationValue')} />
              <select className="fl-input !min-h-10 flex-1" aria-label="Duration unit" value={fields.durationUnit} onChange={set('durationUnit')}>
                {DURATION_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          )}
        </Labeled>
        <Labeled label="Tools / software" hint="comma-separated">
          {(id) => <input id={id} className="fl-input !min-h-10" value={fields.tools} maxLength={600} onChange={set('tools')} />}
        </Labeled>
        <Labeled label="Notes">
          {(id) => <textarea id={id} className="fl-input min-h-[72px] resize-y" value={fields.notes} maxLength={2000} placeholder="Add details (optional)" onChange={set('notes')} />}
        </Labeled>
      </div>

      <div className="border-t border-fl-border px-[18px] py-3">
        <h3 className="text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary">Connections</h3>
        <ul className="mt-1.5 space-y-1">
          {outs.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-[13px]">
              {e.type === 'loop' && <Repeat size={13} aria-hidden="true" className="text-fl-text-secondary" />}
              <span className="min-w-0 flex-1 truncate">
                {e.type === 'loop' ? 'Repeats ' : e.type === 'exception' ? 'Exception: ' : e.label ? `${e.label} → ` : '→ '}
                {label(e.targetId)}
              </span>
              <button
                type="button"
                className="grid h-8 w-8 flex-none place-items-center rounded-[8px] text-fl-text-secondary hover:bg-[var(--fl-exception-fill)] hover:text-fl-error"
                aria-label={`Remove connection to “${label(e.targetId)}”`}
                onClick={() => onRemoveConnection(e.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
          {open.map((b) => (
            <li key={b} className="text-[13px] text-fl-text-muted">
              {BRANCH_LABEL[b]} path: not set yet
            </li>
          ))}
          {outs.length === 0 && open.length === 0 && <li className="text-[13px] text-fl-text-muted">This step doesn't continue yet.</li>}
        </ul>
        {canConnect && (
          <button type="button" className="fl-link mt-2 inline-flex items-center gap-1.5 text-[13px] no-underline hover:underline" onClick={onConnect}>
            <Link2 size={14} aria-hidden="true" /> Connect to a step…
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-fl-border px-[18px] py-3">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-fl-brand hover:bg-fl-brand-pale"
          onClick={() => {
            commit();
            onAsk();
          }}
        >
          <Sparkles size={14} aria-hidden="true" /> Ask Flico about this step
        </button>
        {node.type !== 'start' && (
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-semibold text-fl-error hover:bg-[var(--fl-exception-fill)]" onClick={onDelete}>
            <Trash2 size={14} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
      <div className="flex justify-end border-t border-fl-border px-[18px] py-3">
        <button type="button" className="fl-btn fl-btn-primary !min-h-10 !px-5" onClick={() => void done()} disabled={finishing}>
          {finishing ? 'Saving…' : 'Done'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

type Fields = { label: string; type: StepType; owner: string; durationValue: string; durationUnit: string; tools: string; notes: string };

function toFields(n: WorkflowNode): Fields {
  return {
    label: n.label,
    type: n.type,
    owner: n.owner ?? '',
    durationValue: n.duration ? String(n.duration.value) : '',
    durationUnit: n.duration?.unit ?? 'minutes',
    tools: (n.tools ?? []).join(', '),
    notes: n.notes ?? '',
  };
}

/** Only the fields that actually changed, normalised the way they are stored. */
function diff(n: WorkflowNode, f: Fields): StepPatch | null {
  const patch: StepPatch = {};
  if (f.label.trim() && f.label.trim() !== n.label) patch.label = f.label.trim();
  if (f.type !== n.type) patch.type = f.type;
  if (f.owner.trim() !== (n.owner ?? '')) patch.owner = f.owner.trim();
  if (f.notes.trim() !== (n.notes ?? '')) patch.notes = f.notes.trim();
  const tools = f.tools.split(',').map((t) => t.trim()).filter(Boolean);
  if (tools.join('\n') !== (n.tools ?? []).join('\n')) patch.tools = tools;
  const value = f.durationValue.trim() === '' ? null : Number(f.durationValue);
  const current = n.duration;
  if (value === null || !Number.isFinite(value) || value < 0) {
    if (current) patch.duration = undefined;
  } else if (!current || current.value !== value || current.unit !== f.durationUnit) {
    patch.duration = { value, unit: f.durationUnit };
  }
  return Object.keys(patch).length ? patch : null;
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary">
        {label}
        {hint && <span className="ml-1 font-normal normal-case tracking-normal text-fl-text-muted">({hint})</span>}
      </label>
      <div className="mt-1">{children(id)}</div>
    </div>
  );
}
