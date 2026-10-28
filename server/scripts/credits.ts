// Manage pilot analysis credits (no admin UI by design).
//   npm run credits -- person@example.com          show balance and history
//   npm run credits -- person@example.com 5        add 5 credits (top-up)
//   npm run credits -- person@example.com -2 "reason"  remove credits (adjustment)
import { z } from 'zod';
import { ConfigError, loadConfig, loadDotEnv } from '../config.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';
import { normalizeEmail } from '../auth/tokens.js';
import { creditBalance, ensureInitialGrant, topUp } from '../analysis/store.js';

const usage = `Usage:
  npm run credits -- person@example.com             show balance and history
  npm run credits -- person@example.com 5           add 5 credits
  npm run credits -- person@example.com -2 "note"   remove 2 credits`;

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

const [emailArg, amountArg, ...noteParts] = process.argv.slice(2);
const parsedEmail = z.email().safeParse(emailArg?.trim());
if (!parsedEmail.success) fail(`Please give the person's email address.\n\n${usage}`);
const email = normalizeEmail(parsedEmail.data);

const db = openDatabase(config.DATABASE_PATH);
runMigrations(db);
const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
if (!user) fail(`${email} hasn't signed in yet. Credits can be added after their first sign-in.`);
ensureInitialGrant(db, user.id, config.ANALYSIS_INITIAL_CREDITS, Date.now());

if (amountArg !== undefined) {
  const amount = Number(amountArg);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000) fail(`"${amountArg}" isn't a whole number between -1000 and 1000.\n\n${usage}`);
  if (creditBalance(db, user.id) + amount < 0) fail(`That would leave ${email} with fewer than 0 credits.`);
  topUp(db, user.id, amount, noteParts.join(' ').slice(0, 200) || (amount > 0 ? 'Manual top-up' : 'Manual adjustment'), Date.now());
  console.log(`✓ ${amount > 0 ? 'Added' : 'Removed'} ${Math.abs(amount)} credit${Math.abs(amount) === 1 ? '' : 's'}.`);
}

const rows = db.prepare('SELECT delta, reason, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at, rowid').all(user.id) as {
  delta: number;
  reason: string;
  note: string | null;
  created_at: number;
}[];
console.log(`${email}: ${creditBalance(db, user.id)} credit(s) left`);
for (const row of rows) {
  console.log(`  ${new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ')}  ${String(row.delta).padStart(4)}  ${row.reason}${row.note ? `  (${row.note})` : ''}`);
}
db.close();
