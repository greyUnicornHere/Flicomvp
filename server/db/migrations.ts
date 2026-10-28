import { transaction, type Db } from './database.js';

export type Migration = { id: number; name: string; sql: string };

/**
 * Ordered, append-only list. Never edit a migration that has shipped; add a new one.
 * Timestamps are stored as integer milliseconds since the Unix epoch.
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: 'auth_foundation',
    sql: `
      CREATE TABLE invitations (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        accepted_at INTEGER,
        revoked_at INTEGER
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_sign_in_at INTEGER
      );

      -- Only a SHA-256 hash of each one-time token is stored.
      CREATE TABLE magic_link_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX idx_magic_link_tokens_email_created ON magic_link_tokens (email, created_at);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions (user_id);

      -- Minimal owned resource so authorization is enforced and tested from day one.
      -- Milestone 1 extends this table (graph, status, revision) with a new migration.
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_workflows_owner_updated ON workflows (owner_id, updated_at);
    `,
  },
  {
    id: 2,
    name: 'workflow_persistence',
    sql: `
      ALTER TABLE workflows ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'analyzed'));
      -- Optimistic locking for autosave: every graph save must name the revision it was based on.
      ALTER TABLE workflows ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE workflows ADD COLUMN graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}';
    `,
  },
  {
    id: 3,
    name: 'ai_assistant',
    sql: `
      -- Assumptions an AI draft made, for the person to confirm or correct (JSON array).
      ALTER TABLE workflows ADD COLUMN assumptions_json TEXT NOT NULL DEFAULT '[]';

      -- One persistent Ask Flico conversation per workflow. Deleted with the workflow.
      CREATE TABLE workflow_chat_messages (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        source TEXT CHECK (source IN ('live', 'fixture')),
        context_json TEXT,
        proposal_json TEXT,
        proposal_status TEXT CHECK (proposal_status IN ('pending', 'applied', 'cancelled', 'expired')),
        base_revision INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_chat_workflow_seq ON workflow_chat_messages (workflow_id, seq);

      -- Counts for daily AI limits. No prompts, workflow text or replies are stored here.
      CREATE TABLE ai_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('draft', 'quick_add', 'chat')),
        day TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('live', 'fixture')),
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_ai_usage_user_day ON ai_usage (user_id, day, kind);
    `,
  },
];

/** Apply all pending migrations, each in its own transaction. Returns the names applied. */
export function runMigrations(db: Db, list: Migration[] = migrations): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((row) => row.id),
  );
  const done: string[] = [];
  for (const migration of [...list].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        Date.now(),
      );
    });
    done.push(`${String(migration.id).padStart(3, '0')}_${migration.name}`);
  }
  return done;
}
