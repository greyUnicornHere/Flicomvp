// Types shared by the API server and the web client.

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
  | 'unsupported_media_type'
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

export type WorkflowSummary = { id: string; name: string; createdAt: string; updatedAt: string };

export type DevOutboxMessage = {
  id: string;
  to: string;
  subject: string;
  text: string;
  link: string | null;
  sentAt: string;
};
