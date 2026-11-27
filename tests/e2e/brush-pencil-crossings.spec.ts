import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { newProject, validateProject, type Point, type Project, type SymbolDefinition, type Vector } from '../../packages/document/src';
import { hit, worldPoint } from '../../packages/geometry/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { prepareShapeDrawing } from '../../packages/geometry/src/shape-drawing';
import { preparePlacedFilledInk } from '../../packages/geometry/src/placed-filled-ink';
import { prepareBrushPaint } from '../../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../../packages/geometry/src/pencil-drawing';
import { circleSamples, spiralSamples, zigzagSamples } from '../spiral-zigzag-fixture';
import { diagonalScribble, pencilWave, sampledStar, starCorners, verticalWave } from '../crosshatched-paint-fixture';
import { arc, horizontal, vertical } from '../brush-overpaint-fixture';
import { anotherMergeFailFrame, brokenFrame, mergeFailFrame, mergeFailThreeFrame, selectFailFrame } from '../broken-drawing-fixture';
import { adjacentPrecisionBoundaries, consecutiveCurvedInkCoordinates, consecutiveInkCoordinates, consecutiveObliqueInkCoordinates, consecutiveObliquePaintBoundaries, crossingCompoundPair, mixedObliqueInkCrossings, nearbySavedPencilCrossings, subpixelPencilAcrossOrigin, subpixelPencilPiece, twoGroupsOfObliqueInkCrossings } from '../drawing-crossing-contours-fixture';

async function openMergeStage(page: Page, width = 400, height = 320, shapes: Vector[] = []) {
  const project = newProject();
  project.width = width; project.height = height; project.layers[0].drawingMode = 'merge';
  project.layers[0].keys[0].shapes = shapes;
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1', JSON.stringify({project:p, folder:null, manifest:null})), project);
  await page.goto('/');
  await page.getByRole('button', {name:'Recover changes', exact:true}).click();
  await page.getByRole('combobox', {name:'Zoom', exact:true}).selectOption('1');
  const canvas = page.getByLabel('Drawing stage'), box = (await canvas.boundingBox())!;
  const at = (p: Point) => [box.x+(box.width-width)/2+p.x, box.y+(box.height-height)/2+p.y] as const;
  const draw = async (points: Point[]) => {
    await page.mouse.move(...at(points[0]));
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...at(p));
    await page.mouse.up();
  };
  const read = () => page.evaluate(() => (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const pixel = (p: Point) => canvas.evaluate((node,{p,width,height}) => {
    const c = node as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData((c.width-width)/2+p.x,(c.height-height)/2+p.y,1,1).data];
  },{p,width,height});
  return { canvas, at, draw, read, pixel };
}

for (const optimize of [false, true]) test('Pencil preserves distinct straight contacts with Optimize ' + optimize, async ({page}) => {
  const { horizontal, second } = consecutiveInkCoordinates();
  const authoredLine:Vector = {
    ...horizontal, kind:'bezier', points:[],
    nodes:[{x:0,y:0,out:{x:20,y:0}},{x:60,y:0,in:{x:40,y:0}}],
  };
  const f = await openMergeStage(page,400,320,[authoredLine,second]);
  const before = await f.read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).setChecked(optimize);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await page.getByLabel('Drawing stroke',{exact:true}).fill('#e23257');
  await f.draw([{x:50,y:5},{x:50,y:22},{x:50,y:74},{x:50,y:95}]);
  const drawn = async ()=>(await f.read()).filter(s=>s.stroke==='#e23257');
  await expect.poll(async()=> (await drawn()).length).toBe(3);
  const settled = await f.read();
  expect((await drawn()).map(s=>s.y)).toEqual([5,horizontal.y,second.y]);
  expect((await drawn())[1].height).toBe(second.y-horizontal.y);
  expect(settled.filter(s=>s.stroke==='#222222')).toHaveLength(4);
  await expect.poll(()=>f.pixel({x:50,y:62})).toEqual([226,50,87,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('Pencil keeps two neighboring cubic junctions editable after release', async ({page}) => {
  const { first, second, pencil, junctions } = consecutiveCurvedInkCoordinates();
  const f = await openMergeStage(page, 400, 320, [first, second]);
  const before = await f.read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).setChecked(true);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await page.getByLabel('Drawing stroke',{exact:true}).fill('#e23257');
  await f.draw([5, 22, 80, 125].map(x => ({ x, y: pencil.y })));
  const incoming = async () => (await f.read()).filter(shape => shape.stroke === '#e23257');
  await expect.poll(incoming).toHaveLength(3);
  const settled = await f.read();
  expect((await incoming()).map(shape => ({ x: shape.x, y: shape.y }))).toEqual([
    { x: pencil.x, y: pencil.y }, ...junctions,
  ]);
  expect((await incoming())[1].width).toBe(junctions[1].x - junctions[0].x);
  const arcs = settled.filter(shape => shape.stroke === '#222222');
  expect(arcs).toHaveLength(4);
  expect(arcs.every(arc => arc.kind === 'bezier' && arc.nodes?.some(node => node.in || node.out))).toBe(true);
  expect(junctions.map(junction => arcs.filter(arc => arc.nodes?.some(node =>
    arc.x + node.x === junction.x && arc.y + node.y === junction.y)).length)).toEqual([2, 2]);
  await expect.poll(() => f.pixel({x:72,y:pencil.y})).toEqual([226,50,87,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('Pencil saves distinct oblique Bézier junctions after one release', async ({page}) => {
  const { first, second, pencil, junctions } = consecutiveObliqueInkCoordinates();
  const untouched: Vector = { ...first, id: 'protected-arc', x: 250 };
  const f = await openMergeStage(page, 400, 320, [first, second, untouched]);
  const before = await f.read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).setChecked(false);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await page.getByLabel('Drawing stroke',{exact:true}).fill('#e23257');
  await f.draw(pencil.points.map(point => worldPoint(pencil, point)));
  const incoming = async () => (await f.read()).filter(shape => shape.stroke === '#e23257');
  await expect.poll(incoming).toHaveLength(3);
  const settled = await f.read();
  const middle = (await incoming())[1];
  expect(middle.kind).toBe('path');
  expect(middle.points.map(point => worldPoint(middle, point))).toEqual(junctions);
  const arcs = settled.filter(shape => shape.stroke === first.stroke && shape.id !== untouched.id);
  expect(arcs).toHaveLength(4);
  expect(arcs.every(arc => arc.kind === 'bezier' && arc.nodes?.some(n => n.in || n.out))).toBe(true);
  for (const junction of junctions) {
    expect(arcs.filter(arc => arc.nodes?.some(node => {
      const point = worldPoint(arc, node);
      return point.x === junction.x && point.y === junction.y;
    }))).toHaveLength(2);
  }
  expect(settled.find(shape => shape.id === untouched.id)).toEqual(untouched);
  await expect.poll(() => f.pixel({x:90,y:77})).toEqual([226,50,87,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('Pencil splits two paint colors across a microscopic gap without welding their curves', async ({page}) => {
  const { left, right, pencil, junctions } = consecutiveObliquePaintBoundaries();
  const f = await openMergeStage(page, 400, 320, [left, right]);
  const before = await f.read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).setChecked(false);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await page.getByLabel('Drawing stroke',{exact:true}).fill('#e23257');
  await f.draw(pencil.points.map(point => worldPoint(pencil, point)));
  const strokes = async () => (await f.read()).filter(shape => shape.stroke === '#e23257');
  await expect.poll(strokes).toHaveLength(5);
  const gap = (await strokes())[2], settled = await f.read();
  expect(gap.kind).toBe('path');
  expect(gap.points.map(point => worldPoint(gap, point))).toEqual(junctions);
  const paint = settled.filter(shape => !shape.strokeWidth);
  expect(paint.map(shape => shape.fill).sort()).toEqual([right.fill, right.fill, left.fill, left.fill]);
  expect(paint.every(shape => shape.contours?.some(ring => ring.some(node => node.in || node.out)))).toBe(true);

  const samples = [{x:25,y:32},{x:25,y:92},{x:80,y:38},{x:80,y:95}];
  const counts = async () => {
    const current = (await f.read()).filter(shape => !shape.strokeWidth);
    return samples.map(point => current.filter(shape => hit(shape, point, 0)).length);
  };
  expect(await counts()).toEqual([1,1,1,1]);
  await expect.poll(() => f.pixel(samples[0])).toEqual([102,68,204,255]);
  await expect.poll(() => f.pixel(samples[2])).toEqual([34,136,85,255]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at(samples[0]));
  await f.canvas.press('Delete');
  await expect.poll(counts).toEqual([0,1,1,1]);
  await expect.poll(() => f.pixel(samples[0])).toEqual([255,255,255,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(settled);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('one Pencil release preserves two groups of neighboring cubic junctions', async ({page}) => {
  const { arcs, pencil, junctions } = twoGroupsOfObliqueInkCrossings();
  const f = await openMergeStage(page, 400, 320, arcs);
  const before = await f.read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).setChecked(false);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await page.getByLabel('Drawing stroke',{exact:true}).fill('#e23257');
  await f.draw(pencil.points.map(point => worldPoint(pencil, point)));
  const strokes = async () => (await f.read()).filter(shape => shape.stroke === '#e23257');
  await expect.poll(strokes).toHaveLength(5);
  const settled = await f.read();
  expect((await strokes()).slice(1).map(shape => worldPoint(shape, shape.points[0]))).toEqual(junctions);
  const halves = settled.filter(shape => shape.stroke === '#222222');
  expect(halves).toHaveLength(8);
  expect(halves.every(shape => shape.kind === 'bezier' && shape.nodes?.some(node => node.in || node.out))).toBe(true);
  for (const junction of junctions) {
    expect(halves.filter(shape => shape.nodes?.some(node => {
      const p = worldPoint(shape, node);
      return p.x === junction.x && p.y === junction.y;
    }))).toHaveLength(2);
  }
  await expect.poll(() => f.pixel({x:150,y:131})).toEqual([226,50,87,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('Pencil preserves separate same-x knots and one proven shared straight crossing', async ({page}) => {
  const { curves, straight, pencil, junctions } = mixedObliqueInkCrossings();
  const f = await openMergeStage(page, 400, 320, [...curves, ...straight]);
  const before = await f.read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).setChecked(false);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await page.getByLabel('Drawing stroke',{exact:true}).fill('#e23257');
  await f.draw(pencil.points.map(point => worldPoint(pencil, point)));
  const strokes = async () => (await f.read()).filter(shape => shape.stroke === '#e23257');
  await expect.poll(strokes).toHaveLength(6);
  const settled = await f.read(), incoming = await strokes();
  expect(incoming.slice(1).map(shape => worldPoint(shape, shape.points[0]))).toEqual(junctions);
  expect(incoming[1].width).toBe(0);
  expect(incoming[1].height).toBeGreaterThan(0);
  for (const owner of straight) {
    const pieces = settled.filter(shape => shape.stroke === owner.stroke);
    expect(pieces).toHaveLength(2);
    expect(pieces.every(shape => shape.points.some(point => {
      const p = worldPoint(shape, point);
      return p.x === 180 && p.y === 26;
    }))).toBe(true);
  }
  expect(settled.filter(shape => shape.stroke === curves[0].stroke && shape.kind === 'bezier')).toHaveLength(8);
  await expect.poll(() => f.pixel({x:230,y:51})).toEqual([226,50,87,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('Pencil keeps close rounded junctions separate through both saved filled boundaries', async ({ page }) => {
  const saved = anotherMergeFailFrame();
  test.skip(!saved, 'Requires the pinned saved revision');
  const ids = ['c7af1829-7c43-4929-b150-9afb16df1407', 'fc1aa69c-3be4-4a43-8b25-01b43b51e05f'];
  const local = ids.map(id => {
    const shape = saved!.find(s => s.id === id)!;
    const place = (point: Point) => {
      const p = worldPoint(shape, point);
      return { x: p.x - 224, y: p.y - 188 };
    };
    return { ...shape, x: 0, y: 0, contours: shape.contours!.map(ring => ring.map(node => ({
      ...place(node), ...(node.in && { in: place(node.in) }), ...(node.out && { out: place(node.out) }),
    }))) };
  });
  const f = await openMergeStage(page, 300, 200, local);
  const before = await f.read();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await page.getByLabel('Pencil mode', { exact: true }).selectOption('ink');
  await page.getByLabel('Pencil optimize', { exact: true }).setChecked(false);
  await page.getByLabel('Drawing stroke width', { exact: true }).fill('2');
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#e23257');
  await f.draw([{ x: -24, y: -18 }, { x: 51, y: 37 }]);
  const ink = async () => (await f.read()).filter(s => s.strokeWidth > 0);
  await expect.poll(ink).toHaveLength(11);
  const tiny = (await ink())[6];
  const ends = tiny.points.map(p => worldPoint(tiny, p));
  expect(ends[1].x).toBeGreaterThanOrEqual(ends[0].x);
  expect(ends[1].y).toBeGreaterThanOrEqual(ends[0].y);
  expect(ends[1]).not.toEqual(ends[0]);
  const drawn = await f.read();
  expect(drawn.filter(s => s.strokeWidth === 0)).toHaveLength(8);
  await expect.poll(() => f.pixel({ x: 39, y: 28 })).toEqual([226, 50, 87, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(drawn);
});

test('Pencil release preserves the reduced saved crossing interval and both old owners', async ({page}) => {
  const { arcs, pencil } = nearbySavedPencilCrossings(224);
  const f = await openMergeStage(page, 300, 200, arcs);
  const before = await f.read();
  await page.getByRole('button', {name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode', {exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize', {exact:true}).setChecked(false);
  await page.getByLabel('Drawing stroke width', {exact:true}).fill('2');
  await page.getByLabel('Drawing stroke', {exact:true}).fill('#228855');
  await f.draw(pencil.points);
  const incoming = async () => (await f.read()).filter(shape => shape.stroke === '#228855');
  await expect.poll(incoming).toHaveLength(3);
  const settled = await f.read(), middle = (await incoming())[1];
  const knots = middle.points.map(p => worldPoint(middle, p));
  expect(middle.kind).toBe('path');
  expect(knots[1].x).toBeGreaterThan(knots[0].x);
  expect(knots[1].y).toBeGreaterThan(knots[0].y);
  for (const [i, arc] of arcs.entries()) {
    const halves = settled.filter(shape => shape.stroke === arc.stroke);
    expect(halves).toHaveLength(2);
    expect(halves.map(shape => shape.nodes?.map(p => worldPoint(shape, p)))).toEqual([
      [worldPoint(arc, arc.nodes![0]), knots[i]],
      [knots[i], worldPoint(arc, arc.nodes![1])],
    ]);
  }
  await expect.poll(() => f.pixel({x:36,y:26})).toEqual([34,136,85,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('dense saved Pencil recovery returns one stroke and preserves the layer through Undo and Redo', async ({page}) => {
  const saved = anotherMergeFailFrame();
  test.skip(!saved, 'Requires the pinned saved drawing.');
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }) => {
          const result = data?.result;
          if (result?.retainedOverlap === true && result.shape?.stroke === '#e23257')
            sessionStorage.setItem('pencil-recovery-reply', JSON.stringify(result));
        });
      }
    };
  });
  const f = await openMergeStage(page, 960, 540, saved!);
  const before = await f.read();
  await page.getByRole('button', {name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode', {exact:true}).selectOption('smooth');
  await page.getByLabel('Pencil optimize', {exact:true}).setChecked(false);
  await page.getByLabel('Drawing stroke width', {exact:true}).fill('2');
  await page.getByLabel('Drawing stroke', {exact:true}).fill('#e23257');
  await f.draw([{x:130,y:200}, {x:200,y:170}, {x:275,y:225}, {x:365,y:172}]);
  await expect.poll(async () => (await f.read()).length).toBe(before.length + 1);
  const written = await f.read();
  const reply = await page.evaluate(() => JSON.parse(sessionStorage.getItem('pencil-recovery-reply')!));
  expect(reply).toEqual({ shape: written.at(-1), retainedOverlap: true });
  expect(written.slice(0, -1)).toEqual(before);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(written);
});

test('a distant Brush release keeps every saved mixed drawing root exact', async ({page}) => {
  const saved = anotherMergeFailFrame();
  test.skip(!saved, 'Requires the pinned saved drawing.');
  const f = await openMergeStage(page, 960, 540, saved);
  const before = await f.read();
  await page.getByRole('button', { name:'Brush', exact:true }).click();
  await page.getByLabel('Brush size', { exact:true }).fill('8');
  await page.getByLabel('Drawing fill', { exact:true }).fill('#b3a932');
  await f.draw([{ x:450, y:40 }, { x:450, y:120 }]);
  await expect.poll(async () => (await f.read()).length).toBe(before.length + 1);
  const written = await f.read();
  expect(written.slice(0, -1)).toEqual(before);
  expect(written.at(-1)?.fill).toBe('#b3a932');
  await expect.poll(() => f.pixel({ x:450, y:80 })).toEqual([179,169,50,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(written);
});

function reopenedFilledInk(saved: Vector[]) {
  const ids = ['c7af1829-7c43-4929-b150-9afb16df1407', 'fc1aa69c-3be4-4a43-8b25-01b43b51e05f'];
  const owners = ids.map(id => saved.find(s => s.id === id)!);
  const pencil: Vector = { id: 'reopened-ink', kind: 'path', x: 200, y: 170, width: 75, height: 55,
    rotation: 0, strokeWidth: 3, stroke: '#e23257', fill: '#6d5efc', fillEnabled: false,
    points: [{x:0,y:0}, {x:75,y:55}], drawingMode: 'merge' };
  const cut = preparePlacedFilledInk(owners, pencil, { x: 224.5, y: 188 })!;
  const shapes = [...owners.flatMap(owner => cut.fills.get(owner)!), ...cut.ink].map(p => p.vector);
  return { shapes, narrow: cut.ink[6].vector };
}

test('a second Pencil cut keeps both near-coincident vertices in reopened paint', async ({page}) => {
  const saved = anotherMergeFailFrame();
  test.skip(!saved, 'Requires the pinned saved drawing.');
  const { shapes, narrow: oldNarrow } = reopenedFilledInk(saved!);
  const f = await openMergeStage(page, 400, 320, shapes);
  await expect.poll(() => f.pixel({ x: 245, y: 203 })).toEqual([226, 50, 87, 255]);
  await expect.poll(() => f.pixel({ x: 224, y: 188 })).toEqual([226, 50, 87, 255]);
  expect(await f.read()).toEqual(shapes);

  await page.getByRole('button', {name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode', {exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize', {exact:true}).uncheck();
  await page.getByLabel('Drawing stroke width', {exact:true}).fill('2');
  await page.getByLabel('Drawing stroke', {exact:true}).fill('#228855');
  await f.draw([{ x: 218, y: 155 }, { x: 218, y: 215 }]);
  await expect.poll(async () => (await f.read()).filter(s => s.stroke === '#228855')).toHaveLength(8);
  const settled = await f.read();
  expect(settled).toHaveLength(31);
  expect(settled.filter(s => s.fillEnabled !== false)).toHaveLength(11);
  const narrow = settled.find(s => s.stroke === '#228855' && s.points[0]?.y === 3.644264449035431);
  expect(narrow?.points).toEqual([{ x: -6.5, y: 3.644264449035431 }, { x: -6.5, y: 3.6442644490354374 }]);
  expect(settled.find(s => s.id === oldNarrow.id)).toEqual(oldNarrow);
  await expect.poll(() => f.pixel({ x: 218, y: 160 })).toEqual([34, 136, 85, 255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(shapes);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('matching Brush paint joins reopened faces while preserving the covered Pencil line', async ({page}) => {
  const saved = anotherMergeFailFrame();
  test.skip(!saved, 'Requires the pinned saved drawing.');
  const { shapes, narrow } = reopenedFilledInk(saved!);
  const f = await openMergeStage(page, 400, 320, shapes);
  const before = await f.read();
  const gesture = [{ x:224, y:153 }, { x:224, y:233 }];
  await page.getByRole('button', { name:'Brush', exact:true }).click();
  await page.getByLabel('Brush size', { exact:true }).fill('8');
  await page.getByLabel('Drawing fill', { exact:true }).fill(shapes[3].fill);
  const remove = page.getByRole('checkbox', {name:'Remove covered lines', exact:true});
  await remove.uncheck();
  await f.draw(gesture);
  await expect.poll(f.read).not.toEqual(before);
  const colorsAt = async (p: Point) => (await f.read()).filter(s => s.fillEnabled !== false && hit(s, p, 0)).map(s => s.fill);
  await expect.poll(() => colorsAt({ x:224, y:199 })).toEqual([shapes[3].fill]);
  const written = await f.read();
  expect(written.find(s => s.id === narrow.id)).toEqual(narrow);
  expect(written.find(s => s.id === before[0].id)).toEqual(before[0]);
  await expect.poll(() => f.pixel({ x:224, y:188 })).toEqual([226,50,87,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(written);
  await page.getByRole('button', {name:'Selection', exact:true}).click();
  await page.mouse.click(...f.at({ x:224, y:199 }));
  await f.canvas.press('Delete');
  await expect.poll(() => colorsAt({ x:224, y:199 })).toEqual([]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(written);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await page.getByRole('button', { name:'Brush', exact:true }).click();
  await remove.check();
  await f.draw(gesture);
  await expect.poll(async () => (await f.read()).some(s => s.id === narrow.id)).toBe(false);
  await expect.poll(() => f.pixel({ x:224, y:188 })).toEqual([109,94,252,255]);
});

test('marquee and Eraser can remove reopened round Pencil ink with a subpixel centerline', async ({page}) => {
  const tiny = subpixelPencilPiece();
  const protectedInk: Vector = { ...tiny, id:'protected-ink', x:250, width:40, height:0,
    stroke:'#223355', points:[{x:0,y:0},{x:40,y:0}] };
  const f = await openMergeStage(page, 400, 320, [tiny, protectedInk]);
  const before = await f.read();
  expect(before[0]).toEqual(tiny);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await f.draw([{x:110,y:103},{x:147,y:138}]);
  await expect(page.getByText('Paint region ready: copy, cut or move.')).toBeVisible();
  await f.canvas.press('Delete');
  await expect.poll(f.read).toEqual([before[1]]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);

  await page.getByRole('button',{name:'Eraser',exact:true}).click();
  await page.getByLabel('Eraser mode',{exact:true}).selectOption('strokes');
  await page.getByLabel('Eraser diameter',{exact:true}).fill('32');
  await f.draw([{x:123,y:120},{x:135,y:120}]);
  await expect.poll(f.read).toEqual([before[1]]);
  await expect.poll(() => f.pixel({x:266,y:121})).toEqual([34,51,85,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual([before[1]]);
});

test('marquee removes only the selected half of a reopened subpixel Pencil stroke', async ({page}) => {
  const tiny = subpixelPencilAcrossOrigin();
  const protectedInk: Vector = { ...tiny, id:'protected-ink', x:250, width:40, height:0,
    stroke:'#223355', points:[{x:0,y:0},{x:40,y:0}] };
  const f = await openMergeStage(page, 400, 320, [tiny, protectedInk]);
  const before = await f.read();
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await f.draw([{x:110,y:102},{x:129,y:140}]);
  await expect(page.getByText('Paint region ready: copy, cut or move.')).toBeVisible();
  await f.canvas.press('Delete');
  const ink = async () => (await f.read()).find(s => s.stroke === tiny.stroke);
  await expect.poll(async () => (await ink())?.points).toEqual([{x:0,y:0},tiny.points[1]]);
  const settled = await f.read(), piece = (await ink())!;
  expect(piece.kind).toBe('path');
  expect([piece.x,piece.y,piece.width,piece.height,piece.strokeWidth])
    .toEqual([tiny.x,tiny.y,tiny.width/2,tiny.height/2,tiny.strokeWidth]);
  expect(settled.find(s => s.id === protectedInk.id)).toEqual(before[1]);
  await expect.poll(() => f.pixel({x:266,y:121})).toEqual([34,51,85,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('Oval cuts both saved destinations across almost coincident straight sides', async ({page}) => {
  const [first, second, oval] = adjacentPrecisionBoundaries();
  const protectedFill:Vector = {...first,id:'protected',x:170,y:80};
  const f=await openMergeStage(page,400,320,[first,second,protectedFill]);
  const before=await f.read();
  const overlap={x:91,y:64}, exposed={x:127,y:65};
  const owners=async ()=>(await f.read()).filter(shape=>hit(shape,overlap,0));
  await expect.poll(owners).toHaveLength(2);
  await page.getByRole('button',{name:'Oval',exact:true}).click();
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('0');
  await page.getByLabel('Drawing fill',{exact:true}).fill(oval.fill);
  await f.draw([{x:oval.x,y:oval.y},{x:oval.x+oval.width,y:oval.y+oval.height}]);
  await expect.poll(owners).toHaveLength(1);
  const result=await f.read();
  expect(result.find(s=>s.id===protectedFill.id)).toEqual(protectedFill);
  expect(result.some(s=>hit(s,{x:56,y:25},0))&&result.some(s=>hit(s,{x:54,y:90},0))).toBe(true);
  await expect.poll(()=>f.pixel(overlap)).toEqual([109,94,252,255]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at(exposed));
  await f.canvas.press('Delete');
  await expect.poll(owners).toHaveLength(0);
  await expect.poll(()=>f.pixel(overlap)).toEqual([255,255,255,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(result);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(result);
});

test('deleting the joined Oval also clears the matching older overlap', async ({page}) => {
  const [first, second, oval] = adjacentPrecisionBoundaries();
  const f = await openMergeStage(page, 400, 320, [first, second]);
  const before = await f.read();
  const oldOverlap = { x: 83, y: 43 }, newOverlap = { x: 91, y: 64 }, exposed = { x: 127, y: 65 };
  const count = (artwork: Vector[], p: Point) => artwork.filter(shape => hit(shape, p, 0)).length;
  expect(count(before, oldOverlap)).toBe(2);
  await page.getByRole('button', {name:'Oval',exact:true}).click();
  await page.getByLabel('Drawing stroke width', {exact:true}).fill('0');
  await page.getByLabel('Drawing fill', {exact:true}).fill(oval.fill);
  await f.draw([{x:oval.x,y:oval.y},{x:oval.x+oval.width,y:oval.y+oval.height}]);
  await expect.poll(async () => count(await f.read(), newOverlap)).toBe(1);
  const drawn = await f.read();
  await page.getByRole('button', {name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at(exposed));
  await f.canvas.press('Delete');
  await expect.poll(async () => count(await f.read(), newOverlap)).toBe(0);
  await expect.poll(() => f.pixel(newOverlap)).toEqual([255,255,255,255]);
  const deleted = await f.read();
  const oldPixel = await f.pixel(oldOverlap);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(drawn);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(deleted);
  expect({
    oldOwnersAfterDrawing: count(drawn, oldOverlap),
    oldOwnersAfterDelete: count(deleted, oldOverlap),
    oldPixel,
  }).toEqual({
    oldOwnersAfterDrawing: 1, oldOwnersAfterDelete: 0, oldPixel: [255,255,255,255],
  });
});

test('an Oval joins older curved paint reached through the first fill', async ({page}) => {
  const first: Vector = {
    id: 'first-purple', kind: 'ellipse', x: 64, y: 70, width: 64, height: 46,
    rotation: 0, stroke: '#111111', strokeWidth: 0, fill: '#6d5efc', drawingMode: 'merge', points: [],
  };
  const second: Vector = { ...first, id: 'second-purple', x: 106 };
  const untouched: Vector = { ...first, id: 'unaffected', x: 240, y: 70, fill: '#e23257' };
  const stage = await openMergeStage(page, 400, 320, [first, second, untouched]);
  const before = await stage.read();
  const oldOverlap = { x: 117, y: 93 }, exposed = { x: 40, y: 93 };
  const owners = async () => (await stage.read()).filter(shape => hit(shape, oldOverlap, 0));
  expect(await owners()).toHaveLength(2);
  await page.getByRole('button', {name:'Oval',exact:true}).click();
  await page.getByLabel('Drawing stroke width', {exact:true}).fill('0');
  await page.getByLabel('Drawing fill', {exact:true}).fill(first.fill);
  await stage.draw([{ x: 32, y: 70 }, { x: 78, y: 116 }]);
  await expect.poll(owners).toHaveLength(1);
  const drawn = await stage.read();
  const [merged] = await owners();
  expect(hit(merged, exposed, 0)).toBe(true);
  expect(merged.contours?.some(ring => ring.some(node => node.in || node.out))).toBe(true);
  expect(drawn.find(s => s.id === untouched.id)).toEqual(untouched);

  await page.getByRole('button', {name:'Selection',exact:true}).click();
  await page.mouse.click(...stage.at(exposed));
  await stage.canvas.press('Delete');
  await expect.poll(stage.read).toEqual([untouched]);
  await expect.poll(() => stage.pixel(oldOverlap)).toEqual([255,255,255,255]);
  await stage.canvas.press('Control+z');
  await expect.poll(stage.read).toEqual(drawn);
  await stage.canvas.press('Control+z');
  await expect.poll(stage.read).toEqual(before);
  await stage.canvas.press('Control+Shift+z');
  await expect.poll(stage.read).toEqual(drawn);
});

test('Brush settles a drop over a loaded fill with crossing contours', async ({page}) => {
  const [compound] = crossingCompoundPair();
  const scale = (p:Point) => ({x:3*p.x,y:3*p.y});
  const base: Vector = {
    ...compound, x:85, y:65, width:compound.width*3, height:compound.height*3,
    contours:compound.contours!.map(ring=>ring.map(n=>({
      ...scale(n), ...(n.in ? {in:scale(n.in)} : {}), ...(n.out ? {out:scale(n.out)} : {}),
    }))),
  };
  const untouched:Vector = {...base,id:'protected',kind:'rectangle',x:320,y:215,width:34,height:34};
  delete untouched.contours;
  const stage = await openMergeStage(page,400,320,[base,untouched]);
  const before = await stage.read();
  const overlap = {x:212,y:120};
  const remote = [{x:106,y:141},{x:123,y:143},{x:117,y:131},{x:150,y:193}];
  const outsideSamples = await Promise.all(remote.map(point=>stage.pixel(point)));
  await expect.poll(()=>stage.pixel(overlap)).toEqual([109,94,252,255]);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('24');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#e23257');
  await stage.draw([{x:183,y:119},{x:216,y:120},{x:258,y:119},{x:298,y:122}]);
  const owners = async () => (await stage.read()).filter(shape=>hit(shape,overlap,0)).map(shape=>shape.fill);
  await expect.poll(owners).toEqual(['#e23257']);
  const settled = await stage.read();
  expect(settled.find(s=>s.id===untouched.id)).toEqual(untouched);
  expect(settled.some(s=>s.fill===base.fill&&s.contours?.some(r=>r.some(n=>n.in||n.out)))).toBe(true);
  expect(await Promise.all(remote.map(point=>stage.pixel(point)))).toEqual(outsideSamples);
  await expect.poll(()=>stage.pixel(overlap)).toEqual([226,50,87,255]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...stage.at({x:285,y:121}));
  await stage.canvas.press('Delete');
  await expect.poll(owners).toEqual([]);
  await expect.poll(()=>stage.pixel(overlap)).toEqual([255,255,255,255]);
  await stage.canvas.press('Control+z');
  await expect.poll(stage.read).toEqual(settled);
  await stage.canvas.press('Control+z');
  await expect.poll(stage.read).toEqual(before);
  await stage.canvas.press('Control+Shift+z');
  await expect.poll(stage.read).toEqual(settled);
});

test('Brush joins matching paint that has a hole touching its outside edge', async ({page}) => {
  const purple='#6d5efc';
  const compound: Vector = {id:'touching-hole',kind:'polygon',x:88,y:75,width:187,height:165,rotation:0,
    fill:purple,stroke:'#292444',strokeWidth:0,points:[],fillRule:'evenodd',drawingMode:'merge',closed:true,
    contours:[[{x:0,y:0},{x:187,y:0},{x:187,y:165},{x:0,y:165},{x:0,y:108}],
      [{x:0,y:108,out:{x:11,y:100}},{x:35,y:82,in:{x:24,y:87}},{x:52,y:108},{x:35,y:134}]]};
  const line:Vector = {id:'ink',kind:'path',x:205,y:115,width:0,height:9,rotation:0,fillEnabled:false,
    fill:purple,stroke:'#292444',strokeWidth:2,drawingMode:'merge',points:[{x:0,y:0},{x:0,y:9}]};
  const f=await openMergeStage(page,400,320,[compound,line]);
  const before=await f.read();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('25');
  await page.getByLabel('Drawing fill',{exact:true}).fill(purple);
  await f.draw([{x:48,y:116},{x:119,y:113},{x:175,y:120},{x:239,y:116},{x:305,y:118}]);
  const outside={x:62,y:116}, oldInside={x:160,y:213}, hole={x:124,y:181}, crossing={x:205,y:119};
  const fills = async () => (await f.read()).filter(s=>s.strokeWidth===0);
  await expect.poll(async()=> (await fills()).some(shape=>hit(shape,outside,0))).toBe(true);
  await expect.poll(fills).toHaveLength(1);
  const settled=await f.read();
  const [joined]=await fills();
  expect(hit(joined,outside,0)&&hit(joined,oldInside,0)).toBe(true);
  expect(hit(joined,hole,0)).toBe(false);
  expect(settled.filter(s=>s.strokeWidth)).toHaveLength(0);
  await expect.poll(()=>f.pixel(hole)).toEqual([255,255,255,255]);
  await expect.poll(()=>f.pixel(crossing)).toEqual([109,94,252,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('an opaque Brush cuts translucent paint and Pencil without changing surviving opacity', async ({page}) => {
  const paint: Vector = {id:'wash',kind:'rectangle',x:82,y:75,width:185,height:142,rotation:0,
    fill:'#0088ff',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge',opacity:0.2};
  const pencil: Vector = {...paint,id:'pencil',kind:'path',x:135,y:55,width:0,height:185,opacity:undefined,
    fillEnabled:false,strokeWidth:2,points:[{x:0,y:0},{x:0,y:185}]};
  const untouched: Vector = {...paint,id:'other',x:310,y:65,width:42,height:51,fill:'#339966'};
  const f = await openMergeStage(page,400,320,[paint,pencil,untouched]);
  const before = await f.read();
  await expect.poll(()=>f.pixel({x:110,y:97})).not.toEqual([255,255,255,255]);
  const originalWash = await f.pixel({x:110,y:97});
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('32');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#f28126');
  await f.draw([{x:50,y:136},{x:105,y:131},{x:170,y:141},{x:228,y:136},{x:293,y:140}]);
  const overlap = {x:135,y:136};
  const owners = (art:Vector[]) => art.filter(shape=>hit(shape,overlap,0)).map(shape=>shape.fill);
  await expect.poll(async()=>owners(await f.read())).toEqual(['#f28126']);
  const settled = await f.read();
  expect(settled.find(s=>s.id===untouched.id)).toEqual(untouched);
  const wash = settled.filter(s=>s.fill===paint.fill&&s.strokeWidth===0);
  expect(wash).toHaveLength(2);
  expect(wash.every(s=>s.opacity===paint.opacity)).toBe(true);
  const ink = settled.filter(s=>s.strokeWidth);
  expect(ink).toHaveLength(2);
  expect(ink.every(s=>s.strokeWidth===2&&s.fillEnabled===false)).toBe(true);
  await expect.poll(()=>f.pixel({x:110,y:97})).toEqual(originalWash);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at({x:172,y:138}));
  await f.canvas.press('Delete');
  await expect.poll(()=>f.pixel(overlap)).toEqual([255,255,255,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(settled);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
});

test('one Brush release joins matching Brush and shape paint across other colors', async ({page}) => {
  const blue = '#0088ff';
  const shape: Vector = {id:'blue-shape',kind:'rectangle',x:49,y:75,width:46,height:121,rotation:0,
    fill:blue,stroke:'#111111',strokeWidth:0,points:[],drawingMode:'merge'};
  const f = await openMergeStage(page,400,320,[shape]);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('32');
  const fill = page.getByLabel('Drawing fill',{exact:true});
  for (const [x,color] of [[130,'#ee4477'],[195,blue],[253,'#00aa55'],[318,blue]] as const) {
    await fill.fill(color);
    const previous = await f.read();
    await f.draw([{x,y:84},{x:x-5,y:111},{x:x+3,y:150},{x,y:194}]);
    await expect.poll(f.read).not.toEqual(previous);
  }
  const before = await f.read();
  expect(before.filter(s=>s.fill===blue)).toHaveLength(3);
  await fill.fill(blue);
  await f.draw([{x:28,y:137},{x:113,y:135},{x:195,y:140},{x:265,y:131},{x:352,y:136}]);
  await expect.poll(async()=> (await f.read()).filter(s=>s.fill===blue)).toHaveLength(1);
  const merged = await f.read();
  const owners = (p:Point) => merged.filter(s=>hit(s,p,0)).map(s=>s.fill);
  for (const x of [72,130,195,253,318]) expect(owners({x,y:137})).toEqual([blue]);
  expect(owners({x:130,y:91})).toEqual(['#ee4477']);
  expect(owners({x:253,y:184})).toEqual(['#00aa55']);
  expect(merged.find(s=>s.fill===blue)?.contours?.flat().some(n=>n.in||n.out)).toBe(true);
  await expect.poll(()=>f.pixel({x:253,y:137})).toEqual([0,136,255,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(merged);
});

test('on an empty layer Pencil can cut a Brush wave, erase its dividers and cut it again',async ({page})=>{
  const {canvas,at,draw,read,pixel}=await openMergeStage(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('24');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#1288dd');
  await draw(verticalWave);
  await expect.poll(async ()=>(await read()).length).toBe(1);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await draw(zigzagSamples);
  const faces=async ()=>(await read()).filter(s=>!s.strokeWidth);
  await expect.poll(async ()=>(await faces()).length).toBeGreaterThan(20);
  const cut=await read(), count=(await faces()).length;
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.dblclick(...at(zigzagSamples[0]));
  await expect(page.getByText(`Selected ${cut.length-count} connected lines`,{exact:true})).toBeVisible();
  await canvas.press('Delete');
  await expect.poll(async ()=>(await read()).length).toBe(1);
  const united=await read();
  expect(united[0].contours?.some(r=>r.some(n=>n.in||n.out))).toBe(true);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await draw(zigzagSamples);
  await expect.poll(async ()=>(await faces()).length).toBe(count);
  for(const p of [verticalWave[0],verticalWave[150]]) await expect.poll(()=>pixel(p)).toEqual([18,136,221,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(united);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
});

test('Bucket reunites a saved fragmented Brush wave and Pencil can cut the same junctions again',async ({page})=>{
  const style: Vector = {id:'wave',kind:'brush',x:0,y:0,width:400,height:320,rotation:0,
    points:verticalWave,strokeWidth:24,fill:'#1288dd',stroke:'#181818',drawingMode:'merge'};
  const wave=prepareBrushPaint([],{brush:style,amount:.5,at:0,optimize:true,merge:true,mode:'normal',selected:[]}).shapes;
  const points=zigzagSamples.map(p=>({x:Math.round(p.x),y:Math.round(p.y)}));
  const divided=preparePencilDrawing(wave,{stroke:{...style,id:'zigzag',kind:'path',points,strokeWidth:2,fillEnabled:false},
    mode:'smooth',merge:true,optimize:true}).shapes.filter(s=>!s.strokeWidth);
  expect(divided.length).toBeGreaterThan(20);
  const sample=verticalWave.find(p=>p.y>85 && p.y<180)!;
  const seed=divided.find(s=>hit(s,sample,0))!;
  const saved=divided.map(s=>s===seed?{...s,fill:'#ee7722'}:s);
  const {canvas,at,draw,read,pixel}=await openMergeStage(page,400,320,saved);
  const faces=async ()=>(await read()).filter(s=>!s.strokeWidth);
  await page.getByRole('button',{name:'Paint bucket',exact:true}).click();
  await page.getByLabel('Drawing fill',{exact:true}).fill(style.fill);
  await page.mouse.click(...at(sample));
  await expect.poll(async ()=>(await faces()).map(s=>s.id)).toEqual([seed.id]);
  const joined=await read();
  const near=verticalWave[0], far=verticalWave[150];
  for(const p of [near,far]) await expect.poll(()=>pixel(p)).toEqual([18,136,221,255]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(near));
  await canvas.press('Delete');
  for(const p of [near,far]) await expect.poll(()=>pixel(p)).toEqual([255,255,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(joined);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await draw(points);
  await expect.poll(async ()=>(await faces()).length).toBeGreaterThan(20);
  const recut=await read();
  const separate=(await faces()).find(s=>hit(s,near,0))!;
  expect(hit(separate,far,0)).toBe(false);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(near));
  await canvas.press('Delete');
  await expect.poll(()=>pixel(near)).toEqual([255,255,255,255]);
  await expect.poll(()=>pixel(far)).toEqual([18,136,221,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(recut);
});

test('Bucket and fresh Brush unite material across cut square outlines', async ({page}) => {
  const {canvas,draw,at,read,pixel} = await openMergeStage(page);
  const color = page.getByLabel('Drawing fill',{exact:true});
  const paint = async () => (await read()).filter(s => !s.strokeWidth);
  const blue = '#123456';
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await color.fill(blue);
  await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
  await draw([{x:40,y:60},{x:150,y:180}]);
  await expect.poll(async () => (await paint()).length).toBe(1);
  await draw([{x:170,y:60},{x:280,y:180}]);
  await expect.poll(async () => (await paint()).length).toBe(2);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('24');
  const bridge = [{x:90,y:100},{x:135,y:112},{x:170,y:105},{x:225,y:101}];
  await color.fill(blue);
  await draw(bridge);
  await expect.poll(async () => (await paint()).length).toBe(1);
  const united = await read();
  const probes = [{x:60,y:140},{x:159,y:109},{x:250,y:140}];
  for (const p of probes) expect(hit((await paint())[0],p,0)).toBe(true);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(probes[0]));
  await canvas.press('Delete');
  for (const p of probes) await expect.poll(()=>pixel(p)).toEqual([255,255,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(united);
  await canvas.press('Control+z');
  await expect.poll(async () => (await paint()).length).toBe(2);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await color.fill('#ff7700');
  await draw(bridge);
  await expect.poll(async () => (await paint()).some(s=>s.fill==='#ff7700')).toBe(true);
  const before = await read();
  await page.getByRole('button',{name:'Paint bucket',exact:true}).click();
  await color.fill(blue);
  await page.mouse.click(...at(probes[1]));
  await expect.poll(async () => (await paint()).length).toBe(1);
  const [merged] = await paint();
  for (const p of probes) expect(hit(merged,p,0)).toBe(true);
  expect(merged.contours?.some(r=>r.some(n=>n.in||n.out))).toBe(true);
  expect((await read()).filter(s=>s.strokeWidth)).toEqual(before.filter(s=>s.strokeWidth));
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

test('deleting a Pencil divider reunites only the faces it separated',async ({page})=>{
  const {canvas,draw,at,read,pixel} = await openMergeStage(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Drawing fill',{exact:true}).fill('#0088ff');
  await page.getByLabel('Brush size',{exact:true}).fill('65');
  await draw([{x:50,y:125},{x:155,y:120},{x:275,y:130}]);
  const faces = async () => (await read()).filter(s=>!s.strokeWidth);
  await expect.poll(async ()=>(await faces()).length).toBe(1);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  for (const [i,x] of [125,215].entries()) {
    await draw([{x,y:40},{x,y:220}]);
    await expect.poll(async ()=>(await faces()).length).toBe(i+2);
  }
  const before=await read(), ink={x:125,y:125};
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(ink));
  await canvas.press('Delete');
  await expect.poll(async ()=>(await faces()).length).toBe(2);
  const joined=(await faces()).find(s=>hit(s,{x:90,y:125},0))!;
  expect(hit(joined,{x:165,y:125},0)).toBe(true);
  expect(hit(joined,{x:248,y:125},0)).toBe(false);
  expect((await read()).filter(s=>s.strokeWidth)).toEqual(before.filter(s=>s.strokeWidth && !hit(s,ink,0)));
  await expect.poll(()=>pixel(ink)).toEqual([0,136,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

for (const material of ['Brush', 'filled rectangle'] as const)
test(`moving a Pencil divider heals its old ${material} seam`,async ({page})=>{
  const brush = material==='Brush';
  const rect: Vector = {id:'paint',kind:'rectangle',x:50,y:95,width:225,height:60,rotation:0,
    points:[],fill:'#0088ff',fillEnabled:true,stroke:'#292444',strokeWidth:0,drawingMode:'merge'};
  const {canvas,draw,at,read,pixel} = await openMergeStage(page,400,320,brush ? [] : [rect]);
  if (brush) {
    await page.getByRole('button',{name:'Brush',exact:true}).click();
    await page.getByLabel('Drawing fill',{exact:true}).fill('#0088ff');
    await page.getByLabel('Brush size',{exact:true}).fill('60');
    await draw([{x:50,y:125},{x:155,y:125},{x:275,y:125}]);
  }
  const owner = (art: Vector[],x:number) => art.find(s=>!s.strokeWidth && hit(s,{x,y:125},0))?.id;
  const faces = async () => (await read()).filter(s=>!s.strokeWidth);
  await expect.poll(faces).toHaveLength(1);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  for (const [i,x] of [125,215].entries()) {
    await draw([{x,y:40},{x,y:220}]);
    await expect.poll(faces).toHaveLength(i+2);
  }
  const before=await read();
  const old={x:125,y:125}, interim={x:150,y:125}, final={x:175,y:125};
  const grip = ({x}: Point) => ({x,y:109});
  const moved=before.find(s=>s.strokeWidth && hit(s,old,0))!;
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.keyboard.down('Shift');
  await page.mouse.click(...at(grip(old)));
  await page.keyboard.up('Shift');
  const move = async (from:Point,to:Point) => {
    if (brush) await draw([grip(from),grip(to)]);
    else {
      for (let dx=0; dx<20; dx+=10) await canvas.press('Shift+ArrowRight');
      for (let dx=0; dx<5; dx++) await canvas.press('ArrowRight');
    }
  };
  await move(old,interim);
  await expect.poll(async()=>(await read()).find(s=>s.id===moved.id)?.x).toBeCloseTo(moved.x+25,5);
  const first=await read();
  await move(interim,final);
  await expect.poll(async()=>(await read()).find(s=>s.id===moved.id)?.x).toBeCloseTo(moved.x+50,5);
  const floating=await read();
  expect(floating.filter(s=>!s.strokeWidth)).toEqual(before.filter(s=>!s.strokeWidth));
  await page.mouse.click(...at({x:330,y:235}));
  await expect.poll(async()=>{
    const art=await read(), left=owner(art,105), oldRight=owner(art,145), newRight=owner(art,190), other=owner(art,245);
    return !!left && left===oldRight && !!newRight && !!other && left!==other && newRight!==other &&
      (brush || left!==newRight);
  }).toBe(true);
  const settled=await read();
  const untouched=before.find(s=>s.id===owner(before,245));
  expect(settled.find(s=>s.id===untouched?.id)).toEqual(untouched);
  await expect.poll(()=>pixel(old)).toEqual([0,136,255,255]);
  await expect.poll(()=>pixel(final)).toEqual([41,36,68,255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.press('Control+z');
  if (brush) await expect.poll(read).toEqual(first);
  else await expect.poll(async()=>(await read()).find(s=>s.id===moved.id)?.x).toBeCloseTo(moved.x+49,5);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(settled);
});

test('retracing a cut Brush curve removes the paint underneath on release', async ({ page }) => {
  const { draw, read, pixel, canvas, at } = await openMergeStage(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('32');
  const color = page.getByLabel('Drawing fill', { exact: true });
  const colors = ['#0088ff', '#ee4477', '#00aa55', '#8833ee'];
  for (const [i, points] of [arc, vertical, horizontal, arc].entries()) {
    await color.fill(colors[i]);
    await draw(points);
    await expect.poll(async () => (await read()).some(s => s.fill === colors[i])).toBe(true);
  }
  const before = await read();
  // Both probes are on the final arc, over different intervening strokes.
  const covered = [{ x: 145, y: 91 }, { x: 184, y: 120 }];
  for (const p of covered) {
    expect(before.filter(s => hit(s, p, 0)).map(s => s.fill)).toEqual([colors[3]]);
    await expect.poll(() => pixel(p)).toEqual([136, 51, 238, 255]);
  }
  expect(before.filter(s => s.fill === colors[3])).toHaveLength(1);
  expect(before.find(s => s.fill === colors[3])?.contours?.some(r => r.some(n => n.in || n.out))).toBe(true);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(...at(covered[0]));
  await canvas.press('Delete');
  await expect.poll(read).toEqual(before.filter(s => s.fill !== colors[3]));
  for (const p of covered) await expect.poll(() => pixel(p)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel({ x: 70, y: 120 })).toEqual([0, 170, 85, 255]);
  await expect.poll(() => pixel({ x: 145, y: 175 })).toEqual([238, 68, 119, 255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

test('a Brush stroke beside an existing stroke still cuts the crossing fill', async ({ page }) => {
  const { draw, read, pixel, canvas, at } = await openMergeStage(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('32');
  const color = page.getByLabel('Drawing fill', { exact: true });
  for (const [points, fill] of [[horizontal, '#0088ff'], [vertical, '#ee4477'],
    [vertical.map(p => ({ ...p, x: p.x + 32 })), '#00aa55']] as const) {
    await color.fill(fill);
    await draw(points);
    await expect.poll(async () => (await read()).some(s => s.fill === fill)).toBe(true);
  }
  const crossing = { x: 177, y: 120 };
  const artwork = await read();
  expect(artwork.filter(s => hit(s, crossing, 0)).map(s => s.fill)).toEqual(['#00aa55']);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(...at(crossing));
  await canvas.press('Delete');
  await expect.poll(() => pixel(crossing)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel({ x: 145, y: 120 })).toEqual([238, 68, 119, 255]);
  await expect.poll(() => pixel({ x: 210, y: 120 })).toEqual([0, 136, 255, 255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(artwork);
});

for (const tool of ['Oval', 'Brush'] as const)
  test(`default Pencil divides ${tool} through existing junctions on each release`, async ({
    page,
  }) => {
    const { canvas, draw, at, read, pixel } = await openMergeStage(page);
    await page.getByRole('button', { name: tool, exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#0088ff');
    if (tool === 'Oval') {
      await page.getByLabel('Drawing stroke width', { exact: true }).fill('0');
      await draw([
        { x: 80, y: 80 },
        { x: 280, y: 180 },
      ]);
    } else {
      await page.getByLabel('Brush size', { exact: true }).fill('80');
      await draw([
        { x: 80, y: 130 },
        { x: 145, y: 128 },
        { x: 220, y: 133 },
        { x: 280, y: 130 },
      ]);
    }
    await expect.poll(async () => (await read()).length).toBe(1);
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    await expect(page.getByLabel('Drawing stroke width', { exact: true })).toHaveValue('2');
    const lines = [
      [
        [25, 130],
        [335, 130],
      ],
      [
        [180, 30],
        [180, 230],
      ],
      [
        [25, 68],
        [335, 192],
      ],
      [
        [335, 68],
        [25, 192],
      ],
    ];
    for (const [i, line] of lines.entries()) {
      await draw(line.map(([x, y]) => ({ x, y })));
      // Every new diameter traverses the common center and cuts two sectors.
      await expect
        .poll(async () => (await read()).filter((s) => !s.strokeWidth).length)
        .toBe((i + 1) * 2);
    }
    const before = await read();
    const probes = [
      { x: 234, y: 141 },
      { x: 234, y: 119 },
    ];
    const picked = probes.map((p) => before.filter((s) => !s.strokeWidth && hit(s, p, 0)));
    expect(picked.map((f) => f.length)).toEqual([1, 1]);
    expect(picked[0][0].id).not.toEqual(picked[1][0].id);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await page.mouse.click(...at(probes[0]));
    await canvas.press('Delete');
    await expect.poll(() => pixel(probes[0])).toEqual([255, 255, 255, 255]);
    await expect.poll(() => pixel(probes[1])).toEqual([0, 136, 255, 255]);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(before);
    if (tool === 'Oval') {
      await page.getByRole('button', { name: 'Pencil', exact: true }).click();
      await page.getByLabel('Drawing stroke width', { exact: true }).fill('3');
      await page.getByRole('button', { name: 'Oval', exact: true }).click();
      await expect(page.getByLabel('Drawing stroke width', { exact: true })).toHaveValue('0');
    }
  });

test('a Pencil segment between crossings can be deleted or moved independently', async ({
  page,
}) => {
  const { canvas, draw, at, read, pixel } = await openMergeStage(page);
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const color = page.getByLabel('Drawing stroke', { exact: true });
  await color.fill('#0088ff');
  await page.getByLabel('Drawing stroke width', { exact: true }).fill('3');
  await draw(
    Array.from({ length: 97 }, (_, i) => ({
      x: 56 + 3 * i,
      y: 150 + Math.round(30 * Math.cos((i * Math.PI) / 16)),
    })),
  );
  await expect.poll(async () => (await read()).length).toBe(1);
  await color.fill('#cc2244');
  await draw([
    { x: 30, y: 150 },
    { x: 365, y: 150 },
  ]);
  await expect
    .poll(async () => (await read()).filter((s) => s.stroke === '#cc2244').length)
    .toBe(7);
  const cut = await read();
  expect(cut.filter((s) => s.stroke === '#0088ff')).toHaveLength(7);
  const middle = { x: 152, y: 150 },
    neighbor = { x: 296, y: 150 };
  const piece = cut.find((s) => s.stroke === '#cc2244' && hit(s, middle, 0))!;
  expect(piece).toBeDefined();
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(...at(middle));
  await canvas.press('Delete');
  await expect.poll(read).toEqual(cut.filter((s) => s.id !== piece.id));
  await expect.poll(() => pixel(middle)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => pixel(neighbor)).toEqual([204, 34, 68, 255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await page.mouse.click(...at(middle));
  await canvas.press('Shift+ArrowDown');
  await expect.poll(async () => (await read()).find(s => s.id === piece.id)?.y).toBe(piece.y + 10);
  await expect.poll(() => pixel(neighbor)).toEqual([204, 34, 68, 255]);
  const moved = (await read()).find((s) => s.id === piece.id)!;
  expect(hit(moved, middle, 0)).toBe(false);
  expect(hit(moved, { ...middle, y: 160 }, 0)).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
});

for (const mode of ['smooth','ink'] as const) test(`dense Pencil star cuts Brush paint on release (${mode})`, async ({page}) => {
  test.setTimeout(90000);
  const {canvas, draw, at, pixel, read} = await openMergeStage(page);
  await page.getByRole('button', {name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('80');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#0088ff');
  await draw([{x:35,y:130},{x:145,y:120},{x:220,y:135},{x:355,y:120}]);
  await expect.poll(async () => (await read()).length).toBe(1);
  const original = await read();
  await page.getByRole('button', {name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption(mode);
  if (mode === 'ink') await page.getByLabel('Pencil optimize',{exact:true}).uncheck();
  await draw((mode === 'ink' ? sampledStar : starCorners).map(p=>({x:p.x+50,y:p.y})));
  await expect.poll(async () => (await read()).filter(s=>!s.strokeWidth).length).toBeGreaterThan(100);
  const cut = await read(), paint = cut.filter(s=>!s.strokeWidth);
  // Both end caps extend beyond every Pencil segment and its selectable hit width.
  const probes = [{x:25,y:130},{x:355,y:120}];
  for (const p of probes) expect(cut.some(s=>s.strokeWidth && hit(s,p,7))).toBe(false);
  const picked = probes.map(p=>paint.filter(s=>hit(s,p,0)));
  expect(picked.map(f=>f.length)).toEqual([1,1]);
  expect(picked[0][0].id).not.toBe(picked[1][0].id);
  for (const face of picked.flat()) expect(face.contours?.some(r=>r.some(n=>n.in || n.out))).toBe(true);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(probes[0]));
  await canvas.press('Delete');
  await expect.poll(()=>pixel(probes[0])).toEqual([255,255,255,255]);
  await expect.poll(()=>pixel(probes[1])).toEqual([0,136,255,255]);
  for (const previous of [cut,original]) {
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(previous);
  }
});

test('merge fail saved scene unites overlapping purple faces and cuts through the green on deselect', async ({page}) => {
  const saved = mergeFailFrame();
  test.skip(!saved, 'Requires the reported merge fail revision');
  const original = saved!, moving = original.at(-1)!;
  const {canvas, at, draw, read, pixel} = await openMergeStage(page, 960, 540, original);
  const cap = {x:454,y:433}, shifted = {x:534,y:433}, greenOverlap = {x:436,y:289};
  const contacts = [{x:346,y:193}, {x:343,y:151}, {x:388,y:163}, {x:445,y:256},
    {x:445,y:337}, {x:412,y:241}, {x:421,y:325}, {x:424,y:373}, {x:370,y:199}];
  const destinationArms = [{x:358,y:154}, {x:382,y:235}, {x:403,y:322}, {x:409,y:370}];
  const purple = [109,94,252,255], green = [95,252,126,255], white = [255,255,255,255];
  const owners = (art: Vector[], p: Point) => art.filter(s => hit(s,p,0));
  const intactGreen = {x:499,y:109}, separatePurple = {x:660,y:100};
  const destinations = contacts.map(p=>owners(original,p));
  expect(new Set(destinations.map(pair=>pair[0].id)).size).toBe(9);
  for (const pair of destinations) expect(pair.map(s=>s.fill)).toEqual([moving.fill,moving.fill]);
  expect(owners(original,greenOverlap).map(s=>s.fill)).toEqual(['#5ffc7e',moving.fill]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  // Regrab the floating paint and return it to the saved intersections before deselecting.
  await draw([cap,shifted]);
  await expect.poll(async ()=>(await read()).find(s=>s.id===moving.id)?.x).toBeCloseTo(moving.x+80,5);
  const floating = await read();
  await draw([shifted,cap]);
  await expect.poll(async ()=>(await read()).find(s=>s.id===moving.id)?.x).toBeCloseTo(moving.x,5);
  await page.mouse.click(...at({x:800,y:455}));
  await expect.poll(async () => {
    const art = await read();
    const picks = [cap, ...contacts, ...destinationArms, greenOverlap].map(p=>owners(art,p));
    return picks.every(ids=>ids.length===1 && ids[0].id===picks[0][0]?.id);
  }).toBe(true);
  const united = await read(), joined = owners(united,cap)[0];
  expect(joined.contours?.some(r=>r.some(n=>n.in||n.out))).toBe(true);
  for (const p of [cap, ...contacts, ...destinationArms, greenOverlap, separatePurple])
    await expect.poll(()=>pixel(p)).toEqual(purple);
  await page.mouse.click(...at(destinationArms[2]));
  await canvas.press('Delete');
  for (const p of [cap, ...contacts, ...destinationArms, greenOverlap])
    await expect.poll(()=>pixel(p)).toEqual(white);
  await expect.poll(()=>pixel(intactGreen)).toEqual(green);
  await expect.poll(()=>pixel(separatePurple)).toEqual(purple);
  for (const previous of [united, floating, original]) {
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(previous);
  }
});

for (const [name, x, y, width, height, start, finish, overlap] of [
  ['small', 450, 255, 85, 100, { x:475, y:300 }, { x:491, y:322 }, { x:536, y:279 }],
  ['near-coincident', 475, 200, 95, 62, { x:527, y:226 }, { x:497, y:316 }, { x:497, y:316 }],
] as const) test(`merge fail 3 cuts destination paint after the ${name} lasso drop of Brush and Pencil artwork`, async ({ page }) => {
  const saved = mergeFailThreeFrame();
  test.skip(!saved, 'Requires the reported merge fail 3 revision');
  test.fail(name === 'near-coincident', 'The original curve kernel leaves an underlying purple owner at this contact');
  const f = await openMergeStage(page, 960, 540, saved!);
  const before = await f.read();
  const owners = async () => (await f.read()).filter(s => !s.strokeWidth && hit(s, overlap, 0));
  await page.getByRole('button', {name:'Lasso', exact:true}).click();
  await page.getByRole('checkbox', {name:'Partial paint region', exact:true}).check();
  await page.getByRole('checkbox', {name:'Drag paint region', exact:true}).check();
  await page.getByLabel('Lasso mode', {exact:true}).selectOption('polygon');
  for (const p of [{ x, y }, { x:x+width, y }, { x:x+width, y:y+height }, { x, y:y+height }])
    await page.mouse.click(...f.at(p));
  await f.canvas.press('Enter');
  await expect(page.getByText('Paint region ready: copy, cut or move.')).toBeVisible();
  if (name === 'near-coincident') {
    await page.getByRole('spinbutton', {name:'Paint region move X',exact:true}).fill(String(finish.x-start.x));
    await page.getByRole('spinbutton', {name:'Paint region move Y',exact:true}).fill(String(finish.y-start.y));
    await page.getByRole('button', {name:'Move paint region',exact:true}).click();
  } else await f.draw([start, finish]);
  await expect.poll(async () => (await f.read()).length).toBeGreaterThan(before.length);
  await expect.poll(async () => (await owners()).length).toBeGreaterThan(1);
  const floating = await f.read();
  await f.canvas.press('Escape');
  await expect.poll(async () => (await owners()).map(s => s.fill)).toEqual(['#a3df71']);
  const settled = await f.read();
  expect(settled).not.toEqual(floating);
  expect(settled.some(s => s.strokeWidth === 2 && s.fillEnabled === false && s.nodes?.length)).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
  await page.getByRole('button', {name:'Selection', exact:true}).click();
  // The overlap can sit beside Pencil ink. Pick the same fill away from an
  // ink hit so Delete exercises paint ownership instead of the line above it.
  const [owner] = await owners();
  const pickup = Array.from({length:121},(_,i)=>({ x:overlap.x-15+(i%11)*3, y:overlap.y-15+Math.floor(i/11)*3 }))
    .find(p => [[0,0],[2,0],[-2,0],[0,2],[0,-2]].every(([dx,dy])=>
      hit(owner,{x:p.x+dx,y:p.y+dy},0)) && settled.every(shape=>shape.id===owner.id || !hit(shape,p,5)));
  expect(pickup).toBeDefined();
  await page.mouse.click(...f.at(pickup!));
  await f.canvas.press('Delete');
  await expect.poll(owners).toEqual([]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(settled);
});

test('deselection cuts a carried fill with the Pencil line moved above it', async ({page}) => {
  const paint: Vector = { id:'carried-fill', kind:'ellipse', x:40, y:30, width:80, height:60,
    rotation:0, fill:'#2277ff', stroke:'#111111', strokeWidth:0, points:[], drawingMode:'merge' };
  const pencil: Vector = { ...paint, id:'carried-pencil', kind:'path', x:20, y:60, width:125, height:0,
    fillEnabled:false, strokeWidth:2, points:[{x:0,y:0},{x:125,y:0}] };
  const f = await openMergeStage(page,400,320,[paint,pencil]);
  const before = await f.read();
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at({x:80,y:44}));
  await page.keyboard.down('Shift');
  await page.mouse.click(...f.at({x:27,y:60}));
  await page.keyboard.up('Shift');
  await f.draw([{x:80,y:44},{x:225,y:144}]);
  const upper = {x:225,y:144}, lower = {x:225,y:178};
  const owners = async (point:Point) => (await f.read()).filter(s=>!s.strokeWidth&&hit(s,point,0)).map(s=>s.id);
  await expect.poll(()=>owners(upper)).toEqual([paint.id]);
  await expect.poll(()=>owners(lower)).toEqual([paint.id]);
  await f.canvas.press('Escape');
  await expect.poll(async()=>{
    const a = await owners(upper), b = await owners(lower);
    return a.length===1 && b.length===1 && a[0]!==b[0];
  }).toBe(true);
  const settled=await f.read();
  expect(settled.filter(s=>!s.strokeWidth).every(s=>s.contours?.some(ring=>ring.some(node=>node.in||node.out)))).toBe(true);
  expect(settled.filter(s=>s.strokeWidth).every(s=>s.fillEnabled===false)).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('deselection joins matching paint past a carried fill with overlapping bounds', async ({page}) => {
  const make = (id:string,fill:string,x:number,y:number,ring:Point[]):Vector => ({
    id,kind:'polygon',fill,stroke:fill,x,y,width:90,height:65,rotation:0,points:[],strokeWidth:0,
    drawingMode:'merge',closed:true,fillRule:'evenodd',contours:[ring],
  });
  const blue = '#0088ff';
  const destination = make('destination',blue,40,140,[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}]);
  const orange = make('orange','#dd5522',180,60,[{x:72,y:19},{x:89,y:19},{x:89,y:42}]);
  const carried = make('carried',blue,180,60,[{x:15,y:5},{x:75,y:5},{x:15,y:65}]);
  const f = await openMergeStage(page,400,320,[destination,orange,carried]);
  const before = await f.read();
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at({x:207,y:72}));
  await page.keyboard.down('Shift');
  await page.mouse.click(...f.at({x:265,y:85}));
  await page.keyboard.up('Shift');
  await f.draw([{x:207,y:72},{x:67,y:152}]);
  await expect.poll(async()=> (await f.read()).filter(s=>hit(s,{x:62,y:160},0)).map(s=>s.id)).toEqual([destination.id,carried.id]);
  const floatedOrange = (await f.read()).find(shape=>shape.id===orange.id);
  expect(floatedOrange?.x).toBeCloseTo(40,6);
  await f.canvas.press('Escape');
  await expect.poll(async()=> (await f.read()).map(s=>s.id)).toEqual([destination.id,orange.id]);
  const settled = await f.read();
  expect(settled[1]).toEqual(floatedOrange);
  expect([{x:45,y:160},{x:62,y:160},{x:95,y:150}].every(p=>hit(settled[0],p,0))).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(before);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('select fail settles a mixed drag before a new red Brush cuts that paint', async ({ page }) => {
  const saved = selectFailFrame();
  test.skip(!saved, 'Requires the reported select fail revision');
  const [pencil,purple] = saved!.slice(-3), existing = saved!.slice(0,-3);
  const dx = 120, dy = 244;
  const park = (p: Point) => ({ x: p.x+dx, y: p.y+dy });
  const relocate = (s: Vector) => ({ ...s, ...park(s) });
  const original = [...existing,relocate(pencil),relocate(purple)];
  const f = await openMergeStage(page,960,430,original);
  const owners = (art: Vector[], p: Point) => art.filter(s => !s.strokeWidth && hit(s,p,0));
  const contact = Array.from({length:66},(_,i)=>({x:527+(i%22)*6,y:5+Math.floor(i/22)*6}))
    .find(p => hit(purple,p,0) && owners(existing,p).length>0)!;
  expect(contact).toBeDefined();
  const cap = Array.from({length:90},(_,i)=>({x:538+(i%15)*8,y:-64+Math.floor(i/15)*8}))
    .find(p => hit(purple,p,0))!;
  expect(cap).toBeDefined();
  const lineEnd = worldPoint(pencil,pencil.nodes!.find(node=>worldPoint(pencil,node).y>50)!);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at(park(cap)));
  await page.keyboard.down('Shift');
  await page.mouse.click(...f.at(park(lineEnd)));
  await page.keyboard.up('Shift');
  await f.draw([park(cap),cap]);
  await expect.poll(async()=> (await f.read()).find(s=>s.id===pencil.id)?.x).toBeCloseTo(pencil.x,6);
  await expect.poll(async()=>owners(await f.read(),contact).length).toBeGreaterThan(1);
  await page.mouse.click(...f.at({x:870,y:360}));
  await expect.poll(async()=>owners(await f.read(),contact).map(s=>s.fill)).toEqual([purple.fill]);

  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('20');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#ca2b2b');
  await f.draw(Array.from({length:45},(_,i)=>({x:300+i*10,y:contact.y})));
  await expect.poll(async()=>owners(await f.read(),contact).map(s=>s.fill)).toEqual(['#ca2b2b']);
  await expect.poll(()=>f.pixel(contact)).toEqual([202,43,43,255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const painted = await f.read();
  expect(painted.some(s=>s.strokeWidth===pencil.strokeWidth && s.fillEnabled===false && s.kind==='bezier')).toBe(true);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...f.at(contact));
  await f.canvas.press('Delete');
  await expect.poll(()=>f.pixel(contact)).toEqual([255,255,255,255]);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(painted);
});

for (const selection of ['a whole Brush stroke','a partial Brush marquee','two Brush strokes','Brush and Pencil strokes','Brush paint with a full Pencil divider'] as const)
test(`deselecting ${selection} unites matching paint at the drop`, async ({page})=>{
  const {canvas, at, draw, read, pixel}=await openMergeStage(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('24');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#0088ff');
  await draw([{x:260,y:132},{x:260,y:184},{x:260,y:235}]);
  await expect.poll(async()=>(await read()).length).toBe(1);
  await draw([{x:36,y:75},{x:107,y:75},{x:177,y:75}]);
  await expect.poll(async()=>(await read()).length).toBe(2);
  const partial=selection==='a partial Brush marquee', multiple=selection==='two Brush strokes';
  const divider=selection==='Brush paint with a full Pencil divider', mixed=divider || selection==='Brush and Pencil strokes';
  if(multiple || mixed){
    if(mixed) await page.getByRole('button',{name:'Pencil',exact:true}).click();
    await draw([{x:36,y:110},{x:76,y:110},{x:mixed && !divider?110:177,y:110}]);
    await expect.poll(async()=>(await read()).length).toBe(3);
  }
  const original=await read();
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  if(partial || multiple || mixed){
    await draw([{x:partial?90:15,y:47},{x:196,y:partial?99:135}]);
    await expect(page.getByText('Paint region ready: copy, cut or move.',{exact:true})).toBeVisible();
  }
  await draw([{x:115,y:75},{x:150,y:100},{x:265,y:180}]);
  const overlap={x:260,y:180}, arm={x:300,y:180}, stem={x:260,y:225}, source={x:60,y:75};
  const owners=(art:Vector[],p:Point)=>art.filter(s=>!s.strokeWidth && hit(s,p,0));
  await expect.poll(async()=>owners(await read(),overlap).length).toBe(2);
  if(multiple) await expect.poll(async()=>owners(await read(),{x:260,y:215}).length).toBe(2);
  await page.mouse.click(...at({x:365,y:267}));
  const paintCount=(art:Vector[])=>art.filter(s=>!s.strokeWidth).length;
  const expectedFills=partial || divider?2:1;
  await expect.poll(async()=>{
    const art=await read();
    return [paintCount(art),owners(art,overlap).length];
  }).toEqual([expectedFills,1]);
  const united=await read(), region=owners(united,arm);
  expect(region).toHaveLength(1);
  expect(region[0].contours).toHaveLength(1);
  expect(region[0].contours![0].some(n=>n.in||n.out)).toBe(true);
  const probes=[overlap,arm,divider?{x:260,y:195}:stem];
  if(multiple) probes.push({x:300,y:215});
  for(const p of probes){
    expect(owners(united,p).map(s=>s.id)).toEqual([region[0].id]);
    await expect.poll(()=>pixel(p)).toEqual([0,136,255,255]);
  }
  const afterMoveAtSource=partial?[0,136,255,255]:[255,255,255,255];
  expect(await pixel(source)).toEqual(afterMoveAtSource);
  const ink=united.filter(s=>s.strokeWidth);
  if(mixed){
    expect(ink.length).toBeGreaterThan(0);
    expect(ink.every(s=>s.fillEnabled===false && (s.kind==='bezier'||s.kind==='path'))).toBe(true);
    for(const x of divider?[210,257,304]:[210,257]) expect(ink.some(s=>hit(s,{x,y:215},1))).toBe(true);
  } else expect(ink).toHaveLength(0);
  if(divider){
    const lower=owners(united,stem);
    expect(lower).toHaveLength(1);
    expect(lower[0].id).not.toBe(region[0].id);
  }
  await page.mouse.click(...at(arm));
  await canvas.press('Delete');
  await expect.poll(async()=>paintCount(await read())).toBe(expectedFills-1);
  expect((await read()).filter(s=>s.strokeWidth)).toEqual(ink);
  for(const p of probes) await expect.poll(()=>pixel(p)).toEqual([255,255,255,255]);
  expect(await pixel(source)).toEqual(afterMoveAtSource);
  if(divider){
    const lowerAndInk=await read();
    expect(await pixel(stem)).toEqual([0,136,255,255]);
    await page.mouse.click(...at(stem));
    await canvas.press('Delete');
    await expect.poll(read).toEqual(ink);
    await expect.poll(()=>pixel(stem)).toEqual([255,255,255,255]);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(lowerAndInk);
  }
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(united);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(original);
});

test('a mixed Brush and Pencil move cuts the exposed destination paint after overpaint', async ({page})=>{
  const solid: Vector = {id:'blue',kind:'rectangle',x:150,y:100,width:184,height:100,rotation:0,
    fill:'#0088ff',stroke:'#292444',strokeWidth:0,points:[],drawingMode:'merge'};
  const ink: Vector = {...solid,id:'ink',kind:'path',x:0,y:0,fillEnabled:false,strokeWidth:2,
    points:[{x:140,y:155},{x:350,y:155}]};
  const destination = prepareShapeDrawing([solid],{shape:ink,merge:true}).shapes;
  const red: Vector = {...solid,id:'red',kind:'polygon',fill:'#ff4400',x:35,y:80,width:45,height:100,closed:true,fillRule:'evenodd',
    contours:[[{x:0,y:12,out:{x:0,y:3}},{x:45,y:12,in:{x:45,y:0}},{x:45,y:100},{x:0,y:100}]]};
  const pencil: Vector = {...ink,id:'pencil',points:[{x:87,y:45},{x:87,y:245}]};
  const original=[...destination,red,pencil];
  const f=await openMergeStage(page,400,320,original);
  const left={x:223,y:130},right={x:275,y:130},over={x:205,y:130},junction={x:242,y:155};
  const owners=(art:Vector[],p:Point)=>art.filter(s=>!s.strokeWidth&&hit(s,p,0));
  expect(owners(original,left).map(s=>s.id)).toEqual(owners(original,right).map(s=>s.id));
  await page.mouse.click(...f.at({x:50,y:105}));
  await page.keyboard.down('Shift');
  await page.mouse.click(...f.at({x:87,y:100}));
  await page.keyboard.up('Shift');
  await f.draw([{x:50,y:105},{x:205,y:115}]);
  await expect.poll(async()=>(await f.read()).find(s=>s.id===red.id)?.x).toBeCloseTo(190,5);
  expect(owners(await f.read(),over)).toHaveLength(2);
  await f.canvas.press('Escape');
  await expect.poll(async()=>owners(await f.read(),over).map(s=>s.fill)).toEqual([red.fill]);
  await expect.poll(async()=>{
    const art=await f.read(), a=owners(art,left), b=owners(art,right);
    return a.length===1 && b.length===1 && a[0].id!==b[0].id;
  }).toBe(true);
  const settled=await f.read();
  expect(settled.find(s=>s.id===red.id)?.contours).toEqual(red.contours);
  const inkAtJunction=settled.filter(s=>s.strokeWidth&&hit(s,junction,0));
  expect(inkAtJunction.length).toBeGreaterThanOrEqual(4);
  expect(inkAtJunction.every(s=>s.fillEnabled===false&&s.strokeWidth===2)).toBe(true);
  await expect.poll(()=>f.pixel(over)).toEqual([255,68,0,255]);
  await expect.poll(()=>f.pixel(right)).toEqual([0,136,255,255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(original);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(settled);
});

test('moving a marquee through a Brush stroke keeps both curved outlines editable', async ({page})=>{
  const {canvas, draw, read, pixel} = await openMergeStage(page);
  await page.getByRole('button', {name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('80');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#0088ff');
  await draw([{x:40,y:130},{x:95,y:120},{x:170,y:135},{x:235,y:120}]);
  await expect.poll(async () => (await read()).length).toBe(1);
  const original = await read();
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await draw([{x:-10,y:40},{x:107,y:190}]);
  await expect(page.getByText('Paint region ready: copy, cut or move.',{exact:true})).toBeVisible();
  await draw([{x:33,y:117},{x:33,y:148},{x:33,y:217}]);
  await expect.poll(async () => (await read()).length).toBe(2);
  const pieces=await read();
  for (const p of pieces) expect(p.contours?.some(r=>r.some(n=>n.in || n.out))).toBe(true);
  await canvas.press('Escape');
  expect(await pixel({x:54,y:125})).toEqual([255,255,255,255]);
  for (const p of [{x:54,y:225},{x:215,y:125}]) expect(await pixel(p)).toEqual([0,136,255,255]);
  // The pixels already match while Escape's drop worker is still settling.
  await expect(page.getByRole('combobox',{name:'Selection layers'})).toBeEnabled();
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(original);
});

for (const scribbleOnTop of [false,true]) test(`crosshatched brush drawing cuts on release with ${scribbleOnTop ? 'pink scribble' : 'purple wave'} on top`, async ({page}) => {
  test.setTimeout(60000);
  const { canvas, at, draw, read, pixel } = await openMergeStage(page,320,180);
  const place = (path: Point[]) => path.map(p => ({x:p.x-38,y:p.y-55}));
  await page.getByRole('button', { name:'Pencil', exact:true }).click();
  await draw(place(pencilWave));
  await expect.poll(async () => (await read()).length).toBeGreaterThan(0);
  await page.getByRole('button', { name:'Brush', exact:true }).click();
  await page.getByLabel('Brush size', {exact:true}).fill('9');
  const lowerColor = scribbleOnTop ? '#7055ff' : '#ff5588', topColor = scribbleOnTop ? '#ff5588' : '#7055ff';
  const lowerPath = place(scribbleOnTop ? verticalWave : diagonalScribble), topPath = place(scribbleOnTop ? diagonalScribble : verticalWave);
  const fill = page.getByLabel('Drawing fill', {exact:true});
  await fill.fill(lowerColor);
  await draw(lowerPath);
  await expect.poll(async () => (await read()).some(s => !s.strokeWidth && s.fill === lowerColor)).toBe(true);
  const before = await read();
  await fill.fill(topColor);
  await draw(topPath);
  await expect.poll(async () => (await read()).some(s => !s.strokeWidth && s.fill === topColor)).toBe(true);
  const after = await read();
  const lower = after.filter(s => s.fill === lowerColor && !s.strokeWidth);
  expect(lower.length).toBeGreaterThan(8);
  const probes = topPath.filter(p => before.some(s => !s.strokeWidth && hit(s,p,0)) &&
    after.some(s => !s.strokeWidth && s.fill === topColor && hit(s,p,0)));
  expect(probes.length).toBeGreaterThan(8);
  for (const p of probes) expect(lower.some(s => hit(s,p,0))).toBe(false);
  // Moving the paint away must reveal a real cut, even at a spot that
  // looked correct before because the upper color hid the lower one.
  const dx = 54, dy = 27;
  const pick = probes.find(p => p.x>2 && p.x<318 && p.y>2 && p.y<178 &&
    !after.some(s => s.strokeWidth && hit(s,p,6)) &&
    !after.some(s => s.fill === topColor && hit(s,{x:p.x-dx,y:p.y-dy},0)))!;
  expect(pick).toBeDefined();
  await page.getByRole('button', {name:'Selection', exact:true}).click();
  if (scribbleOnTop) {
    await page.mouse.move(...at(pick));
    await page.mouse.down();
    await page.mouse.move(...at({x:pick.x+dx,y:pick.y+dy}), {steps:8});
    await page.mouse.up();
  } else {
    await page.mouse.click(...at(pick));
    await canvas.press('Delete');
  }
  await expect.poll(() => pixel(pick)).toEqual([255,255,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(after);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

test('Bucket joins the crosshatched Brush colors and Pencil immediately splits the result', async ({page}) => {
  test.setTimeout(60000);
  const {canvas,at,draw,read,pixel} = await openMergeStage(page);
  const blue = '#0088ff', pink = '#ff5588';
  const fill = page.getByLabel('Drawing fill',{exact:true});
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('9');
  await fill.fill(blue);
  await draw(verticalWave);
  await expect.poll(async () => (await read()).length).toBe(1);
  await fill.fill(pink);
  await draw(diagonalScribble);
  await expect.poll(async () => (await read()).length).toBeGreaterThan(9);
  const crossed = await read();
  await page.getByRole('button',{name:'Paint bucket',exact:true}).click();
  await fill.fill(blue);
  await page.mouse.click(...at(diagonalScribble[10]));
  await expect.poll(async () => (await read()).map(s=>s.fill)).toEqual([blue]);
  const joined = await read();
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await draw([{x:3,y:94},{x:395,y:99}]);
  await expect.poll(async ()=>(await read()).some(s=>s.strokeWidth>0)).toBe(true);
  await expect.poll(async () => (await read()).filter(s => !s.strokeWidth).length).toBeGreaterThan(2);
  const cut = await read(), faces = cut.filter(s => !s.strokeWidth);
  const picks = new Map<string,Point>();
  for (const p of [...verticalWave,...diagonalScribble]) {
    const face = faces.find(s=>hit(s,p,0));
    if (face && !picks.has(face.id) && !cut.some(s=>s.strokeWidth && hit(s,p,5)) &&
        (await pixel(p)).join() === '0,136,255,255') picks.set(face.id,p);
    if (picks.size === 2) break;
  }
  expect(picks.size).toBe(2);
  const [first,second] = [...picks.values()];
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(first));
  await canvas.press('Delete');
  await expect.poll(()=>pixel(first)).toEqual([255,255,255,255]);
  await expect.poll(()=>pixel(second)).toEqual([0,136,255,255]);
  for (const state of [cut,joined,crossed]) {
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(state);
  }
});

for (const continuous of [true,false]) test(`Brush paint cut by ${continuous ? 'self-crossing Pencil' : 'three connected Pencil strokes'} stays curved after Bucket`,async ({page})=>{
  const {canvas,at,draw,read,pixel} = await openMergeStage(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('80');
  const fill = page.getByLabel('Drawing fill',{exact:true});
  await fill.fill('#0088ff');
  await draw([{x:40,y:130},{x:95,y:120},{x:170,y:135},{x:235,y:120}]);
  await expect.poll(async ()=>(await read()).length).toBe(1);
  const [source] = await read();
  const handles = (s:typeof source) => (s.contours ?? []).flatMap(r=>r.flatMap(n=>[n.in,n.out].flatMap(p=>
    p ? [{x:s.x+p.x,y:s.y+p.y}] : [])));
  const untouched = source.contours!.flatMap(r=>r.flatMap((a,i)=>{
    const b=r[(i+1)%r.length], points=[a,a.out ?? a,b.in ?? b,b];
    if (!points.every(p=>source.x+p.x<60) && !points.every(p=>source.x+p.x>195)) return [];
    return [a.out,b.in].flatMap(p=>p ? [{x:source.x+p.x,y:source.y+p.y}] : []);
  }));
  expect(untouched.length).toBeGreaterThan(2);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
  await page.getByLabel('Pencil optimize',{exact:true}).uncheck();
  const gestures = continuous ? [[[60,60],[195,161],[60,158],[195,61]]] :
    [[[110,20],[118,111]],[[118,111],[137,137]],[[137,137],[145,220]]];
  for (const points of gestures) await draw(points.map(([x,y])=>({x,y})));
  await expect.poll(async ()=>(await read()).filter(s=>!s.strokeWidth).length).toBeGreaterThanOrEqual(continuous ? 3 : 2);
  const cut = await read(), paint = cut.filter(s=>!s.strokeWidth);
  const actual = paint.flatMap(handles);
  for (const p of untouched) expect(actual.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<1e-9)).toBe(true);
  const left = {x:54,y:125}, right = continuous ? {x:130,y:146} : {x:215,y:125};
  const leftFaces = paint.filter(s=>hit(s,left,0)), rightFaces = paint.filter(s=>hit(s,right,0));
  expect(leftFaces).toHaveLength(1);
  expect(rightFaces).toHaveLength(1);
  expect(leftFaces[0].id).not.toBe(rightFaces[0].id);
  await page.getByRole('button',{name:'Paint bucket',exact:true}).click();
  await fill.fill('#ff5588');
  await page.mouse.click(...at(left));
  await expect.poll(()=>pixel(left)).toEqual([255,85,136,255]);
  expect(await pixel(right)).toEqual([0,136,255,255]);
  await expect.poll(async ()=>(await read()).some(s=>s.fill==='#ff5588')).toBe(true);
  const after = await read();
  expect(after.map(s=>s.contours)).toEqual(cut.map(s=>s.contours));
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
});

test('same-color crosshatched Brush strokes select as one fill', async ({page}) => {
  test.setTimeout(60000);
  const {canvas,at,draw,read,pixel} = await openMergeStage(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('9');
  await page.getByLabel('Drawing fill',{exact:true}).fill('#ff5588');
  await draw(verticalWave);
  await expect.poll(async () => (await read()).length).toBe(1);
  const before = await read();
  await draw(diagonalScribble);
  await expect.poll(async () => (await read())[0].contours!.length).toBeGreaterThan(2);
  const joined = await read();
  expect(joined).toHaveLength(1);
  const first = verticalWave[12], second = diagonalScribble[10];
  for (const p of [first,second]) expect(await pixel(p)).toEqual([255,85,136,255]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(second));
  await canvas.press('Delete');
  await expect.poll(read).toEqual([]);
  for (const p of [first,second]) expect(await pixel(p)).toEqual([255,255,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(joined);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

test('a second Brush splits a painted circle into independently deletable curved pieces', async ({page}) => {
  const {canvas, at, draw, read, pixel} = await openMergeStage(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Brush size',{exact:true}).fill('32');
  await page.getByLabel('Brush simplify amount',{exact:true}).fill('50');
  const fill=page.getByLabel('Drawing fill',{exact:true});
  await fill.fill('#0088ff');
  await draw(circleSamples);
  await expect.poll(async ()=>(await read()).length).toBe(1);
  const original=await read();
  await fill.fill('#ff6600');
  await draw(spiralSamples);
  await expect.poll(async ()=>(await read()).filter(s=>s.fill==='#0088ff').length).toBeGreaterThan(1);
  const cut=await read(), picks=new Map<string,Point>();
  let crossing:Point|undefined;
  // The spiral can cover the circle's centerline while leaving editable
  // crescents on its inner or outer edge. Probe across the painted width.
  const probes=circleSamples.flatMap(p=>[-12,-8,-4,0,4,8,12].map(offset=>({
    x:Math.round(p.x+offset*(p.x-190)/85),y:Math.round(p.y+offset*(p.y-150)/85),
  })));
  for(const p of probes) {
    if(!hit(original[0],p,0))continue;
    const owners=cut.filter(s=>hit(s,p,0));
    if(owners.length!==1) continue;
    const color=(await pixel(p)).join();
    if(owners[0].fill==='#0088ff' && color==='0,136,255,255') picks.set(owners[0].id,p);
    if(owners[0].fill==='#ff6600' && color==='255,102,0,255') crossing=p;
    if(picks.size>=2 && crossing) break;
  }
  expect(picks.size).toBeGreaterThanOrEqual(2);
  expect(crossing).toBeDefined();
  const [[id,first],[,second]]=[...picks];
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  await page.mouse.click(...at(first));
  await canvas.press('Delete');
  await expect.poll(read).toEqual(cut.filter(s=>s.id!==id));
  await expect.poll(()=>pixel(first)).toEqual([255,255,255,255]);
  await expect.poll(()=>pixel(second)).toEqual([0,136,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await page.mouse.click(...at(crossing!));
  await canvas.press('Delete');
  await expect.poll(()=>pixel(crossing!)).toEqual([255,255,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(original);
});

test.describe('broken.spl saved Merge Drawing frame', () => {
  let saved: Vector[];
  test.beforeEach(() => {
    const frame = brokenFrame();
    test.skip(!frame, 'Requires the reported saved revision');
    saved = frame!;
    expect(saved).toHaveLength(393);
  });

  test('Pencil immediately separates selectable purple paint across an existing narrow curve', async ({page}) => {
    const {canvas, at, draw, pixel, read} = await openMergeStage(page, 960, 540, saved);
    const above = {x:325, y:212}, below = {x:325, y:229};
    const purple = [109,94,252,255];
    const owners = (shapes: Vector[], p: Point) => shapes.filter(s => !s.strokeWidth && hit(s,p,0)).map(s => s.id);
    const original = ['595bc7d4-3b80-4006-91ef-78079475c9b9'];
    for (const p of [above,below]) {
      expect(owners(saved,p)).toEqual(original);
      await expect.poll(() => pixel(p)).toEqual(purple);
    }
    await page.getByRole('button',{name:'Pencil',exact:true}).click();
    await draw([{x:300,y:220},{x:440,y:220}]);
    await expect.poll(async () => {
      const after = await read();
      const top = owners(after,above), bottom = owners(after,below);
      return top.length === 1 && bottom.length === 1 && top[0] !== bottom[0];
    }).toBe(true);
    const cut = await read();
    await page.getByRole('button',{name:'Selection',exact:true}).click();
    await page.mouse.click(...at(above));
    await canvas.press('Delete');
    await expect.poll(() => pixel(above)).toEqual([255,255,255,255]);
    await expect.poll(() => pixel(below)).toEqual(purple);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(cut);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(saved);
  });

  test('one Bucket click unites the three touching green Brush faces for selection and deletion', async ({page}) => {
    const {canvas, at, pixel, read} = await openMergeStage(page, 960, 540, saved);
    const probes = [{x:206,y:381},{x:361,y:414},{x:57,y:136}];
    const green = [95,252,134,255];
    const owners = (shapes: Vector[]) => probes.map(p => shapes.filter(s => !s.strokeWidth && hit(s,p,0)).map(s=>s.id));
    expect(owners(saved)).toEqual([
      ['192781ac-e646-43ff-a376-86654aaa86c8'],
      ['e5fcb236-93bb-4bbb-9b26-e9582452f40d'],
      ['5267d540-4c3f-420e-9a00-80445b5c0931'],
    ]);
    await page.getByRole('button',{name:'Paint bucket',exact:true}).click();
    await page.getByLabel('Drawing fill',{exact:true}).fill('#5ffc86');
    await page.mouse.click(...at(probes[0]));
    await expect.poll(async () => {
      const ids = owners(await read());
      return ids.every(face => face.length === 1 && face[0] === ids[0][0]);
    }).toBe(true);
    const joined = await read();
    expect(joined.filter(s=>s.strokeWidth)).toEqual(saved.filter(s=>s.strokeWidth));
    for (const p of probes) await expect.poll(() => pixel(p)).toEqual(green);
    await page.getByRole('button',{name:'Selection',exact:true}).click();
    await page.mouse.click(...at(probes[0]));
    await canvas.press('Delete');
    for (const p of probes) await expect.poll(() => pixel(p)).toEqual([255,255,255,255]);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(joined);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(saved);
  });

  test('Pencil cuts the newly recolored Brush region with its neighboring ink still on the stage', async ({page})=>{
    await page.setViewportSize({width:1700,height:950});
    const {canvas,at,draw,read,pixel}=await openMergeStage(page,960,540,saved);
    const seed=saved[183], pick={x:57,y:136};
    await page.getByRole('button',{name:'Paint bucket',exact:true}).click();
    await page.getByLabel('Drawing fill',{exact:true}).fill('#6d5efc');
    await page.mouse.click(...at(pick));
    await expect.poll(async()=>(await read()).length).toBeLessThan(saved.length);
    const joined=await read(), face=joined.find(s=>s.id===seed.id)!;
    expect(face.fill).toBe('#6d5efc');
    await expect.poll(()=>pixel(pick)).toEqual([109,94,252,255]);
    await page.getByRole('button',{name:'Pencil',exact:true}).click();
    await draw([{x:20,y:230},{x:700,y:235}]);
    const paintCount=(art:Vector[])=>art.filter(s=>!s.strokeWidth).length;
    await expect.poll(async()=>paintCount(await read())).toBeGreaterThan(paintCount(joined));
    const cut=await read();
    const owners=(art:Vector[],p:Point)=>art.filter(s=>!s.strokeWidth && hit(s,p,0)).map(s=>s.id);
    let divided=false;
    for(let x=50;x<690 && !divided;x+=4){
      const y=230+5*(x-20)/680, a={x,y:y-3}, b={x,y:y+3};
      if (!hit(face,a,0) || !hit(face,b,0)) continue;
      const left=owners(cut,a), right=owners(cut,b);
      divided=left.length===1 && right.length===1 && left[0]!==right[0] &&
        owners(joined,a).join()===seed.id && owners(joined,b).join()===seed.id;
    }
    expect(divided).toBe(true);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(joined);
  });
});

test('drawtest2 replay permits picking and deleting the green crossing and individual purple pieces',async ({page})=>{
  const file='.local-projects/drawtest2.spl/vectors/c91b92e2-a74c-4780-a96b-18403f09b052.json';
  test.skip(!existsSync(file),'Local saved revision');
  const [saved]=Object.values(JSON.parse(readFileSync(file,'utf8'))) as Vector[][];
  let cut=saved.slice(0,1);
  for(const shape of saved.slice(1)) cut=prepareShapeDrawing(cut,{shape,merge:true,removeCoveredStrokes:true}).shapes;
  const {canvas,at,pixel,read}=await openMergeStage(page,960,540,cut);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  const picks=new Map<string,Point>();
  let crossing:Point|undefined;
  for(let y=170;y<360 && (!crossing||picks.size<2);y+=9) for(let x=300;x<600;x+=11){
    const p={x,y};
    if(!hit(saved[0],p,0))continue;
    const owners=cut.filter(s=>x>=s.x&&x<=s.x+s.width&&y>=s.y&&y<=s.y+s.height&&hit(s,p,0));
    if(owners.length!==1)continue;
    const s=owners[0];
    if(s.fill===saved[0].fill && !picks.has(s.id) && (await pixel(p)).join()==='109,94,252,255')picks.set(s.id,p);
    if(s.id===saved[1].id && (await pixel(p)).join()==='95,252,147,255')crossing=p;
    if(crossing && picks.size>=2)break;
  }
  expect(crossing).toBeDefined();
  expect(picks.size).toBeGreaterThanOrEqual(2);
  const [[id,first],[,second]]=[...picks];
  for(const [p,removed] of [[first,id],[crossing!,saved[1].id]] as const){
    await page.mouse.click(...at(p));
    await canvas.press('Delete');
    await expect.poll(async ()=>(await read()).map(s=>s.id)).toEqual(cut.filter(s=>s.id!==removed).map(s=>s.id));
    await expect.poll(()=>pixel(p)).toEqual([255,255,255,255]);
    await expect.poll(()=>pixel(second)).toEqual([109,94,252,255]);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(cut);
  }
});

for (const form of ['circle', 'spiral'] as const)
test(`Pencil cuts a hand-drawn Brush ${form} on release`, async ({ page }) => {
  const { canvas, at, draw, read, pixel } = await openMergeStage(page);
  const samples = form === 'circle' ? circleSamples : spiralSamples;
  await page.getByRole('button', {name:'Brush', exact:true}).click();
  await page.getByLabel('Brush size', {exact:true}).fill('18');
  await page.getByLabel('Drawing fill', {exact:true}).fill('#0088ff');
  await draw(samples);
  await expect.poll(async () => (await read()).length).toBe(1);
  const original = await read();
  await page.getByRole('button', {name:'Pencil', exact:true}).click();
  await draw(form === 'circle' ? [{x:55,y:140},{x:330,y:151}] : zigzagSamples);
  await expect.poll(async () => (await read()).filter(s => !s.strokeWidth).length).toBeGreaterThan(form === 'circle' ? 1 : 8);
  const cut = await read(), faces = cut.filter(s => !s.strokeWidth);
  expect(cut.filter(s => s.strokeWidth && s.fillEnabled === false).length).toBeGreaterThan(faces.length);
  expect(faces.every(s => s.contours?.some(r => r.some(n => n.in || n.out)))).toBe(true);
  if (form === 'circle') expect(faces.some(s => hit(s,{x:190,y:150},0))).toBe(false);
  const picks = new Map<string, Point>();
  for (const p of samples) {
    if (cut.some(s => s.strokeWidth && hit(s,p,8))) continue;
    const face = faces.find(s => hit(s,p,0));
    if (face && !picks.has(face.id) && (await pixel(p)).join() === '0,136,255,255') picks.set(face.id,p);
    if (picks.size === 2) break;
  }
  expect(picks.size).toBe(2);
  const [first,second] = [...picks.values()];
  await page.getByRole('button', {name:'Selection', exact:true}).click();
  await page.mouse.click(...at(first));
  await canvas.press('Delete');
  await expect.poll(() => pixel(first)).toEqual([255,255,255,255]);
  await expect.poll(() => pixel(second)).toEqual([0,136,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(original);
});

test('Brush cuts both earlier colors on repeated crossings', async ({ page }) => {
  const { canvas, draw, read, pixel } = await openMergeStage(page);
  await page.getByRole('button', {name:'Brush', exact:true}).click();
  await page.getByLabel('Brush size', {exact:true}).fill('14');
  const fill = page.getByLabel('Drawing fill', {exact:true});
  await fill.fill('#0088ff');
  await draw(spiralSamples);
  await expect.poll(async () => (await read()).length).toBe(1);
  await fill.fill('#dd2244');
  await draw([{x:200,y:36},{x:204,y:115},{x:212,y:191},{x:206,y:291}]);
  await expect.poll(async () => (await read()).filter(s => s.fill === '#0088ff').length).toBeGreaterThan(2);
  const before = await read();
  await fill.fill('#00aa44');
  await draw(zigzagSamples);
  await expect.poll(async () => (await read()).some(s => s.fill === '#00aa44')).toBe(true);
  const after = await read();
  const green = after.find(s => s.fill === '#00aa44')!;
  expect(green.contours?.some(r => r.some(n => n.in || n.out))).toBe(true);
  for (const color of ['#0088ff', '#dd2244']) {
    const old = before.filter(s => s.fill === color), pieces = after.filter(s => s.fill === color);
    expect(pieces.length).toBeGreaterThan(old.length);
    const crossings = zigzagSamples.filter(p => hit(green,p,0) && old.some(s => hit(s,p,0)));
    expect(crossings.length).toBeGreaterThan(1);
    for (const p of crossings) expect(pieces.some(s => hit(s,p,0))).toBe(false);
    expect(await pixel(crossings[0])).toEqual([0,170,68,255]);
  }
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

test('An outlined Oval cuts existing Pencil ink while drawing', async ({ page }) => {
  const { canvas, draw, read, pixel } = await openMergeStage(page);
  await page.getByRole('button', {name:'Pencil', exact:true}).click();
  await draw([{x:30,y:130},{x:325,y:154}]);
  await expect.poll(async () => (await read()).length).toBe(1);
  const before = await read();
  await page.getByRole('button', {name:'Oval', exact:true}).click();
  await page.getByLabel('Drawing fill', {exact:true}).fill('#0088ff');
  await page.getByLabel('Drawing stroke', {exact:true}).fill('#cc4444');
  await page.getByRole('checkbox', {name:'Remove covered lines', exact:true}).uncheck();
  await draw([{x:75,y:85},{x:262,y:210}]);
  await expect.poll(async () => (await read()).filter(s => !s.strokeWidth).length).toBe(2);
  const pieces = await read();
  const ink = pieces.filter(s => s.fillEnabled === false);
  expect(ink).toHaveLength(5);
  expect(ink.filter(s => s.stroke === '#cc4444' && s.kind === 'bezier')).toHaveLength(2);
  expect(ink.filter(s => s.stroke === before[0].stroke)).toHaveLength(3);
  expect(await pixel({x:160,y:110})).toEqual([0,136,255,255]);
  expect(await pixel({x:160,y:180})).toEqual([0,136,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
});

for (const scope of ['scene','symbol'] as const) for (const last of ['Brush','Oval'] as const) {
  test(`three-tool merge in ${scope} preserves shared curves with ${last} on top`,async({page})=>{
    const project=newProject();
    project.width=430;
    project.height=300;
    const marker:Vector={ id:'untouched',kind:'polygon',closed:true,fillRule:'evenodd',drawingMode:'merge',
      x:25,y:25,width:40,height:35,rotation:0,fill:'#12ab34',stroke:'#000000',strokeWidth:0,points:[],
      contours:[[{x:0,y:0,out:{x:12,y:-2}},{x:40,y:0,in:{x:30,y:-2}},{x:40,y:35},{x:0,y:35}]] };
    const layer=project.layers[0];
    layer.drawingMode=scope==='symbol'?'object':'merge';
    if (scope==='symbol') {
      const definition:SymbolDefinition={id:'three-tool',name:'Paint test',width:project.width,height:project.height,shapes:[marker]};
      project.symbols=[definition];
      layer.keys[0].shapes=[symbolInstance(definition,0,0)];
    } else layer.keys[0].shapes=[marker];
    validateProject(project);
    await page.addInitScript(p=>{
      if(!localStorage.getItem('splash-recovery-v1'))
        localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null}));
    },project);
    const recover=async()=>{
      await page.goto('/');
      await page.getByRole('button',{name:'Recover changes',exact:true}).click();
      await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
    };
    await recover();
    const canvas=page.getByLabel('Drawing stage',{exact:true});
    const tool=(name:string)=>page.getByLabel('Drawing tools',{exact:true}).getByRole('button',{name,exact:true});
    const workspace=page.getByRole('main',{name:'Symbol editing workspace',exact:true});
    const at=async([x,y]:[number,number])=>{
      const box=(await canvas.boundingBox())!;
      return [box.x+(box.width-project.width)/2+x,box.y+(box.height-project.height)/2+y] as const;
    };
    const draw=async(points:[number,number][])=>{
      await page.mouse.move(...await at(points[0]));
      await page.mouse.down();
      for(const point of points.slice(1)) await page.mouse.move(...await at(point));
      await page.mouse.up();
      await page.mouse.move(...await at([390,265]));
    };
    const read=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project));
    const artwork=async()=>{
      const p=await read();
      return scope==='symbol'?p.symbols![0].shapes:p.layers[0].keys[0].shapes;
    };
    const open=async()=>{
      if (scope!=='symbol') return;
      await tool('Selection').click();
      await page.mouse.dblclick(...await at([45,44]));
      await expect(workspace).toBeVisible();
    };
    const save=async()=>{
      if (scope!=='symbol') return;
      await workspace.getByRole('button',{name:'Save and return to scene',exact:true}).click();
      await expect(workspace).toHaveCount(0);
    };
    const pixel=(x:number,y:number)=>canvas.evaluate((node,{x,y,w,h})=>{
      const c=node as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData(Math.floor((c.width-w)/2+x),Math.floor((c.height-h)/2+y),1,1).data];
    },{x,y,w:project.width,h:project.height});
    const polygons=(shapes:Vector[],fill:string)=>shapes.filter(s=>!s.strokeWidth&&s.fill===fill);
    const cubicKeys=(shape:Vector,reverse:boolean)=>shape.contours?.flatMap(ring=>ring.flatMap((a,i)=>{
      const b=ring[(i+1)%ring.length];
      if (!a.out&&!b.in) return [];
      const controls=[a,a.out??a,b.in??b,b].map(point=>worldPoint(shape,point));
      return [JSON.stringify(reverse?controls.reverse():controls)];
    }))??[];
    const exactSeams=(shapes:Vector[])=>{
      const other=new Set(polygons(shapes,'#0088ff').flatMap(s=>cubicKeys(s,true)));
      return polygons(shapes,'#ff0000').flatMap(s=>cubicKeys(s,false)).filter(key=>other.has(key));
    };
    const red='#ff0000', blue='#0088ff', top=last==='Brush'?red:blue;
    const untouched=(await artwork())[0];

    for (const name of (last==='Brush'?['Oval','Brush']:['Brush','Oval'])) {
      const prior=await artwork();
      await open();
      await tool(name).click();
      await page.getByLabel('Drawing fill',{exact:true}).fill(name==='Brush'?red:blue);
      if(name==='Oval'){
        await page.getByLabel('Drawing stroke width',{exact:true}).fill('0');
        await draw([[196,75],[242,226]]);
        await expect.poll(()=>pixel(219,95)).toEqual([0,136,255,255]);
      } else {
        await page.getByLabel('Brush size',{exact:true}).fill('30');
        await page.getByLabel('Brush simplify amount',{exact:true}).fill('100');
        await draw([[150,135],[184,145],[216,168],[255,162],[290,156]]);
        await expect.poll(()=>pixel(275,158)).toEqual([255,0,0,255]);
      }
      if(scope==='symbol') expect(await artwork()).toEqual(prior);
      await save();
      await expect.poll(async()=>polygons(await artwork(),name==='Brush'?red:blue).length).toBeGreaterThan(0);
    }
    const merged=await artwork();
    const mergedSeams=exactSeams(merged);
    expect(mergedSeams.length).toBeGreaterThanOrEqual(2);
    expect(polygons(merged,top)).toHaveLength(1);
    expect(polygons(merged,last==='Brush'?blue:red)).toHaveLength(2);

    await open();
    await tool('Pencil').click();
    await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
    await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
    await page.getByLabel('Drawing stroke',{exact:true}).fill('#000000');
    await draw([[219,55],[219,252]]);
    await expect.poll(()=>pixel(219,112)).toEqual([0,0,0,255]);
    if(scope==='symbol') expect(await artwork()).toEqual(merged);
    await save();
    await expect.poll(async()=>(await artwork()).filter(s=>s.strokeWidth>0).length).toBeGreaterThan(1);
    const cut=await artwork();
    expect(polygons(cut,red)).toHaveLength(2);
    expect(polygons(cut,blue)).toHaveLength(last==='Brush'?4:2);
    const cutSeams=exactSeams(cut);
    expect(cutSeams.length).toBeGreaterThanOrEqual(2);
    expect(mergedSeams.filter(key=>cutSeams.includes(key)).length).toBeGreaterThanOrEqual(2);
    expect(cut.filter(s=>s.strokeWidth>0).every(s=>s.kind==='path'&&s.fillEnabled===false)).toBe(true);
    expect(cut.find(s=>s.id===marker.id)).toEqual(untouched);
    if(scope==='symbol') expect((await read()).layers).toEqual(project.layers);

    await recover();
    expect(await artwork()).toEqual(cut);
    expect(exactSeams(await artwork())).toEqual(exactSeams(cut));
    await open();
    const atTop=top===red?[255,0,0,255]:[0,136,255,255];
    await expect.poll(()=>pixel(209,162)).toEqual(atTop);
    await expect.poll(()=>pixel(228,162)).toEqual(atTop);
    await tool('Selection').click();
    await page.mouse.click(...await at([209,162]));
    await canvas.press('Delete');
    await expect.poll(()=>pixel(209,162)).toEqual([255,255,255,255]);
    await expect.poll(()=>pixel(228,162)).toEqual(atTop);
    await canvas.press('Control+z');
    await expect.poll(()=>pixel(209,162)).toEqual(atTop);
    expect(await artwork()).toEqual(cut);
    if(scope==='symbol') await workspace.getByRole('button',{name:'Cancel symbol editing',exact:true}).click();
    expect(await artwork()).toEqual(cut);
  });
}

test('shared symbol regrabs the reported floating Brush until one deselection settles it',async({page})=>{
  const saved=mergeFailFrame();
  test.skip(!saved,'Requires the reported merge fail revision');
  const original=saved!, moving=original.at(-1)!;
  const project=newProject();
  project.width=960;
  project.height=540;
  project.layers[0].drawingMode='object';
  const definition:SymbolDefinition={id:'floating-drop',name:'Floating Drop',width:960,height:540,shapes:original};
  project.symbols=[definition];
  project.layers[0].keys[0].shapes=[symbolInstance(definition,0,0)];
  validateProject(project);
  await page.addInitScript(p=>{
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null}));
  },project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const canvas=page.getByLabel('Drawing stage',{exact:true});
  const workspace=page.getByRole('main',{name:'Symbol editing workspace',exact:true});
  const at=async(x:number,y:number)=>{
    const box=(await canvas.boundingBox())!;
    return [box.x+(box.width-960)/2+x,box.y+(box.height-540)/2+y] as const;
  };
  await page.mouse.dblclick(...await at(660,100));
  await expect(workspace).toBeVisible();
  await canvas.evaluate(el=>{
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message:unknown,options?:StructuredSerializeOptions|Transferable[]){
      const request=message as {editedPieces?:string[];shapes?:Vector[]};
      if(request.editedPieces)
        (el as HTMLElement).dataset.floatingDrop=JSON.stringify(request);
      Reflect.apply(post,this,options===undefined?[message]:[message,options]);
    };
  });
  const read=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project));
  const pixel=(x:number,y:number)=>canvas.evaluate((el,{x,y})=>{
    const c=el as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData((c.width-960)/2+x,(c.height-540)/2+y,1,1).data];
  },{x,y});
  const drag=async(from:number,to:number,cancel=false)=>{
    await page.mouse.move(...await at(from,433));
    await page.mouse.down();
    await page.mouse.move(...await at(to,433),{steps:5});
    if(cancel)await canvas.press('Escape');
    await page.mouse.up();
  };
  const purple=[109,94,252,255], white=[255,255,255,255], green=[95,252,126,255];
  for(const [from,to] of [[454,534],[534,454],[454,534],[534,454]]){
    await drag(from,to);
    await expect.poll(()=>pixel(to,433)).toEqual(purple);
    await expect.poll(()=>pixel(from,433)).toEqual(white);
    expect(await canvas.getAttribute('data-floating-drop')).toBeNull();
    expect(await read()).toEqual(project);
  }
  await drag(454,610,true);
  await expect.poll(()=>pixel(454,433)).toEqual(purple);
  await expect.poll(()=>pixel(610,433)).toEqual(white);
  expect(await canvas.getAttribute('data-floating-drop')).toBeNull();

  await page.mouse.click(...await at(800,455));
  await expect(canvas).toHaveAttribute('data-floating-drop',/.+/);
  const request=JSON.parse((await canvas.getAttribute('data-floating-drop'))!) as {editedPieces:string[];shapes:Vector[]};
  expect(request.editedPieces).toEqual([moving.id]);
  expect(request.shapes.filter(s=>s.id!==moving.id)).toEqual(original.filter(s=>s.id!==moving.id));
  expect(request.shapes.find(s=>s.id===moving.id)).toEqual(moving);
  expect(await read()).toEqual(project);
  await workspace.getByRole('button',{name:'Save and return to scene',exact:true}).click();
  await expect(workspace).toHaveCount(0);
  const committed=await read(), art=committed.symbols![0].shapes;
  const joined=art.find(s=>hit(s,{x:454,y:433},0))!;
  for(const [x,y] of [[346,193],[343,151],[388,163],[445,256],[445,337],[412,241],[421,325],[424,373],[370,199],[436,289]])
    expect(art.filter(s=>hit(s,{x,y},0))).toEqual([joined]);
  expect(joined.contours?.some(r=>r.some(n=>n.in&&n.out))).toBe(true);
  expect(committed.layers).toEqual(project.layers);
  await expect.poll(()=>pixel(499,109)).toEqual(green);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(project);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(committed);
});
