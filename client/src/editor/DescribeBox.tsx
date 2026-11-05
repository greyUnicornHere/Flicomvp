import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@xyflow/react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { DESCRIBE_TEXT_MAX } from '../../../shared/api';
import type { WorkflowNode } from '../../../shared/graph';
import { placePanel } from '../lib/placement';

const WIDTH = 420;
const HINTS = ['Who does it', 'Which tool', 'How long it takes', 'What if it goes wrong'];

type Props = {
  node: WorkflowNode;
  anchor: () => HTMLElement | null;
  busy: boolean;
  error: string | null;
  /** Shown when the description gave nothing to fill in. */
  notice: string | null;
  available: boolean;
  onSubmit: (text: string) => void;
  /** Open the details card instead, to edit the fields by hand. */
  onEditFields: () => void;
  onClose: (returnFocus: boolean) => void;
};

/**
 * Describe a step in your own words (owner request, 2026-11-05): double-clicking a step opens this
 * small window; Flico turns the text into the step's details, and proposes any new steps it implies.
 */
export function DescribeBox({ node, anchor, busy, error, notice, available, onSubmit, onEditFields, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const transform = useStore((s) => s.transform);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      const target = anchor();
      if (!el || !target) return;
      setPosition(placePanel(target.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight }, 84));
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchor, transform]);

  // Focus the text box once the window is placed (a hidden element can't take focus), and again
  // after Flico answers (the button that was pressed is replaced while it works).
  const placed = position !== null;
  useEffect(() => {
    if (placed && !busy) ref.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [placed, busy]);

  const submit = () => {
    if (text.trim() && !busy && available) onSubmit(text.trim());
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Describe ${node.label || 'this step'}`}
      className="fl-popover fixed z-40 !p-0"
      style={{ width: WIDTH, top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
      data-testid="describe-box"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
        e.stopPropagation(); // keep typing out of canvas shortcuts
      }}
    >
      <div className="flex items-start gap-2.5 px-4 pb-1.5 pt-3.5">
        <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-fl-brand-pale text-fl-brand" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase leading-4 tracking-[0.05em] text-fl-brand">Describe this step</p>
          <p className="truncate text-[14.5px] font-bold leading-5 text-fl-text">{node.label || 'Untitled step'}</p>
        </div>
        <button type="button" className="grid h-8 w-8 place-items-center rounded-[8px] text-fl-text-secondary hover:bg-fl-surface-subtle" aria-label="Close describe" disabled={busy} onClick={() => onClose(true)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <form
        className="px-4 pb-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block">
          <span className="fl-sr-only">Describe this step in your own words</span>
          <textarea
            className="fl-input !min-h-[104px] resize-none !text-[13.5px] !leading-[1.55]"
            placeholder="In your own words: who does it, with which tool, how long it takes, and what happens next or when it goes wrong."
            value={text}
            maxLength={DESCRIBE_TEXT_MAX}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fl-text-muted">
          Helpful to mention:
          {HINTS.map((h) => (
            <span key={h} className="rounded-full bg-fl-surface-subtle px-2 leading-[18px] text-fl-text-secondary">
              {h}
            </span>
          ))}
        </p>
        {!available && <p className="mt-2 text-[12.5px] text-fl-text-secondary">AI isn't set up on this Flico server, so describing isn't available. You can edit the fields yourself.</p>}
        {notice && !busy && (
          <p role="status" className="mt-2 rounded-[8px] bg-fl-surface-subtle px-2.5 py-1.5 text-[12.5px] text-fl-text-secondary">
            {notice}
          </p>
        )}
        {error && !busy && (
          <p role="alert" className="mt-2 rounded-[8px] bg-[var(--fl-exception-fill)] px-2.5 py-1.5 text-[12.5px] text-[var(--fl-exception-ink)]">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="text-[12.5px] font-semibold text-fl-text-secondary hover:text-fl-text hover:underline disabled:opacity-50" disabled={busy} onClick={onEditFields}>
            Edit fields myself
          </button>
          <span className="flex-1" />
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-[13px] text-fl-text-secondary">
              <span className="fl-dots text-fl-brand" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Flico is filling in the details…
            </p>
          ) : (
            <button type="submit" className="fl-btn fl-btn-primary !min-h-9 gap-1 !px-3.5 !text-[13px]" disabled={!text.trim() || !available}>
              Update step <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
