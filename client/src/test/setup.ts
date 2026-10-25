import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks matchMedia; default to a desktop-width viewport.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
