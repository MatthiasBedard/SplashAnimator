import { newProject, newLayer, type Vector, type SymbolDefinition } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
export { createInteractiveButtonView } from '../packages/animation/src/movie-button-view';
export { createMovieTreeClock } from '../packages/animation/src/movie-tree-clock';
export { createRootButtonMoviePlayback } from '../packages/animation/src/button-preview';
export { evaluate, evaluateLayers } from '../packages/animation/src';
export { createStageOpacityView } from '../packages/animation/src/stage-opacity';
export { prepareLayerScene, disposeLayerScene } from '../packages/animation/src/layer-scene';
export { prepareMaskedLayerPainter } from '../packages/stage/src/masked-layers';
export { drawShape } from '../packages/stage/src';

export const rect = (id: string, fill: string, x = 0): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y: 0,
  width: 20,
  height: 20,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
export function layerPresentationFixture() {
  const p = newProject();
  p.width = 160;
  p.height = 80;
  p.duration = 8;
  p.fps = 2;
  const leaf: SymbolDefinition = {
    id: 'leaf',
    name: 'Leaf',
    width: 20,
    height: 20,
    shapes: [rect('paint', '#ff0000')],
    timeline: {
      duration: 4,
      keys: [
        { frame: 1, shapes: [rect('paint', '#00ff00', 2)] },
        { frame: 2, shapes: [rect('paint', '#0000ff', 4)] },
        { frame: 3, shapes: [] },
      ],
    },
  };
  const moving = {
    ...symbolInstance(leaf, 0, 0),
    id: 'movie',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
  };
  const button: SymbolDefinition = {
    id: 'button',
    name: 'Button',
    width: 20,
    height: 20,
    shapes: [moving],
    timeline: {
      duration: 4,
      keys: [
        { frame: 1, shapes: [rect('over', '#ffff00')] },
        { frame: 2, shapes: [] },
        { frame: 3, shapes: [{ ...rect('hit', '#ffffff', -5), y: -5, width: 30, height: 30 }] },
      ],
    },
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
  };
  const child = { ...symbolInstance(button, 0, 0), id: 'child', groups: ['inside'] };
  const parent: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 40,
    height: 30,
    shapes: [
      child,
      { ...moving, id: 'sibling', x: 25, symbolPlayback: { mode: 'movie', firstFrame: 1 } },
    ],
    timeline: {
      duration: 4,
      keys: [
        { frame: 2, shapes: [] },
        { frame: 3, shapes: [{ ...child, x: 5 }, moving] },
      ],
    },
  };
  const graphic = { ...symbolInstance(parent, 0, 0), id: 'graphic' };
  const wrapper: SymbolDefinition = {
    id: 'wrapper',
    name: 'Wrapper',
    width: 40,
    height: 30,
    shapes: [graphic],
    timeline: {
      duration: 4,
      keys: [
        { frame: 1, shapes: [] },
        { frame: 2, shapes: [graphic] },
        { frame: 3, shapes: [{ ...rect('wrapper-hit', '#ffffff'), width: 40, height: 30 }] },
      ],
    },
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
  };
  p.symbols = [leaf, button, parent, wrapper];
  const a = {
    ...symbolInstance(parent, 45, 10),
    id: 'same',
    transform: [-1, 0.2, 0.3, 1] as [number, number, number, number],
    opacity: 0.75,
    symbolPlayback: { mode: 'loop' as const, firstFrame: 0 },
  };
  const b = {
    ...symbolInstance(parent, 80, 10),
    id: 'same',
    transform: [1, 0.1, 0.2, 1] as [number, number, number, number],
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
  };
  const outer = { ...symbolInstance(wrapper, 10, 40), id: 'outer' };
  p.layers = [
    {
      ...newLayer('A'),
      id: 'a',
      keys: [
        { frame: 0, shapes: [rect('plain', '#888888'), a] },
        { frame: 5, shapes: [] },
        { frame: 6, shapes: [rect('plain', '#888888'), a] },
      ],
    },
    {
      ...newLayer('B'),
      id: 'b',
      keys: [
        { frame: 0, shapes: [b, outer] },
        { frame: 4, shapes: [outer] },
        { frame: 6, shapes: [b, outer] },
      ],
    },
    { ...newLayer('Hidden'), id: 'hidden', visible: false, keys: [{ frame: 0, shapes: [b] }] },
  ];
  return p;
}

export function layerPresentationMaskFixture() {
  const p = newProject();
  p.width = 80;
  p.height = 40;
  p.fps = 2;
  p.duration = 1;
  p.background = '#0000ff';
  const leaf: SymbolDefinition = {
    id: 'leaf',
    name: 'Mask movie',
    width: 80,
    height: 40,
    shapes: [{ ...rect('coverage', '#ffffff'), height: 40 }],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...rect('coverage', '#ffffff', 20), height: 40 }] },
        { frame: 2, shapes: [] },
      ],
    },
  };
  const button: SymbolDefinition = {
    id: 'button',
    name: 'Mask button',
    width: 80,
    height: 40,
    shapes: [
      {
        ...symbolInstance(leaf, 0, 0),
        id: 'movie',
        symbolPlayback: { mode: 'movie', firstFrame: 0 },
      },
    ],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  p.symbols = [leaf, button];
  p.layers = [
    {
      ...newLayer('Target'),
      id: 'target',
      keys: [{ frame: 0, shapes: [{ ...rect('target', '#ff0000'), width: 80, height: 40 }] }],
    },
    {
      ...newLayer('Mask'),
      id: 'mask',
      keys: [
        { frame: 0, shapes: [{ ...symbolInstance(button, 0, 0), id: 'button', opacity: 0.5 }] },
      ],
    },
  ];
  p.frameScripts = [
    { frame: 0, source: "throw new Error('Presentation must remain script-free');" },
  ];
  return p;
}
