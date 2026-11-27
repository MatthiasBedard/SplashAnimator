import { expect, type Page } from '@playwright/test';

const engineUrl = /quickjs-frame-worker(?:[-.])/;

export async function withPendingScriptEngine(
  page: Page,
  start: () => Promise<void>,
  whilePending: () => Promise<void>,
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route(engineUrl, async (route) => {
    requested = true;
    await gate;
    await route.continue().catch(() => {});
  }, { times: 1 });
  try {
    await start();
    await expect.poll(() => requested).toBe(true);
    await whilePending();
  } finally {
    release();
  }
}
