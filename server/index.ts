import { ConfigError, loadConfig, loadDotEnv, type Config } from './config.js';
import { openDatabase } from './db/database.js';
import { runMigrations } from './db/migrations.js';
import { createMailer } from './mail/mailer.js';
import { buildApp } from './app.js';

function readConfig(): Config {
  loadDotEnv();
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n✗ ${error.message}\n\nFix these values in your .env file (see .env.example), then start again.\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const db = openDatabase(config.DATABASE_PATH);
const applied = runMigrations(db);
if (applied.length > 0) console.log(`✓ Applied database migrations: ${applied.join(', ')}`);

const app = await buildApp({ config, db, mailer: createMailer(config) });

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  const err = error as NodeJS.ErrnoException;
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${config.PORT} is already in use. Stop the other process or set PORT in .env.\n`);
  } else {
    console.error(`\n✗ The Flico API could not start: ${err.message}\n`);
  }
  process.exit(1);
}

console.log(`\n  Flico API ready (${config.NODE_ENV}) on http://${config.HOST}:${config.PORT}`);
console.log(`  Open Flico in Chrome or Edge: ${config.APP_URL}`);
if (config.MAIL_TRANSPORT === 'dev-outbox') {
  console.log(`  Sign-in emails are NOT sent in development — open ${config.APP_URL.replace(/\/$/, '')}/dev/outbox`);
}
console.log('');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
