import { useState } from 'react';
import { SquareStop } from 'lucide-react';

const key = (id: string) => `flico.finishSuggestion.${id}`;
function readDismissed(id: string) {
  try {
    return sessionStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

export function FinishSuggestion({ workflowId, afterLabel, onAdd }: { workflowId: string; afterLabel: string; onAdd: () => void }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(workflowId));
  if (dismissed) return null;
  return (
    <div role="region" aria-label="Suggestion" className="absolute bottom-6 left-[104px] z-10 flex max-w-[460px] items-center gap-3 rounded-[14px] border border-fl-border bg-fl-surface px-4 py-3 shadow-fl-card">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--fl-finish-fill)] text-[var(--fl-finish-ink)]" aria-hidden="true">
        <SquareStop size={16} />
      </span>
      <p className="text-[13px] leading-5 text-fl-text">
        Is the process complete? Add a Finish step after “{afterLabel}”.
      </p>
      <button type="button" className="fl-btn !min-h-9 !px-3 !text-[13px]" onClick={onAdd}>
        Add Finish
      </button>
      <button
        type="button"
        className="fl-link whitespace-nowrap text-[13px]"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(key(workflowId), '1');
          } catch {
            /* storage unavailable: dismissed for this view only */
          }
        }}
      >
        Not now
      </button>
    </div>
  );
}
