import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { RequestLinkResponse, SessionResponse } from '../../shared/api.js';
import { SESSION_COOKIE, requireAuth, sendError, type AppContext } from '../http.js';
import {
  consumeMagicLink,
  countRecentLinks,
  createMagicLink,
  createSession,
  deleteSession,
  findActiveInvitation,
} from '../auth/service.js';
import { normalizeEmail } from '../auth/tokens.js';
import { signInEmail } from '../mail/mailer.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
/** Max sign-in links issued per email address per 15 minutes. */
const LINKS_PER_EMAIL = 5;

const requestLinkBody = z.object({ email: z.string().trim().pipe(z.email().max(254)) });
const verifyBody = z.object({ token: z.string().min(20).max(200) });

const linkErrors = {
  link_invalid: "This sign-in link isn't valid. Please request a new one.",
  link_expired: 'This sign-in link has expired. Please request a new one.',
  link_used: 'This sign-in link has already been used. Please request a new one.',
  not_invited: "This email address doesn't have an active Flico invitation.",
} as const;

export const authRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const { config, db, mailer } = ctx;
    const linkTtlMs = config.MAGIC_LINK_TTL_MINUTES * 60 * 1000;
    const sessionTtlMs = config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

    app.post(
      '/request-link',
      { config: { rateLimit: { max: 10, timeWindow: FIFTEEN_MINUTES } } },
      async (request, reply) => {
        const parsed = requestLinkBody.safeParse(request.body);
        if (!parsed.success) return sendError(reply, 400, 'bad_request', 'Please enter a valid email address.');
        const email = normalizeEmail(parsed.data.email);

        // Same response whether or not the address is invited, so invitations can't be discovered.
        const response: RequestLinkResponse = {
          ok: true,
          message: `If ${email} has an invitation, a sign-in link is on its way. It expires in ${config.MAGIC_LINK_TTL_MINUTES} minutes and can be used once.`,
          devOutbox: mailer.kind === 'dev-outbox',
        };

        const now = ctx.now();
        if (!findActiveInvitation(db, email)) return response;
        if (countRecentLinks(db, email, now - FIFTEEN_MINUTES) >= LINKS_PER_EMAIL) return response;

        const token = createMagicLink(db, email, linkTtlMs, now);
        const link = `${config.APP_URL.replace(/\/$/, '')}/auth/verify?token=${encodeURIComponent(token)}`;
        try {
          await mailer.send({ to: email, ...signInEmail(link, config.MAGIC_LINK_TTL_MINUTES) });
        } catch (error) {
          request.log.error({ err: { message: (error as Error).message } }, 'Sign-in email could not be sent');
          return sendError(reply, 502, 'server_error', "We couldn't send the sign-in email. Please try again shortly.");
        }
        return response;
      },
    );

    app.post(
      '/verify',
      { config: { rateLimit: { max: 30, timeWindow: FIFTEEN_MINUTES } } },
      async (request, reply) => {
        const parsed = verifyBody.safeParse(request.body);
        if (!parsed.success) return sendError(reply, 400, 'link_invalid', linkErrors.link_invalid);

        const result = consumeMagicLink(db, parsed.data.token, ctx.now());
        if (!result.ok) return sendError(reply, 400, result.reason, linkErrors[result.reason]);

        const sessionToken = createSession(db, result.user.id, sessionTtlMs, ctx.now());
        reply.setCookie(SESSION_COOKIE, sessionToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.NODE_ENV === 'production',
          path: '/',
          maxAge: sessionTtlMs / 1000,
        });
        const body: SessionResponse = { user: result.user };
        return body;
      },
    );

    app.get('/me', { preHandler: requireAuth }, async (request) => {
      const body: SessionResponse = { user: request.user! };
      return body;
    });

    app.post('/logout', async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) deleteSession(db, token);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    });
  };
