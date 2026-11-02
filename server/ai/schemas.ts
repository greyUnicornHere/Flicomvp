// Versioned structured-output contracts. The JSON Schemas are sent to the model; the Zod schemas
// re-check everything that comes back (model output is untrusted, even with structured output).
// Optional values are empty strings so every field is always present (simplest, widely supported schema form).
import { z } from 'zod';
import { AUTOMATION_CLASSES, EVIDENCE_SOURCES } from '../../shared/assessment.js';
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

/** One edit operation, referring to steps and connections by their refs (s1, c1) and new steps as n1, n2… */
const operationJsonSchema = object({
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
});

export const chatJsonSchema = object({
  reply: str('Your answer to the person. Concise plain text, no Markdown headings.'),
  change_summary: str('If you propose changes: one short sentence describing them. Otherwise "".'),
  operations: {
    type: 'array',
    description: 'Proposed edits to the workflow, or an empty array when you are only answering. The person previews and approves them.',
    items: operationJsonSchema,
  },
});

const operationOutput = z.object({
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
});

export const chatOutput = z.object({
  reply: shortText(6000),
  change_summary: shortText(400),
  operations: z.array(operationOutput).max(60),
});
export type ChatOutput = z.infer<typeof chatOutput>;

// ---------- analysis ----------

const MAX_RECOMMENDATIONS = 8;
const levels = ['low', 'medium', 'high'] as const;
export const CATEGORIES = ['quick_win', 'strategic', 'complex'] as const;
export const EVIDENCE = ['supported', 'assumption', 'verify'] as const;

/** One automation assessment of a work step (Milestone 4.1). */
export const assessmentJsonSchema = object({
  step: str('The step ref (e.g. "s3"). Only work steps: never Start, Finish or waits.'),
  classification: { type: 'string', enum: [...AUTOMATION_CLASSES], description: 'full = full automation candidate; assisted = human-assisted automation; human = keep human-led; unknown = more information needed.' },
  provisional: { type: 'boolean', description: 'True when the evidence supports a tentative class but prerequisites are still unverified.' },
  reasoning: str('ONE sentence (max 25 words): the deciding reason for the classification.'),
  inputs: str('Inputs (max 15 words): digital, complete, usable? Upstream dependencies.'),
  rules: str('Rules and judgment (max 15 words): governing rules; judgment that remains.'),
  access: str('System access (max 15 words). A tool name alone is not proof of access.'),
  exceptions: str('Exceptions (max 15 words): what can fail or vary; can it be handled?'),
  verification: str('Verification (max 15 words): how results could be checked.'),
  risk: str('Risk and accountability (max 15 words).'),
  automatable: str('What could be automated, one short phrase (max 20 words), or "" if nothing is supportable.'),
  human: str('What remains human, one short phrase (max 20 words), or "".'),
  evidence: {
    type: 'array',
    items: object({ source: { type: 'string', enum: [...EVIDENCE_SOURCES] }, text: str('One short piece of evidence.') }),
    description: 'At most 2 items that decide the class. user = the person said it (step details or answers); workflow = visible in the diagram; assumption = your assumption.',
  },
  prerequisites: { type: 'array', items: { type: 'string' }, description: 'What must be verified before relying on this, as a short action. Questions and prerequisites together: at most 2.' },
  questions: { type: 'array', items: { type: 'string' }, description: 'Decision-critical unknowns, as short questions, most important first.' },
  value: str('Business value in one sentence, only from supplied frequency/time/error data; otherwise "". Never savings, money or ROI.'),
});

export const analysisJsonSchema = object({
  headline: str('One short sentence naming the main opportunity, e.g. "A clearer way to process orders." No numbers.'),
  summary: str('Executive summary in 2–4 plain sentences: what works, the main issues, what you propose. No numeric savings.'),
  outcome: { type: 'string', enum: ['improvements', 'no_improvements'] },
  assumptions: { type: 'array', items: { type: 'string' }, description: 'Overall assumptions you made (at most 5, short).' },
  recommendations: {
    type: 'array',
    description: `At most ${MAX_RECOMMENDATIONS}. Empty when outcome is no_improvements.`,
    items: object({
      key: str('Unique key, e.g. "r1".'),
      title: str('Short imperative title, e.g. "Automate the stock check".'),
      problem: str('The problem, one sentence.'),
      proposal: str('The proposed change, one sentence.'),
      reason: str('Why it helps, one sentence.'),
      category: { type: 'string', enum: [...CATEGORIES], description: 'quick_win = low effort, clear benefit; strategic = meaningful change needing some planning; complex = significant effort or risk.' },
      impact: { type: 'string', enum: [...levels] },
      effort: { type: 'string', enum: [...levels] },
      evidence: { type: 'string', enum: [...EVIDENCE], description: 'supported = clearly visible in the workflow; assumption = based on your assumptions; verify = needs checking (e.g. technical feasibility).' },
      benefits: str('Qualitative benefits. No percentages, money or time-saving figures.'),
      risks: str('Risks or downsides.'),
      assumptions: str('Assumptions behind this recommendation.'),
      verification: str('How the person can verify it before relying on it.'),
      depends_on: { type: 'array', items: { type: 'string' }, description: 'Keys of other recommendations this one needs, or [].' },
      operations: { type: 'array', items: operationJsonSchema, description: 'The diagram changes that implement it, against the ORIGINAL workflow.' },
    }),
  },
  automation: { type: 'array', description: 'One automation assessment per meaningful work step.', items: assessmentJsonSchema },
});

export const assessmentOutput = z.object({
  step: shortText(40),
  classification: z.enum(AUTOMATION_CLASSES),
  provisional: z.boolean(),
  reasoning: shortText(1200),
  inputs: shortText(600),
  rules: shortText(600),
  access: shortText(600),
  exceptions: shortText(600),
  verification: shortText(600),
  risk: shortText(600),
  automatable: shortText(800),
  human: shortText(800),
  evidence: z.array(z.object({ source: z.enum(EVIDENCE_SOURCES), text: shortText(400) })).max(12),
  prerequisites: z.array(shortText(300)).max(8),
  questions: z.array(shortText(300)).max(6),
  value: shortText(600),
});

export const analysisOutput = z.object({
  headline: shortText(200),
  summary: shortText(2000),
  outcome: z.enum(['improvements', 'no_improvements']),
  assumptions: z.array(shortText(400)).max(10),
  recommendations: z
    .array(
      z.object({
        key: shortText(40),
        title: shortText(160),
        problem: shortText(600),
        proposal: shortText(600),
        reason: shortText(600),
        category: z.enum(CATEGORIES),
        impact: z.enum(levels),
        effort: z.enum(levels),
        evidence: z.enum(EVIDENCE),
        benefits: shortText(800),
        risks: shortText(800),
        assumptions: shortText(800),
        verification: shortText(800),
        depends_on: z.array(shortText(40)).max(MAX_RECOMMENDATIONS),
        operations: z.array(operationOutput).max(40),
      }),
    )
    .max(MAX_RECOMMENDATIONS * 2),
  automation: z.array(assessmentOutput).max(80).default([]),
});
export type AnalysisOutput = z.infer<typeof analysisOutput>;
export type AssessmentOutput = z.infer<typeof assessmentOutput>;

export const questionsJsonSchema = object({
  questions: {
    type: 'array',
    description: 'At most 3 short, optional questions whose answers would most improve the analysis.',
    items: object({ question: str('The question, under 20 words.'), hint: str('A short example answer or what to mention, under 15 words.') }),
  },
});
export const questionsOutput = z.object({ questions: z.array(z.object({ question: shortText(300), hint: shortText(200) })).max(6) });

// ---------- interviews about one step (Clarify, briefs) ----------

export const assistQuestionJsonSchema = object({
  done: { type: 'boolean', description: 'True when nothing that changes the outcome is left to ask.' },
  question: str('ONE short question (max 25 words, one question mark), or "" when done.'),
});
export const assistQuestionOutput = z.object({ done: z.boolean(), question: shortText(400) });

export const clarifyUpdateJsonSchema = object({
  reply: str('One or two short sentences: what the answer changed (or did not) and why.'),
  assessment: assessmentJsonSchema,
  next_question: str('The next single question if a decision-critical unknown remains, otherwise "".'),
});
export const clarifyUpdateOutput = z.object({ reply: shortText(800), assessment: assessmentOutput, next_question: shortText(400) });

export const briefJsonSchema = object({
  summary: str('One sentence summing up the brief.'),
  sections: {
    type: 'array',
    description: 'Exactly the headings you were given, in that order.',
    items: object({ heading: str('The section heading, exactly as given.'), items: { type: 'array', items: { type: 'string' }, description: '1 to 4 short phrases (max 20 words each).' } }),
  },
});
export const briefOutput = z.object({ summary: shortText(600), sections: z.array(z.object({ heading: shortText(120), items: z.array(shortText(600)).max(10) })).max(16) });

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

export const LIMITS = { MAX_DRAFT_STEPS, MAX_ASSUMPTIONS, MAX_RECOMMENDATIONS };
