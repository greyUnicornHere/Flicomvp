import { useEffect, useId, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { ANALYSIS_ANSWER_MAX, type AnalysisQuestion, type AnalysisRunStage } from '../../../../shared/api';
import { Modal } from '../../components/Modal';

const STAGES: { id: AnalysisRunStage; label: string }[] = [
  { id: 'checking', label: 'Checking the workflow' },
  { id: 'reviewing', label: 'Reviewing steps, hand-offs and waits' },
  { id: 'validating', label: 'Checking the proposed changes' },
  { id: 'saving', label: 'Saving your assessment' },
];

export type ProgressState =
  | { kind: 'running'; stage: AnalysisRunStage; cancelling: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' };

/** Centered overlay above the still-visible canvas, with the real stage of the analysis (no percentages). */
export function AnalysisProgress({ state, onCancel, onRetry, onClose }: { state: ProgressState; onCancel: () => void; onRetry: () => void; onClose: () => void }) {
  const titleId = useId();
  const current = state.kind === 'running' ? STAGES.findIndex((s) => s.id === state.stage) : -1;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-[rgba(252,251,248,0.55)]">
      <section role="dialog" aria-modal="false" aria-labelledby={titleId} className="fl-popover w-[420px]">
        <h2 id={titleId} className="flex items-center gap-2 text-[17px] font-bold">
          <Sparkles size={18} className="text-fl-brand" aria-hidden="true" />
          {state.kind === 'running' ? 'Analysing your workflow' : state.kind === 'cancelled' ? 'Analysis cancelled' : 'The analysis didn’t finish'}
        </h2>
        {state.kind === 'running' && (
          <>
            <ol className="mt-4 space-y-2.5" aria-live="polite">
              {STAGES.map((s, i) => (
                <li key={s.id} className={`flex items-center gap-2.5 text-[14px] ${i <= current ? 'text-fl-text' : 'text-fl-text-muted'}`} aria-current={i === current ? 'step' : undefined}>
                  <span className="grid h-5 w-5 flex-none place-items-center" aria-hidden="true">
                    {i < current ? (
                      <Check size={16} className="text-fl-success" />
                    ) : i === current ? (
                      <span className="fl-dots text-fl-brand">
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-fl-border-strong" />
                    )}
                  </span>
                  {s.label}
                  {i < current && <span className="fl-sr-only">(done)</span>}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-[12px] leading-[18px] text-fl-text-muted">This usually takes under a minute. A credit is used only when the assessment is saved.</p>
            <div className="mt-4 flex justify-end">
              <button type="button" className="fl-btn" onClick={onCancel} disabled={state.cancelling || state.stage === 'saving'}>
                {state.cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            </div>
          </>
        )}
        {state.kind !== 'running' && (
          <>
            <p className="mt-3 text-[14px] leading-[22px] text-fl-text-secondary" role={state.kind === 'failed' ? 'alert' : 'status'}>
              {state.kind === 'failed' ? state.message : 'Nothing was saved and no credit was used.'}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className="fl-btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="fl-btn fl-btn-primary" onClick={onRetry}>
                Try again
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Guided Analysis: up to three optional questions picked for this workflow. Skipping is always fine. */
export function GuidedQuestions({
  load,
  onAnalyze,
  onCancel,
}: {
  load: () => Promise<AnalysisQuestion[]>;
  onAnalyze: (answers: { questionId: string; question: string; answer: string }[]) => void;
  onCancel: () => void;
}) {
  const [questions, setQuestions] = useState<AnalysisQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    load().then(
      (list) => active && setQuestions(list),
      (err: Error) => active && setError(err.message),
    );
    return () => {
      active = false;
    };
  }, [load]);

  const submit = (withAnswers: boolean) =>
    onAnalyze(withAnswers && questions ? questions.map((q) => ({ questionId: q.id, question: q.question, answer: (answers[q.id] ?? '').trim() })).filter((a) => a.answer) : []);

  return (
    <Modal
      title="Guided Analysis"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="fl-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="fl-btn" onClick={() => submit(false)}>
            Skip questions
          </button>
          <button type="button" className="fl-btn fl-btn-gradient" onClick={() => submit(true)} disabled={!questions && !error}>
            Analyze
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-5">All questions are optional. Answers can make the assessment more accurate; the assessment is equally detailed either way.</p>
      {!questions && !error && (
        <p role="status" className="mt-4 flex items-center gap-2 text-[13px]">
          <span className="fl-dots text-fl-brand" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Picking the most useful questions for this workflow…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-[13px] text-fl-error">
          {error} You can still analyze without questions.
        </p>
      )}
      {questions?.length === 0 && <p className="mt-4 text-[13px]">Flico has no questions for this workflow.</p>}
      {questions?.map((q) => (
        <label key={q.id} className="mt-4 block">
          <span className="block text-[13px] font-semibold text-fl-text">{q.question}</span>
          <textarea
            className="fl-input mt-1.5 !min-h-[64px] resize-y !text-[13px]"
            placeholder={q.hint || 'Optional'}
            maxLength={ANALYSIS_ANSWER_MAX}
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
          />
        </label>
      ))}
    </Modal>
  );
}
