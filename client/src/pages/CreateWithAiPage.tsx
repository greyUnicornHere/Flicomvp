import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Info, Sparkles } from 'lucide-react';
import { AI_DESCRIPTION_MAX, type AiStatusResponse } from '../../../shared/api';
import { AppHeader } from '../components/AppHeader';
import { createAiDraft, fetchAiStatus } from '../lib/ai';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';
import type { AiDraftState } from '../editor/Editor';

type Status = { kind: 'loading' } | { kind: 'ready'; status: AiStatusResponse } | { kind: 'error' };

/** Create with AI: describe a process and get a named draft right away (no mandatory questions). */
export function CreateWithAiPage() {
  useTitle('Create with AI');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const noticeId = useId();
  const errorId = useId();

  useEffect(() => {
    let active = true;
    fetchAiStatus().then(
      (s) => active && setStatus({ kind: 'ready', status: s }),
      () => active && setStatus({ kind: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);

  if (!user) return null;
  const ai = status.kind === 'ready' ? status.status : null;
  const available = ai?.available ?? false;
  const drafts = ai?.limits.draft;
  const limitReached = drafts ? drafts.used >= drafts.limit : false;

  const submit = async () => {
    const text = description.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createAiDraft(text);
      const state: AiDraftState = { aiDraft: { partial: result.partial, source: result.source, description: text } };
      navigate(`/workflows/${result.workflow.id}`, { state });
    } catch (err) {
      // The description stays in the box so nothing typed is lost.
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-fl-page">
      <AppHeader email={user.email} />
      <main className="fl-container pb-16 pt-10">
        <div className="mx-auto max-w-[720px]">
          <Link to="/" className="fl-link inline-flex items-center gap-1.5 no-underline hover:underline">
            <ArrowLeft size={16} aria-hidden="true" /> Back to dashboard
          </Link>
          <h1 className="mt-6 flex items-center gap-3 text-[28px] font-bold leading-9 tracking-[-0.025em]">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-fl-brand-pale text-fl-brand" aria-hidden="true">
              <Sparkles size={22} strokeWidth={1.75} />
            </span>
            Create with AI
          </h1>
          <p className="mt-3 text-fl-text-secondary">
            Describe how this process works today: who does what, the decisions and approvals involved, and where work
            waits. Flico will turn it into a draft workflow you can review and edit.
          </p>

          {status.kind !== 'loading' && !available && (
            <div id={noticeId} className="mt-6 flex gap-3 rounded-[12px] border border-[var(--fl-wait-stroke)] bg-[var(--fl-wait-fill)] p-4 text-[13px] leading-5 text-[var(--fl-wait-ink)]">
              <Info size={18} aria-hidden="true" className="mt-px flex-none" />
              <p>
                <strong className="font-semibold">{status.kind === 'error' ? "Couldn't check whether AI is available." : "AI isn't set up on this Flico server yet."}</strong>{' '}
                Nothing you type here is sent. To start now, use <Link className="underline" to="/">Build manually</Link> on the dashboard.
              </p>
            </div>
          )}
          {ai?.source === 'fixture' && (
            <div id={noticeId} className="mt-6 flex gap-3 rounded-[12px] border border-[var(--fl-wait-stroke)] bg-[var(--fl-wait-fill)] p-4 text-[13px] leading-5 text-[var(--fl-wait-ink)]">
              <Info size={18} aria-hidden="true" className="mt-px flex-none" />
              <p>
                <strong className="font-semibold">Test mode.</strong> This server uses Flico's built-in test fixture instead of a live AI model, so drafts follow a simple fixed pattern.
              </p>
            </div>
          )}

          <label htmlFor={fieldId} className="mt-6 block text-[13px] font-semibold leading-5">
            Describe your workflow
          </label>
          <textarea
            id={fieldId}
            className="fl-input mt-2 min-h-[200px] resize-y leading-[22px]"
            value={description}
            maxLength={AI_DESCRIPTION_MAX}
            readOnly={busy}
            placeholder="For example: A supplier emails an invoice. Finance checks it against the purchase order. Invoices over 5,000 need the department head's approval…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-4">
            <p className="text-[12px] text-fl-text-muted">
              {description.length.toLocaleString()} / {AI_DESCRIPTION_MAX.toLocaleString()} characters
              {drafts && available && ` · ${Math.max(0, drafts.limit - drafts.used)} of ${drafts.limit} AI drafts left today`}
            </p>
            <button
              type="button"
              className="fl-btn fl-btn-gradient"
              disabled={!available || busy || !description.trim() || limitReached}
              aria-describedby={!available ? noticeId : undefined}
              onClick={() => void submit()}
            >
              <Sparkles size={16} aria-hidden="true" /> {busy ? 'Drafting…' : 'Create draft'}
            </button>
          </div>

          {busy && (
            <p role="status" className="mt-5 flex items-center gap-2.5 text-[14px] text-fl-text-secondary">
              <span className="fl-dots text-fl-brand" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Flico is mapping your workflow. This usually takes under a minute.
            </p>
          )}
          {limitReached && !busy && (
            <p role="status" className="mt-5 text-[13px] text-fl-text-secondary">
              You've used today's {drafts!.limit} AI drafts. The limit resets at midnight UTC.
            </p>
          )}
          {error && (
            <div id={errorId} role="alert" className="mt-5 rounded-[12px] border border-[var(--fl-exception-stroke)] bg-[var(--fl-exception-fill)] p-4 text-[13px] leading-5 text-[var(--fl-exception-ink)]">
              <p>{error}</p>
              <p className="mt-1">Your description is still here. Nothing was saved.</p>
              <button type="button" className="fl-link mt-2 text-[13px]" onClick={() => void submit()}>
                Try again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
