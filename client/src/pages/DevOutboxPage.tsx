import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DevOutboxMessage } from '../../../shared/api';
import { AuthLayout } from '../components/AuthLayout';
import { api } from '../lib/api';
import { useTitle } from '../lib/useTitle';

type OutboxState = { messages: DevOutboxMessage[] | null; error: string | null };

async function fetchOutbox(): Promise<OutboxState> {
  try {
    const data = await api<{ messages: DevOutboxMessage[] }>('/api/dev/outbox');
    return { messages: data.messages, error: null };
  } catch (err) {
    return { messages: null, error: (err as Error).message };
  }
}

/** Development only: shows sign-in emails that would have been sent. Not included in production builds. */
export function DevOutboxPage() {
  useTitle('Development outbox');
  const [state, setState] = useState<OutboxState>({ messages: null, error: null });

  useEffect(() => {
    let active = true;
    const load = () =>
      void fetchOutbox().then((next) => {
        // Keep the last good list if a refresh fails.
        if (active) setState((prev) => ({ messages: next.messages ?? prev.messages, error: next.error }));
      });
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const { messages, error } = state;

  return (
    <AuthLayout wide>
      <section className="fl-card p-8" aria-labelledby="outbox-heading">
        <p className="fl-badge" data-status="pending">
          Development only · emails are not sent · unavailable in production
        </p>
        <h1 id="outbox-heading" className="mt-4 text-[22px] font-bold leading-8 tracking-[-0.025em]">
          Development outbox
        </h1>
        <p className="mt-2 text-fl-text-secondary">
          Sign-in emails appear here instead of being delivered. Newest first; refreshes automatically.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-fl-error">
            {error}
          </p>
        )}
        {messages?.length === 0 && (
          <p className="mt-6 rounded-[12px] border border-dashed border-fl-border-strong p-5 text-fl-text-secondary">
            No emails yet. <Link className="fl-link" to="/signin">Request a sign-in link</Link> for an invited email address.
          </p>
        )}
        {messages && messages.length > 0 && (
          <ul className="mt-6 space-y-3">
            {messages.map((message) => (
              <li key={message.id} className="rounded-[12px] border border-fl-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{message.subject}</p>
                  <p className="text-[12px] text-fl-text-muted">{new Date(message.sentAt).toLocaleTimeString()}</p>
                </div>
                <p className="text-[13px] text-fl-text-secondary">To: {message.to}</p>
                {message.link && (
                  <a className="fl-btn fl-btn-primary mt-3" href={message.link}>
                    Open sign-in link
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AuthLayout>
  );
}
