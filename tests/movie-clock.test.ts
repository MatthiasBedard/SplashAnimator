import { it, expect } from 'vitest';
import { newProject, clone } from '../packages/document/src';
import { convertToSymbol } from '../packages/geometry/src/symbols';
import { createMovieClock } from '../packages/animation/src/movie-clock';
import { evaluate } from '../packages/animation/src';
it('runs movies across parent keys, loops and paused frames; resets absent instances and sessions', () => {
  const p = newProject();
  p.fps = 10;
  p.duration = 2;
  const l = p.layers[0];
  l.keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const s = convertToSymbol(p, l.id, 0, ['art'], 'Movie');
  s.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const d = p.symbols![0];
  d.timeline = {
    duration: 3,
    keys: [{ frame: 2, shapes: [{ ...clone(d.shapes[0]), fill: '#0000ff' }] }],
  };
  l.keys.push({ frame: 1, shapes: clone(l.keys[0].shapes) });
  const clock = createMovieClock();
  expect(evaluate(p, 0, clock.sample(p, 0, 0))[0].fill).toBe('#ff0000');
  clock.sample(p, 1, 0.1);
  expect(evaluate(p, 0, clock.sample(p, 0, 0.2))[0].fill).toBe('#0000ff');
  expect(evaluate(p, 0)[0].fill).toBe('#ff0000');
  expect(evaluate(p, 0, clock.sample(p, 0, 0.5))[0].fill).toBe('#0000ff');
  l.visible = false;
  clock.sample(p, 0, 0.6);
  l.visible = true;
  expect(evaluate(p, 0, clock.sample(p, 0, 0.7))[0].fill).toBe('#ff0000');
  clock.reset();
  expect(Object.values(clock.sample(p, 0, 99))).toEqual([0]);
  expect(Object.values(clock.sample(p, 0, 1))).toEqual([0]);
});
it('finds the latest reentry across skipped exposures and many root loops without stepping every frame', () => {
  const p = newProject();
  p.duration = 6;
  p.fps = 10;
  const s = {
    id: 'movie',
    kind: 'symbol' as const,
    symbolId: 'definition',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [s] },
    { frame: 2, shapes: [] },
    { frame: 4, shapes: [clone(s)] },
  ];
  const clock = createMovieClock(),
    sample = (position: number, time = position / 10) =>
      Object.values(clock.sample(p, position % 6, time, position));
  expect(sample(0)).toEqual([0]);
  expect(sample(5)).toEqual([1]);
  expect(sample(17)).toEqual([1]);
  expect(sample(6000005)).toEqual([1]);
  expect(sample(6000005, 600001)).toEqual([6]); // root paused; child still advances
  expect(sample(0, 600002)).toEqual([0]); // explicit rewind starts a session
  p.layers[0].visible = false;
  sample(2, 600003);
  p.layers[0].visible = true;
  expect(sample(5, 600004)).toEqual([0]); // visibility reentry starts now
});

it('indexes many simultaneous movie reentries while retaining continuous instances and paused clocks', () => {
  const p = newProject();
  p.duration = 100;
  p.fps = 10;
  const movies = Array.from({ length: 600 }, (_, i) => ({
    id: 'movie-' + i,
    kind: 'symbol' as const,
    symbolId: 'definition',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  }));
  p.layers[0].keys = Array.from({ length: 100 }, (_, frame) => ({
    frame,
    shapes: frame % 2 === 0 ? movies : [movies[0]],
  }));
  const clock = createMovieClock(),
    id = p.layers[0].id + '/movie-';
  clock.sample(p, 0, 0, 0);
  const result = clock.sample(p, 98, 100009.8, 1000098);
  expect(Object.keys(result)).toHaveLength(600);
  expect(result[id + '0/definition']).toBe(1000098);
  for (let i = 1; i < 600; i++) expect(result[id + i + '/definition']).toBe(0);
  const paused = clock.sample(p, 98, 100010.3, 1000098);
  expect(paused[id + '0/definition']).toBe(1000103);
  expect(paused[id + '599/definition']).toBe(5);
  const next = clock.sample(p, 0, 100010.4, 1000100);
  expect(next[id + '0/definition']).toBe(1000104);
  expect(next[id + '599/definition']).toBe(0);
});
it('isolates clocks by layer and definition across mode switches and skipped loop boundaries', () => {
  const p = newProject();
  p.duration = 4;
  p.fps = 10;
  const shape = {
    id: 'same',
    kind: 'symbol' as const,
    symbolId: 'a',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape] },
    { frame: 1, shapes: [{ ...shape, symbolPlayback: { mode: 'single', firstFrame: 0 } }] },
    { frame: 2, shapes: [{ ...shape, symbolId: 'b' }] },
  ];
  p.layers.push({
    id: 'second',
    name: 'Second',
    visible: true,
    locked: false,
    keys: [{ frame: 0, shapes: [clone(shape)] }],
  });
  const clock = createMovieClock(),
    prefix = p.layers[0].id + '/same/';
  clock.sample(p, 0, 0, 0);
  const b = clock.sample(p, 3, 0.3, 3);
  expect(b[prefix + 'a']).toBeUndefined();
  expect(b[prefix + 'b']).toBe(1);
  expect(b['second/same/a']).toBe(3);
  const a = clock.sample(p, 0, 2, 20);
  expect(a[prefix + 'a']).toBe(0);
  expect(a[prefix + 'b']).toBeUndefined();
  expect(a['second/same/a']).toBe(20);
});

it('reads only crossed exposure artwork during incremental movie playback', () => {
  const p = newProject();
  p.duration = 10000;
  p.fps = 10;
  let reads = 0;
  const movie = {
    id: 'movie',
    kind: 'symbol' as const,
    symbolId: 'definition',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = Array.from({ length: 1000 }, (_, i) => ({
    frame: i * 10,
    get shapes() {
      reads++;
      return i % 2 ? [] : [movie];
    },
  }));
  const clock = createMovieClock();
  clock.sample(p, 0, 0, 0);
  reads = 0;
  expect(Object.values(clock.sample(p, 1, 0.1, 1))).toEqual([1]);
  expect(reads).toBe(1); // No exposure boundary crossed.
  reads = 0;
  expect(Object.values(clock.sample(p, 21, 2.1, 21))).toEqual([1]);
  expect(reads).toBeLessThanOrEqual(4); // Current, two boundaries and predecessor.
  reads = 0;
  expect(Object.values(clock.sample(p, 21, 2.6, 21))).toEqual([6]);
  expect(reads).toBe(1); // Paused parent still advances its movie.
  reads = 0;
  expect(Object.values(clock.sample(p, 1, 1000000.1, 10000001))).toEqual([1]);
  expect(reads).toBeLessThanOrEqual(1001); // Many loops visit each exposure at most once.
});
