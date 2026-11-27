import { expect, test } from 'vitest';
import { newLayer, newProject, type Vector } from '../packages/document/src';
import { encodeBrushScene } from '../apps/editor/src/brush-scene-json';

test('Brush scene fragments match native JSON bytes with exact field order and values', () => {
  const project = newProject('Édition 🎨 "layers"');
  const key = project.layers[0].keys[0];
  key.shapes.push({
    id: 'outline', kind: 'polygon', x: -0, y: 1e-7, width: 3, height: 5,
    rotation: 0, fill: '#123456', stroke: '#000000', strokeWidth: 0,
    points: [], contours: [[{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 1 }]],
  });
  Object.assign(project, { extra: { toJSON: (field: string) => field }, absent: undefined });
  Object.assign(key, { absent: undefined, extra: 'shapes' });
  expect(encodeBrushScene(project, shape => JSON.stringify(shape))).toBe(JSON.stringify(project));
  key.shapes[0].contours![0][1].out = { x: 2.1, y: 3.2 };
  expect(encodeBrushScene(project, shape => JSON.stringify(shape))).toBe(JSON.stringify(project));
  const backing = newLayer('Backing "art"');
  backing.keys[0].shapes.push({ ...key.shapes[0], id: 'backing' });
  project.layers.unshift(backing);
  expect(encodeBrushScene(project, shape => JSON.stringify(shape))).toBe(JSON.stringify(project));
  backing.keys.push({ frame: 12, shapes: [] });
  expect(encodeBrushScene(project, shape => JSON.stringify(shape))).toBeUndefined();
});

test('Brush scene fragments defer unsupported shapes and accessor wrappers to native JSON', () => {
  const project = newProject();
  const key = project.layers[0].keys[0];
  key.shapes.push({ toJSON: (field: string) => ({ field }) } as unknown as Vector);
  expect(encodeBrushScene(project, shape => JSON.stringify(shape))).toBeUndefined();
  key.shapes = [];
  Object.defineProperty(key, 'derived', { enumerable: true, get: () => 'native fallback' });
  expect(encodeBrushScene(project, shape => JSON.stringify(shape))).toBeUndefined();
});
