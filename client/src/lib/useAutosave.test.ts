import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { ApiError } from './api';
import { useAutosave } from './useAutosave';

type Props = { value: string };

function setup(save: (value: string, base: number) => Promise<{ revision: number }>) {
  // StrictMode, like the app in development: effects run twice and must not cause a save.
  return renderHook(({ value }: Props) => useAutosave({ value, initialRevision: 1, save, delayMs: 500 }), {
    initialProps: { value: 'v0' },
    wrapper: StrictMode,
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

  it('reports as saved only the value the server acknowledged, not a newer edit still in flight', async () => {
    const pending: ((r: { revision: number }) => void)[] = [];
    const save = vi.fn<(v: string, base: number) => Promise<{ revision: number }>>(() => new Promise((resolve) => pending.push(resolve)));
    const { result, rerender } = setup(save);
    expect(result.current.saved).toBe('v0');
    rerender({ value: 'v1' });
    await act(async () => vi.advanceTimersByTime(500));
    rerender({ value: 'v2' });
    await act(async () => vi.advanceTimersByTime(500));
    expect(result.current.saved).toBe('v0');
    await act(async () => pending[0]!({ revision: 2 }));
    // v1 is acknowledged; v2 is now being sent and is not reported as saved yet.
    expect(result.current.saved).toBe('v1');
    expect(save).toHaveBeenLastCalledWith('v2', 2);
    expect(result.current.status).toBe('saving');
    await act(async () => pending[1]!({ revision: 3 }));
    expect(result.current.saved).toBe('v2');
    expect(result.current.status).toBe('saved');
  });

  it('flushNow saves a just-committed value immediately and resolves with its revision', async () => {
    const save = vi.fn(async (_v: string, base: number) => ({ revision: base + 1 }));
    const { result } = setup(save);
    let revision = 0;
    await act(async () => {
      revision = await result.current.flushNow('v9');
    });
    expect(save).toHaveBeenLastCalledWith('v9', 1);
    expect(revision).toBe(2);
    expect(result.current.saved).toBe('v9');
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
  it('flushNow saves pending edits immediately and resolves with the saved revision', async () => {
    const save = vi.fn(async (_v: string, base: number) => ({ revision: base + 1 }));
    const { result, rerender } = setup(save);
    rerender({ value: 'v1' });
    let revision = 0;
    await act(async () => {
      revision = await result.current.flushNow();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(revision).toBe(2);
    await act(async () => {
      revision = await result.current.flushNow();
    });
    expect(save).toHaveBeenCalledTimes(1); // nothing pending: no extra save
    expect(revision).toBe(2);
  });

  it('flushNow rejects when saving fails', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(500, 'server_error', 'Down');
    });
    const { result, rerender } = setup(save);
    rerender({ value: 'v1' });
    await act(async () => {
      await expect(result.current.flushNow()).rejects.toThrow('Down');
    });
  });

  it('rebase adopts a server-saved value without saving it again', async () => {
    const save = vi.fn(async (_v: string, base: number) => ({ revision: base + 1 }));
    const { result, rerender } = setup(save);
    act(() => result.current.rebase('server', 7));
    rerender({ value: 'server' });
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).not.toHaveBeenCalled();
    rerender({ value: 'next' });
    await act(async () => vi.advanceTimersByTime(500));
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith('next', 7);
  });
});
