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
  /** The value currently known to be saved or scheduled; equal values never trigger a save. */
  const known = useRef(value);
  const saveRef = useRef(save);
  const running = useRef<Promise<void> | null>(null);
  const lastError = useRef<string | null>(null);

  useEffect(() => {
    saveRef.current = save;
  });

  const runSave = useCallback(async function run(): Promise<void> {
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
      lastError.current = null;
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
      lastError.current = (err as Error).message;
    }
  }, []);

  /** Start a save, or join the one in flight (which also saves anything edited meanwhile). */
  const flush = useCallback((): Promise<void> => {
    if (inFlight.current && running.current) return running.current;
    const run = runSave();
    if (inFlight.current) running.current = run;
    return run;
  }, [runSave]);

  useEffect(() => {
    // Compare instead of "skip the first run": React may run effects twice in development.
    if (value === known.current) return;
    known.current = value;
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

  /**
   * Save now and resolve with the saved revision, for actions that need the server to have the
   * latest graph (AI requests). Rejects if saving fails or the workflow changed elsewhere.
   */
  const flushNow = useCallback(async (): Promise<number> => {
    clearTimeout(timer.current);
    await flush();
    if (conflicted.current) throw new ApiError(409, 'conflict', 'This workflow was changed elsewhere. Reload to get the latest version.');
    if (dirty.current) throw new Error(lastError.current ?? "Your latest changes couldn't be saved yet.");
    return revision.current;
  }, [flush]);

  /** The server already saved `value` as `newRevision` (e.g. an applied AI change): adopt it without saving again. */
  const rebase = useCallback((value: T, newRevision: number) => {
    clearTimeout(timer.current);
    known.current = value;
    latest.current = value;
    revision.current = newRevision;
    dirty.current = false;
    setStatus('saved');
    setError(null);
  }, []);

  return { status, error, retry, flushNow, rebase };
}
