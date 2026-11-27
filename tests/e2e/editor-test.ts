import { createRequire } from 'node:module';
import type { BrowserContext } from '../../node_modules/@playwright/test/index.js';
export type { Locator, Page } from '../../node_modules/@playwright/test/index.js';

// Resolve the installed runner from inside its own package, past the E2E fixture alias.
const require = createRequire(import.meta.url);
const packageRequire = createRequire(require.resolve('@playwright/test/package.json'));
const { test: base, expect }: typeof import('../../node_modules/@playwright/test/index.js') = packageRequire('@playwright/test');
export { expect };

/** Editor workflows start by clicking the same control a user uses to dismiss the splash. */
export async function openEditorAtStartup(context: BrowserContext) {
  await context.addInitScript(testLicense => {
    if (window !== window.top) return;
    if (testLicense && location.hostname === '127.0.0.1' && ['1420', '1422', '1423'].includes(location.port))
      localStorage.setItem('splash-license-v1', testLicense);
    const openWhenReady = () => {
      const button = document.querySelector('#startup-screen[data-ready]')?.shadowRoot
        ?.querySelector<HTMLButtonElement>('#startup-open');
      if (!button) return;
      observer.disconnect();
      button.click();
    };
    const observer = new MutationObserver(openWhenReady);
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready'] });
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.getElementById('startup-screen')) observer.disconnect();
    }, { once: true });
    openWhenReady();
  }, process.env.SPLASH_TEST_LICENSE);
}

export const test = base.extend<{ keepStartupScreen: boolean }>({
  keepStartupScreen: [false, { option: true }],
  context: async ({ context, keepStartupScreen }, use) => {
    if (!keepStartupScreen) await openEditorAtStartup(context);
    await use(context);
  },
});
