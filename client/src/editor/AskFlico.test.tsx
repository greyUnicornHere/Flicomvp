import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '../../../shared/api';
import { AskFlico } from './AskFlico';

const noop = () => {};
const props = {
  available: true,
  messages: [] as ChatMessage[],
  loadError: null,
  pending: null,
  failed: null,
  context: null,
  hasIssues: false,
  previewId: null,
  busyProposal: false,
  onSend: noop,
  onRetry: noop,
  onDismissError: noop,
  onReload: noop,
  onClearContext: noop,
  onClear: async () => {},
  onPreview: noop,
  onApply: noop,
  onCancelProposal: noop,
  onClose: noop,
};

const reply = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm2',
  role: 'assistant',
  content: '<img src=x onerror=alert(1)> Plain text only',
  createdAt: '2026-10-28T10:00:00.000Z',
  source: 'live',
  ...overrides,
});

describe('AskFlico', () => {
  it('says plainly when AI is not set up and sends nothing', async () => {
    const onSend = vi.fn();
    render(<AskFlico {...props} available={false} onSend={onSend} />);
    expect(screen.getByText(/AI isn't set up on this Flico server/)).toBeInTheDocument();
    expect(screen.getByLabelText('Message Ask Flico')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Summarize this workflow' })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders model text as plain text and labels test fixture replies', () => {
    const { container } = render(<AskFlico {...props} messages={[reply(), reply({ id: 'm3', source: 'fixture', content: 'Fixture' })]} />);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> Plain text only/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('Test fixture, not a live AI response')).toHaveLength(1);
  });

  it('offers contextual prompts and sends Fix requests in fix mode', async () => {
    const onSend = vi.fn();
    const { rerender } = render(<AskFlico {...props} hasIssues onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fix the issues in this workflow' }));
    expect(onSend).toHaveBeenCalledWith('Fix the issues in this workflow', 'fix');
    rerender(<AskFlico {...props} context={{ stepId: 's', stepLabel: 'Check order' }} onSend={onSend} />);
    expect(screen.getByText('Check order')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explain this step' })).toBeInTheDocument();
  });

  it('shows Apply/Cancel only for the proposal being previewed, and final states', () => {
    const proposal = { summary: 'Add a check', operations: [{ op: 'addStep' as const, id: 'n', type: 'action' as const, label: 'Check' }], status: 'pending' as const, baseRevision: 3 };
    const { rerender } = render(<AskFlico {...props} messages={[reply({ proposal })]} previewId="m2" />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByText('Steps: 1 added')).toBeInTheDocument();
    rerender(<AskFlico {...props} messages={[reply({ proposal })]} />);
    expect(screen.getByRole('button', { name: 'Preview on canvas' })).toBeInTheDocument();
    rerender(<AskFlico {...props} messages={[reply({ proposal: { ...proposal, status: 'expired' } })]} />);
    expect(screen.getByText(/the workflow changed since this suggestion/)).toBeInTheDocument();
  });

  it('asks before clearing the history', async () => {
    const onClear = vi.fn(async () => {});
    render(<AskFlico {...props} messages={[reply()]} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(onClear).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });
});
