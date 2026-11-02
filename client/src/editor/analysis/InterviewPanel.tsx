import { useId, useState } from 'react';
import { ArrowRight, ClipboardList } from 'lucide-react';
import type { AssistMode, ChatMessage } from '../../../../shared/api';
import { BRIEF_MAX_QUESTIONS, CLARIFY_MAX_QUESTIONS } from '../../../../shared/assessment';
import { BLUEPRINT_MAX_QUESTIONS } from '../../../../shared/blueprint';

/** An interview about one step (Clarify, or the questions before a brief), as the editor runs it. */
export type InterviewView = {
  stepId: string;
  mode: AssistMode;
  /** Clarify ended: the card shows what changed. */
  finished: boolean;
  /** This step's interview messages for the current analysis, oldest first. */
  messages: ChatMessage[];
  /** The open question, if any. */
  question: ChatMessage | null;
  busy: boolean;
  error: string | null;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  onClose: () => void;
  onDismissError: () => void;
};

/** The messages of the current run: since the previous end of an interview (or, once finished, up to its end). */
function currentRun(messages: ChatMessage[], finished: boolean): ChatMessage[] {
  const ends = messages.flatMap((m, i) => (m.assist?.kind === 'done' || m.assist?.kind === 'brief' || m.assist?.kind === 'blueprint' ? [i] : []));
  if (finished && ends.length) return messages.slice((ends.at(-2) ?? -1) + 1, ends.at(-1)! + 1);
  return messages.slice((ends.at(-1) ?? -1) + 1);
}

const label = 'text-[11px] font-bold uppercase leading-4 tracking-[0.05em] text-fl-brand';

/**
 * Clarify (and the questions before a brief) inside the step's card (owner choice, 2026-11-02): one
 * question at a time with suggested answers to pick, an "Other" box, Skip and Stop. No chat window.
 */
export function InterviewPanel({ view, stepName, next }: { view: InterviewView; stepName: string; next?: { label: string; onClick: () => void } }) {
  const run = currentRun(view.messages, view.finished);
  const asked = run.filter((m) => m.assist?.kind === 'question').length;
  const max = view.mode === 'clarify' ? CLARIFY_MAX_QUESTIONS : view.mode === 'blueprint' ? BLUEPRINT_MAX_QUESTIONS : BRIEF_MAX_QUESTIONS;
  const title = { clarify: 'Clarifying', brief: 'Questions for the brief', blueprint: 'Questions for the blueprint' }[view.mode];
  const updates = run.filter((m) => m.assist?.kind === 'update');

  return (
    <section className="mt-2.5 rounded-[12px] border border-[var(--fl-start-stroke)] bg-fl-brand-pale/40 px-3.5 py-3" aria-label={`${title}: ${stepName}`} data-testid="interview-panel" data-mode={view.mode}>
      {!view.finished && (
        <>
          <div className="flex items-center gap-2">
            <p className={label}>
              {title}
              {asked > 0 && ` · question ${Math.min(asked, max)} of up to ${max}`}
            </p>
            <span className="flex-1" />
            <button type="button" className="text-[12.5px] font-semibold text-fl-text-secondary hover:text-fl-text hover:underline" onClick={view.onClose}>
              Stop
            </button>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {Array.from({ length: max }, (_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i < asked ? 'bg-fl-brand' : 'bg-fl-border'}`} />
            ))}
          </div>
        </>
      )}

      {view.error && (
        <div role="alert" className="mt-2.5 rounded-[8px] bg-[var(--fl-exception-fill)] px-2.5 py-2 text-[12.5px] text-[var(--fl-exception-ink)]">
          <p>{view.error}</p>
          <button type="button" className="fl-link mt-1 text-[12px]" onClick={view.onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      {!view.finished && view.question && <QuestionForm key={view.question.id} question={view.question} busy={view.busy} onAnswer={view.onAnswer} onSkip={view.onSkip} />}

      {!view.finished && !view.question && view.busy && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-fl-text-secondary" role="status">
          <span className="fl-dots text-fl-brand" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {view.mode !== 'clarify' && asked > 0 ? `Flico is writing the ${view.mode}…` : 'Flico is preparing a question…'}
        </p>
      )}

      {view.finished && (
        <div role="status" data-testid="interview-outcome">
          <p className={label}>{updates.length ? 'Assessment updated' : 'Nothing changed'}</p>
          {asked === 0 ? (
            <p className="mt-1 text-[13px] leading-5 text-fl-text-secondary">{run.at(-1)?.content}</p>
          ) : updates.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-5 text-fl-text">
              {updates.map((m) => (
                <li key={m.id}>{m.content}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[13px] leading-5 text-fl-text-secondary">No answers were given. Skipped questions stay open under “Why”.</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="fl-btn !min-h-9 !px-3 !text-[13px]" onClick={view.onClose}>
              Done
            </button>
            {next && (
              <button
                type="button"
                className="fl-btn fl-btn-primary !min-h-9 gap-1 !px-3 !text-[13px]"
                aria-label={`${next.label} for “${stepName}”`}
                onClick={() => {
                  view.onClose();
                  next.onClick();
                }}
              >
                <ClipboardList size={14} aria-hidden="true" /> {next.label} <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** One question: pick a suggested answer or type your own. */
function QuestionForm({ question, busy, onAnswer, onSkip }: { question: ChatMessage; busy: boolean; onAnswer: (answer: string) => void; onSkip: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const headingId = useId();
  const options = question.assist?.options ?? [];
  const answer = other.trim() || picked || '';
  return (
    <form
      className="mt-3"
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        if (answer && !busy) onAnswer(answer);
      }}
    >
      <p id={headingId} className="text-[14.5px] font-semibold leading-5 text-fl-text" aria-live="polite">
        {question.content}
      </p>
      {question.source === 'fixture' && <p className="mt-0.5 text-[11.5px] text-fl-text-muted">Test fixture, not a live AI question</p>}
      {options.length > 0 && (
        <div role="radiogroup" aria-label="Suggested answers" className="mt-2.5 flex flex-wrap gap-2">
          {options.map((option) => {
            const on = picked === option && !other.trim();
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold ${on ? 'border-fl-brand bg-fl-brand text-white' : 'border-fl-border-strong bg-white text-fl-text hover:border-fl-brand'}`}
                onClick={() => {
                  setPicked(on ? null : option);
                  setOther('');
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}
      <label className="mt-2.5 block">
        <span className="fl-sr-only">{options.length ? 'Other answer' : 'Your answer'}</span>
        <input
          className="fl-input !min-h-10 !text-[13.5px]"
          placeholder={options.length ? 'Other: type your own answer' : 'Type your answer'}
          value={other}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setOther(e.target.value)}
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="text-[13px] font-semibold text-fl-text-secondary hover:text-fl-text hover:underline disabled:opacity-50" disabled={busy} onClick={onSkip}>
          Skip for now
        </button>
        <span className="flex-1" />
        <span className="text-[12px] text-fl-text-muted">No credit used</span>
        <button type="submit" className="fl-btn fl-btn-primary !min-h-9 gap-1 !px-3.5 !text-[13px]" disabled={!answer || busy}>
          {busy ? 'Flico is thinking…' : 'Answer'} {!busy && <ArrowRight size={14} aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}
