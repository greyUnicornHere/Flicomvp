import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ANALYSIS_ANSWER_MAX,
  type AnalysesResponse,
  type AnalysisQuestionsResponse,
  type AnalysisResponse,
  type AnalysisRunResponse,
  type ApplyAnalysisResponse,
  type CreditsResponse,
  type ReviewStatus,
} from '../../shared/api.js';
import { basesOf, isAssessable, BRIEF_KIND, BRIEF_MAX_QUESTIONS, BRIEF_TITLE, CLARIFY_MAX_QUESTIONS, needsReassessment, type StepAssessment } from '../../shared/assessment.js';
import type { AssistInfo, AssistMode, AssistResponse, ChatMessage } from '../../shared/api.js';
import { diffGraphs } from '../../shared/aiOps.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import { NO_CHANGES_MESSAGE, planApply, quickRepeatBlocked } from '../../shared/analysis.js';
import { placeNewSteps } from '../../shared/layout.js';
import { preAnalysisCheck } from '../../shared/validation.js';
import { transaction } from '../db/database.js';
import { requireAuth, sendError, type AppContext } from '../http.js';
import { AI_ERROR_MESSAGES, AiError, type AiProvider } from '../ai/provider.js';
import { AiOutputError, analyzeWorkflow, assistQuestion, clarifyUpdate, reassessStep, suggestQuestions, writeBrief, type InterviewTurn } from '../ai/service.js';
import { appendExchange, getMessage, listMessages, recordUsage, setAssistStatus, usedToday } from '../ai/store.js';
import { validateGraph } from '../workflows/graph.js';
import { getWorkflow, saveGraph } from '../workflows/service.js';
import {
  creditBalance,
  currentAnalysis,
  debitForRun,
  ensureInitialGrant,
  failInterruptedRuns,
  findRunByKey,
  finishRun,
  getAnalysis,
  getRun,
  listAnalyses,
  saveAssessments,
  saveBrief,
  markApplied,
  runningRun,
  saveAnalysis,
  setReview,
  setStage,
  startRun,
} from '../analysis/store.js';

const startBody = z.strictObject({
  mode: z.enum(['quick', 'guided']),
  baseRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(100),
  answers: z
    .array(z.strictObject({ questionId: z.string().max(64), question: z.string().trim().max(300), answer: z.string().trim().max(ANALYSIS_ANSWER_MAX) }))
    .max(3)
    .optional(),
});
const questionsBody = z.strictObject({ baseRevision: z.number().int().positive() });
const reviewBody = z.strictObject({ statuses: z.record(z.string().max(64), z.enum(['pending', 'accepted', 'rejected'])) });

type IdParams = { Params: { id: string } };
const NOT_FOUND = 'Workflow not found.';
const NO_CREDITS = "You've used all your analysis credits. Ask the Flico team to add more. Your workflows are unaffected.";

export const analysisRoutes =
  (ctx: AppContext, provider: AiProvider | null): FastifyPluginAsync =>
  async (app) => {
    const { db, config } = ctx;
    app.addHook('preHandler', requireAuth);
    failInterruptedRuns(db, ctx.now());

    /** Cancel switches for analyses in progress (in memory: a restart fails them, uncharged). */
    const running = new Map<string, AbortController>();
    const rateLimit = { config: { rateLimit: { max: config.AI_RATE_LIMIT, timeWindow: 60_000 } } };

    const balanceOf = (userId: string) => {
      ensureInitialGrant(db, userId, config.ANALYSIS_INITIAL_CREDITS, ctx.now());
      return creditBalance(db, userId);
    };

    const notConfigured = (reply: FastifyReply) =>
      sendError(reply, 503, 'ai_not_configured', "AI isn't set up on this Flico server yet, so analysis isn't available. Nothing was sent or charged.");

    const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
      if (error instanceof AiError) {
        request.log.warn({ aiError: error.kind }, 'AI request failed');
        return sendError(reply, error.kind === 'refused' ? 422 : 503, error.kind === 'refused' ? 'ai_failed' : 'ai_unavailable', AI_ERROR_MESSAGES[error.kind]);
      }
      if (error instanceof AiOutputError) return sendError(reply, 502, 'ai_failed', error.message);
      throw error;
    };

    app.get('/credits', async (request) => {
      const body: CreditsResponse = { balance: balanceOf(request.user!.id), initial: config.ANALYSIS_INITIAL_CREDITS };
      return body;
    });

    // ---------- Guided Analysis questions (free; counts as an Ask Flico message) ----------

    app.post<IdParams>('/workflows/:id/analysis-questions', rateLimit, async (request, reply) => {
      const parsed = questionsBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', 'Invalid request.');
      const userId = request.user!.id;
      const workflow = getWorkflow(db, userId, request.params.id);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (!provider) return notConfigured(reply);
      if (usedToday(db, userId, 'chat', ctx.now()) >= config.AI_DAILY_CHAT) {
        return sendError(reply, 429, 'limit_reached', "You've reached today's Ask Flico limit, so Flico can't prepare questions. You can still run a Quick Analysis.");
      }
      if (workflow.revision !== parsed.data.baseRevision) {
        return sendError(reply, 409, 'conflict', "Your latest changes haven't finished saving. Please try again in a moment.");
      }
      try {
        const { questions, usage } = await suggestQuestions(provider, workflow.graph, Math.min(60, config.AI_TIMEOUT_SECONDS) * 1000);
        recordUsage(db, userId, 'chat', provider.source, usage, ctx.now());
        const body: AnalysisQuestionsResponse = { questions: questions.map((q, i) => ({ id: `q${i + 1}`, ...q })), source: provider.source };
        return body;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    // ---------- runs ----------

    app.post<IdParams>('/workflows/:id/analysis-runs', rateLimit, async (request, reply) => {
      const parsed = startBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', 'Invalid analysis request.');
      const userId = request.user!.id;
      const workflowId = request.params.id;
      const workflow = getWorkflow(db, userId, workflowId);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (!provider) return notConfigured(reply);

      // Same request again (client retry, double click): never a second run or a second charge.
      const existing = findRunByKey(db, userId, parsed.data.idempotencyKey);
      if (existing && (existing.status === 'running' || existing.status === 'succeeded')) {
        if (existing.workflowId !== workflowId) return sendError(reply, 409, 'conflict', 'This request was already used for another workflow.');
        const body: AnalysisRunResponse = { run: existing };
        return reply.status(existing.status === 'running' ? 202 : 200).send(body);
      }
      if (runningRun(db, userId)) return sendError(reply, 409, 'conflict', 'An analysis is already running. Wait for it to finish or cancel it.');
      if (workflow.revision !== parsed.data.baseRevision) {
        return sendError(reply, 409, 'conflict', "Your latest changes haven't finished saving. Please try again in a moment.");
      }
      const check = preAnalysisCheck(workflow.graph);
      if (!check.canAnalyze) return sendError(reply, 400, 'bad_request', `Fix before analysis: ${check.blockers.map((b) => b.message).join(' ')}`);
      // A repeat Quick Analysis of an unchanged workflow would add nothing: refused, no credit used.
      if (parsed.data.mode === 'quick' && quickRepeatBlocked(currentAnalysis(db, userId, workflowId), workflow.graph)) {
        return sendError(reply, 409, 'conflict', NO_CHANGES_MESSAGE);
      }
      if (balanceOf(userId) < 1) return sendError(reply, 402, 'no_credits', NO_CREDITS);

      const run = startRun(db, userId, workflowId, parsed.data.idempotencyKey, parsed.data.mode, ctx.now());
      const answers = (parsed.data.answers ?? []).filter((a) => a.answer).map((a) => ({ question: a.question, answer: a.answer }));
      const controller = new AbortController();
      running.set(run.id, controller);
      void execute(request, provider, { runId: run.id, userId, workflowId, mode: parsed.data.mode, revision: workflow.revision, graph: workflow.graph, answers }, controller).finally(() =>
        running.delete(run.id),
      );
      const body: AnalysisRunResponse = { run };
      return reply.status(202).send(body);
    });

    /** The analysis itself, in the background, with genuine stages. Charged only when saved. */
    async function execute(
      request: FastifyRequest,
      ai: AiProvider,
      job: { runId: string; userId: string; workflowId: string; mode: 'quick' | 'guided'; revision: number; graph: WorkflowGraph; answers: { question: string; answer: string }[] },
      controller: AbortController,
    ) {
      const { runId, userId } = job;
      try {
        setStage(db, runId, 'reviewing');
        const result = await analyzeWorkflow(ai, { graph: job.graph, answers: job.answers }, config.AI_ANALYSIS_TIMEOUT_SECONDS * 1000, controller.signal);
        setStage(db, runId, 'validating');
        setStage(db, runId, 'saving');
        transaction(db, () => {
          if (getRun(db, userId, runId)?.status !== 'running') return; // cancelled meanwhile: nothing saved, nothing charged
          if (!getWorkflow(db, userId, job.workflowId)) {
            finishRun(db, runId, 'failed', ctx.now(), { error: 'The workflow was deleted. No credit was used.' });
            return;
          }
          if (creditBalance(db, userId) < 1) {
            finishRun(db, runId, 'failed', ctx.now(), { error: NO_CREDITS });
            return;
          }
          const { usage: _usage, dropped: _dropped, assessments: drafts, ...stored } = result;
          // Each assessment is bound to its step, this analysis and the analysed revision.
          const assessedAt = new Date(ctx.now()).toISOString();
          const assessments = drafts.map((a) => ({ ...a, ...basesOf(job.graph, a.stepId)!, revision: job.revision, updatedAt: assessedAt }));
          const analysisId = saveAnalysis(
            db,
            userId,
            job.workflowId,
            { mode: job.mode, source: ai.source, baseRevision: job.revision, snapshot: job.graph, result: stored, answers: job.answers, assessments },
            ctx.now(),
          );
          debitForRun(db, userId, runId, ctx.now());
          finishRun(db, runId, 'succeeded', ctx.now(), { analysisId });
        });
      } catch (error) {
        const message =
          error instanceof AiError
            ? error.kind === 'cancelled'
              ? 'Cancelled. No credit was used.'
              : `${AI_ERROR_MESSAGES[error.kind]} No credit was used.`
            : error instanceof AiOutputError
              ? error.message
              : 'Something went wrong during the analysis. No credit was used. Please try again.';
        if (!(error instanceof AiError || error instanceof AiOutputError)) request.log.error({ err: { message: (error as Error).message } }, 'Analysis failed');
        else request.log.warn({ aiError: error instanceof AiError ? error.kind : 'invalid_output' }, 'Analysis failed');
        finishRun(db, runId, error instanceof AiError && error.kind === 'cancelled' ? 'cancelled' : 'failed', ctx.now(), { error: message });
      }
    }

    app.get<{ Params: { runId: string } }>('/analysis-runs/:runId', async (request, reply) => {
      const run = getRun(db, request.user!.id, request.params.runId);
      if (!run) return sendError(reply, 404, 'not_found', 'Analysis not found.');
      const body: AnalysisRunResponse = { run };
      return body;
    });

    app.post<{ Params: { runId: string } }>('/analysis-runs/:runId/cancel', async (request, reply) => {
      const userId = request.user!.id;
      const run = getRun(db, userId, request.params.runId);
      if (!run) return sendError(reply, 404, 'not_found', 'Analysis not found.');
      // Only a run that hasn't been saved can be cancelled; saving happens in one transaction.
      if (run.status === 'running' && finishRun(db, run.id, 'cancelled', ctx.now(), { error: 'Cancelled. No credit was used.' })) {
        running.get(run.id)?.abort();
      }
      const body: AnalysisRunResponse = { run: getRun(db, userId, run.id)! };
      return body;
    });

    // ---------- results and review ----------

    app.get<IdParams>('/workflows/:id/analyses', async (request, reply) => {
      const userId = request.user!.id;
      if (!getWorkflow(db, userId, request.params.id)) return sendError(reply, 404, 'not_found', NOT_FOUND);
      const body: AnalysesResponse = { analyses: listAnalyses(db, userId, request.params.id) };
      return body;
    });

    // ---------- interviews about one step: Clarify and briefs (Ask Flico, one question at a time, no credit) ----------

    const assistStartBody = z.strictObject({ stepId: z.string().min(1).max(64), mode: z.enum(['clarify', 'brief']), baseRevision: z.number().int().positive() });
    const assistAnswerBody = z.union([
      z.strictObject({ messageId: z.string().min(1).max(64), baseRevision: z.number().int().positive(), answer: z.string().trim().min(1, 'Please type an answer, or skip for now.').max(ANALYSIS_ANSWER_MAX) }),
      z.strictObject({ messageId: z.string().min(1).max(64), baseRevision: z.number().int().positive(), skip: z.literal(true) }),
    ]);
    type Fail = [number, 'not_found' | 'conflict' | 'bad_request' | 'limit_reached', string];
    const LIMIT_MESSAGE = "You've reached today's Ask Flico limit. The limit resets at midnight UTC.";
    const STEP_CHANGED = 'This step changed since it was assessed. Reassess it first.';

    /** Shared checks: owned current analysis with assessments, saved revision, a step that hasn't changed. */
    const assistContext = (userId: string, analysisId: string, stepId: string, baseRevision: number) => {
      const analysis = getAnalysis(db, userId, analysisId);
      if (!analysis) return [404, 'not_found', 'Analysis not found.'] as Fail;
      const workflow = getWorkflow(db, userId, analysis.workflowId);
      if (!workflow) return [404, 'not_found', NOT_FOUND] as Fail;
      if (currentAnalysis(db, userId, workflow.id)?.id !== analysis.id) return [409, 'conflict', 'Only the latest analysis can be clarified or planned.'] as Fail;
      if (!analysis.assessments) return [409, 'conflict', 'This analysis was made before automation assessments were added. Run a new analysis to get them.'] as Fail;
      const assessment = analysis.assessments.find((a) => a.stepId === stepId);
      if (!assessment) return [404, 'not_found', 'This step has no automation assessment.'] as Fail;
      if (workflow.revision !== baseRevision) return [409, 'conflict', "Your latest changes haven't finished saving. Please try again in a moment."] as Fail;
      if (needsReassessment(workflow.graph, assessment)) return [409, 'conflict', STEP_CHANGED] as Fail;
      return { analysis, workflow, assessment };
    };

    const stepMessages = (userId: string, workflowId: string, analysisId: string, stepId: string) =>
      listMessages(db, userId, workflowId).filter((m) => m.assist?.analysisId === analysisId && m.assist.stepId === stepId);
    /** Every question about the step so far (both interviews), with its answer, or null when skipped. */
    const turnsOf = (messages: ChatMessage[]): InterviewTurn[] =>
      messages
        .filter((m) => m.assist?.kind === 'question' && m.assist.status !== 'pending')
        .map((q) => {
          const reply = messages.find((m) => m.assist?.questionId === q.id);
          return { question: q.content, answer: reply?.assist?.kind === 'answer' ? reply.content : null };
        });
    /** Questions asked in the current run of this interview (since it last finished). */
    const askedThisRun = (messages: ChatMessage[], mode: AssistMode) => {
      const own = messages.filter((m) => m.assist?.mode === mode);
      const lastEnd = own.map((m) => m.assist!.kind).lastIndexOf('done');
      const lastBrief = own.map((m) => m.assist!.kind).lastIndexOf('brief');
      return own.slice(Math.max(lastEnd, lastBrief) + 1).filter((m) => m.assist!.kind === 'question').length;
    };
    const label = (graph: WorkflowGraph, stepId: string) => graph.nodes.find((n) => n.id === stepId)?.label ?? 'this step';
    const chatAvailable = (userId: string) => usedToday(db, userId, 'chat', ctx.now()) < config.AI_DAILY_CHAT;
    const timeout = () => Math.min(90, config.AI_TIMEOUT_SECONDS) * 1000;

    /** Write and save the step's brief, and the message that announces it. */
    const finishBrief = async (userId: string, ai: AiProvider, found: Exclude<ReturnType<typeof assistContext>, Fail>, meta: Omit<AssistInfo, 'kind'>) => {
      const { analysis, workflow, assessment } = found;
      const kind = BRIEF_KIND[assessment.classification]!;
      const written = await writeBrief(ai, { graph: workflow.graph, assessment, turns: turnsOf(stepMessages(userId, workflow.id, analysis.id, assessment.stepId)), kind }, timeout());
      return transaction(db, () => {
        const latest = getWorkflow(db, userId, workflow.id);
        if (!latest || needsReassessment(latest.graph, assessment)) return [409, 'conflict', 'This step changed while Flico was writing, so no brief was saved. Reassess it first.'] as Fail;
        saveBrief(db, userId, { analysisId: analysis.id, stepId: assessment.stepId, kind, classification: assessment.classification, summary: written.summary, sections: written.sections, ...basesOf(latest.graph, assessment.stepId)!, revision: latest.revision }, ctx.now());
        recordUsage(db, userId, 'chat', ai.source, written.usage, ctx.now());
        return appendExchange(db, userId, workflow.id, [{ role: 'assistant', content: `Your ${BRIEF_TITLE[kind].toLowerCase()} for “${meta.stepLabel}” is ready. Open it from the step's card in the Action plan.`, source: ai.source, assist: { ...meta, kind: 'brief' } }], ctx.now());
      });
    };

    app.post<IdParams>('/analyses/:id/assist', rateLimit, async (request, reply) => {
      const parsed = assistStartBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', 'Invalid request.');
      const userId = request.user!.id;
      const { stepId, mode } = parsed.data;
      const found = assistContext(userId, request.params.id, stepId, parsed.data.baseRevision);
      if (Array.isArray(found)) return sendError(reply, ...found);
      const { analysis, workflow, assessment } = found;
      if (mode === 'brief' && !BRIEF_KIND[assessment.classification]) {
        return sendError(reply, 409, 'conflict', 'This step needs more information first. Use Clarify, then create its brief.');
      }
      const messages = stepMessages(userId, workflow.id, analysis.id, stepId);
      // An open question is simply shown again: one question at a time.
      const open = messages.find((m) => m.assist?.kind === 'question' && m.assist.status === 'pending');
      if (open) return { messages: [open], analysis } satisfies AssistResponse;
      if (!provider) return notConfigured(reply);
      if (!chatAvailable(userId)) return sendError(reply, 429, 'limit_reached', LIMIT_MESSAGE);
      const meta = { analysisId: analysis.id, stepId, stepLabel: label(workflow.graph, stepId), mode, revision: workflow.revision };
      try {
        const next = await assistQuestion(provider, { graph: workflow.graph, assessment, turns: turnsOf(messages), mode, kind: BRIEF_KIND[assessment.classification] ?? undefined }, timeout());
        if (next.done && mode === 'brief') {
          // Nothing left to ask: write the brief straight away.
          recordUsage(db, userId, 'chat', provider.source, next.usage, ctx.now());
          const written = await finishBrief(userId, provider, found, meta);
          if (typeof written[0] === 'number') return sendError(reply, ...(written as unknown as Fail));
          return { messages: written as ChatMessage[], analysis: getAnalysis(db, userId, analysis.id)! } satisfies AssistResponse;
        }
        const added = transaction(db, () => {
          recordUsage(db, userId, 'chat', provider.source, next.usage, ctx.now());
          return appendExchange(
            db,
            userId,
            workflow.id,
            [
              next.done
                ? { role: 'assistant', content: `Nothing decision-critical is left to ask about “${meta.stepLabel}”.`, source: provider.source, assist: { ...meta, kind: 'done' } }
                : { role: 'assistant', content: next.question, source: provider.source, assist: { ...meta, kind: 'question', status: 'pending', options: next.options } },
            ],
            ctx.now(),
          );
        });
        return { messages: added, analysis } satisfies AssistResponse;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    app.post<IdParams>('/analyses/:id/assist/answer', rateLimit, async (request, reply) => {
      const parsed = assistAnswerBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid answer.');
      const userId = request.user!.id;
      const owned = getAnalysis(db, userId, request.params.id);
      if (!owned) return sendError(reply, 404, 'not_found', 'Analysis not found.');
      const question = getMessage(db, userId, owned.workflowId, parsed.data.messageId);
      if (!question?.assist || question.assist.kind !== 'question' || question.assist.analysisId !== owned.id) return sendError(reply, 404, 'not_found', 'That question no longer exists.');
      if (question.assist.status !== 'pending') return sendError(reply, 409, 'conflict', 'That question was already answered or skipped.');
      const { stepId, mode } = question.assist;
      const found = assistContext(userId, owned.id, stepId, parsed.data.baseRevision);
      if (Array.isArray(found)) return sendError(reply, ...found);
      const { analysis, workflow, assessment } = found;
      if (!provider) return notConfigured(reply);
      if (!chatAvailable(userId)) return sendError(reply, 429, 'limit_reached', LIMIT_MESSAGE);
      const skip = 'skip' in parsed.data;
      const answer = 'answer' in parsed.data ? parsed.data.answer : '';
      const messages = stepMessages(userId, workflow.id, analysis.id, stepId);
      const earlier = turnsOf(messages);
      const meta = { analysisId: analysis.id, stepId, stepLabel: label(workflow.graph, stepId), mode, revision: workflow.revision };
      const runCount = askedThisRun(messages, mode);
      const cap = mode === 'clarify' ? CLARIFY_MAX_QUESTIONS : BRIEF_MAX_QUESTIONS;
      const now = () => new Date(ctx.now()).toISOString();
      try {
        // The model is asked first; nothing is stored unless the whole step succeeds.
        let updated: StepAssessment | null = null;
        let replyText = '';
        let nextQuestion = '';
        let nextOptions: string[] = [];
        let usage = { inputTokens: 0, outputTokens: 0 };
        const turnsAfter = [...earlier, { question: question.content, answer: skip ? null : answer }];
        if (mode === 'clarify' && !skip) {
          const result = await clarifyUpdate(provider, { graph: workflow.graph, assessment, turns: earlier, latest: { question: question.content, answer } }, timeout());
          usage = result.usage;
          replyText = result.reply;
          nextQuestion = runCount < cap ? result.nextQuestion : '';
          nextOptions = nextQuestion ? result.nextOptions : [];
          updated = { ...result.updated, ...basesOf(workflow.graph, stepId)!, revision: workflow.revision, updatedAt: now(), clarified: true };
        } else {
          if (mode === 'clarify') {
            // Skipping never adds certainty: the step stays provisional (or needs information) and the gap is recorded.
            updated = {
              ...assessment,
              provisional: assessment.classification === 'unknown' ? assessment.provisional : true,
              questions: assessment.questions.includes(question.content) ? assessment.questions : [question.content, ...assessment.questions].slice(0, 2),
              updatedAt: now(),
            };
          }
          if (runCount < cap) {
            const next = await assistQuestion(
              provider,
              { graph: workflow.graph, assessment: updated ?? assessment, turns: turnsAfter, mode, kind: BRIEF_KIND[assessment.classification] ?? undefined },
              timeout(),
            );
            usage = next.usage;
            nextQuestion = next.done ? '' : next.question;
            nextOptions = next.done ? [] : next.options;
          }
        }

        const outcome = transaction(db, () => {
          // The workflow may have changed while Flico was thinking: never apply a stale update.
          const latest = getWorkflow(db, userId, workflow.id);
          const current = getAnalysis(db, userId, analysis.id);
          if (!latest || !current?.assessments || getMessage(db, userId, workflow.id, question.id)?.assist?.status !== 'pending') {
            return [409, 'conflict', 'That question was already answered or skipped.'] as Fail;
          }
          if (needsReassessment(latest.graph, assessment)) return [409, 'conflict', 'This step changed while Flico was answering, so nothing was updated. Reassess it first.'] as Fail;
          if (updated) saveAssessments(db, userId, analysis.id, current.assessments.map((a) => (a.stepId === stepId ? updated! : a)));
          setAssistStatus(db, userId, question.id, skip ? 'skipped' : 'answered');
          recordUsage(db, userId, 'chat', provider.source, usage, ctx.now());
          // Mention an outdated brief only when the step has one.
          const changed = updated && updated.classification !== assessment.classification && current.briefs.some((b) => b.stepId === stepId);
          return appendExchange(
            db,
            userId,
            workflow.id,
            [
              skip ? { role: 'user', content: 'Skipped for now', assist: { ...meta, kind: 'skip', questionId: question.id } } : { role: 'user', content: answer, assist: { ...meta, kind: 'answer', questionId: question.id } },
              ...(mode === 'clarify' && !skip
                ? [{ role: 'assistant' as const, content: replyText + (changed ? ' The classification changed, so any earlier brief for this step is out of date.' : ''), source: provider.source, assist: { ...meta, kind: 'update' as const } }]
                : []),
              ...(nextQuestion
                ? [{ role: 'assistant' as const, content: nextQuestion, source: provider.source, assist: { ...meta, kind: 'question' as const, status: 'pending' as const, options: nextOptions } }]
                : mode === 'clarify'
                  ? [{ role: 'assistant' as const, content: `That's all I need for “${meta.stepLabel}” for now.`, source: provider.source, assist: { ...meta, kind: 'done' as const } }]
                  : []),
            ],
            ctx.now(),
          );
        });
        if (Array.isArray(outcome) && typeof outcome[0] === 'number') return sendError(reply, ...(outcome as unknown as Fail));
        let added = outcome as ChatMessage[];
        // The brief interview is over: write the brief.
        if (mode === 'brief' && !nextQuestion) {
          const refreshed = assistContext(userId, analysis.id, stepId, workflow.revision);
          if (Array.isArray(refreshed)) return sendError(reply, ...refreshed);
          const written = await finishBrief(userId, provider, refreshed, meta);
          if (Array.isArray(written) && typeof written[0] === 'number') return sendError(reply, ...(written as unknown as Fail));
          added = [...added, ...(written as ChatMessage[])];
        }
        return { messages: [getMessage(db, userId, workflow.id, question.id)!, ...added], analysis: getAnalysis(db, userId, analysis.id)! } satisfies AssistResponse;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    // Reassess one step against the workflow as it is now (no credit; counts toward the daily Ask Flico limit).
    const reassessBody = z.strictObject({ stepId: z.string().min(1).max(64), baseRevision: z.number().int().positive() });
    app.post<IdParams>('/analyses/:id/reassess', rateLimit, async (request, reply) => {
      const parsed = reassessBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', 'Invalid request.');
      const userId = request.user!.id;
      const { stepId, baseRevision } = parsed.data;
      const analysis = getAnalysis(db, userId, request.params.id);
      if (!analysis) return sendError(reply, 404, 'not_found', 'Analysis not found.');
      const workflow = getWorkflow(db, userId, analysis.workflowId);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (currentAnalysis(db, userId, workflow.id)?.id !== analysis.id) return sendError(reply, 409, 'conflict', 'Only the latest analysis can be reassessed.');
      const assessment = analysis.assessments?.find((a) => a.stepId === stepId);
      if (!assessment) return sendError(reply, 404, 'not_found', 'This step has no automation assessment.');
      if (workflow.revision !== baseRevision) return sendError(reply, 409, 'conflict', "Your latest changes haven't finished saving. Please try again in a moment.");
      const node = workflow.graph.nodes.find((n) => n.id === stepId);
      if (!node) return sendError(reply, 409, 'conflict', 'This step was deleted from the workflow, so it can no longer be assessed.');
      if (!isAssessable(node)) return sendError(reply, 409, 'conflict', 'This step is no longer a work step (Start, Finish or a wait), so it is not assessed.');
      if (!provider) return notConfigured(reply);
      if (!chatAvailable(userId)) return sendError(reply, 429, 'limit_reached', LIMIT_MESSAGE);
      try {
        const turns = turnsOf(stepMessages(userId, workflow.id, analysis.id, stepId));
        const result = await reassessStep(provider, { graph: workflow.graph, assessment, turns }, timeout());
        const outcome = transaction(db, () => {
          // The workflow may have changed while Flico was thinking: never save a reassessment of an older version.
          const latest = getWorkflow(db, userId, workflow.id);
          const current = getAnalysis(db, userId, analysis.id);
          if (!latest || latest.revision !== workflow.revision || !current?.assessments) return [409, 'conflict', 'The workflow changed while Flico was reassessing, so nothing was updated. Please try again.'] as Fail;
          const updated: StepAssessment = { ...result.updated, ...basesOf(latest.graph, stepId)!, revision: latest.revision, updatedAt: new Date(ctx.now()).toISOString(), ...(assessment.clarified ? { clarified: true } : {}) };
          saveAssessments(db, userId, analysis.id, current.assessments.map((a) => (a.stepId === stepId ? updated : a)));
          recordUsage(db, userId, 'chat', provider.source, result.usage, ctx.now());
          return null;
        });
        if (outcome) return sendError(reply, ...outcome);
        const body: AnalysisResponse = { analysis: getAnalysis(db, userId, analysis.id)! };
        return body;
      } catch (error) {
        return fail(request, reply, error);
      }
    });

    app.patch<IdParams>('/analyses/:id/review', async (request, reply) => {
      const parsed = reviewBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', 'Invalid review.');
      const userId = request.user!.id;
      const analysis = getAnalysis(db, userId, request.params.id);
      if (!analysis) return sendError(reply, 404, 'not_found', 'Analysis not found.');
      if (analysis.appliedAt) return sendError(reply, 409, 'conflict', 'These changes were already applied.');
      const known = new Set(analysis.recommendations.map((r) => r.id));
      const statuses = Object.fromEntries(Object.entries(parsed.data.statuses).filter(([id]) => known.has(id))) as Record<string, ReviewStatus>;
      setReview(db, userId, analysis, statuses);
      const body: AnalysisResponse = { analysis: getAnalysis(db, userId, analysis.id)! };
      return body;
    });

    /** Apply the accepted recommendations: owner, revision, conflicts and integrity checked; all or nothing. */
    app.post<IdParams>('/analyses/:id/apply', async (request, reply) => {
      const userId = request.user!.id;
      type Outcome = { error: [number, 'not_found' | 'conflict', string] } | { body: ApplyAnalysisResponse };
      const outcome = transaction(db, (): Outcome => {
        const analysis = getAnalysis(db, userId, request.params.id);
        if (!analysis) return { error: [404, 'not_found', 'Analysis not found.'] };
        const workflow = getWorkflow(db, userId, analysis.workflowId);
        if (!workflow) return { error: [404, 'not_found', NOT_FOUND] };
        if (analysis.appliedAt) return { error: [409, 'conflict', 'These changes were already applied.'] };
        // Moving steps is fine; any change to steps or connections makes the recommendations stale.
        const changed = Object.values(diffGraphs(analysis.snapshot, workflow.graph)).some((ids) => ids.length > 0);
        if (changed) return { error: [409, 'conflict', 'The workflow changed after this analysis, so its changes can’t be applied safely. Run a new analysis.'] };
        const accepted = analysis.recommendations.filter((r) => r.status === 'accepted').map((r) => r.id);
        const plan = planApply(workflow.graph, analysis.recommendations, accepted);
        if (!plan.ok) {
          const reasons = [...plan.conflicts.map((c) => c.message), ...plan.missing.map((m) => m.message), ...plan.problems];
          return { error: [409, 'conflict', `Nothing was applied. ${reasons.join(' ')}`] };
        }
        const checked = validateGraph(placeNewSteps(workflow.graph, plan.graph));
        if (!checked.ok) return { error: [409, 'conflict', 'Nothing was applied: the combined changes would not be a valid workflow.'] };
        const saved = saveGraph(db, userId, workflow.id, checked.graph, workflow.revision, ctx.now());
        if (!saved.ok) return { error: [409, 'conflict', 'The workflow changed while applying. Nothing was applied.'] };
        markApplied(db, userId, analysis.id, ctx.now());
        return { body: { analysis: getAnalysis(db, userId, analysis.id)!, graph: checked.graph, revision: saved.revision, updatedAt: saved.updatedAt } };
      });
      if ('error' in outcome) return sendError(reply, ...outcome.error);
      return outcome.body;
    });
  };
