import type {
  AiDraftResponse,
  AiStatusResponse,
  ApplyProposalResponse,
  Assumption,
  AssumptionsResponse,
  ChatHistoryResponse,
  ChatMessage,
  ChatMode,
  ChatReplyResponse,
  QuickAddRequest,
  QuickAddResponse,
} from '../../../shared/api';
import { api } from './api';

const workflowPath = (id: string) => `/api/workflows/${encodeURIComponent(id)}`;

export const fetchAiStatus = () => api<AiStatusResponse>('/api/ai/status');

export const createAiDraft = (description: string) =>
  api<AiDraftResponse>('/api/workflows/ai-draft', { method: 'POST', body: { description } });

export const quickAddStep = (workflowId: string, request: QuickAddRequest) =>
  api<QuickAddResponse>(`${workflowPath(workflowId)}/quick-add`, { method: 'POST', body: request });

export async function fetchChat(workflowId: string): Promise<ChatMessage[]> {
  return (await api<ChatHistoryResponse>(`${workflowPath(workflowId)}/chat`)).messages;
}

export async function sendChatMessage(
  workflowId: string,
  body: { content: string; baseRevision: number; mode: ChatMode; stepId?: string },
): Promise<ChatMessage[]> {
  return (await api<ChatReplyResponse>(`${workflowPath(workflowId)}/chat`, { method: 'POST', body })).messages;
}

export const clearChat = (workflowId: string) => api<void>(`${workflowPath(workflowId)}/chat`, { method: 'DELETE' });

export const applyProposal = (workflowId: string, messageId: string) =>
  api<ApplyProposalResponse>(`${workflowPath(workflowId)}/chat/${encodeURIComponent(messageId)}/apply`, { method: 'POST' });

export async function cancelProposal(workflowId: string, messageId: string): Promise<ChatMessage> {
  return (await api<{ message: ChatMessage }>(`${workflowPath(workflowId)}/chat/${encodeURIComponent(messageId)}/cancel`, { method: 'POST' })).message;
}

export async function updateAssumption(workflowId: string, id: string, change: { text?: string; status?: Assumption['status'] }): Promise<Assumption[]> {
  const path = `${workflowPath(workflowId)}/assumptions/${encodeURIComponent(id)}`;
  return (await api<AssumptionsResponse>(path, { method: 'PATCH', body: change })).assumptions;
}

export async function removeAssumption(workflowId: string, id: string): Promise<Assumption[]> {
  const path = `${workflowPath(workflowId)}/assumptions/${encodeURIComponent(id)}`;
  return (await api<AssumptionsResponse>(path, { method: 'DELETE' })).assumptions;
}
