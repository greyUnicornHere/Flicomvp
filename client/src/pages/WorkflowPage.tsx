import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import type { WorkflowDetail } from '../../../shared/api';
import { AccountMenu } from '../components/AccountMenu';
import { Logo } from '../components/Logo';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';
import { fetchWorkflow } from '../lib/workflows';

type State = { kind: 'loading' } | { kind: 'ready'; workflow: WorkflowDetail } | { kind: 'missing' } | { kind: 'error'; message: string };

async function load(id: string): Promise<State> {
  try {
    return { kind: 'ready', workflow: await fetchWorkflow(id) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
    return { kind: 'error', message: (error as Error).message };
  }
}

/** Milestone 1: opened workflow shows its title and a placeholder. The editor is Milestone 2. */
export function WorkflowPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  useTitle(state.kind === 'ready' ? state.workflow.name : 'Workflow');

  useEffect(() => {
    let active = true;
    void load(id).then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [id]);

  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col bg-fl-page">
      <header className="fl-header">
        <Link to="/" aria-label="Flico home" className="rounded-[6px]">
          <Logo />
        </Link>
        <span className="h-8 w-px bg-fl-border" aria-hidden="true" />
        <Link to="/" className="fl-icon-btn border-transparent" aria-label="Back to dashboard">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-bold leading-[26px]">
          {state.kind === 'ready' ? state.workflow.name : state.kind === 'loading' ? '' : 'Workflow'}
        </h1>
        <AccountMenu email={user.email} />
      </header>

      <main className="fl-canvas flex flex-1 items-center justify-center px-6">
        {state.kind === 'loading' && (
          <p role="status" className="text-fl-text-secondary">
            Loading workflow…
          </p>
        )}
        {state.kind === 'ready' && (
          <div className="fl-card max-w-[480px] p-8 text-center">
            <h2 className="text-[18px] font-bold leading-[26px]">The workflow editor is coming next</h2>
            <p className="mt-2 text-fl-text-secondary">
              This workflow is saved. Editing steps arrives in the next milestone; until then you can rename or delete it
              from the dashboard.
            </p>
            <Link to="/" className="fl-btn fl-btn-primary mt-6">
              Back to dashboard
            </Link>
          </div>
        )}
        {state.kind === 'missing' && (
          <div className="fl-card max-w-[480px] p-8 text-center" role="alert">
            <h2 className="text-[18px] font-bold leading-[26px]">Workflow not found</h2>
            <p className="mt-2 text-fl-text-secondary">This workflow doesn't exist or you don't have access to it.</p>
            <Link to="/" className="fl-btn fl-btn-primary mt-6">
              Back to dashboard
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="fl-card max-w-[480px] p-8 text-center" role="alert">
            <h2 className="text-[18px] font-bold leading-[26px]">Couldn't open this workflow</h2>
            <p className="mt-2 text-fl-text-secondary">{state.message}</p>
            <button type="button" className="fl-btn fl-btn-primary mt-6" onClick={() => void load(id).then(setState)}>
              Retry
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
