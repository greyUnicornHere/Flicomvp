import { createBrowserRouter, type RouteObject } from 'react-router';
import { ErrorFallback } from './components/ErrorFallback';
import { RequireAuth } from './components/RequireAuth';
import { RootLayout } from './components/RootLayout';
import { CreateWithAiPage } from './pages/CreateWithAiPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SignInPage } from './pages/SignInPage';
import { StatusPage } from './pages/StatusPage';
import { VerifyPage } from './pages/VerifyPage';

// The outbox route exists only in development builds; production bundles don't contain it.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: '/dev/outbox', lazy: async () => ({ Component: (await import('./pages/DevOutboxPage')).DevOutboxPage }) }]
  : [];

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <ErrorFallback />,
    children: [
      { path: '/signin', element: <SignInPage /> },
      { path: '/auth/verify', element: <VerifyPage /> },
      { path: '/status', element: <StatusPage /> },
      ...devRoutes,
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/create/ai', element: <CreateWithAiPage /> },
          // The editor (and its diagram library) loads only when a workflow is opened.
          { path: '/workflows/:id', lazy: async () => ({ Component: (await import('./editor/EditorPage')).EditorPage }) },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
