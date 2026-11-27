import { afterEach, expect, it, vi } from 'vitest';
import { editorCoalescedEvents, editorPointer, isPenEraser, receiveLinuxPen, sampleEditorPointer } from '../apps/editor/src/editor-pointer';

function pointer(type: string, x: number, overrides: Partial<PointerEvent> = {}) {
  return {
    type, clientX: x, clientY: 15, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    isTrusted: true, pointerType: 'mouse', pressure: 0.5, ...overrides,
  } as PointerEvent;
}

afterEach(() => {
  receiveLinuxPen(null);
  vi.restoreAllMocks();
});

it('uses matched GTK pressure once and preserves the last pressure on release', () => {
  receiveLinuxPen(['down', 10.75, 15, 0.2]);
  const down = pointer('pointerdown', 10);
  expect(editorPointer(down)).toMatchObject({ pointerType: 'pen', pressure: 0.2 });
  const position = { x: 20, y: 30 };
  expect(sampleEditorPointer(down, position)).toMatchObject({ ...position, pressure: 0.2 });
  expect(sampleEditorPointer(pointer('pointerdown', 10), position).pressure).toBe(1);

  receiveLinuxPen(['move', 24, 15, 0.8]);
  const last = sampleEditorPointer(pointer('pointermove', 24), position);
  expect(last.pressure).toBe(0.8);
  expect(sampleEditorPointer(pointer('pointerup', 26), position, last).pressure).toBe(0.8);
});

it('leaves real pen events, unrelated mouse events and fabricated events on their normal paths', () => {
  receiveLinuxPen(['down', 10, 15, 0.2]);
  const pen = pointer('pointerdown', 10, { pointerType: 'pen', pressure: 0.7, tiltX: 23 });
  expect(editorPointer(pen)).toBe(pen);
  const wrongPhase = pointer('pointermove', 10);
  const wrongPosition = pointer('pointerdown', 12);
  const untrusted = pointer('pointerdown', 10, { isTrusted: false });
  for (const event of [wrongPhase, wrongPosition, untrusted]) expect(editorPointer(event)).toBe(event);
  expect(editorPointer(pointer('pointerdown', 10)).pressure).toBe(0.2);
});

it('drops expired samples and clears pressure when a different input device takes over', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  receiveLinuxPen(['down', 10, 15, 0.2]);
  clock.mockReturnValue(1101);
  expect(editorPointer(pointer('pointerdown', 10)).pointerType).toBe('mouse');
  receiveLinuxPen(['down', 10, 15, 0.3]);
  receiveLinuxPen(null);
  receiveLinuxPen(['down', 10, 15, NaN]);
  receiveLinuxPen(['down', 10, 15, 2]);
  expect(editorPointer(pointer('pointerdown', 10)).pointerType).toBe('mouse');
});

it('retains stationary pressure changes and shares the final pressure with the WebKit copy', () => {
  receiveLinuxPen(['move', 10, 15, 0.2]);
  receiveLinuxPen(['move', 24, 15, 0.5]);
  receiveLinuxPen(['move', 24, 15, 0.8]);
  const coalesced = [
    pointer('pointermove', 10, { isTrusted: false }),
    pointer('pointermove', 24, { isTrusted: false }),
    pointer('pointermove', 24, { isTrusted: false }),
  ];
  const move = pointer('pointermove', 24, { getCoalescedEvents: () => coalesced });
  const position = { x: 1, y: 2 };
  expect(sampleEditorPointer(move, position).pressure).toBe(0.8);
  expect(editorCoalescedEvents(move).map(sample => sampleEditorPointer(sample, position).pressure)).toEqual([0.2, 0.5, 0.8]);
});

it('keeps contact pressure across an unmatched point in a confirmed GTK pen batch', () => {
  receiveLinuxPen(['move', 10, 15, 0.2]);
  receiveLinuxPen(['move', 24, 15, 0.8]);
  const coalesced = [10, 17, 24].map(x => pointer('pointermove', x, { isTrusted: false }));
  const move = pointer('pointermove', 24, { getCoalescedEvents: () => coalesced });
  let previous: ReturnType<typeof sampleEditorPointer> | undefined;
  const samples = editorCoalescedEvents(move).map(sample =>
    previous = sampleEditorPointer(sample, { x: sample.clientX, y: 15 }, previous));
  expect(samples.map(({ x, pressure }) => [x, pressure])).toEqual([[10, 0.2], [17, 0.2], [24, 0.8]]);
  expect(editorCoalescedEvents(move).map(sample => editorPointer(sample).pointerType)).toEqual(['pen', 'pen', 'pen']);
  expect(editorPointer(coalesced[0]).pressure).toBe(0.2);
  expect(sampleEditorPointer(pointer('pointermove', 17), { x: 17, y: 15 }, previous).pressure).toBe(1);
});

it('uses the prior contact for leading packet gaps and leaves native pen samples intact', () => {
  receiveLinuxPen(['move', 24, 15, 0.8]);
  const gap = pointer('pointermove', 10, { isTrusted: false });
  const pen = pointer('pointermove', 24, { isTrusted: false, pointerType: 'pen', pressure: 0.6, tiltX: 25 });
  const move = pointer('pointermove', 24, { getCoalescedEvents: () => [gap, pen] });
  const position = { x: 100, y: 50 };
  editorCoalescedEvents(move);
  expect(sampleEditorPointer(gap, position, { ...position, pressure: 0.25 }).pressure).toBe(0.25);
  expect(sampleEditorPointer(gap, position).pressure).toBe(0.8);
  expect(sampleEditorPointer(pen, position)).toMatchObject({ pressure: 0.6, tiltX: 25 });
  expect(sampleEditorPointer(move, position).pressure).toBe(0.8);
});

it('keeps contact pressure when GTK reports a move without a pressure axis', () => {
  const position = { x: 24, y: 15 };
  receiveLinuxPen(['down', 10, 15, 0.2]);
  const first = sampleEditorPointer(pointer('pointerdown', 10), { x: 10, y: 15 });
  receiveLinuxPen(['move', 24, 15, null]);
  const move = pointer('pointermove', 24);
  expect(sampleEditorPointer(move, position, first)).toEqual({ ...first, ...position });
  expect(editorPointer(move).pointerType).toBe('pen');
  expect(sampleEditorPointer(pointer('pointermove', 24), position, first).pressure).toBe(1);
});

it('keeps a known pen batch when its final GTK move has no pressure axis', () => {
  receiveLinuxPen(['move', 10, 15, 0.3]);
  receiveLinuxPen(['move', 24, 15, null]);
  const coalesced = [10, 17, 24].map(x => pointer('pointermove', x, { isTrusted: false }));
  const event = pointer('pointermove', 24, { getCoalescedEvents: () => coalesced });
  let previous: ReturnType<typeof sampleEditorPointer> | undefined;
  const points = editorCoalescedEvents(event).map(sample =>
    previous = sampleEditorPointer(sample, { x: sample.clientX, y: 15 }, previous));
  expect(points.map(point => point.pressure)).toEqual([0.3, 0.3, 0.3]);
});

it('admits missing pressure only for GTK moves and clears it on device reset', () => {
  receiveLinuxPen(['down', 10, 15, null]);
  expect(editorPointer(pointer('pointerdown', 10)).pointerType).toBe('mouse');
  receiveLinuxPen(['up', 10, 15, null]);
  expect(editorPointer(pointer('pointerup', 10)).pointerType).toBe('mouse');
  receiveLinuxPen(['move', 10, 15, null]);
  receiveLinuxPen(null);
  expect(editorPointer(pointer('pointermove', 10)).pointerType).toBe('mouse');
});

it('keeps the last GTK pressure when a fractional move summary differs from its coalesced samples', () => {
  receiveLinuxPen(['move', 10, 15, 0.2]);
  receiveLinuxPen(['move', 24, 15, 0.5]);
  receiveLinuxPen(['move', 24, 15, 0.8]);
  const coalesced = [10, 24, 24].map(x => pointer('pointermove', x, { isTrusted: false }));
  const summary = pointer('pointermove', 24.5, { getCoalescedEvents: () => coalesced });
  let previous: ReturnType<typeof sampleEditorPointer> | undefined;
  const points = editorCoalescedEvents(summary).map(sample =>
    previous = sampleEditorPointer(sample, { x: sample.clientX, y: 15 }, previous));
  expect(points.map(point => [point.x, point.pressure])).toEqual([[10, 0.2], [24, 0.5], [24, 0.8]]);
});

it('preserves the coalesced point pressure when neither the summary nor GTK coordinates agree', () => {
  receiveLinuxPen(['move', 23.5, 15, 0.4]);
  receiveLinuxPen(['move', 24, 15, 0.8]);
  const sample = pointer('pointermove', 23.5, { isTrusted: false });
  const summary = pointer('pointermove', 24.5, { getCoalescedEvents: () => [sample] });
  editorCoalescedEvents(summary);
  expect(editorPointer(sample).pressure).toBe(0.4);
  expect(editorPointer(summary).pressure).toBe(0.8);
});

it('recognizes a matched GTK eraser contact even when the device omits pressure', () => {
  receiveLinuxPen(['down', 10, 15, null, 'eraser']);
  expect(editorPointer(pointer('pointerdown', 10, { isTrusted: false })).pointerType).toBe('mouse');
  const matched = pointer('pointerdown', 10);
  expect(isPenEraser(matched)).toBe(true);
  expect(editorPointer(matched)).toMatchObject({ pointerType: 'pen', eraser: true });
  expect(isPenEraser(pointer('pointerdown', 10))).toBe(false);
  receiveLinuxPen(['down', 10, 15, 0.5, 'unknown']);
  expect(isPenEraser(pointer('pointerdown', 10))).toBe(false);
});

it('keeps the browser pen eraser button and bitmask routes', () => {
  expect(isPenEraser(pointer('pointerdown', 10, { pointerType: 'pen', button: 5, buttons: 0 }))).toBe(true);
  expect(isPenEraser(pointer('pointerdown', 10, { pointerType: 'pen', button: 0, buttons: 32 }))).toBe(true);
  expect(isPenEraser(pointer('pointerdown', 10, { pointerType: 'pen', button: 2, buttons: 2 }))).toBe(false);
  expect(isPenEraser(pointer('pointerdown', 10, { button: 5, buttons: 32 }))).toBe(false);
});
