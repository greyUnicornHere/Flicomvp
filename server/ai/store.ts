// Persistence for Ask Flico conversations and daily AI usage counts. Every query is scoped by owner.
import type { AiSource, AiUsageKind, AssistInfo, ChatMessage, Proposal, ProposalStatus } from '../../shared/api.js';
import type { ProposalOperation } from '../../shared/aiOps.js';
import type { Db } from '../db/database.js';
import { newId } from '../auth/tokens.js';
import type { Usage } from './service.js';

/** Oldest messages beyond this are dropped so one conversation can't grow without bound. */
export const MAX_CHAT_MESSAGES = 400;

type ChatRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: AiSource | null;
  context_json: string | null;
  proposal_json: string | null;
  proposal_status: ProposalStatus | null;
  base_revision: number | null;
  assist_json: string | null;
  created_at: number;
};

const toMessage = (row: ChatRow): ChatMessage => {
  const message: ChatMessage = { id: row.id, role: row.role, content: row.content, createdAt: new Date(row.created_at).toISOString() };
  if (row.source) message.source = row.source;
  if (row.context_json) message.context = JSON.parse(row.context_json) as ChatMessage['context'];
  if (row.assist_json) message.assist = JSON.parse(row.assist_json) as AssistInfo;
  if (row.proposal_json && row.proposal_status && row.base_revision !== null) {
    const stored = JSON.parse(row.proposal_json) as { summary: string; operations: ProposalOperation[] };
    message.proposal = { ...stored, status: row.proposal_status, baseRevision: row.base_revision };
  }
  return message;
};

export function listMessages(db: Db, ownerId: string, workflowId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT * FROM workflow_chat_messages WHERE workflow_id = ? AND owner_id = ? ORDER BY seq')
    .all(workflowId, ownerId) as ChatRow[];
  return rows.map(toMessage);
}

export function getMessage(db: Db, ownerId: string, workflowId: string, id: string): ChatMessage | null {
  const row = db
    .prepare('SELECT * FROM workflow_chat_messages WHERE id = ? AND workflow_id = ? AND owner_id = ?')
    .get(id, workflowId, ownerId) as ChatRow | undefined;
  return row ? toMessage(row) : null;
}

type NewMessage = {
  role: 'user' | 'assistant';
  content: string;
  source?: AiSource;
  context?: ChatMessage['context'];
  proposal?: Omit<Proposal, 'status'>;
  assist?: AssistInfo;
};

/** Store a question and its answer together, so the conversation always alternates. */
export function appendExchange(db: Db, ownerId: string, workflowId: string, messages: NewMessage[], now: number): ChatMessage[] {
  const { seq } = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM workflow_chat_messages WHERE workflow_id = ?').get(workflowId) as { seq: number };
  const insert = db.prepare(
    `INSERT INTO workflow_chat_messages
       (id, workflow_id, owner_id, seq, role, content, source, context_json, proposal_json, proposal_status, base_revision, assist_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids = messages.map((m, i) => {
    const id = newId();
    const proposal = m.proposal ? JSON.stringify({ summary: m.proposal.summary, operations: m.proposal.operations }) : null;
    insert.run(
      id,
      workflowId,
      ownerId,
      seq + i + 1,
      m.role,
      m.content,
      m.source ?? null,
      m.context ? JSON.stringify(m.context) : null,
      proposal,
      m.proposal ? 'pending' : null,
      m.proposal ? m.proposal.baseRevision : null,
      m.assist ? JSON.stringify(m.assist) : null,
      now,
    );
    return id;
  });
  db.prepare(
    `DELETE FROM workflow_chat_messages WHERE workflow_id = ? AND seq <= (
       SELECT MAX(seq) FROM workflow_chat_messages WHERE workflow_id = ?) - ?`,
  ).run(workflowId, workflowId, MAX_CHAT_MESSAGES);
  return ids.map((id) => getMessage(db, ownerId, workflowId, id)!);
}

export function clearChat(db: Db, ownerId: string, workflowId: string): void {
  db.prepare('DELETE FROM workflow_chat_messages WHERE workflow_id = ? AND owner_id = ?').run(workflowId, ownerId);
}

export function setProposalStatus(db: Db, ownerId: string, id: string, status: ProposalStatus): void {
  db.prepare('UPDATE workflow_chat_messages SET proposal_status = ? WHERE id = ? AND owner_id = ? AND proposal_json IS NOT NULL').run(status, id, ownerId);
}

// ---------- daily usage ----------

export const usageDay = (now: number) => new Date(now).toISOString().slice(0, 10);

export function usedToday(db: Db, userId: string, kind: AiUsageKind, now: number): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND kind = ? AND day = ?').get(userId, kind, usageDay(now)) as { n: number }
  ).n;
}

/** Record one completed AI request (counts and token totals only; never content). */
export function recordUsage(db: Db, userId: string, kind: AiUsageKind, source: AiSource, usage: Usage, now: number): void {
  db.prepare(
    'INSERT INTO ai_usage (id, user_id, kind, day, source, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(newId(), userId, kind, usageDay(now), source, usage.inputTokens, usage.outputTokens, now);
}

/** Mark an interview question answered or skipped. */
export function setAssistStatus(db: Db, ownerId: string, id: string, status: NonNullable<AssistInfo['status']>): void {
  const row = db.prepare('SELECT assist_json FROM workflow_chat_messages WHERE id = ? AND owner_id = ?').get(id, ownerId) as { assist_json: string | null } | undefined;
  if (!row?.assist_json) return;
  const assist = { ...(JSON.parse(row.assist_json) as AssistInfo), status };
  db.prepare('UPDATE workflow_chat_messages SET assist_json = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(assist), id, ownerId);
}
