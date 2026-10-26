import { defineConfig, devices } from '@playwright/test';

// E2E runs the real dev servers on separate ports against a throwaway database.
export const E2E = {
  apiPort: 3101,
  webPort: 5273,
  appUrl: 'http://localhost:5273',
  dbPath: 'tests/e2e/.tmp/e2e.db',
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: E2E.appUrl,
    viewport: { width: 1536, height: 960 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 960 } } },
    // Microsoft Edge (channel "msedge") can be added where Edge is installed.
  ],
  webServer: {
    command: 'node tests/e2e/start-servers.mjs',
    url: `${E2E.appUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(E2E.apiPort),
      WEB_PORT: String(E2E.webPort),
      APP_URL: E2E.appUrl,
      DATABASE_PATH: E2E.dbPath,
      MAIL_TRANSPORT: 'dev-outbox',
      // Every E2E test signs in from the same machine; the default limit (10) is covered by unit tests.
      AUTH_RATE_LIMIT: '200',
    },
  },
});
