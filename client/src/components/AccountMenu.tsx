import { useState } from 'react';
import { LogOut, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Menu } from './Menu';

/**
 * Avatar button with account dropdown: email, Feedback, Sign Out.
 * Feedback is listed as approved but stays disabled until the feedback feature (Milestone 5).
 */
export function AccountMenu({ email }: { email: string }) {
  const { signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <Menu
      label={`Account menu for ${email}`}
      triggerClassName="grid h-11 w-11 place-items-center rounded-full bg-fl-brand-pale text-[15px] font-semibold text-fl-brand transition-shadow duration-[140ms] hover:ring-1 hover:ring-fl-border-strong"
      triggerContent={<span aria-hidden="true">{email.charAt(0).toUpperCase()}</span>}
      width={260}
      error={error}
      header={
        <>
          <p className="truncate px-3 pb-3 pt-2 text-[13px] leading-5 text-fl-text-secondary" title={email}>
            {email}
          </p>
          <div className="mx-1 mb-1 border-t border-fl-border" role="separator" />
        </>
      }
      items={[
        {
          label: 'Feedback',
          icon: <MessageSquare size={18} aria-hidden="true" />,
          disabled: true,
          hint: 'Coming soon',
        },
        {
          label: busy ? 'Signing out…' : 'Sign Out',
          icon: <LogOut size={18} aria-hidden="true" className="text-fl-text-secondary" />,
          disabled: busy,
          onSelect: () => void handleSignOut(),
        },
      ]}
    />
  );
}
