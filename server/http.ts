import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, ApiErrorCode, User } from '../shared/api.js';
import type { Config } from './config.js';
import type { Db } from './db/database.js';
import type { Mailer } from './mail/mailer.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export const SESSION_COOKIE = 'flico_session';

export type AppContext = {
  config: Config;
  db: Db;
  mailer: Mailer;
  /** Injectable clock for tests. */
  now: () => number;
};

export function sendError(reply: FastifyReply, status: number, code: ApiErrorCode, message: string): FastifyReply {
  const body: ApiErrorBody = { error: { code, message } };
  return reply.status(status).send(body);
}

/** preHandler: reject the request unless it carries a valid session. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await sendError(reply, 401, 'unauthenticated', 'Please sign in to continue.');
  }
}
