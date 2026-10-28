import type { AiProvider, AiRequest } from '../ai/provider.js';

/** A provider that returns scripted outputs and records every request it receives. */
export class Scripted implements AiProvider {
  readonly source = 'live' as const;
  readonly calls: AiRequest[] = [];
  constructor(private readonly outputs: (string | Error | ((request: AiRequest) => Promise<string>))[] = []) {}
  async generate(request: AiRequest) {
    this.calls.push(request);
    const next = this.outputs.shift();
    if (next === undefined) throw new Error('No scripted output left');
    if (next instanceof Error) throw next;
    const text = typeof next === 'function' ? await next(request) : next;
    return { text, usage: { inputTokens: 10, outputTokens: 5 } };
  }
  push(...outputs: (string | Error | ((request: AiRequest) => Promise<string>))[]) {
    this.outputs.push(...outputs);
  }
}

/** One flat edit operation as the model writes it (unused fields are empty strings). */
export const op = (fields: Record<string, string>) => ({
  op: '',
  step: '',
  new_ref: '',
  type: '',
  label: '',
  notes: '',
  from: '',
  to: '',
  connection: '',
  connection_type: '',
  ...fields,
});
