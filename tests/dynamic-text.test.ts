import { expect, test, vi } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import { captureDynamicTextValues, isDynamicTextBinding, isDynamicTextInstanceName } from '../packages/document/src/dynamic-text';
import { createScriptText, scriptTextStateKey } from '../packages/scripting/src/dynamic-text';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';
import { captureDynamicTextOwners } from '../packages/export-web/src/dynamic-text';
import { captureReplayTextChanges } from '../packages/export-web/src/replay-text';
import { symbolInstance } from '../packages/geometry/src/symbols';

test('captures detached text replay changes with explicit clears and strict tick ordering', () => {
  const values = { title: 'A </script> 字' };
  const changes = captureReplayTextChanges([{ tick: 1, values }, { tick: 3, values: null }], 4);
  values.title = 'Replaced';
  expect(changes).toEqual([{ tick: 1, values: { title: 'A </script> 字' } }, { tick: 3, values: null }]);
  const getter = vi.fn(() => 1);
  const raw = Object.defineProperty({ values }, 'tick', { get: getter });
  for (const input of [[raw], Array(1), [{ tick: 5, values }], [{ tick: 1, values }, { tick: 1, values: null }]])
    expect(() => captureReplayTextChanges(input, 4)).toThrow('Invalid replay text change');
  expect(getter).not.toHaveBeenCalled();
});
const field: Vector = {
  id: 'field', kind: 'text', x: 0, y: 0, width: 50, height: 30, rotation: 0,
  fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [],
  text: { content: 'Initial', dynamicBinding: 'message', font: 'Arial', size: 24,
    bold: false, italic: false, align: 'left', wrapWidth: 50 },
};

test('persists a dynamic root and an input symbol field with unchanged text formatting and legacy static fields', async () => {
  const project = newProject();
  const staticField = structuredClone(field);
  delete staticField.text!.dynamicBinding;
  project.layers[0].keys[0].shapes = [staticField];
  project.layers[0].keys.push({ frame: 1, shapes: [structuredClone(field)] });
  project.symbols = [{ id: 'caption', name: 'Caption', width: 50, height: 30,
    shapes: [{ ...structuredClone(field), text: { ...field.text!, input: true } }] }];
  const files = new Map<string, string>();
  const write = async (name: string, data: string) => { files.set(name, data); };
  const store: DirectoryStore = {
    read: async name => files.get(name)!,
    exists: async name => files.has(name), writeNew: write, commit: write,
  };
  await saveProject(store, project, null);
  expect((await loadProject(store)).project).toEqual(project);
});

test('rejects a malformed input flag and input without a binding', () => {
  const p = newProject(), caption = structuredClone(field);
  p.layers[0].keys[0].shapes = [caption];
  for (const value of [false, undefined, 'true', 1]) {
    Object.defineProperty(caption.text, 'input', { value, enumerable: true, configurable: true });
    expect(() => validateProject(p)).toThrow(/explicit flag/);
  }
  Object.defineProperty(caption.text, 'input', { value: true, enumerable: true, configurable: true });
  delete caption.text!.dynamicBinding;
  expect(() => validateProject(p)).toThrow(/dynamic text binding/);
});

test('rejects non-data, reserved or wrong-kind binding values before cloning', () => {
  const project = newProject();
  const shape = structuredClone(field);
  project.layers[0].keys[0].shapes = [shape];
  for (const value of [undefined, null, '', 'bad name', '__proto__', 'a'.repeat(65), 42]) {
    Object.defineProperty(shape.text, 'dynamicBinding', { value, enumerable: true, configurable: true });
    expect(() => validateProject(project)).toThrow(/explicit binding name/);
  }
  Object.defineProperty(shape.text, 'dynamicBinding', { enumerable: true, configurable: true,
    get: () => { throw Error('Getter should not run'); } });
  expect(() => validateProject(project)).toThrow(/explicit binding name/);
  shape.text = structuredClone(field.text);
  shape.kind = 'rectangle';
  expect(() => validateProject(project)).toThrow(/explicit binding name/);
});

test('captures detached typed values and rejects invalid updates before changing previous values', () => {
  const state = Object.create(null);
  const api = createScriptText(state, scriptTextStateKey, isDynamicTextBinding, isDynamicTextInstanceName);
  api.set('message', 'One');
  const values = captureDynamicTextValues(state[scriptTextStateKey]);
  api.set('message', '');
  expect(values).toEqual({ message: 'One' });
  expect(() => api.set('message', 'a'.repeat(10001))).toThrow(/10,000/);
  expect(() => api.set('__proto__', 'invalid')).toThrow(/valid binding/);
  expect(captureDynamicTextValues(state[scriptTextStateKey])).toEqual({ message: '' });
  expect(() => captureDynamicTextValues({ message: 18 })).toThrow(/Invalid dynamic text value/);
});

test('qualifies named roots using their original layer, exposure and identity', () => {
  const project = newProject();
  const definition = { id: 'caption', name: 'Caption', width: 50, height: 30, shapes: [field] };
  project.symbols = [definition];
  const layer = project.layers[0], name = 'left/"caption"';
  const left = { ...symbolInstance(definition, 0, 0), instanceName: name };
  const right = { ...symbolInstance(definition, 60, 0), instanceName: 'right' };
  layer.keys[0].shapes = [left, right];
  layer.keys.push({ frame: 2, shapes: [{ ...left, x: 4 }] });
  const state = Object.create(null);
  const api = createScriptText(state, scriptTextStateKey, isDynamicTextBinding, isDynamicTextInstanceName);
  api.setForInstance(name, 'message', 'First');
  const values = captureDynamicTextValues(state[scriptTextStateKey])!;
  expect(values).toEqual({ [JSON.stringify([name, 'message'])]: 'First' });
  expect(() => captureDynamicTextValues({ '[ "left", "message" ]': 'Invalid' })).toThrow();
  const owner = captureDynamicTextOwners(project, values)!;
  expect(owner(layer.id, 0, left.id)).toBe(name);
  expect(owner(layer.id, 2, left.id)).toBe(name);
  expect(owner(layer.id, 0, right.id)).toBeUndefined();
  expect(owner('other layer', 0, left.id)).toBeUndefined();
  right.instanceName = name;
  expect(() => captureDynamicTextOwners(project, values)).toThrow(/ambiguous/);
  expect(owner(layer.id, 0, right.id)).toBeUndefined();
  expect(() => captureDynamicTextOwners(project, {
    [JSON.stringify(['missing', 'message'])]: 'Invalid',
  })).toThrow(/missing/);
});
