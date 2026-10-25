import type { User } from '../../shared/api.js';
import { transaction, type Db } from '../db/database.js';
import { generateToken, hashToken, newId, normalizeEmail } from './tokens.js';

type InvitationRow = { id: string; email: string; created_at: number; accepted_at: number | null; revoked_at: number | null };
type TokenRow = { id: string; email: string; expires_at: number; consumed_at: number | null };

// ---------- Invitations (managed only via server-side scripts) ----------

export function findActiveInvitation(db: Db, email: string): InvitationRow | undefined {
  return db
    .prepare('SELECT * FROM invitations WHERE email = ? AND revoked_at IS NULL')
    .get(normalizeEmail(email)) as InvitationRow | undefined;
}

export type InviteResult = 'invited' | 'already_invited' | 'reinstated';

export function inviteEmail(db: Db, email: string, now = Date.now()): InviteResult {
  const normalized = normalizeEmail(email);
  const existing = db.prepare('SELECT * FROM invitations WHERE email = ?').get(normalized) as InvitationRow | undefined;
  if (!existing) {
    db.prepare('INSERT INTO invitations (id, email, created_at) VALUES (?, ?, ?)').run(newId(), normalized, now);
    return 'invited';
  }
  if (existing.revoked_at !== null) {
    db.prepare('UPDATE invitations SET revoked_at = NULL WHERE id = ?').run(existing.id);
    return 'reinstated';
  }
  return 'already_invited';
}

/** Revoke an invitation and end all of that person's sessions and pending links. */
export function revokeInvitation(db: Db, email: string, now = Date.now()): boolean {
  const normalized = normalizeEmail(email);
  return transaction(db, () => {
    const changed = db
      .prepare('UPDATE invitations SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL')
      .run(now, normalized).changes;
    db.prepare('DELETE FROM magic_link_tokens WHERE email = ?').run(normalized);
    db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(normalized);
    return changed > 0;
  });
}

export function listInvitations(db: Db): InvitationRow[] {
  return db.prepare('SELECT * FROM invitations ORDER BY created_at').all() as InvitationRow[];
}

// ---------- Magic links ----------

export function countRecentLinks(db: Db, email: string, since: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM magic_link_tokens WHERE email = ? AND created_at >= ?')
    .get(normalizeEmail(email), since) as { n: number };
  return row.n;
}

/** Create a one-time sign-in token. Returns the raw token (only its hash is stored). */
export function createMagicLink(db: Db, email: string, ttlMs: number, now = Date.now()): string {
  const token = generateToken();
  db.prepare('DELETE FROM magic_link_tokens WHERE expires_at < ?').run(now - 24 * 60 * 60 * 1000);
  db.prepare(
    'INSERT INTO magic_link_tokens (id, token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(newId(), hashToken(token), normalizeEmail(email), now, now + ttlMs);
  return token;
}

export type ConsumeResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'link_invalid' | 'link_expired' | 'link_used' | 'not_invited' };

/** Atomically consume a sign-in token and return (creating if needed) the invited user. */
export function consumeMagicLink(db: Db, token: string, now = Date.now()): ConsumeResult {
  return transaction(db, (): ConsumeResult => {
    const row = db
      .prepare('SELECT id, email, expires_at, consumed_at FROM magic_link_tokens WHERE token_hash = ?')
      .get(hashToken(token)) as TokenRow | undefined;
    if (!row) return { ok: false, reason: 'link_invalid' };
    if (row.consumed_at !== null) return { ok: false, reason: 'link_used' };
    if (row.expires_at <= now) return { ok: false, reason: 'link_expired' };

    const invitation = findActiveInvitation(db, row.email);
    if (!invitation) return { ok: false, reason: 'not_invited' };

    const claimed = db
      .prepare('UPDATE magic_link_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(now, row.id).changes;
    if (claimed !== 1) return { ok: false, reason: 'link_used' };

    let user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(row.email) as User | undefined;
    if (!user) {
      user = { id: newId(), email: row.email };
      db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(user.id, user.email, now);
    }
    db.prepare('UPDATE users SET last_sign_in_at = ? WHERE id = ?').run(now, user.id);
    db.prepare('UPDATE invitations SET accepted_at = COALESCE(accepted_at, ?) WHERE id = ?').run(now, invitation.id);
    return { ok: true, user: { id: user.id, email: user.email } };
  });
}

// ---------- Sessions ----------

export function createSession(db: Db, userId: string, ttlMs: number, now = Date.now()): string {
  const token = generateToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare(
    'INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(newId(), hashToken(token), userId, now, now + ttlMs, now);
  return token;
}

/** Resolve a session token to its user. Expired sessions and revoked invitations are rejected. */
export function getSessionUser(db: Db, token: string, now = Date.now()): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN invitations i ON i.email = u.email AND i.revoked_at IS NULL
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now) as User | undefined;
  return row ? { id: row.id, email: row.email } : null;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
