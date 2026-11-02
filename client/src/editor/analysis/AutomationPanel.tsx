import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, CircleHelp, Handshake, RefreshCw, User, Zap, type LucideIcon } from 'lucide-react';
import {
  AUTOMATION_CLASSES,
  CLASS_LABEL,
  DIMENSIONS,
  DIMENSION_LABEL,
  EVIDENCE_LABEL,
  needsReassessment,
  type AutomationClass,
  type EvidenceSource,
  type StepAssessment,
} from '../../../../shared/assessment';
import type { WorkflowGraph } from '../../../../shared/graph';

const CLASS_ICON: Record<AutomationClass, LucideIcon> = { full: Zap, assisted: Handshake, human: User, unknown: CircleHelp };

const TAG_STYLE: Record<EvidenceSource, string> = {
  user: 'bg-fl-brand-pale text-[var(--fl-action-ink)]',
  workflow: 'bg-[var(--fl-finish-fill)] text-[var(--fl-finish-ink)]',
  assumption: 'border border-dashed border-fl-border-strong text-fl-text-secondary',
};

type Props = {
  /** null: the analysis was made before automation assessments existed. */
  assessments: StepAssessment[] | null;
  /** The analysed workflow (names of steps that were deleted since). */
  snapshot: WorkflowGraph;
  /** The workflow as it is now, to spot assessments that need reassessment. */
  currentGraph: WorkflowGraph;
  selectedId: string | null;
  onSelect: (stepId: string | null) => void;
};

/**
 * The Automation view of an analysis: counts per classification, then the assessed work steps grouped
 * by classification. Selecting one opens its explanation in place and highlights the step in the diagram.
 * Recommendations only: nothing is automated, connected or tested.
 */
export function AutomationPanel({ assessments, snapshot, currentGraph, selectedId, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-assessment="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  if (assessments === null) {
    return (
      <p className="px-5 py-5 text-[13px] leading-5 text-fl-text-secondary">
        This analysis was made before automation assessments were added, so it has none. Run a new analysis to get them.
      </p>
    );
  }
  if (assessments.length === 0) {
    return <p className="px-5 py-5 text-[13px] leading-5 text-fl-text-secondary">No work steps could be assessed for automation in this analysis.</p>;
  }

  const name = (id: string) => currentGraph.nodes.find((n) => n.id === id)?.label ?? snapshot.nodes.find((n) => n.id === id)?.label ?? 'Deleted step';
  const groups = AUTOMATION_CLASSES.map((c) => ({ c, items: assessments.filter((a) => a.classification === c) }));
  const heading = 'text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary';

  return (
    <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" data-testid="automation-panel">
      <div>
        <ul className="grid grid-cols-4 gap-2" aria-label="Automation summary">
          {groups.map(({ c, items }) => (
            <li key={c} className="rounded-[12px] border border-fl-border bg-fl-surface-subtle px-2.5 py-2">
              <span className="block text-[20px] font-bold leading-6">{items.length}</span>
              <span className="block text-[11.5px] leading-[15px] text-fl-text-secondary">{CLASS_LABEL[c]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-[17px] text-fl-text-muted">Recommendations only. Flico doesn't run automations, connect to your systems or test integrations.</p>
      </div>

      {groups
        .filter((g) => g.items.length > 0)
        .map(({ c, items }) => {
          const Icon = CLASS_ICON[c];
          return (
            <section key={c} aria-label={CLASS_LABEL[c]}>
              <h3 className={`mb-1.5 flex items-center gap-1.5 ${heading}`}>
                <Icon size={14} aria-hidden="true" /> {CLASS_LABEL[c]}
              </h3>
              <ul className="space-y-1.5">
                {items.map((a) => (
                  <Row key={a.stepId} a={a} name={name(a.stepId)} outdated={needsReassessment(currentGraph, a)} open={selectedId === a.stepId} onToggle={() => onSelect(selectedId === a.stepId ? null : a.stepId)} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

function Row({ a, name, outdated, open, onToggle }: { a: StepAssessment; name: string; outdated: boolean; open: boolean; onToggle: () => void }) {
  const heading = 'text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary';
  const toVerify = [...a.prerequisites, ...a.questions];
  const detailsId = `assessment-${a.stepId}`;
  return (
    <li data-assessment={a.stepId} className={`rounded-[12px] border bg-white ${open ? 'border-fl-brand shadow-[0_0_0_1px_var(--fl-brand)]' : 'border-fl-border'}`}>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 rounded-[12px] px-3 text-left text-[13.5px] font-semibold text-fl-text"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1">{name}</span>
        {a.provisional && <span className="flex-none rounded-full border border-dashed border-fl-border-strong px-2 text-[11px] font-semibold text-fl-text-secondary">Provisional</span>}
        {outdated && (
          <span className="inline-flex flex-none items-center gap-1 rounded-full border border-dotted border-[var(--fl-approval-ink)] bg-[var(--fl-approval-fill)] px-2 text-[11px] font-semibold text-[var(--fl-approval-ink)]">
            <RefreshCw size={11} aria-hidden="true" /> Needs reassessment
          </span>
        )}
        {open ? <ChevronDown size={15} aria-hidden="true" className="flex-none text-fl-text-muted" /> : <ChevronRight size={15} aria-hidden="true" className="flex-none text-fl-text-muted" />}
      </button>
      {open && (
        <div id={detailsId} className="space-y-3 px-3.5 pb-3.5 text-[13px] leading-[19px]">
          <div>
            <p className="font-semibold">{CLASS_LABEL[a.classification]}</p>
            {a.provisional && <p className="text-[12px] text-fl-text-muted">Provisional: the points to verify below aren't confirmed yet.</p>}
          </div>
          {outdated && (
            <p role="status" className="rounded-[8px] border border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] px-2.5 py-1.5 text-[12.5px] text-[var(--fl-approval-ink)]">
              This step, or a step that feeds it, changed after the analysis, so this may be out of date. Run a new analysis to reassess it.
            </p>
          )}
          <p className="text-fl-text">{a.reasoning}</p>
          {a.automatable && (
            <div>
              <h4 className={heading}>What could be automated</h4>
              <p className="mt-0.5 text-fl-text">{a.automatable}</p>
            </div>
          )}
          {a.human && (
            <div>
              <h4 className={heading}>What stays human</h4>
              <p className="mt-0.5 text-fl-text">{a.human}</p>
            </div>
          )}
          {toVerify.length > 0 && (
            <div>
              <h4 className={heading}>To verify or find out</h4>
              <ul className="mt-0.5 list-disc pl-4 text-fl-text">
                {toVerify.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className={heading}>Evidence</h4>
            <ul className="mt-1 space-y-1">
              {a.evidence.map((e) => (
                <li key={`${e.source}-${e.text}`} className="flex gap-2 text-fl-text">
                  <span className={`mt-px flex-none self-start rounded-[6px] px-1.5 text-[11px] font-semibold leading-[18px] ${TAG_STYLE[e.source]}`}>{EVIDENCE_LABEL[e.source]}</span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <details>
            <summary className="cursor-pointer font-semibold text-fl-brand">Reasoning by area</summary>
            <dl className="mt-1 space-y-1">
              {DIMENSIONS.map((d) => (
                <div key={d}>
                  <dt className="inline font-semibold text-fl-text">{DIMENSION_LABEL[d]}: </dt>
                  <dd className="inline text-fl-text-secondary">{a.dimensions[d] || 'Not described.'}</dd>
                </div>
              ))}
            </dl>
          </details>
          <div>
            <h4 className={heading}>Business value</h4>
            <p className="mt-0.5 text-fl-text-secondary">{a.value || 'Not assessed: no frequency, time or error figures were given. Feasibility above is judged separately.'}</p>
          </div>
        </div>
      )}
    </li>
  );
}
