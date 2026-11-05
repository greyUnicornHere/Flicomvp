import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';
import { Check, ChevronRight, CircleAlert, GripVertical, Link2, Repeat, Sparkles, Trash2, X } from 'lucide-react';
import type { StepType, WorkflowGraph, WorkflowNode } from '../../../shared/graph';
import { placePanel } from '../lib/placement';
import { allowedTypeChanges, BRANCH_LABEL, connectTargets, decisionPaths, findNode, openBranches, outgoing, type StepPatch } from './ops';
import { DURATION_UNITS, STEP_META } from './stepMeta';
import type { FilledField } from './describe';

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
  /** Details just filled from the person's description: shown with a banner and marked as new. */
  filled?: { fields: FilledField[]; missing: string[]; fixture: boolean } | null;
  onUndoFill?: () => void;
  /** Open the Describe box for this step. */
  onDescribe?: () => void;
};

const HEADER = 76;
const MARGIN = 8;
/** The card's fixed width. */
const WIDTH = 340;
const MAX_TOOLS = 20;

/**
 * Contextual step details next to the selected step (never a permanent inspector). Compact: the
 * header carries the step's type, name and save state; Type and Owner are always shown; duration,
 * tools, notes and connections fold away.
 */
export function StepPopover(props: Props) {
  const { graph, node, anchor, onChange, onClose, onDelete, onConnect, onRemoveConnection, onAsk } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [autoPosition, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const transform = useStore((s) => s.transform);

  const [fields, setFields] = useState(() => toFields(node));
  // The name wraps onto as many lines as it needs, so the whole name is always visible.
  const nameRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [fields.label]);
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

  const types = allowedTypeChanges(graph, node.id);
  const outs = outgoing(graph, node.id);
  const open = openBranches(graph, node.id);
  const canConnect = node.type !== 'finish' && connectTargets(graph, node.id).length > 0 && (node.type !== 'decision' || open.length > 0);
  const label = (id: string) => findNode(graph, id)?.label || 'Untitled step';
  const connectionText = (e: (typeof outs)[number]) =>
    `${e.type === 'loop' ? 'Repeats ' : e.type === 'exception' ? 'Exception: ' : e.label ? `${e.label} → ` : '→ '}${label(e.targetId)}`;

  // Duration, tools and notes always start folded; the summary line shows what's inside (owner choice).
  // Closed by default (owner feedback); open when a description just filled one of its fields.
  const [moreOpen, setMoreOpen] = useState(() => !!props.filled?.fields.some((f) => f !== 'owner'));
  const isNew = (field: FilledField) => !!props.filled?.fields.includes(field);
  // Connections fold away too, unless a Yes/No path still needs setting.
  const [connectionsOpen, setConnectionsOpen] = useState(() => open.length > 0);
  const moreId = useId();
  const connectionsId = useId();
  // Turning a decision with both paths set into another type first asks which path stays.
  const paths = node.type === 'decision' ? decisionPaths(graph, node.id) : [];
  const [pendingType, setPendingType] = useState<StepType | null>(null);
  const [keep, setKeep] = useState<'yes' | 'no'>('yes');
  const confirmTypeChange = () => {
    if (!pendingType) return;
    const next = { ...fields, type: pendingType, keepBranch: keep };
    setPendingType(null);
    setFields(next);
    commit(next);
  };

  // The card's height changes as sections open and close; it is placed again so it stays on screen.
  const [height, setHeight] = useState(0);
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
    const el = ref.current;
    const resized = typeof ResizeObserver === 'undefined' || !el ? null : new ResizeObserver(() => {
      setHeight(el.offsetHeight);
      place();
    });
    if (resized && el) resized.observe(el);
    return () => {
      removeEventListener('resize', place);
      resized?.disconnect();
    };
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
    const height = Math.min(ref.current?.offsetHeight ?? 400, innerHeight - HEADER - 2 * MARGIN);
    return {
      left: Math.round(Math.min(Math.max(MARGIN, p.left), innerWidth - WIDTH - MARGIN)),
      top: Math.round(Math.min(Math.max(HEADER + MARGIN, p.top), innerHeight - height - MARGIN)),
    };
  };
  // A dragged position is kept, moved up only as far as needed for the whole card to stay on screen.
  const visibleHeight = Math.min(height || 120, innerHeight - HEADER - 2 * MARGIN);
  const position =
    props.position && autoPosition
      ? {
          left: Math.min(props.position.left, innerWidth - WIDTH - MARGIN),
          top: Math.max(HEADER + MARGIN, Math.min(props.position.top, innerHeight - visibleHeight - MARGIN)),
        }
      : autoPosition;
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

  const set = (key: 'label' | 'owner' | 'durationValue' | 'durationUnit' | 'notes') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFields({ ...fields, [key]: e.target.value });
  const commitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) commit();
  };

  const addTool = (raw: string) => {
    const tools = [...fields.tools];
    for (const name of raw.split(',').map((t) => t.trim()).filter(Boolean)) if (!tools.includes(name) && tools.length < MAX_TOOLS) tools.push(name);
    const next = { ...fields, tools, toolDraft: '' };
    setFields(next);
    commit(next);
  };
  const removeTool = (name: string) => {
    const next = { ...fields, tools: fields.tools.filter((t) => t !== name) };
    setFields(next);
    commit(next);
  };

  const meta = STEP_META[fields.type];
  const TypeIcon = meta.icon;
  const tone = (part: 'fill' | 'stroke' | 'ink') => `var(--fl-${fields.type}-${part})`;
  const moreSummary =
    [fields.durationValue.trim() && `${fields.durationValue.trim()} ${fields.durationUnit}`, ...fields.tools, fields.toolDraft.trim(), fields.notes.trim() && 'Notes']
      .filter(Boolean)
      .join(' · ') || 'Duration, tools, notes';
  const connectionsSummary =
    outs.length > 0 ? outs.map(connectionText).join(', ') : open.length > 0 ? `${open.map((b) => BRANCH_LABEL[b]).join(' and ')} path not set` : "Doesn't continue yet";

  const fieldLabel = 'text-[13px] font-medium leading-[18px] text-fl-text-secondary';
  const row = 'grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2.5';
  const foldButton = 'flex min-h-10 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] font-semibold text-fl-text hover:bg-fl-surface-subtle';
  const chevron = (isOpen: boolean) => `flex-none text-fl-text-secondary transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Edit step"
      className="fl-popover fixed z-40 overflow-y-auto !p-0"
      style={{ width: WIDTH, top: position?.top ?? 0, left: position?.left ?? 0, maxHeight: 'calc(100vh - 100px)', visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
        e.stopPropagation(); // keep typing out of canvas shortcuts
      }}
    >
      <div
        className="flex cursor-move select-none items-start gap-2 border-b py-3 pl-2 pr-2.5"
        style={{ background: tone('fill'), borderColor: tone('stroke') }}
        onPointerDown={startDrag}
        data-testid="details-header"
      >
        <button
          type="button"
          className="grid h-9 w-7 flex-none cursor-move place-items-center rounded-[8px] text-fl-text-secondary hover:bg-white/60"
          aria-label="Move step details (arrow keys)"
          onKeyDown={moveWithKeys}
        >
          <GripVertical size={15} aria-hidden="true" />
        </button>
        <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] border bg-fl-surface" style={{ borderColor: tone('stroke'), color: tone('ink') }}>
          <TypeIcon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1" onBlur={() => commit()} onKeyDown={commitOnEnter}>
          <textarea
            ref={nameRef}
            rows={1}
            className="-ml-1.5 mb-1 block w-[calc(100%+6px)] cursor-text select-text resize-none overflow-hidden break-words rounded-[8px] border border-transparent bg-transparent px-1.5 py-0.5 text-[16px] font-bold leading-6 text-fl-text hover:border-fl-border-strong focus:border-fl-border-strong focus:bg-fl-surface focus-visible:!outline-offset-0"
            aria-label="Step name"
            value={fields.label}
            maxLength={200}
            // A name is one line of text: Enter finishes it, pasted line breaks become spaces.
            onChange={(e) => setFields({ ...fields, label: e.target.value.replace(/\s*\n\s*/g, ' ') })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] leading-[18px]" role="status" aria-live="polite" data-testid="details-save-status" data-state={status}>
            <span className="font-semibold" style={{ color: tone('ink') }}>
              {meta.name}
            </span>
            <span aria-hidden="true" className="text-fl-text-muted">
              ·
            </span>
            {status === 'saving' && <span className="text-fl-text-secondary">Saving…</span>}
            {status === 'saved' && (
              <span className="inline-flex items-center gap-1 text-fl-text-secondary">
                <Check size={12} aria-hidden="true" className="text-fl-success" /> Saved
              </span>
            )}
            {status === 'error' && (
              <>
                <span className="inline-flex items-center gap-1 font-semibold text-fl-error">
                  <CircleAlert size={12} aria-hidden="true" /> Could not save
                </span>
                <button type="button" className="fl-link text-[12px]" onClick={props.onRetry}>
                  Retry
                </button>
                {props.saveError && <span className="basis-full text-fl-text-secondary">{props.saveError} Your changes are kept here.</span>}
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 flex-none place-items-center rounded-[9px] text-fl-text-secondary hover:bg-white/60"
          aria-label="Close step details"
          onClick={() => close(true)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {node.origin === 'ai-inferred' && node.assumptionStatus === 'unconfirmed' && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-[10px] border border-dashed border-fl-brand bg-fl-brand-pale px-3 py-2 text-[12.5px] leading-[18px] text-fl-brand-active">
          <span className="flex-1">Flico inferred this step. Check it, then confirm.</span>
          <button type="button" className="fl-btn !min-h-8 !px-2.5 !text-[12px]" onClick={() => onChange({ assumptionStatus: 'confirmed' })}>
            Confirm step
          </button>
        </div>
      )}

      {props.filled && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-fl-border bg-fl-brand-pale/50 px-4 py-2 text-[12.5px]" role="status" data-testid="filled-banner">
          <Sparkles size={14} aria-hidden="true" className="flex-none text-fl-brand" />
          <span className="min-w-0 flex-1 text-[var(--fl-action-ink)]">
            {props.filled.fields.length} detail{props.filled.fields.length === 1 ? '' : 's'} filled from your description{props.filled.fixture ? ' (test fixture)' : ''}
          </span>
          {props.onDescribe && (
            <button type="button" className="fl-link text-[12.5px]" onClick={props.onDescribe}>
              Describe more
            </button>
          )}
          {props.onUndoFill && (
            <button type="button" className="fl-link text-[12.5px]" onClick={props.onUndoFill}>
              Undo
            </button>
          )}
          {props.filled.missing.length > 0 && <p className="w-full text-[12px] text-fl-text-secondary">Still useful: {props.filled.missing.join(' ')}</p>}
        </div>
      )}

      <div onBlur={() => commit()} onKeyDown={commitOnEnter}>
        <div className="space-y-3 px-4 pb-1.5 pt-3.5">
          <Field label="Type" className={row} labelClass={fieldLabel}>
            {(id) =>
              types.length > 1 ? (
                <select
                  id={id}
                  className="fl-input !min-h-[38px]"
                  value={pendingType ?? fields.type}
                  onChange={(e) => {
                    const type = e.target.value as StepType;
                    if (node.type === 'decision' && type !== 'decision' && paths.length > 1) {
                      setPendingType(type);
                      return;
                    }
                    setPendingType(null);
                    const next = { ...fields, type };
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
          </Field>
          {pendingType && (
            <div role="group" aria-labelledby={`${moreId}-keep`} className="rounded-[10px] border border-fl-border-strong bg-fl-surface-subtle p-3 text-[13px] leading-[19px]">
              <p id={`${moreId}-keep`} className="font-semibold text-fl-text">
                {/^[aeiou]/i.test(STEP_META[pendingType].name) ? 'An' : 'A'} {STEP_META[pendingType].name.toLowerCase()} has one way on. Which path should it keep?
              </p>
              <div className="mt-2 space-y-1">
                {paths.map((e) => (
                  <label key={e.id} className="flex min-h-8 cursor-pointer items-center gap-2">
                    <input type="radio" name={`${moreId}-path`} checked={keep === e.type} onChange={() => setKeep(e.type as 'yes' | 'no')} />
                    <span className="min-w-0 truncate">
                      {BRANCH_LABEL[e.type as 'yes' | 'no']} → {label(e.targetId)}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] leading-[17px] text-fl-text-secondary">The other connection is removed. Steps after it stay on the canvas. Undo brings everything back.</p>
              <div className="mt-2.5 flex justify-end gap-2">
                <button type="button" className="fl-btn !min-h-9 !px-3 !text-[13px]" onClick={() => setPendingType(null)}>
                  Cancel
                </button>
                <button type="button" className="fl-btn fl-btn-primary !min-h-9 !px-3 !text-[13px]" onClick={confirmTypeChange}>
                  Change to {STEP_META[pendingType].name}
                </button>
              </div>
            </div>
          )}
          <Field label="Owner / team" className={row} labelClass={fieldLabel} isNew={isNew('owner')}>
            {(id) => <input id={id} className="fl-input !min-h-[38px]" value={fields.owner} maxLength={200} placeholder="Who does this?" onChange={set('owner')} />}
          </Field>
        </div>

        <div className="px-2 pb-2">
          <button type="button" className={foldButton} aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen(!moreOpen)}>
            <ChevronRight size={14} aria-hidden="true" className={chevron(moreOpen)} />
            <span className="flex-none">More details</span>
            {!moreOpen && <span className="min-w-0 flex-1 truncate text-right font-normal text-fl-text-muted">{moreSummary}</span>}
          </button>
          {moreOpen && (
            <div id={moreId} className="space-y-2.5 px-2 pb-2 pt-1">
              <Field label="Duration" className={row} labelClass={fieldLabel} isNew={isNew('duration')}>
                {(id) => (
                  <div className="flex gap-2">
                    <input id={id} className="fl-input !min-h-[38px] w-[84px]" type="number" min={0} step="any" inputMode="decimal" value={fields.durationValue} onChange={set('durationValue')} />
                    <select className="fl-input !min-h-[38px] min-w-0 flex-1" aria-label="Duration unit" value={fields.durationUnit} onChange={set('durationUnit')}>
                      {DURATION_UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                )}
              </Field>
              <Field label="Tools" className={row} labelClass={fieldLabel} isNew={isNew('tools')}>
                {(id) => (
                  <div className="fl-input flex !min-h-[38px] flex-wrap items-center gap-1.5 !py-1 !pl-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--fl-focus)]">
                    {fields.tools.map((t) => (
                      <span key={t} className="inline-flex max-w-full items-center gap-0.5 rounded-[6px] bg-fl-brand-pale py-0.5 pl-2 pr-0.5 text-[12.5px] font-medium text-[var(--fl-action-ink)]">
                        <span className="truncate">{t}</span>
                        <button type="button" className="grid h-6 w-6 flex-none place-items-center rounded-[5px] hover:bg-white/70" aria-label={`Remove ${t}`} onClick={() => removeTool(t)}>
                          <X size={12} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <input
                      id={id}
                      className="min-w-[60px] flex-1 border-0 bg-transparent py-1 text-[14px] outline-none"
                      aria-label="Tools / software (Enter to add)"
                      placeholder={fields.tools.length ? 'Add…' : 'e.g. ERP, Excel'}
                      value={fields.toolDraft}
                      maxLength={100}
                      onChange={(e) => (e.target.value.includes(',') ? addTool(e.target.value) : setFields({ ...fields, toolDraft: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && fields.toolDraft.trim()) {
                          e.preventDefault();
                          e.stopPropagation();
                          addTool(fields.toolDraft);
                        } else if (e.key === 'Backspace' && !fields.toolDraft && fields.tools.length) {
                          removeTool(fields.tools[fields.tools.length - 1]!);
                        }
                      }}
                    />
                  </div>
                )}
              </Field>
              <Field label="Notes" className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2.5" labelClass={`${fieldLabel} pt-[9px]`} isNew={isNew('notes')}>
                {(id) => (
                  <textarea
                    id={id}
                    className="fl-input min-h-[72px] resize-y"
                    value={fields.notes}
                    maxLength={2000}
                    placeholder="Rules, exceptions, anything worth knowing"
                    onChange={set('notes')}
                  />
                )}
              </Field>
            </div>
          )}

          <button type="button" className={foldButton} aria-expanded={connectionsOpen} aria-controls={connectionsId} onClick={() => setConnectionsOpen(!connectionsOpen)}>
            <ChevronRight size={14} aria-hidden="true" className={chevron(connectionsOpen)} />
            <span className="flex-none">Connections</span>
            {!connectionsOpen && <span className="min-w-0 flex-1 truncate text-right font-normal text-fl-text-muted">{connectionsSummary}</span>}
          </button>
          {connectionsOpen && (
            <div id={connectionsId} className="pb-1 pl-[30px] pr-2">
              <ul className="space-y-0.5">
                {outs.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-[13px]">
                    {e.type === 'loop' && <Repeat size={13} aria-hidden="true" className="text-fl-text-secondary" />}
                    <span className="min-w-0 flex-1 truncate">{connectionText(e)}</span>
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
                <button type="button" className="fl-link mb-1 mt-1.5 inline-flex items-center gap-1.5 text-[13px] no-underline hover:underline" onClick={onConnect}>
                  <Link2 size={14} aria-hidden="true" /> Connect to a step…
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-fl-border bg-fl-surface-subtle px-3 py-2.5">
        <button
          type="button"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-[9px] px-2 text-[13px] font-semibold text-fl-brand hover:bg-fl-brand-pale"
          aria-label="Ask Flico about this step"
          onClick={() => {
            commit();
            onAsk();
          }}
        >
          <Sparkles size={15} aria-hidden="true" /> Ask Flico
        </button>
        {node.type !== 'start' && (
          <button
            type="button"
            className="grid h-[38px] w-[38px] place-items-center rounded-[9px] text-fl-error hover:bg-[var(--fl-exception-fill)]"
            aria-label="Delete step"
            title="Delete step"
            onClick={onDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className="fl-btn fl-btn-primary !min-h-[38px] !px-5" onClick={() => void done()} disabled={finishing}>
          {finishing ? 'Saving…' : 'Done'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

type Fields = {
  label: string;
  type: StepType;
  /** A decision becoming another type: which of its two paths stays. */
  keepBranch?: 'yes' | 'no';
  owner: string;
  durationValue: string;
  durationUnit: string;
  tools: string[];
  toolDraft: string;
  notes: string;
};

function toFields(n: WorkflowNode): Fields {
  return {
    label: n.label,
    type: n.type,
    owner: n.owner ?? '',
    durationValue: n.duration ? String(n.duration.value) : '',
    durationUnit: n.duration?.unit ?? 'minutes',
    tools: [...(n.tools ?? [])],
    toolDraft: '',
    notes: n.notes ?? '',
  };
}

/** Only the fields that actually changed, normalised the way they are stored. */
function diff(n: WorkflowNode, f: Fields): StepPatch | null {
  const patch: StepPatch = {};
  if (f.label.trim() && f.label.trim() !== n.label) patch.label = f.label.trim();
  if (f.type !== n.type) {
    patch.type = f.type;
    if (f.keepBranch) patch.keepBranch = f.keepBranch;
  }
  if (f.owner.trim() !== (n.owner ?? '')) patch.owner = f.owner.trim();
  if (f.notes.trim() !== (n.notes ?? '')) patch.notes = f.notes.trim();
  // A tool still being typed counts too, so nothing is lost if the card closes before Enter.
  const draft = f.toolDraft.trim();
  const tools = draft && !f.tools.includes(draft) ? [...f.tools, draft] : f.tools;
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

function Field({ label, className, labelClass, children, isNew = false }: { label: string; className: string; labelClass: string; children: (id: string) => React.ReactNode; isNew?: boolean }) {
  const id = useId();
  return (
    <div className={`${className} ${isNew ? '-mx-1.5 rounded-[10px] bg-fl-brand-pale/40 px-1.5 py-1' : ''}`} data-filled={isNew || undefined}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {isNew && (
          <span className="ml-1 text-[10px] font-bold text-fl-brand">
            <span aria-hidden="true">✦ New</span>
            <span className="fl-sr-only">, filled from your description</span>
          </span>
        )}
      </label>
      {children(id)}
    </div>
  );
}
