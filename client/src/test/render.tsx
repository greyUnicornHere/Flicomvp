import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { routes } from '../router';

type MockResponse = { status: number; body?: unknown };

/** Mock fetch by "METHOD path". Unlisted calls fail loudly. */
export function mockApi(handlers: Record<string, MockResponse | ((body: unknown) => MockResponse)>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    const result = typeof handler === 'function' ? handler(body) : handler;
    return new Response(result.status === 204 ? null : JSON.stringify(result.body ?? {}), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

export const anonymous = { status: 401, body: { error: { code: 'unauthenticated', message: 'Please sign in to continue.' } } };
export const signedIn = (email = 'a@example.com') => ({ status: 200, body: { user: { id: 'u1', email } } });

export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  // StrictMode, as in the real app during development, so double-run effect bugs show up in tests.
  render(
    <StrictMode>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </StrictMode>,
  );
  return router;
}
