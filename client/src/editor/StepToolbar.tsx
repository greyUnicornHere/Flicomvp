import { useRef, type ReactNode } from 'react';

export type ToolbarAction = {
  id: string;
  label: string;
  icon: ReactNode;
  /** Why it can't be used right now (shown as the tooltip and read by screen readers). */
  disabledReason?: string;
  onClick: () => void;
};

/** Floating vertical step toolbar. Arrow keys move between buttons; one Tab stop. */
export function StepToolbar({ actions }: { actions: ToolbarAction[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Edit details, then the five step types, then repeat / parallel / exception.
  const groups = [actions.slice(0, 1), actions.slice(1, 6), actions.slice(6)];

  const onKeyDown = (event: React.KeyboardEvent) => {
    const i = refs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = (i + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length;
    refs.current[next]?.focus();
  };

  let index = -1;
  return (
    <div
      role="toolbar"
      aria-label="Step tools for the selected step"
      aria-orientation="vertical"
      className="absolute left-6 top-1/2 z-10 flex w-[60px] -translate-y-1/2 flex-col items-center gap-1 rounded-[18px] border border-fl-border bg-fl-surface py-2 shadow-fl-float"
      onKeyDown={onKeyDown}
    >
      {groups.map((group, g) => (
        <div key={g} className={`flex flex-col items-center gap-1 ${g > 0 ? 'mt-1 border-t border-fl-border pt-2' : ''}`}>
          {group.map((action) => {
            index += 1;
            const i = index;
            const disabled = !!action.disabledReason;
            const tip = disabled ? `${action.label}: ${action.disabledReason}` : action.label;
            return (
              <div key={action.id} className="group relative">
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  tabIndex={i === 0 ? 0 : -1}
                  aria-label={action.label}
                  aria-disabled={disabled || undefined}
                  aria-description={action.disabledReason}
                  className={`grid h-11 w-11 place-items-center rounded-[11px] ${disabled ? 'cursor-not-allowed text-fl-text-muted opacity-45' : 'text-fl-text-secondary hover:bg-fl-brand-pale hover:text-fl-brand'}`}
                  onClick={() => !disabled && action.onClick()}
                >
                  {action.icon}
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-20 hidden w-max max-w-[240px] -translate-y-1/2 rounded-[8px] bg-fl-text px-2.5 py-1.5 text-[12px] leading-4 text-white group-hover:block group-has-[:focus-visible]:block"
                >
                  {tip}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
