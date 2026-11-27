import type { Page } from '@playwright/test';

/** Hold worker delivery so tests can inspect the canvas between release and commit. */
export async function holdGeometry(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const queue: ((fail: boolean) => void)[] = [];
    Object.assign(window, {
      releaseGeometry: (fail = false) => queue.splice(0).forEach((run) => run(fail)),
      pendingGeometry: () => queue.length,
    });
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        queue.push((fail) => {
          if (fail)
            this.dispatchEvent(
              new MessageEvent('message', { data: { id: 1, error: 'Simulated merge failure' } }),
            );
          else if (Array.isArray(transfer)) super.postMessage(message, transfer);
          else super.postMessage(message, transfer);
        });
      }
    };
  });
}
export async function pendingGeometry(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { pendingGeometry: () => number }).pendingGeometry(),
  );
}
export async function releaseGeometry(page: Page, fail = false) {
  await page.evaluate(
    (fail) =>
      (window as unknown as { releaseGeometry: (fail: boolean) => void }).releaseGeometry(fail),
    fail,
  );
}
