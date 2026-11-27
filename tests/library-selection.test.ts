import { expect, it } from 'vitest';
import {
  pickLibraryItem as pick,
  type LibrarySelection,
} from '../apps/editor/src/library-selection';
const view = ['symbol:a', 'bitmap:a', 'audio:b', 'symbol:z'];
it('plain clicks replace selection without confusing IDs from different item types', () => {
  expect(pick(view, { selected: ['symbol:a'] }, 'bitmap:a')).toEqual({
    selected: ['bitmap:a'],
    anchor: 'bitmap:a',
    focus: 'bitmap:a',
  });
});
it('Ctrl toggles each item and retains displayed order', () => {
  const first = pick(view, { selected: [] }, 'symbol:z');
  const both = pick(view, first, 'symbol:a', { toggle: true });
  expect(both.selected).toEqual(['symbol:a', 'symbol:z']);
  expect(pick(view, both, 'symbol:z', { toggle: true }).selected).toEqual(['symbol:a']);
  expect(first.selected).toEqual(['symbol:z']);
});
it('Shift ranges use current sorted order and a stable original anchor in both directions', () => {
  const state = pick(view, { selected: [] }, 'bitmap:a');
  expect(pick(view, state, 'symbol:z', { range: true }).selected).toEqual(view.slice(1));
  expect(pick([...view].reverse(), state, 'symbol:a', { range: true }).selected).toEqual([
    'bitmap:a',
    'symbol:a',
  ]);
});
it('Ctrl+Shift adds the displayed range without removing other selected items', () => {
  const state: LibrarySelection = { selected: ['symbol:a', 'symbol:z'], anchor: 'symbol:z' };
  expect(pick(view, state, 'audio:b', { toggle: true, range: true }).selected).toEqual([
    'symbol:a',
    'audio:b',
    'symbol:z',
  ]);
});
it('right click preserves a multi-selection and anchor on a selected item, selects an unselected item alone', () => {
  const state: LibrarySelection = { selected: ['symbol:a', 'symbol:z'], anchor: 'symbol:a' };
  expect(pick(view, state, 'symbol:z', { context: true })).toEqual({ ...state, focus: 'symbol:z' });
  expect(pick(view, state, 'audio:b', { context: true }).selected).toEqual(['audio:b']);
});
it('filters remove hidden selection and stale range anchors fall back to a new pick', () => {
  const state: LibrarySelection = { selected: ['symbol:a', 'symbol:z'], anchor: 'symbol:a' };
  expect(pick(view.slice(1), state, 'audio:b', { range: true }).selected).toEqual(['audio:b']);
  expect(pick(view, state, 'missing')).toBe(state);
});
