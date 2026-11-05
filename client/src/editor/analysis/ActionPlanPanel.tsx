import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, ClipboardList, Handshake, MessageCircleQuestion, RefreshCw, Star, User, Workflow, X, Zap, type LucideIcon } from 'lucide-react';
import type { Recommendation, RecommendationCategory, ReviewStatus } from '../../../../shared/api';
import { BRIEF_KIND, BRIEF_TITLE, CLASS_SHORT, DIMENSIONS, DIMENSION_LABEL, EVIDENCE_LABEL as SOURCE_LABEL, nextStep, type AutomationClass, type EvidenceSource } from '../../../../shared/assessment';
import type { ActionPlan, AutomationItem, ProcessItem, Stage } from './actionPlan';
import { BriefDialog } from './BriefDialog';
import { InterviewPanel, type InterviewView } from './InterviewPanel';

export type PlanFilter = 'all' | 'process' | 'automation';
export type PlanSelection = { type: 'process' | 'automation'; id: string } | null;

const CATEGORY_LABEL: Record<RecommendationCategory, string> = { quick_win: 'Quick Win', strategic: 'Strategic Improvement', complex: 'Complex Change' };
const CATEGORY_SHORT: Record<RecommendationCategory, string> = { quick_win: 'Quick win', strategic: 'Strategic', complex: 'Complex' };
const EVIDENCE_LABEL = { supported: 'Supported by your workflow', assumption: 'Based on assumptions', verify: 'Requires verification' } as const;
const STATUS_LABEL: Record<ReviewStatus, string> = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' };
const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;
const CLASS_ICON: Record<AutomationClass, LucideIcon> = { full: Zap, assisted: Handshake, human: User, unknown: CircleHelp };
const TAG_STYLE: Record<EvidenceSource, string> = {
  user: 'bg-fl-brand-pale text-[var(--fl-action-ink)]',
  workflow: 'bg-[var(--fl-finish-fill)] text-[var(--fl-finish-ink)]',
  assumption: 'border border-dashed border-fl-border-strong text-fl-text-secondary',
};

const heading = 'text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary';
const primaryAction =
  'inline-flex min-h-8 items-center gap-1 rounded-[8px] border border-fl-brand bg-fl-brand px-2.5 text-[12px] font-semibold text-white hover:bg-fl-brand-hover disabled:cursor-not-allowed disabled:opacity-50';
const secondaryAction =
  'inline-flex min-h-8 items-center gap-1 rounded-[8px] border border-fl-border-strong bg-white px-2.5 text-[12px] font-semibold text-fl-brand hover:border-fl-brand hover:bg-fl-brand-pale disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white';

type Props = {
  plan: ActionPlan;
  /** null: the analysis was made before automation assessments existed. */
  hasAssessments: boolean | null;
  noImprovements: boolean;
  filter: PlanFilter;
  onFilter: (filter: PlanFilter) => void;
  selected: PlanSelection;
  onSelect: (selection: PlanSelection) => void;
  /** Step names, current where the step still exists. */
  name: (stepId: string) => string;
  /** Process changes can't be decided (applied, or the workflow changed). */
  readOnly: boolean;
  conflictsOf: (recId: string) => string[];
  dependsOnOf: (rec: Recommendation) => string[];
  onStatus: (statuses: Record<string, ReviewStatus>) => void;
  /** Why Clarify and briefs can't be used right now (null: they can). */
  actionsBlocked: string | null;
  onClarify?: (stepId: string) => void;
  onBrief?: (stepId: string) => void;
  /** Reassess one step against the workflow as it is now; rejects with a readable message. */
  onReassess?: (stepId: string) => Promise<void>;
  /** The Clarify or brief interview in progress, shown inside its step's card. */
  interview?: InterviewView | null;
  /** A brief that was just written: it opens by itself. */
  briefToOpen?: { stepId: string; key: number } | null;
  /** Show only the selected item's card (full screen: the card floats beside its block). */
  only?: boolean;
};

/**
 * The Action plan: process changes and automation opportunities in one list, each with the stages of
 * its own journey and its next action. Process changes are accepted, then applied to the workflow in
 * Flico; automation opportunities are clarified, then written up as a brief. Advisory only.
 */
export function ActionPlanPanel(props: Props) {
  const { plan, filter, selected, onSelect, name } = props;
  const [showRejected, setShowRejected] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  // Open a brief that was just written (once per new key).
  const [openedKey, setOpenedKey] = useState<number | null>(null);
  if (props.briefToOpen && props.briefToOpen.key !== openedKey) {
    setOpenedKey(props.briefToOpen.key);
    setViewing(props.briefToOpen.stepId);
  }
  const [reassessing, setReassessing] = useState<string | null>(null);
  const [reassessError, setReassessError] = useState<{ id: string; message: string } | null>(null);
  const reassess = async (stepId: string) => {
    if (!props.onReassess) return;
    setReassessing(stepId);
    setReassessError(null);
    try {
      await props.onReassess(stepId);
    } catch (error) {
      setReassessError({ id: stepId, message: (error as Error).message });
    } finally {
      setReassessing(null);
    }
  };
  const listRef = useRef<HTMLDivElement>(null);

  // A Clarify or brief interview that starts brings its card into view.
  const interviewStep = props.interview?.stepId ?? null;
  useEffect(() => {
    if (!interviewStep) return;
    listRef.current?.querySelector(`[data-plan-item="${CSS.escape(interviewStep)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [interviewStep]);

  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-plan-item="${CSS.escape(selected.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const showProcess = !props.noImprovements && filter !== 'automation';
  const showAutomation = filter !== 'process';
  const pending = plan.process.filter((p) => p.rec.status === 'pending');
  const toggle = (type: 'process' | 'automation', id: string) => onSelect(selected?.type === type && selected.id === id ? null : { type, id });
  const percent = plan.total === 0 ? 0 : Math.round((plan.done / plan.total) * 100);
  const filters: [PlanFilter, string, number][] = [
    ['all', 'All', plan.process.length + plan.automation.length],
    ...(props.noImprovements ? [] : ([['process', 'Process', plan.process.length]] as [PlanFilter, string, number][])),
    ['automation', 'Automation', plan.automation.length],
  ];
  const viewingItem = plan.automation.find((a) => a.id === viewing);

  const processCard = (item: ProcessItem) => (
    <ProcessCard
      key={item.id}
      item={item}
      selected={selected?.type === 'process' && selected.id === item.id}
      readOnly={props.readOnly}
      conflicts={props.conflictsOf(item.id)}
      dependsOn={props.dependsOnOf(item.rec)}
      onSelect={() => toggle('process', item.id)}
      onStatus={(status) => props.onStatus({ [item.id]: status })}
    />
  );

  const automationCard = (item: AutomationItem) => (
    <AutomationCard
      key={item.id}
      item={item}
      name={name(item.id)}
      selected={selected?.type === 'automation' && selected.id === item.id}
      onSelect={() => toggle('automation', item.id)}
      blocked={reassessing ? 'Flico is reassessing a step' : props.actionsBlocked}
      onClarify={props.onClarify && (() => props.onClarify!(item.id))}
      onBrief={props.onBrief && (() => props.onBrief!(item.id))}
      onReassess={props.onReassess && (() => void reassess(item.id))}
      reassessing={reassessing === item.id}
      reassessError={reassessError?.id === item.id ? reassessError.message : null}
      interview={props.interview?.stepId === item.id ? props.interview : null}
      onViewBrief={() => setViewing(item.id)}
    />
  );

  const briefDialog = viewingItem?.brief && (
    <BriefDialog
      brief={viewingItem.brief}
      stepName={name(viewingItem.id)}
      outdated={!viewingItem.briefCurrent}
      blocked={viewingItem.outdated ? 'This step changed since it was assessed: reassess it first' : props.actionsBlocked}
      onUpdate={
        props.onBrief && BRIEF_KIND[viewingItem.assessment.classification]
          ? () => {
              setViewing(null);
              props.onBrief!(viewingItem.id);
            }
          : undefined
      }
      onClose={() => setViewing(null)}
    />
  );

  // Full screen: just the selected item's card, floating beside its block.
  if (props.only) {
    const proc = selected?.type === 'process' ? [...plan.process, ...plan.rejected].find((i) => i.id === selected.id) : undefined;
    const auto = selected?.type === 'automation' ? plan.automation.find((i) => i.id === selected.id) : undefined;
    return (
      <div ref={listRef} data-testid="plan-card">
        <ol>
          {proc && processCard(proc)}
          {auto && automationCard(auto)}
        </ol>
        {briefDialog}
      </div>
    );
  }

  return (
    <section className="fl-card flex h-full min-h-0 flex-col !p-0" aria-labelledby="plan-heading" data-testid="action-plan">
      <div className="border-b border-fl-border px-4 pb-3 pt-3.5">
        <div className="flex items-baseline gap-2">
          <h2 id="plan-heading" className="text-[17px] font-bold leading-6">
            Action plan
          </h2>
          <span className="flex-1" />
          <span className="text-[12.5px] text-fl-text-secondary" data-testid="plan-progress">
            <strong className="text-fl-text">
              {plan.done} of {plan.total}
            </strong>{' '}
            done
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fl-surface-subtle" role="progressbar" aria-label="Action plan progress" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.done}>
          <div className="h-full rounded-full bg-fl-brand transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <div role="group" aria-label="Show" className="mt-3 flex gap-1.5">
          {filters.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              className={`min-h-8 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-semibold ${filter === key ? 'border-fl-brand bg-fl-brand text-white' : 'border-fl-border-strong bg-white text-fl-text-secondary hover:border-fl-brand hover:text-fl-text'}`}
              onClick={() => props.onFilter(key)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
        {props.noImprovements && filter !== 'automation' && (
          <p className="rounded-[12px] border border-fl-border bg-fl-surface-subtle px-3 py-2.5 text-[13px] leading-5 text-fl-text-secondary">
            Flico found no changes worth recommending. Your workflow is shown unchanged.
          </p>
        )}
        {showProcess && (
          <section aria-labelledby="plan-process">
            <div className="mb-1.5 flex items-center gap-2">
              <h3 id="plan-process" className={`flex items-center gap-1.5 ${heading}`}>
                <Workflow size={13} aria-hidden="true" /> Process changes
              </h3>
              <span className="flex-1" />
              {!props.readOnly && pending.length > 0 && (
                <button type="button" className="fl-link text-[12px]" onClick={() => props.onStatus(Object.fromEntries(pending.map((p) => [p.id, 'accepted' as const])))}>
                  Accept all
                </button>
              )}
            </div>
            <ol className="space-y-2">
              {plan.process.map((item) => processCard(item))}
            </ol>
            <div className="mt-2 rounded-[12px] border border-fl-border bg-fl-surface-subtle">
              <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-[12.5px] text-fl-text-secondary" aria-expanded={showRejected} onClick={() => setShowRejected(!showRejected)}>
                <span>Rejected changes</span>
                <span className="flex items-center gap-1.5 font-semibold">
                  {plan.rejected.length} {showRejected ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </span>
              </button>
              {showRejected && (
                <ol className="space-y-2 px-2.5 pb-2.5">
                  {plan.rejected.length === 0 && <li className="text-[12px] text-fl-text-muted">None rejected.</li>}
                  {plan.rejected.map((item) => (
                    <ProcessCard
                      key={item.id}
                      item={item}
                      selected={selected?.type === 'process' && selected.id === item.id}
                      readOnly={props.readOnly}
                      conflicts={[]}
                      dependsOn={[]}
                      onSelect={() => toggle('process', item.id)}
                      onStatus={(status) => props.onStatus({ [item.id]: status })}
                    />
                  ))}
                </ol>
              )}
            </div>
          </section>
        )}

        {showAutomation && (
          <section aria-labelledby="plan-automation">
            <h3 id="plan-automation" className={`mb-1.5 flex items-center gap-1.5 ${heading}`}>
              <Zap size={13} aria-hidden="true" /> Automation
            </h3>
            {props.hasAssessments === null ? (
              <p className="text-[13px] leading-5 text-fl-text-secondary">This analysis was made before automation assessments were added, so it has none. Run a new analysis to get them.</p>
            ) : plan.automation.length === 0 ? (
              <p className="text-[13px] leading-5 text-fl-text-secondary">No work steps could be assessed for automation in this analysis.</p>
            ) : (
              <ol className="space-y-2">
                {plan.automation.map(automationCard)}
              </ol>
            )}
          </section>
        )}
      </div>
      <p className="border-t border-fl-border px-4 py-2 text-[11.5px] leading-4 text-fl-text-muted">Advice only. Flico never runs automations or connects to your systems.</p>

      {briefDialog}
    </section>
  );
}

/** Where an item is in its journey: finished stages ticked, the current one filled, the rest grey. */
function StageTrack({ stages }: { stages: Stage[] }) {
  const current = stages.find((s) => s.state === 'current');
  const summary = current ? `${current.label} (step ${stages.indexOf(current) + 1} of ${stages.length})` : 'All stages done';
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label={`Progress: ${summary}`} data-testid="stage-track">
      {stages.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1" data-state={s.state}>
          <span
            className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-[18px] ${
              s.state === 'done' ? 'bg-fl-brand-pale text-[var(--fl-action-ink)]' : s.state === 'current' ? 'bg-fl-brand text-white' : 'bg-fl-surface-subtle text-fl-text-muted'
            }`}
          >
            {s.state === 'done' && <Check size={10} aria-hidden="true" />}
            {s.label}
          </span>
          {i < stages.length - 1 && (
            <span aria-hidden="true" className="text-[11px] text-fl-border-strong">
              ›
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function CardShell(props: { id: string; data: Record<string, string>; selected: boolean; done: boolean; label: string; children: React.ReactNode }) {
  return (
    <li
      data-plan-item={props.id}
      {...props.data}
      aria-label={props.label}
      className={`rounded-[12px] border p-3 ${props.done ? 'bg-fl-surface-subtle' : 'bg-white'} ${props.selected ? 'border-fl-brand shadow-[0_0_0_1px_var(--fl-brand)]' : 'border-fl-border'}`}
    >
      {props.children}
    </li>
  );
}

function ProcessCard(props: {
  item: ProcessItem;
  selected: boolean;
  readOnly: boolean;
  conflicts: string[];
  dependsOn: string[];
  onSelect: () => void;
  onStatus: (status: ReviewStatus) => void;
}) {
  const { rec } = props.item;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <CardShell id={rec.id} data={{ 'data-rec': rec.id }} selected={props.selected} done={props.item.done} label={`${rec.title}. ${CATEGORY_LABEL[rec.category]}. ${STATUS_LABEL[rec.status]}.`}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-[9px] bg-fl-surface-subtle text-fl-text-secondary" aria-hidden="true">
          <Workflow size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h4 className="min-w-0 flex-1 text-[14px] font-semibold leading-5">
              <button type="button" className="text-left hover:underline" aria-pressed={props.selected} onClick={props.onSelect}>
                {rec.title}
              </button>
            </h4>
            <span className="flex-none pt-0.5 text-[10.5px] font-bold uppercase tracking-[0.03em] text-fl-text-muted">{CATEGORY_SHORT[rec.category]}</span>
          </div>
          {rec.evidence === 'verify' && (
            <span className="mt-1 inline-flex rounded-full border border-dotted border-[var(--fl-approval-ink)] bg-[var(--fl-approval-fill)] px-2 text-[11px] font-semibold leading-[18px] text-[var(--fl-approval-ink)]">
              {EVIDENCE_LABEL.verify}
            </span>
          )}
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-fl-text-secondary">{rec.proposal}</p>
          {props.dependsOn.length > 0 && <p className="mt-1 text-[12px] text-fl-text-secondary">Depends on: {props.dependsOn.map((t) => `“${t}”`).join(', ')}</p>}
          {props.conflicts.map((message) => (
            <p key={message} role="alert" className="mt-1.5 rounded-[8px] bg-[var(--fl-exception-fill)] px-2 py-1.5 text-[12px] text-[var(--fl-exception-ink)]">
              {message}
            </p>
          ))}
          <div className="mt-2">
            {rec.status === 'rejected' ? (
              <span className="fl-badge !py-0.5" data-status="rejected">
                Rejected
              </span>
            ) : (
              <StageTrack stages={props.item.stages} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <button type="button" className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-fl-brand hover:underline" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />} Details
            </button>
            <span className="flex-1" />
            {!props.readOnly && rec.status !== 'pending' && (
              <button type="button" className="fl-link text-[12px]" onClick={() => props.onStatus('pending')} aria-label={`Undecide: ${rec.title}`}>
                {rec.status === 'rejected' ? 'Reconsider' : 'Undo choice'}
              </button>
            )}
            {!props.readOnly && rec.status === 'pending' && (
              <>
                <button type="button" className={secondaryAction} onClick={() => props.onStatus('rejected')} aria-label={`Reject: ${rec.title}`}>
                  <X size={13} aria-hidden="true" /> Reject
                </button>
                <button type="button" className={primaryAction} onClick={() => props.onStatus('accepted')} aria-label={`Accept: ${rec.title}`}>
                  <Check size={13} aria-hidden="true" /> Accept
                </button>
              </>
            )}
            {!props.readOnly && rec.status === 'rejected' && (
              <button type="button" className={secondaryAction} onClick={() => props.onStatus('accepted')} aria-label={`Accept: ${rec.title}`}>
                <Check size={13} aria-hidden="true" /> Accept
              </button>
            )}
          </div>
          {expanded && (
            <dl id={detailsId} className="mt-1.5 space-y-2 border-t border-fl-border pt-2 text-[12.5px] leading-[18px]">
              {(
                [
                  ['Evidence', EVIDENCE_LABEL[rec.evidence]],
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
        </div>
      </div>
    </CardShell>
  );
}

type Action = { key: string; label: string; aria: string; icon: LucideIcon; primary: boolean; onClick: () => void; gated: boolean };

/** The actions an automation step offers, the most useful next one first and filled. */
function automationActions(item: AutomationItem, name: string, handlers: { onClarify?: () => void; onBrief?: () => void; onViewBrief: () => void; onReassess?: () => void; reassessing?: boolean }): Action[] {
  const { assessment: a, brief, briefCurrent } = item;
  // The step itself changed: reassessing it comes first; the brief can still be read.
  if (item.outdated) {
    return [
      ...(brief ? [{ key: 'view', label: `View ${brief.kind === 'support' ? 'ideas' : 'brief'}`, aria: `View ${BRIEF_TITLE[brief.kind].toLowerCase()} for “${name}”`, icon: ClipboardList, primary: false, onClick: handlers.onViewBrief, gated: false }] : []),
      ...(handlers.onReassess
        ? [{ key: 'reassess', label: handlers.reassessing ? 'Reassessing…' : 'Reassess', aria: `Reassess “${name}”`, icon: RefreshCw, primary: true, onClick: handlers.onReassess, gated: true }]
        : []),
    ];
  }
  const kind = BRIEF_KIND[a.classification];
  const clarify = (primary: boolean): Action[] =>
    handlers.onClarify ? [{ key: 'clarify', label: 'Clarify', aria: `Clarify “${name}”`, icon: MessageCircleQuestion, primary, onClick: handlers.onClarify, gated: true }] : [];
  const view = (primary: boolean): Action[] =>
    brief ? [{ key: 'view', label: `View ${brief.kind === 'support' ? 'ideas' : 'brief'}`, aria: `View ${BRIEF_TITLE[brief.kind].toLowerCase()} for “${name}”`, icon: ClipboardList, primary, onClick: handlers.onViewBrief, gated: false }] : [];
  const create = (primary: boolean): Action[] =>
    kind && handlers.onBrief
      ? [
          {
            key: 'brief',
            label: brief ? 'Update brief' : kind === 'support' ? 'Support ideas' : 'Create brief',
            aria: brief ? `Update ${BRIEF_TITLE[kind].toLowerCase()} for “${name}”` : `Create ${BRIEF_TITLE[kind].toLowerCase()} for “${name}”`,
            icon: ClipboardList,
            primary,
            onClick: handlers.onBrief,
            gated: true,
          },
        ]
      : [];

  if (!kind) return clarify(true);
  // Once the brief is ready it is the only action; "Update brief" lives in the brief itself.
  if (briefCurrent) return view(a.classification !== 'human');
  if (a.classification === 'human') return [...clarify(false), ...(brief ? [...view(false), ...create(false)] : create(false))];
  if (brief) return [...view(false), ...create(true)];
  return a.clarified ? [...clarify(false), ...create(true)] : [...create(false), ...clarify(true)];
}

function AutomationCard(props: {
  item: AutomationItem;
  name: string;
  selected: boolean;
  onSelect: () => void;
  blocked: string | null;
  onClarify?: () => void;
  onBrief?: () => void;
  onViewBrief: () => void;
  onReassess?: () => void;
  reassessing: boolean;
  reassessError: string | null;
  interview: InterviewView | null;
}) {
  const { item, name, blocked } = props;
  const a = item.assessment;
  const Icon = CLASS_ICON[a.classification];
  const [why, setWhy] = useState(false);
  const whyId = useId();
  const next = nextStep(a);
  const lead = a.automatable || a.human || a.reasoning;
  const moreToVerify = [...a.questions, ...a.prerequisites].slice(1);
  // The suggested next action is filled and comes last, nearest the edge.
  const actions = automationActions(item, name, props).sort((x, y) => Number(x.primary) - Number(y.primary));
  const line = (label: string, text: string, LineIcon: LucideIcon) => (
    <p className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <span className="inline-flex items-center gap-1 font-semibold text-fl-text-secondary">
        <LineIcon size={12} aria-hidden="true" /> {label}
      </span>
      <span className="text-fl-text">{text}</span>
    </p>
  );
  return (
    <CardShell id={item.id} data={{ 'data-assessment': item.id }} selected={props.selected} done={item.done} label={`${name}. ${CLASS_SHORT[a.classification]}.`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid h-7 w-7 flex-none place-items-center rounded-[9px] ${a.classification === 'full' ? 'bg-fl-brand-pale text-fl-brand' : 'bg-fl-surface-subtle text-fl-text-secondary'}`} aria-hidden="true">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h4 className="min-w-0 flex-1 text-[14px] font-semibold leading-5">
              <button type="button" className="text-left hover:underline" aria-pressed={props.selected} onClick={props.onSelect}>
                {name}
              </button>
            </h4>
            <span className="flex-none pt-0.5 text-[10.5px] font-bold uppercase tracking-[0.03em] text-fl-text-muted">
              {CLASS_SHORT[a.classification]}
              {a.provisional && ' · provisional'}
            </span>
          </div>
          {(item.top || item.outdated) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {item.top && (
                <span className="inline-flex items-center gap-1 rounded-full bg-fl-brand-pale px-2 text-[11px] font-semibold leading-[18px] text-[var(--fl-action-ink)]">
                  <Star size={10} aria-hidden="true" /> Top opportunity
                </span>
              )}
              {item.outdated && (
                <span className="inline-flex items-center gap-1 rounded-full border border-dotted border-[var(--fl-approval-ink)] bg-[var(--fl-approval-fill)] px-2 text-[11px] font-semibold leading-[18px] text-[var(--fl-approval-ink)]">
                  <RefreshCw size={10} aria-hidden="true" /> Needs reassessment
                </span>
              )}
            </div>
          )}
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-fl-text-secondary">{lead}</p>
          {next && !item.done && !item.outdated && <p className="mt-0.5 text-[12px] leading-[17px] text-fl-text">Next: {next}</p>}
          {item.outdated && (
            <p className="mt-1 text-[12px] leading-[17px] text-[var(--fl-approval-ink)]" data-testid="freshness-note">
              This step changed since it was assessed. Reassess it to continue; no credit is used.
            </p>
          )}
          {item.freshness === 'upstream' && (
            <p className="mt-1 text-[12px] leading-[17px] text-fl-text-secondary" data-testid="freshness-note">
              An earlier step changed since this was assessed.{' '}
              {props.onReassess && (
                <button type="button" className="fl-link text-[12px]" disabled={!!blocked || props.reassessing} aria-label={`Reassess “${name}”`} onClick={props.onReassess}>
                  {props.reassessing ? 'Reassessing…' : 'Reassess'}
                </button>
              )}
            </p>
          )}
          {props.reassessError && (
            <p role="alert" className="mt-1 rounded-[8px] bg-[var(--fl-exception-fill)] px-2 py-1.5 text-[12px] text-[var(--fl-exception-ink)]">
              {props.reassessError}
            </p>
          )}
          <div className="mt-2">
            <StageTrack stages={item.stages} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <button type="button" className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-fl-brand hover:underline" aria-expanded={why} aria-controls={whyId} onClick={() => setWhy(!why)}>
              {why ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />} Why
            </button>
            <span className="flex-1" />
            {!props.interview && actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={action.primary ? primaryAction : secondaryAction}
                disabled={action.gated && !!blocked}
                title={action.gated && blocked ? blocked : undefined}
                aria-label={action.aria}
                onClick={action.onClick}
              >
                <action.icon size={13} aria-hidden="true" /> {action.label}
              </button>
            ))}
          </div>
          {blocked && !props.interview && actions.some((x) => x.gated) && <p className="mt-1 text-right text-[11.5px] text-fl-text-muted">{blocked}</p>}
          {props.interview && (
            <InterviewPanel
              view={props.interview}
              stepName={name}
              onCreateBrief={props.interview.mode === 'clarify' && BRIEF_KIND[a.classification] && !item.briefCurrent && !item.outdated ? props.onBrief : undefined}
            />
          )}
          {why && (
            <div id={whyId} className="mt-1.5 space-y-2.5 border-t border-fl-border pt-2 text-[12.5px] leading-[18px]">
              <div className="space-y-1">
                <p className="text-fl-text">{a.reasoning}</p>
                {a.automatable && line('Automate', a.automatable, Zap)}
                {a.human && line('Keep human', a.human, User)}
              </div>
              <div>
                <h5 className={heading}>Evidence</h5>
                <ul className="mt-1 space-y-1">
                  {a.evidence.map((e) => (
                    <li key={`${e.source}-${e.text}`} className="flex gap-2 text-fl-text">
                      <span className={`mt-px flex-none self-start rounded-[6px] px-1.5 text-[11px] font-semibold leading-[18px] ${TAG_STYLE[e.source]}`}>{SOURCE_LABEL[e.source]}</span>
                      <span>{e.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {moreToVerify.length > 0 && (
                <div>
                  <h5 className={heading}>Also to verify</h5>
                  <ul className="mt-0.5 list-disc pl-4 text-fl-text">
                    {moreToVerify.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h5 className={heading}>Reasoning by area</h5>
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
                <h5 className={heading}>Business value</h5>
                <p className="mt-0.5 text-fl-text-secondary">{a.value || 'Not assessed: no frequency, time or error figures were given.'}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}
