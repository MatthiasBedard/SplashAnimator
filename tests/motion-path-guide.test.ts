import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { motionPathFromGuide } from '../apps/editor/src/motion-path-guide';
import { createMotionPathSampler } from '../packages/animation/src/motion-path';
const prior = { startX: 0, startY: 0, endX: 0, endY: 0 };
const guide: Vector = {
  id: 'guide',
  kind: 'bezier',
  x: 100,
  y: 100,
  width: 60,
  height: 20,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 1,
  points: [],
  nodes: [
    { x: 0, y: 0, out: { x: 10, y: 20 } },
    { x: 30, y: 0, in: { x: 20, y: 20 }, out: { x: 40, y: 0 } },
    { x: 60, y: 0, in: { x: 50, y: 0 } },
  ],
};
it('copies transformed cubic controls, preserving independent handles and source artwork', () => {
  const source = { ...guide, transform: [2, 0, 0.5, 1] as [number, number, number, number] };
  const before = structuredClone(source);
  const path = motionPathFromGuide({ x: 100, y: 100 }, { x: 220, y: 100 }, source, prior);
  const sample = createMotionPathSampler({ x: 100, y: 100 }, { x: 220, y: 100 }, path);
  expect(sample(0.25)).toEqual({ x: 137.5, y: 115 });
  expect(sample(0.75)).toEqual({ x: 190, y: 100 });
  path.waypointTangents![0].x = 999;
  expect(source).toEqual(before);
});
it('preserves missing Bezier handles as endpoint controls and copies straight polylines', () => {
  const bare = {
    ...guide,
    nodes: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ],
  };
  const a = { x: 100, y: 100 },
    b = { x: 160, y: 100 };
  const sample = createMotionPathSampler(a, b, motionPathFromGuide(a, b, bare, prior));
  expect(sample(0.25).x).toBe(109.375);
  const line = {
    ...guide,
    kind: 'path' as const,
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 20 },
      { x: 60, y: 0 },
    ],
  };
  expect(createMotionPathSampler(a, b, motionPathFromGuide(a, b, line, prior))(0.5)).toEqual({
    x: 130,
    y: 120,
  });
});
it('rejects mismatched endpoints, closed artwork and invalid transformed coordinates atomically', () => {
  const before = structuredClone(guide),
    a = { x: 100, y: 100 },
    b = { x: 160, y: 100 };
  expect(() => motionPathFromGuide(a, { x: 161, y: 100 }, guide, prior)).toThrow(/endpoints/);
  expect(() => motionPathFromGuide(a, b, { ...guide, closed: true }, prior)).toThrow(/open/);
  expect(() => motionPathFromGuide(a, b, { ...guide, rotation: NaN }, prior)).toThrow(/finite/);
  expect(guide).toEqual(before);
});

it('applies a document-space follower offset after the guide basis and uses the transformed tangent', () => {
  const source = {...structuredClone(guide), transform:[-2,0,0.5,1] as [number,number,number,number]};
  const follower = {offset:{x:8,y:-12},tangent:true as const};
  expect(()=>motionPathFromGuide({x:108,y:88},{x:-12,y:88},source,prior,follower)).toThrow(/tangent join/);
  source.nodes![1].out={x:40,y:-20};
  const start = {x:108,y:88}, end = {x:-12,y:88};
  const path = motionPathFromGuide(start,end,source,prior,follower);
  const sample = createMotionPathSampler(start,end,path)(0.25);
  expect(sample.x).toBeCloseTo(85.5);
  expect(sample.y).toBeCloseTo(103);
  expect(Math.abs(sample.tangentAngle!)).toBeCloseTo(180);
});
