export { prepareMaskedLayerPainter } from '../packages/stage/src/masked-layers';
export { createMaskResourceBank } from '../packages/stage/src/mask-resources';
export { prepareLayerScene, disposeLayerScene } from '../packages/animation/src/layer-scene';
export { evaluateLayers } from '../packages/animation/src';
import { newProject, newLayer, type Vector } from '../packages/document/src';
export function maskResourceFixture(dataUrl: string, style = 'same') {
  const p = newProject();
  p.width = 40;
  p.height = 30;
  p.duration = 2;
  p.background = '#0000ff';
  const rect = (id: string, fill: string): Vector => ({
    id,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  p.assets = [
    {
      id: 'image',
      path: 'assets/bitmaps/image.json',
      bitmap: { name: 'Image', width: 40, height: 30, dataUrl },
    },
    {
      id: 'alias',
      path: 'assets/bitmaps/alias.json',
      bitmap: { name: 'Alias', width: 40, height: 30, dataUrl },
    },
  ];
  const image = {
    ...rect('image-mask', '#ffffff'),
    opacity: 0.5,
    bitmap: { assetId: 'image', x: 0, y: 0, width: 40, height: 30 },
  };
  const alias = {
    ...image,
    id: 'alias-mask',
    opacity: 0,
    bitmap: { ...image.bitmap, assetId: 'alias' },
  };
  const text: Vector = {
    ...rect('text', '#000000'),
    kind: 'text',
    x: 100,
    text: {
      content: 'AB',
      font: 'sans-serif',
      size: 12,
      bold: false,
      italic: false,
      align: 'left',
    },
  };
  const next = structuredClone(text);
  next.text!.content = style === 'glyph' ? 'AC' : 'BA';
  if (style === 'run') next.text!.runs = [{ start: 0, end: 1, style: { bold: true } }];
  p.layers = [
    {
      ...newLayer('Target'),
      id: 'target',
      keys: [
        { frame: 0, shapes: [rect('red', '#ff0000'), text] },
        { frame: 1, shapes: [rect('red', '#ff0000'), next] },
      ],
    },
    {
      ...newLayer('Mask'),
      id: 'mask',
      keys: [
        { frame: 0, shapes: [image, alias] },
        {
          frame: 1,
          shapes: [
            { ...image, x: 10 },
            { ...alias, x: 10 },
          ],
        },
      ],
    },
  ];
  return p;
}
