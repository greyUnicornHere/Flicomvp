import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Info, Maximize2, Minimize2, X } from 'lucide-react';
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
import { AutomationPanel } from './AutomationPanel';
import { ReviewDiagram } from './ReviewDiagram';

const CATEGORY_LABEL: Record<RecommendationCategory, string> = { quick_win: 'Quick Win', strategic: 'Strategic Improvement', complex: 'Complex Change' };
const EVIDENCE_LABEL = { supported: 'Supported by your workflow', assumption: 'Based on assumptions', verify: 'Requires verification' } as const;
const STATUS_LABEL: Record<ReviewStatus, string> = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' };
const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;

type Props = {
  analyses: Analysis[];
  currentGraph: WorkflowGraph;
  onAnalysisChange: (analysis: Analysis) => void;
  onApplied: (result: ApplyAnalysisResponse) => void;
  onBackToEditor: () => void;
};

/** The analysis results: executive summary, one change-highlighted diagram and the synchronized recommendation list. */
export function AnalysisView({ analyses, currentGraph, onAnalysisChange, onApplied, onBackToEditor }: Props) {
  const [slot, setSlot] = useState<'initial' | 'latest'>('latest');
  const analysis = analyses.find((a) => a.slot === slot) ?? analyses.at(-1)!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The side panel shows recommendations or the automation assessment; one step's assessment can be open.
  const [panel, setPanel] = useState<'recs' | 'automation'>('recs');
  const [assessId, setAssessId] = useState<string | null>(null);
  const [filter, setFilter] = useState<RecommendationCategory | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Full screen (owner feedback 2026-10-31): the diagram and the recommendations fill the screen together.
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
  const listRef = useRef<HTMLDivElement>(null);

  const { snapshot, recommendations } = analysis;
  const ordered = orderRecommendations(recommendations);
  const inPlay = ordered.filter((r) => r.status !== 'rejected');
  const rejected = ordered.filter((r) => r.status === 'rejected');
  const accepted = ordered.filter((r) => r.status === 'accepted');
  const number = new Map(ordered.map((r, i) => [r.id, i + 1]));
  const selected = recommendations.find((r) => r.id === selectedId) ?? null;
  const applied = analysis.appliedAt !== null;
  const stale = Object.values(diffGraphs(snapshot, currentGraph)).some((ids) => ids.length > 0);

  // Which recommendation(s) each step or connection belongs to, for diagram ↔ list synchronization.
  const touchedBy = new Map(recommendations.map((r) => [r.id, touched(snapshot, r.operations)]));
  const owners = new Map<string, string[]>();
  for (const r of ordered) {
    const t = touchedBy.get(r.id)!;
    for (const id of [...t.added, ...t.modified, ...t.removed]) owners.set(id, [...(owners.get(id) ?? []), r.id]);
  }

  // One diagram: every recommendation still in play drawn together. A clashing one is shown on its own when selected.
  const overlay = overlayGraph(snapshot, inPlay);
  const shown = selected && overlay.skipped.includes(selected.id) ? overlayGraph(snapshot, [selected]) : overlay;
  const display = withChanges(snapshot, placeNewSteps(snapshot, shown.graph));

  const assessments = analysis.assessments;
  const hasAssessments = !!assessments?.length;
  // Without recommendations, the side panel shows only the automation assessment (when there is one).
  const sidePanel = noImprovementsOf(analysis) ? 'automation' : panel;
  const showSide = !noImprovementsOf(analysis) || hasAssessments;

  const selectedTouch = selected ? touchedBy.get(selected.id)! : null;
  const focusIds =
    sidePanel === 'automation'
      ? assessId && display.graph.nodes.some((n) => n.id === assessId)
        ? new Set([assessId])
        : null
      : selectedTouch
        ? new Set([...selectedTouch.added, ...selectedTouch.modified, ...selectedTouch.removed, ...selectedTouch.referenced])
        : null;
  const focus = (id: string): Focus | undefined => (focusIds ? (focusIds.has(id) ? 'on' : 'dim') : undefined);
  const revealIds = focusIds ? [...focusIds].filter((id) => display.graph.nodes.some((n) => n.id === id)) : [];

  const conflicts = findConflicts(snapshot, accepted);
  const plan = planApply(snapshot, recommendations, accepted.map((r) => r.id));

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-rec="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

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

  const visible = (list: Recommendation[]) => (filter === 'all' ? list : list.filter((r) => r.category === filter));
  const verifyCount = inPlay.filter((r) => r.evidence === 'verify').length;
  const noImprovements = noImprovementsOf(analysis);

  return (
    <div className="h-full overflow-y-auto bg-[var(--fl-bg-results)]">
      <div className="mx-auto max-w-[1360px] px-8 pb-12 pt-8">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-brand">Workflow assessment</p>
            <h1 className="mt-2 text-[28px] font-bold leading-9 tracking-[-0.025em]">{analysis.headline}</h1>
            <p className="mt-1 text-[13px] text-fl-text-secondary">
              {analysis.mode === 'guided' ? 'Guided' : 'Quick'} analysis · {formatModifiedFull(analysis.createdAt)}
              {analysis.source === 'fixture' && ' · Test fixture, not a live AI analysis'}
            </p>
          </div>
          <div className="flex flex-none items-center gap-3">
            {analyses.length > 1 && (
              <label className="flex items-center gap-2 text-[13px] text-fl-text-secondary">
                <span className="fl-sr-only">Show analysis</span>
                <select className="fl-input !min-h-11 !w-auto !py-2 !text-[13px] font-semibold" value={analysis.slot} onChange={(e) => (setSlot(e.target.value as 'initial' | 'latest'), setSelectedId(null), setAssessId(null))}>
                  <option value="latest">Latest Analysis</option>
                  <option value="initial">Initial Analysis</option>
                </select>
              </label>
            )}
            {!noImprovements && !applied && (
              <button type="button" className="fl-btn fl-btn-gradient !min-h-11" disabled={accepted.length === 0} onClick={() => setConfirming(true)}>
                Apply reviewed changes <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
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

        <section className="fl-card mt-6 grid grid-cols-[1fr_auto] gap-8 p-6" aria-labelledby="exec-summary">
          <div className="min-w-0">
            <h2 id="exec-summary" className="text-[18px] font-bold leading-[26px]">
              Executive summary
            </h2>
            <p className="mt-2 max-w-[760px] text-[14px] leading-[22px] text-fl-text-secondary">{analysis.summary}</p>
            {analysis.assumptions.length > 0 && (
              <details className="mt-3 text-[13px] text-fl-text-secondary">
                <summary className="cursor-pointer font-semibold text-fl-brand">Assumptions ({analysis.assumptions.length})</summary>
                <ul className="mt-2 list-disc pl-5">
                  {analysis.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
            {analysis.answers.length > 0 && (
              <details className="mt-2 text-[13px] text-fl-text-secondary">
                <summary className="cursor-pointer font-semibold text-fl-brand">Your answers ({analysis.answers.length})</summary>
                <dl className="mt-2 space-y-1">
                  {analysis.answers.map((a) => (
                    <div key={a.question}>
                      <dt className="font-semibold text-fl-text">{a.question}</dt>
                      <dd>{a.answer}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
          <ul className="flex min-w-[240px] flex-col justify-center gap-2 border-l border-fl-border pl-8 text-[13px] text-fl-text-secondary">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--fl-diff-add)]" aria-hidden="true" />
              <strong className="text-fl-text">{recommendations.length}</strong> proposed change{recommendations.length === 1 ? '' : 's'}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--fl-diff-change)]" aria-hidden="true" />
              <strong className="text-fl-text">{verifyCount}</strong> require{verifyCount === 1 ? 's' : ''} verification
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border border-fl-border-strong" aria-hidden="true" />
              {assessments === null ? (
                'No automation assessment in this analysis'
              ) : (
                <>
                  <strong className="text-fl-text">{assessments.length}</strong> step{assessments.length === 1 ? '' : 's'} assessed for automation
                </>
              )}
            </li>
            <li className="flex items-center gap-2 font-semibold text-fl-text">
              <span className="h-2.5 w-2.5 rounded-full bg-fl-text-muted" aria-hidden="true" /> No numerical savings assumed
            </li>
          </ul>
        </section>

        <div
          className={fullView ? 'fixed inset-x-0 bottom-0 top-[var(--fl-header-height)] z-30 flex flex-col bg-[var(--fl-bg-results)] px-6 pb-5 pt-4' : 'mt-8'}
          data-testid="review-section"
          data-expanded={fullView || undefined}
        >
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-bold leading-[26px]">{noImprovements ? 'Your workflow' : 'Proposed workflow changes'}</h2>
            <p className="text-[13px] text-fl-text-secondary">
              {noImprovements ? 'Flico found no changes worth recommending. Your workflow is shown unchanged.' : 'Select a highlighted step or a recommendation to see how they relate.'}
            </p>
          </div>
          <button type="button" className="fl-btn flex-none gap-1.5 !min-h-10 !text-[13px] !text-fl-text-secondary" aria-pressed={fullView} onClick={toggleFullView}>
            {fullView ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
            {fullView ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>

        <div className={`mt-4 grid gap-5 ${showSide ? 'grid-cols-[minmax(0,62fr)_minmax(0,38fr)]' : ''} ${fullView ? 'min-h-0 flex-1' : ''}`}>
          <div className={`fl-card relative overflow-hidden !p-0 ${fullView ? 'h-full' : 'h-[560px]'}`}>
            <div className="pointer-events-none absolute left-5 right-5 top-4 z-10 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-fl-text-muted">{noImprovements ? 'Analysed workflow' : 'Change preview'}</p>
              {!noImprovements && (
                <ul className="flex gap-1.5" aria-label="Legend">
                  <li className="fl-diff-badge !static" data-diff="added">+ Added</li>
                  <li className="fl-diff-badge !static" data-diff="modified">↗ Updated</li>
                  <li className="fl-diff-badge !static" data-diff="removed">− Removed</li>
                </ul>
              )}
            </div>
            <ReviewDiagram
              display={display}
              focus={focus}
              revealIds={revealIds}
              label={noImprovements ? 'Analysed workflow' : 'Workflow with proposed changes'}
              onSelectElement={(id) => {
                if (sidePanel === 'automation') {
                  if (assessments?.some((a) => a.stepId === id)) setAssessId(assessId === id ? null : id);
                  return;
                }
                const recs = owners.get(id);
                if (recs?.length) setSelectedId(recs.includes(selectedId ?? '') ? selectedId : recs[0]!);
              }}
            />
          </div>

          {showSide && (
            <section className={`fl-card flex flex-col !p-0 ${fullView ? 'h-full min-h-0' : 'h-[560px]'}`} aria-labelledby={sidePanel === 'recs' ? 'recs-heading' : 'automation-heading'}>
              <div className="flex items-center justify-between gap-3 border-b border-fl-border px-4 pt-2">
                <div role="tablist" aria-label="Analysis details" className="flex gap-1">
                  {!noImprovements && (
                    <button
                      type="button"
                      role="tab"
                      id="recs-heading"
                      aria-selected={sidePanel === 'recs'}
                      className={`-mb-px min-h-11 border-b-2 px-2.5 text-[15px] ${sidePanel === 'recs' ? 'border-fl-brand font-bold text-fl-text' : 'border-transparent font-medium text-fl-text-secondary hover:text-fl-text'}`}
                      onClick={() => setPanel('recs')}
                    >
                      Recommendations <span className="font-normal text-fl-text-muted">({inPlay.length})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="tab"
                    id="automation-heading"
                    aria-selected={sidePanel === 'automation'}
                    className={`-mb-px min-h-11 border-b-2 px-2.5 text-[15px] ${sidePanel === 'automation' ? 'border-fl-brand font-bold text-fl-text' : 'border-transparent font-medium text-fl-text-secondary hover:text-fl-text'}`}
                    onClick={() => setPanel('automation')}
                  >
                    Automation {assessments && <span className="font-normal text-fl-text-muted">({assessments.length})</span>}
                  </button>
                </div>
                {sidePanel === 'recs' && (
                  <label className="pb-2">
                    <span className="fl-sr-only">Filter recommendations</span>
                    <select className="fl-input !min-h-9 !w-auto !py-1 !text-[12px]" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                      <option value="all">All categories</option>
                      <option value="quick_win">Quick Wins</option>
                      <option value="strategic">Strategic Improvements</option>
                      <option value="complex">Complex Changes</option>
                    </select>
                  </label>
                )}
              </div>
              {sidePanel === 'automation' && (
                <AutomationPanel assessments={assessments} snapshot={snapshot} currentGraph={currentGraph} selectedId={assessId} onSelect={setAssessId} />
              )}
              {sidePanel === 'recs' && (
              <>
              <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {visible(inPlay).map((r) => (
                  <RecommendationCard
                    key={r.id}
                    rec={r}
                    number={number.get(r.id)!}
                    selected={selectedId === r.id}
                    expanded={expanded.has(r.id)}
                    readOnly={applied || stale}
                    conflictWith={conflicts.filter((c) => c.ids.includes(r.id)).map((c) => c.message)}
                    dependsOn={r.dependsOn.map((id) => recommendations.find((x) => x.id === id)?.title).filter((t): t is string => !!t)}
                    onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)}
                    onToggle={() => setExpanded((s) => (s.has(r.id) ? new Set([...s].filter((x) => x !== r.id)) : new Set([...s, r.id])))}
                    onStatus={(status) => void setStatuses({ [r.id]: status })}
                  />
                ))}
                {visible(inPlay).length === 0 && <p className="px-1 text-[13px] text-fl-text-muted">No recommendations in this category.</p>}
                <div className="rounded-[12px] border border-fl-border bg-fl-surface-subtle">
                  <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-[13px] text-fl-text-secondary" aria-expanded={showRejected} onClick={() => setShowRejected(!showRejected)}>
                    <span>Rejected recommendations</span>
                    <span className="flex items-center gap-1.5 font-semibold">
                      {rejected.length} {showRejected ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    </span>
                  </button>
                  {showRejected && (
                    <div className="space-y-3 px-3 pb-3">
                      {rejected.length === 0 && <p className="text-[12px] text-fl-text-muted">None rejected.</p>}
                      {visible(rejected).map((r) => (
                        <RecommendationCard
                          key={r.id}
                          rec={r}
                          number={number.get(r.id)!}
                          selected={selectedId === r.id}
                          expanded={expanded.has(r.id)}
                          readOnly={applied || stale}
                          conflictWith={[]}
                          dependsOn={[]}
                          onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)}
                          onToggle={() => setExpanded((s) => (s.has(r.id) ? new Set([...s].filter((x) => x !== r.id)) : new Set([...s, r.id])))}
                          onStatus={(status) => void setStatuses({ [r.id]: status })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {!applied && !stale && (
                <div className="grid grid-cols-2 gap-3 border-t border-fl-border px-4 py-3">
                  <button type="button" className="fl-btn" disabled={accepted.length === 0} onClick={() => setConfirming(true)}>
                    Review &amp; confirm
                  </button>
                  <button
                    type="button"
                    className="fl-btn fl-btn-gradient"
                    disabled={inPlay.length === 0}
                    onClick={async () => {
                      await setStatuses(Object.fromEntries(inPlay.map((r) => [r.id, 'accepted' as const])));
                      setConfirming(true);
                    }}
                  >
                    Accept all
                  </button>
                </div>
              )}
              </>
              )}
            </section>
          )}
        </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-[12px] text-fl-text-secondary">
          <p>
            {!noImprovements && 'Dashed red shows what would be removed. '}
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
          accepted={ordered.filter((r) => r.status === 'accepted')}
          plan={plan}
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

function RecommendationCard(props: {
  rec: Recommendation;
  number: number;
  selected: boolean;
  expanded: boolean;
  readOnly: boolean;
  conflictWith: string[];
  dependsOn: string[];
  onSelect: () => void;
  onToggle: () => void;
  onStatus: (status: ReviewStatus) => void;
}) {
  const { rec, selected, expanded } = props;
  const detailsId = `rec-details-${rec.id}`;
  return (
    <article
      data-rec={rec.id}
      className={`rounded-[12px] border bg-white p-3.5 ${selected ? 'border-fl-brand shadow-[0_0_0_1px_var(--fl-brand)]' : 'border-fl-border'}`}
      aria-label={`Recommendation ${props.number}: ${rec.title}. ${CATEGORY_LABEL[rec.category]}. ${STATUS_LABEL[rec.status]}.`}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-fl-brand-pale text-[12px] font-bold text-fl-brand" aria-hidden="true">
          {props.number}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14px] font-semibold leading-5">
              <button type="button" className="text-left hover:underline" aria-pressed={selected} onClick={props.onSelect}>
                {rec.title}
              </button>
            </h3>
            <span className="flex-none text-[10.5px] font-bold uppercase tracking-[0.03em] text-fl-text-muted">{CATEGORY_LABEL[rec.category]}</span>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-fl-text-secondary">{rec.proposal}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <span className="text-fl-text-secondary">{EVIDENCE_LABEL[rec.evidence]}</span>
            <span aria-hidden="true">·</span>
            <button type="button" className="fl-link inline-flex items-center gap-0.5 text-[12px] no-underline hover:underline" aria-expanded={expanded} aria-controls={detailsId} onClick={props.onToggle}>
              Details {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
            </button>
            <span className="fl-badge ml-auto !py-0.5" data-status={rec.status === 'accepted' ? undefined : rec.status}>
              {rec.status === 'accepted' && <Check size={11} aria-hidden="true" />}
              {STATUS_LABEL[rec.status]}
            </span>
          </div>
          {expanded && (
            <dl id={detailsId} className="mt-3 space-y-2 border-t border-fl-border pt-3 text-[12.5px] leading-[18px]">
              {(
                [
                  ['Problem', rec.problem],
                  ['Why', rec.reason],
                  ['Benefits', rec.benefits],
                  ['Effort', `${LEVEL_LABEL[rec.effort]} effort · ${LEVEL_LABEL[rec.impact]} impact`],
                  ['Risks', rec.risks],
                  ['Assumptions', rec.assumptions],
                  ['How to verify', rec.verification],
                ] as const
              )
                .filter(([, text]) => text)
                .map(([term, text]) => (
                  <div key={term}>
                    <dt className="font-semibold text-fl-text">{term}</dt>
                    <dd className="text-fl-text-secondary">{text}</dd>
                  </div>
                ))}
            </dl>
          )}
          {props.dependsOn.length > 0 && <p className="mt-2 text-[12px] text-fl-text-secondary">Depends on: {props.dependsOn.map((t) => `“${t}”`).join(', ')}</p>}
          {props.conflictWith.map((message) => (
            <p key={message} role="alert" className="mt-2 rounded-[8px] bg-[var(--fl-exception-fill)] px-2 py-1.5 text-[12px] text-[var(--fl-exception-ink)]">
              {message}
            </p>
          ))}
          {!props.readOnly && (
            <div className="mt-2.5 flex gap-2">
              {rec.status !== 'accepted' && (
                <button type="button" className="fl-btn !min-h-8 !px-3 !text-[12px]" onClick={() => props.onStatus('accepted')} aria-label={`Accept: ${rec.title}`}>
                  <Check size={13} aria-hidden="true" /> Accept
                </button>
              )}
              {rec.status !== 'rejected' && (
                <button type="button" className="fl-btn !min-h-8 !px-3 !text-[12px]" onClick={() => props.onStatus('rejected')} aria-label={`Reject: ${rec.title}`}>
                  <X size={13} aria-hidden="true" /> Reject
                </button>
              )}
              {rec.status !== 'pending' && (
                <button type="button" className="fl-link text-[12px]" onClick={() => props.onStatus('pending')} aria-label={`Undecide: ${rec.title}`}>
                  {rec.status === 'rejected' ? 'Reconsider' : 'Undo choice'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
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
