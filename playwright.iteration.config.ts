import { defineConfig } from '@playwright/test';

// Focused authoring feedback without rebundling Monaco/the production runtime.
// This server owns neither the user's dev 1420 nor production-test 1422.
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'production.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:1423', viewport: { width: 1440, height: 1000 } },
  webServer: {
    command:
      'pnpm exec vite --config apps/editor/vite.config.ts --host 127.0.0.1 --port 1423 --strictPort',
    url: 'http://127.0.0.1:1423',
    reuseExistingServer: false,
    env: { SPLASH_PROJECTS: '.e2e-projects' },
  },
});
