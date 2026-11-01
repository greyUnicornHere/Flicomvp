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
import { assessmentBasis } from '../../shared/assessment.js';
import { diffGraphs } from '../../shared/aiOps.js';
import type { WorkflowGraph } from '../../shared/graph.js';
import { planApply } from '../../shared/analysis.js';
import { placeNewSteps } from '../../shared/layout.js';
import { preAnalysisCheck } from '../../shared/validation.js';
import { transaction } from '../db/database.js';
import { requireAuth, sendError, type AppContext } from '../http.js';
import { AI_ERROR_MESSAGES, AiError, type AiProvider } from '../ai/provider.js';
import { AiOutputError, analyzeWorkflow, suggestQuestions } from '../ai/service.js';
import { recordUsage, usedToday } from '../ai/store.js';
import { validateGraph } from '../workflows/graph.js';
import { getWorkflow, saveGraph } from '../workflows/service.js';
import {
  creditBalance,
  debitForRun,
  ensureInitialGrant,
  failInterruptedRuns,
  findRunByKey,
  finishRun,
  getAnalysis,
  getRun,
  listAnalyses,
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
          const assessments = drafts.map((a) => ({ ...a, basis: assessmentBasis(job.graph, a.stepId)!, revision: job.revision, updatedAt: assessedAt }));
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
