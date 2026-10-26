import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkflowSummary } from '../../../shared/api';
import { mockApi, renderAt, signedIn } from '../test/render';

const wf = (id: string, name: string, updatedAt: string, status: WorkflowSummary['status'] = 'draft'): WorkflowSummary => ({
  id,
  name,
  status,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt,
});

const three = [
  wf('w3', 'Invoice approval', '2026-10-26T10:00:00.000Z'),
  wf('w2', 'Customer onboarding', '2026-10-25T10:00:00.000Z', 'analyzed'),
  wf('w1', 'Vendor management', '2026-10-20T10:00:00.000Z'),
];

const rowNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryByRole('link')?.textContent);

describe('dashboard', () => {
  it('shows the hero and two equal creation choices, with no sidebar (D01, D09)', async () => {
    mockApi({ 'GET /api/auth/me': signedIn(), 'GET /api/workflows': { status: 200, body: { workflows: [] } } });
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'A better way to work.' })).toBeInTheDocument();
    expect(screen.getByText('Map your workflows, uncover inefficiencies, and discover better ways to work.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Build manually/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create with AI/ })).toHaveAttribute('href', '/create/ai');
    expect(screen.getByRole('img', { name: 'Flico' })).toHaveAttribute('src', '/brand/flico-logo.png');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('replaces the table with the empty state when there are no workflows (D01)', async () => {
    mockApi({ 'GET /api/auth/me': signedIn(), 'GET /api/workflows': { status: 200, body: { workflows: [] } } });
    renderAt('/');
    expect(await screen.findByText('Your workflows will appear here once you create one.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/example/i)).not.toBeInTheDocument();
  });

  it('shows a populated table without the empty state, newest first, with status text (D03, D04)', async () => {
    mockApi({ 'GET /api/auth/me': signedIn(), 'GET /api/workflows': { status: 200, body: { workflows: three } } });
    renderAt('/');
    await screen.findByRole('table');
    expect(screen.queryByText('Your workflows will appear here once you create one.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Status', 'Last modified', 'Actions']);
    expect(rowNames()).toEqual(['Invoice approval', 'Customer onboarding', 'Vendor management']);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[1]!).getByText('Draft')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Analyzed')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Oct 26, 2026')).toBeInTheDocument();
  });

  it('filters live by name, case-insensitively, and says when nothing matches (D04)', async () => {
    mockApi({ 'GET /api/auth/me': signedIn(), 'GET /api/workflows': { status: 200, body: { workflows: three } } });
    renderAt('/');
    const search = await screen.findByRole('searchbox', { name: 'Search workflows' });
    await userEvent.type(search, 'ON');
    expect(rowNames()).toEqual(['Customer onboarding']);
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No workflows match “zzz”.')).toBeInTheDocument();
    expect(screen.queryByText('Your workflows will appear here once you create one.')).not.toBeInTheDocument();
  });

  it('opens a workflow when its row is clicked', async () => {
    mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows': { status: 200, body: { workflows: three } },
      'GET /api/workflows/w2': { status: 200, body: { workflow: { ...three[1], revision: 1, graph: { nodes: [], edges: [] } } } },
    });
    const router = renderAt('/');
    await userEvent.click(await screen.findByText('Oct 25, 2026'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows/w2'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Customer onboarding' })).toBeInTheDocument();
  });

  it('Build manually creates a workflow and opens it (D02)', async () => {
    const created = { ...wf('new1', 'Untitled workflow', '2026-10-26T12:00:00.000Z'), revision: 1, graph: { nodes: [], edges: [] } };
    const calls = mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows': { status: 200, body: { workflows: [] } },
      'POST /api/workflows': { status: 201, body: { workflow: created } },
      'GET /api/workflows/new1': { status: 200, body: { workflow: created } },
    });
    const router = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /Build manually/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflows/new1'));
    expect(calls.find((c) => c.key === 'POST /api/workflows')?.body).toEqual({ kind: 'manual' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Untitled workflow' })).toBeInTheDocument();
  });

  it('renames from the row menu and re-sorts (D05)', async () => {
    const calls = mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows': { status: 200, body: { workflows: three } },
      'PATCH /api/workflows/w1': (body) => ({
        status: 200,
        body: { workflow: { ...three[2], name: (body as { name: string }).name, updatedAt: '2026-10-26T11:00:00.000Z' } },
      }),
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Vendor management' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename workflow' });
    const input = within(dialog).getByLabelText('Workflow name');
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, 'Supplier onboarding{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.key === 'PATCH /api/workflows/w1')?.body).toEqual({ name: 'Supplier onboarding' });
    expect(rowNames()[0]).toBe('Supplier onboarding');
  });

  it('does not allow an empty name', async () => {
    mockApi({ 'GET /api/auth/me': signedIn(), 'GET /api/workflows': { status: 200, body: { workflows: three } } });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Invoice approval' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.clear(screen.getByLabelText('Workflow name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Please enter a name.');
  });

  it('delete asks for irreversible confirmation; Cancel keeps the workflow (D06)', async () => {
    const calls = mockApi({ 'GET /api/auth/me': signedIn(), 'GET /api/workflows': { status: 200, body: { workflows: three } } });
    renderAt('/');
    const trigger = await screen.findByRole('button', { name: 'Actions for Invoice approval' });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete workflow permanently?' });
    expect(dialog).toHaveTextContent('“Invoice approval”');
    expect(dialog).toHaveTextContent("can't be undone");
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(rowNames()).toContain('Invoice approval');
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
  });

  it('confirmed delete removes the workflow; the last one brings back the empty state (D07)', async () => {
    mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows': { status: 200, body: { workflows: [three[0]] } },
      'DELETE /api/workflows/w3': { status: 204 },
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Invoice approval' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('Your workflows will appear here once you create one.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Deleted “Invoice approval”.');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Recent workflows' })).toHaveFocus());
  });

  it('keeps the dialog open with an error if delete fails', async () => {
    mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows': { status: 200, body: { workflows: three } },
      'DELETE /api/workflows/w3': { status: 500, body: { error: { code: 'server_error', message: 'Database unavailable.' } } },
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Invoice approval' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Database unavailable.');
    expect(rowNames()).toContain('Invoice approval');
  });

  it('shows Retry when the list cannot load', async () => {
    mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows': { status: 500, body: { error: { code: 'server_error', message: 'Try again.' } } },
    });
    renderAt('/');
    expect(await screen.findByText("Couldn't load your workflows.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('account menu (D08)', () => {
  it('lists email, Feedback and Sign Out; keyboard works; Feedback is not yet active; Sign Out signs out', async () => {
    mockApi({
      'GET /api/auth/me': signedIn('jane@example.com'),
      'GET /api/workflows': { status: 200, body: { workflows: [] } },
      'POST /api/auth/logout': { status: 204 },
    });
    const router = renderAt('/');
    const trigger = await screen.findByRole('button', { name: 'Account menu for jane@example.com' });

    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('jane@example.com');
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveAccessibleName('Feedback, Coming soon');
    expect(items[1]).toHaveAccessibleName('Sign Out');
    expect(items[0]).toHaveFocus();
    expect(items[0]).toHaveAttribute('aria-disabled', 'true');

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign Out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'));
    expect(await screen.findByText("You've been signed out.")).toBeInTheDocument();
  });
});

describe('create with AI route', () => {
  it('is clearly marked unavailable and cannot submit', async () => {
    const calls = mockApi({ 'GET /api/auth/me': signedIn() });
    renderAt('/create/ai');
    expect(await screen.findByRole('heading', { name: 'Create with AI' })).toBeInTheDocument();
    expect(screen.getByText("AI drafting isn't available yet.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Describe your workflow'), 'We receive orders by email');
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    // Nothing is sent anywhere except the session check.
    expect(new Set(calls.map((c) => c.key))).toEqual(new Set(['GET /api/auth/me']));
  });
});

describe('workflow page', () => {
  it('shows not found for a workflow that is missing or not mine', async () => {
    mockApi({
      'GET /api/auth/me': signedIn(),
      'GET /api/workflows/someone-elses': { status: 404, body: { error: { code: 'not_found', message: 'Workflow not found.' } } },
    });
    renderAt('/workflows/someone-elses');
    expect(await screen.findByRole('heading', { name: 'Workflow not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
  });
});
