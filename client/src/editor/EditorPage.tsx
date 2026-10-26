import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ReactFlowProvider } from '@xyflow/react';
import type { WorkflowDetail } from '../../../shared/api';
import { AuthLayout } from '../components/AuthLayout';
import { ApiError } from '../lib/api';
import { useTitle } from '../lib/useTitle';
import { fetchWorkflow } from '../lib/workflows';
import { Editor } from './Editor';

type State = { kind: 'loading' } | { kind: 'ready'; workflow: WorkflowDetail } | { kind: 'missing' } | { kind: 'error'; message: string };

async function load(id: string): Promise<State> {
  try {
    return { kind: 'ready', workflow: await fetchWorkflow(id) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
    return { kind: 'error', message: (error as Error).message };
  }
}

/** /workflows/:id: the full-screen editor. */
export function EditorPage() {
  const { id = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  useTitle(state.kind === 'ready' ? state.workflow.name : 'Workflow');

  useEffect(() => {
    let active = true;
    void load(id).then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [id]);

  if (state.kind === 'ready') {
    return (
      <ReactFlowProvider>
        <Editor
          key={state.workflow.id}
          workflow={state.workflow}
          onRenamed={(name) => setState({ kind: 'ready', workflow: { ...state.workflow, name } })}
        />
      </ReactFlowProvider>
    );
  }

  return (
    <AuthLayout>
      <div className="fl-card p-8 text-center" role={state.kind === 'loading' ? 'status' : 'alert'}>
        {state.kind === 'loading' && <p className="text-fl-text-secondary">Loading workflow…</p>}
        {state.kind === 'missing' && (
          <>
            <h1 className="text-[18px] font-bold leading-[26px]">Workflow not found</h1>
            <p className="mt-2 text-fl-text-secondary">This workflow doesn't exist or you don't have access to it.</p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1 className="text-[18px] font-bold leading-[26px]">Couldn't open this workflow</h1>
            <p className="mt-2 text-fl-text-secondary">{state.message}</p>
            <button type="button" className="fl-btn fl-btn-primary mt-6" onClick={() => void load(id).then(setState)}>
              Retry
            </button>
          </>
        )}
        {state.kind !== 'loading' && (
          <Link to="/" className="fl-btn mt-6">
            Back to dashboard
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
