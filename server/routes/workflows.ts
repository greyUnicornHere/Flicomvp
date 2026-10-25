import type { FastifyPluginAsync } from 'fastify';
import type { WorkflowSummary } from '../../shared/api.js';
import { requireAuth, sendError, type AppContext } from '../http.js';

type WorkflowRow = { id: string; name: string; created_at: number; updated_at: number };

/**
 * Milestone 0: read-only access to a single owned workflow, so ownership checks exist and are tested
 * before any workflow features are built. Milestone 1 adds create/list/rename/delete.
 */
export const workflowRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.addHook('preHandler', requireAuth);

    app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
      const row = ctx.db
        .prepare('SELECT id, name, created_at, updated_at FROM workflows WHERE id = ? AND owner_id = ?')
        .get(request.params.id, request.user!.id) as WorkflowRow | undefined;
      // Another user's workflow is indistinguishable from one that doesn't exist.
      if (!row) return sendError(reply, 404, 'not_found', 'Workflow not found.');
      const workflow: WorkflowSummary = {
        id: row.id,
        name: row.name,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      return { workflow };
    });
  };
