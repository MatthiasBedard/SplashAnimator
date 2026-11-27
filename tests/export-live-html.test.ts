import { expect, it } from 'vitest';
import { exportHTML } from '../packages/export-web/src';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { prepareCreateLiveMotionSpans } from '../packages/animation/src/live-motion';
import { newProject } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { livePresentationFixture } from './live-motion-presentation-fixture';
import { liveMovieTreesFixture } from './live-movie-trees-fixture';

function compiled(html: string) {
  return JSON.parse(html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')));
}

it('exports one graphic definition and separate affine placements for a live tween', () => {
  const project = newProject();
  project.duration = 5;
  const definition = {
    id: 'graphic', name: 'Graphic', width: 20, height: 20,
    shapes: [{
      id: 'artwork', kind: 'rectangle' as const, x: 0, y: 0, width: 20, height: 20,
      rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
    }],
  };
  project.symbols = [definition];
  const layer = project.layers[0];
  const instance = symbolInstance(definition, 0, 0);
  layer.keys = [{ frame: 0, shapes: [instance] }, { frame: 4, shapes: [{ ...instance, x: 80 }] }];
  const tween = prepareCreateLiveMotionSpans(project, [{
    layerId: layer.id, span: { id: 'tween', start: 0, end: 4, ease: 'linear', symbolContinuity: 'graphics' },
  }]);
  const data = compiled(exportHTML(tween));
  expect(data.sharedArtwork).toHaveLength(1);
  expect(data.sharedArtwork[0].poses[0]).toMatchObject([{ id: 'artwork', x: 0 }]);
  expect(data.layers[0].keys.map((key: { shapes: unknown[] }) => key.shapes)).toEqual(
    [0, 20, 40, 60, 80].map(x => [{ sharedSymbol: 0, placement: [1, 0, 0, 1, x, 0], opacity: 1, localFrame: 0 }]),
  );
});

it('compiles live interior keys at exact frame times without editing the source or moving held keys', () => {
  const project = livePresentationFixture();
  project.layers[0].locked = true;
  const original = structuredClone(project);
  const data = compiled(exportHTML(project));
  expect(data.layers[0].liveMotionSpans).toBeUndefined();
  expect(data.layers[0].keys.map((key: {frame: number}) => key.frame)).toEqual([0, 1, 2, 3, 4, 8]);
  expect(data.layers[0].keys[2].shapes[0].x).toBe(40);
  expect(data.layers[0].keys.at(-1).shapes).toEqual([]);
  expect(project).toEqual(original);
  expect(() => exportHTML(project, 'sequence')).toThrow('Live ranges');
});

it('preserves the nested movie clock plan across generated HTML keys', () => {
  const project = liveMovieTreesFixture('plain', 'loop');
  const data = compiled(exportHTML(project));
  expect(data.clockPlan).toEqual(compileMovieClockPlan(project));
  expect(data.layers[0].keys.map((key: {frame: number}) => key.frame)).toContain(6);
});

it('rejects an invalid visible live pose while skipping hidden live artwork', () => {
  const project = livePresentationFixture();
  project.layers[0].keys[1].shapes[0].height += 1;
  expect(() => exportHTML(project)).toThrow('same ordered artwork');
  project.layers[0].visible = false;
  const data = compiled(exportHTML(project));
  expect(data.layers[0].visible).toBe(false);
  expect(data.layers[0].keys.map((key: {frame: number}) => key.frame)).toEqual([0, 4, 8]);
});

it('samples live shape dimensions with the same export route', () => {
  const project = livePresentationFixture();
  project.layers[0].liveMotionSpans![0].options = { primitives: true };
  project.layers[0].keys[1].shapes[0].width = 40;
  const middle = compiled(exportHTML(project)).layers[0].keys[2];
  expect(middle.shapes[0]).toMatchObject({ x: 40, width: 30 });
});

it('checks the generated shape budget before allocating the frame range', () => {
  const project = livePresentationFixture();
  project.duration = 100000;
  project.layers = [project.layers[0]];
  const layer = project.layers[0];
  layer.keys = layer.keys.slice(0, 2);
  layer.keys[1].frame = project.duration - 1;
  for (const key of layer.keys)
    key.shapes = Array.from({ length: 11 }, (_, index) => ({ ...key.shapes[0], id: `shape-${index}` }));
  layer.liveMotionSpans![0].end = project.duration - 1;
  expect(() => exportHTML(project)).toThrow('one million compiled shapes');
  expect(layer.keys).toHaveLength(2);
});
