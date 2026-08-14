import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /semantic-workbench\.spec\.mjs/,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: 'test-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
