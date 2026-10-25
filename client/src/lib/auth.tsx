import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionResponse, User } from '../../../shared/api';
import { ApiError, api } from './api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous'; user: null; signedOut?: boolean }
  | { status: 'error'; user: null; message: string };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  setSignedIn: (user: User) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchSession(): Promise<AuthState> {
  try {
    const { user } = await api<SessionResponse>('/api/auth/me');
    return { status: 'authenticated', user };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { status: 'anonymous', user: null };
    return { status: 'error', user: null, message: (error as Error).message };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const refresh = useCallback(async () => setState(await fetchSession()), []);

  useEffect(() => {
    let active = true;
    void fetchSession().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, []);

  const setSignedIn = useCallback((user: User) => setState({ status: 'authenticated', user }), []);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setState({ status: 'anonymous', user: null, signedOut: true });
  }, []);

  const value = useMemo(() => ({ ...state, refresh, setSignedIn, signOut }), [state, refresh, setSignedIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
