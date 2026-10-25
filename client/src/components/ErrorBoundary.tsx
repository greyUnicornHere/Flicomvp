import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';

type Props = { children: ReactNode; fallback?: ReactNode };

/** Catches rendering errors anywhere below it and shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Flico UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? <ErrorFallback />;
    return this.props.children;
  }
}
