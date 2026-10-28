import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Lightbulb, Pencil, Trash2 } from 'lucide-react';
import { ASSUMPTION_TEXT_MAX, type Assumption } from '../../../shared/api';
import type { GraphChanges } from '../../../shared/aiOps';

/** Concise list of what an AI draft assumed, for the person to confirm, correct or remove. */
export function AssumptionsPanel({
  assumptions,
  collapsed,
  onToggle,
  onConfirm,
  onEdit,
  onRemove,
  onShowSteps,
}: {
  assumptions: Assumption[];
  collapsed: boolean;
  onToggle: () => void;
  onConfirm: (id: string) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onShowSteps: (stepIds: string[]) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = assumptions.filter((a) => a.status === 'open').length;
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="fl-popover absolute right-6 top-12 z-10 w-[330px] !p-0" aria-label="Assumptions">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={!collapsed} onClick={onToggle}>
        <Lightbulb size={16} className="text-[var(--fl-warning)]" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-semibold">
          Assumptions <span className="font-normal text-fl-text-muted">· {open ? `${open} to review` : 'all confirmed'}</span>
        </span>
        {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>
      {!collapsed && (
        <div className="max-h-[38vh] overflow-y-auto border-t border-fl-border px-4 pb-3 pt-2">
          <p className="mb-2 text-[12px] leading-[18px] text-fl-text-muted">Flico assumed these while drafting. Confirm or correct them.</p>
          {error && (
            <p role="alert" className="mb-2 text-[12px] text-fl-error">
              {error}
            </p>
          )}
          <ul className="flex flex-col gap-2.5">
            {assumptions.map((a) => (
              <li key={a.id} className="rounded-[10px] border border-fl-border px-3 py-2.5">
                {editing?.id === a.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await onEdit(a.id, editing.text);
                        setEditing(null);
                      });
                    }}
                  >
                    <textarea
                      className="fl-input !min-h-16 resize-y !text-[13px] leading-5"
                      aria-label="Correct this assumption"
                      autoFocus
                      maxLength={ASSUMPTION_TEXT_MAX}
                      value={editing.text}
                      onChange={(e) => setEditing({ id: a.id, text: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(null))}
                    />
                    <div className="mt-2 flex gap-2">
                      <button type="submit" className="fl-btn fl-btn-primary !min-h-8 !px-3 !text-[12px]" disabled={!editing.text.trim()}>
                        Save
                      </button>
                      <button type="button" className="fl-btn !min-h-8 !px-3 !text-[12px]" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="text-[13px] leading-5 text-fl-text">{a.text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                      {a.status === 'confirmed' ? (
                        <span className="fl-badge !py-0.5">
                          <Check size={12} aria-hidden="true" /> Confirmed
                        </span>
                      ) : (
                        <button type="button" className="fl-link inline-flex items-center gap-1 text-[12px] no-underline hover:underline" onClick={() => void run(() => onConfirm(a.id))}>
                          <Check size={13} aria-hidden="true" /> Confirm
                        </button>
                      )}
                      <button type="button" className="fl-link inline-flex items-center gap-1 text-[12px] no-underline hover:underline" onClick={() => setEditing({ id: a.id, text: a.text })}>
                        <Pencil size={12} aria-hidden="true" /> Edit
                      </button>
                      {a.stepIds.length > 0 && (
                        <button type="button" className="fl-link text-[12px] no-underline hover:underline" onClick={() => onShowSteps(a.stepIds)}>
                          Show step{a.stepIds.length === 1 ? '' : 's'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] text-fl-text-muted hover:bg-fl-surface-subtle hover:text-fl-error"
                        aria-label={`Remove assumption: ${a.text}`}
                        onClick={() => void run(() => onRemove(a.id))}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Banner after AI drafting: a partially kept draft (Retry / Continue editing manually) and/or a test-fixture draft. */
export function DraftNotice({
  partial,
  fixture,
  retrying,
  retryError,
  onRetry,
  onDismiss,
}: {
  partial: boolean;
  fixture: boolean;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className="absolute left-1/2 top-12 z-20 flex w-[min(640px,calc(100%-460px))] min-w-[420px] -translate-x-1/2 flex-col gap-2 rounded-[12px] border border-[var(--fl-wait-stroke)] bg-[var(--fl-wait-fill)] px-4 py-3 text-[13px] leading-5 text-[var(--fl-wait-ink)] shadow-fl-card">
      {partial && (
        <p>
          <strong className="font-semibold">Flico couldn't complete this draft.</strong> The parts that were valid are kept here. You can try again (this draft stays saved) or continue editing it yourself.
        </p>
      )}
      {fixture && <p>This draft came from Flico's built-in test fixture, not a live AI model.</p>}
      {retryError && (
        <p role="alert" className="text-fl-error">
          {retryError}
        </p>
      )}
      <div className="flex gap-2">
        {partial && (
          <button type="button" className="fl-btn fl-btn-primary !min-h-9 !px-3 !text-[13px]" disabled={retrying} onClick={onRetry}>
            {retrying ? 'Drafting again…' : 'Retry'}
          </button>
        )}
        <button type="button" className="fl-btn !min-h-9 !px-3 !text-[13px]" onClick={onDismiss}>
          {partial ? 'Continue editing manually' : 'Dismiss'}
        </button>
      </div>
    </div>
  );
}

/** Shown while an AI proposal is previewed: what changes, a legend, and Apply / Cancel. */
export function PreviewBar({ changes, busy, onApply, onCancel }: { changes: GraphChanges; busy: boolean; onApply: () => void; onCancel: () => void }) {
  const parts = [
    changes.addedNodes.length && `${changes.addedNodes.length} added`,
    changes.modifiedNodes.length && `${changes.modifiedNodes.length} updated`,
    changes.removedNodes.length && `${changes.removedNodes.length} removed`,
  ].filter(Boolean);
  const connections = changes.addedEdges.length + changes.removedEdges.length + changes.modifiedEdges.length;
  return (
    <div role="region" aria-label="Suggested change preview" className="absolute left-1/2 top-12 z-20 flex -translate-x-1/2 items-center gap-4 rounded-[14px] border border-fl-border bg-white px-4 py-2.5 shadow-fl-float">
      <div className="text-[13px]">
        <p className="font-semibold text-fl-text">Previewing Flico's suggestion</p>
        <p className="text-[12px] text-fl-text-muted">
          {parts.length ? `Steps: ${parts.join(', ')}` : 'No step changes'}
          {connections ? ` · ${connections} connection change${connections === 1 ? '' : 's'}` : ''} · Editing is paused until you decide
        </p>
      </div>
      <ul className="flex items-center gap-1.5" aria-label="Legend">
        <li className="fl-diff-badge !static" data-diff="added">+ Added</li>
        <li className="fl-diff-badge !static" data-diff="modified">↗ Updated</li>
        <li className="fl-diff-badge !static" data-diff="removed">− Removed</li>
      </ul>
      <div className="flex gap-2">
        <button type="button" className="fl-btn fl-btn-primary !min-h-10 !px-4 !text-[13px]" disabled={busy} onClick={onApply}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
        <button type="button" className="fl-btn !min-h-10 !px-4 !text-[13px]" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
