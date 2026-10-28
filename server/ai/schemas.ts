// Versioned structured-output contracts. The JSON Schemas are sent to the model; the Zod schemas
// re-check everything that comes back (model output is untrusted, even with structured output).
// Optional values are empty strings so every field is always present (simplest, widely supported schema form).
import { z } from 'zod';
import { EDGE_TYPES, GRAPH_LIMITS, STEP_TYPES } from '../../shared/graph.js';

export const SCHEMA_VERSION = 'v1';

const MAX_DRAFT_STEPS = 60;
const MAX_ASSUMPTIONS = 10;
const QUICK_ADD_TYPES = ['action', 'decision', 'approval', 'wait', 'finish'] as const;
export const OPERATION_KINDS = ['add_step', 'update_step', 'remove_step', 'add_connection', 'remove_connection', 'update_connection'] as const;

const str = (description: string) => ({ type: 'string', description });
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// ---------- workflow draft ----------

export const draftJsonSchema = object({
  name: str('Short name for the workflow (max 80 characters).'),
  steps: {
    type: 'array',
    description: 'Every step. Exactly one has type "start".',
    items: object({
      key: str('Unique short key for this step, e.g. "s1".'),
      type: { type: 'string', enum: [...STEP_TYPES] },
      label: str('Concise step name, ideally under 6 words.'),
      inferred: { type: 'boolean', description: 'True if the description did not mention this step and you added it.' },
      notes: str('Optional short detail, or "".'),
    }),
  },
  connections: {
    type: 'array',
    items: object({
      from: str('Key of the step the connection leaves.'),
      to: str('Key of the step it leads to.'),
      type: { type: 'string', enum: [...EDGE_TYPES] },
      label: str('Required for yes/no ("Yes"/"No" or the outcome) and loop (the repeat condition); otherwise "".'),
    }),
  },
  assumptions: {
    type: 'array',
    description: 'Things you assumed that the description did not state. Keep each under 25 words.',
    items: object({
      text: str('The assumption, in plain language.'),
      steps: { type: 'array', items: { type: 'string' }, description: 'Keys of the steps this assumption concerns.' },
    }),
  },
});

const shortText = (max: number) => z.string().max(max);

export const draftOutput = z.object({
  name: shortText(200),
  steps: z
    .array(
      z.object({
        key: shortText(40),
        type: z.enum(STEP_TYPES),
        label: shortText(GRAPH_LIMITS.maxLabel),
        inferred: z.boolean(),
        notes: shortText(GRAPH_LIMITS.maxText),
      }),
    )
    .max(MAX_DRAFT_STEPS),
  connections: z
    .array(z.object({ from: shortText(40), to: shortText(40), type: z.enum(EDGE_TYPES), label: shortText(GRAPH_LIMITS.maxLabel) }))
    .max(MAX_DRAFT_STEPS * 3),
  assumptions: z.array(z.object({ text: shortText(400), steps: z.array(shortText(40)).max(MAX_DRAFT_STEPS) })).max(MAX_ASSUMPTIONS * 2),
});
export type DraftOutput = z.infer<typeof draftOutput>;

// ---------- Quick Add ----------

export const quickAddJsonSchema = object({
  type: { type: 'string', enum: [...QUICK_ADD_TYPES] },
  label: str('Concise step name, ideally under 6 words.'),
});

export const quickAddOutput = z.object({ type: z.enum(QUICK_ADD_TYPES), label: shortText(GRAPH_LIMITS.maxLabel) });

// ---------- Ask Flico ----------

export const chatJsonSchema = object({
  reply: str('Your answer to the person. Concise plain text, no Markdown headings.'),
  change_summary: str('If you propose changes: one short sentence describing them. Otherwise "".'),
  operations: {
    type: 'array',
    description: 'Proposed edits to the workflow, or an empty array when you are only answering. The person previews and approves them.',
    items: object({
      op: { type: 'string', enum: [...OPERATION_KINDS] },
      step: str('update_step/remove_step: the step ref (e.g. "s3"). Otherwise "".'),
      new_ref: str('add_step: a new unique ref for the step, e.g. "n1". Otherwise "".'),
      type: { type: 'string', enum: [...STEP_TYPES, ''], description: 'add_step: the step type. update_step: new type or "".' },
      label: str('add_step: step name. update_step/add_connection/update_connection: new name/label or "".'),
      notes: str('add_step/update_step: notes or "".'),
      from: str('add_connection: ref of the source step (existing "s…" or new "n…"). Otherwise "".'),
      to: str('add_connection: ref of the target step. Otherwise "".'),
      connection: str('remove_connection/update_connection: the connection ref (e.g. "c2"). Otherwise "".'),
      connection_type: { type: 'string', enum: [...EDGE_TYPES, ''], description: 'add_connection: required. update_connection: new type or "".' },
    }),
  },
});

export const chatOutput = z.object({
  reply: shortText(6000),
  change_summary: shortText(400),
  operations: z
    .array(
      z.object({
        op: z.enum(OPERATION_KINDS),
        step: shortText(40),
        new_ref: shortText(40),
        type: z.enum([...STEP_TYPES, '']),
        label: shortText(GRAPH_LIMITS.maxLabel),
        notes: shortText(GRAPH_LIMITS.maxText),
        from: shortText(40),
        to: shortText(40),
        connection: shortText(40),
        connection_type: z.enum([...EDGE_TYPES, '']),
      }),
    )
    .max(60),
});
export type ChatOutput = z.infer<typeof chatOutput>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** Parse model text as JSON and check it against a schema. Problems are phrased for the correction retry. */
export function parseOutput<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problems: ['The response was not valid JSON.'] };
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'response'}: ${i.message}`) };
  }
  return { ok: true, value: parsed.data };
}

export const LIMITS = { MAX_DRAFT_STEPS, MAX_ASSUMPTIONS };
