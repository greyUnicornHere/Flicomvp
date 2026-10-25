import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('replaces a crashed screen with a recoverable message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });
});
