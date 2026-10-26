import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  WORKFLOW_NAME_MAX,
  type SaveGraphResponse,
  type WorkflowListResponse,
  type WorkflowResponse,
} from '../../shared/api.js';
import { requireAuth, sendError, type AppContext } from '../http.js';
import { validateGraph } from '../workflows/graph.js';
import {
  MAX_WORKFLOWS_PER_USER,
  countWorkflows,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  renameWorkflow,
  saveGraph,
  startOnlyGraph,
} from '../workflows/service.js';

const nameSchema = z.string().trim().min(1, 'Please enter a name.').max(WORKFLOW_NAME_MAX, `Names can be up to ${WORKFLOW_NAME_MAX} characters.`);
const createBody = z.strictObject({ kind: z.literal('manual') });
const renameBody = z.strictObject({ name: nameSchema });
const saveBody = z.strictObject({ graph: z.unknown(), baseRevision: z.number().int().positive() });

type IdParams = { Params: { id: string } };
const NOT_FOUND = 'Workflow not found.';

export const workflowRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const { db } = ctx;
    app.addHook('preHandler', requireAuth);

    app.get('/', async (request) => {
      const body: WorkflowListResponse = { workflows: listWorkflows(db, request.user!.id) };
      return body;
    });

    app.post('/', async (request, reply) => {
      if (!createBody.safeParse(request.body).success) {
        return sendError(reply, 400, 'bad_request', 'Unsupported way to create a workflow.');
      }
      const ownerId = request.user!.id;
      if (countWorkflows(db, ownerId) >= MAX_WORKFLOWS_PER_USER) {
        return sendError(reply, 409, 'limit_reached', `You can keep up to ${MAX_WORKFLOWS_PER_USER} workflows. Delete one to create another.`);
      }
      const workflow = createWorkflow(db, ownerId, 'Untitled workflow', startOnlyGraph(), ctx.now());
      const body: WorkflowResponse = { workflow };
      return reply.status(201).send(body);
    });

    app.get<IdParams>('/:id', async (request, reply) => {
      const workflow = getWorkflow(db, request.user!.id, request.params.id);
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      const body: WorkflowResponse = { workflow };
      return body;
    });

    app.patch<IdParams>('/:id', async (request, reply) => {
      const parsed = renameBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', parsed.error.issues[0]?.message ?? 'Invalid name.');
      const workflow = renameWorkflow(db, request.user!.id, request.params.id, parsed.data.name, ctx.now());
      if (!workflow) return sendError(reply, 404, 'not_found', NOT_FOUND);
      return { workflow };
    });

    app.delete<IdParams>('/:id', async (request, reply) => {
      if (!deleteWorkflow(db, request.user!.id, request.params.id)) return sendError(reply, 404, 'not_found', NOT_FOUND);
      return reply.status(204).send();
    });

    // Autosave storage contract for the editor (Milestone 2 wires the UI to it).
    app.put<IdParams>('/:id/graph', async (request, reply) => {
      const parsed = saveBody.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'bad_request', 'The workflow could not be saved: invalid request.');
      const graph = validateGraph(parsed.data.graph);
      if (!graph.ok) {
        return sendError(reply, 400, 'bad_request', `The workflow could not be saved: ${graph.problems.join('; ')}`);
      }
      const result = saveGraph(db, request.user!.id, request.params.id, graph.graph, parsed.data.baseRevision, ctx.now());
      if (!result.ok && result.reason === 'not_found') return sendError(reply, 404, 'not_found', NOT_FOUND);
      if (!result.ok) {
        return sendError(reply, 409, 'conflict', 'This workflow was changed elsewhere. Reload to get the latest version.');
      }
      const body: SaveGraphResponse = { revision: result.revision, updatedAt: result.updatedAt };
      return body;
    });
  };
