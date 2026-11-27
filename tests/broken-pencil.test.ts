import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { certifySimpleCurveWalks } from '../packages/geometry/src/compound-fit';
import type { Cubic } from '../packages/geometry/src/curve-fit';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { prepareSharedPaintStack } from '../packages/geometry/src/shared-paint-cut';
import { mergeControlBounds } from '../packages/geometry/src/merge';
import { brokenFrame } from './broken-drawing-fixture';

const point = (x: number, y: number) => ({ x, y });
const fill: Vector = {
  id: 'curved-paint', kind: 'polygon', x: 0, y: 0, width: 120, height: 100,
  rotation: 0, points: [], drawingMode: 'merge', strokeWidth: 0, fill: '#662299', stroke: '#222222',
  closed: true, fillRule: 'evenodd',
  contours: [[{ x: 0, y: 0, out: point(-18,35) }, { x: 100, y: 0, in: point(82,45) },
    point(100,-60), point(0,-60)]],
};

it('Pencil partitions a closed paint face whose simple top arc doubles back along its chord', () => {
  const ink: Vector = { ...fill, id:'pencil', kind:'path', contours:undefined, closed:false, strokeWidth:2,
    fillEnabled:false, points:[point(-40,-30),point(140,-30)] };
  const cut = prepareSharedPaintStack([fill],ink,'ink');
  const pieces = cut?.background.get(fill);
  expect(cut?.strokes).toHaveLength(3);
  expect(pieces).toHaveLength(2);
  // The proof subdivisions are private. The entire unaffected top cubic
  // survives as one curve on one of the two faces.
  const curves = pieces!.flatMap(s => s.contours!.flatMap(ring => ring.flatMap((n,i) => {
    const end = ring[(i+1)%ring.length];
    if (!n.out || !end.in) return [];
    return [[n,n.out,end.in,end].map(p=>point(s.x+p.x,s.y+p.y))];
  })));
  const original = [point(0,0),point(-18,35),point(82,45),point(100,0)];
  expect(curves).toHaveLength(1);
  expect([original,original.slice().reverse()]).toContainEqual(curves[0]);
});

it('closed span proof still rejects a self-crossing folded cubic', () => {
  const p = point(0,0), q = point(40,0), r = point(40,-60), s = point(0,-60);
  const curve: Cubic = [p,point(90,90),point(-50,90),q];
  const line = (a: Point,b: Point): Cubic => [a,a,b,b];
  expect(() => certifySimpleCurveWalks([[curve,line(q,r),line(r,s),line(s,p)]],
    true,1e-12,true,true,()=>{},true)).toThrow(/cross|separated/);
});

const broken = brokenFrame();

it.skipIf(!broken)('cuts both colors with the saved last Pencil in broken', () => {
  const saved = broken!;
  const shapes = saved.slice(0,-1), ink = saved.at(-1)!;
  expect(ink.id).toBe('cf286783-9623-4b0c-af93-c228ef176d52');
  const result = prepareShapeDrawing(shapes,{shape:ink,merge:true});
  expect(result.retainedOverlap).toBeUndefined();
  // The new line is cut where it crosses other lines (and cuts them), never by paint edges.
  const inkBefore = shapes.filter(s=>s.strokeWidth).length, inkAfter = result.shapes.filter(s=>s.strokeWidth);
  expect(inkAfter.length).toBeGreaterThan(inkBefore);
  expect(inkAfter.every(s=>s.fillEnabled===false)).toBe(true);
  const index = (art: Vector[]) => art.filter(s => !s.strokeWidth).map(s=>({s,b:mergeControlBounds(s),rings:worldPaths(s,.0001)}));
  const before = index(shapes), after = index(result.shapes);
  expect(before).toHaveLength(185);
  // The cut divides paint it crosses; matching neighbours it reaches may also join.
  expect(after.length).toBeGreaterThan(before.length);
  // Pieces in the layer's own basis have their box from their controls (`controlBounds`).
  const owners = (data: ReturnType<typeof index>,p: Point) => data.filter(({b})=>{
    return p.x>=b.left && p.x<=b.right && p.y>=b.top && p.y<=b.bottom;
  }).filter(({rings})=>
    rings.reduce((inside,r)=>inside!==containsPoint(r,p),false)).map(e=>e.s);
  for (const [a,b] of [[point(387.43,246.57),point(393.43,246.57)], [point(691.43,300.57),point(685.43,302.57)]]) {
    expect(owners(before,a).map(s=>s.id)).toEqual(owners(before,b).map(s=>s.id));
    expect(owners(after,a)).toHaveLength(1);
    expect(owners(after,b)).toHaveLength(1);
    expect(owners(after,a)[0].id).not.toBe(owners(after,b)[0].id);
  }
  for (let y=240.57; y<520; y+=2) for (let x=345.43; x<790; x+=2) {
    const p = point(x,y);
    // The visible colour is unchanged, and the saved overlaps of matching paint are flattened
    // into one owner.
    const visible = (data: ReturnType<typeof index>) => owners(data,p).at(-1)?.fill;
    if (visible(before)!==visible(after)) throw Error('Paint colour changed at '+JSON.stringify(p));
    if (owners(after,p).length>1) throw Error('Overlapping paint owners at '+JSON.stringify(p));
  }
});
