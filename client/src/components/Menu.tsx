import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeMenu } from '../lib/placement';

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  /** Disabled items stay focusable so screen-reader users can discover them, but do nothing. */
  disabled?: boolean;
  hint?: string;
};

type MenuProps = {
  /** Accessible name of the trigger button. */
  label: string;
  triggerContent: ReactNode;
  triggerClassName: string;
  items: MenuItem[];
  /** Optional non-interactive content above the items (e.g. the signed-in email). */
  header?: ReactNode;
  width?: number;
  error?: string | null;
};

/** Dropdown menu: click or Enter/Space/ArrowDown opens; arrows move; Escape closes and returns focus. */
export function Menu({ label, triggerContent, triggerClassName, items, header, width = 220, error }: MenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // Drawn in a layer above the page (so containers can't clip it) and placed to stay fully on screen:
  // below the trigger when it fits, otherwise above. Re-placed on scroll and resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = buttonRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      setPosition(
        placeMenu(trigger, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const visible = open && position !== null;
  const close = () => {
    setOpen(false);
    setPosition(null);
  };

  // Focus the first item once the menu is placed and visible (not on every re-position).
  useEffect(() => {
    if (visible) itemRefs.current[0]?.focus({ preventScroll: true });
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const focusItem = (index: number) => {
    const count = items.length;
    itemRefs.current[(index + count) % count]?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        buttonRef.current?.focus();
        break;
      case 'Tab':
        // Continue the normal tab order from the trigger (the menu itself lives at the end of the page).
        close();
        buttonRef.current?.focus();
        break;
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close();
    buttonRef.current?.focus();
    item.onSelect?.();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerContent}
      </button>

      {open &&
        createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={{ width, top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
          className="fl-popover fixed z-50 !p-2"
          onKeyDown={onMenuKeyDown}
          onClick={(event) => event.stopPropagation()}
        >
          {header}
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              aria-label={item.hint ? `${item.label}, ${item.hint}` : undefined}
              tabIndex={-1}
              className={`flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14px] font-medium focus-visible:bg-fl-surface-subtle ${
                item.disabled
                  ? 'cursor-not-allowed text-fl-text-muted'
                  : item.danger
                    ? 'text-fl-error hover:bg-[var(--fl-exception-fill)]'
                    : 'text-fl-text hover:bg-fl-surface-subtle'
              }`}
              onClick={() => select(item)}
            >
              {item.icon}
              <span className="flex-1">
                {item.label}
              </span>
              {item.hint && (
                <span className="text-[12px] font-normal text-fl-text-muted" aria-hidden="true">
                  {item.hint}
                </span>
              )}
            </button>
          ))}
          {error && (
            <p role="alert" className="px-3 pb-2 pt-1 text-[13px] leading-5 text-fl-error">
              {error}
            </p>
          )}
        </div>,
          document.body,
        )}
    </div>
  );
}
