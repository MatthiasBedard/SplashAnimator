import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'production.spec.ts',
  use: { baseURL: 'http://127.0.0.1:1420', viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    env: { SPLASH_PROJECTS: process.env.SPLASH_PROJECTS || '.e2e-projects' },
  },
});
