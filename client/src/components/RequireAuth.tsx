import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { FullPageMessage } from './FullPageMessage';

/** Route guard. The server enforces access on every API call; this only decides what to render. */
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <FullPageMessage title="Loading Flico…" role="status" />;
  if (auth.status === 'error') {
    return (
      <FullPageMessage title="Couldn't reach Flico" role="alert">
        <p className="mt-2 text-fl-text-secondary">{auth.message}</p>
        <button type="button" className="fl-btn fl-btn-primary mt-6" onClick={() => void auth.refresh()}>
          Retry
        </button>
      </FullPageMessage>
    );
  }
  if (auth.status === 'anonymous') {
    // After an explicit sign-out, don't remember the page; otherwise return there after signing in.
    const state = auth.signedOut ? { signedOut: true } : { from: location.pathname + location.search };
    return <Navigate to="/signin" replace state={state} />;
  }
  return <Outlet />;
}
