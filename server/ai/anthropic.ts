// Live provider: Anthropic Claude via the official SDK, with structured JSON output.
import Anthropic from '@anthropic-ai/sdk';
import { AI_ERROR_MESSAGES, AiError, type AiProvider, type AiRequest, type AiResponse } from './provider.js';

/** Models that accept the server-side refusal fallback in its "default" form. */
const supportsDefaultFallback = (model: string) => /^claude-(opus-5|fable-5)/.test(model);

export class AnthropicProvider implements AiProvider {
  readonly source = 'live' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    /** Tests only: e.g. a stub `fetch`. */
    clientOptions: Omit<NonNullable<ConstructorParameters<typeof Anthropic>[0]>, 'apiKey'> = {},
    baseURL = 'https://api.anthropic.com',
  ) {
    // The address is always explicit so the key is never sent to an ANTHROPIC_BASE_URL inherited from the environment.
    // One SDK retry for transient failures (429/5xx/connection); Flico's own retry is only for invalid output.
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 1, ...clientOptions });
  }

  private send(request: AiRequest, fallback: boolean) {
    return this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        output_config: { effort: request.effort, format: { type: 'json_schema', schema: request.schema } },
        // A declined request is re-run on Anthropic's recommended fallback model instead of failing.
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { timeout: request.timeoutMs, ...(request.signal ? { signal: request.signal } : {}) },
    );
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.send(request, supportsDefaultFallback(this.model));
    } catch (error) {
      // If this account or model doesn't accept the refusal fallback, ask once more without it.
      if (!(error instanceof Anthropic.BadRequestError) || !supportsDefaultFallback(this.model)) throw toAiError(error);
      try {
        response = await this.send(request, false);
      } catch (retryError) {
        throw toAiError(retryError);
      }
    }

    if (response.stop_reason === 'refusal') throw new AiError('refused', AI_ERROR_MESSAGES.refused);
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    // A truncated (max_tokens) response is returned as-is: it fails validation and gets the one correction attempt.
    return { text, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
  }
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', AI_ERROR_MESSAGES.cancelled);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout', AI_ERROR_MESSAGES.timeout);
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('misconfigured', AI_ERROR_MESSAGES.misconfigured);
  }
  if (error instanceof Anthropic.RateLimitError) return new AiError('rate_limited', AI_ERROR_MESSAGES.rate_limited);
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    // Usually a configuration problem (model name, request shape), not something the person can fix.
    return new AiError('misconfigured', AI_ERROR_MESSAGES.misconfigured);
  }
  return new AiError('unavailable', AI_ERROR_MESSAGES.unavailable);
}
