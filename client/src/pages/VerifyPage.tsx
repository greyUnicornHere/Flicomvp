import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { SessionResponse } from '../../../shared/api';
import { AuthLayout } from '../components/AuthLayout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';

/**
 * Landing page for emailed links. Signing in needs an explicit click (a POST), so email security scanners
 * that pre-open links can't use up the one-time token. The token is removed from the address bar immediately.
 */
export function VerifyPage() {
  useTitle('Finish signing in');
  const navigate = useNavigate();
  const { setSignedIn } = useAuth();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const [state, setState] = useState<{ kind: 'ready' } | { kind: 'verifying' } | { kind: 'error'; message: string }>(
    token ? { kind: 'ready' } : { kind: 'error', message: "This sign-in link is incomplete. Please request a new one." },
  );

  useEffect(() => {
    if (window.location.search) navigate('/auth/verify', { replace: true });
  }, [navigate]);

  const continueSignIn = async () => {
    if (!token) return;
    setState({ kind: 'verifying' });
    try {
      const { user } = await api<SessionResponse>('/api/auth/verify', { method: 'POST', body: { token } });
      setSignedIn(user);
      navigate('/', { replace: true });
    } catch (error) {
      setState({ kind: 'error', message: (error as Error).message });
    }
  };

  return (
    <AuthLayout>
      <section className="fl-card p-8" aria-labelledby="verify-heading">
        {state.kind === 'error' ? (
          <div role="alert">
            <h1 id="verify-heading" className="text-[22px] font-bold leading-8 tracking-[-0.025em]">
              This link can't be used
            </h1>
            <p className="mt-2 text-fl-text-secondary">{state.message}</p>
            <Link to="/signin" className="fl-btn fl-btn-primary mt-6 w-full">
              Request a new sign-in link
            </Link>
          </div>
        ) : (
          <>
            <h1 id="verify-heading" className="text-[22px] font-bold leading-8 tracking-[-0.025em]">
              Finish signing in
            </h1>
            <p className="mt-2 text-fl-text-secondary">Your sign-in link is ready. Continue to open Flico.</p>
            <button
              type="button"
              className="fl-btn fl-btn-primary mt-6 w-full"
              onClick={continueSignIn}
              disabled={state.kind === 'verifying'}
            >
              {state.kind === 'verifying' ? 'Signing in…' : 'Continue to Flico'}
            </button>
          </>
        )}
      </section>
    </AuthLayout>
  );
}
