import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from './api';
import { useAutosave } from './useAutosave';

type Props = { value: string };

function setup(save: (value: string, base: number) => Promise<{ revision: number }>) {
  return renderHook(({ value }: Props) => useAutosave({ value, initialRevision: 1, save, delayMs: 500 }), {
    initialProps: { value: 'v0' },
  });
}

const flushPromises = () => act(async () => {});

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not save the initially loaded value', async () => {
    const save = vi.fn(async () => ({ revision: 2 }));
    const { result } = setup(save);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('debounces edits into one save with the latest value and tracks revisions', async () => {
    const save = vi.fn(async (_v: string, base: number) => ({ revision: base + 1 }));
    const { result, rerender } = setup(save);
    rerender({ value: 'v1' });
    rerender({ value: 'v2' });
    await act(async () => vi.advanceTimersByTime(499));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('v2', 1);
    expect(result.current.status).toBe('saved');

    rerender({ value: 'v3' });
    await act(async () => vi.advanceTimersByTime(500));
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith('v3', 2);
  });

  it('saves edits made during an in-flight save right after it finishes', async () => {
    let resolveFirst: (r: { revision: number }) => void = () => {};
    const save = vi
      .fn<(v: string, base: number) => Promise<{ revision: number }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementation(async (_v, base) => ({ revision: base + 1 }));
    const { result, rerender } = setup(save);
    rerender({ value: 'v1' });
    await act(async () => vi.advanceTimersByTime(500));
    expect(result.current.status).toBe('saving');
    rerender({ value: 'v2' });
    await act(async () => vi.advanceTimersByTime(500)); // debounce fires while first save is in flight
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst({ revision: 2 }));
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('v2', 2);
    expect(result.current.status).toBe('saved');
  });

  it('keeps a failure visible and saves again on Retry', async () => {
    const save = vi
      .fn<(v: string, base: number) => Promise<{ revision: number }>>()
      .mockRejectedValueOnce(new ApiError(0, 'network', "Couldn't reach Flico."))
      .mockResolvedValue({ revision: 2 });
    const { result, rerender } = setup(save);
    rerender({ value: 'v1' });
    await act(async () => vi.advanceTimersByTime(500));
    await flushPromises();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe("Couldn't reach Flico.");

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(result.current.status).toBe('error');

    await act(async () => result.current.retry());
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith('v1', 1);
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
  });

  it('stops on a revision conflict instead of overwriting newer work', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(409, 'conflict', 'This workflow was changed elsewhere.');
    });
    const { result, rerender } = setup(save);
    rerender({ value: 'v1' });
    await act(async () => vi.advanceTimersByTime(500));
    await flushPromises();
    expect(result.current.status).toBe('conflict');
    rerender({ value: 'v2' });
    await act(async () => vi.advanceTimersByTime(500));
    await act(async () => result.current.retry());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves a pending change immediately when the screen closes', async () => {
    const save = vi.fn(async () => ({ revision: 2 }));
    const { rerender, unmount } = setup(save);
    rerender({ value: 'v1' });
    unmount();
    expect(save).toHaveBeenCalledWith('v1', 1);
  });
});
