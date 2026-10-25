// Apply pending database migrations: npm run db:migrate
import { ConfigError, loadConfig, loadDotEnv } from '../config.js';
import { openDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrations.js';

loadDotEnv();
try {
  const config = loadConfig();
  const db = openDatabase(config.DATABASE_PATH);
  const applied = runMigrations(db);
  db.close();
  console.log(
    applied.length > 0
      ? `✓ Applied migrations: ${applied.join(', ')} (${config.DATABASE_PATH})`
      : `✓ Database is up to date (${config.DATABASE_PATH})`,
  );
} catch (error) {
  console.error(error instanceof ConfigError ? `✗ ${error.message}` : error);
  process.exit(1);
}
