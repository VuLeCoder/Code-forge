import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test-fullstack',
  globalSetup: './test-fullstack/setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  use: { baseURL: 'http://localhost:3112', browserName: 'chromium', trace: 'off', screenshot: 'off', video: 'off' },
});
