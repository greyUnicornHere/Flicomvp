import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '../../shared/api.js';
import type { AppContext } from '../http.js';

const version = process.env.npm_package_version ?? '0.1.0';

/** Public, non-sensitive status endpoint. Never includes secrets or user data. */
export const healthRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.get('/health', async (_request, reply) => {
      let database: HealthResponse['database'] = 'ok';
      try {
        ctx.db.prepare('SELECT 1').get();
      } catch {
        database = 'error';
      }
      const body: HealthResponse = {
        status: database === 'ok' ? 'ok' : 'degraded',
        service: 'flico-api',
        version,
        environment: ctx.config.NODE_ENV,
        database,
        mail: ctx.mailer.kind,
        time: new Date(ctx.now()).toISOString(),
      };
      return reply.status(database === 'ok' ? 200 : 503).send(body);
    });
  };
