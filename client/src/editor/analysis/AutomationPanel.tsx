import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, CircleHelp, Handshake, RefreshCw, User, Zap, type LucideIcon } from 'lucide-react';
import {
  AUTOMATION_CLASSES,
  CLASS_LABEL,
  CLASS_SHORT,
  DIMENSIONS,
  DIMENSION_LABEL,
  EVIDENCE_LABEL,
  needsReassessment,
  nextStep,
  topOpportunities,
  type AutomationClass,
  type EvidenceSource,
  type StepAssessment,
} from '../../../../shared/assessment';
import type { WorkflowGraph } from '../../../../shared/graph';

const CLASS_ICON: Record<AutomationClass, LucideIcon> = { full: Zap, assisted: Handshake, human: User, unknown: CircleHelp };

/** Plural-aware wording for the one-line summary. */
const COUNT_LABEL: Record<AutomationClass, [string, string]> = {
  full: ['automation candidate', 'automation candidates'],
  assisted: ['human-assisted', 'human-assisted'],
  human: ['keep human-led', 'keep human-led'],
  unknown: ['needs more information', 'need more information'],
};

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
 * The Automation view of an analysis, concise by design: the top opportunities first, a one-line
 * count, then one compact card per assessed step (verdict, what to automate, what stays human, the
 * next step), with the evidence and reasoning folded under "Why". Selecting a step highlights it in
 * the diagram. Recommendations only: nothing is automated, connected or tested.
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
  const outdated = (a: StepAssessment) => needsReassessment(currentGraph, a);
  const groups = AUTOMATION_CLASSES.map((c) => ({ c, items: assessments.filter((a) => a.classification === c) }));
  const top = topOpportunities(assessments, outdated);
  const heading = 'text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary';
  const select = (id: string) => onSelect(selectedId === id ? null : id);

  return (
    <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" data-testid="automation-panel">
      <section aria-labelledby="top-opportunities">
        <h3 id="top-opportunities" className={heading}>
          Top opportunities
        </h3>
        {top.length === 0 ? (
          <p className="mt-1 text-[13px] leading-5 text-fl-text-secondary">
            No clear automation opportunities yet. Steps that need more information list what to find out; add those details and run a new analysis.
          </p>
        ) : (
          <ol className="mt-1.5 space-y-1.5" data-testid="top-opportunities">
            {top.map((a, i) => {
              const Icon = CLASS_ICON[a.classification];
              const next = nextStep(a);
              return (
                <li key={a.stepId}>
                  <button
                    type="button"
                    className={`w-full rounded-[12px] border px-3 py-2 text-left hover:border-fl-brand ${selectedId === a.stepId ? 'border-fl-brand bg-fl-brand-pale/40' : 'border-fl-border bg-fl-surface-subtle'}`}
                    aria-pressed={selectedId === a.stepId}
                    onClick={() => select(a.stepId)}
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-semibold text-fl-text">
                      <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-fl-brand text-[11px] font-bold text-white">{i + 1}</span>
                      <span className="min-w-0 flex-1">{name(a.stepId)}</span>
                      <span className="inline-flex flex-none items-center gap-1 text-[11.5px] font-semibold text-fl-text-secondary">
                        <Icon size={12} aria-hidden="true" /> {CLASS_SHORT[a.classification]}
                        {a.provisional && ' · provisional'}
                      </span>
                    </span>
                    <span className="mt-0.5 block pl-7 text-[12.5px] leading-[18px] text-fl-text">{a.automatable}</span>
                    {next && <span className="block pl-7 text-[12px] leading-[17px] text-fl-text-secondary">Next: {next}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <div>
        <p className="text-[12.5px] leading-[18px] text-fl-text-secondary" aria-label="Automation summary">
          {groups
            .filter((g) => g.items.length > 0)
            .map(({ c, items }) => `${items.length} ${COUNT_LABEL[c][items.length === 1 ? 0 : 1]}`)
            .join(' · ')}
        </p>
        <p className="mt-0.5 text-[12px] leading-[17px] text-fl-text-muted">Recommendations only. Flico doesn't run automations, connect to your systems or test integrations.</p>
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
                  <Card key={a.stepId} a={a} name={name(a.stepId)} outdated={outdated(a)} selected={selectedId === a.stepId} onSelect={() => select(a.stepId)} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

/** One step: the verdict and three short lines; evidence and reasoning folded under "Why". */
function Card({ a, name, outdated, selected, onSelect }: { a: StepAssessment; name: string; outdated: boolean; selected: boolean; onSelect: () => void }) {
  const [why, setWhy] = useState(false);
  const whyId = useId();
  const heading = 'text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary';
  const next = nextStep(a);
  const moreToVerify = [...a.questions, ...a.prerequisites].slice(1);
  const line = (label: string, text: string, Icon: LucideIcon) => (
    <p className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
      <span className="inline-flex items-center gap-1 font-semibold text-fl-text-secondary">
        <Icon size={12} aria-hidden="true" /> {label}
      </span>
      <span className="text-fl-text">{text}</span>
    </p>
  );
  return (
    <li data-assessment={a.stepId} className={`rounded-[12px] border bg-white ${selected ? 'border-fl-brand shadow-[0_0_0_1px_var(--fl-brand)]' : 'border-fl-border'}`}>
      <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-t-[12px] px-3 pt-2 text-left text-[13.5px] font-semibold text-fl-text" aria-pressed={selected} onClick={onSelect}>
        <span className="min-w-0 flex-1">{name}</span>
        {a.provisional && <span className="flex-none rounded-full border border-dashed border-fl-border-strong px-2 text-[11px] font-semibold text-fl-text-secondary">Provisional</span>}
        {outdated && (
          <span className="inline-flex flex-none items-center gap-1 rounded-full border border-dotted border-[var(--fl-approval-ink)] bg-[var(--fl-approval-fill)] px-2 text-[11px] font-semibold text-[var(--fl-approval-ink)]">
            <RefreshCw size={11} aria-hidden="true" /> Needs reassessment
          </span>
        )}
      </button>
      <div className="space-y-1 px-3 pb-2.5 text-[12.5px] leading-[18px]">
        {outdated && <p className="text-[12px] text-[var(--fl-approval-ink)]">Changed since the analysis; run a new analysis to reassess.</p>}
        <p className="text-fl-text">{a.reasoning}</p>
        {a.automatable && line('Automate', a.automatable, Zap)}
        {a.human && line('Keep human', a.human, User)}
        {next && line('Next step', next, ArrowRight)}
        <button type="button" className="inline-flex items-center gap-0.5 pt-0.5 text-[12px] font-semibold text-fl-brand hover:underline" aria-expanded={why} aria-controls={whyId} onClick={() => setWhy(!why)}>
          {why ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />} Why
        </button>
        {why && (
          <div id={whyId} className="space-y-2.5 border-t border-fl-border pt-2">
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
            {moreToVerify.length > 0 && (
              <div>
                <h4 className={heading}>Also to verify</h4>
                <ul className="mt-0.5 list-disc pl-4 text-fl-text">
                  {moreToVerify.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h4 className={heading}>Reasoning by area</h4>
              <dl className="mt-0.5 space-y-0.5">
                {DIMENSIONS.map((d) => (
                  <div key={d}>
                    <dt className="inline font-semibold text-fl-text">{DIMENSION_LABEL[d]}: </dt>
                    <dd className="inline text-fl-text-secondary">{a.dimensions[d] || 'Not described.'}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h4 className={heading}>Business value</h4>
              <p className="mt-0.5 text-fl-text-secondary">{a.value || 'Not assessed: no frequency, time or error figures were given.'}</p>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
