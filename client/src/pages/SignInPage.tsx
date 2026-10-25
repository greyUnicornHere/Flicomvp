import { useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { MailCheck } from 'lucide-react';
import type { RequestLinkResponse } from '../../../shared/api';
import { AuthLayout } from '../components/AuthLayout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';

type FormState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; message: string; devOutbox: boolean }
  | { kind: 'error'; message: string };

export function SignInPage() {
  useTitle('Sign in');
  const auth = useAuth();
  const location = useLocation();
  const navState = location.state as { from?: string; signedOut?: boolean } | null;
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });
  const inputId = useId();
  const errorId = useId();

  if (auth.status === 'authenticated') return <Navigate to={navState?.from ?? '/'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setState({ kind: 'error', message: 'Please enter your email address.' });
      return;
    }
    setState({ kind: 'sending' });
    try {
      const response = await api<RequestLinkResponse>('/api/auth/request-link', { method: 'POST', body: { email } });
      setState({ kind: 'sent', message: response.message, devOutbox: response.devOutbox });
    } catch (error) {
      setState({ kind: 'error', message: (error as Error).message });
    }
  };

  if (state.kind === 'sent') {
    return (
      <AuthLayout>
        <section className="fl-card p-8" aria-labelledby="sent-heading">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-fl-brand-pale text-fl-brand" aria-hidden="true">
            <MailCheck size={22} />
          </div>
          <h1 id="sent-heading" className="mt-5 text-[22px] font-bold leading-8 tracking-[-0.025em]">
            Check your email
          </h1>
          <p className="mt-2 text-fl-text-secondary" role="status">
            {state.message}
          </p>
          {state.devOutbox && (
            <div className="mt-5 rounded-[12px] border border-fl-border bg-fl-surface-subtle p-4 text-[13px] leading-5">
              <p className="font-semibold text-fl-text">Development mode</p>
              <p className="mt-1 text-fl-text-secondary">
                Emails aren't sent while developing. Open the{' '}
                <Link className="fl-link" to="/dev/outbox">
                  local outbox
                </Link>{' '}
                to find your sign-in link.
              </p>
            </div>
          )}
          <button type="button" className="fl-btn mt-6" onClick={() => setState({ kind: 'idle' })}>
            Use a different email
          </button>
        </section>
      </AuthLayout>
    );
  }

  const error = state.kind === 'error' ? state.message : null;
  return (
    <AuthLayout>
      <section className="fl-card p-8" aria-labelledby="signin-heading">
        {navState?.signedOut && (
          <p className="mb-5 rounded-[10px] bg-fl-brand-pale px-3 py-2 text-[13px] leading-5 text-fl-brand-active" role="status">
            You've been signed out.
          </p>
        )}
        <h1 id="signin-heading" className="text-[22px] font-bold leading-8 tracking-[-0.025em]">
          Sign in to Flico
        </h1>
        <p className="mt-2 text-fl-text-secondary">
          Flico is invite-only. Enter the email address your invitation was sent to and we'll email you a one-time
          sign-in link.
        </p>
        <form className="mt-6" onSubmit={submit} noValidate>
          <label htmlFor={inputId} className="block text-[13px] font-semibold leading-5 text-fl-text">
            Email address
          </label>
          <input
            id={inputId}
            className="fl-input mt-2"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} role="alert" className="mt-2 text-[13px] leading-5 text-fl-error">
              {error}
            </p>
          )}
          <button type="submit" className="fl-btn fl-btn-primary mt-5 w-full" disabled={state.kind === 'sending'}>
            {state.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
      </section>
    </AuthLayout>
  );
}
