import { expect, it } from 'vitest';
import { newProject, validateProject, type SymbolDefinition, type Vector } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { generateMotionFrames, generateSymbolMotionFrames, sampleMotionFrame } from '../packages/animation/src/motion-frames';

function fixture(movie = false) {
  const project = newProject();
  const layer = project.layers[0];
  const art: Vector = {
    id: 'art', kind: 'rectangle', x: 0, y: 0, width: 40, height: 40,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  const symbol: SymbolDefinition = { id: 'child', name: 'Child', width: 40, height: 40, shapes: [art] };
  project.symbols = [symbol];
  project.duration = 12;
  const instance = symbolInstance(symbol, 20, 30);
  if (movie) instance.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const from = { ...instance, opacity: 1, instanceTint: { color: '#ff0000', amount: 1 }, instanceBlur: 4, instanceBlend: 'multiply' as const };
  const to = { ...instance, x: 100, opacity: 0.2, instanceTint: { color: '#0000ff', amount: 0.2 }, instanceBlur: 12, instanceBlend: 'screen' as const };
  layer.keys = [{ frame: 0, shapes: [from] }, { frame: 8, shapes: [to] }, { frame: 10, shapes: [] }];
  return { project, layer, from, to, symbol, art };
}

for (const movie of [false, true]) {
  it(`samples and bakes symbol effects while retaining ${movie ? 'movie' : 'graphic'} playback`, () => {
    const { project, layer, from, to } = fixture(movie);
    const recipe = { start: 0, end: 8, ease: 'linear', symbolContinuity: movie ? 'movies' : 'graphics' } as const;
    const [middle] = sampleMotionFrame(project, layer.id, recipe, 4);
    expect(middle).toMatchObject({
      x: 60, opacity: 0.6, instanceTint: { color: '#800080', amount: 0.6 }, instanceBlur: 8, instanceBlend: 'multiply',
    });
    if (movie) expect(middle.symbolPlayback).toEqual(from.symbolPlayback);
    expect(sampleMotionFrame(project, layer.id, recipe, 0)).toEqual([from]);
    expect(sampleMotionFrame(project, layer.id, recipe, 8)).toEqual([to]);
    generateMotionFrames(project, [layer.id], 0, 8, 'linear');
    expect(layer.keys.find(key => key.frame === 4)!.shapes[0]).toEqual(middle);
    expect(layer.keys.at(-1)).toEqual({ frame: 10, shapes: [] });
    expect(() => validateProject(project)).not.toThrow();
  });
}

it('tweens from neutral effect values inside a symbol and leaves an unconfigured authored endpoint exact', () => {
  const { project, layer, from, to, symbol } = fixture();
  delete (from as Partial<typeof from>).opacity;
  delete (from as Partial<typeof from>).instanceTint;
  delete (from as Partial<typeof from>).instanceBlur;
  delete (from as Partial<typeof from>).instanceBlend;
  const outer = { ...symbol, id: 'outer', shapes: [from], timeline: { duration: 12, keys: layer.keys.slice(1) } };
  const result = generateSymbolMotionFrames(
    outer, ['@base'], 0, 8, 'in', false, false, false, undefined, false, false, [outer, symbol],
  );
  const key = result.timeline!.keys.find(pose => pose.frame === 4)!;
  const middle = key.shapes[0];
  expect(middle.opacity).toBeCloseTo(0.8);
  expect(middle.instanceBlur).toBe(3);
  expect(middle.instanceTint).toEqual({ color: '#0000ff', amount: 0.05 });
  expect(middle.instanceBlend).toBeUndefined();
  expect(result.shapes).toEqual([from]);
  expect(result.timeline!.keys.find(pose => pose.frame === 8)!.shapes).toEqual([to]);
  expect(project.symbols).toEqual([symbol]);
});

it('rejects malformed effect endpoints before writing tracks or executing accessors', () => {
  const { project, layer, to } = fixture();
  to.instanceTint.amount = Infinity;
  const invalid = structuredClone(project);
  expect(() => generateMotionFrames(project, [layer.id], 0, 8, 'linear')).toThrow('Invalid symbol motion tint');
  expect(project).toEqual(invalid);
  to.instanceTint.amount = 0.4;
  let reads = 0;
  Object.defineProperty(to, 'instanceBlur', { enumerable: true, get() { reads++; return 4; } });
  expect(() => sampleMotionFrame(project, layer.id, { start: 0, end: 8, ease: 'linear' }, 4)).toThrow('original data values');
  expect(reads).toBe(0);
});
