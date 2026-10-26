import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Info, Sparkles } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';

const MAX_DESCRIPTION = 4000;

/**
 * Milestone 1: the AI creation route with its input, clearly marked as not yet available.
 * Nothing typed here is sent or stored. AI generation arrives in Milestone 3.
 */
export function CreateWithAiPage() {
  useTitle('Create with AI');
  const { user } = useAuth();
  const [description, setDescription] = useState('');
  const fieldId = useId();
  const noticeId = useId();
  if (!user) return null;

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

          <div id={noticeId} className="mt-6 flex gap-3 rounded-[12px] border border-[var(--fl-wait-stroke)] bg-[var(--fl-wait-fill)] p-4 text-[13px] leading-5 text-[var(--fl-wait-ink)]">
            <Info size={18} aria-hidden="true" className="mt-px flex-none" />
            <p>
              <strong className="font-semibold">AI drafting isn't available yet.</strong> It arrives in an upcoming
              update. Nothing you type here is sent or saved. To start now, use <Link className="underline" to="/">Build manually</Link> on the
              dashboard.
            </p>
          </div>

          <label htmlFor={fieldId} className="mt-6 block text-[13px] font-semibold leading-5">
            Describe your workflow
          </label>
          <textarea
            id={fieldId}
            className="fl-input mt-2 min-h-[200px] resize-y leading-[22px]"
            value={description}
            maxLength={MAX_DESCRIPTION}
            onChange={(event) => setDescription(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[12px] text-fl-text-muted">
              {description.length.toLocaleString()} / {MAX_DESCRIPTION.toLocaleString()} characters
            </p>
            <button type="button" className="fl-btn fl-btn-primary" disabled aria-describedby={noticeId}>
              Create draft
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
