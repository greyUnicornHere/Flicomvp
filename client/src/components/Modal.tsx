import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** Element to focus when the dialog opens (defaults to the first focusable element). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called on close when the element that opened the dialog no longer exists (e.g. a deleted row). */
  onFocusFallback?: () => void;
  /** Wide dialogs hold a diagram (analysis final preview). */
  wide?: boolean;
  /** Fill the whole screen (full-screen preview). */
  fill?: boolean;
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog: traps Tab focus, closes on Escape or backdrop click, and returns focus where it came from. */
export function Modal({ title, children, footer, onClose, initialFocusRef, onFocusFallback, wide = false, fill = false }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const fallbackRef = useRef(onFocusFallback);

  useEffect(() => {
    onCloseRef.current = onClose;
    fallbackRef.current = onFocusFallback;
  });

  // The element that opened the dialog, captured once when it first renders.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const first = initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      mounted.current = false;
      // Restore focus after React has finished removing the dialog (and possibly the opener).
      // Skipped if the dialog is still mounted (React development mode re-runs effects once).
      queueMicrotask(() => {
        if (mounted.current) return;
        if (opener?.isConnected) opener.focus();
        else fallbackRef.current?.();
      });
    };
  }, [initialFocusRef, opener]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(32,45,44,0.32)] p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`fl-popover flex max-h-full w-full flex-col !p-6 ${fill ? 'h-full max-w-none' : wide ? 'max-w-[1040px]' : 'max-w-[440px]'}`}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="flex-none text-[18px] font-bold leading-[26px]">
          {title}
        </h2>
        {/* Long content scrolls inside the dialog; the title and the buttons always stay on screen. */}
        <div className={`mt-2 min-h-0 text-fl-text-secondary ${fill ? 'flex flex-1 flex-col' : '-mx-1 overflow-y-auto px-1'}`} data-testid="modal-body">
          {children}
        </div>
        <div className="mt-6 flex flex-none justify-end gap-3">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
