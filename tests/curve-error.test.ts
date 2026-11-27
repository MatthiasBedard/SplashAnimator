import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { createHash } from 'node:crypto';
import { fitCompoundContours } from '../packages/geometry/src/compound-fit';
import { optimizeNewPaint } from '../packages/geometry/src/stroke-optimize';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';

it('keeps sharp turns when rounding a row of shallow notches cannot be certified', () => {
  let state = 1;
  const top = Array.from({length:60}, (_,i) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return {x: i * .6, y: state / 2 ** 31};
  });
  const shape: Vector = {kind:'polygon',id:'notches',x:0,y:0,width:36,height:20,rotation:0,
    points:[],closed:true,fill:'#0055dd',stroke:'#000000',strokeWidth:0,fillRule:'evenodd',
    contours:[[...top,{x:36,y:10},{x:0,y:10}]]};
  expect(() => fitCompoundContours(worldPaths(shape,.025),.725,0,true,.725)).toThrow(/Fitted/);
  const [fitted] = optimizeNewPaint([shape]);
  expect(fitted.contours![0].length).toBeLessThan(50);
  expect(fitted.contours![0].some(node => node.in || node.out)).toBe(true);
});

const file = '.local-projects/curve error.spl/vectors/de73172d-0a95-4a87-b4b9-dd2b9cc70df0.json';
const bytes = existsSync(file) ? readFileSync(file) : undefined;
const saved = bytes && createHash('sha256').update(bytes).digest('hex') ===
  '5510380676e6b0ee44a4a3e330951a9416d54a230e7ec73ce402f29acc1be54b'
  ? Object.values(JSON.parse(bytes.toString('utf8')) as Record<string,Vector[]>) : undefined;

it.skipIf(!saved).each([[3,6166,3900],[4,4681,2700]])('fits the reported Brush outline on frame %i', (frame, original, maximum) => {
  const source = saved![frame - 1].at(-1)!;
  const before = structuredClone(source);
  const [fitted] = optimizeNewPaint([source]);
  expect(source.contours!.flat()).toHaveLength(original);
  expect(fitted.contours).toHaveLength(source.contours!.length);
  expect(fitted.contours!.flat().length).toBeLessThan(maximum);
  expect(fitted.contours!.some(r=>r.some(n=>n.in || n.out))).toBe(true);
  expect(source).toEqual(before);
  const input = worldPaths(source, .025), output = worldPaths(fitted, .025);
  // Interior witnesses well away from the outline must keep their fill parity.
  const coverage = (paths: typeof input, point: {x:number;y:number}) =>
    paths.reduce((inside, ring) => inside !== containsPoint(ring,point), false);
  for (let y = 2; y < 530; y += 19) for (let x = -170; x < 950; x += 17) {
    const point = {x,y};
    const offsets = [{x:x-1,y},{x:x+1,y},{x,y:y-1},{x,y:y+1}];
    const inside = coverage(input, point);
    if (offsets.every(probe=>coverage(input,probe)===inside)) {
      expect(coverage(output, point)).toBe(inside);
    }
  }
});
