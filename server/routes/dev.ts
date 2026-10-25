import type { FastifyPluginAsync } from 'fastify';
import { sendError, type AppContext } from '../http.js';
import { DevOutbox } from '../mail/mailer.js';

/** Development-only routes. Never registered when NODE_ENV=production. */
export const devRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.get('/outbox', async (_request, reply) => {
      if (ctx.config.NODE_ENV === 'production' || !(ctx.mailer instanceof DevOutbox)) {
        return sendError(reply, 404, 'not_found', 'Not found.');
      }
      return { messages: ctx.mailer.list() };
    });
  };
