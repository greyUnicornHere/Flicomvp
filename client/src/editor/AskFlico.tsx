import { useEffect, useId, useRef, useState } from 'react';
import { Check, GripHorizontal, Maximize2, Minimize2, Minus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { AI_CHAT_MESSAGE_MAX, type AssistMode, type ChatMessage, type ChatMode } from '../../../shared/api';
import type { ProposalOperation } from '../../../shared/aiOps';
import type { ChatRequest } from './useChat';

type Size = 'compact' | 'expanded';
const SIZES: Record<Size, { width: number; height: number }> = { compact: { width: 360, height: 460 }, expanded: { width: 520, height: 640 } };
const MARGIN = 12;
const HEADER = 64;
const MINIMIZED_HEIGHT = 52;

type Props = {
  available: boolean;
  messages: ChatMessage[] | null;
  loadError: string | null;
  pending: ChatRequest | null;
  failed: { request: ChatRequest; message: string } | null;
  /** The step the next question is about (from "Ask Flico about this step"). */
  context: { stepId: string; stepLabel: string } | null;
  hasIssues: boolean;
  previewId: string | null;
  busyProposal: boolean;
  onSend: (content: string, mode: ChatMode) => void;
  onRetry: () => void;
  onDismissError: () => void;
  onReload: () => void;
  onClearContext: () => void;
  onClear: () => Promise<void>;
  onPreview: (message: ChatMessage) => void;
  onApply: (message: ChatMessage) => void;
  onCancelProposal: (message: ChatMessage) => void;
  onClose: () => void;
  /** An interview about one step (Clarify, or a brief): one question at a time. */
  interview?: {
    stepLabel: string;
    mode: AssistMode;
    /** The open question for this step, if any. */
    question: ChatMessage | null;
    busy: boolean;
    error: string | null;
    onAnswer: (answer: string) => void;
    onSkip: () => void;
    onDismissError: () => void;
    onStop: () => void;
  } | null;
};

/** Ask Flico: a movable floating chat window (compact by default), never a docked sidebar. */
export function AskFlico(props: Props) {
  const { messages, pending, context } = props;
  const [size, setSize] = useState<Size>('compact');
  const [minimized, setMinimized] = useState(false);
  /** Where the person moved the window (null = default spot). Always shown clamped to the viewport. */
  const [moved, setMoved] = useState<{ left: number; top: number } | null>(null);
  const [, setViewport] = useState(0);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const box = () => {
    const wanted = SIZES[size];
    const width = Math.min(wanted.width, innerWidth - MARGIN * 2);
    const height = minimized ? MINIMIZED_HEIGHT : Math.min(wanted.height, innerHeight - HEADER - MARGIN * 2);
    return { width, height };
  };
  const { width, height } = box();

  /** Keep the whole window inside the viewport (below the header). */
  const clamp = (left: number, top: number) => ({
    left: Math.round(Math.min(Math.max(MARGIN, left), innerWidth - width - MARGIN)),
    top: Math.round(Math.min(Math.max(HEADER + MARGIN, top), innerHeight - height - MARGIN)),
  });

  // Default spot: bottom right, above the canvas controls.
  const position = moved ? clamp(moved.left, moved.top) : clamp(innerWidth - width - 24, innerHeight - height - 92);
  const setPosition = setMoved;

  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!minimized) inputRef.current?.focus({ preventScroll: true });
  }, [minimized, context]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, props.failed]);

  const startDrag = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button:not([data-drag])')) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, ...position };
    const move = (e: PointerEvent) => setPosition(clamp(start.left + e.clientX - start.x, start.top + e.clientY - start.y));
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
    if (!delta) return;
    event.preventDefault();
    setPosition(clamp(position.left + delta[0]!, position.top + delta[1]!));
  };

  const interview = props.interview ?? null;
  const answering = !!interview?.question;
  const send = (content: string, mode: ChatMode = 'chat') => {
    const text = content.trim();
    if (!text || pending || interview?.busy || !props.available) return;
    // While an interview question is open, the message answers it.
    if (interview?.question) interview.onAnswer(text);
    else props.onSend(text, mode);
    setDraft('');
  };

  const prompts: { label: string; mode: ChatMode }[] = context
    ? [
        { label: 'Explain this step', mode: 'chat' },
        { label: 'What could go wrong at this step?', mode: 'chat' },
        { label: 'Suggest an improvement for this step', mode: 'chat' },
      ]
    : [
        { label: 'Summarize this workflow', mode: 'chat' },
        { label: "What's missing or unclear?", mode: 'chat' },
        ...(props.hasIssues ? [{ label: 'Fix the issues in this workflow', mode: 'fix' as const }] : []),
      ];

  const iconBtn = 'grid h-9 w-9 place-items-center rounded-[9px] text-fl-text-secondary hover:bg-fl-surface-subtle hover:text-fl-text';

  return (
    <section
      className="fl-chat"
      role="dialog"
      aria-labelledby={titleId}
      style={{ left: position.left, top: position.top, width, height }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !confirmClear) {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <header className="flex h-[52px] flex-none cursor-move select-none items-center gap-1 border-b border-fl-border px-2" onPointerDown={startDrag}>
        <button type="button" data-drag className={`${iconBtn} cursor-move`} aria-label="Move Ask Flico window (arrow keys)" onKeyDown={moveWithKeys}>
          <GripHorizontal size={16} aria-hidden="true" />
        </button>
        <h2 id={titleId} className="flex flex-1 items-center gap-1.5 text-[14px] font-bold">
          <Sparkles size={15} className="text-fl-brand" aria-hidden="true" /> Ask Flico
        </h2>
        {!minimized && (
          <button type="button" className={iconBtn} aria-label="Clear history" title="Clear history" onClick={() => setConfirmClear(true)} disabled={!messages?.length}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
        {!minimized && (
          <button type="button" className={iconBtn} aria-label={size === 'compact' ? 'Expand' : 'Make compact'} title={size === 'compact' ? 'Expand' : 'Make compact'} onClick={() => setSize(size === 'compact' ? 'expanded' : 'compact')}>
            {size === 'compact' ? <Maximize2 size={15} aria-hidden="true" /> : <Minimize2 size={15} aria-hidden="true" />}
          </button>
        )}
        <button type="button" className={iconBtn} aria-label={minimized ? 'Restore' : 'Minimize'} title={minimized ? 'Restore' : 'Minimize'} aria-expanded={!minimized} onClick={() => setMinimized(!minimized)}>
          {minimized ? <Maximize2 size={15} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}
        </button>
        <button type="button" className={iconBtn} aria-label="Close Ask Flico" title="Close" onClick={props.onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {!minimized && (
        <>
          {confirmClear && (
            <div role="alertdialog" aria-label="Clear history" className="flex flex-none items-center gap-2 border-b border-fl-border bg-[var(--fl-exception-fill)] px-3 py-2 text-[13px] text-[var(--fl-exception-ink)]">
              <span className="flex-1">Clear this conversation? Your workflow isn't affected.</span>
              <button
                type="button"
                className="fl-btn !min-h-8 !px-2.5 !text-[12px]"
                autoFocus
                onClick={() => {
                  setConfirmClear(false);
                  void props.onClear();
                }}
              >
                Clear
              </button>
              <button type="button" className="fl-link text-[12px]" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </div>
          )}
          {!props.available && (
            <p className="flex-none border-b border-fl-border bg-[var(--fl-wait-fill)] px-4 py-2 text-[12.5px] leading-[18px] text-[var(--fl-wait-ink)]">
              AI isn't set up on this Flico server, so Ask Flico can't answer right now. Nothing you type is sent.
            </p>
          )}

          <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={pending ? true : undefined}>
            {props.loadError && (
              <p role="alert" className="text-[13px] text-fl-error">
                {props.loadError}{' '}
                <button type="button" className="fl-link" onClick={props.onReload}>
                  Retry
                </button>
              </p>
            )}
            {messages === null && !props.loadError && <p className="text-[13px] text-fl-text-muted">Loading conversation…</p>}
            {messages?.length === 0 && !pending && (
              <p className="text-[13px] leading-5 text-fl-text-secondary">
                Ask about this workflow or request a change. Suggested changes are previewed on the canvas and only applied when you approve them.
              </p>
            )}
            {messages?.map((m) => (
              <Message
                key={m.id}
                message={m}
                previewing={props.previewId === m.id}
                busy={props.busyProposal}
                onPreview={() => props.onPreview(m)}
                onApply={() => props.onApply(m)}
                onCancel={() => props.onCancelProposal(m)}
                {...(interview?.question?.id === m.id && !interview.busy ? { onSkip: interview.onSkip } : {})}
              />
            ))}
            {interview?.busy && (
              <p className="flex items-center gap-2 text-[13px] text-fl-text-muted" role="status">
                <span className="fl-dots text-fl-brand" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Flico is thinking…
              </p>
            )}
            {interview?.error && (
              <div role="alert" className="rounded-[10px] border border-[var(--fl-exception-stroke)] bg-[var(--fl-exception-fill)] px-3 py-2 text-[13px] text-[var(--fl-exception-ink)]">
                <p>{interview.error}</p>
                <button type="button" className="fl-link mt-1.5 text-[13px]" onClick={interview.onDismissError}>
                  Dismiss
                </button>
              </div>
            )}
            {pending && (
              <>
                <div className="fl-chat-bubble self-end bg-fl-brand-pale text-fl-text">{pending.content}</div>
                <p className="flex items-center gap-2 text-[13px] text-fl-text-muted" role="status">
                  <span className="fl-dots text-fl-brand" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  {pending.mode === 'fix' ? 'Looking for a fix…' : 'Flico is thinking…'}
                </p>
              </>
            )}
            {props.failed && (
              <div role="alert" className="rounded-[10px] border border-[var(--fl-exception-stroke)] bg-[var(--fl-exception-fill)] px-3 py-2 text-[13px] text-[var(--fl-exception-ink)]">
                <p>{props.failed.message}</p>
                <div className="mt-1.5 flex gap-3">
                  <button type="button" className="fl-link text-[13px]" onClick={props.onRetry}>
                    Retry
                  </button>
                  <button type="button" className="fl-link text-[13px]" onClick={props.onDismissError}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-none border-t border-fl-border px-3 pb-3 pt-2">
            {interview && (
              <p className="mb-2 flex items-center gap-1.5 text-[12px] text-fl-text-secondary" data-testid="interview-banner">
                <span className="min-w-0 flex-1 truncate">
                  {interview.mode === 'clarify' ? 'Clarifying' : 'Planning'} <strong className="font-semibold text-fl-text">“{interview.stepLabel}”</strong>
                </span>
                <button type="button" className="fl-link flex-none text-[12px]" onClick={interview.onStop}>
                  Stop
                </button>
              </p>
            )}
            {context && !interview && (
              <p className="mb-2 flex items-center gap-1.5 text-[12px] text-fl-text-secondary">
                <span className="truncate">
                  About: <strong className="font-semibold text-fl-text">{context.stepLabel || 'Untitled step'}</strong>
                </span>
                <button type="button" className="grid h-6 w-6 flex-none place-items-center rounded-full hover:bg-fl-surface-subtle" aria-label="Stop asking about this step" onClick={props.onClearContext}>
                  <X size={12} aria-hidden="true" />
                </button>
              </p>
            )}
            {!pending && !interview && props.available && (
              <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Suggested questions">
                {prompts.map((p) => (
                  <button key={p.label} type="button" className="rounded-full border border-fl-border bg-fl-surface-subtle px-2.5 py-1 text-[12px] font-medium text-fl-text-secondary hover:border-fl-brand hover:text-fl-brand" onClick={() => send(p.label, p.mode)}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
            >
              <textarea
                ref={inputRef}
                className="fl-input !min-h-11 max-h-28 flex-1 resize-none !py-2.5 !text-[13.5px] leading-5"
                rows={1}
                aria-label="Message Ask Flico"
                placeholder={!props.available ? 'AI is not set up' : answering ? 'Answer the question…' : 'Ask a question or request a change…'}
                value={draft}
                maxLength={AI_CHAT_MESSAGE_MAX}
                disabled={!props.available}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
              />
              <button type="submit" className="fl-btn fl-btn-primary grid !h-11 !w-11 !min-h-11 place-items-center !p-0" aria-label={answering ? 'Send answer' : 'Send'} disabled={!draft.trim() || !!pending || !!interview?.busy || !props.available}>
                <Send size={16} aria-hidden="true" />
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}

function countChanges(ops: ProposalOperation[]) {
  const steps = { added: 0, updated: 0, removed: 0 };
  for (const op of ops) {
    if (op.op === 'addStep') steps.added++;
    else if (op.op === 'updateStep') steps.updated++;
    else if (op.op === 'removeStep') steps.removed++;
  }
  const parts = [steps.added && `${steps.added} added`, steps.updated && `${steps.updated} updated`, steps.removed && `${steps.removed} removed`].filter(Boolean);
  return parts.length ? `Steps: ${parts.join(', ')}` : 'Connection changes only';
}

function Message({
  message,
  previewing,
  busy,
  onPreview,
  onApply,
  onCancel,
  onSkip,
}: {
  message: ChatMessage;
  previewing: boolean;
  busy: boolean;
  onPreview: () => void;
  onApply: () => void;
  onCancel: () => void;
  onSkip?: () => void;
}) {
  const assist = message.assist;
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.context && <span className="text-[11px] text-fl-text-muted">About “{message.context.stepLabel}”</span>}
        <div className={`fl-chat-bubble text-fl-text ${assist?.kind === 'skip' ? 'border border-dashed border-fl-border-strong bg-white italic' : 'bg-fl-brand-pale'}`}>{message.content}</div>
      </div>
    );
  }
  const proposal = message.proposal;
  return (
    <div className="flex flex-col items-start gap-1.5" data-assist={assist?.kind} data-assist-status={assist?.status}>
      {assist?.kind === 'question' && (
        <span className="text-[11px] font-semibold text-fl-text-secondary">
          {assist.mode === 'clarify' ? 'Clarifying' : 'Planning'} “{assist.stepLabel}”{assist.status === 'skipped' ? ' · skipped for now' : ''}
        </span>
      )}
      {assist?.kind === 'update' && <span className="text-[11px] font-semibold text-fl-brand">Assessment updated</span>}
      {assist?.kind === 'brief' && <span className="text-[11px] font-semibold text-fl-brand">Brief ready</span>}
      {/* Model text is rendered as plain text only (never HTML). */}
      <div className="fl-chat-bubble border border-fl-border bg-fl-surface-subtle text-fl-text">{message.content}</div>
      {onSkip && (
        <button type="button" className="fl-btn !min-h-8 !px-3 !text-[12px]" onClick={onSkip}>
          Skip for now
        </button>
      )}
      {message.source === 'fixture' && (
        <span className="fl-badge" data-status="draft" title="Generated by Flico's built-in test fixture, not a live AI model">
          Test fixture, not a live AI response
        </span>
      )}
      {proposal && (
        <div className="w-full rounded-[12px] border border-fl-border bg-white p-3 text-[13px]" data-testid="proposal">
          <p className="font-semibold text-fl-text">{proposal.summary}</p>
          <p className="mt-0.5 text-[12px] text-fl-text-muted">{countChanges(proposal.operations)}</p>
          {proposal.status === 'pending' && (
            <div className="mt-2.5 flex items-center gap-2">
              {previewing ? (
                <>
                  <button type="button" className="fl-btn fl-btn-primary !min-h-9 !px-3 !text-[13px]" disabled={busy} onClick={onApply}>
                    Apply
                  </button>
                  <button type="button" className="fl-btn !min-h-9 !px-3 !text-[13px]" disabled={busy} onClick={onCancel}>
                    Cancel
                  </button>
                  <span className="text-[12px] text-fl-text-muted">Previewing on the canvas</span>
                </>
              ) : (
                <>
                  <button type="button" className="fl-btn !min-h-9 !px-3 !text-[13px]" disabled={busy} onClick={onPreview}>
                    Preview on canvas
                  </button>
                  <button type="button" className="fl-link text-[12px]" disabled={busy} onClick={onCancel}>
                    Dismiss
                  </button>
                </>
              )}
            </div>
          )}
          {proposal.status === 'applied' && (
            <p className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-fl-success">
              <Check size={13} aria-hidden="true" /> Applied
            </p>
          )}
          {proposal.status === 'cancelled' && <p className="mt-2 text-[12px] font-semibold text-fl-text-muted">Cancelled, nothing changed</p>}
          {proposal.status === 'expired' && <p className="mt-2 text-[12px] font-semibold text-fl-text-muted">Not applied: the workflow changed since this suggestion</p>}
        </div>
      )}
    </div>
  );
}
