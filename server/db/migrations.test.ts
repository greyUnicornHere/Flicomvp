import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { runMigrations } from './migrations.js';

describe('runMigrations', () => {
  it('creates the schema once and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(runMigrations(db)).toEqual(['001_auth_foundation']);
    expect(runMigrations(db)).toEqual([]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(
      expect.arrayContaining(['invitations', 'magic_link_tokens', 'schema_migrations', 'sessions', 'users', 'workflows']),
    );
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    expect(() =>
      db.prepare('INSERT INTO workflows (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('w1', 'missing-user', 'x', 1, 1),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rolls back a failing migration completely', () => {
    const db = openDatabase(':memory:');
    const bad = [{ id: 1, name: 'bad', sql: 'CREATE TABLE ok_table (id TEXT); CREATE TABLE broken (' }];
    expect(() => runMigrations(db, bad)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_table'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });
});
