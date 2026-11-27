import { test, expect } from 'vitest';
import { bindingFor, bindingFromKey, changeShortcut, exportShortcuts, importShortcuts,
  shortcutDisplay, shortcutForKey, shortcutText } from '../apps/editor/src/editor-shortcuts';

const key = (key: string, extras: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, getModifierState: () => false, ...extras } as KeyboardEvent);

test('portable primary modifiers and semantic keys use OS labels and actual layout', () => {
  const saved = changeShortcut({}, 'tool:brush', 'é');
  const actual = key('é', { code: 'KeyQ' });
  expect(shortcutForKey(actual, saved)).toBe('tool:brush');
  expect(bindingFromKey(key('e\u0301'))).toBe('é');
  expect(shortcutForKey(key('Z', { metaKey: true, shiftKey: true }), {})).toBe('redo');
  expect(shortcutForKey(key('z', { ctrlKey: true }), {})).toBe('undo');
  expect(shortcutText('Primary+Shift+z', false)).toBe('Ctrl Shift Z');
  expect(shortcutText('Primary+Shift+z', true)).toBe('⌘⇧Z');
  expect(bindingFromKey(key('Dead'))).toBeUndefined();
  expect(bindingFromKey(key('e', { isComposing: true }))).toBeUndefined();
  expect(bindingFromKey(key('q', { ctrlKey: true, altKey: true, getModifierState: () => true }))).toBeUndefined();
});

test('default redo accepts both shortcuts and respects explicit customization', () => {
  const alternate = key('y', { ctrlKey: true });
  const primary = key('Z', { ctrlKey: true, shiftKey: true });
  expect(shortcutForKey(alternate, {})).toBe('redo');
  expect(shortcutForKey(primary, {})).toBe('redo');
  expect(shortcutForKey(key('y'), {})).toBe('tool:path');
  expect(shortcutForKey(key('y', { ctrlKey: true, altKey: true }), {})).toBeUndefined();
  expect(shortcutDisplay({}, 'redo', false)).toBe('Ctrl Shift Z / Ctrl Y');
  const custom = changeShortcut({}, 'redo', 'Primary+Shift+y');
  expect(shortcutForKey(alternate, custom)).toBeUndefined();
  expect(shortcutForKey(primary, custom)).toBeUndefined();
  expect(shortcutForKey(key('Y', { ctrlKey: true, shiftKey: true }), custom)).toBe('redo');
  expect(shortcutDisplay(custom, 'redo', false)).toBe('Ctrl Shift Y');
  expect(shortcutForKey(alternate, changeShortcut({}, 'redo', null))).toBeUndefined();
});

test('validates complete mappings before accepting imports, including defaults and reserved keys', () => {
  const original = changeShortcut({}, 'tool:brush', null);
  const map = changeShortcut(original, 'tool:hand', 'b');
  expect(importShortcuts(exportShortcuts(map))).toEqual(map);
  expect(bindingFor(map, 'tool:brush')).toBeNull();
  expect(bindingFor({}, 'tool:brush')).toBe('b');
  expect(() => changeShortcut({}, 'tool:hand', 'b')).toThrow('conflicts');
  for (const reserved of ['Primary+c', 'Primary+w', 'Shift+f10', 'tab', 'escape', 'enter'])
    expect(() => changeShortcut({}, 'tool:hand', reserved)).toThrow('reserved');
  expect(() => importShortcuts('{"version":1,"bindings":{"invalid":null}}')).toThrow('Unknown shortcut');
  expect(() => importShortcuts('{"version":2,"bindings":{}}')).toThrow('Invalid shortcut');
});
