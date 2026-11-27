import { expect, test } from 'vitest';
import { newLayer, type Vector } from '../packages/document/src';
import { scriptFieldPlacement, scriptTextFields } from '../apps/editor/src/script-text-fields';

const text: Vector = {
  id: 'caption', kind: 'text', x: 140, y: 30, width: 80, height: 24, rotation: 0,
  transform: [-1, 0.25, 0.5, 1], fill: '#ffffff', stroke: '#000000', strokeWidth: 0, points: [],
  text: { content: 'Caption', dynamicBinding: 'caption', input: true, font: 'Arial',
    size: 20, scaleX: 2, scaleY: 0.5, bold: true, italic: false, align: 'center' },
};
const view = { width: 100, height: 80, naturalWidth: 200, naturalHeight: 100 };

test('projects reflected field and text scales into independent image axes', () => {
  expect(scriptFieldPlacement(text, view)).toMatchObject({
    transform: 'matrix(-1,0.4,0.125,0.4,70,24)',
    width: '40px', height: '48px', font: 'normal bold 20px/1.2 "Arial", sans-serif',
    align: 'center', editBackground: '#000', wrap: 'off',
  });
  expect(scriptFieldPlacement({ ...text, x: 10 }, view)).toBeUndefined();
  expect(scriptFieldPlacement({ ...text, text: { ...text.text!, wrapWidth: 100 } }, view)).toBeUndefined();
});

test('uses the inspector for occluded or rich text and rejects ambiguous bindings', () => {
  const layer = newLayer('Inputs');
  const above = { ...text, id: 'above', kind: 'rectangle' as const, text: undefined };
  layer.keys[0].shapes = [text, { ...above, x: 195, transform: undefined, width: 3 }];
  expect(scriptTextFields([layer], 0, true)[0].overlay).toBe(text);
  layer.keys[0].shapes = [text, above];
  expect(scriptTextFields([layer], 0, true)[0].overlay).toBeUndefined();
  const rich = { ...text, text: { ...text.text!, runs: [{ start: 0, end: 1, style: { italic: true } }] } };
  layer.keys[0].shapes = [rich];
  expect(scriptTextFields([layer], 0, true)[0].overlay).toBeUndefined();
  layer.keys[0].shapes = [text, { ...text, id: 'duplicate' }];
  expect(scriptTextFields([layer], 0, true)).toEqual([]);
});
