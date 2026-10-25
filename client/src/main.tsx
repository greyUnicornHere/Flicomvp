import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import '@fontsource-variable/inter';
import './styles/app.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './lib/auth';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
