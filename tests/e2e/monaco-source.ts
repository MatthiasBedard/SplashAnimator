import { expect, type Locator } from '@playwright/test';

export function sourceEditor(scope: Locator) {
  return scope.getByRole('textbox', { name: 'Frame source code editor', exact: true });
}

export async function fillSource(editor: Locator, source: string) {
  await editor.press('Control+a');
  if (source) {
    await editor.evaluate((input, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, source);
  } else {
    await editor.press('Backspace');
  }
}

export async function expectSource(editor: Locator, expected: string) {
  if (expected === '') {
    const lines = editor.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " monaco-editor ")][1]').locator('.view-line');
    await expect(lines).toHaveCount(1);
    await expect(lines).toHaveText(/^\s*$/);
    return;
  }
  await expect.poll(async () => {
    await editor.press('Control+a');
    return editor.evaluate(input => {
      const data = new DataTransfer();
      input.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      return data.getData('text/plain').replace(/\r\n/g, '\n');
    });
  }).toBe(expected.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
}
