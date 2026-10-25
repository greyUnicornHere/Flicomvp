import { Link } from 'react-router';
import { Logo } from './Logo';
import { AccountMenu } from './AccountMenu';

/** Single-level top bar: logo left, account menu right, aligned to the dashboard content width. No sidebar. */
export function AppHeader({ email }: { email: string }) {
  return (
    <header className="fl-header px-0">
      <div className="fl-container flex items-center justify-between">
        <Link to="/" aria-label="Flico home" className="rounded-[6px]">
          <Logo />
        </Link>
        <AccountMenu email={email} />
      </div>
    </header>
  );
}
