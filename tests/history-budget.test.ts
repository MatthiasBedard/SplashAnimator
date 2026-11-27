import { test, expect } from 'vitest';
import { History, newProject } from '../packages/document/src';
import { appendHistory, HistoryCapture, HistoryEntry, historyBytes, moveHistory } from '../packages/document/src/history-storage';

test('records an already captured before-image without serializing its working copy', () => {
  const before = newProject('Édition 🎨'), after = newProject('After');
  const json = JSON.stringify(before);
  const capture = new HistoryCapture<typeof before>(json);
  expect(capture.snapshot).toEqual(before);
  capture.snapshot.name = 'Detached working copy';
  const label = 'Pinceau 🎨';
  const budget = new TextEncoder().encode(json).byteLength + label.length * 2;
  const history = new History(budget);
  history.record(capture, label);
  expect(history.retainedBytes).toBe(budget);
  expect(history.restore(after, false)).toEqual({ project: before, json });
  expect(() => new HistoryCapture('{broken')).toThrow(SyntaxError);
});

test('history charges UTF-8 snapshot bytes, retains the newest contiguous steps and detaches them', () => {
  const a = newProject('é🎨'), b = newProject('Second'), c = newProject('Third');
  const bytes = (p: typeof a) => new TextEncoder().encode(JSON.stringify(p)).byteLength + 'Edit'.length * 2;
  const limit = Math.max(bytes(a) + bytes(b), bytes(b) + bytes(c));
  const history = new History(limit);
  history.record(a, 'Edit');
  expect(history.retainedBytes).toBe(bytes(a));
  history.record(b, 'Edit');
  a.name = 'unowned';
  history.record(c, 'Edit');
  expect(history.retainedBytes).toBe(bytes(b) + bytes(c));
  expect(history.retentionNotice).toContain('trimmed');
  const current = newProject('Fourth');
  const third = history.undo(current)!;
  expect(third).toEqual(c);
  expect(history.retainedBytes).toBeLessThanOrEqual(limit);
  expect(history.undo(third)).toEqual(b);
  expect(history.undo(b)).toBeUndefined();
  expect(history.redo(b)).toEqual(c);
  expect(history.redo(c)).toEqual(current);
});

test('oversized states create no gaps or artwork mutation across record, Undo and Redo', () => {
  const small = newProject('Small'), large = newProject('Large');
  large.layers[0].keys[0].shapes.push({
    kind: 'bezier', id: 'path', x: 0, y: 0, width: 250, height: 2,
    fill: '#ffffff', stroke: '#111111', strokeWidth: 1, rotation: 0,
    nodes: Array.from({ length: 1000 }, (_, x) => ({ x, y: x % 2 })), points: [], closed: false,
  });
  const history = new History(2500);
  history.record(small, 'Grow artwork');
  expect(history.undo(large)).toEqual(small);
  expect(history.redoLabel).toBeUndefined();
  expect(history.retentionNotice).toContain('too large to redo');
  expect(large.layers[0].keys[0].shapes[0].nodes).toHaveLength(1000);
  history.record(small, 'Earlier edit');
  history.record(large, 'Latest edit');
  expect(history.retainedBytes).toBe(0);
  expect(history.undoLabel).toBeUndefined();
  expect(history.redoLabel).toBeUndefined();
});

test('prepared records retain detached bytes and reject stale or reentrant publication', () => {
  const history = new History(), before = newProject('Before'), after = newProject('After');
  const commit = history.prepareRecord(before, 'Prepared');
  before.name = 'Mutated';
  commit();
  expect(() => commit()).toThrow('stale');
  expect(history.undo(after)?.name).toBe('Before');
  const stale = history.prepareRecord(before, 'Stale');
  history.redo(before);
  expect(() => stale()).toThrow('stale');
  const read = history.prepareRecord(before, 'Earlier capture');
  Object.defineProperty(before, 'name', { get: () => { history.clear(); return 'Reentered'; } });
  expect(() => history.prepareRecord(before, 'Reentered')).toThrow('changed');
  expect(() => read()).toThrow('stale');
  expect(history.retainedBytes).toBe(0);
});

test('history restoration pairs the detached project with its exact stored JSON for recovery', () => {
  const history = new History(), before = newProject('Édition 🎨'), after = newProject('After');
  const original = JSON.stringify(before), edited = JSON.stringify(after);
  history.record(before, 'Rename');
  before.name = 'No longer the source';
  const restored = history.restore(after, false)!;
  expect(restored.json).toBe(original);
  expect(restored.project).toEqual(JSON.parse(original));
  const redone = history.restore(restored.project, true)!;
  expect(redone.json).toBe(edited);
  expect(redone.project).toEqual(after);
});

test('symbol-local history applies one byte ceiling across both sides', () => {
  const a = new HistoryEntry({ frame: 0, layerId: 'A', definition: 'α' });
  const b = new HistoryEntry({ frame: 1, layerId: 'B', definition: 'β' });
  const c = new HistoryEntry({ frame: 2, layerId: 'C', definition: 'γ' });
  const d = new HistoryEntry({ frame: 3, layerId: 'D', definition: 'δ'.repeat(30) });
  const limit = a.bytes + b.bytes + c.bytes;
  const initial = appendHistory(appendHistory([a], b, limit), c, limit);
  expect(initial.map(entry => entry.read().frame)).toEqual([0, 1, 2]);
  const step = moveHistory(initial, [], d, limit);
  expect(historyBytes([...step.source, ...step.destination])).toBeLessThanOrEqual(limit);
  expect(step.source.map(entry => entry.read().frame)).toEqual([]);
  expect(step.destination[0].read()).toEqual(d.read());
  const large = new HistoryEntry({ frame: 4, layerId: 'E', definition: 'e'.repeat(500) });
  expect(moveHistory([a, b], [c], large, limit)).toEqual({ source: [a], destination: [] });
});
