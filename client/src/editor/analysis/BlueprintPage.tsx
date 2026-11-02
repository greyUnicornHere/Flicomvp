import { useState } from 'react';
import { ArrowLeft, Bot, Check, CircleDashed, Copy, Download, FileCode2, ListChecks, Lock, Play, RefreshCw, ShieldAlert, UserCheck, Wrench, Workflow, type LucideIcon } from 'lucide-react';
import { CLASS_SHORT } from '../../../../shared/assessment';
import { BUILD_HINT, BUILD_LABEL, readiness, type Blueprint } from '../../../../shared/blueprint';
import { formatModifiedFull } from '../../lib/workflows';
import { EXPORT_FORMATS, FORMAT_LABEL, defaultFormat, exportFileName, exportText, type ExportFormat } from './blueprintExport';

type Props = {
  blueprint: Blueprint;
  stepName: string;
  workflowName: string;
  /** The step itself, or its classification, changed since the blueprint was written. */
  outdated: boolean;
  /** The step changed since it was assessed: reassess it first. */
  stepChanged: boolean;
  /** Why it can't be updated right now (null: it can). */
  blocked: string | null;
  onUpdate?: () => void;
  onBack: () => void;
};

const heading = 'text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary';

/**
 * A step's agent-ready blueprint as a full page (owner choice, 2026-11-02): what to build and why,
 * the spec a builder needs, a readiness check and the exports. Advisory only: nothing is run.
 */
export function BlueprintPage({ blueprint: bp, stepName, workflowName, outdated, stepChanged, blocked, onUpdate, onBack }: Props) {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat(bp.buildType));
  const [copied, setCopied] = useState(false);
  const ready = readiness(bp);
  const ctx = { stepName, workflowName };
  const text = exportText(format, bp, ctx);
  const BuildIcon = bp.buildType === 'rules' ? Workflow : bp.buildType === 'agent' ? Bot : UserCheck;

  const download = () => {
    const blob = new Blob([text], { type: format === 'json' ? 'application/json' : format === 'outline' ? 'text/plain' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(format, stepName);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--fl-bg-results)]" data-testid="blueprint-page">
      <div className="mx-auto max-w-[1360px] px-8 pb-10 pt-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-fl-text-secondary">
          <button type="button" className="fl-btn !min-h-9 gap-1.5 !px-3 !text-[13px]" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to Action plan
          </button>
          <span aria-hidden="true">·</span>
          <span>Analysis</span>
          <span aria-hidden="true">›</span>
          <span className="font-semibold text-fl-text">Blueprint</span>
        </nav>

        <header className="mt-5 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[12px] text-fl-text-secondary">
              <span className="rounded-full bg-fl-brand-pale px-2 text-[11px] font-bold uppercase leading-[18px] tracking-[0.03em] text-[var(--fl-action-ink)]">{CLASS_SHORT[bp.classification]}</span>
              <span>Written {formatModifiedFull(bp.createdAt)}</span>
              {bp.source === 'fixture' && (
                <span className="fl-badge" data-status="draft">
                  Test fixture, not a live AI blueprint
                </span>
              )}
            </p>
            <h1 className="mt-1.5 text-[26px] font-bold leading-[34px] tracking-[-0.02em]">Blueprint · {stepName}</h1>
            <p className="mt-0.5 max-w-[820px] text-[14px] leading-[22px] text-fl-text-secondary">{bp.goal}</p>
          </div>
          {onUpdate && (
            <button type="button" className="fl-btn flex-none gap-1.5 !min-h-10" disabled={!!blocked} title={blocked ?? undefined} onClick={onUpdate}>
              <RefreshCw size={15} aria-hidden="true" /> Update blueprint
            </button>
          )}
        </header>

        {outdated && (
          <div role="status" className="mt-4 rounded-[12px] border border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] px-4 py-3 text-[13px] text-[var(--fl-approval-ink)]">
            {stepChanged
              ? 'This step changed since it was assessed. Reassess it in the Action plan, then update the blueprint.'
              : 'The step or its classification changed since this blueprint was written. Update the blueprint to match.'}
          </div>
        )}

        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5">
          <div className="space-y-4">
            <section className="fl-card flex gap-4 !p-5" aria-labelledby="build-type">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-[12px] bg-fl-brand-pale text-fl-brand" aria-hidden="true">
                <BuildIcon size={22} />
              </span>
              <div className="min-w-0">
                <p className={heading}>What to build</p>
                <h2 id="build-type" className="mt-0.5 text-[18px] font-bold leading-6" data-testid="build-type">
                  {BUILD_LABEL[bp.buildType]}
                </h2>
                <p className="mt-1 text-[13.5px] leading-5 text-fl-text">{bp.buildReason}</p>
                <p className="mt-1 text-[12.5px] leading-[18px] text-fl-text-secondary">{BUILD_HINT[bp.buildType]}</p>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-4">
              <Section icon={Play} title="Trigger and inputs">
                <p className="text-fl-text">
                  <span className="font-semibold">Starts when:</span> {bp.trigger || 'Not stated yet.'}
                </p>
                <List items={bp.inputs} prefix="Reads: " />
              </Section>
              <Section icon={Wrench} title="Tools and access" note={bp.tools.some((t) => t.access === 'write') ? undefined : 'Read only'}>
                {bp.tools.length === 0 ? (
                  <p className="text-fl-text-muted">No tools named yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {bp.tools.map((t) => (
                      <li key={t.name} className="flex items-start gap-2">
                        <code className="flex-none rounded-[6px] bg-fl-surface-subtle px-1.5 text-[12px] text-fl-text">{t.name}</code>
                        <span className="min-w-0 flex-1 text-fl-text-secondary">
                          {t.purpose} <span className="text-fl-text-muted">({t.system})</span>
                        </span>
                        <span
                          className={`flex-none rounded-full px-2 text-[11px] font-semibold leading-[18px] ${t.access === 'write' ? 'bg-[var(--fl-approval-fill)] text-[var(--fl-approval-ink)]' : 'bg-fl-brand-pale text-[var(--fl-action-ink)]'}`}
                        >
                          {t.access === 'write' ? 'Write' : 'Read'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section icon={ListChecks} title="Steps">
                <ol className="list-decimal space-y-0.5 pl-5 text-fl-text">
                  {bp.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </Section>
              <Section icon={Check} title="Rules">
                <List items={bp.rules} empty="No rule confirmed yet." />
              </Section>
              <Section icon={UserCheck} title="Human checkpoints">
                <List items={bp.checkpoints} empty="None set." />
                {bp.handover.length > 0 && (
                  <>
                    <p className="mt-2 font-semibold text-fl-text">Hand over to a person when:</p>
                    <List items={bp.handover} />
                  </>
                )}
              </Section>
              <Section icon={ShieldAlert} title="Never">
                <List items={bp.guardrails} />
              </Section>
            </div>

            <Section icon={FileCode2} title="Test cases" note={`${bp.tests.length} case${bp.tests.length === 1 ? '' : 's'}`}>
              {bp.tests.length === 0 ? (
                <p className="text-fl-text-muted">No test cases yet.</p>
              ) : (
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.04em] text-fl-text-secondary">
                      <th className="w-[22%] py-1 pr-3 font-bold">Case</th>
                      <th className="py-1 pr-3 font-bold">Input</th>
                      <th className="py-1 font-bold">Expected result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bp.tests.map((t) => (
                      <tr key={t.name + t.input} className="border-t border-fl-border align-top">
                        <td className="py-1.5 pr-3 font-semibold text-fl-text">{t.name}</td>
                        <td className="py-1.5 pr-3 text-fl-text-secondary">{t.input}</td>
                        <td className="py-1.5 text-fl-text">{t.expected}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {bp.openQuestions.length > 0 && (
              <section className="rounded-[14px] border border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] px-5 py-4 text-[13px] text-[var(--fl-approval-ink)]" aria-labelledby="open-questions" data-testid="open-questions">
                <h2 id="open-questions" className="font-bold">
                  {bp.openQuestions.length} open question{bp.openQuestions.length === 1 ? '' : 's'}
                </h2>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {bp.openQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <p className="mt-1.5">Answer them with Update blueprint; Flico asks only what's missing.</p>
              </section>
            )}
          </div>

          <aside className="sticky top-4 space-y-4">
            <section className="fl-card !p-5" aria-labelledby="readiness" data-testid="readiness">
              <p className={heading}>Readiness</p>
              <h2 id="readiness" className={`mt-0.5 text-[17px] font-bold ${ready.ready ? 'text-fl-brand' : 'text-[var(--fl-approval-ink)]'}`}>
                {ready.ready ? 'Ready to build' : 'Not ready yet'}
              </h2>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {ready.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2" data-ok={c.ok}>
                    {c.ok ? <Check size={15} className="mt-0.5 flex-none text-fl-brand" aria-hidden="true" /> : <CircleDashed size={15} className="mt-0.5 flex-none text-[var(--fl-approval-ink)]" aria-hidden="true" />}
                    <span>
                      <span className={c.ok ? 'text-fl-text' : 'font-semibold text-fl-text'}>{c.label}</span>
                      <span className="fl-sr-only">{c.ok ? ': done' : ': missing'}</span>
                      {!c.ok && <span className="block text-[12px] text-fl-text-secondary">{c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="fl-card !p-5" aria-labelledby="export-heading">
              <h2 id="export-heading" className="text-[16px] font-bold">
                Export
              </h2>
              <p className="mt-0.5 flex items-start gap-1.5 text-[12.5px] leading-[18px] text-fl-text-secondary">
                <Lock size={13} className="mt-0.5 flex-none" aria-hidden="true" /> Flico never runs this. Take it to the tool your team uses, then build and test it there.
              </p>
              <div role="radiogroup" aria-label="Export format" className="mt-3 space-y-1.5">
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={format === f}
                    className={`block w-full rounded-[10px] border px-3 py-2 text-left ${format === f ? 'border-fl-brand bg-fl-brand-pale/50' : 'border-fl-border bg-white hover:border-fl-border-strong'}`}
                    onClick={() => setFormat(f)}
                  >
                    <span className="block text-[13.5px] font-semibold text-fl-text">
                      {FORMAT_LABEL[f].label}
                      {f === defaultFormat(bp.buildType) && <span className="ml-1.5 text-[11px] font-semibold text-fl-brand">Suggested</span>}
                    </span>
                    <span className="block text-[12px] text-fl-text-secondary">{FORMAT_LABEL[f].hint}</span>
                  </button>
                ))}
              </div>
              <pre
                className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[10px] bg-[#1E2B29] px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-[#D7E6E0]"
                aria-label="Export preview"
                tabIndex={0}
                data-testid="export-preview"
              >
                {text}
              </pre>
              <div className="mt-3 flex gap-2">
                <button type="button" className="fl-btn fl-btn-gradient flex-1 gap-1.5" onClick={download}>
                  <Download size={15} aria-hidden="true" /> {FORMAT_LABEL[format].button}
                </button>
                <button type="button" className="fl-btn gap-1.5" onClick={() => void copy()}>
                  <Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, note, children }: { icon: LucideIcon; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="fl-card !p-4 text-[13px] leading-5" aria-label={title}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-[8px] bg-fl-surface-subtle text-fl-brand" aria-hidden="true">
          <Icon size={13} />
        </span>
        <h3 className="text-[14px] font-bold text-fl-text">{title}</h3>
        <span className="flex-1" />
        {note && <span className="text-[11.5px] text-fl-text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function List({ items, empty = 'None yet.', prefix = '' }: { items: string[]; empty?: string; prefix?: string }) {
  if (!items.length) return <p className="text-fl-text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-fl-text">
      {items.map((item) => (
        <li key={item}>
          {prefix}
          {item}
        </li>
      ))}
    </ul>
  );
}
