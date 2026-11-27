import { expect, test, type Page } from '@playwright/test';
import {
  newProject,
  validateProject,
  type Project,
  type Vector,
} from '../../packages/document/src';
import { narrowArrangementOutline } from '../narrow-arrangement-fixture';
import { regionMoveArtwork } from '../paint-region-move-fixture';
import { worldStrokePolygons } from '../../packages/geometry/src/strokes';
import { pathCommands, worldPaths } from '../../packages/geometry/src/drawing';
import { contains, vectorPolygons, mergeControlBounds, mergeVectors } from '../../packages/geometry/src/merge';
function fixture(tool: 'Brush' | 'Pencil') {
  const p = newProject();
  p.width = 600;
  p.height = 360;
  p.layers[0].drawingMode = 'merge';
  const s: Vector = {
    id: 'ink',
    kind: tool === 'Brush' ? 'brush' : 'bezier',
    x: 100,
    y: 120,
    width: 100,
    height: 12,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: tool === 'Brush' ? 12 : 6,
    points:
      tool === 'Brush'
        ? [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ]
        : [],
    ...(tool === 'Pencil'
      ? {
          fillEnabled: false,
          nodes: [
            { x: 0, y: 0, out: { x: 30, y: 8 } },
            { x: 100, y: 0, in: { x: 70, y: -8 } },
          ],
        }
      : {}),
  };
  p.layers[0].keys[0].shapes = tool === 'Brush' ? mergeVectors([s]) : [s];
  p.layers[0].keys[0].shapes.push({
    id: 'remote',
    kind: 'path',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#0000ff',
    strokeWidth: 2,
    points: [
      { x: 400, y: 50 },
      { x: 400, y: 300 },
    ],
  });
  return p;
}
async function setup(
  page: Page,
  p: Project,
  region: false | { left: number; top: number; right: number; bottom: number } = {
    left: 110,
    top: 90,
    right: 160,
    bottom: 160,
  },
) {
  validateProject(p);
  await page.addInitScript((p) => {
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
    const NativeWorker = window.Worker,
      queue: ((fail: boolean) => void)[] = [];
    Object.assign(window, {
      holdPaintMove: false,
      holdPaintClip: false,
      paintMovePending: () => queue.length,
      releasePaintMove: (fail = false) => queue.splice(0).forEach((f) => f(fail)),
    });
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const m = message as { id: number; splitPaintRegion?: unknown; editedPieces?: string[] };
        const send = (fail: boolean) => {
          if (fail)
            this.dispatchEvent(
              new MessageEvent('message', { data: { id: m.id, error: 'Simulated move failure' } }),
            );
          else if (Array.isArray(transfer)) super.postMessage(message, transfer);
          else super.postMessage(message, transfer);
        };
        if (
          ((window as unknown as { holdPaintClip: boolean }).holdPaintClip && m.splitPaintRegion) ||
          ((window as unknown as { holdPaintMove: boolean }).holdPaintMove && m.editedPieces)
        )
          queue.push(send);
        else send(false);
      }
    };
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
  const point = (x: number, y: number) =>
    canvas.evaluate(
      (n, { x, y, p }) => {
        const c = n as HTMLCanvasElement,
          r = c.getBoundingClientRect();
        return {
          x: r.left + r.width / 2 + ((x - p.width / 2) * r.width) / (c.width / devicePixelRatio),
          y: r.top + r.height / 2 + ((y - p.height / 2) * r.height) / (c.height / devicePixelRatio),
        };
      },
      { x, y, p },
    );
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  if (region) {
    const a = await point(region.left, region.top),
      b = await point(region.right, region.bottom);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  }
  // Avoid the new cage and pivot, plus the existing selected-curve outline.
  const probe =
    !region && p.layers[0].keys[0].shapes[0]?.kind === 'bezier'
      ? { x: 175, y: 115 }
      : { x: 125, y: 120 };
  const pixels = () =>
    canvas.evaluate(
      (n, { p, probe }) => {
        const c = n as HTMLCanvasElement,
          ctx = c.getContext('2d')!;
        const at = (x: number, y: number) =>
          Array.from(
            ctx.getImageData(
              Math.round(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
              Math.round(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
              1,
              1,
            ).data,
          );
        return { old: at(probe.x, probe.y), moved: at(probe.x + 200, probe.y) };
      },
      { p, probe },
    );
  return { canvas, read, point, pixels, probe };
}
for (const selection of ['region', 'piece'] as const)
  for (const tool of ['Brush', 'Pencil'] as const)
    for (const fail of [false, true])
      test(`${tool} selected ${selection} stays at the released destination through deselection merge, failure ${fail}`, async ({
        page,
      }) => {
        const p = fixture(tool),
          f = await setup(
            page,
            p,
            selection === 'region' ? { left: 110, top: 90, right: 160, bottom: 160 } : false,
          ),
          a = await f.point(125, 120),
          b = await f.point(325, 120);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await f.canvas.evaluate(async () => {
          for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
        });
        const originalSelectedPixels = await f.pixels();
        expect(originalSelectedPixels.moved).toEqual([255, 255, 255, 255]);
        expect(originalSelectedPixels.old[0]).toBeGreaterThan(200);
        expect(originalSelectedPixels.old[1]).toBeLessThan(40);
        expect(originalSelectedPixels.old[2]).toBeLessThan(40);
        expect(originalSelectedPixels.old[3]).toBe(255);
        await page.mouse.move(b.x, b.y, { steps: 4 });
        await expect.poll(f.pixels).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
        await page.evaluate(() => Object.assign(window, { holdPaintMove: true }));
        await f.canvas.evaluate(
          (n, { p, probe }) => {
            const c = n as HTMLCanvasElement,
              frames: { old: number[]; moved: number[] }[] = [];
            let handle = 0;
            const sample = () => {
              const ctx = c.getContext('2d')!,
                at = (x: number, y: number) =>
                  Array.from(
                    ctx.getImageData(
                      Math.round(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
                      Math.round(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
                      1,
                      1,
                    ).data,
                  );
              frames.push({ old: at(probe.x, probe.y), moved: at(probe.x + 200, probe.y) });
              handle = requestAnimationFrame(sample);
            };
            Object.assign(window, {
              moveFrames: frames,
              stopMoveFrames: () => cancelAnimationFrame(handle),
            });
            sample();
          },
          { p, probe: f.probe },
        );
        await page.mouse.up();
        await expect.poll(f.read).not.toEqual(p);
        const placed = await f.read();
        const pending = () => page.evaluate(() =>
          (window as unknown as { paintMovePending: () => number }).paintMovePending());
        expect(await pending()).toBe(0);
        await f.canvas.press('Escape');
        await expect
          .poll(pending)
          .toBe(1);
        await f.canvas.evaluate(async () => {
          for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        });
        const frames = await page.evaluate(() => {
          const w = window as unknown as {
            moveFrames: { old: number[]; moved: number[] }[];
            stopMoveFrames: () => void;
          };
          return w.moveFrames;
        });
        expect(frames.length).toBeGreaterThan(8);
        for (const frame of frames)
          expect(frame).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
        expect(await f.read()).toEqual(placed);
        if (fail)
          await page.evaluate(() =>
            (window as unknown as { stopMoveFrames: () => void }).stopMoveFrames(),
          );
        await page.evaluate(
          (fail) =>
            (window as unknown as { releasePaintMove: (fail: boolean) => void }).releasePaintMove(
              fail,
            ),
          fail,
        );
        if (fail) {
          await expect(page.getByRole('alert')).toContainText('Simulated move failure');
          expect(await f.read()).toEqual(placed);
          await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
        }
        await expect.poll(f.read).not.toEqual(p);
        await expect.poll(f.pixels).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
        if (!fail) {
          await f.canvas.evaluate(async () => {
            for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
          });
          const complete = await page.evaluate(() => {
            const w = window as unknown as {
              moveFrames: { old: number[]; moved: number[] }[];
              stopMoveFrames: () => void;
            };
            w.stopMoveFrames();
            return w.moveFrames;
          });
          expect(complete.length).toBeGreaterThan(frames.length + 7);
          for (const frame of complete)
            expect(frame).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
        }
        const out = await f.read();
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(out);
        await expect(page.getByRole('alert')).toHaveCount(0);
      });

test('mixed curved Brush/Pencil selection moves without the narrow-face error and keeps all source history', async ({
  page,
}) => {
  const p = newProject(),
    { art } = regionMoveArtwork(0);
  p.width = 600;
  p.height = 360;
  p.layers[0].drawingMode = 'merge';
  const narrow=narrowArrangementOutline(320,6_000_000);
  p.layers[0].keys[0].shapes = [...art,narrow];
  const f = await setup(page, p, { left: 180, top: 110, right: 310, bottom: 220 }),
    a = await f.point(240, 150),
    b = await f.point(253.3, 142.3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(f.read).not.toEqual(p);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(
    out.layers[0].keys[0].shapes.some((s) => s.fillEnabled === false && s.strokeWidth === 2),
  ).toBe(true);
  expect(out.layers[0].keys[0].shapes).toContainEqual(narrow);
  expect({ ...out, layers: p.layers }).toEqual(p);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('moving an enclosed selection leaves no editable sliver at its old position',async({page})=>{
  const p=newProject();p.width=600;p.height=360;p.layers[0].drawingMode='merge';
  p.layers[0].keys[0].shapes=[0,1,2].map(i=>({
    id:'rect'+i,kind:'rectangle',x:50+i*3.1713,y:40+7*0.211+i*2.793,width:32.124,height:22.31,
    rotation:7.4+7*0.37+i*14.24,fill:'#ff0000',stroke:'#000000',strokeWidth:i===2?2:0,points:[]
  }));
  const f=await setup(page,p,{left:2,top:2,right:150,bottom:150});
  const a=await f.point(56,55),b=await f.point(256,55);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
  await expect.poll(f.read).not.toEqual(p);
  const moved=await f.read(),art=moved.layers[0].keys[0].shapes;
  expect(art.length).toBeGreaterThan(0);
  expect(art.every(shape=>mergeControlBounds(shape).left>150)).toBe(true);
  const c=await f.point(356,55);
  await page.mouse.move(b.x,b.y);await page.mouse.down();await page.mouse.move(c.x,c.y,{steps:4});await page.mouse.up();
  await expect.poll(f.read).not.toEqual(moved);
  expect((await f.read()).layers[0].keys[0].shapes.every(shape=>mergeControlBounds(shape).left>310)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.canvas.focus();await page.keyboard.press('Control+z');await expect.poll(f.read).toEqual(moved);
  await page.keyboard.press('Control+z');await expect.poll(f.read).toEqual(p);
});

test('dragging a selection again leaves artwork in the empty marquee margin behind',async({page})=>{
  const p=fixture('Brush'), shapes=p.layers[0].keys[0].shapes;
  const untouched:Vector={id:'margin',kind:'rectangle',x:330,y:150,width:12,height:12,
    rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};
  shapes.push(untouched);
  const f=await setup(page,p,{left:75,top:85,right:220,bottom:175});
  async function drag(from:number,to:number){
    const a=await f.point(from,120),b=await f.point(to,120);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();
  }
  await drag(125,325);await expect.poll(f.read).not.toEqual(p);
  const first=await f.read();await drag(325,425);await expect.poll(f.read).not.toEqual(first);
  expect((await f.read()).layers[0].keys[0].shapes).toContainEqual(untouched);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('erasing mixed paint beside an unresolved face keeps the cut and its history', async ({page}) => {
  const p=fixture('Brush');
  const outline=narrowArrangementOutline(320,6_000_000);
  p.layers[0].keys[0].shapes.push({...fixture('Pencil').layers[0].keys[0].shapes[0],id:'pencil'},outline);
  const f=await setup(page,p,false);
  await page.getByRole('button',{name:'Eraser',exact:true}).click();
  const a=await f.point(125,100), b=await f.point(125,140);
  await page.mouse.move(a.x,a.y); await page.mouse.down();
  await page.mouse.move(b.x,b.y,{steps:6}); await page.mouse.up();
  await expect.poll(f.read).not.toEqual(p);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(async()=>(await f.pixels()).old).toEqual([255,255,255,255]);
  const erased=await f.read();
  expect(erased.layers[0].keys[0].shapes).toContainEqual(outline);
  await f.canvas.focus();await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');await expect.poll(f.read).toEqual(erased);
});

for (const tool of ['Brush', 'Pencil'] as const)
  for (const finish of ['release', 'cancel'] as const)
    test(`${tool} region drag waits until release to dispatch vector clipping, ${finish}`, async ({
      page,
    }) => {
      const p = fixture(tool),
        f = await setup(page, p),
        a = await f.point(125, 120),
        b = await f.point(325, 120);
      const pending = () => page.evaluate(() => (window as unknown as { paintMovePending: () => number }).paintMovePending());
      await page.evaluate(() => Object.assign(window, { holdPaintClip: true }));
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y);
      await expect
        .poll(f.pixels, { timeout: 1500 })
        .toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
      expect(await f.read()).toEqual(p);
      expect(await pending()).toBe(0);
      if (finish === 'cancel') await page.keyboard.press('Escape');
      await page.mouse.up();
      if (finish === 'release')
        await expect.poll(f.pixels).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
      else
        await expect.poll(f.pixels).toEqual({ old: [255, 0, 0, 255], moved: [255, 255, 255, 255] });
      await expect.poll(pending).toBe(finish === 'release' ? 1 : 0);
      await page.evaluate(() => {
        Object.assign(window, { holdPaintClip: false });
        (window as unknown as { releasePaintMove: () => void }).releasePaintMove();
      });
      if (finish === 'release') {
        await expect.poll(f.read).not.toEqual(p);
        const out = await f.read();
        await expect.poll(f.pixels).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
        await f.canvas.focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(p);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(f.read).toEqual(out);
      } else {
        await f.canvas.evaluate(async () => {
          for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        });
        expect(await f.read()).toEqual(p);
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
    });

test('a bunch of Brush strokes moves immediately while unselected ink and protected groups stay fixed', async ({
  page,
}) => {
  const p = fixture('Brush'),
    shapes = p.layers[0].keys[0].shapes;
  for (let i = 0; i < 24; i++)
    shapes.push({
      id: `brush-${i}`,
      kind: 'brush',
      brush: { pressure: false, tilt: false, minimum: 1, aspect: 1, angle: 0 },
      x: 100,
      y: 140 + i * 8,
      width: 100,
      height: 4,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#ff0000',
      strokeWidth: 4,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
  const protectedShape: Vector = {
    id: 'protected',
    kind: 'rectangle',
    x: 146,
    y: 116,
    width: 8,
    height: 8,
    rotation: 0,
    fill: '#00ff00',
    stroke: '#00ff00',
    strokeWidth: 0,
    points: [],
    groups: ['group-protected'],
  };
  p.layers.push({
    ...structuredClone(p.layers[0]),
    id: 'protected-layer',
    name: 'Protected group',
    drawingMode: 'object',
    keys: [{ frame: 0, shapes: [protectedShape] }],
  });
  const f = await setup(page, p, { left: 110, top: 90, right: 160, bottom: 330 }),
    a = await f.point(125, 120),
    b = await f.point(325, 120);
  const unchanged = () =>
    f.canvas.evaluate((n, p) => {
      const c = n as HTMLCanvasElement,
        ctx = c.getContext('2d')!,
        d = devicePixelRatio;
      return [180, 150].map((x) =>
        Array.from(
          ctx.getImageData(
            Math.round(c.width / 2 + (x - p.width / 2) * d),
            Math.round(c.height / 2 + (120 - p.height / 2) * d),
            1,
            1,
          ).data,
        ),
      );
    }, p);
  await page.evaluate(() => Object.assign(window, { holdPaintClip: true }));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await expect.poll(f.pixels).toEqual({ old: [255, 255, 255, 255], moved: [255, 0, 0, 255] });
  await expect.poll(unchanged).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
  ]);
  expect(await f.read()).toEqual(p);
  const pending = () => page.evaluate(() => (window as unknown as { paintMovePending: () => number }).paintMovePending());
  expect(await pending()).toBe(0);
  await page.mouse.up();
  await expect.poll(pending).toBe(1);
  await page.evaluate(() => {
    Object.assign(window, { holdPaintClip: false });
    (window as unknown as { releasePaintMove: () => void }).releasePaintMove();
  });
  await expect.poll(f.read).not.toEqual(p);
  await expect.poll(unchanged).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
  ]);
  expect((await f.read()).layers[1].keys[0].shapes.find((s) => s.id === 'protected')).toEqual(
    protectedShape,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const sameColor of [false, true]) {
  test(`deselection ${sameColor ? 'joins same-color fills' : 'cuts a matching curved seam'}`, async ({ page }) => {
    const p = fixture('Brush');
    const incoming: Vector = { id: 'round', kind: 'ellipse', x: 90, y: 85, width: 70, height: 70,
      rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
    p.layers[0].keys[0].shapes = [
      { ...incoming, id: 'destination', kind: 'rectangle', x: 250, y: 60, width: 220, height: 170,
        fill: sameColor ? '#ff0000' : '#0000ff' },
      incoming,
    ];
    const f = await setup(page, p, false);
    const start = await f.point(125, 120), end = await f.point(350, 135);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    const artwork = async () => (await f.read()).layers[0].keys[0].shapes;
    await expect.poll(async () => (await artwork()).at(-1)?.x).toBe(315);
    const placed = await artwork();
    expect(placed).toHaveLength(2);
    await f.canvas.press('Escape');
    if (sameColor) {
      await expect.poll(async () => (await artwork()).map(shape => shape.id)).toEqual(['destination']);
    } else {
      await expect.poll(async () => (await artwork())[0].contours?.some(ring => ring.some(node => node.out))).toBe(true);
      const [under, over] = await artwork();
      expect(over).toEqual(placed[1]);
      const path = worldPaths(over, 0.002)[0];
      const hole = worldPaths(under, 0.002).find(ring => ring.length > 5)!;
      expect(hole).toHaveLength(path.length);
      for (const point of path) expect(hole.some(p => Math.hypot(point.x - p.x, point.y - p.y) < 1e-8)).toBe(true);
    }
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
    const merged = await f.read();
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(p);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(merged);
  });
}

test('a finished Brush stroke cuts its curved outline into a different-color fill', async ({ page }) => {
  const p = fixture('Brush');
  p.layers[0].keys[0].shapes = [{ id: 'underpaint', kind: 'rectangle', x: 180, y: 70, width: 285, height: 185,
    rotation: 0, fill: '#0000ff', stroke: '#000000', strokeWidth: 0, points: [] }];
  const f = await setup(page, p, false);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
  const [start, middle, end] = await Promise.all([f.point(230, 135), f.point(290, 156), f.point(375, 145)]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 7 });
  await page.mouse.up();
  const artwork = async () => (await f.read()).layers[0].keys[0].shapes;
  await expect.poll(async () => (await artwork()).length).toBe(2);
  const [under, over] = await artwork();
  expect([under.fill, over.fill]).toEqual(['#0000ff', '#ff0000']);
  expect(over.contours?.flat().some(node => node.out || node.in)).toBe(true);
  const outline = worldPaths(over, 0.002)[0];
  const hole = worldPaths(under, 0.002).find(ring => ring.length > 5)!;
  expect(hole).toHaveLength(outline.length);
  for (const point of outline) expect(hole.some(p => Math.hypot(point.x - p.x, point.y - p.y) < 1e-8)).toBe(true);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(p);
});

for (const optimize of [true, false])
  test(`the finished Brush outline stays exact when cutting a drawn outlined fill (Optimize ${optimize})`, async ({ page }) => {
    const p = fixture('Brush');
    p.layers[0].keys[0].shapes = [];
    const f = await setup(page, p, false);
    const drag = async (points: [number, number][]) => {
      const [start, ...moves] = await Promise.all(points.map(([x, y]) => f.point(x, y)));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (const point of moves) await page.mouse.move(point.x, point.y, { steps: 5 });
      await page.mouse.up();
    };
    const draw = () => drag([[230, 135], [265, 165], [302, 131], [337, 157], [380, 145]]);
    const artwork = async () => (await f.read()).layers[0].keys[0].shapes;
    const fill = page.getByLabel('Drawing fill', { exact: true });
    const brush = page.getByRole('button', { name: 'Brush', exact: true });
    await brush.click();
    await fill.fill('#ff0000');
    await page.getByLabel('Brush simplify amount', { exact: true }).fill('150');
    await page.getByRole('checkbox', { name: 'Brush optimize', exact: true }).setChecked(optimize);
    await page.getByRole('checkbox', { name: 'Remove covered lines', exact: true }).setChecked(optimize);
    await draw();
    await expect.poll(async () => (await artwork()).length).toBe(1);
    const [blank] = await artwork();
    expect(pathCommands(blank).some(command => command[0] === 'C')).toBe(true);
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(p);
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await fill.fill('#0000ff');
    await drag([[180, 70], [465, 255]]);
    await expect.poll(async () => (await artwork()).length).toBe(2);
    const before = await f.read(), [, border] = await artwork();
    expect(border.fillEnabled).toBe(false);
    await brush.click();
    await fill.fill('#ff0000');
    await draw();
    await expect.poll(async () => (await artwork()).length).toBe(3);
    const final = await artwork();
    const under = final.find(s => s.fill === '#0000ff' && s.fillEnabled !== false)!;
    const over = final.find(s => s.fill === '#ff0000' && s.fillEnabled !== false)!;
    const outline = final.find(s => s.fillEnabled === false)!;
    expect(outline).toEqual(border);
    expect(pathCommands(over)).toEqual(pathCommands(blank));
    const ring = worldPaths(blank, 0.002)[0];
    expect(worldPaths(over, 0.002)[0]).toEqual(ring);
    const [, hole] = worldPaths(under, 0.002);
    expect(hole).toHaveLength(ring.length);
    expect(hole.every((point, i) => Math.hypot(point.x - ring[i].x, point.y - ring[i].y) < 1e-8)).toBe(true);
    const pixel = (x: number, y: number) => f.canvas.evaluate((node, { x, y }) => {
      const canvas = node as HTMLCanvasElement;
      return Array.from(canvas.getContext('2d')!.getImageData(
        canvas.width / 2 + (x - 300) * devicePixelRatio, canvas.height / 2 + (y - 180) * devicePixelRatio, 1, 1).data);
    }, { x, y });
    await expect.poll(() => pixel(230, 135)).toEqual([255, 0, 0, 255]);
    await expect.poll(() => pixel(200, 90)).toEqual([0, 0, 255, 255]);
    const after = await f.read();
    await f.canvas.press('Control+z');
    await expect.poll(f.read).toEqual(before);
    await f.canvas.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(after);
  });

for (const pick of ['whole', 'marquee'] as const) {
  test(`deselecting a ${pick} selection cuts only its final destination lines and fills`, async ({ page }) => {
    const p = fixture('Brush'), layer = p.layers[0], ink = layer.keys[0].shapes;
    ink.push({ id:'same-color', kind:'rectangle', x:295, y:110, width:85, height:36, rotation:0,
      fill:'#ff0000', stroke:'#000000', strokeWidth:0, points:[] });
    ink.push({ ...ink[1], id:'crossing', x:325, y:100, width:0, height:60,
      points:[{x:0,y:0},{x:0,y:60}], strokeWidth:4 });
    ink.push({ ...ink[3], id:'final-crossing', x:365 });
    const f = await setup(page,p,pick==='whole'?false:{left:110,top:90,right:160,bottom:160});
    const drag = async (x:number, dest:number) => {
      const a=await f.point(x,120), b=await f.point(dest,120);
      await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:5});
      if (x===125) await expect.poll(async ()=>(await f.pixels()).moved).toEqual([255,0,0,255]);
      await page.mouse.up();
    };
    const at = (doc:Project,x:number,y:number) => doc.layers[0].keys[0].shapes.flatMap(s=>
      contains(worldStrokePolygons(s),{x,y})?[s.stroke]:contains(vectorPolygons(s),{x,y})?[s.fill]:[]);
    const pending = () => page.evaluate(() =>
      (window as unknown as { paintMovePending: () => number }).paintMovePending());
    await page.evaluate(() => Object.assign(window, { holdPaintMove: true }));
    await drag(125,325);
    await expect.poll(async()=>at(await f.read(),325,120)).toEqual(['#ff0000','#0000ff','#ff0000']);
    expect(await pending()).toBe(0);
    const dropped=await f.read();
    await drag(325,365);
    await expect.poll(async()=>at(await f.read(),365,120)).toEqual(['#ff0000','#0000ff','#ff0000']);
    expect(await pending()).toBe(0);
    const placed = await f.read();
    expect(at(placed,325,120)).toEqual(['#ff0000','#0000ff']);
    if (pick === 'marquee') {
      const blank = await f.point(500,250);
      await page.mouse.click(blank.x,blank.y);
    } else await f.canvas.press('Escape');
    await expect.poll(pending).toBe(1);
    expect(await f.read()).toEqual(placed);
    await page.evaluate(() => (window as unknown as { releasePaintMove: () => void }).releasePaintMove());
    await expect.poll(async()=>at(await f.read(),365,120)).toEqual(['#ff0000']);
    const moved=await f.read();
    expect(at(moved,325,120)).toEqual(['#ff0000','#0000ff']);
    expect(at(moved,365,142).at(-1)).toBe('#0000ff');
    expect(at(moved,350,140)).toEqual(['#ff0000']);
    expect(moved.layers[0].keys[0].shapes.some(shape => shape.fill === '#ff0000' &&
      contains(vectorPolygons(shape), { x: 350, y: 140 }) &&
      contains(vectorPolygons(shape), { x: 365, y: 120 }))).toBe(true);
    await f.canvas.focus();await page.keyboard.press('Control+z');await expect.poll(f.read).toEqual(dropped);
    await page.keyboard.press('Control+z');await expect.poll(f.read).toEqual(p);
  });
}
