// Provider-agnostic AI adapter. A provider turns one request into raw text; it never touches the
// database. Everything it returns is untrusted and is parsed and validated by the caller.
import type { AiSource } from '../../shared/api.js';

export type AiTask = 'draft' | 'quick_add' | 'chat' | 'analysis' | 'questions';

export type AiMessage = { role: 'user' | 'assistant'; content: string };

export type AiRequest = {
  task: AiTask;
  system: string;
  /** Alternating user/assistant turns, ending with a user turn. */
  messages: AiMessage[];
  /** JSON Schema the response must follow (structured output). */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: 'low' | 'medium' | 'high';
  timeoutMs: number;
  /** Aborts the request (analysis cancellation). */
  signal?: AbortSignal;
};

export type AiResponse = { text: string; usage: { inputTokens: number; outputTokens: number } };

export interface AiProvider {
  readonly source: AiSource;
  generate(request: AiRequest): Promise<AiResponse>;
}

export type AiErrorKind = 'timeout' | 'unavailable' | 'rate_limited' | 'refused' | 'misconfigured' | 'cancelled';

/** Provider failure with a safe, user-readable message. Never carries prompt or response content. */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export const AI_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  timeout: 'Flico took too long to respond. Please try again.',
  unavailable: "Flico's AI service isn't responding right now. Please try again in a moment.",
  rate_limited: "Flico's AI service is busy right now. Please wait a moment and try again.",
  refused: "Flico couldn't help with that request. Try rephrasing it.",
  misconfigured: "AI isn't set up correctly on this server. Ask your Flico administrator to check the AI settings.",
  cancelled: 'Cancelled.',
};
