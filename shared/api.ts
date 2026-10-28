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
  | 'no_credits'
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

// ---------- Analysis (Milestone 4) ----------

export type RecommendationCategory = 'quick_win' | 'strategic' | 'complex';
export type Level = 'low' | 'medium' | 'high';
/** Evidence labels (spec §11): supported by the workflow, based on assumptions, or requires verification. */
export type Evidence = 'supported' | 'assumption' | 'verify';
export type ReviewStatus = 'pending' | 'accepted' | 'rejected';

export type Recommendation = {
  id: string;
  title: string;
  problem: string;
  proposal: string;
  reason: string;
  category: RecommendationCategory;
  impact: Level;
  effort: Level;
  evidence: Evidence;
  benefits: string;
  risks: string;
  assumptions: string;
  verification: string;
  /** Other recommendations this one relies on. */
  dependsOn: string[];
  operations: ProposalOperation[];
  status: ReviewStatus;
};

export type AnalysisMode = 'quick' | 'guided';
export type AnalysisSlot = 'initial' | 'latest';

export type Analysis = {
  id: string;
  workflowId: string;
  slot: AnalysisSlot;
  mode: AnalysisMode;
  source: AiSource;
  /** Workflow revision and graph the analysis was made from (the preserved original). */
  baseRevision: number;
  snapshot: WorkflowGraph;
  headline: string;
  summary: string;
  outcome: 'improvements' | 'no_improvements';
  assumptions: string[];
  answers: { question: string; answer: string }[];
  recommendations: Recommendation[];
  createdAt: string;
  appliedAt: string | null;
};

export type AnalysisQuestion = { id: string; question: string; hint: string };
export type AnalysisQuestionsResponse = { questions: AnalysisQuestion[]; source: AiSource };

export type AnalysisRunStage = 'checking' | 'reviewing' | 'validating' | 'saving';
export type AnalysisRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AnalysisRun = {
  id: string;
  workflowId: string;
  status: AnalysisRunStatus;
  stage: AnalysisRunStage;
  error: string | null;
  analysisId: string | null;
};
export type StartAnalysisRequest = {
  mode: AnalysisMode;
  baseRevision: number;
  /** Client-generated per attempt: retrying the same request never charges twice. */
  idempotencyKey: string;
  answers?: { questionId: string; question: string; answer: string }[];
};
export type AnalysisRunResponse = { run: AnalysisRun };
export type AnalysesResponse = { analyses: Analysis[] };
export type AnalysisResponse = { analysis: Analysis };
export type CreditsResponse = { balance: number; initial: number };
export type ApplyAnalysisResponse = { analysis: Analysis; graph: WorkflowGraph; revision: number; updatedAt: string };
export const ANALYSIS_ANSWER_MAX = 500;

export type DevOutboxMessage = {
  id: string;
  to: string;
  subject: string;
  text: string;
  link: string | null;
  sentAt: string;
};
