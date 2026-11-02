import type {
  Analysis,
  AnalysesResponse,
  AnalysisQuestion,
  AnalysisQuestionsResponse,
  AnalysisResponse,
  AnalysisRun,
  AnalysisRunResponse,
  ApplyAnalysisResponse,
  AssistAnswerRequest,
  AssistResponse,
  AssistStartRequest,
  CreditsResponse,
  ReviewStatus,
  StartAnalysisRequest,
} from '../../../shared/api';
import { api } from './api';

const workflowPath = (id: string) => `/api/workflows/${encodeURIComponent(id)}`;

export const fetchCredits = () => api<CreditsResponse>('/api/credits');

export async function fetchAnalyses(workflowId: string): Promise<Analysis[]> {
  return (await api<AnalysesResponse>(`${workflowPath(workflowId)}/analyses`)).analyses;
}

export async function fetchQuestions(workflowId: string, baseRevision: number): Promise<AnalysisQuestion[]> {
  return (await api<AnalysisQuestionsResponse>(`${workflowPath(workflowId)}/analysis-questions`, { method: 'POST', body: { baseRevision } })).questions;
}

export async function startAnalysis(workflowId: string, request: StartAnalysisRequest): Promise<AnalysisRun> {
  return (await api<AnalysisRunResponse>(`${workflowPath(workflowId)}/analysis-runs`, { method: 'POST', body: request })).run;
}

export async function fetchRun(runId: string): Promise<AnalysisRun> {
  return (await api<AnalysisRunResponse>(`/api/analysis-runs/${encodeURIComponent(runId)}`)).run;
}

export async function cancelRun(runId: string): Promise<AnalysisRun> {
  return (await api<AnalysisRunResponse>(`/api/analysis-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })).run;
}

export async function saveReview(analysisId: string, statuses: Record<string, ReviewStatus>): Promise<Analysis> {
  return (await api<AnalysisResponse>(`/api/analyses/${encodeURIComponent(analysisId)}/review`, { method: 'PATCH', body: { statuses } })).analysis;
}

export const applyAnalysis = (analysisId: string) => api<ApplyAnalysisResponse>(`/api/analyses/${encodeURIComponent(analysisId)}/apply`, { method: 'POST' });

export const assistStart = (analysisId: string, request: AssistStartRequest) =>
  api<AssistResponse>(`/api/analyses/${encodeURIComponent(analysisId)}/assist`, { method: 'POST', body: request });

export const assistAnswer = (analysisId: string, request: AssistAnswerRequest) =>
  api<AssistResponse>(`/api/analyses/${encodeURIComponent(analysisId)}/assist/answer`, { method: 'POST', body: request });
