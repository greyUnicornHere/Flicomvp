import { useEffect, useId, useRef, useState } from 'react';
import { FilePlus2, Search } from 'lucide-react';
import type { WorkflowSummary } from '../../../shared/api';
import { AppHeader } from '../components/AppHeader';
import { CreationCards } from '../components/dashboard/CreationCards';
import { DeleteDialog, RenameDialog } from '../components/dashboard/WorkflowDialogs';
import { WorkflowTable } from '../components/dashboard/WorkflowTable';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';
import { deleteWorkflow, fetchWorkflows, filterWorkflows, renameWorkflow, sortByModified } from '../lib/workflows';

type ListState = { kind: 'loading' } | { kind: 'ready'; workflows: WorkflowSummary[] } | { kind: 'error'; message: string };
type Dialog = { kind: 'rename' | 'delete'; workflow: WorkflowSummary } | null;

async function loadList(): Promise<ListState> {
  try {
    return { kind: 'ready', workflows: await fetchWorkflows() };
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }
}

export function DashboardPage() {
  useTitle('');
  const { user } = useAuth();
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchId = useId();

  useEffect(() => {
    let active = true;
    void loadList().then((next) => active && setList(next));
    return () => {
      active = false;
    };
  }, []);

  if (!user) return null;
  const workflows = list.kind === 'ready' ? list.workflows : [];
  const hasWorkflows = workflows.length > 0;

  const update = (fn: (current: WorkflowSummary[]) => WorkflowSummary[]) =>
    setList((current) => (current.kind === 'ready' ? { kind: 'ready', workflows: fn(current.workflows) } : current));

  const confirmRename = async (workflow: WorkflowSummary, name: string) => {
    const renamed = await renameWorkflow(workflow.id, name);
    update((current) => sortByModified(current.map((w) => (w.id === renamed.id ? renamed : w))));
    setDialog(null);
    setAnnouncement(`Renamed to “${renamed.name}”.`);
  };

  const confirmDelete = async (workflow: WorkflowSummary) => {
    await deleteWorkflow(workflow.id);
    update((current) => current.filter((w) => w.id !== workflow.id));
    setDialog(null);
    setAnnouncement(`Deleted “${workflow.name}”.`);
  };

  return (
    <div className="min-h-screen bg-fl-page">
      <AppHeader email={user.email} />
      <main className="fl-container pb-16 pt-12">
        <section className="text-center" aria-labelledby="hero-heading">
          <h1 id="hero-heading" className="text-[40px] font-bold leading-[48px] tracking-[-0.025em]">
            A better way to work.
          </h1>
          <p className="mt-3 text-[18px] leading-[26px] text-fl-text-secondary">
            Map your workflows, uncover inefficiencies, and discover better ways to work.
          </p>
        </section>

        <CreationCards />

        <section className="mt-12" aria-labelledby="recent-heading">
          <div className="mb-4 flex min-h-11 items-center justify-between gap-6">
            <h2 id="recent-heading" ref={headingRef} tabIndex={-1} className="text-[18px] font-bold leading-[26px] outline-none">
              Recent workflows
            </h2>
            {hasWorkflows && (
              <div className="relative w-[336px]">
                <label htmlFor={searchId} className="fl-sr-only">
                  Search workflows
                </label>
                <Search
                  size={18}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fl-text-muted"
                />
                <input
                  id={searchId}
                  type="search"
                  className="fl-input !pl-10"
                  placeholder="Search workflows…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
          </div>

          {list.kind === 'loading' && (
            <p className="rounded-fl-card border border-fl-border bg-fl-surface p-6 text-fl-text-secondary" role="status">
              Loading your workflows…
            </p>
          )}

          {list.kind === 'error' && (
            <div className="rounded-fl-card border border-fl-border bg-fl-surface p-6" role="alert">
              <p className="font-semibold text-fl-error">Couldn't load your workflows.</p>
              <p className="mt-1 text-fl-text-secondary">{list.message}</p>
              <button
                type="button"
                className="fl-btn mt-4"
                onClick={() => {
                  setList({ kind: 'loading' });
                  void loadList().then(setList);
                }}
              >
                Retry
              </button>
            </div>
          )}

          {list.kind === 'ready' &&
            (hasWorkflows ? (
              <WorkflowTable
                workflows={filterWorkflows(workflows, query)}
                query={query}
                onRename={(workflow) => setDialog({ kind: 'rename', workflow })}
                onDelete={(workflow) => setDialog({ kind: 'delete', workflow })}
              />
            ) : (
              // Shown only instead of the table, never beneath it.
              <div className="flex items-center gap-5 rounded-fl-card border border-dashed border-fl-border-strong bg-fl-surface-subtle px-7 py-6">
                <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-[var(--fl-finish-fill)] text-fl-text-secondary">
                  <FilePlus2 size={24} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[15px] font-semibold leading-[22px] text-fl-text">
                    Your workflows will appear here once you create one.
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-fl-text-secondary">
                    Choose Build manually or Create with AI above to get started.
                  </p>
                </div>
              </div>
            ))}

          <p className="fl-sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </section>
      </main>

      {dialog?.kind === 'rename' && (
        <RenameDialog
          workflow={dialog.workflow}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => confirmRename(dialog.workflow, name)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          workflow={dialog.workflow}
          onCancel={() => setDialog(null)}
          onConfirm={() => confirmDelete(dialog.workflow)}
          onFocusFallback={() => headingRef.current?.focus()}
        />
      )}
    </div>
  );
}
