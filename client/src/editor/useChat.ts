import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatMode } from '../../../shared/api';
import { clearChat, fetchChat, sendChatMessage } from '../lib/ai';

export type ChatRequest = { content: string; mode: ChatMode; stepId?: string };

/** The workflow's persistent Ask Flico conversation (loaded when the chat is first opened). */
export function useChat(workflowId: string, enabled: boolean) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ChatRequest | null>(null);
  const [failed, setFailed] = useState<{ request: ChatRequest; message: string } | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setMessages(await fetchChat(workflowId));
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, [workflowId]);

  useEffect(() => {
    if (!enabled || messages !== null) return;
    let active = true;
    fetchChat(workflowId).then(
      (list) => active && setMessages(list),
      (error: Error) => active && setLoadError(error.message),
    );
    return () => {
      active = false;
    };
  }, [enabled, messages, workflowId]);

  /** Send a message; `prepare` saves pending edits first and returns the revision the answer is based on. */
  const send = useCallback(
    async (request: ChatRequest, prepare: () => Promise<number>): Promise<ChatMessage[] | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(request);
      setFailed(null);
      try {
        const baseRevision = await prepare();
        const added = await sendChatMessage(workflowId, { ...request, baseRevision });
        setMessages((list) => [...(list ?? []), ...added]);
        return added;
      } catch (error) {
        setFailed({ request, message: (error as Error).message });
        return null;
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [workflowId],
  );

  const clear = useCallback(async () => {
    await clearChat(workflowId);
    setMessages([]);
    setFailed(null);
  }, [workflowId]);

  const replace = useCallback((message: ChatMessage) => {
    setMessages((list) => list?.map((m) => (m.id === message.id ? message : m)) ?? list);
  }, []);

  return { messages, loadError, pending, failed, send, clear, replace, reload: load, dismissError: () => setFailed(null) };
}
