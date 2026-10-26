import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import type { StepType } from '../../../shared/graph';
import { placePanel } from '../lib/placement';
import { STEP_META } from './stepMeta';

export type InsertChoice = 'action' | 'decision' | 'approval' | 'wait' | 'finish';
const CHOICES: InsertChoice[] = ['action', 'decision', 'approval', 'wait', 'finish'];

type Props = {
  anchor: HTMLElement;
  /** Finish can't be placed between two steps. */
  finishAllowed: boolean;
  onChoose: (type: InsertChoice) => void;
  onClose: () => void;
};

/** Compact menu opened from a +: the manual step types, plus AI Quick Add (not available yet). */
export function InsertMenu({ anchor, finishAllowed, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const hintId = useId();

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      setPosition(placePanel(anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight }, 84));
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    if (position) items.current[0]?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchor, onClose]);

  const close = () => {
    onClose();
    anchor.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Add a step"
      className="fl-popover fixed z-50 w-[248px] !p-2"
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
    >
      {CHOICES.map((type, index) => {
        const Icon = STEP_META[type as StepType].icon;
        const disabled = type === 'finish' && !finishAllowed;
        return (
          <button
            key={type}
            ref={(el) => {
              items.current[index] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={disabled || undefined}
            className={`flex min-h-10 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[14px] font-medium focus-visible:bg-fl-surface-subtle ${disabled ? 'cursor-not-allowed text-fl-text-muted' : 'text-fl-text hover:bg-fl-surface-subtle'}`}
            onClick={() => !disabled && onChoose(type)}
          >
            <span className="fl-node-icon" data-type={type} style={nodeColours(type)} aria-hidden="true">
              <Icon size={14} strokeWidth={2.25} />
            </span>
            <span className="flex-1">{STEP_META[type].name}</span>
            {disabled && <span className="text-[11px] font-normal">Ends a path only</span>}
          </button>
        );
      })}
      <div className="mx-1 my-1.5 border-t border-fl-border" role="separator" />
      <div className="px-1 pb-1">
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-fl-text-secondary">
          <Sparkles size={13} aria-hidden="true" /> Quick Add with AI
        </label>
        <input className="fl-input mt-1.5 !min-h-10 !text-[13px]" placeholder="Describe what happens next…" disabled aria-label="Describe what happens next" aria-describedby={hintId} />
        <p id={hintId} className="mt-1 text-[11px] leading-4 text-fl-text-muted">
          AI Quick Add arrives in a later update.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** Tinted icon background matching the step type's colours. */
function nodeColours(type: StepType): React.CSSProperties {
  return {
    color: `var(--fl-${type}-ink)`,
    background: `color-mix(in srgb, var(--fl-${type}-stroke), white 65%)`,
  };
}
