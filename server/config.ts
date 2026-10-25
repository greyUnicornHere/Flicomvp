import { existsSync } from 'node:fs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

/** Empty strings in .env mean "not set". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_URL: z.url({ message: 'APP_URL must be a full URL such as http://localhost:5173' }).default('http://localhost:5173'),
    DATABASE_PATH: z.string().min(1).default('./data/flico.db'),
    MAIL_TRANSPORT: z.enum(['dev-outbox', 'smtp']).default('dev-outbox'),
    MAIL_FROM: optionalString,
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanString,
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
    TRUST_PROXY: booleanString,
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'smtp') {
      if (!env.SMTP_HOST) ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'is required when MAIL_TRANSPORT=smtp' });
      if (!env.MAIL_FROM) ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'is required when MAIL_TRANSPORT=smtp' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.MAIL_TRANSPORT === 'dev-outbox') {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_TRANSPORT'],
          message: 'dev-outbox is not allowed in production (it would expose sign-in links). Set MAIL_TRANSPORT=smtp.',
        });
      }
      if (!env.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must use https:// in production' });
      }
    }
  });

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Flico configuration is invalid:\n${problems.map((p) => `  • ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Parse and validate configuration. Throws ConfigError with readable messages; never echoes secret values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production' && !env.APP_URL) {
    problems.push('APP_URL is required in production');
  }
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join('.') || 'config'} ${issue.message}`);
    }
  }
  if (problems.length > 0 || !parsed.success) throw new ConfigError(problems);
  return parsed.data;
}

/** Load .env from the working directory into process.env (existing variables win). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
