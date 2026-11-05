// AI use cases: generateWorkflow (draft), quickAdd and answerAssistant (chat, edit proposals, fixes).
// Each validates the model's output before anything is returned; invalid output gets exactly one
// correction attempt. Nothing here writes to the database.
import { ASSUMPTION_TEXT_MAX, WORKFLOW_NAME_MAX, type Assumption, type DescribedFields, type DescribeStepResponse, type QuickAddType, type Recommendation } from '../../shared/api.js';
import { unsupportedFigures } from '../../shared/analysis.js';
import { BRIEF_SECTIONS, isAssessable, type AutomationBrief, type BriefKind, type StepAssessment } from '../../shared/assessment.js';
import { applyOperations, structuralProblems, type ProposalOperation } from '../../shared/aiOps.js';
import { GRAPH_LIMITS, type EdgeType, type StepType, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from '../../shared/graph.js';
import { autoLayout } from '../../shared/layout.js';
import { validateWorkflow } from '../../shared/validation.js';
import { newId } from '../auth/tokens.js';
import type { AiMessage, AiProvider, AiRequest } from './provider.js';
import {
  ANALYSIS_SYSTEM,
  CHAT_SYSTEM,
  CLARIFY_QUESTION_SYSTEM,
  CLARIFY_UPDATE_SYSTEM,
  assistPrompt,
  briefQuestionSystem,
  briefWriteSystem,
  DRAFT_SYSTEM,
  QUESTIONS_SYSTEM,
  QUICK_ADD_SYSTEM,
  DESCRIBE_SYSTEM,
  describePrompt,
  REASSESS_SYSTEM,
  analysisPrompt,
  chatPrompt,
  questionsPrompt,
  type AnalysisContext,
  correctionPrompt,
  draftPrompt,
  quickAddPrompt,
  workflowView,
  type RefMap,
} from './prompts.js';
import {
  LIMITS,
  assessmentJsonSchema,
  describeJsonSchema,
  describeOutput,
  assessmentOutput,
  assistQuestionJsonSchema,
  assistQuestionOutput,
  briefJsonSchema,
  briefOutput,
  clarifyUpdateJsonSchema,
  clarifyUpdateOutput,
  analysisJsonSchema,
  analysisOutput,
  type AssessmentOutput,
  questionsJsonSchema,
  questionsOutput,
  type AnalysisOutput,
  chatJsonSchema,
  chatOutput,
  draftJsonSchema,
  draftOutput,
  parseOutput,
  quickAddJsonSchema,
  quickAddOutput,
  type ChatOutput,
  type DraftOutput,
} from './schemas.js';

export type Usage = { inputTokens: number; outputTokens: number };

/** Thrown when output stayed unusable after the correction attempt. The message is safe to show. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiOutputError';
  }
}

type Checked<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/**
 * Ask once; if the output fails validation, ask once more with the problems listed (the one safe
 * correction retry). Returns the last attempt's outcome and the combined token usage.
 */
async function generateChecked<T>(provider: AiProvider, request: AiRequest, check: (text: string) => Checked<T>) {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const first = await provider.generate(request);
  usage.inputTokens += first.usage.inputTokens;
  usage.outputTokens += first.usage.outputTokens;
  const firstCheck = check(first.text);
  if (firstCheck.ok) return { result: firstCheck, usage, retried: false, text: first.text };

  const messages: AiMessage[] = [
    ...request.messages,
    { role: 'assistant', content: first.text.trim() || '(empty response)' },
    { role: 'user', content: correctionPrompt(firstCheck.problems) },
  ];
  const second = await provider.generate({ ...request, messages });
  usage.inputTokens += second.usage.inputTokens;
  usage.outputTokens += second.usage.outputTokens;
  return { result: check(second.text), usage, retried: true, text: second.text };
}

// ---------- generateWorkflow ----------

export type Draft = { name: string; graph: WorkflowGraph; assumptions: Assumption[]; partial: boolean; usage: Usage };

type Built = { name: string; graph: WorkflowGraph; assumptions: Assumption[] };

/** Strict conversion: any problem makes the draft invalid. */
function buildDraft(out: DraftOutput, ids: () => string = newId): Checked<Built> {
  const problems: string[] = [];
  const keys = new Map<string, string>();
  for (const step of out.steps) {
    if (keys.has(step.key)) problems.push(`Duplicate step key "${step.key}".`);
    if (!step.label.trim()) problems.push(`Step "${step.key}" has no label.`);
    keys.set(step.key, ids());
  }
  if (out.steps.filter((s) => s.type !== 'start').length === 0) problems.push('The draft has no steps after Start.');
  for (const c of out.connections) {
    if (!keys.has(c.from) || !keys.has(c.to)) problems.push(`Connection ${c.from} → ${c.to} uses a step key that doesn't exist.`);
  }
  if (problems.length) return { ok: false, problems };
  const built = assemble(out, out.steps, out.connections, keys);
  const structural = structuralProblems(built.graph);
  return structural.length ? { ok: false, problems: structural } : { ok: true, value: built };
}

/** Keep the valid part of an invalid draft: drop broken steps/connections and make sure there is one Start. */
function salvageDraft(out: DraftOutput, ids: () => string = newId): Built | null {
  const keys = new Map<string, string>();
  let steps = out.steps.filter((s) => s.label.trim() && !keys.has(s.key) && keys.set(s.key, ids()));
  if (steps.filter((s) => s.type !== 'start').length === 0) return null;
  let startSeen = false;
  steps = steps.map((s) => {
    if (s.type !== 'start') return s;
    if (startSeen) return { ...s, type: 'action' as const };
    startSeen = true;
    return s;
  });
  const types = new Map(steps.map((s) => [s.key, s.type]));
  const seen = new Set<string>();
  let connections = out.connections.filter((c) => {
    if (!types.has(c.from) || !types.has(c.to) || c.from === c.to) return false;
    if ((c.type === 'yes' || c.type === 'no') && types.get(c.from) !== 'decision') return false;
    const branch = c.type === 'yes' || c.type === 'no' ? `${c.from}:${c.type}` : `${c.from}>${c.to}:${c.type}`;
    if (seen.has(branch)) return false;
    seen.add(branch);
    return true;
  });
  if (!startSeen) {
    const startKey = '__start';
    keys.set(startKey, ids());
    const first = steps.find((s) => !connections.some((c) => c.to === s.key)) ?? steps[0]!;
    steps = [{ key: startKey, type: 'start', label: 'Start', inferred: true, notes: '' }, ...steps];
    connections = [{ from: startKey, to: first.key, type: 'normal', label: '' }, ...connections];
  }
  return assemble(out, steps, connections, keys);
}

function assemble(out: DraftOutput, steps: DraftOutput['steps'], connections: DraftOutput['connections'], keys: Map<string, string>): Built {
  const nodes: WorkflowNode[] = steps.map((s) => {
    const node: WorkflowNode = { id: keys.get(s.key)!, type: s.type, label: s.label.trim(), position: { x: 0, y: 0 } };
    if (s.notes.trim()) node.notes = s.notes.trim();
    node.origin = s.inferred ? 'ai-inferred' : 'user';
    if (s.inferred) node.assumptionStatus = 'unconfirmed';
    return node;
  });
  const edges: WorkflowEdge[] = connections.map((c) => {
    const edge: WorkflowEdge = { id: newId(), sourceId: keys.get(c.from)!, targetId: keys.get(c.to)!, type: c.type };
    const label = c.label.trim() || (c.type === 'yes' ? 'Yes' : c.type === 'no' ? 'No' : '');
    if (label) edge.label = label;
    if (c.type === 'yes' || c.type === 'no' || c.type === 'parallel') edge.branchGroupId = edge.sourceId;
    return edge;
  });
  const assumptions: Assumption[] = out.assumptions
    .filter((a) => a.text.trim())
    .slice(0, LIMITS.MAX_ASSUMPTIONS)
    .map((a) => ({
      id: newId(),
      text: a.text.trim().slice(0, ASSUMPTION_TEXT_MAX),
      stepIds: a.steps.map((k) => keys.get(k)).filter((id): id is string => id !== undefined),
      status: 'open',
    }));
  const name = out.name.trim().slice(0, WORKFLOW_NAME_MAX) || 'AI draft workflow';
  return { name, graph: autoLayout({ nodes, edges }), assumptions };
}

export async function generateWorkflow(provider: AiProvider, description: string, timeoutMs: number): Promise<Draft> {
  const request: AiRequest = {
    task: 'draft',
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: draftPrompt(description) }],
    schema: draftJsonSchema,
    maxTokens: 16000,
    effort: 'medium',
    timeoutMs,
  };
  let lastParsed: DraftOutput | null = null;
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, draftOutput);
    if (!parsed.ok) return parsed;
    lastParsed = parsed.value;
    return buildDraft(parsed.value);
  });
  if (result.ok) return { ...result.value, partial: false, usage };
  // Still invalid after the correction: keep whatever part is valid rather than nothing.
  const salvaged = lastParsed ? salvageDraft(lastParsed) : null;
  if (!salvaged) throw new AiOutputError("Flico couldn't turn that description into a usable draft. Please try again, or add a little more detail.");
  return { ...salvaged, partial: true, usage };
}

// ---------- quickAdd ----------

export async function quickAdd(
  provider: AiProvider,
  input: { text: string; previousLabel?: string; nextLabel?: string; finishAllowed: boolean },
  timeoutMs: number,
): Promise<{ type: QuickAddType; label: string; usage: Usage }> {
  const request: AiRequest = {
    task: 'quick_add',
    system: QUICK_ADD_SYSTEM,
    messages: [{ role: 'user', content: quickAddPrompt(input) }],
    schema: quickAddJsonSchema,
    maxTokens: 2000,
    effort: 'low',
    timeoutMs,
  };
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, quickAddOutput);
    if (!parsed.ok) return parsed;
    if (!parsed.value.label.trim()) return { ok: false, problems: ['The step needs a name.'] };
    return parsed;
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't work out that step. Try describing it differently, or pick a step type above.");
  // Finish can't go between two steps; fall back to an action rather than failing.
  const type = result.value.type === 'finish' && !input.finishAllowed ? 'action' : result.value.type;
  return { type, label: result.value.label.trim(), usage };
}

// ---------- answerAssistant (chat, edit proposals, Suggest Fix) ----------

export type HistoryTurn = { role: 'user' | 'assistant'; content: string };

export type AssistantAnswer = {
  reply: string;
  proposal: { summary: string; operations: ProposalOperation[] } | null;
  /** The model proposed changes but they stayed invalid after the correction, so none are offered. */
  rejectedProposal: boolean;
  usage: Usage;
};

/** Translate the model's ref-based operations into ID-based ones. Unknown refs are reported, never guessed. */
export function translateOperations(ops: ChatOutput['operations'], refs: RefMap, ids: () => string = newId): Checked<ProposalOperation[]> {
  const problems: string[] = [];
  const newRefs = new Map<string, string>();
  for (const op of ops) {
    if (op.op !== 'add_step') continue;
    if (!op.new_ref || refs.stepIds.has(op.new_ref) || newRefs.has(op.new_ref)) problems.push(`add_step needs a new, unique new_ref (got "${op.new_ref}").`);
    else newRefs.set(op.new_ref, ids());
  }
  const step = (ref: string) => {
    const id = refs.stepIds.get(ref) ?? newRefs.get(ref);
    if (!id) problems.push(`Step "${ref}" doesn't exist.`);
    return id ?? '';
  };
  const connection = (ref: string) => {
    const id = refs.connectionIds.get(ref);
    if (!id) problems.push(`Connection "${ref}" doesn't exist.`);
    return id ?? '';
  };
  const out: ProposalOperation[] = [];
  for (const op of ops) {
    const type = op.type ? (op.type as StepType) : undefined;
    const connectionType = op.connection_type ? (op.connection_type as EdgeType) : undefined;
    switch (op.op) {
      case 'add_step':
        if (!type) problems.push('add_step needs a type.');
        out.push({ op: 'addStep', id: newRefs.get(op.new_ref) ?? '', type: type ?? 'action', label: op.label, ...(op.notes ? { notes: op.notes } : {}) });
        break;
      case 'update_step':
        out.push({
          op: 'updateStep',
          stepId: step(op.step),
          ...(op.label ? { label: op.label } : {}),
          ...(type ? { type } : {}),
          ...(op.notes ? { notes: op.notes } : {}),
        });
        break;
      case 'remove_step':
        out.push({ op: 'removeStep', stepId: step(op.step) });
        break;
      case 'add_connection':
        if (!connectionType) problems.push('add_connection needs a connection_type.');
        out.push({ op: 'addConnection', id: ids(), sourceId: step(op.from), targetId: step(op.to), type: connectionType ?? 'normal', ...(op.label ? { label: op.label } : {}) });
        break;
      case 'remove_connection':
        out.push({ op: 'removeConnection', connectionId: connection(op.connection) });
        break;
      case 'update_connection':
        out.push({ op: 'updateConnection', connectionId: connection(op.connection), ...(connectionType ? { type: connectionType } : {}), ...(op.label ? { label: op.label } : {}) });
        break;
    }
  }
  return problems.length ? { ok: false, problems: [...new Set(problems)] } : { ok: true, value: out };
}

export async function answerAssistant(
  provider: AiProvider,
  input: { graph: WorkflowGraph; history: HistoryTurn[]; content: string; fix: boolean; stepId?: string; analysis?: AnalysisContext | null },
  timeoutMs: number,
): Promise<AssistantAnswer> {
  const { view, refs } = workflowView(input.graph);
  const prompt = chatPrompt({
    view,
    issues: validateWorkflow(input.graph),
    content: input.content,
    stepRef: input.stepId ? refs.stepRefs.get(input.stepId) : undefined,
    fix: input.fix,
    analysis: input.analysis ?? null,
  });
  const request: AiRequest = {
    task: 'chat',
    system: CHAT_SYSTEM,
    messages: [...input.history, { role: 'user', content: prompt }],
    schema: chatJsonSchema,
    maxTokens: 8000,
    effort: 'medium',
    timeoutMs,
  };

  type Answer = Pick<AssistantAnswer, 'reply' | 'proposal'>;
  let lastReply: string | null = null;
  const { result, usage } = await generateChecked<Answer>(provider, request, (text) => {
    const parsed = parseOutput(text, chatOutput);
    if (!parsed.ok) return parsed;
    if (!parsed.value.reply.trim()) return { ok: false, problems: ['The reply was empty.'] };
    lastReply = parsed.value.reply.trim();
    if (parsed.value.operations.length === 0) return { ok: true, value: { reply: lastReply, proposal: null } };
    const translated = translateOperations(parsed.value.operations, refs);
    if (!translated.ok) return translated;
    const applied = applyOperations(input.graph, translated.value);
    if (!applied.ok) return { ok: false, problems: applied.problems };
    const summary = parsed.value.change_summary.trim() || 'Suggested changes to the workflow.';
    return { ok: true, value: { reply: lastReply, proposal: { summary, operations: translated.value } } };
  });

  if (result.ok) return { ...result.value, rejectedProposal: false, usage };
  const reply = lastReply as string | null;
  if (!reply) throw new AiOutputError("Flico's reply couldn't be read. Please try again.");
  // The answer was readable but its proposed changes weren't valid: show the answer, offer no changes.
  return {
    reply: `${reply}\n\nI couldn't turn this into a valid change to your workflow, so nothing is proposed. Try asking for a smaller, more specific change.`,
    proposal: null,
    rejectedProposal: true,
    usage,
  };
}

// ---------- Describe a step ----------

export type DescribedStep = Omit<DescribeStepResponse, 'source'>;

/**
 * Turn a person's description of one step into its details (owner, tools, duration, notes) and,
 * when the description changes what happens around the step, operations to preview. Nothing is
 * stored or changed here. Only what the person said is kept: a duration whose number isn't in the
 * description is dropped, and figures in the notes must come from the description or the workflow.
 */
export async function describeStep(provider: AiProvider, input: { graph: WorkflowGraph; stepId: string; text: string }, timeoutMs: number): Promise<{ described: DescribedStep; usage: Usage }> {
  const { view, refs } = workflowView(input.graph);
  const stepRef = refs.stepRefs.get(input.stepId)!;
  const request: AiRequest = {
    task: 'describe',
    system: DESCRIBE_SYSTEM,
    messages: [{ role: 'user', content: describePrompt({ view, stepRef, text: input.text }) }],
    schema: describeJsonSchema,
    maxTokens: 4000,
    effort: 'low',
    timeoutMs,
  };
  const source = `${input.text} ${JSON.stringify(view)}`;
  const { result, usage } = await generateChecked<DescribedStep>(provider, request, (text) => {
    const parsed = parseOutput(text, describeOutput);
    if (!parsed.ok) return parsed;
    const v = parsed.value;
    const problems: string[] = [];
    const figures = unsupportedFigures(v.notes, source);
    if (figures.length) problems.push(`The notes state figures the person didn't give (${figures.join(', ')}).`);
    let structure: DescribedStep['structure'] = null;
    if (v.operations.length) {
      const translated = translateOperations(v.operations, refs);
      if (!translated.ok) return translated;
      if (translated.value.some((o) => (o.op === 'updateStep' || o.op === 'removeStep') && o.stepId === input.stepId)) {
        problems.push(`Don't change or remove the selected step ${stepRef} with operations: put its details in the fields.`);
      } else {
        const applied = applyOperations(input.graph, translated.value);
        if (!applied.ok) problems.push(...applied.problems);
        else structure = { summary: brief(v.change_summary.trim() || 'Add the steps you described.', 25), operations: translated.value };
      }
    }
    if (problems.length) return { ok: false, problems };
    const seen = new Set<string>();
    const tools = v.tools
      .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
      .slice(0, 8);
    // A duration counts only when its number appears in what the person wrote.
    const durationSaid = v.duration_value > 0 && v.duration_unit !== '' && new RegExp(`\\b${String(v.duration_value).replace('.', '\\.')}\\b`).test(input.text);
    const fields: DescribedFields = {
      ...(v.owner.trim() ? { owner: v.owner.trim().slice(0, 120) } : {}),
      ...(tools.length ? { tools } : {}),
      ...(durationSaid ? { duration: { value: v.duration_value, unit: v.duration_unit as NonNullable<DescribedFields['duration']>['unit'] } } : {}),
      ...(v.notes.trim() ? { notes: v.notes.trim().slice(0, GRAPH_LIMITS.maxText) } : {}),
    };
    const missing = v.missing.map((q) => brief(q, 15, false)).filter(Boolean).slice(0, 2);
    return { ok: true, value: { fields, structure, missing } };
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't turn that description into step details. Nothing was changed; please try again or edit the fields yourself.");
  return { described: result.value, usage };
}

// ---------- suggestQuestions (Guided Analysis) ----------

export async function suggestQuestions(provider: AiProvider, graph: WorkflowGraph, timeoutMs: number): Promise<{ questions: { question: string; hint: string }[]; usage: Usage }> {
  const request: AiRequest = {
    task: 'questions',
    system: QUESTIONS_SYSTEM,
    messages: [{ role: 'user', content: questionsPrompt(workflowView(graph).view) }],
    schema: questionsJsonSchema,
    maxTokens: 4000,
    effort: 'low',
    timeoutMs,
  };
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, questionsOutput);
    if (!parsed.ok) return parsed;
    const questions = parsed.value.questions.filter((q) => q.question.trim()).slice(0, 3);
    return { ok: true, value: questions.map((q) => ({ question: q.question.trim(), hint: q.hint.trim() })) };
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't prepare questions for this workflow. You can analyze without them.");
  return { questions: result.value, usage };
}

// ---------- analyzeWorkflow ----------

export type AnalysisResult = {
  headline: string;
  summary: string;
  outcome: 'improvements' | 'no_improvements';
  assumptions: string[];
  recommendations: Omit<Recommendation, 'status'>[];
  /** Automation assessments; the caller binds them to the analysed revision. */
  assessments: AssessmentDraft[];
  /** Recommendations left out because they stayed invalid after the correction attempt. */
  dropped: number;
  usage: Usage;
};

type CheckedAnalysis = { value: Omit<AnalysisResult, 'usage' | 'dropped'>; problems: string[]; invalidKeys: Set<string> };

export type AssessmentDraft = Omit<StepAssessment, 'basis' | 'revision' | 'updatedAt'>;

const MAX_TO_VERIFY = 2;
const MAX_EVIDENCE = 3;

/**
 * Keep an assessment field short: its first sentence (unless `firstSentence` is false), at most
 * `maxWords` words, ending with "…" when cut.
 */
export function brief(text: string, maxWords: number, firstSentence = true): string {
  let out = text.trim().replace(/\s+/g, ' ');
  if (firstSentence) out = out.split(/(?<=[.!?])\s+(?=[A-Z“"(])/)[0] ?? out;
  const words = out.split(' ');
  if (words.length > maxWords) out = `${words.slice(0, maxWords).join(' ').replace(/[,;:.]+$/, '')}…`;
  return out;
}

/**
 * Check assessments against the workflow and the decision rules. Returns the valid ones and, for the
 * correction retry, what was wrong with the others. Never fills gaps with invented content.
 */
export function checkAssessments(items: AssessmentOutput[], graph: WorkflowGraph, refs: RefMap, source: string): { valid: AssessmentDraft[]; problems: string[] } {
  const problems: string[] = [];
  const valid: AssessmentDraft[] = [];
  const seen = new Set<string>();
  for (const a of items) {
    const own: string[] = [];
    const id = refs.stepIds.get(a.step);
    const node = id ? graph.nodes.find((n) => n.id === id) : undefined;
    if (!node) own.push(`Assessment for "${a.step}": that step doesn't exist.`);
    else if (!isAssessable(node)) own.push(`Assessment for ${a.step}: ${node.type} steps are not work to assess.`);
    if (id && seen.has(id)) own.push(`Step ${a.step} is assessed more than once.`);
    if (!a.reasoning.trim()) own.push(`Assessment for ${a.step} has no reasoning.`);
    if (a.evidence.length === 0) own.push(`Assessment for ${a.step} cites no evidence.`);
    if (a.classification === 'unknown' && a.questions.filter((q) => q.trim()).length === 0) own.push(`Assessment for ${a.step} needs more information but lists no question.`);
    if ((a.classification === 'full' || a.classification === 'assisted') && !a.automatable.trim()) own.push(`Assessment for ${a.step} doesn't say what could be automated.`);
    if ((a.classification === 'assisted' || a.classification === 'human') && !a.human.trim()) own.push(`Assessment for ${a.step} doesn't say what remains human and why.`);
    const found = unsupportedFigures([a.reasoning, a.automatable, a.human, a.value, ...a.evidence.map((e) => e.text)].join(' '), source);
    if (found.length) own.push(`Assessment for ${a.step} states figures that the workflow doesn't support (${found.join(', ')}).`);
    if (own.length || !id) {
      problems.push(...own);
      continue;
    }
    seen.add(id);
    // Concise by design: what the model writes beyond the limits is trimmed, never sent back for a retry.
    const questions = a.questions.map((q) => q.trim()).filter(Boolean).slice(0, MAX_TO_VERIFY).map((q) => brief(q, 25));
    valid.push({
      stepId: id,
      classification: a.classification,
      provisional: a.provisional,
      reasoning: brief(a.reasoning, 30),
      dimensions: {
        inputs: brief(a.inputs, 20),
        rules: brief(a.rules, 20),
        access: brief(a.access, 20),
        exceptions: brief(a.exceptions, 20),
        verification: brief(a.verification, 20),
        risk: brief(a.risk, 20),
      },
      automatable: brief(a.automatable, 25),
      human: brief(a.human, 25),
      evidence: a.evidence.filter((e) => e.text.trim()).slice(0, MAX_EVIDENCE).map((e) => ({ source: e.source, text: brief(e.text, 30, false) })),
      // Questions come first: the first item is shown as the step's next action.
      prerequisites: a.prerequisites.map((p) => p.trim()).filter(Boolean).slice(0, MAX_TO_VERIFY - questions.length).map((p) => brief(p, 25)),
      questions,
      value: brief(a.value, 30),
    });
  }
  return { valid, problems };
}

/** Validate the model's analysis: every recommendation must apply cleanly to the snapshot, and no invented figures. */
function checkAnalysis(out: AnalysisOutput, graph: WorkflowGraph, refs: RefMap, source: string): CheckedAnalysis {
  const problems: string[] = [];
  const invalidKeys = new Set<string>();
  const ids = new Map<string, string>();
  for (const r of out.recommendations) {
    if (ids.has(r.key) || !r.key) problems.push(`Recommendation key "${r.key}" is missing or repeated.`);
    ids.set(r.key, newId());
  }
  const figures = (where: string, ...texts: string[]) => {
    const found = unsupportedFigures(texts.join(' '), source);
    if (found.length) problems.push(`${where} states figures that the workflow doesn't support (${found.join(', ')}). Describe impact in words instead.`);
    return found.length > 0;
  };
  figures('The headline or summary', out.headline, out.summary, ...out.assumptions);

  const recommendations: Omit<Recommendation, 'status'>[] = [];
  for (const r of out.recommendations) {
    // Structural problems make a recommendation unusable; invented figures can be removed after the retry.
    const structural: string[] = [];
    if (!r.title.trim()) structural.push(`Recommendation ${r.key} has no title.`);
    if (r.operations.length === 0) structural.push(`Recommendation ${r.key} has no diagram changes; give each recommendation at least one operation.`);
    figures(`Recommendation ${r.key}`, r.title, r.problem, r.proposal, r.reason, r.benefits, r.risks, r.assumptions, r.verification);
    const unknownDeps = r.depends_on.filter((k) => !ids.has(k) || k === r.key);
    if (unknownDeps.length) structural.push(`Recommendation ${r.key} depends on unknown recommendations (${unknownDeps.join(', ')}).`);
    const translated = translateOperations(r.operations, refs);
    if (!translated.ok) structural.push(...translated.problems.map((p) => `Recommendation ${r.key}: ${p}`));
    else {
      const applied = applyOperations(graph, translated.value);
      if (!applied.ok && r.operations.length) structural.push(...applied.problems.map((p) => `Recommendation ${r.key}: ${p}`));
    }
    if (structural.length) {
      problems.push(...structural);
      invalidKeys.add(r.key);
      continue;
    }
    recommendations.push({
      id: ids.get(r.key)!,
      title: r.title.trim(),
      problem: r.problem.trim(),
      proposal: r.proposal.trim(),
      reason: r.reason.trim(),
      category: r.category,
      impact: r.impact,
      effort: r.effort,
      evidence: r.evidence,
      benefits: r.benefits.trim(),
      risks: r.risks.trim(),
      assumptions: r.assumptions.trim(),
      verification: r.verification.trim(),
      dependsOn: r.depends_on.map((k) => ids.get(k)!).filter(Boolean),
      operations: translated.ok ? translated.value : [],
    });
  }
  const assessments = checkAssessments(out.automation, graph, refs, source);
  problems.push(...assessments.problems);
  if (out.outcome === 'improvements' && out.recommendations.length === 0) problems.push('Outcome is "improvements" but there are no recommendations.');
  if (out.outcome === 'no_improvements' && out.recommendations.length > 0) problems.push('Outcome is "no_improvements" but recommendations were given.');
  if (!out.summary.trim()) problems.push('The summary is empty.');
  return {
    value: {
      headline: out.headline.trim() || 'Workflow assessment',
      summary: out.summary.trim(),
      outcome: out.outcome,
      assumptions: out.assumptions.map((a) => a.trim()).filter(Boolean).slice(0, 5),
      recommendations,
      assessments: assessments.valid,
    },
    problems,
    invalidKeys,
  };
}

/** Remove sentences that state unsupported figures (used only after the correction attempt). */
const stripFigures = (text: string, source: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => unsupportedFigures(sentence, source).length === 0)
    .join(' ');

export async function analyzeWorkflow(
  provider: AiProvider,
  input: { graph: WorkflowGraph; answers: { question: string; answer: string }[] },
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  const { view, refs } = workflowView(input.graph);
  // Figures the person supplied (in the workflow or their answers) may be repeated; nothing else.
  const source = JSON.stringify(view) + JSON.stringify(input.answers);
  const request: AiRequest = {
    task: 'analysis',
    system: ANALYSIS_SYSTEM,
    messages: [{ role: 'user', content: analysisPrompt({ view, issues: validateWorkflow(input.graph), answers: input.answers }) }],
    schema: analysisJsonSchema,
    maxTokens: 16000,
    effort: 'high',
    timeoutMs,
    ...(signal ? { signal } : {}),
  };
  let last: CheckedAnalysis | null = null;
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, analysisOutput);
    if (!parsed.ok) return parsed;
    last = checkAnalysis(parsed.value, input.graph, refs, source);
    return last.problems.length ? { ok: false, problems: last.problems.slice(0, 12) } : { ok: true, value: last.value };
  });
  if (result.ok) return { ...result.value, dropped: 0, usage };

  // Still invalid after the one correction: keep what is valid, never what isn't.
  const checked = last as CheckedAnalysis | null;
  if (!checked || !checked.value.summary) throw new AiOutputError("Flico couldn't complete this analysis. No credit was used. Please try again.");
  const { value, invalidKeys } = checked;
  if (value.outcome === 'improvements' && value.recommendations.length === 0) {
    throw new AiOutputError("Flico's recommendations couldn't be checked, so none are shown. No credit was used. Please try again.");
  }
  const clean = (t: string) => stripFigures(t, source);
  const kept = new Set(value.recommendations.map((r) => r.id));
  return {
    headline: clean(value.headline) || 'Workflow assessment',
    summary: clean(value.summary),
    outcome: value.recommendations.length ? 'improvements' : value.outcome,
    assumptions: value.assumptions.map(clean).filter(Boolean),
    recommendations: value.recommendations.map((r) => ({
      ...r,
      title: clean(r.title) || r.title.replace(/\d/g, '').trim(),
      problem: clean(r.problem),
      proposal: clean(r.proposal),
      reason: clean(r.reason),
      benefits: clean(r.benefits),
      risks: clean(r.risks),
      assumptions: clean(r.assumptions),
      verification: clean(r.verification),
      dependsOn: r.dependsOn.filter((id) => kept.has(id)),
    })),
    // Invalid assessments were already left out; valid ones are kept.
    assessments: value.assessments,
    dropped: invalidKeys.size,
    usage,
  };
}

// ---------- interviews about one step: Clarify and briefs ----------

export type InterviewTurn = { question: string; answer: string | null };

/** What the model sees about the step: the workflow (refs), its assessment and the interview so far. */
function interviewContext(graph: WorkflowGraph, assessment: StepAssessment, turns: InterviewTurn[]) {
  const { view, refs } = workflowView(graph);
  const ref = (id: string) => refs.stepRefs.get(id) ?? id;
  const shown = {
    step: ref(assessment.stepId),
    classification: assessment.classification,
    provisional: assessment.provisional,
    reasoning: assessment.reasoning,
    automatable: assessment.automatable,
    human: assessment.human,
    questions: assessment.questions,
    prerequisites: assessment.prerequisites,
    evidence: assessment.evidence,
  };
  // Figures may be repeated only when they appear in the workflow or the person's answers.
  const source = JSON.stringify(view) + JSON.stringify(turns);
  return { view, refs, shown, stepRef: ref(assessment.stepId), source };
}

const normalise = (q: string) => q.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** One focused question that wasn't asked before. */
function questionProblems(question: string, turns: InterviewTurn[]): string[] {
  const problems: string[] = [];
  if ((question.match(/\?/g) ?? []).length > 1) problems.push('Ask exactly one question: one question mark, no lists or multi-part questions.');
  if (turns.some((t) => normalise(t.question) === normalise(question))) problems.push('That question was already asked (answered or skipped). Ask about something else, or finish.');
  return problems;
}

/**
 * Suggested answers to show as choices: at most four, short, distinct, and without figures the
 * workflow or the person didn't give (an unsupported suggestion is dropped, not corrected).
 */
export function suggestedAnswers(options: string[], source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    const text = brief(raw.replace(/\s+/g, ' ').trim(), 10, false).replace(/[.?!]+$/, '');
    const key = text.toLowerCase();
    if (!text || seen.has(key) || unsupportedFigures(text, source).length) continue;
    seen.add(key);
    out.push(text);
    if (out.length === 4) break;
  }
  return out;
}

/** The next interview question, or done. Nothing is stored here. */
export async function assistQuestion(
  provider: AiProvider,
  input: { graph: WorkflowGraph; assessment: StepAssessment; turns: InterviewTurn[]; mode: 'clarify' | 'brief'; kind?: BriefKind },
  timeoutMs: number,
): Promise<{ done: boolean; question: string; options: string[]; usage: Usage }> {
  const context = interviewContext(input.graph, input.assessment, input.turns);
  const request: AiRequest = {
    task: 'assist',
    system: input.mode === 'clarify' ? CLARIFY_QUESTION_SYSTEM : briefQuestionSystem(input.kind!),
    messages: [{ role: 'user', content: assistPrompt({ view: context.view, assessment: context.shown, interview: input.turns, stepRef: context.stepRef, task: 'question' }) }],
    schema: assistQuestionJsonSchema,
    maxTokens: 2000,
    effort: 'low',
    timeoutMs,
  };
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, assistQuestionOutput);
    if (!parsed.ok) return parsed;
    const question = brief(parsed.value.question, 30, false);
    if (parsed.value.done || !question) return { ok: true, value: { done: true, question: '', options: [] as string[] } };
    const problems = questionProblems(question, input.turns);
    return problems.length ? { ok: false, problems } : { ok: true, value: { done: false, question, options: suggestedAnswers(parsed.value.options, context.source) } };
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't prepare a clear question this time. Please try again.");
  return { ...result.value, usage };
}

/** Clarify: update the step's assessment from the latest answer, and the next question (or none). */
export async function clarifyUpdate(
  provider: AiProvider,
  input: { graph: WorkflowGraph; assessment: StepAssessment; turns: InterviewTurn[]; latest: { question: string; answer: string } },
  timeoutMs: number,
): Promise<{ reply: string; updated: AssessmentDraft; nextQuestion: string; nextOptions: string[]; usage: Usage }> {
  const context = interviewContext(input.graph, input.assessment, [...input.turns, { question: input.latest.question, answer: input.latest.answer }]);
  const request: AiRequest = {
    task: 'assist',
    system: CLARIFY_UPDATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: assistPrompt({ view: context.view, assessment: context.shown, interview: input.turns, stepRef: context.stepRef, task: 'update', latest: input.latest }),
      },
    ],
    schema: clarifyUpdateJsonSchema,
    maxTokens: 6000,
    effort: 'medium',
    timeoutMs,
  };
  const asked = [...input.turns, { question: input.latest.question, answer: input.latest.answer }];
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, clarifyUpdateOutput);
    if (!parsed.ok) return parsed;
    if (parsed.value.assessment.step !== context.stepRef) return { ok: false, problems: [`Update only the selected step ${context.stepRef}.`] };
    const checked = checkAssessments([parsed.value.assessment], input.graph, context.refs, context.source);
    const nextQuestion = brief(parsed.value.next_question, 30, false);
    const problems = [...checked.problems, ...(nextQuestion ? questionProblems(nextQuestion, asked) : [])];
    if (problems.length || !checked.valid[0]) return { ok: false, problems: problems.length ? problems : ['The assessment is incomplete.'] };
    const found = unsupportedFigures(parsed.value.reply, context.source);
    if (found.length) return { ok: false, problems: [`The reply states figures the workflow doesn't support (${found.join(', ')}).`] };
    // The reply may be two sentences (what changed, and why): capped, never cut to the first sentence.
    return { ok: true, value: { reply: brief(parsed.value.reply, 50, false), updated: checked.valid[0], nextQuestion, nextOptions: nextQuestion ? suggestedAnswers(parsed.value.next_options, context.source) : [] } };
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't update the assessment from that answer. Nothing was changed; please try again.");
  return { ...result.value, usage };
}

/** Reassess one step against the workflow as it is now, keeping the person's answers where they still apply. Nothing is stored here. */
export async function reassessStep(
  provider: AiProvider,
  input: { graph: WorkflowGraph; assessment: StepAssessment; turns: InterviewTurn[] },
  timeoutMs: number,
): Promise<{ updated: AssessmentDraft; usage: Usage }> {
  const context = interviewContext(input.graph, input.assessment, input.turns);
  const request: AiRequest = {
    task: 'assist',
    system: REASSESS_SYSTEM,
    messages: [{ role: 'user', content: assistPrompt({ view: context.view, assessment: context.shown, interview: input.turns, stepRef: context.stepRef, task: 'reassess' }) }],
    schema: assessmentJsonSchema,
    maxTokens: 5000,
    effort: 'medium',
    timeoutMs,
  };
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, assessmentOutput);
    if (!parsed.ok) return parsed;
    if (parsed.value.step !== context.stepRef) return { ok: false, problems: [`Assess only the selected step ${context.stepRef}.`] };
    const checked = checkAssessments([parsed.value], input.graph, context.refs, context.source);
    if (checked.problems.length || !checked.valid[0]) return { ok: false, problems: checked.problems.length ? checked.problems : ['The assessment is incomplete.'] };
    return { ok: true, value: checked.valid[0] };
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't reassess this step. Nothing was changed; please try again.");
  return { updated: result.value, usage };
}

/** Write a step's brief from the workflow, its assessment and the interview. Nothing is stored here. */
export async function writeBrief(
  provider: AiProvider,
  input: { graph: WorkflowGraph; assessment: StepAssessment; turns: InterviewTurn[]; kind: BriefKind },
  timeoutMs: number,
): Promise<{ summary: string; sections: AutomationBrief['sections']; usage: Usage }> {
  const context = interviewContext(input.graph, input.assessment, input.turns);
  const headings = BRIEF_SECTIONS[input.kind];
  const request: AiRequest = {
    task: 'assist',
    system: briefWriteSystem(input.kind),
    messages: [{ role: 'user', content: assistPrompt({ view: context.view, assessment: context.shown, interview: input.turns, stepRef: context.stepRef, task: 'brief' }) }],
    schema: briefJsonSchema,
    maxTokens: 6000,
    effort: 'medium',
    timeoutMs,
  };
  const { result, usage } = await generateChecked(provider, request, (text) => {
    const parsed = parseOutput(text, briefOutput);
    if (!parsed.ok) return parsed;
    const problems: string[] = [];
    const got = parsed.value.sections.map((s) => s.heading.trim());
    if (got.join('|') !== headings.join('|')) problems.push(`Use exactly these section headings, in this order: ${headings.map((h) => `"${h}"`).join(', ')}.`);
    const empty = parsed.value.sections.filter((s) => s.items.filter((i) => i.trim()).length === 0).map((s) => s.heading);
    if (empty.length) problems.push(`Every section needs at least one item (empty: ${empty.join(', ')}).`);
    const found = unsupportedFigures([parsed.value.summary, ...parsed.value.sections.flatMap((s) => s.items)].join(' '), context.source);
    if (found.length) problems.push(`The brief states figures the workflow and answers don't support (${found.join(', ')}).`);
    if (problems.length) return { ok: false, problems };
    return {
      ok: true,
      value: {
        summary: brief(parsed.value.summary, 35),
        // Concise by design: at most 4 short items per section.
        sections: parsed.value.sections.map((s) => ({ heading: s.heading.trim(), items: s.items.map((i) => i.trim()).filter(Boolean).slice(0, 4).map((i) => brief(i, 25, false)) })),
      },
    };
  });
  if (!result.ok) throw new AiOutputError("Flico couldn't write a usable brief this time. Your answers are kept; please try again.");
  return { ...result.value, usage };
}
