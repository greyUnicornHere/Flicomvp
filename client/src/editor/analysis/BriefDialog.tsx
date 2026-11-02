import { useState } from 'react';
import { Copy } from 'lucide-react';
import { BRIEF_TITLE, type AutomationBrief } from '../../../../shared/assessment';
import { Modal } from '../../components/Modal';

/** A step's brief: short sections to hand to IT, a vendor or a manager. A plan to discuss, never built or tested. */
export function BriefDialog({ brief, stepName, outdated, blocked, onUpdate, onClose }: { brief: AutomationBrief; stepName: string; outdated: boolean; blocked: string | null; onUpdate?: () => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const asText = [`${BRIEF_TITLE[brief.kind]}: ${stepName}`, '', brief.summary, ...brief.sections.flatMap((s) => ['', s.heading, ...s.items.map((i) => `- ${i}`)])].join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      title={`${BRIEF_TITLE[brief.kind]} · ${stepName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fl-btn gap-1.5" onClick={() => void copy()}>
            <Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy as text'}
          </button>
          {onUpdate && (
            <button type="button" className="fl-btn" disabled={!!blocked} title={blocked ?? undefined} onClick={onUpdate}>
              Update brief
            </button>
          )}
          <button type="button" className="fl-btn fl-btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[13.5px] leading-5" data-testid="brief">
        {outdated && (
          <p role="status" className="rounded-[8px] border border-[var(--fl-approval-stroke)] bg-[var(--fl-approval-fill)] px-2.5 py-1.5 text-[12.5px] text-[var(--fl-approval-ink)]">
            The step or its classification changed since this brief was written. Update the brief to match.
          </p>
        )}
        <p className="text-fl-text">{brief.summary}</p>
        {brief.sections.map((section) => (
          <section key={section.heading}>
            <h3 className="text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-fl-text-secondary">{section.heading}</h3>
            <ul className="mt-0.5 list-disc pl-5 text-fl-text">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="border-t border-fl-border pt-2 text-[12px] text-fl-text-muted">
          A plan to discuss, based on your answers. Flico doesn't build, connect or test automations; confirm the assumptions before relying on it.
        </p>
      </div>
    </Modal>
  );
}
