import { tick } from 'svelte';

export function showFocusedDialog(
  dialog: HTMLDialogElement,
  initial: string | { selector: string; scroll: boolean } = 'header button',
) {
  let mounted = true;
  // Wait for any preceding dialog to leave the top layer.
  void tick().then(() => {
    if (mounted && dialog.isConnected) {
      dialog.showModal();
      const selector = typeof initial === 'string' ? initial : initial.selector;
      dialog.querySelector<HTMLElement>(selector)?.focus({
        preventScroll: typeof initial === 'string' || !initial.scroll,
      });
    }
  });
  return { destroy() { mounted = false; if (dialog.open) dialog.close(); } };
}

export async function focusDialogFooter(dialog?: HTMLDialogElement | null) {
  await tick();
  if (!dialog?.open || !dialog.isConnected) return;
  const current = document.activeElement;
  if (current && current !== dialog && dialog.contains(current) && !current.matches(':disabled')) return;
  const action = dialog.querySelector<HTMLButtonElement>('footer button:not(:disabled)');
  (action ?? dialog.querySelector<HTMLButtonElement>('header button'))?.focus();
}

export function wrapDialogTab(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
  const dialog = event.currentTarget as HTMLDialogElement;
  const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]')]
    .filter(node => !node.matches(':disabled') && !node.closest('[inert]') && node.tabIndex >= 0 && node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  const current = document.activeElement;
  if (!first || !last || !dialog.contains(current) || current === dialog || current === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
