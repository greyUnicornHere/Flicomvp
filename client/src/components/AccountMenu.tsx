import { useEffect, useId, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';

/** Avatar button with account dropdown: email and Sign Out. (Feedback is added in Milestone 5.) */
export function AccountMenu({ email }: { email: string }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      // The route guard redirects to the sign-in page once the session is gone.
      await signOut();
    } catch (err) {
      setError(`Couldn't sign out. ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="grid h-11 w-11 place-items-center rounded-full bg-fl-brand-pale text-[15px] font-semibold text-fl-brand transition-shadow duration-[140ms] hover:ring-1 hover:ring-fl-border-strong"
        aria-label={`Account menu for ${email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          className="fl-popover absolute right-0 top-[calc(100%+8px)] z-50 w-[240px] !p-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close(true);
            }
            if (event.key === 'Tab') close(false);
          }}
        >
          <p className="truncate px-3 pb-3 pt-2 text-[13px] leading-5 text-fl-text-secondary" title={email}>
            {email}
          </p>
          <div className="mx-1 mb-1 border-t border-fl-border" role="separator" />
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            disabled={busy}
            className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14px] font-medium text-fl-text hover:bg-fl-surface-subtle focus-visible:bg-fl-surface-subtle"
            onClick={handleSignOut}
          >
            <LogOut size={18} aria-hidden="true" className="text-fl-text-secondary" />
            {busy ? 'Signing out…' : 'Sign Out'}
          </button>
          {error && (
            <p role="alert" className="px-3 pb-2 pt-1 text-[13px] leading-5 text-fl-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
