import { createSubscriber } from 'svelte/reactivity';

const read = () => window.devicePixelRatio || 1;

// Moving between displays can change DPR without resizing the CSS viewport.
// Re-arm the resolution query so it also observes subsequent scale changes.
const subscribe = createSubscriber((update) => {
  let ratio = read();
  let query: MediaQueryList;
  const watch = () => {
    query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    query.addEventListener('change', check);
  };
  const check = () => {
    const next = read();
    if (next === ratio) return;
    query.removeEventListener('change', check);
    ratio = next;
    watch();
    update();
  };
  watch();
  window.addEventListener('resize', check);
  return () => {
    query.removeEventListener('change', check);
    window.removeEventListener('resize', check);
  };
});

export function displayPixelRatio() {
  subscribe();
  return read();
}
