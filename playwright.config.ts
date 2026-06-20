import { defineConfig } from '@playwright/test';
import { FIXTURE_REPO } from './tests/e2e/fixture.js';

const PORT = 5188;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * E2E config (Criterion 4: tested with Playwright).
 * Boots the ShipScribe web server in OFFLINE mock mode, pointed at a disposable
 * git fixture (SHIPSCRIBE_REPO), and drives the real browser UI.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx tsx src/server.ts',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      SHIPSCRIBE_OFFLINE: '1',
      PORT: String(PORT),
      SHIPSCRIBE_REPO: FIXTURE_REPO,
    },
  },
});
