import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import type { Db } from './db/database.js';
import type { Mailer } from './mail/mailer.js';
import { getSessionUser } from './auth/service.js';
import { SESSION_COOKIE, sendError, type AppContext } from './http.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { workflowRoutes } from './routes/workflows.js';
import { devRoutes } from './routes/dev.js';
import { aiRoutes } from './routes/ai.js';
import { analysisRoutes } from './routes/analysis.js';
import { createProvider } from './ai/index.js';
import type { AiProvider } from './ai/provider.js';

export type BuildAppOptions = {
  config: Config;
  db: Db;
  mailer: Mailer;
  now?: () => number;
  /** Built web client to serve in production. Defaults to ./dist/client. */
  clientDir?: string;
  /** AI provider override (tests). Defaults to the one configured; null means AI isn't set up. */
  ai?: AiProvider | null;
  /** Send request logs here (tests check that no workflow or chat content is logged). */
  logStream?: { write: (line: string) => void };
};

function allowedOrigins(config: Config): Set<string> {
  const origin = new URL(config.APP_URL).origin;
  const origins = new Set([origin]);
  if (config.NODE_ENV !== 'production') {
    // Treat localhost and 127.0.0.1 as the same machine during development.
    origins.add(origin.replace('//localhost', '//127.0.0.1'));
    origins.add(origin.replace('//127.0.0.1', '//localhost'));
  }
  return origins;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db, mailer } = options;
  const ctx: AppContext = { config, db, mailer, now: options.now ?? Date.now };
  const isProduction = config.NODE_ENV === 'production';

  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    logger:
      config.NODE_ENV === 'test' && !options.logStream
        ? false
        : {
            level: 'info',
            ...(options.logStream ? { stream: options.logStream } : {}),
            // Log method and path only: never query strings, headers, cookies or bodies.
            serializers: {
              req: (req) => ({ method: req.method, path: req.url.split('?')[0] }),
            },
          },
  });

  // Only JSON request bodies are accepted (blocks form-based cross-site posts).
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  await app.register(helmet, {
    hsts: isProduction,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Too many attempts. Please wait ${context.after} and try again.` },
    }),
  });

  // Defence in depth against cross-site requests: state-changing calls must come from the app's origin.
  const origins = allowedOrigins(config);
  app.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      return sendError(reply, 403, 'forbidden', 'This request came from an unexpected origin.');
    }
  });

  // Resolve the session (if any) for every request. Authorization is enforced per route.
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? getSessionUser(db, token, ctx.now()) : null;
  });

  app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; error?: unknown }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status === 429) return sendError(reply, 429, 'rate_limited', (error.error as { message?: string })?.message ?? 'Too many attempts. Please wait and try again.');
    if (status === 415) return sendError(reply, 415, 'unsupported_media_type', 'Requests must be sent as JSON.');
    if (status >= 400 && status < 500) return sendError(reply, status, 'bad_request', 'The request could not be understood.');
    request.log.error({ err: { code: error.code, message: error.message } }, 'Unhandled error');
    return sendError(reply, 500, 'server_error', 'Something went wrong on our side. Please try again.');
  });

  await app.register(healthRoutes(ctx), { prefix: '/api' });
  await app.register(authRoutes(ctx), { prefix: '/api/auth' });
  await app.register(workflowRoutes(ctx), { prefix: '/api/workflows' });
  const provider = options.ai === undefined ? createProvider(config) : options.ai;
  await app.register(aiRoutes(ctx, provider), { prefix: '/api' });
  await app.register(analysisRoutes(ctx, provider), { prefix: '/api' });
  if (!isProduction && mailer.kind === 'dev-outbox') {
    await app.register(devRoutes(ctx), { prefix: '/api/dev' });
  }

  // In production the API also serves the built web app (single origin, no CORS).
  const clientDir = options.clientDir ?? resolve(process.cwd(), 'dist/client');
  const serveClient = isProduction && existsSync(resolve(clientDir, 'index.html'));
  if (serveClient) {
    await app.register(fastifyStatic, { root: clientDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (serveClient && request.method === 'GET' && !path.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return sendError(reply, 404, 'not_found', 'Not found.');
  });

  return app;
}
