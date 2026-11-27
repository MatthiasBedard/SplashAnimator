/** Reveal the full focused control within a compact horizontal toolbar. */
export function revealToolbarFocus(event: FocusEvent) {
  const toolbar = event.currentTarget;
  const control = event.target;
  if (!(toolbar instanceof HTMLElement) || !(control instanceof HTMLElement)
    || toolbar.scrollWidth <= toolbar.clientWidth) return;

  const left = toolbar.getBoundingClientRect().left + toolbar.clientLeft;
  const right = left + toolbar.clientWidth;
  const bounds = control.getBoundingClientRect();
  // Leave room for the keyboard outline and its offset.
  const focusMargin = 3;
  if (bounds.left < left + focusMargin) toolbar.scrollLeft += bounds.left - left - focusMargin;
  else if (bounds.right > right - focusMargin) toolbar.scrollLeft += bounds.right - right + focusMargin;
}
