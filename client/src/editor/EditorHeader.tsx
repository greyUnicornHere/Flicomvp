import { useId, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, CircleAlert, Download, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { WORKFLOW_NAME_MAX } from '../../../shared/api';
import type { Issue, PreAnalysisResult } from '../../../shared/validation';
import { AccountMenu } from '../components/AccountMenu';
import { Logo } from '../components/Logo';
import { Menu } from '../components/Menu';
import type { SaveStatus } from '../lib/useAutosave';

type Props = {
  email: string;
  name: string;
  onRename: (name: string) => Promise<void>;
  save: { status: SaveStatus; error: string | null; retry: () => void };
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  issues: Issue[];
  onShowIssue: (issue: Issue) => void;
  analysisCheck: PreAnalysisResult;
  aiAvailable: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
  onSuggestFix: () => void;
  /** Editor/Analysis tabs, shown once an analysis exists. */
  view: 'editor' | 'analysis';
  hasAnalysis: boolean;
  onViewChange: (view: 'editor' | 'analysis') => void;
  analyze: { credits: number | null; initialCredits: number | null; disabledReason: string | null; onQuick: () => void; onGuided: () => void };
};

const soon = 'Available in a later update';

/** Single compact editor header. Unbuilt commands are visibly disabled, never pretending to work. */
export function EditorHeader(props: Props) {
  const { save, issues } = props;
  const iconBtn = 'grid h-11 w-11 place-items-center rounded-[11px] border border-fl-border bg-fl-surface text-fl-text-secondary hover:bg-fl-brand-pale hover:text-fl-brand disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-fl-surface disabled:hover:text-fl-text-secondary';
  const soonBtn = 'fl-btn !min-h-11 gap-1.5 !px-3.5 !text-[13px] disabled:cursor-not-allowed disabled:opacity-55';

  return (
    <header className="fl-header !gap-3 !px-6">
      <Link to="/" aria-label="Flico home" className="flex-none rounded-[6px]">
        <Logo width={124} />
      </Link>
      <span className="h-8 w-px flex-none bg-fl-border" aria-hidden="true" />
      <Link to="/" className="grid h-11 w-11 flex-none place-items-center rounded-[11px] text-fl-text-secondary hover:bg-fl-brand-pale hover:text-fl-brand" aria-label="Back to dashboard">
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
      <Title name={props.name} onRename={props.onRename} />
      <SaveIndicator {...save} />

      <div className="ml-auto flex flex-none items-center gap-2">
        {props.hasAnalysis && (
          <div role="tablist" aria-label="View" className="mr-2 flex h-11 items-stretch gap-1">
            {(['editor', 'analysis'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={props.view === v}
                className={`border-b-2 px-3 text-[14px] font-semibold ${props.view === v ? 'border-fl-brand text-fl-brand' : 'border-transparent text-fl-text-secondary hover:text-fl-text'}`}
                onClick={() => props.onViewChange(v)}
              >
                {v === 'editor' ? 'Editor' : 'Analysis'}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={iconBtn} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo}>
          <Undo2 size={18} aria-hidden="true" />
        </button>
        <button type="button" className={iconBtn} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.onRedo}>
          <Redo2 size={18} aria-hidden="true" />
        </button>

        {issues.length > 0 && (
          <Menu
            label={`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} in this workflow`}
            triggerClassName="inline-flex h-11 items-center gap-1.5 rounded-[11px] border border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] px-3 text-[13px] font-semibold text-[var(--fl-warning)]"
            triggerContent={
              <>
                <AlertTriangle size={16} aria-hidden="true" /> {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
              </>
            }
            width={340}
            items={[
              ...issues.slice(0, 12).map((issue) => ({ label: issue.message, onSelect: () => props.onShowIssue(issue) })),
              props.aiAvailable
                ? { label: 'Suggest fix with AI', icon: <Sparkles size={15} aria-hidden="true" />, onSelect: props.onSuggestFix }
                : { label: 'Suggest fix with AI', icon: <Sparkles size={15} aria-hidden="true" />, disabled: true, hint: 'AI not set up' },
            ]}
          />
        )}

        <button
          type="button"
          className={`${soonBtn} ${props.chatOpen ? '!border-fl-brand !bg-fl-brand-pale !text-fl-brand' : ''}`}
          aria-pressed={props.chatOpen}
          onClick={props.onToggleChat}
          data-ask-flico
        >
          <Sparkles size={15} aria-hidden="true" /> Ask Flico
        </button>
        <AnalyzeMenu check={props.analysisCheck} {...props.analyze} />
        <button type="button" className={soonBtn} disabled title={soon} aria-describedby="fl-soon">
          <Download size={15} aria-hidden="true" /> Export
        </button>
        <span id="fl-soon" className="fl-sr-only">
          {soon}
        </span>
        <AccountMenu email={props.email} />
      </div>
    </header>
  );
}

/** Click-to-edit workflow title. Enter or leaving confirms; Escape cancels. */
function Title({ name, onRename }: { name: string; onRename: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const hintId = useId();

  const confirm = async () => {
    const trimmed = value.trim();
    if (!trimmed) return setError('Please enter a name.');
    if (trimmed === name) return setEditing(false);
    try {
      await onRename(trimmed);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="relative min-w-0 flex-shrink">
      <h1 className="min-w-0 text-[17px] font-bold leading-[26px]">
        {editing ? (
          <input
            className="fl-input !min-h-10 w-[300px] max-w-full !py-1 !text-[16px] !font-bold"
            aria-label="Workflow name"
            value={value}
            maxLength={WORKFLOW_NAME_MAX}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirm();
              if (e.key === 'Escape') {
                setValue(name);
                setEditing(false);
                setError(null);
              }
            }}
            onBlur={() => void confirm()}
          />
        ) : (
          <button
            type="button"
            className="block max-w-[340px] truncate rounded-[6px] px-1 text-left hover:bg-fl-surface-subtle"
            title={`${name} (click to rename)`}
            aria-describedby={hintId}
            onClick={() => {
              setValue(name);
              setEditing(true);
            }}
          >
            {name}
          </button>
        )}
      </h1>
      <span id={hintId} className="fl-sr-only">
        Click to rename
      </span>
      {error && (
        <p id={errorId} role="alert" className="absolute left-1 top-full mt-1 whitespace-nowrap rounded-[6px] bg-fl-surface px-2 py-1 text-[12px] text-fl-error shadow-fl-card">
          {error}
        </p>
      )}
    </div>
  );
}

function SaveIndicator({ status, error, retry }: Props['save']) {
  return (
    <div className="flex-none text-[13px]" role="status" aria-live="polite">
      {status === 'saving' && <span className="text-fl-text-muted">Saving…</span>}
      {(status === 'saved' || status === 'idle') && (
        <span className="inline-flex items-center gap-1 text-fl-text-muted">
          <Check size={14} aria-hidden="true" className="text-fl-success" /> Saved
        </span>
      )}
      {status === 'error' && (
        <span className="inline-flex items-center gap-2 text-fl-error" title={error ?? undefined}>
          <CircleAlert size={14} aria-hidden="true" /> Couldn't save
          <button type="button" className="fl-link text-[13px]" onClick={retry}>
            Retry
          </button>
        </span>
      )}
      {status === 'conflict' && (
        <span className="inline-flex items-center gap-2 text-fl-error">
          <CircleAlert size={14} aria-hidden="true" /> Changed in another tab
          <button type="button" className="fl-link text-[13px]" onClick={() => window.location.reload()}>
            Reload
          </button>
        </span>
      )}
    </div>
  );
}

/** Analyze: the pre-analysis check, remaining credits, and Quick or Guided analysis. */
function AnalyzeMenu({ check, credits, initialCredits, disabledReason, onQuick, onGuided }: { check: PreAnalysisResult } & Props['analyze']) {
  const summary = check.canAnalyze
    ? check.warnings.length
      ? `Ready, with ${check.warnings.length} ${check.warnings.length === 1 ? 'warning' : 'warnings'} you may want to fix first.`
      : 'This workflow is ready for analysis.'
    : `Fix before analysis: ${check.blockers.map((b) => b.message).join(' ')}`;
  const reason = disabledReason ?? (!check.canAnalyze ? 'Fix the problems above first' : credits === 0 ? 'No credits left' : null);
  return (
    <Menu
      label="Analyze"
      triggerClassName="fl-btn fl-btn-gradient !min-h-11 gap-1.5 !px-3.5 !text-[13px]"
      triggerContent={
        <>
          <Sparkles size={15} aria-hidden="true" /> Analyze <ChevronDown size={14} aria-hidden="true" />
        </>
      }
      width={320}
      header={
        <div className="px-3 pb-2 pt-2">
          <p className="text-[13px] font-semibold text-fl-text">Workflow check</p>
          <p className={`mt-1 text-[13px] leading-5 ${check.canAnalyze ? 'text-fl-text-secondary' : 'text-fl-error'}`}>{summary}</p>
          {credits !== null && (
            <p className="mt-2 text-[12px] leading-[18px] text-fl-text-muted">
              {credits === 0
                ? "You've used all your analysis credits. Ask the Flico team for more."
                : `${credits}${initialCredits ? ` of ${initialCredits}` : ''} ${credits === 1 ? 'analysis' : 'analyses'} left. Each completed analysis uses one; failed or cancelled ones are free.`}
            </p>
          )}
          <div className="mx-[-4px] mt-2 border-t border-fl-border" role="separator" />
        </div>
      }
      items={[
        { label: 'Quick Analysis', ...(reason ? { disabled: true, hint: reason } : { onSelect: onQuick }) },
        { label: 'Guided Analysis', ...(reason ? { disabled: true, hint: reason } : { onSelect: onGuided, hint: 'Up to 3 optional questions' }) },
      ]}
    />
  );
}
