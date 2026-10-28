// AI use cases: generateWorkflow (draft), quickAdd and answerAssistant (chat, edit proposals, fixes).
// Each validates the model's output before anything is returned; invalid output gets exactly one
// correction attempt. Nothing here writes to the database.
import { ASSUMPTION_TEXT_MAX, WORKFLOW_NAME_MAX, type Assumption, type QuickAddType } from '../../shared/api.js';
import { applyOperations, structuralProblems, type ProposalOperation } from '../../shared/aiOps.js';
import type { EdgeType, StepType, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../shared/graph.js';
import { autoLayout } from '../../shared/layout.js';
import { validateWorkflow } from '../../shared/validation.js';
import { newId } from '../auth/tokens.js';
import type { AiMessage, AiProvider, AiRequest } from './provider.js';
import {
  CHAT_SYSTEM,
  DRAFT_SYSTEM,
  QUICK_ADD_SYSTEM,
  chatPrompt,
  correctionPrompt,
  draftPrompt,
  quickAddPrompt,
  workflowView,
  type RefMap,
} from './prompts.js';
import {
  LIMITS,
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
  input: { graph: WorkflowGraph; history: HistoryTurn[]; content: string; fix: boolean; stepId?: string },
  timeoutMs: number,
): Promise<AssistantAnswer> {
  const { view, refs } = workflowView(input.graph);
  const prompt = chatPrompt({
    view,
    issues: validateWorkflow(input.graph),
    content: input.content,
    stepRef: input.stepId ? refs.stepRefs.get(input.stepId) : undefined,
    fix: input.fix,
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
