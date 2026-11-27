import type { Point } from '../../../packages/document/src';
import { samplePointer, type PointerSample } from '../../../packages/interaction/src';

type Phase = 'down' | 'move' | 'up';
type Sample = { phase: Phase; x: number; y: number; pressure: number | null; eraser: boolean; received: number };
type EditorPointerSample = PointerSample & { missingPressure?: true; eraser?: true; gtkPosition?: Pick<Sample, 'x' | 'y'> };
const samples: Sample[] = [];
const matched = new WeakMap<PointerEvent, EditorPointerSample>();
const lifetime = 100;

/** GTK pressure arrives just before the matching WebKit pointer event. */
export function receiveLinuxPen(value: unknown) {
  if (value === null) {
    samples.length = 0;
    return;
  }
  if (!Array.isArray(value)) return;
  const eraser = value.length === 5 && value[4] === 'eraser';
  if (value.length !== 4 && !eraser) return;
  const [phase, x, y, pressure] = value;
  if ((phase !== 'down' && phase !== 'move' && phase !== 'up') ||
      !Number.isFinite(x) || !Number.isFinite(y) ||
      (pressure === null ? phase !== 'move' && !eraser : !Number.isFinite(pressure) || pressure < 0 || pressure > 1)) return;
  if (phase === 'down') samples.length = 0;
  if (samples.length === 64) samples.shift();
  samples.push({ phase, x, y, pressure, eraser, received: performance.now() });
}

export function editorPointer(event: PointerEvent): EditorPointerSample {
  const owned = matched.get(event);
  if (owned) return owned;
  if (!event.isTrusted || event.pointerType !== 'mouse' || !samples.length) return event;
  const phase = event.type === 'pointermove' && (event.buttons & 1) ? 'move'
    : event.type === 'pointerdown' && event.button === 0 ? 'down'
    : event.type === 'pointerup' && event.button === 0 ? 'up' : undefined;
  return phase ? matchSample(event, phase, event.type, true) ?? event : event;
}

export function isPenEraser(event: PointerEvent): boolean {
  return event.pointerType === 'pen'
    ? event.button === 5 || !!(event.buttons & 32)
    : editorPointer(event).eraser === true;
}

function matchSample(event: PointerEvent, phase: Phase, type: string, latest = false): EditorPointerSample | undefined {
  const now = performance.now();
  while (samples[0] && now - samples[0].received > lifetime) samples.shift();
  const atEvent = (sample: Sample) => sample.phase === phase &&
    Math.abs(sample.x - event.clientX) <= 1 && Math.abs(sample.y - event.clientY) <= 1;
  let index = -1;
  for (let i = 0; i < samples.length; i++) {
    if (!atEvent(samples[i])) continue;
    index = i;
    if (!latest) break;
  }
  if (index < 0) return undefined;
  const sample = samples.splice(index, 1)[0];
  const input: EditorPointerSample = {
    type, pointerType: 'pen', pressure: sample.pressure ?? 1, tiltX: 0, tiltY: 0, twist: 0, gtkPosition: sample,
  };
  if (sample.pressure === null) input.missingPressure = true;
  if (sample.eraser) input.eraser = true;
  matched.set(event, input);
  return input;
}

export function editorCoalescedEvents(event: PointerEvent): PointerEvent[] {
  const events = event.getCoalescedEvents?.() ?? [];
  const input = editorPointer(event);
  if (input === event || event.type !== 'pointermove') return events;
  for (const [index, sample] of events.entries()) {
    if (sample.pointerType !== 'mouse' || matched.has(sample)) continue;
    // The final raw position can agree with the GTK packet even when the
    // browser adjusts the coordinates of the dispatched summary.
    if (index === events.length - 1 && (
      (sample.clientX === event.clientX && sample.clientY === event.clientY) ||
      (sample.clientX === input.gtkPosition?.x && sample.clientY === input.gtkPosition?.y)
    ))
      matched.set(sample, input);
    else if (!matchSample(sample, 'move', event.type)) {
      // The dispatched event already identified this batch as GTK pen input.
      // Keep the point even when its separate pressure packet is absent.
      matched.set(sample, { ...input, missingPressure: true });
    }
  }
  return events;
}

export function sampleEditorPointer(event: PointerEvent, position: Point, previous?: Point): Point {
  const input = editorPointer(event);
  if (input.missingPressure && previous?.pressure !== undefined)
    return samplePointer({ ...input, pressure: previous.pressure }, position, previous);
  // The compatibility mouse release can arrive outside the WebView. A release
  // carries no new contact pressure, so keep the previously sampled width.
  if (input === event && event.pointerType === 'mouse' && event.type === 'pointerup' &&
      previous?.pressure !== undefined && previous.pressure < 1)
    return samplePointer({ ...input, type: event.type, pointerType: 'pen' }, position, previous);
  return samplePointer(input, position, previous);
}

declare global {
  interface Window {
    __splashLinuxPen?: typeof receiveLinuxPen;
  }
}

if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)
  window.__splashLinuxPen = receiveLinuxPen;
