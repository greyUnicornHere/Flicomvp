// Types shared by the API server and the web client.
import type { ProposalOperation } from './aiOps.js';
import type { StepType, WorkflowGraph } from './graph.js';

export type User = { id: string; email: string };

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'link_invalid'
  | 'link_expired'
  | 'link_used'
  | 'not_invited'
  | 'conflict'
  | 'limit_reached'
  | 'unsupported_media_type'
  | 'ai_unavailable'
  | 'ai_not_configured'
  | 'ai_failed'
  | 'server_error';

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: 'flico-api';
  version: string;
  environment: 'development' | 'test' | 'production';
  database: 'ok' | 'error';
  mail: 'dev-outbox' | 'smtp';
  time: string;
};

export type RequestLinkResponse = {
  ok: true;
  message: string;
  /** True only in development when emails go to the local outbox instead of being sent. */
  devOutbox: boolean;
};

export type SessionResponse = { user: User };

export type WorkflowStatus = 'draft' | 'analyzed';

export type WorkflowSummary = {
  id: string;
  name: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
};

/** Something an AI draft assumed rather than read from the description; the person confirms or corrects it. */
export type Assumption = { id: string; text: string; stepIds: string[]; status: 'open' | 'confirmed' };

export type WorkflowDetail = WorkflowSummary & { revision: number; graph: WorkflowGraph; assumptions: Assumption[] };

export type WorkflowListResponse = { workflows: WorkflowSummary[] };
export type WorkflowResponse = { workflow: WorkflowDetail };

/** Autosave contract: send the full graph with the revision it was based on. */
export type SaveGraphRequest = { graph: WorkflowGraph; baseRevision: number };
export type SaveGraphResponse = { revision: number; updatedAt: string };

export const WORKFLOW_NAME_MAX = 120;

// ---------- AI (Milestone 3) ----------

/** live = a real model response; fixture = a deterministic test response (development and tests only). */
export type AiSource = 'live' | 'fixture';

export const AI_DESCRIPTION_MAX = 4000;
export const AI_CHAT_MESSAGE_MAX = 2000;
export const AI_QUICK_ADD_MAX = 300;
export const ASSUMPTION_TEXT_MAX = 300;

export type AiUsageKind = 'draft' | 'quick_add' | 'chat';
export type AiStatusResponse = {
  available: boolean;
  source: AiSource | null;
  limits: Record<AiUsageKind, { limit: number; used: number }>;
};

export type AiDraftRequest = { description: string };
export type AiDraftResponse = {
  workflow: WorkflowDetail;
  source: AiSource;
  /** True when the model's output stayed invalid after one correction and only the valid part was kept. */
  partial: boolean;
};

export type QuickAddRequest = { text: string; previousLabel?: string; nextLabel?: string; finishAllowed: boolean };
export type QuickAddType = Extract<StepType, 'action' | 'decision' | 'approval' | 'wait' | 'finish'>;
export type QuickAddResponse = { step: { type: QuickAddType; label: string }; source: AiSource };

export type ProposalStatus = 'pending' | 'applied' | 'cancelled' | 'expired';
export type Proposal = { summary: string; operations: ProposalOperation[]; status: ProposalStatus; baseRevision: number };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  source?: AiSource;
  /** The step the question was about, if any. */
  context?: { stepId: string; stepLabel: string };
  proposal?: Proposal;
};

export type ChatMode = 'chat' | 'fix';
export type ChatRequest = { content: string; baseRevision: number; mode: ChatMode; stepId?: string };
export type ChatHistoryResponse = { messages: ChatMessage[] };
export type ChatReplyResponse = { messages: ChatMessage[] };
export type ApplyProposalResponse = { message: ChatMessage; revision: number; updatedAt: string; graph: WorkflowGraph };
export type AssumptionsResponse = { assumptions: Assumption[] };

export type DevOutboxMessage = {
  id: string;
  to: string;
  subject: string;
  text: string;
  link: string | null;
  sentAt: string;
};
