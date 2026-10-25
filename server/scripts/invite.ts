// Manage pilot invitations (no admin UI by design).
//   npm run invite -- person@example.com          invite (or reinstate) an email address
//   npm run invite -- --revoke person@example.com revoke and sign them out everywhere
//   npm run invite -- --list                      list invitations
import { z } from 'zod';
import { ConfigError, loadConfig, loadDotEnv } from '../config.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { inviteEmail, listInvitations, revokeInvitation } from '../auth/service.js';
import { normalizeEmail } from '../auth/tokens.js';

const usage = `Usage:
  npm run invite -- person@example.com
  npm run invite -- --revoke person@example.com
  npm run invite -- --list`;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

loadDotEnv();
let config;
try {
  config = loadConfig();
} catch (error) {
  fail(error instanceof ConfigError ? error.message : String(error));
}

const args = process.argv.slice(2);
const db = openDatabase(config.DATABASE_PATH);
runMigrations(db);

const date = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' '));
const validEmail = (value: string | undefined) => {
  const parsed = z.email().safeParse(value?.trim());
  if (!parsed.success) fail(`"${value ?? ''}" is not a valid email address.\n\n${usage}`);
  return normalizeEmail(parsed.data);
};

if (args[0] === '--list') {
  const rows = listInvitations(db);
  if (rows.length === 0) console.log('No invitations yet.');
  for (const row of rows) {
    const state = row.revoked_at ? 'revoked' : row.accepted_at ? 'signed in' : 'invited';
    console.log(`${row.email.padEnd(40)} ${state.padEnd(10)} invited ${date(row.created_at)}  first sign-in ${date(row.accepted_at)}`);
  }
} else if (args[0] === '--revoke') {
  const email = validEmail(args[1]);
  console.log(revokeInvitation(db, email) ? `✓ Revoked ${email} and ended their sessions.` : `No active invitation for ${email}.`);
} else if (args.length === 1 && !args[0]!.startsWith('--')) {
  const email = validEmail(args[0]);
  const result = inviteEmail(db, email);
  const messages = {
    invited: `✓ Invited ${email}.`,
    already_invited: `${email} is already invited.`,
    reinstated: `✓ Reinstated the invitation for ${email}.`,
  };
  console.log(messages[result]);
  console.log(`  They can sign in at ${config.APP_URL.replace(/\/$/, '')}/signin`);
} else {
  fail(usage);
}
db.close();
