import { expect, it } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { encodeClipboardFrames, prepareClipboardFramePaste } from '../apps/editor/src/frame-clipboard';

const shape: Vector = {
  id: 'held', kind: 'rectangle', x: 12, y: 24, width: 12, height: 14, rotation: 0,
  fill: '#123456', stroke: '#000000', strokeWidth: 0, points: [], groups: ['group'],
};
function fixture() {
  const project = newProject();
  const source = project.layers[0], target = newLayer('Destination'), second = newLayer('Second');
  source.keys = [{ frame: 0, shapes: [shape] }, { frame: 4, shapes: [] },
    { frame: 6, shapes: [{ ...shape, x: 42 }] }];
  project.layers.push(target, second);
  return { project, source, target, second };
}

it('moves held and blank exposures into a detached timeline with stable fresh identities', () => {
  const { project, source, target } = fixture();
  const input = encodeClipboardFrames(project, [source.id], 2, 7);
  expect(JSON.parse(input)).toMatchObject({ format: 'splash-frames-1', duration: 6,
    tracks: [{ mode: 'object', keys: [
      { frame: 0, shapes: [shape] }, { frame: 2, shapes: [] },
      { frame: 4, shapes: [{ ...shape, x: 42 }] },
    ] }] });
  const next = prepareClipboardFramePaste(project, 12, [target.id], input);
  const keys = next.layers[1].keys;
  expect(keys.map(k => k.frame)).toEqual([0, 12, 14, 16, 18]);
  expect(keys[2].shapes).toEqual([]);
  expect(keys[1].shapes[0].id).not.toBe(shape.id);
  expect(keys[1].shapes[0].id).toBe(keys[3].shapes[0].id);
  expect(keys[1].shapes[0].groups).toEqual(keys[3].shapes[0].groups);
  expect(keys[1].shapes[0].groups).not.toEqual(shape.groups);
  expect(next.duration).toBe(project.duration + 6);
  expect(next.layers[0]).toEqual(source);
  expect(project.layers[1].keys).toEqual([{ frame: 0, shapes: [] }]);
});

it('rejects a malformed clip or protected later destination without changing any layer', () => {
  const { project, source, target, second } = fixture();
  const input = encodeClipboardFrames(project, [source.id, second.id], 2, 7);
  second.locked = true;
  const original = structuredClone(project);
  expect(() => prepareClipboardFramePaste(project, 12, [target.id, second.id], input)).toThrow('unlocked');
  expect(project).toEqual(original);
  second.locked = false;
  second.drawingMode = 'merge';
  expect(() => prepareClipboardFramePaste(project, 12, [target.id, second.id], input)).toThrow('matching');
  second.drawingMode = 'object';
  for (const malformed of [
    input.replace('"frame":2', '"frame":0'),
    input.replace('"x":12', '"x":1e999'),
    input.replace('"frame":2', '"frame":2,"motionSpans":[]'),
  ])
    expect(() => prepareClipboardFramePaste(project, 12, [target.id, second.id], malformed)).toThrow();
  project.duration = 100000;
  expect(() => prepareClipboardFramePaste(project, 12, [target.id, second.id], input)).toThrow('limits');
});
