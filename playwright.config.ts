import { defineConfig, devices } from '@playwright/test';

/**
 * TR-08. One seeded database, shared, so the tests run one at a time and use different seats.
 * Playwright starts the API and the web app if they aren't running (in CI they never are).
 * Locally, PW_CHANNEL=chrome uses the installed Chrome instead of downloading Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  globalSetup: './e2e/global-setup.ts', // npm run seed -- --reset
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...(process.env.PW_CHANNEL && { channel: process.env.PW_CHANNEL }),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w @seatbook/api',
      url: 'http://localhost:4000/ready',
      env: { RATE_LIMITS: 'off' }, // every test logs in; the sign-in limits would trip
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w @seatbook/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
