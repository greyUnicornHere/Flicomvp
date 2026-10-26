import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { migrations, runMigrations } from './migrations.js';

describe('runMigrations', () => {
  it('creates the schema once and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(runMigrations(db)).toEqual(['001_auth_foundation', '002_workflow_persistence']);
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

  it('upgrades a Milestone 0 database without losing existing workflows', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, migrations.filter((m) => m.id === 1));
    db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@example.com', 1)").run();
    db.prepare("INSERT INTO workflows (id, owner_id, name, created_at, updated_at) VALUES ('w1', 'u1', 'Kept', 1, 2)").run();

    expect(runMigrations(db)).toEqual(['002_workflow_persistence']);
    expect(db.prepare('SELECT name, status, revision, graph_json FROM workflows').get()).toEqual({
      name: 'Kept',
      status: 'draft',
      revision: 1,
      graph_json: '{"nodes":[],"edges":[]}',
    });
  });

  it('rejects unknown workflow statuses', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@example.com', 1)").run();
    expect(() =>
      db.prepare("INSERT INTO workflows (id, owner_id, name, status, created_at, updated_at) VALUES ('w', 'u1', 'x', 'running', 1, 1)").run(),
    ).toThrow(/CHECK/);
  });
});
