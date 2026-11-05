import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AI_CHAT_MESSAGE_MAX,
  AI_DESCRIPTION_MAX,
  AI_QUICK_ADD_MAX,
  DESCRIBE_TEXT_MAX,
  ASSUMPTION_TEXT_MAX,
  type AiDraftResponse,
  type AiStatusResponse,
  type AiUsageKind,
  type ApplyProposalResponse,
  type AssumptionsResponse,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatReplyResponse,
  type DescribeStepResponse,
  type QuickAddResponse,
} from '../../shared/api.js';
import { applyOperations } from '../../shared/aiOps.js';
import { GRAPH_LIMITS } from '../../shared/graph.js';
import { placeNewSteps } from '../../shared/layout.js';
import { transaction } from '../db/database.js';
import { requireAuth, sendError, type AppContext } from '../http.js';
import { AI_ERROR_MESSAGES, AiError, type AiProvider } from '../ai/provider.js';
import { AiOutputError, answerAssistant, describeStep, generateWorkflow, quickAdd, type HistoryTurn } from '../ai/service.js';
import { appendExchange, clearChat, getMessage, listMessages, recordUsage, setProposalStatus, usedToday } from '../ai/store.js';
import { validateGraph } from '../workflows/graph.js';
import { currentAnalysis } from '../analysis/store.js';
import { MAX_WORKFLOWS_PER_USER, countWorkflows, createWorkflow, getWorkflow, saveAssumptions, saveGraph } from '../workflows/service.js';

const text = (max: number, empty: string, long: string) => z.string().trim().min(1, empty).max(max, long);
const draftBody = z.strictObject({ description: text(AI_DESCRIPTION_MAX, 'Please describe the workflow first.', `Descriptions can be up to ${AI_DESCRIPTION_MAX} characters.`) });
const quickAddBody = z.strictObject({
  text: text(AI_QUICK_ADD_MAX, 'Describe what happens next.', `Keep it under ${AI_QUICK_ADD_MAX} characters.`),
  previousLabel: z.string().max(GRAPH_LIMITS.maxLabel).optional(),
  nextLabel: z.string().max(GRAPH_LIMITS.maxLabel).optional(),
  finishAllowed: z.boolean(),
});
const chatBody = z.strictObject({
  content: text(AI_CHAT_MESSAGE_MAX, 'Please type a message.', `Messages can be up to ${AI_CHAT_MESSAGE_MAX} characters.`),
  baseRevision: z.number().int().positive(),
  mode: z.enum(['chat', 'fix']),
  stepId: z.string().max(64).optional(),
});
const assumptionBody = z
  .strictObject({
    text: text(ASSUMPTION_TEXT_MAX, 'An assumption needs some text.', `Assumptions can be up to ${ASSUMPTION_TEXT_MAX} characters.`).optional(),
    status: z.enum(['open', 'confirmed']).optional(),
  })
  .refine((b) => b.text !== undefined || b.status !== undefined, 'Nothing to change.');

const describeBody = z.strictObject({
  text: text(DESCRIBE_TEXT_MAX, 'Describe the step first.', `Descriptions can be up to ${DESCRIBE_TEXT_MAX} characters.`),
  baseRevision: z.number().int().positive(),
});

type IdParams = { Params: { id: string } };
type StepParams = { Params: { id: string; stepId: string } };
type MessageParams = { Params: { id: string; messageId: string } };
type AssumptionParams = { Params: { id: string; assumptionId: string } };

const NOT_FOUND = 'Workflow not found.';
const HISTORY_TURNS = 20;

/** The conversation as the model sees it: the latest turns, with what happened to each proposal. */
function historyTurns(messages: ChatMessage[]): HistoryTurn[] {
  // Clarify and brief interviews happen in the Action plan, not in Ask Flico: they are not part of this conversation.
  const turns = messages.filter((m) => !m.assist).slice(-HISTORY_TURNS).map((m): HistoryTurn => {
    if (m.role === 'user' || !m.proposal) return { role: m.role, content: m.content };
    const outcome = { pending: 'not yet applied', applied: 'applied by the person', cancelled: 'cancelled by the person', expired: 'not applied' }[m.proposal.status];
    return { role: m.role, content: `${m.content}\n\n[Proposed change: ${m.proposal.summary} (${outcome})]` };
  });
  // Interviews add several messages in a row from the same side; the model needs strict alternation
  // starting with the person, so consecutive turns are merged and a leading assistant turn is dropped.
  const merged: HistoryTurn[] = [];
  for (const t of turns) {
    const last = merged.at(-1);
    if (last && last.role === t.role) last.content = `${last.content}\n\n${t.content}`;
    else merged.push({ ...t });
  }
  while (merged[0]?.role === 'assistant') merged.shift();
  return merged;
}

/** The latest analysis as Ask Flico sees it: summary and recommendation titles with their review state. */
function analysisContext(analysis: ReturnType<typeof currentAnalysis>) {
  if (!analysis) return null;
  return {
    headline: analysis.headline,
    summary: analysis.summary,
    recommendations: analysis.recommendations.map((r) => ({ title: r.title, category: r.category, status: analysis.appliedAt && r.status === 'accepted' ? 'applied' : r.status, proposal: r.proposal })),
  };
}

export const aiRoutes =
  (ctx: AppContext, provider: AiProvider | null): FastifyPluginAsync =>
  async (app) => {
    const { db, config } = ctx;
    app.addHook('preHandler', requireAuth);

    const limits: Record<AiUsageKind, number> = { draft: config.AI_DAILY_DRAFTS, quick_add: config.AI_DAILY_QUICK_ADDS, chat: config.AI_DAILY_CHAT };
    const limitNames: Record<AiUsageKind, string> = { draft: 'AI drafts', quick_add: 'Quick Adds', chat: 'Ask Flico messages' };
    const timeouts: Record<AiUsageKind, number> = {
      draft: config.AI_TIMEOUT_SECONDS * 1000,
      chat: config.AI_TIMEOUT_SECONDS * 1000,
      quick_add: Math.min(30, config.AI_TIMEOUT_SECONDS) * 1000,
    };
    const rateLimit = { config: { rateLimit: { max: config.AI_RATE_LIMIT, timeWindow: 60_000 } } };

    /** Common gate for AI requests: provider configured and today's limit not reached. */
    const gate = (request: FastifyRequest, reply: FastifyReply, kind: AiUsageKind): boolean => {
      if (!provider) {
        void sendError(reply, 503, 'ai_not_configured', "AI isn't set up on this Flico server yet, so nothing was sent. You can keep editing manually.");
        return false;
      }
      if (usedToday(db, request.user!.id, kind, ctx.now()) >= limits[kind]) {
        void sendError(reply, 429, 'limit_reached', `You've used today's ${limits[kind]} ${limitNames[kind]}. The limit resets at midnight UTC. You can keep editing manually.`);
        return false;
      }
      return true;
    };

    const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
      if (error instanceof AiError) {
        // Log the failure class only: never prompts, workflow text or responses.
        request.log.warn({ aiError: error.kind }, 'AI request failed');
        const status = error.kind === 'refused' ? 422 : 503;
        return sendError(reply, status, error.kind === 'refused' ? 'ai_failed' : 'ai_unavailable', AI_ERROR_MESSAGES[error.kind]);
      }
      if (error instanceof AiOutputError) {
        request.log.warn({ aiError: 'invalid_output' }, 'AI output rejected');
        return sendError(reply, 502, 'ai_failed', error.message);
      }
      throw error;
    };

    app.get('/ai/status', async (request) => {
      const userId = request.user!.id;
      const now = ctx.now();
      const body: AiStatusResponse = {
        available: provider !== null,
        source: provider?.source ?? null,
        limits: {
          draft: { limit: limits.draft, used: usedToday(db, userId, 'draft', now) },
          quick_add: { limit: limits.quick_add, used: usedToday(db, userId, 'quick_add', now) },
          chat: { limit: limits.chat, used: usedToday(db, userId, 'chat', now) },
        },
      };
      return body;
    });

    // ---------- AI Create ----------

    app.post('/workflows/ai-draft', rateLimit, async (request, reply) => {
      const parsed = draftBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid description.');
      const userId = request.user!.id;
      if (countWorkflows(db, userId) >= MAX_WORKFLOWS_PER_USER) {
        return sendError(reply, 409, 'limit_reached', `You can keep up to ${MAX_WORKFLOWS_PER_USER} workflows. Delete one to create another.`);
      }
      if (!gate(request, reply, 'draft')) return reply;
      try {
        const draft = await generateWorkflow(provider!, parsed.data.description, timeouts.draft);
        const checked = validateGraph(draft.graph);
        if (!checked.ok) throw new AiOutputError("Flico couldn't turn that description into a usable draft. Please try again.");
        const workflow = createWorkflow(db, userId, draft.name, checked.graph, ctx.now(), draft.assumptions);
        recordUsage(db, userId, 'draft', provider!.source, draft.usage, ctx.now());
        const body: AiDraftResponse = { workflow, source: provider!.source, partial: draft.partial };
        return reply.status(201).send(body);
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    // ---------- Quick Add ----------

    app.post<IdParams>('/workflows/:id/quick-add', rateLimit, async (request, reply) => {
      const parsed = quickAddBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid request.');
      const userId = request.user!.id;
      if (!getWorkflow(db, userId, request.params.id)) return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (!gate(request, reply, 'quick_add')) return reply;
      try {
        const step = await quickAdd(provider!, parsed.data, timeouts.quick_add);
        recordUsage(db, userId, 'quick_add', provider!.source, step.usage, ctx.now());
        const body: QuickAddResponse = { step: { type: step.type, label: step.label }, source: provider!.source };
        return body;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    // ---------- Describe a step: details from the person's own words (nothing is changed here) ----------

    app.post<StepParams>('/workflows/:id/steps/:stepId/describe', rateLimit, async (request, reply) => {
      const parsed = describeBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid description.');
      const userId = request.user!.id;
      const workflow = getWorkflow(db, userId, request.params.id);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      const step = workflow.graph.nodes.find((n) => n.id === request.params.stepId);
      if (!step) return sendError(reply, 404, 'not_found', 'That step no longer exists.');
      if (!gate(request, reply, 'chat')) return reply;
      if (workflow.revision !== parsed.data.baseRevision) {
        return sendError(reply, 409, 'conflict', "Your latest changes haven't finished saving. Please try again in a moment.");
      }
      try {
        const { described, usage } = await describeStep(provider!, { graph: workflow.graph, stepId: step.id, text: parsed.data.text }, timeouts.chat);
        recordUsage(db, userId, 'chat', provider!.source, usage, ctx.now());
        const body: DescribeStepResponse = { ...described, source: provider!.source };
        return body;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    // ---------- Ask Flico ----------

    app.get<IdParams>('/workflows/:id/chat', async (request, reply) => {
      const userId = request.user!.id;
      if (!getWorkflow(db, userId, request.params.id)) return sendError(reply, 404, 'not_found', NOT_FOUND);
      const body: ChatHistoryResponse = { messages: listMessages(db, userId, request.params.id) };
      return body;
    });

    app.post<IdParams>('/workflows/:id/chat', rateLimit, async (request, reply) => {
      const parsed = chatBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid message.');
      const userId = request.user!.id;
      const workflowId = request.params.id;
      const workflow = getWorkflow(db, userId, workflowId);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (!gate(request, reply, 'chat')) return reply;
      if (workflow.revision !== parsed.data.baseRevision) {
        return sendError(reply, 409, 'conflict', "Your latest changes haven't finished saving. Please try again in a moment.");
      }
      const step = parsed.data.stepId ? workflow.graph.nodes.find((n) => n.id === parsed.data.stepId) : undefined;
      try {
        const answer = await answerAssistant(
          provider!,
          {
            graph: workflow.graph,
            history: historyTurns(listMessages(db, userId, workflowId)),
            content: parsed.data.content,
            fix: parsed.data.mode === 'fix',
            ...(step ? { stepId: step.id } : {}),
            analysis: analysisContext(currentAnalysis(db, userId, workflowId)),
          },
          timeouts.chat,
        );
        const messages = transaction(db, () => {
          // The workflow may have been deleted while the model was answering.
          if (!getWorkflow(db, userId, workflowId)) return null;
          recordUsage(db, userId, 'chat', provider!.source, answer.usage, ctx.now());
          return appendExchange(
            db,
            userId,
            workflowId,
            [
              { role: 'user', content: parsed.data.content, ...(step ? { context: { stepId: step.id, stepLabel: step.label } } : {}) },
              {
                role: 'assistant',
                content: answer.reply,
                source: provider!.source,
                ...(answer.proposal ? { proposal: { ...answer.proposal, baseRevision: workflow.revision } } : {}),
              },
            ],
            ctx.now(),
          );
        });
        if (!messages) return sendError(reply, 404, 'not_found', NOT_FOUND);
        const body: ChatReplyResponse = { messages };
        return body;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    app.delete<IdParams>('/workflows/:id/chat', async (request, reply) => {
      const userId = request.user!.id;
      if (!getWorkflow(db, userId, request.params.id)) return sendError(reply, 404, 'not_found', NOT_FOUND);
      clearChat(db, userId, request.params.id);
      return reply.status(204).send();
    });

    /** Apply a proposal: owner, expected revision, operations and integrity are checked; all or nothing. */
    app.post<MessageParams>('/workflows/:id/chat/:messageId/apply', async (request, reply) => {
      const userId = request.user!.id;
      const { id, messageId } = request.params;
      type Outcome = { error: [number, 'not_found' | 'conflict', string] } | { body: ApplyProposalResponse };
      const outcome = transaction(db, (): Outcome => {
        const workflow = getWorkflow(db, userId, id);
        if (!workflow) return { error: [404, 'not_found', NOT_FOUND] };
        const message = getMessage(db, userId, id, messageId);
        if (!message?.proposal) return { error: [404, 'not_found', 'That suggestion no longer exists.'] };
        if (message.proposal.status !== 'pending') return { error: [409, 'conflict', `This suggestion was already ${message.proposal.status}.`] };
        const expire = (text: string): Outcome => {
          setProposalStatus(db, userId, messageId, 'expired');
          return { error: [409, 'conflict', text] };
        };
        if (workflow.revision !== message.proposal.baseRevision) {
          return expire('The workflow changed after this suggestion was made, so it was not applied. Ask Flico again for an updated suggestion.');
        }
        const applied = applyOperations(workflow.graph, message.proposal.operations);
        if (!applied.ok) return expire("This suggestion can't be applied to the workflow any more. Nothing was changed.");
        const checked = validateGraph(placeNewSteps(workflow.graph, applied.graph));
        if (!checked.ok) return expire("This suggestion can't be applied to the workflow any more. Nothing was changed.");
        const saved = saveGraph(db, userId, id, checked.graph, workflow.revision, ctx.now());
        if (!saved.ok) return expire('The workflow changed while applying, so nothing was changed. Ask Flico again.');
        setProposalStatus(db, userId, messageId, 'applied');
        return { body: { message: getMessage(db, userId, id, messageId)!, revision: saved.revision, updatedAt: saved.updatedAt, graph: checked.graph } };
      });
      if ('error' in outcome) return sendError(reply, ...outcome.error);
      return outcome.body;
    });

    app.post<MessageParams>('/workflows/:id/chat/:messageId/cancel', async (request, reply) => {
      const userId = request.user!.id;
      const { id, messageId } = request.params;
      if (!getWorkflow(db, userId, id)) return sendError(reply, 404, 'not_found', NOT_FOUND);
      const message = getMessage(db, userId, id, messageId);
      if (!message?.proposal) return sendError(reply, 404, 'not_found', 'That suggestion no longer exists.');
      if (message.proposal.status === 'pending') setProposalStatus(db, userId, messageId, 'cancelled');
      return { message: getMessage(db, userId, id, messageId)! };
    });

    // ---------- assumptions from an AI draft ----------

    app.patch<AssumptionParams>('/workflows/:id/assumptions/:assumptionId', async (request, reply) => {
      const parsed = assumptionBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid change.');
      const userId = request.user!.id;
      const workflow = getWorkflow(db, userId, request.params.id);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (!workflow.assumptions.some((a) => a.id === request.params.assumptionId)) return sendError(reply, 404, 'not_found', 'Assumption not found.');
      // Editing an assumption is a correction by the person, so it counts as confirmed.
      const assumptions = workflow.assumptions.map((a) =>
        a.id === request.params.assumptionId
          ? { ...a, ...(parsed.data.text !== undefined ? { text: parsed.data.text, status: 'confirmed' as const } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}) }
          : a,
      );
      saveAssumptions(db, userId, workflow.id, assumptions, ctx.now());
      const body: AssumptionsResponse = { assumptions };
      return body;
    });

    app.delete<AssumptionParams>('/workflows/:id/assumptions/:assumptionId', async (request, reply) => {
      const userId = request.user!.id;
      const workflow = getWorkflow(db, userId, request.params.id);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      const assumptions = workflow.assumptions.filter((a) => a.id !== request.params.assumptionId);
      if (assumptions.length === workflow.assumptions.length) return sendError(reply, 404, 'not_found', 'Assumption not found.');
      saveAssumptions(db, userId, workflow.id, assumptions, ctx.now());
      const body: AssumptionsResponse = { assumptions };
      return body;
    });
  };
