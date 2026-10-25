import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { HealthResponse } from '../../../shared/api';
import { AuthLayout } from '../components/AuthLayout';
import { api } from '../lib/api';
import { useTitle } from '../lib/useTitle';

const mailLabels: Record<HealthResponse['mail'], string> = {
  'dev-outbox': 'Development outbox (emails not sent)',
  smtp: 'Email delivery (SMTP)',
};

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-fl-border py-3 last:border-b-0">
      <dt className="text-[13px] text-fl-text-secondary">{label}</dt>
      <dd className="flex items-center gap-2 text-[14px] font-semibold">
        {ok === true && <CircleCheck size={16} className="text-fl-success" aria-hidden="true" />}
        {ok === false && <CircleAlert size={16} className="text-fl-error" aria-hidden="true" />}
        {value}
      </dd>
    </div>
  );
}

type StatusState = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error'; message: string };

async function fetchStatus(): Promise<StatusState> {
  try {
    return { kind: 'ok', health: await api<HealthResponse>('/api/health') };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}

/** Public system status page backed by GET /api/health. */
export function StatusPage() {
  useTitle('System status');
  const [state, setState] = useState<StatusState>({ kind: 'loading' });
  const check = async () => setState(await fetchStatus());

  useEffect(() => {
    let active = true;
    void fetchStatus().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthLayout>
      <section className="fl-card p-8" aria-labelledby="status-heading" aria-busy={state.kind === 'loading'}>
        <h1 id="status-heading" className="text-[22px] font-bold leading-8 tracking-[-0.025em]">
          System status
        </h1>
        {state.kind === 'loading' && (
          <p className="mt-4 text-fl-text-secondary" role="status">
            Checking…
          </p>
        )}
        {state.kind === 'error' && (
          <div className="mt-4" role="alert">
            <p className="flex items-center gap-2 font-semibold text-fl-error">
              <CircleAlert size={18} aria-hidden="true" /> The Flico API isn't responding
            </p>
            <p className="mt-1 text-fl-text-secondary">{state.message}</p>
          </div>
        )}
        {state.kind === 'ok' && (
          <dl className="mt-4">
            <Row label="Overall" value={state.health.status === 'ok' ? 'Operational' : 'Degraded'} ok={state.health.status === 'ok'} />
            <Row label="API" value="Responding" ok />
            <Row label="Database" value={state.health.database === 'ok' ? 'Connected' : 'Error'} ok={state.health.database === 'ok'} />
            <Row label="Sign-in email" value={mailLabels[state.health.mail]} />
            <Row label="Environment" value={state.health.environment} />
            <Row label="Version" value={state.health.version} />
            <Row label="Checked" value={new Date(state.health.time).toLocaleString()} />
          </dl>
        )}
        <div className="mt-6 flex items-center gap-4">
          <button type="button" className="fl-btn" onClick={() => void check()}>
            Check again
          </button>
          <Link className="fl-link" to="/">
            Back to Flico
          </Link>
        </div>
      </section>
    </AuthLayout>
  );
}
