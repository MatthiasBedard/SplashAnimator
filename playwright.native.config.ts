import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/native',
  workers: 1,
  timeout: 120_000,
  use: { actionTimeout: 15_000 },
});
