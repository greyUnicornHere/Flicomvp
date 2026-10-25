import type { ApiErrorBody, ApiErrorCode } from '../../../shared/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** JSON fetch against the Flico API. Throws ApiError with a user-readable message on failure. */
export async function api<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network', "Couldn't reach Flico. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    if (error?.code && error.message) throw new ApiError(response.status, error.code, error.message);
    if (response.status >= 500 || response.status === 0) {
      throw new ApiError(response.status, 'server_error', 'Flico is not responding right now. Please try again shortly.');
    }
    throw new ApiError(response.status, 'server_error', 'Something went wrong. Please try again.');
  }
  return data as T;
}
