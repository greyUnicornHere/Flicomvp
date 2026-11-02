import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Info, Maximize2, Minimize2 } from 'lucide-react';
import type { Analysis, ApplyAnalysisResponse, Recommendation, RecommendationCategory, ReviewStatus } from '../../../../shared/api';
import { diffGraphs } from '../../../../shared/aiOps';
import { findConflicts, orderRecommendations, overlayGraph, planApply, touched } from '../../../../shared/analysis';
import type { WorkflowGraph } from '../../../../shared/graph';
import { placeNewSteps } from '../../../../shared/layout';
import { Modal } from '../../components/Modal';
import { applyAnalysis, saveReview } from '../../lib/analysis';
import { formatModifiedFull } from '../../lib/workflows';
import { useFullscreen } from '../../lib/useFullscreen';
import { withChanges, type Focus } from '../flowElements';
import { needsReassessment } from '../../../../shared/assessment';
import { buildActionPlan } from './actionPlan';
import { ActionPlanPanel, type PlanFilter, type PlanSelection } from './ActionPlanPanel';
import { ReviewDiagram } from './ReviewDiagram';

const CATEGORY_LABEL: Record<RecommendationCategory, string> = { quick_win: 'Quick Win', strategic: 'Strategic Improvement', complex: 'Complex Change' };

type Props = {
  analyses: Analysis[];
  currentGraph: WorkflowGraph;
  /** Why Clarify and briefs can't be used right now (null: they can). */
  interviewBlocked?: string | null;
  onClarify?: (stepId: string) => void;
  onBrief?: (stepId: string) => void;
  onAnalysisChange: (analysis: Analysis) => void;
  onApplied: (result: ApplyAnalysisResponse) => void;
  onBackToEditor: () => void;
};

/**
 * The workflow assessment (revamped 2026-11-02, option A): the proposed workflow beside one Action
 * plan that combines process changes and automation opportunities, each with its journey stages.
 * The executive summary is a compact card at the bottom.
 */
export function AnalysisView({ analyses, currentGraph, onAnalysisChange, onApplied, onBackToEditor, interviewBlocked = null, onClarify, onBrief }: Props) {
  const [slot, setSlot] = useState<'initial' | 'latest'>('latest');
  const analysis = analyses.find((a) => a.slot === slot) ?? analyses.at(-1)!;
  const [selected, setSelected] = useState<PlanSelection>(null);
  const [filter, setFilter] = useState<PlanFilter>('all');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Full screen (owner feedback 2026-10-31): the diagram and the action plan fill the screen together.
  const fullscreen = useFullscreen();
  const [fullView, setFullView] = useState(false);
  const [wasFullscreen, setWasFullscreen] = useState(false);
  // Leaving browser full screen (Esc) also collapses the full view.
  if (fullscreen.active !== wasFullscreen) {
    setWasFullscreen(fullscreen.active);
    if (!fullscreen.active && fullView) setFullView(false);
  }
  const toggleFullView = () => {
    if (fullView) {
      setFullView(false);
      void fullscreen.exit();
    } else {
      setFullView(true);
      void fullscreen.enter();
    }
  };
  const [error, setError] = useState<string | null>(null);

  const { snapshot, recommendations } = analysis;
  const ordered = orderRecommendations(recommendations);
  const inPlay = ordered.filter((r) => r.status !== 'rejected');
  const accepted = ordered.filter((r) => r.status === 'accepted');
  const selectedRec = selected?.type === 'process' ? (recommendations.find((r) => r.id === selected.id) ?? null) : null;
  const applied = analysis.appliedAt !== null;
  const stale = Object.values(diffGraphs(snapshot, currentGraph)).some((ids) => ids.length > 0);
  const noImprovements = noImprovementsOf(analysis);
  const plan = buildActionPlan(analysis, currentGraph);

  // Which recommendation(s) each step or connection belongs to, for diagram ↔ list synchronization.
  const touchedBy = new Map(recommendations.map((r) => [r.id, touched(snapshot, r.operations)]));
  const owners = new Map<string, string[]>();
  for (const r of ordered) {
    const t = touchedBy.get(r.id)!;
    for (const id of [...t.added, ...t.modified, ...t.removed]) owners.set(id, [...(owners.get(id) ?? []), r.id]);
  }

  // One diagram: every recommendation still in play drawn together. A clashing one is shown on its own when selected.
  const overlay = overlayGraph(snapshot, inPlay);
  const shown = selectedRec && overlay.skipped.includes(selectedRec.id) ? overlayGraph(snapshot, [selectedRec]) : overlay;
  const display = withChanges(snapshot, placeNewSteps(snapshot, shown.graph));

  const assessments = analysis.assessments;
  // Automation labels on the diagram's blocks, unless only process changes are shown.
  const automationLabels = new Map((assessments ?? []).map((a) => [a.stepId, { assessment: a, stale: needsReassessment(currentGraph, a) }]));

  const selectedTouch = selectedRec ? touchedBy.get(selectedRec.id)! : null;
  const focusIds =
    selected?.type === 'automation'
      ? display.graph.nodes.some((n) => n.id === selected.id)
        ? new Set([selected.id])
        : null
      : selectedTouch
        ? new Set([...selectedTouch.added, ...selectedTouch.modified, ...selectedTouch.removed, ...selectedTouch.referenced])
        : null;
  const focus = (id: string): Focus | undefined => (focusIds ? (focusIds.has(id) ? 'on' : 'dim') : undefined);
  const revealIds = focusIds ? [...focusIds].filter((id) => display.graph.nodes.some((n) => n.id === id)) : [];

  const conflicts = findConflicts(snapshot, accepted);
  const applyPlan = planApply(snapshot, recommendations, accepted.map((r) => r.id));
  const name = (id: string) => currentGraph.nodes.find((n) => n.id === id)?.label ?? snapshot.nodes.find((n) => n.id === id)?.label ?? 'Deleted step';

  const setStatuses = async (statuses: Record<string, ReviewStatus>) => {
    setError(null);
    try {
      onAnalysisChange(await saveReview(analysis.id, statuses));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const confirmAndApply = async () => {
    setBusy(true);
    setError(null);
    try {
      onApplied(await applyAnalysis(analysis.id));
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const select = (next: PlanSelection) => {
    setSelected(next);
    // A selection the filter would hide shows everything again.
    if (next && filter !== 'all' && filter !== next.type) setFilter('all');
  };

  const verifyCount = inPlay.filter((r) => r.evidence === 'verify').length;
  const canApply = !noImprovements && !applied && !stale;
  const applyButton = canApply && (
    <button type="button" className="fl-btn fl-btn-gradient !min-h-11" disabled={accepted.length === 0} title={accepted.length === 0 ? 'Accept at least one process change first' : undefined} onClick={() => setConfirming(true)}>
      Apply accepted changes <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
  const stats = [
    noImprovements ? 'No changes proposed' : `${recommendations.length} change${recommendations.length === 1 ? '' : 's'}`,
    assessments === null ? 'No automation assessment' : `${assessments.length} step${assessments.length === 1 ? '' : 's'} assessed`,
    'No savings assumed',
  ].join(' · ');

  return (
    <div className="h-full overflow-y-auto bg-[var(--fl-bg-results)]">
      <div className="mx-auto max-w-[1360px] px-8 pb-10 pt-7">
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-brand">Workflow assessment</p>
            <h1 className="mt-1.5 text-[26px] font-bold leading-[34px] tracking-[-0.02em]">{analysis.headline}</h1>
            <p className="mt-0.5 text-[13px] text-fl-text-secondary">
              {analysis.mode === 'guided' ? 'Guided' : 'Quick'} analysis · {formatModifiedFull(analysis.createdAt)}
              {analysis.source === 'fixture' && ' · Test fixture, not a live AI analysis'}
            </p>
          </div>
          <div className="flex flex-none items-center gap-3">
            {analyses.length > 1 && (
              <label className="flex items-center gap-2 text-[13px] text-fl-text-secondary">
                <span className="fl-sr-only">Show analysis</span>
                <select className="fl-input !min-h-11 !w-auto !py-2 !text-[13px] font-semibold" value={analysis.slot} onChange={(e) => (setSlot(e.target.value as 'initial' | 'latest'), setSelected(null))}>
                  <option value="latest">Latest Analysis</option>
                  <option value="initial">Initial Analysis</option>
                </select>
              </label>
            )}
            {!fullView && applyButton}
          </div>
        </div>

        {applied && (
          <Notice tone="success">
            Accepted changes were applied on {formatModifiedFull(analysis.appliedAt!)}. The original workflow is kept in this analysis; use Undo in the editor to reverse it.
          </Notice>
        )}
        {stale && !applied && (
          <Notice tone="warning">The workflow has changed since this analysis, so its changes can no longer be applied. You can still read it, or run a new analysis.</Notice>
        )}
        {error && (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        )}

        <div
          className={fullView ? 'fixed inset-x-0 bottom-0 top-[var(--fl-header-height)] z-30 flex flex-col gap-3 bg-[var(--fl-bg-results)] px-6 pb-5 pt-4' : 'mt-5'}
          data-testid="review-section"
          data-expanded={fullView || undefined}
        >
          {fullView && (
            <div className="flex items-center justify-between gap-4">
              <p className="min-w-0 truncate text-[15px] font-bold">{analysis.headline}</p>
              {applyButton}
            </div>
          )}
          <div className={`grid grid-cols-[minmax(0,1fr)_minmax(400px,40%)] gap-5 ${fullView ? 'min-h-0 flex-1' : 'h-[600px]'}`}>
            <section className="fl-card relative h-full overflow-hidden !p-0" aria-labelledby="diagram-heading">
              <div className="pointer-events-none absolute left-5 right-4 top-3.5 z-10 flex items-center gap-3">
                <h2 id="diagram-heading" className="text-[11px] font-bold uppercase tracking-[0.04em] text-fl-text-muted">
                  {noImprovements ? 'Your workflow' : 'Proposed workflow'}
                </h2>
                <span className="flex-1" />
                {!noImprovements && (
                  <ul className="flex gap-1.5" aria-label="Legend">
                    <li className="fl-diff-badge !static" data-diff="added">+ Added</li>
                    <li className="fl-diff-badge !static" data-diff="modified">↗ Updated</li>
                  </ul>
                )}
                <button type="button" className="fl-btn pointer-events-auto flex-none gap-1.5 !min-h-9 !px-2.5 !text-[12.5px] !text-fl-text-secondary" aria-pressed={fullView} onClick={toggleFullView}>
                  {fullView ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
                  {fullView ? 'Exit full screen' : 'Full screen'}
                </button>
              </div>
              <ReviewDiagram
                display={display}
                focus={focus}
                revealIds={revealIds}
                label={noImprovements ? 'Analysed workflow' : 'Workflow with proposed changes'}
                assessments={filter !== 'process' ? automationLabels : undefined}
                onOpenAssessment={(id) => select({ type: 'automation', id })}
                onSelectElement={(id) => {
                  const recs = filter !== 'automation' ? owners.get(id) : undefined;
                  if (recs?.length) {
                    const current = selected?.type === 'process' ? selected.id : '';
                    select({ type: 'process', id: recs.includes(current) ? current : recs[0]! });
                    return;
                  }
                  if (assessments?.some((a) => a.stepId === id)) select(selected?.type === 'automation' && selected.id === id ? null : { type: 'automation', id });
                }}
              />
            </section>

            <ActionPlanPanel
              plan={plan}
              hasAssessments={assessments === null ? null : assessments.length > 0}
              noImprovements={noImprovements}
              filter={filter}
              onFilter={(f) => {
                setFilter(f);
                if (selected && f !== 'all' && f !== selected.type) setSelected(null);
              }}
              selected={selected}
              onSelect={select}
              name={name}
              readOnly={applied || stale}
              conflictsOf={(id) => conflicts.filter((c) => c.ids.includes(id)).map((c) => c.message)}
              dependsOnOf={(r: Recommendation) => r.dependsOn.map((id) => recommendations.find((x) => x.id === id)?.title).filter((t): t is string => !!t)}
              onStatus={(statuses) => void setStatuses(statuses)}
              // Only the current analysis (the latest, or the only one) can be clarified or planned.
              actionsBlocked={analysis.slot === 'initial' && analyses.some((a) => a.slot === 'latest') ? 'Only the latest analysis can be clarified or planned' : interviewBlocked}
              onClarify={onClarify}
              onBrief={onBrief}
            />
          </div>
        </div>

        <section className="fl-card mt-5 !p-0" aria-labelledby="summary-heading" data-testid="summary-card">
          <div className="flex items-center gap-4 px-5 py-3">
            <h2 id="summary-heading" className="flex-none text-[11px] font-bold uppercase tracking-[0.04em] text-fl-text-secondary">
              Summary
            </h2>
            <p className={`min-w-0 flex-1 text-[13px] leading-5 text-fl-text ${summaryOpen ? '' : 'truncate'}`}>{analysis.summary}</p>
            <p className="flex-none text-[12.5px] text-fl-text-secondary">{stats}</p>
            <button type="button" className="inline-flex flex-none items-center gap-0.5 text-[12.5px] font-semibold text-fl-brand hover:underline" aria-expanded={summaryOpen} aria-controls="summary-details" onClick={() => setSummaryOpen(!summaryOpen)}>
              Details {summaryOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            </button>
          </div>
          {summaryOpen && (
            <div id="summary-details" className="grid grid-cols-[minmax(0,1fr)_260px] gap-8 border-t border-fl-border px-5 py-4 text-[13px] leading-5 text-fl-text-secondary">
              <div className="space-y-3">
                {analysis.assumptions.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-fl-text">Assumptions ({analysis.assumptions.length})</h3>
                    <ul className="mt-1 list-disc pl-5">
                      {analysis.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.answers.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-fl-text">Your answers ({analysis.answers.length})</h3>
                    <dl className="mt-1 space-y-1">
                      {analysis.answers.map((a) => (
                        <div key={a.question}>
                          <dt className="font-semibold text-fl-text">{a.question}</dt>
                          <dd>{a.answer}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {analysis.assumptions.length === 0 && analysis.answers.length === 0 && <p>No assumptions or answers were recorded for this analysis.</p>}
              </div>
              <ul className="space-y-1.5 border-l border-fl-border pl-6">
                <li>
                  <strong className="text-fl-text">{recommendations.length}</strong> proposed change{recommendations.length === 1 ? '' : 's'}
                </li>
                <li>
                  <strong className="text-fl-text">{verifyCount}</strong> require{verifyCount === 1 ? 's' : ''} verification
                </li>
                <li>
                  {assessments === null ? (
                    'No automation assessment in this analysis'
                  ) : (
                    <>
                      <strong className="text-fl-text">{assessments.length}</strong> step{assessments.length === 1 ? '' : 's'} assessed for automation
                    </>
                  )}
                </li>
                <li className="font-semibold text-fl-text">No numerical savings assumed</li>
              </ul>
            </div>
          )}
        </section>

        <div className="mt-4 flex items-center justify-between text-[12px] text-fl-text-secondary">
          <p>
            {!noImprovements && 'Removed steps are listed in the corner of the diagram. '}
            <strong className="font-semibold text-fl-brand">Proposals only; your original workflow is preserved.</strong>
          </p>
          <button type="button" className="fl-link text-[13px]" onClick={onBackToEditor}>
            Back to editor →
          </button>
        </div>
      </div>

      {confirming && (
        <FinalPreview
          snapshot={snapshot}
          accepted={accepted}
          plan={applyPlan}
          busy={busy}
          stale={stale}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void confirmAndApply()}
        />
      )}
    </div>
  );
}

/** The analysis found nothing worth recommending. */
function noImprovementsOf(analysis: Analysis): boolean {
  return analysis.outcome === 'no_improvements' || analysis.recommendations.length === 0;
}

function Notice({ tone, children, role }: { tone: 'success' | 'warning' | 'error'; children: React.ReactNode; role?: string }) {
  const colours = {
    success: 'border-[var(--fl-start-stroke)] bg-fl-brand-pale text-fl-brand-active',
    warning: 'border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] text-[var(--fl-approval-ink)]',
    error: 'border-[var(--fl-exception-stroke)] bg-[var(--fl-exception-fill)] text-[var(--fl-exception-ink)]',
  }[tone];
  return (
    <div role={role ?? 'status'} className={`mt-4 flex items-start gap-2.5 rounded-[12px] border px-4 py-3 text-[13px] leading-5 ${colours}`}>
      <Info size={16} className="mt-0.5 flex-none" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

/** Combined preview of the accepted changes only, with conflict checks, before anything is applied. */
function FinalPreview(props: {
  snapshot: WorkflowGraph;
  accepted: Recommendation[];
  plan: ReturnType<typeof planApply>;
  busy: boolean;
  stale: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { plan } = props;
  const fullscreen = useFullscreen();
  const [full, setFull] = useState(false);
  const [wasFullscreen, setWasFullscreen] = useState(false);
  if (fullscreen.active !== wasFullscreen) {
    setWasFullscreen(fullscreen.active);
    if (!fullscreen.active && full) setFull(false);
  }
  const close = () => {
    if (full) void fullscreen.exit();
    props.onCancel();
  };
  const display = useMemo(() => withChanges(props.snapshot, plan.ok ? placeNewSteps(props.snapshot, plan.graph) : props.snapshot), [props.snapshot, plan]);
  const reasons = plan.ok ? [] : [...plan.conflicts.map((c) => c.message), ...plan.missing.map((m) => m.message), ...plan.problems];
  return (
    <Modal
      wide
      fill={full}
      title="Review accepted changes"
      onClose={close}
      footer={
        <>
          <button
            type="button"
            className="fl-btn mr-auto gap-1.5"
            aria-pressed={full}
            onClick={() => {
              setFull(!full);
              void (full ? fullscreen.exit() : fullscreen.enter());
            }}
          >
            {full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
          <button type="button" className="fl-btn" onClick={close}>
            Back to review
          </button>
          <button type="button" className="fl-btn fl-btn-gradient" disabled={!plan.ok || props.busy || props.stale} onClick={props.onConfirm}>
            {props.busy ? 'Applying…' : 'Confirm & apply'}
          </button>
        </>
      }
    >
      <p className="text-[13px]">
        Only the {props.accepted.length} accepted recommendation{props.accepted.length === 1 ? '' : 's'} {props.accepted.length === 1 ? 'is' : 'are'} shown. Applying updates your workflow in Flico only (never other systems); the original stays in this analysis and Undo reverses it.
      </p>
      {reasons.length > 0 && (
        <div role="alert" className="mt-3 rounded-[10px] border border-[var(--fl-exception-stroke)] bg-[var(--fl-exception-fill)] px-3 py-2 text-[13px] text-[var(--fl-exception-ink)]">
          <p className="font-semibold">These choices can’t be applied together:</p>
          <ul className="mt-1 list-disc pl-5">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {props.error && (
        <p role="alert" className="mt-3 text-[13px] text-fl-error">
          {props.error}
        </p>
      )}
      <div className={`mt-4 grid grid-cols-[minmax(0,1fr)_260px] gap-4 ${full ? 'min-h-0 flex-1' : ''}`}>
        <div className={`relative overflow-hidden rounded-[12px] border border-fl-border ${full ? 'h-full' : 'h-[420px]'}`}>
          <ReviewDiagram display={display} focus={() => undefined} revealIds={[]} label="Combined preview of accepted changes" onSelectElement={() => {}} />
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-[13px] text-fl-text">
          {props.accepted.map((r) => (
            <li key={r.id}>
              <span className="font-semibold">{r.title}</span>
              <span className="block text-[12px] text-fl-text-secondary">{CATEGORY_LABEL[r.category]}</span>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
