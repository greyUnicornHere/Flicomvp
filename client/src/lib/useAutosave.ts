import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

type Options<T> = {
  /** The value to keep saved. Each change (after the first render) schedules a save. */
  value: T;
  /** Revision the loaded value came from. */
  initialRevision: number;
  save: (value: T, baseRevision: number) => Promise<{ revision: number }>;
  delayMs?: number;
};

/**
 * Debounced autosave with optimistic locking, for the editor (Milestone 2).
 * - Only one save is in flight; edits made meanwhile are saved right after it.
 * - Failures keep the unsaved state and expose `retry`; errors stay visible until a save succeeds.
 * - A 409 conflict stops autosaving so newer work elsewhere is never overwritten.
 * - Warns before leaving the page while changes are unsaved.
 */
export function useAutosave<T>({ value, initialRevision, save, delayMs = 800 }: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(initialRevision);
  const latest = useRef(value);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const conflicted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isFirst = useRef(true);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(async function run(): Promise<void> {
    if (inFlight.current || !dirty.current || conflicted.current) return;
    inFlight.current = true;
    dirty.current = false;
    setStatus('saving');
    try {
      const result = await saveRef.current(latest.current, revision.current);
      revision.current = result.revision;
      inFlight.current = false;
      if (dirty.current) return run();
      setStatus('saved');
      setError(null);
    } catch (err) {
      inFlight.current = false;
      dirty.current = true;
      if (err instanceof ApiError && err.code === 'conflict') {
        conflicted.current = true;
        setStatus('conflict');
      } else {
        setStatus('error');
      }
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    latest.current = value;
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delayMs);
  }, [value, delayMs, flush]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Leaving the screen: save any pending change immediately instead of dropping it.
      clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  const retry = useCallback(() => {
    clearTimeout(timer.current);
    void flush();
  }, [flush]);

  return { status, error, retry };
}
