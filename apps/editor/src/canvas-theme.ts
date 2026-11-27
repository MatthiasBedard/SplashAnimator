import { createSubscriber } from 'svelte/reactivity';

const defaults = {
  stageRulerBackground: '#2d3038',
  stageRulerText: '#a0a4b0',
  timelineRulerBackground: '#282b33',
  timelineRulerText: '#999eac',
  timelineOutside: '#22252b',
  timelineRow: '#30343d',
  timelineFifth: '#383c46',
  timelineActiveRow: '#29394e',
  timelineActiveFifth: '#324862',
  timelineSelection: '#3d6089',
  timelineOutline: '#deedff',
  timelineKey: '#bbc0ce',
  timelineHiddenKey: '#747885',
  timelineEmptyKey: '#adb2c0',
  timelineComment: '#70d9ef',
  timelineLabel: '#ffd277',
};

let palette = defaults;
const changeEvent = 'splash-canvas-theme-change';
const subscribe = createSubscriber(update => {
  document.addEventListener(changeEvent, update);
  return () => document.removeEventListener(changeEvent, update);
});

export function canvasTheme() {
  subscribe();
  return palette;
}

export function refreshCanvasTheme() {
  // Read CSS once per stylesheet change. Drawing and scrubbing use the cached colors.
  const style = getComputedStyle(document.documentElement);
  const next = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const property = '--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
    next[key] = style.getPropertyValue(property).trim() || defaults[key];
  }
  palette = next;
  document.dispatchEvent(new Event(changeEvent));
}
