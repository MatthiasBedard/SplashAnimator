import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { editorPreferenceDefaults } from '../apps/editor/src/editor-preferences';
import { inversePoint, matrix } from '../packages/geometry/src/affine';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { finishBrushPaint } from '../packages/geometry/src/brush-finish';
import { optimizeNewPaint } from '../packages/geometry/src/stroke-optimize';

function finish(footprint: Vector) {
  const {brushSize, brushSmoothing} = editorPreferenceDefaults;
  return finishBrushPaint([footprint], {
    brush: {...footprint, strokeWidth: brushSize}, amount: brushSmoothing / 100,
  })[0];
}

it('fits a smooth outline while retaining a small triangular hole', () => {
  const outer = Array.from({length:400}, (_, i) => ({
    x: 160 + 120 * Math.cos(i * Math.PI / 200), y: 80 + 36 * Math.sin(i * Math.PI / 200),
  }));
  const hole = [{x:160,y:80}, {x:160.002,y:80.001}, {x:160,y:80.003}];
  const footprint: Vector = {
    kind:'polygon',id:'paint',x:0,y:0,rotation:0,width:320,height:160,strokeWidth:0,
    fill:'#0066ff',stroke:'#000000',fillRule:'evenodd',closed:true,points:[],contours:[outer,hole],
  };
  const fitted = finish(footprint);
  expect(fitted.contours).toHaveLength(2);
  expect(fitted.contours![0].length).toBeLessThan(40);
  expect(fitted.contours![0].some(node => node.in || node.out)).toBe(true);
  expect(fitted.contours![1].map(({x,y}) => ({x,y}))).toEqual(hole);
});

const file = '.local-projects/simplify error.spl/vectors/4c1da6c2-4288-4f74-8ad3-91c4a2ffb46c.json';
const bytes = existsSync(file) ? readFileSync(file) : undefined;
const saved = bytes && createHash('sha256').update(bytes).digest('hex') ===
  '5cfef625742fcce2e31a7586878576230911c8d86270c995c3597293b888d38c'
  ? Object.values(JSON.parse(bytes.toString('utf8')) as Record<string,Vector[]>)[0].at(-1) : undefined;

it.skipIf(!saved)('replays default Brush finishing on the reported outline with 4,486 anchors', () => {
  const source = saved!;
  expect(source.contours!.map(ring=>ring.length)).toEqual([4325,158,3]);
  const paths = worldPaths(source, .025);
  const basis = matrix(source);
  // The project stores the optimized curves. Replay using a fine polygonal
  // footprint of that geometry, since the original nib samples are absent.
  const footprint = {...source, contours: paths.map(ring => ring.slice(0,-1).map(p=>inversePoint(basis,p)))};
  const before = structuredClone(footprint);
  const finished = finish(footprint);
  expect(finished.contours!.flat().length).toBeLessThan(400);
  const [optimized] = optimizeNewPaint([finished]);
  expect(optimized.contours!.flat().length).toBeLessThan(300);
  expect(optimized.contours).toHaveLength(3);
  const tiny = source.contours![2].map(({x,y})=>({x,y}));
  expect(optimized.contours![2].map(({x,y})=>({x,y}))).toEqual(tiny);
  const coverage = (rings: typeof paths, x:number, y:number) => rings.reduce(
    (inside,r) => inside !== containsPoint(r,{x,y}), false,
  );
  const actual = worldPaths(optimized, .025);
  const center = paths[2].slice(0,3).reduce((p,q)=>({x:p.x+q.x/3,y:p.y+q.y/3}),{x:0,y:0});
  expect(containsPoint(actual[2],center)).toBe(true);
  expect(coverage(actual,center.x,center.y)).toBe(coverage(paths,center.x,center.y));
  for (let y = -150; y < 600; y += 23) for (let x = -100; x < 1040; x += 19) {
    const painted = coverage(paths,x,y);
    if ([[x-3,y],[x+3,y],[x,y-3],[x,y+3]].every(([a,b])=>coverage(paths,a,b)===painted)) {
      expect(coverage(actual,x,y)).toBe(painted);
    }
  }
  expect(footprint).toEqual(before);
});
