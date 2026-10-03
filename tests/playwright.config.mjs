import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.spec.mjs',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  reporter: 'list',
  outputDir: '../test-results',
  use: {
    baseURL: 'http://127.0.0.1:3107',
    ...devices['Pixel 7'],
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
