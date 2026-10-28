import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { AiError, type AiRequest } from './provider.js';

const request: AiRequest = {
  task: 'quick_add',
  system: 'System prompt',
  messages: [{ role: 'user', content: 'Describe' }],
  schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false },
  maxTokens: 2000,
  effort: 'low',
  timeoutMs: 5000,
};

type Sent = { url: string; headers: Headers; body: Record<string, unknown> };

/** A stub HTTP layer: records each request and answers with the next scripted response. */
function stub(responses: { status: number; body: unknown }[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  };
  return { sent, fetch: fetch as typeof globalThis.fetch };
}

const message = (text: string, stopReason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
  usage: { input_tokens: 12, output_tokens: 7 },
});
const apiError = (type: string, msg = 'nope') => ({ type: 'error', error: { type, message: msg } });

describe('AnthropicProvider', () => {
  it('sends a structured-output request with effort and the refusal fallback', async () => {
    const { sent, fetch } = stub([{ status: 200, body: message('{"label":"Approve"}') }]);
    const provider = new AnthropicProvider('sk-test', 'claude-opus-5-5', { fetch, maxRetries: 0 });
    const result = await provider.generate(request);
    expect(result).toEqual({ text: '{"label":"Approve"}', usage: { inputTokens: 12, outputTokens: 7 } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toContain('/v1/messages');
    expect(sent[0]!.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]!.headers.get('authorization') ?? sent[0]!.headers.get('x-api-key')).toContain('sk-test');
    expect(sent[0]!.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      system: 'System prompt',
      messages: request.messages,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
      fallbacks: 'default',
    });
    expect(sent[0]!.body).not.toHaveProperty('thinking');
  });

  it('never picks up an API address from the environment', async () => {
    const previous = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://elsewhere.example';
    try {
      const { sent, fetch } = stub([{ status: 200, body: message('{}') }]);
      await new AnthropicProvider('sk-test', 'claude-opus-5-5', { fetch, maxRetries: 0 }).generate(request);
      expect(sent[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previous;
    }
  });

  it('uses the default model Haiku 5.5 without a fallback (it has none) or a thinking budget', async () => {
    const { sent, fetch } = stub([{ status: 200, body: message('{}') }]);
    await new AnthropicProvider('sk-test', loadConfig({ NODE_ENV: 'test' }).AI_MODEL, { fetch, maxRetries: 0 }).generate(request);
    expect(sent[0]!.body).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low', format: { type: 'json_schema' } } });
    expect(sent[0]!.body).not.toHaveProperty('fallbacks');
    expect(sent[0]!.body).not.toHaveProperty('thinking');
    expect(sent[0]!.body).not.toHaveProperty('temperature');
    expect(sent[0]!.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
  });

  it('reads the answer by block type when thinking blocks come first', async () => {
    const withThinking = { ...message('{"label":"x"}'), content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '{"label":"x"}' }] };
    const { fetch } = stub([{ status: 200, body: withThinking }]);
    const result = await new AnthropicProvider('sk-test', 'claude-haiku-5-5', { fetch, maxRetries: 0 }).generate(request);
    expect(result.text).toBe('{"label":"x"}');
  });

  it('asks once more without the fallback if the API rejects it', async () => {
    const { sent, fetch } = stub([
      { status: 400, body: apiError('invalid_request_error') },
      { status: 200, body: message('{"label":"x"}') },
    ]);
    const result = await new AnthropicProvider('sk-test', 'claude-opus-5-5', { fetch, maxRetries: 0 }).generate(request);
    expect(result.text).toBe('{"label":"x"}');
    expect(sent[1]!.body).not.toHaveProperty('fallbacks');
  });

  it('maps refusals and API errors to safe messages', async () => {
    const cases: [{ status: number; body: unknown }[], string][] = [
      [[{ status: 200, body: message('', 'refusal') }], 'refused'],
      [[{ status: 401, body: apiError('authentication_error') }], 'misconfigured'],
      [[{ status: 429, body: apiError('rate_limit_error') }], 'rate_limited'],
      [[{ status: 529, body: apiError('overloaded_error') }], 'unavailable'],
      [[{ status: 400, body: apiError('invalid_request_error') }, { status: 400, body: apiError('invalid_request_error') }], 'misconfigured'],
    ];
    for (const [responses, kind] of cases) {
      const { fetch } = stub(responses);
      const error = await new AnthropicProvider('sk-test', 'claude-opus-5-5', { fetch, maxRetries: 0 }).generate(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).kind).toBe(kind);
      expect((error as AiError).message).not.toMatch(/nope|sk-test/);
    }
  });
});
