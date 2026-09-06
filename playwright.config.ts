import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 25000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    channel: process.env.ECHOES_BROWSER_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
