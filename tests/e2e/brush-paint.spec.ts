import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { createRequire } from 'node:module';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { newLayer, newProject, validateProject, type Project, type SymbolDefinition, type Vector } from '../../packages/document/src';
import { containsPoint, worldPaths } from '../../packages/geometry/src/drawing';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { segmentDistance } from '../../packages/geometry/src';

async function dismissBrushStartup(page: Page) {
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const brush = page.getByRole('button', { name: 'Brush', exact: true });
  await expect(launch.or(brush).first()).toBeVisible();
  if (await launch.isVisible()) await launch.click();
}

test('a one-pixel optimized Brush stroke over existing paint saves and undoes cleanly', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(source => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project: source, folder: null, manifest: null }));
  }, project);
  await page.goto('/');
  const launch = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(launch.or(recover).first()).toBeVisible();
  if (await launch.isVisible()) await launch.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('24');
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('50');
  await page.getByLabel('Brush optimize', { exact: true }).check();
  const fill = page.getByLabel('Drawing fill', { exact: true });
  await fill.fill('#0088ff');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width / 2 - 200, y: box.y + box.height / 2 - 150 };
  await page.mouse.move(origin.x + 80, origin.y + 100);
  await page.mouse.down();
  await page.mouse.move(origin.x + 180, origin.y + 100, { steps: 4 });
  await page.mouse.up();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes).toHaveLength(1);
  const before = await read();
  await fill.fill('#ee4477');
  await page.mouse.move(origin.x + 95, origin.y + 102);
  await page.mouse.down();
  await page.mouse.move(origin.x + 96, origin.y + 102);
  await page.mouse.up();
  await page.mouse.move(origin.x + 280, origin.y + 240);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.map(shape => shape.fill)).toEqual(['#0088ff', '#ee4477']);
  const after = await read();
  expect(() => validateProject(after)).not.toThrow();
  const paths = after.layers[0].keys[0].shapes.map(shape => worldPaths(shape, .02));
  expect(paths[0].reduce((inside, ring) => inside !== containsPoint(ring, { x: 95, y: 102 }), false)).toBe(false);
  const pixels = () => canvas.evaluate(node => {
    const c = node as HTMLCanvasElement, ctx = c.getContext('2d')!;
    return [[95, 102], [160, 100], [160, 116]].map(([x, y]) => [...ctx.getImageData(
      c.width / 2 + (x - 200) * devicePixelRatio, c.height / 2 + (y - 150) * devicePixelRatio, 1, 1,
    ).data]);
  });
  await expect.poll(pixels).toEqual([[238, 68, 119, 255], [0, 136, 255, 255], [255, 255, 255, 255]]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(after);
  await page.reload();
  await expect(launch.or(recover).first()).toBeVisible();
  if (await launch.isVisible()) await launch.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  expect(await read()).toEqual(after);
  await expect.poll(pixels).toEqual([[238, 68, 119, 255], [0, 136, 255, 255], [255, 255, 255, 255]]);
});

test('layered Brush patches match a full redraw and keep backing paint editable', async ({ page }) => {
  const source = newProject();
  source.layers[0].drawingMode = 'merge';
  const backing = newLayer('Backing artwork');
  backing.drawingMode = 'merge';
  backing.keys[0].shapes = [{
    id: 'backing-paint', kind: 'polygon', x: 450, y: 240, width: 80, height: 65,
    rotation: 0, fill: '#1166cc', stroke: '#000000', strokeWidth: 0, points: [],
    drawingMode: 'merge', fillRule: 'evenodd',
    contours: [[{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 65 }, { x: 0, y: 65 }]],
  }];
  const under = newLayer('Underlying artwork');
  under.keys[0].shapes = [{ ...structuredClone(backing.keys[0].shapes[0]),
    id: 'under-paint', x: 420, y: 225, fill: '#e4bc26', opacity: 0.65 }];
  source.layers.unshift(under);
  source.layers.push(backing);
  await page.addInitScript(() => {
    Object.assign(window, { layeredBrushPatches: 0 });
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      const stage = document.querySelector<HTMLCanvasElement>('#drawing-stage');
      if (stage && this.canvas !== stage && this.canvas.width === stage.width &&
        this.canvas.height === stage.height && this.getTransform().isIdentity &&
        this.fillStyle === '#ffffff' && x > 0 && y > 0 && width < stage.width / 2)
        (window as unknown as { layeredBrushPatches: number }).layeredBrushPatches++;
      fill.call(this, x, y, width, height);
    };
  });
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), source);
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('group', { name: 'Layer row Layer 1', exact: true }).locator('button.layer-name').click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const saved = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const patches = () => page.evaluate(() =>
    (window as unknown as { layeredBrushPatches: number }).layeredBrushPatches);
  const settled = () => page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const pixels = () => stage.evaluate(async (canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
  });
  const box = (await stage.boundingBox())!;
  const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
  async function stroke(x: number, y: number) {
    const before = await saved();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 110, y, { steps: 9 });
    await page.mouse.up();
    await expect.poll(saved).not.toEqual(before);
  }
  await stroke(centerX - 240, centerY - 70);
  const count = await patches();
  await stroke(centerX - 35, centerY);
  await page.mouse.move(10, 10);
  const edited = await saved();
  expect(edited.layers[1].keys[0].shapes).toHaveLength(2);
  expect(edited.layers[0]).toEqual(under);
  expect(edited.layers[2]).toEqual(backing);
  const centerPixel = () => stage.evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext('2d')!.getImageData(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
    ).data));
  await expect.poll(centerPixel).toEqual([17, 102, 204, 255]);
  await expect.poll(patches).toBe(count + 1);
  await settled();
  const incremental = await pixels();
  const grid = page.getByTitle('Toggle grid', { exact: true });
  await grid.click();
  await settled();
  expect(await pixels()).not.toEqual(incremental);
  await grid.click();
  await settled();
  expect(await pixels()).toEqual(incremental);

  await grid.click();
  await stroke(centerX - 120, centerY + 70);
  expect(await patches()).toBe(count + 1);
  await stage.press('Control+z');
  await expect.poll(saved).toEqual(edited);
  await grid.click();

  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.getByRole('group', { name: 'Layer row Backing artwork', exact: true })
    .locator('button.layer-name').click();
  await page.mouse.click(centerX, centerY);
  const opacity = page.getByLabel('Object opacity', { exact: true });
  await opacity.fill('50');
  await opacity.press('Tab');
  await expect.poll(async () => (await saved()).layers[2].keys[0].shapes[0].opacity).toBe(0.5);
  expect((await saved()).layers.slice(0, 2)).toEqual(edited.layers.slice(0, 2));
  await stage.press('Control+z');
  await expect.poll(saved).toEqual(edited);
});

test('a merged Brush stage patch matches every pixel of a full redraw', async ({ page }) => {
  await page.addInitScript(() => {
    const patches: number[][] = [];
    const references: number[][] = [];
    Object.assign(window, { brushPatches: patches, brushReferences: references });
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(input: string | URL, options?: WorkerOptions) {
        super(input, options);
        this.addEventListener('message', event => {
          const slots: unknown[] | undefined = event.data?.result?.shapes;
          if (Array.isArray(slots)) references.push(slots.filter(slot => typeof slot === 'number'));
        });
      }
    };
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      const stage = document.querySelector<HTMLCanvasElement>('#drawing-stage');
      if (stage && this.canvas !== stage && this.canvas.width === stage.width &&
        this.canvas.height === stage.height && this.getTransform().isIdentity &&
        this.fillStyle === '#ffffff' && x > 0 && y > 0 && width < stage.width / 2)
        patches.push([x, y, width, height]);
      fill.call(this, x, y, width, height);
    };
  });
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const grid = page.getByTitle('Toggle grid', { exact: true });
  const patches = () => page.evaluate(() =>
    (window as unknown as { brushPatches: number[][] }).brushPatches);
  const saved = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const settled = () => page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const pixels = () => stage.evaluate(async (canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest));
  });
  async function stroke(fraction: number, down: number, color: string) {
    await page.getByLabel('Drawing fill', { exact: true }).fill(color);
    const before = await saved();
    const box = (await stage.boundingBox())!;
    const x = box.x + box.width * fraction, y = box.y + box.height / 2 + down;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 24, { steps: 8 });
    await page.mouse.up();
    await expect.poll(saved).not.toBe(before);
    await page.mouse.move(10, 10);
    await settled();
  }
  await stroke(0.2, -90, '#ff0000');
  await stroke(0.55, 10, '#1166cc');
  const count = (await patches()).length;
  await stroke(0.55, 20, '#34ac5a');
  const edited = await saved();
  const references = await page.evaluate(() =>
    (window as unknown as { brushReferences: number[][] }).brushReferences);
  expect(references.at(-1)).toContain(0);
  await expect.poll(async () => (await patches()).length).toBe(count + 1);
  const incremental = await pixels();
  await grid.click();
  await settled();
  expect(await pixels()).not.toEqual(incremental);
  await grid.click();
  await settled();
  expect(await pixels()).toEqual(incremental);
  expect(await saved()).toBe(edited);

  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.2 + 50, box.y + box.height / 2 - 78);
  const fill = page.getByLabel('Selected fill', { exact: true });
  await expect(fill).toHaveValue('#ff0000');
  await fill.fill('#9933ff');
  await expect.poll(saved).not.toBe(edited);
  const recolored = await saved();
  const opacity = page.getByLabel('Object opacity', { exact: true });
  await opacity.fill('40');
  await opacity.press('Tab');
  await expect.poll(async () => (JSON.parse((await saved())!).project as Project)
    .layers[0].keys[0].shapes.find(shape => shape.fill === '#9933ff')?.opacity).toBe(0.4);
  await stage.press('Control+z');
  await expect.poll(saved).toBe(recolored);
  await stage.press('Control+z');
  await expect.poll(saved).toBe(edited);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await grid.click();
  await stroke(0.38, 40, '#fdb337');
  expect((await patches()).length).toBe(count + 1);
  await stage.press('Control+z');
  await expect.poll(saved).toBe(edited);
});

test('invalid unchanged Brush root references reject before history or publication', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(input: string | URL, options?: WorkerOptions) {
        super(input, options);
        this.addEventListener('message', event => {
          const slots: unknown[] | undefined = event.data?.result?.shapes;
          const at = Array.isArray(slots) ? slots.findIndex(slot => typeof slot === 'number') : -1;
          if (at >= 0) slots![at] = -1;
        });
      }
    };
  });
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const saved = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const box = (await stage.boundingBox())!;
  async function stroke(fraction: number) {
    const start = box.x + box.width * fraction, y = box.y + box.height * 0.5;
    await page.mouse.move(start, y);
    await page.mouse.down();
    await page.mouse.move(start + 80, y + 10, { steps: 7 });
    await page.mouse.up();
  }
  await stroke(0.22);
  await expect.poll(saved).not.toBeNull();
  const original = await saved();
  await stroke(0.65);
  await expect(page.getByRole('alert')).toContainText('Geometry worker returned invalid Brush references.');
  expect(await saved()).toBe(original);
  await stage.press('Control+z');
  await expect.poll(async () => JSON.parse((await saved())!).project.layers[0].keys[0].shapes).toEqual([]);
});

test('Brush selection paint keeps exact artwork and history when there is no eligible selection', async ({ page }) => {
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const recovery = () => page.evaluate(() => {
    const saved = localStorage.getItem('splash-recovery-v1');
    return saved ? JSON.parse(saved).project.layers[0].keys[0].shapes : [];
  });
  async function stroke() {
    const box = (await stage.boundingBox())!;
    const x = box.x + box.width * 0.45, y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 12, { steps: 8 });
    await page.mouse.up();
  }
  await stroke();
  await expect.poll(async () => (await recovery()).length).toBe(1);
  const original = await recovery();
  await page.getByLabel('Brush paint mode', { exact: true }).selectOption('selection');
  await stroke();
  await expect(page.getByText('No eligible fill for this brush stroke.', { exact: true })).toBeVisible();
  expect(await recovery()).toEqual(original);
  await stage.press('Control+z');
  await expect.poll(recovery).toEqual([]);
  await stage.press('Control+Shift+z');
  await expect.poll(recovery).toEqual(original);
});

test('a late scene change rejects a Brush result without recording its captured history', async ({ page }) => {
  await holdGeometry(page);
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const saved = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const box = (await stage.boundingBox())!;
  async function stroke(y: number) {
    await page.mouse.move(box.x + box.width * 0.4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, y + 12, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
  }
  const y = box.y + box.height * 0.45;
  await stroke(y);
  await releaseGeometry(page);
  await expect.poll(saved).not.toBeNull();
  const original = await saved();

  await stroke(y + 45);
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    JSON.stringify = function (...args: unknown[]) {
      const source = args[0] as Partial<Project> | undefined;
      if (source && Array.isArray(source.layers) && typeof source.duration === 'number') {
        source.name = 'Changed while awaiting Brush';
        JSON.stringify = stringify;
      }
      return Reflect.apply(stringify, JSON, args);
    };
  });
  await releaseGeometry(page);
  await expect(page.getByRole('alert')).toContainText('Drawing changed before queued geometry finished.');
  await expect(page.getByRole('button', { name: 'Switch to Changed while awaiting Brush' })).toBeVisible();
  expect(await saved()).toBe(original);
  await stage.press('Control+z');
  await expect.poll(async () => JSON.parse((await saved())!).project.layers[0].keys[0].shapes).toEqual([]);
});

for (const { editor, fail } of [
  { editor: 'main', fail: false },
  { editor: 'main', fail: true },
  { editor: 'symbol', fail: false },
] as const)
  test(`rapid Brush strokes stay visible and publish in order in ${editor} (first worker fails: ${fail})`, async ({ page }) => {
    await holdGeometry(page);
    if (editor === 'symbol') {
      const project = newProject();
      project.symbols = [{ id: 'rapid', name: 'Rapid', width: 800, height: 500, shapes: [{
        id: 'old', kind: 'rectangle', x: 1, y: 1, width: 2, height: 2, rotation: 0,
        fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [],
      }] }];
      await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null })), project);
    }
    await page.goto('/');
    await dismissBrushStartup(page);
    if (editor === 'symbol') {
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('option', { name: 'Library item Rapid', exact: true }).dblclick();
    }
    await page.getByRole('button', { name: 'Brush', exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
    await page.getByLabel('Brush size', { exact: true }).fill('16');
    const canvas = page.getByLabel('Drawing stage', { exact: true });
    await canvas.scrollIntoViewIfNeeded();
    const green = [0, 255, 0, 255];
    const white = [255, 255, 255, 255];
    const marks = [.31, .43, .55];
    const pixels = () => canvas.evaluate((node: HTMLCanvasElement, marks) => marks.map(y =>
      Array.from(node.getContext('2d')!.getImageData(Math.round(node.width * .45), Math.round(node.height * y), 1, 1).data)), marks);
    const start = async (y: number) => {
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width * .37, box.y + box.height * y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .55, box.y + box.height * y, { steps: 4 });
    };
    const saved = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const before = await saved();
    await start(marks[0]);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await start(marks[1]);
    await page.mouse.up();
    await start(marks[2]);
    await expect.poll(pixels).toEqual([green, green, green]);
    expect(await saved()).toBe(before);
    expect(await pendingGeometry(page)).toBe(1);
    // The first result arrives while the new stroke still owns the pointer.
    await releaseGeometry(page, fail);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    if (fail) await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
    const first = fail ? white : green;
    await expect.poll(pixels).toEqual([first, green, green]);
    await page.mouse.up();
    const cancelledMark = .67;
    const cancelledPixel = () => canvas.evaluate((node: HTMLCanvasElement, y) =>
      Array.from(node.getContext('2d')!.getImageData(Math.round(node.width * .45), Math.round(node.height * y), 1, 1).data), cancelledMark);
    await start(cancelledMark);
    await expect.poll(cancelledPixel).toEqual(green);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(cancelledPixel).toEqual(white);
    await expect.poll(pixels).toEqual([first, green, green]);
    await releaseGeometry(page);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    if (editor === 'symbol') {
      await expect(page.getByLabel('Timeline', { exact: true })).not.toHaveAttribute('inert', '');
      await expect.poll(pixels).toEqual([green, green, green]);
      const apply = page.getByRole('button', { name: 'Scene 1', exact: true });
      await expect(apply).toBeEnabled();
      await apply.click();
    } else {
      await expect.poll(async () => (JSON.parse((await saved())!).project as Project).layers[0].keys[0].shapes.length).toBe(fail ? 2 : 3);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(pixels).toEqual([first, green, white]);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(pixels).toEqual([first, green, green]);
    }
    const out = JSON.parse((await saved())!).project as Project;
    if (editor === 'main') expect(out.layers[0].keys[0].shapes).toHaveLength(fail ? 2 : 3);
    else expect(out.symbols![0].shapes.filter(s => s.fill === '#00ff00').flatMap(s => s.contours ?? [])).toHaveLength(3);
  });

for (const editor of ['main', 'symbol'] as const)
  test(`expanded rotating-nib Brush raster work is frame-bounded in ${editor}`, async ({ page }) => {
    await page.addInitScript(() => {
      const curve=Path2D.prototype.bezierCurveTo;
      Object.assign(window,{expandedNibCurves:0});
      Path2D.prototype.bezierCurveTo=function(...args){
        (window as unknown as {expandedNibCurves:number}).expandedNibCurves++;
        return curve.apply(this,args);
      };
    });
    if(editor==='symbol') {
      const project=newProject();
      project.symbols=[{id:'nib',name:'Nib',width:100,height:100,shapes:[{
        id:'base',kind:'rectangle',x:1,y:1,width:2,height:2,rotation:0,
        fill:'#000000',stroke:'#000000',strokeWidth:0,points:[],
      }]}];
      await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),project);
    }
    await page.goto('/');
    if(editor==='symbol') {
      await page.getByRole('button',{name:'Recover changes',exact:true}).click();
      await page.getByRole('option',{name:'Library item Nib',exact:true}).dblclick();
      const advanced = page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true });
      const tool = page.getByLabel('Symbol canvas tool', { exact: true });
      await expect(advanced.or(tool)).toBeVisible();
      if (await advanced.isVisible()) await advanced.click();
      await page.getByLabel('Symbol canvas tool').selectOption('brush');
      await page.getByLabel('Symbol brush tilt',{exact:true}).check();
    } else {
      await page.getByRole('button',{name:'Brush',exact:true}).click();
      await page.getByLabel('Tilt controls nib',{exact:true}).check();
    }
    const canvas=page.getByLabel(editor==='main'?'Drawing stage':'Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const box=(await canvas.boundingBox())!;
    const before=await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'));
    await canvas.evaluate(c=>c.addEventListener('pointerdown',e=>{(c as HTMLElement).dataset.nibPointer=String((e as PointerEvent).pointerId);},{once:true}));
    await page.mouse.move(box.x+box.width*.3,box.y+box.height*.5);
    await page.mouse.down();
    const result=await canvas.evaluate(async c=>{
      const state=window as unknown as {expandedNibCurves:number};
      state.expandedNibCurves=0;
      const b=c.getBoundingClientRect(),pointerId=Number((c as HTMLElement).dataset.nibPointer);
      c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId,pointerType:'mouse',buttons:1,
        clientX:b.x+b.width*.3+40000,clientY:b.y+b.height*.5}));
      await Promise.resolve();
      const work=[state.expandedNibCurves];
      for(let i=0;i<8;i++) {
        const previous=state.expandedNibCurves;
        await new Promise<void>(r=>requestAnimationFrame(()=>r()));
        work.push(state.expandedNibCurves-previous);
      }
      const captured=(c as HTMLCanvasElement).hasPointerCapture(pointerId);
      c.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId}));
      return {work,captured,pointerId};
    });
    expect(result.captured).toBe(true);
    expect(result.work[0]).toBe(0);
    expect(result.work.every(n=>n<=4096)).toBe(true);
    expect(result.work.reduce((a,b)=>a+b,0)).toBeGreaterThan(16000);
    expect(result.work.at(-1)).toBe(0);
    await expect.poll(()=>canvas.evaluate((c,id)=>(c as HTMLCanvasElement).hasPointerCapture(id),result.pointerId)).toBe(false);
    await page.mouse.up();
    expect(await page.evaluate(()=>localStorage.getItem('splash-recovery-v1'))).toBe(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const editor of ['main', 'symbol'] as const)
  test(`Brush input bursts composite once per display frame in ${editor}`, async ({ page }) => {
    await page.addInitScript(() => {
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      Object.assign(window, { burstPaints: 0 });
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (['Drawing stage', 'Symbol artwork preview'].includes(this.canvas.getAttribute('aria-label') ?? ''))
          (window as unknown as { burstPaints: number }).burstPaints++;
        return clear.apply(this, args);
      };
    });
    if (editor === 'symbol') {
      const project = newProject();
      project.symbols = [{ id: 'burst', name: 'Burst', width: 100, height: 100, shapes: [{
        id: 'old', kind: 'rectangle', x: 1, y: 1, width: 2, height: 2,
        rotation: 0, fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [],
      }] }];
      await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null })), project);
    }
    await page.goto('/');
    if (editor === 'symbol') {
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('group', { name: 'Symbol Burst', exact: true }).getByRole('button', { name: 'Edit symbol artwork', exact: true }).click();
      await page.getByLabel('Symbol canvas tool').selectOption('brush');
    } else await page.getByRole('button', { name: 'Brush', exact: true }).click();
    const canvas = page.getByLabel(editor === 'main' ? 'Drawing stage' : 'Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    await canvas.evaluate(c => c.addEventListener('pointerdown', e => { (c as HTMLElement).dataset.burstPointer = String((e as PointerEvent).pointerId); }, { once: true }));
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5);
    await page.mouse.down();
    const result = await canvas.evaluate(async c => {
      const state = window as unknown as { burstPaints: number };
      const b = c.getBoundingClientRect(), pointerId = Number((c as HTMLElement).dataset.burstPointer);
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const work: { immediate: number; displayed: number }[] = [];
      for (let burst = 0; burst < 20; burst++) {
        state.burstPaints = 0;
        for (let i = 0; i < 80; i++) {
          c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId, pointerType: 'mouse', buttons: 1,
            clientX: b.x + b.width * .3 + i, clientY: b.y + b.height * .5 + (i % 2 ? 5 : 0) }));
          // Deliberately allow separate reactive flushes, while keeping all
          // delivered input ahead of the next actual display frame.
          await Promise.resolve(); await Promise.resolve();
        }
        const immediate = state.burstPaints;
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        work.push({ immediate, displayed: state.burstPaints });
      }
      const captured = (c as HTMLCanvasElement).hasPointerCapture(pointerId);
      c.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }));
      return { work, captured, pointerId };
    });
    expect(result.captured).toBe(true);
    expect(result.work).toHaveLength(20);
    expect(result.work.every(n => n.immediate === 0 && n.displayed === 1)).toBe(true);
    await expect.poll(() => canvas.evaluate((c, id) => (c as HTMLCanvasElement).hasPointerCapture(id), result.pointerId)).toBe(false);
    await page.mouse.up();
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('live Brush raster work stays bounded as samples accumulate and finishing waits for the worker', async ({ page }) => {
  await holdGeometry(page);
  await page.addInitScript(() => {
    const original = Path2D.prototype.bezierCurveTo;
    const brushBlits: number[] = [];
    const brushColors = new WeakSet<HTMLCanvasElement>();
    Object.assign(window, { brushCurves: 0, brushRequest: null, brushRecolors: 0, brushPointProxies: 0, brushStagePaints: 0, brushRecolorAreas: [] as number[], brushBlits });
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...coordinates: number[]) {
      if (source instanceof HTMLCanvasElement && brushColors.has(source) &&
          this.canvas.getAttribute('aria-label') === 'Drawing stage') {
        const width = coordinates.length === 8 ? coordinates[2] : source.width;
        const height = coordinates.length === 8 ? coordinates[3] : source.height;
        brushBlits.push(width * height);
      }
      return Reflect.apply(draw, this, [source, ...coordinates]);
    };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.getAttribute('aria-label') === 'Drawing stage')
        (window as unknown as { brushStagePaints: number }).brushStagePaints++;
      return clear.apply(this, args);
    };
    const NativeProxy = Proxy;
    window.Proxy = new NativeProxy(NativeProxy, {
      construct(target, args) {
        const value = args[0];
        if (value && typeof value === 'object' &&
          typeof Object.getOwnPropertyDescriptor(value, 'x')?.value === 'number' &&
          typeof Object.getOwnPropertyDescriptor(value, 'y')?.value === 'number')
          (window as unknown as { brushPointProxies: number }).brushPointProxies++;
        return Reflect.construct(target, args);
      },
    });
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.globalCompositeOperation === 'source-in') {
        brushColors.add(this.canvas);
        (window as unknown as { brushRecolors: number }).brushRecolors++;
        (window as unknown as { brushRecolorAreas: number[] }).brushRecolorAreas.push(args[2] * args[3]);
      }
      return fill.apply(this, args);
    };
    Path2D.prototype.bezierCurveTo = function (...args) {
      (window as unknown as { brushCurves: number }).brushCurves++;
      return original.apply(this, args);
    };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown) {
      if ((message as { brushCommit?: unknown }).brushCommit)
        (window as unknown as { brushRequest: unknown }).brushRequest = message;
      post.call(this, message);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('100');
  await page.getByLabel('Brush optimize', { exact: true }).uncheck();
  await page.getByLabel('Brush size', { exact: true }).fill('12');
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  await canvas.evaluate((c) => c.addEventListener('pointerdown', (e) => {
    (c as HTMLElement).dataset.brushPointer = String((e as PointerEvent).pointerId);
  }, { once: true }));
  await page.mouse.move(box.x + 250, box.y + 250);
  await page.mouse.down();
  const initialRecolors = await canvas.evaluate(async () => {
    const state = window as unknown as { brushRecolorAreas: number[] };
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return state.brushRecolorAreas;
  });
  console.log('Brush first dab recolored pixels:', initialRecolors);
  expect(initialRecolors).toHaveLength(1);
  expect(initialRecolors[0]).toBeLessThan(1024);
  const firstPixel = await canvas.evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(
    Math.floor(250 * c.width / c.clientWidth), Math.floor(250 * c.height / c.clientHeight), 1, 1,
  ).data));
  expect(firstPixel).toEqual([109, 94, 252, 255]);
  const work: { curves: number; pointProxies: number; areas: number[]; stagePaints: number }[] = [];
  for (let burst = 0; burst < 120; burst++) {
    work.push(await canvas.evaluate(async (c, burst) => {
      const state = window as unknown as { brushCurves: number; brushPointProxies: number; brushRecolorAreas: number[]; brushStagePaints: number };
      state.brushCurves = 0;
      state.brushPointProxies = 0;
      state.brushRecolorAreas = [];
      state.brushStagePaints = 0;
      const box = c.getBoundingClientRect();
      const pointerId = Number((c as HTMLElement).dataset.brushPointer);
      const sample = (i: number) => new PointerEvent('pointermove', {
        bubbles: true, pointerId, pointerType: 'mouse', buttons: 1,
        // Keep the entire long stroke inside the viewport, including later bursts.
        clientX: box.x + 250 + Math.min(i % 2000, 2000 - i % 2000) / 5,
        clientY: box.y + 250 + (i % 2 ? 4 : 0),
      });
      const samples = Array.from({ length: 100 }, (_, j) => sample(burst * 100 + j + 1));
      const event = sample((burst + 1) * 100);
      Object.defineProperty(event, 'getCoalescedEvents', { value: () => samples });
      c.dispatchEvent(event);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { curves: state.brushCurves, pointProxies: state.brushPointProxies, areas: state.brushRecolorAreas, stagePaints: state.brushStagePaints };
    }, burst));
  }
  // Each burst adds 100 two-point sweeps, rather than rebuilding 100..12000 samples.
  expect(work.every((n) => n.curves >= 800 && n.curves <= 820)).toBe(true);
  // Caught-up input paints once; the budget-reset frame must not clear and
  // composite the whole editor a second time after every delivered burst.
  expect(work.every((n) => n.stagePaints === 1)).toBe(true);
  // Hover may proxy its one current point; the 100 captured samples per burst
  // must not create 100 additional deep reactive objects/signals.
  expect(work.every((n) => n.pointProxies <= 2)).toBe(true);
  // Actual editor updates remain local through all 120 bursts, including
  // returns across the old line. Whole-stage recoloring would exceed this.
  expect(work.slice(1).every((n) => n.areas.length > 0 && n.areas.every((area) => area < 20000))).toBe(true);
  console.log('Brush maximum recolored pixels per incremental update:', Math.max(...work.slice(1).flatMap((n) => n.areas)));
  const blits = await page.evaluate(() => (window as unknown as { brushBlits: number[] }).brushBlits);
  console.log('Brush maximum pixels submitted per active blit:', Math.max(...blits));
  expect(blits.length).toBeGreaterThanOrEqual(120);
  expect(blits.length).toBeLessThanOrEqual(121);
  expect(Math.max(...blits)).toBeLessThan(30000);
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const previewPixels = () => canvas.evaluate((c) => Array.from(
    (c as HTMLCanvasElement).getContext('2d')!.getImageData(340, 240, 80, 22).data));
  const activePixels = await previewPixels();
  expect(activePixels.some((red, index) =>
    index % 4 === 0 && red === 109 && activePixels[index + 1] === 94 && activePixels[index + 2] === 252,
  )).toBe(true);
  await canvas.evaluate((c) => {
    const box = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: Number((c as HTMLElement).dataset.brushPointer),
      pointerType: 'mouse', clientX: box.x + 250, clientY: box.y + 250,
    }));
  });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  const request = await page.evaluate(() => (window as unknown as { brushRequest: { brushCommit: { brush: { points: unknown[]; width: number }; amount: number } } }).brushRequest);
  expect(request.brushCommit.brush.points).toHaveLength(12001);
  expect(request.brushCommit.brush.width).toBe(0);
  expect(request.brushCommit.amount).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  // Keep the hover nib outside the comparison region before either snapshot.
  await page.mouse.move(box.x + 650, box.y + 350);
  const heldPixels = await previewPixels();
  expect(heldPixels).toEqual(activePixels);
  const recolors = await page.evaluate(() => (window as unknown as { brushRecolors: number }).brushRecolors);
  // Dispatch the real control without four actionability waits while a worker
  // is deliberately held; its production timeout must remain unchanged.
  await page.getByTitle('Toggle grid', { exact: true }).evaluate(async (button) => {
    for (let i = 0; i < 4; i++) {
      (button as HTMLButtonElement).click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  });
  expect(await previewPixels()).toEqual(heldPixels);
  expect(await page.evaluate(() => (window as unknown as { brushRecolors: number }).brushRecolors)).toBe(recolors);
  await releaseGeometry(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).not.toBe(before);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  expect(saved.layers.flatMap(l => l.keys[0].shapes).find(s => s.kind === 'brush')!.points).toHaveLength(12001);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers.flatMap(l => l.keys[0].shapes).length)).toBe(0);
  // Undo removes the auto-created object drawing layer. A fresh Brush job
  // must resolve the current layer again before creating a replacement.
  await page.mouse.move(box.x + 270, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 310, box.y + 260);
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers.flatMap(l => l.keys[0].shapes).length)).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a sparse diagonal Brush stroke skips transparent blits without changing preview pixels', async ({ page }) => {
  await holdGeometry(page);
  await page.addInitScript(() => {
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    const restore = CanvasRenderingContext2D.prototype.restore;
    const colors = new WeakMap<HTMLCanvasElement, { x: number; y: number; compact: boolean }>();
    let captured: HTMLCanvasElement | undefined;
    const state = window as unknown as { brushProbe: { areas: number[]; compactionAreas: number[]; phase?: 'active' | 'released'; expected?: HTMLCanvasElement; actual?: ImageData; active?: ImageData } };
    state.brushProbe = { areas: [], compactionAreas: [] };
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.globalCompositeOperation === 'source-in') colors.set(this.canvas, { x: 0, y: 0, compact: false });
      return fill.call(this, x, y, w, h);
    };
    CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...coords: number[]) {
      const raster = source instanceof HTMLCanvasElement ? colors.get(source) : undefined;
      const probe = state.brushProbe;
      if (raster && source instanceof HTMLCanvasElement) {
        if (this.canvas.getAttribute('aria-label') !== 'Drawing stage') {
          if (probe.phase === 'released' && !raster.compact && coords.length === 8) {
            colors.set(this.canvas, { x: coords[0] - coords[4], y: coords[1] - coords[5], compact: true });
            probe.compactionAreas.push(coords[2] * coords[3]);
          }
        } else if (probe.phase === (raster.compact ? 'released' : 'active')) {
          if (!probe.areas.length) {
            const expected = document.createElement('canvas');
            expected.width = this.canvas.width;
            expected.height = this.canvas.height;
            const ctx = expected.getContext('2d')!;
            draw.call(ctx, this.canvas, 0, 0, expected.width, expected.height, 0, 0, expected.width, expected.height);
            ctx.globalAlpha = this.globalAlpha;
            draw.call(ctx, source, 0, 0, source.width, source.height, raster.x, raster.y, source.width, source.height);
            probe.expected = expected;
            captured = this.canvas;
          }
          probe.areas.push(coords.length === 8 ? coords[2] * coords[3] : source.width * source.height);
        }
      }
      return Reflect.apply(draw, this, [source, ...coords]);
    };
    CanvasRenderingContext2D.prototype.restore = function () {
      restore.call(this);
      if (this.canvas === captured) {
        state.brushProbe.actual = this.getImageData(0, 0, this.canvas.width, this.canvas.height);
        state.brushProbe.phase = undefined;
        captured = undefined;
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush size', { exact: true }).fill('12');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  const point = (fraction: number) => ({
    x: box.x + box.width * fraction,
    y: box.y + box.height * fraction,
  });
  const start = point(.2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 29; i++) {
    const next = point(.2 + i * .02);
    await page.mouse.move(next.x, next.y);
    await stage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  await page.evaluate(() => {
    const state = window as unknown as { brushProbe: { areas: number[]; phase: string } };
    state.brushProbe.areas = [];
    state.brushProbe.phase = 'active';
  });
  const end = point(.8);
  await page.mouse.move(end.x, end.y);
  const readComposite = () => stage.evaluate(async (canvas: HTMLCanvasElement) => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { areas, compactionAreas, expected, actual, active } = (window as unknown as {
      brushProbe: { areas: number[]; compactionAreas: number[]; expected: HTMLCanvasElement; actual: ImageData; active?: ImageData };
    }).brushProbe;
    const pixels = actual.data;
    const oracle = expected.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const differences = pixels.reduce((count, value, index) => count + Number(value !== oracle[index]), 0);
    const ink = pixels.reduce((count, value, index) => count + Number(index % 4 === 0 &&
      value === 109 && pixels[index + 1] === 94 && pixels[index + 2] === 252), 0);
    const handoffDifferences = active && pixels.reduce((count, value, index) => count + Number(value !== active.data[index]), 0);
    return { areas, compactionAreas, differences, ink, handoffDifferences };
  });
  const result = await readComposite();
  console.log('Sparse diagonal Brush composite:', result);
  expect(result.differences).toBe(0);
  expect(result.ink).toBeGreaterThan(1000);
  expect(result.areas.length).toBeGreaterThan(1);
  expect(result.areas.reduce((sum, area) => sum + area, 0)).toBeLessThan(box.width * box.height * .25);
  await page.evaluate(() => {
    const { brushProbe } = window as unknown as {
      brushProbe: { phase: string; areas: number[]; actual: ImageData; active: ImageData };
    };
    brushProbe.phase = 'released';
    brushProbe.areas = [];
    brushProbe.active = brushProbe.actual;
  });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  const released = await readComposite();
  console.log('Released sparse Brush composite:', released);
  expect(released.differences).toBe(0);
  expect(released.handoffDifferences).toBe(0);
  expect(released.compactionAreas).toEqual(released.areas);
  expect(released.areas.length).toBeGreaterThan(1);
  expect(released.areas.reduce((sum, area) => sum + area, 0)).toBeLessThan(box.width * box.height * .25);
  await releaseGeometry(page);
  const shapes = () => page.evaluate(() => {
    const saved = localStorage.getItem('splash-recovery-v1');
    return saved ? (JSON.parse(saved).project as Project).layers.flatMap(layer => layer.keys[0].shapes) : [];
  });
  await expect.poll(async () => (await shapes()).map(shape => shape.kind)).toEqual(['brush']);
  await stage.press('Control+z');
  await expect.poll(shapes).toEqual([]);
});

test('smoothing an overlapping new Brush stroke preserves the older unsmoothed line pixels', async ({ page }) => {
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#cc2200');
  await page.getByLabel('Brush size', { exact: true }).fill('24');
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.move(box.x + 240, box.y + 250);
  await page.mouse.down();
  for (let i = 1; i <= 50; i++) await page.mouse.move(box.x + 240 + i * 4, box.y + 250 + Math.round(Math.sin(i / 3) * 22));
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).not.toBeNull();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(1);
  await page.mouse.move(box.x + 650, box.y + 350);
  const pixels = () => canvas.evaluate((c) => Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(220, 210, 150, 80).data));
  const oldPixels = await pixels(), old = await read();
  expect(oldPixels.filter((v, i) => i % 4 === 1 && v < 100).length).toBeGreaterThan(1000);
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('200');
  await page.mouse.move(box.x + 420, box.y + 250);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(box.x + 420 + i * 4, box.y + 250 + Math.sin(i / 3) * 22);
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(old));
  await page.mouse.move(box.x + 650, box.y + 350);
  const result = (await read()).layers[0].keys[0].shapes;
  const left = Math.min(...old.layers[0].keys[0].shapes.flatMap((s) => worldPaths(s).flat()).map((p) => p.x));
  const remote = (shapes: typeof result) => [...new Set(shapes.flatMap((s) => worldPaths(s).flat())
    .filter((p) => p.x < left + 120).map((p) => [p.x.toFixed(8), p.y.toFixed(8)].join(',')))].sort();
  expect(remote(result)).toEqual(remote(old.layers[0].keys[0].shapes));
  // Boolean union can change edge antialiasing when a contour is retessellated.
  // Compare exact paint/background cores as well as the original outline coordinates.
  const afterPixels = await pixels();
  let checked = 0;
  for (let y = 1; y < 79; y++) for (let x = 1; x < 149; x++) {
    const offset = (y * 150 + x) * 4;
    const color = oldPixels.slice(offset, offset + 4);
    if ([-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) =>
      oldPixels.slice(((y + dy) * 150 + x + dx) * 4, ((y + dy) * 150 + x + dx) * 4 + 4).every((v, i) => v === color[i])))) {
      expect(afterPixels.slice(offset, offset + 4)).toEqual(color);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(9000);
  expect(result).toHaveLength(1);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(old);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const drawing of ['object', 'merge'])
  test(`brush paint modes respect existing paint and undo in ${drawing} layers`, async ({
    page,
  }) => {
    await page.goto('/');
    const canvas = page.getByLabel('Drawing stage'),
      b = (await canvas.boundingBox())!;
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    await page.getByLabel('Drawing mode').selectOption(drawing);
    await page.getByLabel('Drawing stroke width').fill('0');
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    for (const [x, color] of [
      [300, '#ff0000'],
      [460, '#0000ff'],
    ] as const) {
      await page.getByLabel('Drawing fill', { exact: true }).fill(color);
      const previous = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
      await page.mouse.move(b.x + x, b.y + 180);
      await page.mouse.down();
      await page.mouse.move(b.x + x + 100, b.y + 300);
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
        .not.toBe(previous);
    }
    const before = await read();
    const pixel = (x: number) =>
      canvas.evaluate(
        (c, x) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, 240, 1, 1).data),
        x,
      );
    for (const mode of ['fills', 'selection', 'inside', 'inside-empty', 'behind']) {
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await page.mouse.click(b.x + 330, b.y + 220);
      await page.getByRole('button', { name: 'Brush', exact: true }).click();
      await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
      await page.getByLabel('Brush size', { exact: true }).fill('40');
      await page
        .getByLabel('Brush paint mode')
        .selectOption(mode === 'inside-empty' ? 'inside' : mode);
      await page.mouse.move(b.x + (mode === 'inside' ? 330 : 270), b.y + 240);
      await page.mouse.down();
      await page.mouse.move(b.x + 590, b.y + 240, { steps: 10 });
      await page.mouse.up();
      await page.mouse.move(b.x + 20, b.y + 20);
      await expect
        .poll(async () => JSON.stringify(await read()) !== JSON.stringify(before))
        .toBe(true);
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await page.mouse.click(b.x + 100, b.y + 450);
      await expect
        .poll(() => pixel(350))
        .toEqual(['behind', 'inside-empty'].includes(mode) ? [255, 0, 0, 255] : [0, 255, 0, 255]);
      await expect
        .poll(() => pixel(510))
        .toEqual(mode === 'fills' ? [0, 255, 0, 255] : [0, 0, 255, 255]);
      await expect
        .poll(() => pixel(430))
        .toEqual(
          ['behind', 'fills', 'inside-empty'].includes(mode)
            ? [0, 255, 0, 255]
            : [255, 255, 255, 255],
        );
      await canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('Shift brush strokes constrain the stroke and stabilized endpoint to one axis', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Separate brush objects', { exact: true }).check();
  await page.getByLabel('Brush stabilizer distance', { exact: true }).fill('12');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(b.x + 250, b.y + 180);
  await page.mouse.down();
  await page.mouse.move(b.x + 400, b.y + 220, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).not.toBeNull();
  const artwork = async () => (await read()).layers.flatMap(l => l.keys[0].shapes);
  await expect.poll(async () => (await artwork()).length).toBe(1);
  const stroke = (await artwork())[0];
  expect(stroke.kind).toBe('brush');
  expect(new Set(stroke.points.map((p) => p.y)).size).toBe(1);
  expect(stroke.points.at(-1)!.x - stroke.points[0].x).toBeGreaterThan(50);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await artwork()).toEqual([]);
});

test('default brush joins overlapping filled outlines without auto-selecting stroke objects', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const times: number[] = [];
  for (let i = 0; i < 8; i++) {
    const start = Date.now();
    await page.mouse.move(b.x + 260, b.y + 190 + i * 3);
    await page.mouse.down();
    await page.mouse.move(b.x + 390, b.y + 190 + i * 3, { steps: 16 });
    await page.mouse.up();
    await expect(page.getByLabel('Timeline', { exact: true })).not.toHaveAttribute('inert', '');
    await expect
      .poll(async () => (await read()).layers[0].keys[0].shapes.every((s) => s.kind === 'polygon'))
      .toBe(true);
    times.push(Date.now() - start);
  }
  const p = await read(),
    shapes = p.layers[0].keys[0].shapes;
  expect(p.layers[0].drawingMode).toBe('merge');
  expect(shapes).toHaveLength(1);
  expect(shapes[0].contours![0].length).toBeGreaterThan(4);
  expect(shapes[0].brush).toBeUndefined();
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(b.x + 310, b.y + 200);

  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ANCHORS', exact: true })).toBeVisible();
  console.log('Eight overlapping brush gestures including Playwright input/commit ms:', times);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect((await read()).layers[0].keys[0].shapes[0].contours).not.toEqual(shapes[0].contours);
});

test('dense long brush strokes commit, overlap and undo without sweep-line errors', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage');
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project ?? null) as Project | null);
  let first: Project | undefined;
  for (let stroke = 0; stroke < 2; stroke++) {
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + 260, b.y + 240 + stroke * 5);
    await page.mouse.down();
    await canvas.evaluate((element, stroke) => {
      const b = element.getBoundingClientRect();
      const send = (type: string, i: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pressure: type === 'pointerup' ? 0 : 0.7,
            clientX: b.x + 260 + i * 0.35,
            clientY: b.y + 240 + Math.sin(i / 65) * 45 + stroke * 5,
          }),
        );
      for (let i = 1; i <= 1200; i++) send('pointermove', i);
    }, stroke);
    await page.mouse.move(b.x + 680, b.y + 240 + Math.sin(1200 / 65) * 45 + stroke * 5);
    await page.mouse.up();
    await expect(page.locator('main.editor:not([inert]) #drawing-tools-panel:not([inert])')).toBeAttached();
    await expect(page.getByText(/Error:.*(SweepLine|segment|contour)/)).toHaveCount(0);
    await expect.poll(async () => {
      const shapes = (await read())?.layers[0].keys[0].shapes;
      return shapes?.length === 1 && JSON.stringify(shapes) !== JSON.stringify(first?.layers[0].keys[0].shapes);
    }).toBe(true);
    if (!stroke) first = (await read())!;
  }
  const result = (await read())!.layers[0].keys[0].shapes[0];
  expect(result.kind).toBe('polygon');
  expect(result.contours![0].length).toBeGreaterThan(4);
  expect(result.contours).not.toEqual(first!.layers[0].keys[0].shapes[0].contours);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await read())?.layers[0].keys[0].shapes).toEqual(first!.layers[0].keys[0].shapes);
});

test('default Brush simplifies a long stroke released at low zoom', async ({ page }) => {
  await page.setViewportSize({width:1800,height:1000});
  const project = newProject();
  project.width = 4400;
  project.height = 2000;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({project,folder:null,manifest:null}),
  ), project);
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.25');
  await expect(page.getByLabel('Brush optimize',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Brush simplify amount',{exact:true})).toHaveValue('50');
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x + box.width / 2 - 510), y = Math.round(box.y + box.height / 2);
  await canvas.evaluate(c=>c.addEventListener('pointerdown', e=>{
    (c as HTMLCanvasElement).dataset.brushPointer=String((e as PointerEvent).pointerId);
  },{once:true}));
  await page.mouse.move(x,y);
  await page.mouse.down();
  await canvas.evaluate((c, {x,y})=>{
    const pointerId=Number((c as HTMLCanvasElement).dataset.brushPointer);
    for (let i=1;i<4500;i++) c.dispatchEvent(new PointerEvent('pointermove',{
      bubbles:true,pointerId,pointerType:'mouse',isPrimary:true,buttons:1,button:-1,pressure:.5,
      clientX:x+Math.round(i*.9)/4,clientY:y+Math.round(40*Math.sin(i/60))/4,
    }));
  },{x,y});
  await page.mouse.move(x+1012,y+Math.round(10*Math.sin(4499/60)));
  await page.mouse.up();
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  await expect.poll(async ()=>(await read()).length, {timeout:15000}).toBe(1);
  const [stroke] = await read();
  expect(stroke.width).toBeGreaterThan(3950);
  expect(stroke.contours).toHaveLength(1);
  expect(stroke.contours![0].length).toBeLessThan(170);
  expect(stroke.contours![0].some(n=>n.in || n.out)).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([]);
});

test('default Brush commits the smaller tracing for a long looping stroke', async ({ page }) => {
  await holdGeometry(page);
  await page.addInitScript(() => {
    const WorkerWithDeliveryHold = window.Worker;
    const geometryTimes: {phases:{phase:string;elapsedMs:number}[]}[] = [];
    Object.assign(window,{geometryTimes});
    window.Worker = class extends WorkerWithDeliveryHold {
      constructor(url:string|URL,options?:WorkerOptions) {
        super(url,options);
        this.addEventListener('message', event=>{
          if (event.data?.brushTiming) geometryTimes.push(event.data.brushTiming);
        });
      }
      postMessage(message:unknown,transfer:Transferable[]|StructuredSerializeOptions=[]) {
        const packet = message as {brushCommit?:unknown};
        const request = packet?.brushCommit ? {...packet,measureBrush:true} : message;
        if (Array.isArray(transfer)) super.postMessage(request,transfer);
        else super.postMessage(request,transfer);
      }
    };
  });
  await page.setViewportSize({width:1800,height:1000});
  const project = newProject();
  project.width = 4400;
  project.height = 2000;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({project,folder:null,manifest:null}),
  ), project);
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.25');
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x+box.width/2-450), y = Math.round(box.y+box.height/2);
  await canvas.evaluate(c=>c.addEventListener('pointerdown', e=>{
    (c as HTMLCanvasElement).dataset.brushPointer=String((e as PointerEvent).pointerId);
  },{once:true}));
  await page.mouse.move(x,y);
  await page.mouse.down();
  await canvas.evaluate((c,{x,y})=>{
    const pointerId=Number((c as HTMLCanvasElement).dataset.brushPointer);
    for (let i=1;i<3500;i++) {
      const type=i===3499 ? 'pointerup' : 'pointermove';
      c.dispatchEvent(new PointerEvent(type,{
        bubbles:true,pointerId,pointerType:'mouse',isPrimary:true,
        buttons:type==='pointerup'?0:1,button:type==='pointerup'?0:-1,pressure:.5,
        clientX:x+(i*.9+40*Math.sin(i/17))/4,
        clientY:y+(40*Math.sin(i/60)+40*Math.cos(i/17)-40)/4,
      }));
    }
  },{x,y});
  await page.mouse.up();
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  expect(await read()).toEqual([]);
  await page.mouse.move(x+40,y+38);
  await page.mouse.down();
  await page.mouse.move(x+90,y+38,{steps:6});
  await page.mouse.up();
  await page.mouse.move(x+100,y+55);
  // The follower stroke is visible while the dense stroke still owns the
  // worker slot. Neither preview can publish artwork out of order.
  const followerPixel = () => canvas.evaluate((node,{x,y})=>{
    const c=node as HTMLCanvasElement, box=c.getBoundingClientRect();
    return [...c.getContext('2d')!.getImageData(
      (x+65-box.x)*c.width/box.width,(y+38-box.y)*c.height/box.height,1,1,
    ).data];
  },{x,y});
  await expect.poll(followerPixel).toEqual([109,94,252,255]);
  expect(await read()).toEqual([]);
  await releaseGeometry(page);
  await expect.poll(async ()=>(await read()).length,{timeout:15000}).toBe(1);
  const [stroke] = await read();
  expect(stroke.width).toBeGreaterThan(3100);
  expect(stroke.contours).toHaveLength(34);
  expect(stroke.contours!.flat().length).toBeLessThan(650);
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(async ()=>(await read()).length).toBe(2);
  expect((await read())[0]).toEqual(stroke);
  const times = await page.evaluate(()=>
    (window as unknown as {geometryTimes:{phases:{phase:string;elapsedMs:number}[]}[]}).geometryTimes
      .map(entry=>entry.phases.find(p=>p.phase==='footprint')?.elapsedMs));
  expect(times).toHaveLength(2);
  expect(times.every(time=>typeof time==='number' && Number.isFinite(time))).toBe(true);
  console.log('Queued Brush footprint phases (ms)', times.map(time=>Math.round(time!)));
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([stroke]);
  await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await page.mouse.move(x,y-38);
  await page.mouse.down();
  await page.mouse.move(x,y+18,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(async ()=>(await read()).filter(shape=>shape.strokeWidth===0).length).toBeGreaterThan(1);
  const ink = (await read()).filter(shape=>shape.strokeWidth>0);
  expect(ink.length).toBeGreaterThan(1);
  expect(ink.every(shape=>shape.fillEnabled===false && (shape.kind==='path' || shape.kind==='bezier'))).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([stroke]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([]);
});

for (const {name,amplitude,contours,maxAnchors,cut} of [
  {name:'keeps sparse looping input compact',amplitude:40.25,contours:34,maxAnchors:660,cut:false},
  {name:'preserves a source hole missing from the fitted trace',amplitude:40,contours:35,maxAnchors:1300,cut:true},
  {name:'recovers a dense contact and keeps it editable',amplitude:39.75,contours:34,maxAnchors:850,cut:true},
]) test(`default Brush ${name}`,
  async ({ page }) => {
  await page.setViewportSize({width:1800,height:1000});
  const project = newProject();
  project.width = 4400;
  project.height = 2000;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({project,folder:null,manifest:null}),
  ), project);
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.25');
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x+box.width/2-450), y = Math.round(box.y+box.height/2);
  await canvas.evaluate(c=>c.addEventListener('pointerdown', e=>{
    (c as HTMLCanvasElement).dataset.brushPointer=String((e as PointerEvent).pointerId);
  },{once:true}));
  await page.mouse.move(x,y);
  await page.mouse.down();
  await canvas.evaluate((c,{x,y,amplitude})=>{
    const pointerId=Number((c as HTMLCanvasElement).dataset.brushPointer);
    for (let sample=1;sample<=1750;sample++) {
      const i=Math.min(sample*2,3499), released=i===3499;
      c.dispatchEvent(new PointerEvent(released?'pointerup':'pointermove',{
        bubbles:true,pointerId,pointerType:'mouse',isPrimary:true,
        buttons:released?0:1,button:released?0:-1,pressure:.5,
        clientX:x+(i*.9+amplitude*Math.sin(i/17))/4,
        clientY:y+(40*Math.sin(i/60)+amplitude*Math.cos(i/17)-amplitude)/4,
      }));
    }
  },{x,y,amplitude});
  await page.mouse.up();
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  await expect.poll(async ()=>(await read()).length,{timeout:15000}).toBe(1);
  const [stroke] = await read();
  expect(stroke.width).toBeGreaterThan(3100);
  expect(stroke.contours).toHaveLength(contours);
  expect(stroke.contours!.flat().length).toBeLessThan(maxAnchors);
  expect(stroke.contours![0].some(node=>node.in || node.out)).toBe(true);
  const pixel = (dx:number,dy:number) => canvas.evaluate((node,{x,y})=>{
    const c=node as HTMLCanvasElement, box=c.getBoundingClientRect();
    return [...c.getContext('2d')!.getImageData(
      (x-box.x)*c.width/box.width,(y-box.y)*c.height/box.height,1,1,
    ).data];
  },{x:x+dx,y:y+dy});
  await expect.poll(()=>pixel(0,0)).toEqual([109,94,252,255]);
  const rings = worldPaths(stroke,.05);
  const holes = rings.slice(1).map(ring => {
    const middle = ring.reduce((sum,p)=>({x:sum.x+p.x/ring.length,y:sum.y+p.y/ring.length}),{x:0,y:0});
    const clear = ring.slice(1).every((p,i)=>segmentDistance(middle,ring[i],p)>6);
    return clear && containsPoint(ring,middle) ? middle : undefined;
  }).filter(p=>p!==undefined);
  expect(holes.length).toBeGreaterThan(0);
  const [hole] = holes;
  await expect.poll(()=>pixel(
    box.x+box.width/2+(hole.x-project.width/2)/4-x,
    box.y+box.height/2+(hole.y-project.height/2)/4-y,
  )).toEqual([255,255,255,255]);
  if (cut) {
    await page.getByRole('button',{name:'Pencil',exact:true}).click();
    await page.mouse.move(x,y-38);
    await page.mouse.down();
    await page.mouse.move(x,y+18,{steps:8});
    await page.mouse.up();
    await expect.poll(async ()=>(await read()).filter(s=>!s.strokeWidth).length).toBeGreaterThan(1);
    const ink=(await read()).filter(s=>s.strokeWidth>0);
    expect(ink.length).toBeGreaterThan(1);
    expect(ink.every(s=>s.fillEnabled===false && (s.kind==='path' || s.kind==='bezier'))).toBe(true);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual([stroke]);
  }
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([]);
  await expect.poll(()=>pixel(0,0)).toEqual([255,255,255,255]);
});

for (const lead of [false,true]) test(
  `a tight round Brush retrace keeps its pinhole through release and Undo (${lead?'long approach':'compact'})`,
  async ({ page }) => {
  await page.setViewportSize({width:1800,height:1000});
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('20');
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  const x = Math.round(box.x+box.width/2), y = Math.round(box.y+box.height/2);
  const radius = (lead?12.12:12.3)*20;
  await canvas.evaluate(c=>c.addEventListener('pointerdown', e=>{
    (c as HTMLCanvasElement).dataset.brushPointer=String((e as PointerEvent).pointerId);
  },{once:true}));
  await page.mouse.move(lead?x-600:x+radius,lead?y-radius:y);
  await page.mouse.down();
  await canvas.evaluate((c,{x,y,radius,lead})=>{
    const pointerId=Number((c as HTMLCanvasElement).dataset.brushPointer);
    const turn = Array.from({length:69},(_,i)=>{
      const angle=i*Math.PI/30-(lead?Math.PI/2:0);
      return {x:x+radius*Math.cos(angle),y:y+radius*Math.sin(angle)};
    });
    const samples = lead ? [
      ...Array.from({length:30},(_,i)=>({x:x-600+i*20,y:y-radius})),...turn,
    ] : turn;
    for (let i=1;i<samples.length;i++) {
      const released=i===samples.length-1;
      c.dispatchEvent(new PointerEvent(released?'pointerup':'pointermove',{
        bubbles:true,pointerId,pointerType:'mouse',isPrimary:true,
        buttons:released?0:1,button:released?0:-1,pressure:.5,
        clientX:samples[i].x,clientY:samples[i].y,
      }));
    }
  },{x,y,radius,lead});
  await page.mouse.up();
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as Project | undefined)?.layers[0].keys[0].shapes);
  await expect.poll(async ()=>(await read())?.length).toBe(1);
  const [stroke] = (await read())!;
  expect(stroke.contours).toHaveLength(2);
  expect(stroke.contours![0].some(node=>node.in || node.out)).toBe(true);
  const rings = worldPaths(stroke,.005);
  expect(rings.reduce((inside,ring)=>inside !== containsPoint(ring,{x:480,y:270}),false)).toBe(false);
  const pixel = (dx:number,dy:number) => canvas.evaluate((node,{x,y})=>{
    const c=node as HTMLCanvasElement, box=c.getBoundingClientRect();
    return [...c.getContext('2d')!.getImageData(
      (x-box.x)*c.width/box.width,(y-box.y)*c.height/box.height,1,1,
    ).data];
  },{x:x+dx,y:y+dy});
  await expect.poll(()=>pixel(0,0)).toEqual([255,255,255,255]);
  await expect.poll(()=>pixel(0,radius)).toEqual([109,94,252,255]);
  if (lead) await expect.poll(()=>pixel(-520,-radius)).toEqual([109,94,252,255]);
  await page.mouse.click(x,y);
  await page.mouse.move(x+25,y+25);
  await expect.poll(async ()=>(await read())?.map(shape=>shape.contours?.length)).toEqual([1]);
  await expect.poll(()=>pixel(0,0)).toEqual([109,94,252,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([stroke]);
  await expect.poll(()=>pixel(0,0)).toEqual([255,255,255,255]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([]);
});

test('brush canvas size lock beside Optimize keeps document width across zoom and mirrors Properties', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#000000');
  await page.getByLabel('Brush size', { exact: true }).fill('24');
  const canvas = page.getByLabel('Drawing stage');
  const canvasLock = page.getByLabel('Brush lock size to canvas', { exact: true }),
    propertiesLock = page.getByLabel('Brush lock size to canvas in Properties', { exact: true }),
    screenSize = page.getByLabel('Keep brush size on screen', { exact: true });
  await expect(screenSize).not.toBeChecked();
  await expect(canvasLock).toBeChecked();
  await expect(propertiesLock).toBeChecked();
  await propertiesLock.uncheck();
  await expect(screenSize).toBeChecked();
  await expect(canvasLock).not.toBeChecked();
  await screenSize.uncheck();
  await expect(canvasLock).toBeChecked();
  await expect(propertiesLock).toBeChecked();
  for (const [zoom, screen, expectedDocument, expectedPixels] of [
    [2, false, 24, 48],
    [0.5, true, 48, 24],
    [1, true, 24, 24],
    [2, true, 12, 24],
    [0.5, false, 24, 12],
    [1, false, 24, 24],
  ] as const) {
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption(String(zoom));
    await canvasLock.setChecked(!screen);
    await expect(propertiesLock).toBeChecked({ checked: !screen });
    await expect(screenSize).toBeChecked({ checked: screen });
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + 500, b.y + 250);
    await page.mouse.down();
    await page.mouse.move(b.x + 560, b.y + 250, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('main.editor:not([inert]) #drawing-tools-panel:not([inert])')).toBeAttached();
    await page.mouse.move(b.x + 30, b.y + 30);
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project.layers[0].keys[0].shapes.length ?? 0,
    )).toBe(1);
    const shape = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].keys[0].shapes[0],
    );
    expect(shape.kind).toBe('polygon');
    expect(shape.height).toBeCloseTo(expectedDocument, 1);
    const thickness = await canvas.evaluate((c) => {
      const pixels = (c as HTMLCanvasElement).getContext('2d')!.getImageData(530, 200, 1, 100).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 20 && pixels[i + 1] < 20 && pixels[i + 2] < 20) count++;
      return count;
    });
    expect(Math.abs(thickness - expectedPixels)).toBeLessThanOrEqual(2);
    await canvas.focus();
    await page.keyboard.press('Control+z');
  }
  await page.getByLabel('Keep brush size on screen').check();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('0.25');
  await page.getByLabel('Brush size', { exact: true }).fill('200');
  await expect(
    page.getByText('Current width: 200 document px · 50 screen px', { exact: true }),
  ).toBeVisible();
  await canvas.focus();
  await page.keyboard.press('[');
  await expect(page.getByLabel('Brush size', { exact: true })).toHaveValue('199');
  await page.keyboard.press(']');
  await expect(page.getByLabel('Brush size', { exact: true })).toHaveValue('200');
  await page.keyboard.press('Shift+BracketLeft');
  await expect(page.getByLabel('Brush size', { exact: true })).toHaveValue('190');
});

test('brush hover and live drafts reuse the backdrop; commit and undo repaint it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  await page.evaluate(() => {
    const stage = document.querySelector('canvas[aria-label="Drawing stage"]');
    const state = { source: null as CanvasImageSource | null, paints: 0, blits: 0 };
    (window as unknown as { backdropProbe: typeof state }).backdropProbe = state;
    const proto = CanvasRenderingContext2D.prototype,
      draw = proto.drawImage,
      fill = proto.fillRect;
    proto.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof draw>) {
      if (this.canvas === stage) {
        state.source ??= args[0];
        state.blits++;
      }
      return Reflect.apply(draw, this, args);
    } as typeof draw;
    proto.fillRect = function (...args: Parameters<typeof fill>) {
      if (this.canvas === state.source) state.paints++;
      return Reflect.apply(fill, this, args);
    };
  });
  const counts = () =>
    page
      .evaluate(
        () =>
          (window as unknown as { backdropProbe: { paints: number; blits: number } }).backdropProbe,
      )
      .then(({ paints, blits }) => ({ paints, blits }));
  await page.mouse.move(b.x + 260, b.y + 190);
  await expect.poll(async () => (await counts()).blits).toBeGreaterThan(0);
  const baseline = await counts();
  await page.mouse.move(b.x + 280, b.y + 195, { steps: 5 });
  await page.mouse.down();
  await page.mouse.move(b.x + 390, b.y + 195, { steps: 16 });
  expect((await counts()).paints).toBe(baseline.paints);
  await page.mouse.up();
  await expect.poll(async () => (await counts()).paints).toBeGreaterThan(baseline.paints);
  const committed = (await counts()).paints;
  await stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await counts()).paints).toBeGreaterThan(committed);
});

test('repeated alternating brush commits stay editable and undo the latest stroke', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('24');
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as
            Project | undefined
        )?.layers[0].keys[0].shapes ?? [],
    );
  let previous: Awaited<ReturnType<typeof read>> = [];
  for (let i = 0; i < 18; i++) {
    previous = i ? await read() : [];
    await page.getByLabel('Drawing fill', { exact: true }).fill(i % 2 ? '#cc4411' : '#224488');
    for (let j = 0; j <= 20; j++) {
      await page.mouse.move(box.x + 250 + j * 20, box.y + 240 + Math.sin(j / 3 + i * 0.4) * 55);
      if (!j) await page.mouse.down();
    }
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(previous));
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  const result = await read();
  expect(result.length).toBeGreaterThan(0);
  expect(result.every((s) => s.kind === 'polygon' && s.strokeWidth === 0)).toBe(true);
  await stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(previous);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(result);
});

for (const tool of ['Brush', 'Pencil', 'Eraser', 'Lasso'])
  test(`${tool} sample limit cancels without committing partial artwork or history`, async ({
    page,
  }) => {
    await page.goto('/');
    const canvas = page.getByLabel('Drawing stage'),
      box = (await canvas.boundingBox())!;
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + 280, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 300);
    await page.mouse.up();
    await expect(page.locator('main.editor:not([inert]) #drawing-tools-panel:not([inert])')).toBeAttached();
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes,
      );
    await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).not.toBeNull();
    await expect.poll(async () => (await read()).length).toBeGreaterThan(0);
    const before = await read();
    await page.getByRole('button', { name: tool, exact: true }).click();
    if (tool === 'Eraser') await page.getByLabel('Eraser mode').selectOption('all');
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (event) => {
          (window as unknown as { limitPointer: number }).limitPointer = (
            event as PointerEvent
          ).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(box.x + 320, box.y + 240);
    await page.mouse.down();
    await canvas.evaluate((c, tool) => {
      const box = c.getBoundingClientRect(),
        pointerId = (window as unknown as { limitPointer: number }).limitPointer;
      const sample = (i: number, type = 'pointermove') =>
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: 'mouse',
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: box.x + 320 + (i % 2),
          clientY: box.y + 240,
        });
      if (tool === 'Brush' || tool === 'Pencil') {
        const event = sample(1, 'pointerup');
        Object.defineProperty(event, 'getCoalescedEvents', {
          value: () => Array.from({ length: 100002 }, (_, i) => sample(i)),
        });
        c.dispatchEvent(event);
      } else {
        for (let i = 0; i < 100002; i++) c.dispatchEvent(sample(i));
      }
    }, tool);
    await page.mouse.up();
    await expect(
      page.getByText(
        'Gesture exceeds the document point capacity; no partial gesture was committed.',
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(await read()).toEqual(before);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

test('merged brush loop holes and crossing paint survive history and HTML export', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage'),
    box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('20');
  const read = () =>
    page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as
            Project | undefined
        )?.layers[0].keys[0].shapes ?? [],
    );
  const draw = async (points: number[][], color: string) => {
    await page.getByLabel('Drawing fill', { exact: true }).fill(color);
    const before = JSON.stringify(await read());
    await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1))
      await page.mouse.move(box.x + x, box.y + y, { steps: 10 });
    await page.mouse.up();
    await page.mouse.move(box.x + 600, box.y + 100);
    await expect.poll(async () => JSON.stringify(await read())).not.toBe(before);
  };
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (c, [x, y]) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data),
      [x, y],
    );
  await draw(
    [
      [300, 180],
      [500, 180],
      [500, 380],
      [300, 380],
      [300, 180],
    ],
    '#ff0000',
  );
  const loop = await read();
  await expect.poll(() => pixel(400, 180)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(400, 280)).toEqual([255, 255, 255, 255]);
  await draw(
    [
      [260, 280],
      [540, 280],
    ],
    '#0000ff',
  );
  const crossed = await read();
  for (const [x, y, color] of [
    [400, 180, [255, 0, 0, 255]],
    [300, 280, [0, 0, 255, 255]],
    [400, 280, [0, 0, 255, 255]],
    [400, 230, [255, 255, 255, 255]],
    [400, 330, [255, 255, 255, 255]],
  ] as const)
    await expect.poll(() => pixel(x, y)).toEqual([...color]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(loop);
  await expect.poll(() => pixel(400, 280)).toEqual([255, 255, 255, 255]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(read).toEqual(crossed);
  await expect.poll(() => pixel(400, 280)).toEqual([0, 0, 255, 255]);
  const download = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const exported = await page.context().newPage();
  await openWebExport(exported, await readWebDownload(await download));
  const origin = { x: (box.width - 960) / 2, y: (box.height - 540) / 2 };
  for (const [x, y, color] of [
    [400, 180, [255, 0, 0, 255]],
    [300, 280, [0, 0, 255, 255]],
    [400, 280, [0, 0, 255, 255]],
    [400, 230, [255, 255, 255, 255]],
    [400, 330, [255, 255, 255, 255]],
  ] as const) {
    await expect
      .poll(() =>
        exported
          .locator('canvas')
          .evaluate(
            (c, [x, y]) =>
              Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data),
            [x - origin.x, y - origin.y],
          ),
      )
      .toEqual([...color]);
  }
  await exported.close();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Brush Simplify up to 200 percent removes outline vertices and saves curves with undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  // Isolate smoothing percentages: Optimize can also fit zero-smoothing paint.
  await page.getByLabel('Brush optimize', { exact: true }).uncheck();
  await page.getByLabel('Brush size', { exact: true }).fill('24');
  const canvas = page.getByLabel('Drawing stage');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  const draw = async () => {
    const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + 240, b.y + 250);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++)
      await page.mouse.move(b.x + 240 + i * 5, b.y + 250 + Math.sin(i / 7) * 30);
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
      .not.toBe(before);
    return read();
  };
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
  const raw = await draw();
  expect(raw.flatMap((s) => s.contours?.flat() ?? []).some((n) => n.in || n.out)).toBe(false);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  const counts: number[] = [];
  for (const amount of [10, 50, 100, 150, 200]) {
    await page.getByLabel('Brush simplify amount', { exact: true }).fill(String(amount));
    const smooth = await draw();
    const nodes = smooth.flatMap((s) => s.contours?.flat() ?? []);
    counts.push(nodes.length);
    expect(nodes.length).toBeLessThan(raw.flatMap((s) => s.contours?.flat() ?? []).length / 2);
    expect(nodes.some((n) => n.in && n.out)).toBe(true);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(smooth);
    await page.keyboard.press('Control+z');
  }
  console.log('Brush outline vertices at 10/50/100/150/200 percent:', counts);
  expect(counts[1]).toBeLessThan(counts[0]);
  expect(counts[2]).toBeLessThan(counts[1]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const fail of [false, true])
  test(`Brush stays visible during pending merge and cleans up (failure: ${fail})`, async ({
    page,
  }) => {
    await holdGeometry(page);
    await page.goto('/');
    const canvas = page.getByLabel('Drawing stage'),
      b = (await canvas.boundingBox())!;
    await page.getByRole('button', { name: 'Brush', exact: true }).click();
    await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
    await page.getByLabel('Brush size', { exact: true }).fill('30');
    const saved = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const before = await saved();
    const pixel = () =>
      canvas.evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(400, 240, 1, 1).data),
      );
    await page.mouse.move(b.x + 350, b.y + 240);
    await page.mouse.down();
    await page.mouse.move(b.x + 450, b.y + 240, { steps: 10 });
    await expect.poll(pixel).toEqual([0, 255, 0, 255]);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    // Force hover redraws while the worker is held, without sleeping through the gap.
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(b.x + 500 + i * 5, b.y + 300);
      await canvas.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      expect(await pixel()).toEqual([0, 255, 0, 255]);
    }
    expect(await saved()).toBe(before);
    await releaseGeometry(page, fail);
    if (fail) {
      await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
      await expect.poll(pixel).toEqual([255, 255, 255, 255]);
      expect(await saved()).toBe(before);
    } else {
      await expect.poll(saved).not.toBe(before);
      await expect.poll(pixel).toEqual([0, 255, 0, 255]);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(pixel).toEqual([255, 255, 255, 255]);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(pixel).toEqual([0, 255, 0, 255]);
    }
  });

for (const tool of ['Brush', 'Pencil']) {
  test(`long main ${tool} strokes preserve complete samples and undo beyond the former cutoff`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const canvas = page.getByLabel('Drawing stage');
    await page.getByRole('button', { name: tool, exact: true }).click();
    if (tool === 'Brush') {
      await page.getByLabel('Separate brush objects', { exact: true }).check();
      await page.getByLabel('Brush size', { exact: true }).fill('2');
      await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
      await page.getByLabel('Brush optimize', { exact: true }).uncheck();
    } else {
      await page.getByLabel('Drawing mode', { exact: true }).selectOption('object');
      await page.getByLabel('Pencil mode', { exact: true }).selectOption('ink');
      await page.getByLabel('Pencil optimize', { exact: true }).uncheck();
    }
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (e) => {
          (c as HTMLElement).dataset.longPointer = String((e as PointerEvent).pointerId);
        },
        { once: true },
      ),
    );
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    const expected = await canvas.evaluate((c) => {
      const box = c.getBoundingClientRect(),
        pointerId = Number((c as HTMLElement).dataset.longPointer);
      const sample = (i: number, type = 'pointermove') =>
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: 'mouse',
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: box.x + 200 + i / 100,
          clientY: box.y + 200 + (i % 2 ? 0.5 : 0),
        });
      const samples = Array.from({ length: 21000 }, (_, i) => sample(i + 1));
      const end = sample(21001, 'pointerup');
      Object.defineProperty(end, 'getCoalescedEvents', { value: () => samples });
      c.dispatchEvent(end);
      return samples
        .concat(end)
        .map((p) => ({ x: p.clientX - (box.x + 200), y: p.clientY - (box.y + 200) }));
    });
    await page.mouse.up();
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers.flatMap(layer => layer.keys[0].shapes),
      );
    await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')), { timeout: 15000 }).not.toBeNull();
    await expect.poll(async () => (await read()).length).toBe(1);
    const saved = await read(),
      s = saved[0];
    expect(s.points).toHaveLength(21002);
    const first = s.points[0];
    let maximumError = 0;
    for (let i = 1; i < s.points.length; i++) {
      maximumError = Math.max(
        maximumError,
        Math.abs(s.points[i].x - first.x - expected[i - 1].x),
        Math.abs(s.points[i].y - first.y - expected[i - 1].y),
      );
    }
    expect(maximumError).toBeLessThan(0.000005);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual([]);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(saved);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('merged Brush preserves exact remote curves beyond 512 objects and undo restores the scene', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'merge';
  p.layers[0].keys[0].shapes = Array.from({ length: 520 }, (_, i) => ({
    id: `remote-${i}`,
    kind: 'polygon',
    x: 2000 + (i % 30) * 100,
    y: Math.floor(i / 30) * 100,
    width: 40,
    height: 40,
    rotation: 0,
    fill: '#cc2211',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    closed: true,
    fillRule: 'evenodd',
    contours: [
      [
        { x: 0, y: 0, out: { x: 15, y: -10 } },
        { x: 40, y: 0, in: { x: 25, y: -10 } },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
    ],
  }));
  p.layers[0].keys[0].shapes.push({
    id: 'tiny-remote',
    kind: 'rectangle',
    x: -99900,
    y: -99900,
    width: 0.001,
    height: 0.001,
    rotation: 0,
    fill: '#0000ff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.mouse.move(b.x + 260, b.y + 190);
  await page.mouse.down();
  await page.mouse.move(b.x + 390, b.y + 210, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(522);
  const after = await read();
  for (const source of p.layers[0].keys[0].shapes.filter((s) => s.id !== 'tiny-remote'))
    expect(after.layers[0].keys[0].shapes.find((s) => s.id === source.id)).toEqual(source);
  const tiny = after.layers[0].keys[0].shapes.find((s) => s.x < -99000)!;
  expect(tiny).toBeDefined();
  expect(tiny.x).toBeCloseTo(-99900, 7);
  expect(tiny.y).toBeCloseTo(-99900, 7);
  expect(tiny.width).toBeCloseTo(0.001, 7);
  expect(tiny.height).toBeCloseTo(0.001, 7);
  expect(tiny.fill).toBe('#0000ff');
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('Brush worker splits tiny asymmetric crossing strokes and undo restores original paths', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'merge';
  p.layers[0].keys[0].shapes = [
    [
      { x: 0, y: 0 },
      { x: 0.0001, y: 0 },
    ],
    [
      { x: 0.000025, y: -0.000025 },
      { x: 0.000075, y: 0.000075 },
    ],
  ].map((points, i) => ({
    id: `tiny-${i}`,
    kind: 'path',
    x: 2000,
    y: 2000,
    width: 0.0001,
    height: 0.0001,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#000000',
    strokeWidth: 0.00001,
    points,
  }));
  p.layers[0].keys[0].shapes.push({
    id: 'narrow',
    kind: 'rectangle',
    x: 2000,
    y: 2001,
    width: 100,
    height: 0.00001,
    rotation: 0,
    fill: '#0000ff',
    fillEnabled: true,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const canvas = page.getByLabel('Drawing stage'),
    b = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.mouse.move(b.x + 260, b.y + 190);
  await page.mouse.down();
  await page.mouse.move(b.x + 390, b.y + 210, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(6);
  const narrow = (await read()).layers[0].keys[0].shapes.find((s) => s.fill === '#0000ff')!;
  expect(narrow).toBeDefined();
  expect(narrow.width).toBeCloseTo(100, 7);
  expect(narrow.height).toBeCloseTo(0.00001, 7);
  const spans = (await read()).layers[0].keys[0].shapes.filter((s) => s.strokeWidth > 0);
  expect(spans).toHaveLength(4);
  for (const span of spans)
    expect(
      span.points.some((p) => Math.hypot(span.x + p.x - 2000.0000375, span.y + p.y - 2000) < 1e-8),
    ).toBe(true);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

for (const contact of [false, true]) test(`Brush ${contact ? 'joins a reached' : 'preserves an untouched'} 12000-face chain through Undo`, async ({
  page,
}) => {
  test.setTimeout(60000);
  const p = newProject();
  p.layers[0].drawingMode = 'merge';
  p.layers[0].keys[0].shapes = Array.from({ length: 12000 }, (_, i) => ({
    id: `chain-${i}`,
    kind: 'polygon' as const,
    drawingMode: 'merge' as const,
    fillRule: 'evenodd' as const,
    closed: true,
    x: 450 + i,
    y: 270,
    width: 1,
    height: 1,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    contours: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
  }));
  p.layers[0].keys[0].shapes.push({
    id: 'chain-line',
    kind: 'line',
    x: 450,
    y: 310,
    width: 5,
    height: 5,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke: '#000000',
    strokeWidth: 1,
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ],
  });
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const canvas = page.getByLabel('Drawing stage');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
  const b = (await canvas.boundingBox())!;
  const origin = { x: b.x + (b.width - p.width) / 2, y: b.y + (b.height - p.height) / 2 };
  const y = contact ? 270.5 : 220;
  await page.mouse.move(origin.x + 405, origin.y + y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 460, origin.y + y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await read()).layers[0].keys[0].shapes.length, { timeout: 30000 })
    .toBe(contact ? 2 : 12002);
  const shapes = (await read()).layers[0].keys[0].shapes;
  const originals = p.layers[0].keys[0].shapes;
  expect(shapes.find(s => s.id === 'chain-line')).toEqual(originals.at(-1));
  if (contact) {
    const fill = shapes.find(s => s.fill === '#ff0000' && !s.strokeWidth)!;
    expect(fill.kind).toBe('polygon');
    expect(fill.contours).toHaveLength(1);
    expect(fill.contours![0].some(node => node.in || node.out)).toBe(true);
    const [path] = worldPaths(fill);
    for (const x of [420, 450.5, 6450.5, 12449.5]) {
      expect(containsPoint(path, { x, y: 270.5 })).toBe(true);
    }
  } else {
    expect(shapes.slice(0, originals.length)).toEqual(originals);
    const incoming = shapes.at(-1)!;
    expect(incoming.fill).toBe('#ff0000');
    expect(containsPoint(worldPaths(incoming)[0], { x: 420, y })).toBe(true);
  }
  await expect.poll(() => canvas.evaluate((node, { width, height, y }) => {
    const c = node as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(
      c.width / 2 + (420 - width / 2) * devicePixelRatio,
      c.height / 2 + (y - height / 2) * devicePixelRatio, 1, 1,
    ).data];
  }, { width: p.width, height: p.height, y })).toEqual([255, 0, 0, 255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(p);
});

test('merged Brush retains nested nonzero fill winding and exact undo', async ({ page }) => {
  const project = newProject();
  project.layers[0].drawingMode = 'merge';
  const square = (a: number, b: number) => [
    { x: a, y: a },
    { x: b, y: a },
    { x: b, y: b },
    { x: a, y: b },
  ];
  project.layers[0].keys[0].shapes = [
    {
      id: 'nonzero',
      kind: 'polygon',
      x: 300,
      y: 180,
      width: 160,
      height: 160,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      closed: true,
      fillRule: 'nonzero',
      contours: [square(0, 160), square(20, 140), square(40, 120).reverse()],
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage'),
    bounds = (await canvas.boundingBox())!;
  const origin = { x: (bounds.width - project.width) / 2, y: (bounds.height - project.height) / 2 };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const pixels = () =>
    canvas.evaluate((node, origin) => {
      const ctx = (node as HTMLCanvasElement).getContext('2d')!;
      return [310, 330, 380].map((x) => [
        ...ctx.getImageData(origin.x + x, origin.y + 260, 1, 1).data,
      ]);
    }, origin);
  const red = [255, 0, 0, 255];
  await expect.poll(pixels).toEqual([red, red, red]);
  await page.getByLabel('Drawing fill', { exact: true }).fill('#0000ff');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.mouse.move(bounds.x + origin.x + 290, bounds.y + origin.y + 190);
  await page.mouse.down();
  await page.mouse.move(bounds.x + origin.x + 340, bounds.y + origin.y + 190, { steps: 8 });
  await page.mouse.up();
  await expect.poll(read).not.toEqual(before);
  await expect.poll(pixels).toEqual([red, red, red]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await expect.poll(pixels).toEqual([red, red, red]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const fillRule of ['nonzero', 'evenodd'] as const)
  test(`merged Brush retains cancelling crossing lobes and undo (${fillRule})`, async ({
    page,
  }) => {
    const project = newProject();
    project.layers[0].drawingMode = 'merge';
    project.layers[0].keys[0].shapes = [
      {
        id: 'nonzero',
        kind: 'polygon',
        x: 300,
        y: 180,
        width: 160,
        height: 160,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        closed: true,
        fillRule,
        contours: [
          [
            { x: 0, y: 0 },
            { x: 160, y: 160 },
            { x: 0, y: 160 },
            { x: 160, y: 0 },
          ],
        ],
      },
    ];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const canvas = page.getByLabel('Drawing stage'),
      bounds = (await canvas.boundingBox())!;
    const origin = {
      x: (bounds.width - project.width) / 2,
      y: (bounds.height - project.height) / 2,
    };
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    const pixels = () =>
      canvas.evaluate((node, origin) => {
        const ctx = (node as HTMLCanvasElement).getContext('2d')!;
        return [
          [380, 200],
          [380, 320],
          [310, 260],
        ].map(([x, y]) => [...ctx.getImageData(origin.x + x, origin.y + y, 1, 1).data]);
      }, origin);
    const red = [255, 0, 0, 255];
    await expect.poll(pixels).toEqual([red, red, [255, 255, 255, 255]]);
    await page.getByLabel('Drawing fill', { exact: true }).fill('#0000ff');
    await page.getByRole('button', { name: 'Brush', exact: true }).click();
    await page.mouse.move(bounds.x + origin.x + 290, bounds.y + origin.y + 190);
    await page.mouse.down();
    await page.mouse.move(bounds.x + origin.x + 340, bounds.y + origin.y + 190, { steps: 8 });
    await page.mouse.up();
    await expect.poll(read).not.toEqual(before);
    await expect.poll(pixels).toEqual([red, red, [255, 255, 255, 255]]);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await expect.poll(pixels).toEqual([red, red, [255, 255, 255, 255]]);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const fillRule of [undefined, 'nonzero'] as const)
  test(`selection hits nested nonzero paint and restores exact undo (${fillRule ?? 'default'})`, async ({
    page,
  }) => {
    const project = newProject();
    project.layers[0].drawingMode = 'object';
    const square = (a: number, b: number) => [
      { x: a, y: a },
      { x: b, y: a },
      { x: b, y: b },
      { x: a, y: b },
    ];
    project.layers[0].keys[0].shapes = [
      {
        id: 'nonzero',
        kind: 'polygon',
        x: 300,
        y: 180,
        width: 160,
        height: 160,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        closed: true,
        fillRule,
        contours: [square(0, 160), square(20, 140)],
      },
    ];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const canvas = page.getByLabel('Drawing stage'),
      bounds = (await canvas.boundingBox())!;
    const origin = {
      x: (bounds.width - project.width) / 2,
      y: (bounds.height - project.height) / 2,
    };
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    const pixels = () =>
      canvas.evaluate((node, origin) => {
        const ctx = (node as HTMLCanvasElement).getContext('2d')!;
        return [310, 330, 380].map((x) => [
          ...ctx.getImageData(origin.x + x, origin.y + 260, 1, 1).data,
        ]);
      }, origin);
    const red = [255, 0, 0, 255];
    await expect.poll(pixels).toEqual([red, red, red]);
    await page.getByRole('button', { name: 'Selection', exact: true }).click();
    await page.mouse.click(bounds.x + origin.x + 380, bounds.y + origin.y + 260);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(0);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await expect.poll(pixels).toEqual([red, red, red]);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const fillRule of ['nonzero', 'evenodd'] as const)
  test(`merged Brush retains self-crossing star parity and undo (${fillRule})`, async ({
    page,
  }) => {
    const project = newProject();
    project.layers[0].drawingMode = 'merge';
    project.layers[0].keys[0].shapes = [
      {
        id: 'nonzero',
        kind: 'polygon',
        x: 300,
        y: 180,
        width: 160,
        height: 160,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        closed: true,
        fillRule,
        contours: [
          Array.from({ length: 5 }, (_, i) => {
            const angle = (((i * 2) % 5) * 2 * Math.PI) / 5;
            return { x: 80 + 70 * Math.cos(angle), y: 80 + 70 * Math.sin(angle) };
          }),
        ],
      },
    ];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const canvas = page.getByLabel('Drawing stage'),
      bounds = (await canvas.boundingBox())!;
    const origin = {
      x: (bounds.width - project.width) / 2,
      y: (bounds.height - project.height) / 2,
    };
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    const pixels = () =>
      canvas.evaluate((node, origin) => {
        const ctx = (node as HTMLCanvasElement).getContext('2d')!;
        return [
          [380, 260],
          [435, 260],
          [310, 190],
        ].map(([x, y]) => [...ctx.getImageData(origin.x + x, origin.y + y, 1, 1).data]);
      }, origin);
    const red = [255, 0, 0, 255];
    const center = fillRule === 'nonzero' ? red : [255, 255, 255, 255];
    await expect.poll(pixels).toEqual([center, red, [255, 255, 255, 255]]);
    await page.getByLabel('Drawing fill', { exact: true }).fill('#0000ff');
    await page.getByRole('button', { name: 'Brush', exact: true }).click();
    await page.mouse.move(bounds.x + origin.x + 290, bounds.y + origin.y + 240);
    await page.mouse.down();
    await page.mouse.move(bounds.x + origin.x + 340, bounds.y + origin.y + 240, { steps: 8 });
    await page.mouse.up();
    await expect.poll(read).not.toEqual(before);
    await expect.poll(pixels).toEqual([center, red, [255, 255, 255, 255]]);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await expect.poll(pixels).toEqual([center, red, [255, 255, 255, 255]]);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });


for (const editor of ['main', 'symbol'] as const)
  test(`Brush raster backlog stays frame-bounded and finishes every sample in ${editor}`, async ({ page }) => {
    await holdGeometry(page);
    await page.addInitScript(() => {
      const curve = Path2D.prototype.bezierCurveTo;
      const post = Worker.prototype.postMessage;
      Object.assign(window, { budgetCurves: 0, budgetRequest: null });
      Path2D.prototype.bezierCurveTo = function (...args) {
        (window as unknown as { budgetCurves: number }).budgetCurves++;
        return curve.apply(this, args);
      };
      Worker.prototype.postMessage = function (message: unknown) {
        if ((message as { brushCommit?: unknown }).brushCommit)
          (window as unknown as { budgetRequest: unknown }).budgetRequest = message;
        post.call(this, message);
      };
    });
    if (editor === 'symbol') {
      const project = newProject();
      project.symbols = [{ id: 'budget', name: 'Budget', width: 100, height: 100, shapes: [{
        id: 'base', kind: 'rectangle', x: 1, y: 1, width: 2, height: 2, rotation: 0,
        fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [],
      }] }];
      await page.addInitScript((project) => localStorage.setItem('splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null })), project);
    }
    await page.goto('/');
    if (editor === 'symbol') {
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('group', { name: 'Symbol Budget', exact: true })
        .getByRole('button', { name: 'Edit symbol artwork', exact: true }).click();
      await page.getByLabel('Symbol canvas tool').selectOption('brush');
      await page.getByLabel('Separate symbol brush objects', { exact: true }).check();
      await page.getByLabel('Smooth symbol brush', { exact: true }).uncheck();
      await page.getByLabel('New symbol drawing fill', { exact: true }).fill('#ff0000');
    } else {
      await page.getByRole('button', { name: 'Brush', exact: true }).click();
      await page.getByLabel('Separate brush objects', { exact: true }).check();
      await page.getByLabel('Brush simplify amount', { exact: true }).fill('0');
      await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
    }
    const canvas = page.getByLabel(editor === 'main' ? 'Drawing stage' : 'Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await canvas.evaluate((c) => c.addEventListener('pointerdown', (e) => {
      (c as HTMLElement).dataset.budgetPointer = String((e as PointerEvent).pointerId);
    }, { once: true }));
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5);
    await page.mouse.down();
    const saved = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const burst = await canvas.evaluate(async (c) => {
      const state = window as unknown as { budgetCurves: number };
      state.budgetCurves = 0;
      const b = c.getBoundingClientRect(), pointerId = Number((c as HTMLElement).dataset.budgetPointer);
      const sample = (i: number, type = 'pointermove') => new PointerEvent(type, {
        bubbles: true, pointerId, pointerType: 'mouse', buttons: type === 'pointerup' ? 0 : 1,
        clientX: b.x + b.width * (.3 + .4 * i / 6000),
        clientY: b.y + b.height * .5 + (i % 2 ? 3 : 0),
      });
      const event = sample(6000);
      Object.defineProperty(event, 'getCoalescedEvents', {
        value: () => Array.from({ length: 6000 }, (_, i) => sample(i + 1)),
      });
      c.dispatchEvent(event);
      await Promise.resolve();
      const curves = state.budgetCurves;
      // Release before any animation frame can drain the large backlog.
      c.dispatchEvent(sample(6000, 'pointerup'));
      await Promise.resolve();
      return { curves, afterRelease: state.budgetCurves, pointerId };
    });
    // Input and immediate release only enqueue presentation. No geometry is
    // rasterized until the next actual display frame, including a huge burst.
    expect(burst.curves).toBe(0);
    expect(burst.afterRelease).toBe(0);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    const count = await page.evaluate(() => (window as unknown as {
      budgetRequest: { brushCommit: { brush: { points: unknown[] } } }
    }).budgetRequest.brushCommit.brush.points.length);
    expect(count).toBe(6001);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(saved);
    await page.mouse.move(box.x + box.width * .9, box.y + box.height * .2);
    // The far end was queued, not rasterized by the first bounded paint. It
    // becomes visible while worker delivery is held, including after release.
    const tail = () => canvas.evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      return Array.from(canvas.getContext('2d')!.getImageData(
        Math.round(canvas.width * .69), Math.round(canvas.height * .5), 1, 1).data);
    });
    await expect.poll(tail).toEqual([255, 0, 0, 255]);
    await releaseGeometry(page);
    if (editor === 'symbol') {
      const dialog = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
      await expect(dialog.getByRole('button', { name: 'Apply symbol changes', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    }
    await expect.poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).not.toBe(saved);
    const points = await page.evaluate((editor) => {
      const project = JSON.parse(localStorage.getItem('splash-recovery-v1')!).project;
      return (editor === 'main' ? (project as Project).layers.flatMap(l => l.keys[0].shapes) : project.symbols[0].shapes).find((shape: { kind: string }) => shape.kind === 'brush').points.length;
    }, editor);
    expect(points).toBe(6001);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });


for (const variant of ['plain', 'affine', 'reflected', 'high-resolution'] as const)
  test(`Brush dirty bitmap matches full recoloring for ${variant} views through 12000 samples`, async ({ page }) => {
    await page.goto('/');
    const { buildSync } = createRequire(import.meta.resolve('vite'))('esbuild') as {
      buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
    };
    const script = buildSync({
      bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
      tsconfig: 'tsconfig.json',
      stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
        import { BrushPreview } from './packages/stage/src/brush-preview';
        globalThis.__brushDirtyOracle = (variant) => {
          const canvas = () => { const c=document.createElement('canvas');c.width=800;c.height=600;return c; };
          const a=canvas(), b=canvas(), ctx=a.getContext('2d'), reference=b.getContext('2d');
          const incremental=new BrushPreview(), full=new BrushPreview();
          const matrix=variant==='reflected'?[-1.1,.25,.3,1.1,650,20]:variant==='affine'?[1,.3,.4,1,20,15]:variant==='high-resolution'?[2,0,0,2,0,0]:[1,0,0,1,0,0];
          const brush={id:'pixels',kind:'brush',x:10,y:12,width:0,height:0,rotation:variant==='plain'?0:23,
            transform:variant==='plain'?undefined:[1,.2,.3,1],fill:'#cc2200',opacity:.45,stroke:'',strokeWidth:12,
            brush:{pressure:true,minimum:.2,aspect:.6,angle:35,tilt:true,twist:true},points:[{x:10,y:40,pressure:.7}]};
          const snapshots=[], areas=[];
          let collecting=false;
          const fill=CanvasRenderingContext2D.prototype.fillRect;
          CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(collecting&&this.globalCompositeOperation==='source-in')areas.push(w*h);return fill.call(this,x,y,w,h);};
          const draw=()=>{
            for(const c of [ctx,reference]){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,800,600);c.setTransform(...matrix);}
            collecting=true;incremental.draw(ctx,brush);collecting=false;
            // Independent full-canvas recoloring baseline, with the exact same
            // append-only mask rasterization. No dirty rectangle is admitted.
            full.fill=undefined;full.draw(reference,brush);
          };
          const compare=()=>{
            const pixels=ctx.getImageData(0,0,800,600).data, expected=reference.getImageData(0,0,800,600).data;
            let differences=0,paint=0;
            for(let i=0;i<pixels.length;i++){if(pixels[i]!==expected[i])differences++;if(i%4===3&&pixels[i])paint++;}
            snapshots.push({differences,paint});
          };
          try {
            draw();
            for(let batch=0;batch<120;batch++){
              for(let j=0;j<100;j++){const i=batch*100+j;brush.points.push({x:10+i%180,y:40+Math.sin(i/12)*20,pressure:.3+(i%7)/10,tiltX:i%60,tiltY:20,twist:i%360});}
              draw();if(batch===0||batch===59||batch===119)compare();
            }
            // Revisit old paint, recolor all retained coverage, and change
            // opacity independently. Dirty Copy must never erase other pixels.
            brush.points.push({x:10,y:40,pressure:.7});draw();compare();
            brush.fill='#2244cc';draw();compare();
            brush.opacity=.8;draw();compare();
            const last=brush.points.at(-1);brush.points.push({...last,x:last.x+1});draw();compare();
            return {snapshots,finalArea:areas.at(-1),count:brush.points.length};
          } finally {CanvasRenderingContext2D.prototype.fillRect=fill;}
        };` },
    }).outputFiles[0].text;
    await page.addScriptTag({ content: script });
    const result = await page.evaluate((variant) => (window as unknown as {
      __brushDirtyOracle(v: string): { snapshots: { differences: number; paint: number }[]; finalArea: number; count: number };
    }).__brushDirtyOracle(variant), variant);
    expect(result.count).toBe(12003);
    expect(result.snapshots).toHaveLength(7);
    for (const snapshot of result.snapshots) {
      expect(snapshot.differences).toBe(0);
      expect(snapshot.paint).toBeGreaterThan(100);
    }
    expect(result.finalArea).toBeLessThan(10000);
  });

async function firmPenInput(page:Page,stage:Locator,project:Pick<Project,'width'|'height'>) {
  await stage.evaluate(element=>{
    element.addEventListener('pointerdown',event=>{
      const pen=event as PointerEvent;
      if (pen.pointerType==='pen') (element as HTMLElement).dataset.firmPen=String(pen.pointerId);
    });
    const send=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message:unknown) {
      const request=(message as {brushCommit?:{brush?: {points?: {pressure?:number}[];brush?: {response?:number}}}}).brushCommit;
      if (request?.brush?.points) {
        const points=request.brush.points;
        (element as HTMLElement).dataset.firmSamples=JSON.stringify({
          count:points.length, initial:points[0].pressure, later:points[67]?.pressure,response:request.brush.brush?.response,
        });
      }
      send.call(this,message);
    };
  });
  const view=(await stage.boundingBox())!;
  const toScreen=(x:number,y:number)=>({x:view.x+(view.width-project.width/4)/2+x/4,
    y:view.y+(view.height-project.height/4)/2+y/4});
  const pen=await page.context().newCDPSession(page);
  const down=async(x:number,y:number,force:number)=>pen.send('Input.dispatchMouseEvent',{
    type:'mousePressed',...toScreen(x,y),button:'left',buttons:1,clickCount:1,pointerType:'pen',force,
  });
  const up=async(x:number,y:number)=>pen.send('Input.dispatchMouseEvent',{
    type:'mouseReleased',...toScreen(x,y),button:'left',buttons:0,clickCount:1,pointerType:'pen',force:0,
  });
  const append=async(start:number,end:number,mode:'burst'|'frame'|'measure'='burst')=>stage.evaluate(async(element,{origin,start,end,mode})=>{
    const canvas=element as HTMLCanvasElement, pointerId=Number(canvas.dataset.firmPen);
    const timings:number[]=[];
    for(let cursor=start;cursor<=end;cursor+=180) {
      const events=Array.from({length:Math.min(180,end-cursor+1)},(_,offset)=>{
        const i=cursor+offset;
        return new PointerEvent('pointermove',{bubbles:true,pointerType:'pen',pointerId,isPrimary:true,button:-1,
          buttons:1,clientX:origin.x+i*.9/4,clientY:origin.y+(150+40*Math.sin(i/60))/4,
          pressure:.25+.3*(1+Math.sin(i/67))});
      });
      const delivered=events.at(-1)!;
      Object.defineProperty(delivered,'getCoalescedEvents',{value:()=>events});
      const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if (mode!=='measure') {
        canvas.dispatchEvent(delivered);
        if (mode==='frame') { await nextFrame(); await nextFrame(); }
        continue;
      }
      const interior=events.slice(20,-20);
      const probe=interior.reduce((best,event)=>event.pressure>best.pressure?event:best);
      const box=canvas.getBoundingClientRect();
      const x=Math.round((probe.clientX-box.left)*canvas.width/box.width);
      const y=Math.round((probe.clientY-box.top)*canvas.height/box.height);
      const painted=()=>canvas.getContext('2d')!.getImageData(x-2,y-2,5,5).data
        .some((value,index,rgba)=>index%4===0&&value>rgba[index+1]+12);
      if (painted()) throw Error('The next pressure preview probe already contains red paint.');
      const started=performance.now();
      canvas.dispatchEvent(delivered);
      for(let frame=0;frame<5;frame++){
        await nextFrame();
        if (painted()) {
          timings.push(performance.now()-started);
          break;
        }
      }
    }
    return timings;
  },{origin:toScreen(0,0),start,end,mode});
  const pixel=async(x:number,y:number)=>stage.evaluate((element,{x,y})=>{
    const canvas=element as HTMLCanvasElement, box=canvas.getBoundingClientRect();
    const px=Math.round((x-box.left)*canvas.width/box.width);
    const py=Math.round((y-box.top)*canvas.height/box.height);
    const sample=canvas.getContext('2d')!.getImageData(px-2,py-2,5,5).data;
    return Array.from({length:sample.length/4},(_,i)=>sample[i*4+1]).reduce((a,b)=>Math.min(a,b),255);
  },toScreen(x,y));
  return {pen,down,up,append,pixel,toScreen};
}

test('long firm pen Brush stays visible through queued restart and saves compact editable paint', async ({ page }) => {
  await page.setViewportSize({width:1800,height:950});
  const project=newProject();
  project.width=4400;
  project.height=500;
  project.layers[0].drawingMode='merge';
  await holdGeometry(page);
  await page.addInitScript(project=>{
    localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
    localStorage.setItem('splash-editor-preferences-v1',JSON.stringify({brushResponse:2}));
  },project);
  await page.goto('/');
  await dismissBrushStartup(page);
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.25');
  await page.getByRole('button',{name:'Brush',exact:true}).click();
  await page.getByLabel('Drawing fill',{exact:true}).fill('#552211');
  const stage=page.getByLabel('Drawing stage');
  const {pen,down,up,append,pixel,toScreen}=await firmPenInput(page,stage,project);
  const saved=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const probe={x:1600,y:150+40*Math.sin(1600/54)};
  expect(await pixel(probe.x,probe.y)).toBe(255);
  await down(0,150,.55);
  await append(1,4498);
  await expect.poll(()=>pixel(probe.x,probe.y)).toBeLessThan(180);
  await up(4499*.9,150+40*Math.sin(4499/60));
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  expect(await saved()).toEqual([]);
  expect(await pixel(probe.x,probe.y)).toBeLessThan(180);
  await expect(stage).toHaveAttribute('data-firm-samples',/"count":4500.*"response":2/);
  const request=JSON.parse((await stage.getAttribute('data-firm-samples'))!);
  expect(request.initial).toBeCloseTo(.55,6);
  expect(request.later).toBeCloseTo(.25+.3*(1+Math.sin(1)),6);

  // A separate gesture may finish while the first release is held.
  await down(525,365,.8);
  await pen.send('Input.dispatchMouseEvent',{type:'mouseMoved',...toScreen(780,365),
    button:'left',buttons:1,pointerType:'pen',force:.8});
  await expect.poll(()=>pixel(700,365)).toBeLessThan(180);
  await up(780,365);
  expect(await pendingGeometry(page)).toBe(1);

  // Cancel a third gesture without dropping either queued release.
  await down(525,430,.8);
  await pen.send('Input.dispatchMouseEvent',{type:'mouseMoved',...toScreen(780,430),
    button:'left',buttons:1,pointerType:'pen',force:.8});
  await expect.poll(()=>pixel(700,430)).toBeLessThan(180);
  await page.keyboard.press('Escape');
  await up(780,430);
  await expect.poll(()=>pixel(700,430)).toBe(255);
  expect(await pixel(700,365)).toBeLessThan(180);

  await releaseGeometry(page);
  await expect.poll(()=>pendingGeometry(page)).toBe(1);
  const first=await saved();
  expect(first).toHaveLength(1);
  expect(first[0].contours).toHaveLength(2);
  expect(first[0].contours!.flat().length).toBeLessThan(500);
  const [main,lobe]=first[0].contours!;
  expect(main.some(node=>node.in&&node.out)).toBe(true);
  expect(lobe).toHaveLength(3);
  expect(main[0]).toEqual(lobe[0]);
  expect(await pixel(probe.x,probe.y)).toBeLessThan(180);
  await releaseGeometry(page);
  await expect.poll(async()=>(await saved()).length).toBe(2);
  const second=await saved();
  expect(second[0]).toEqual(first[0]);
  expect(await pixel(700,365)).toBeLessThan(180);
  expect(await pixel(700,430)).toBe(255);
  await stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(saved).toEqual(first);
  await page.keyboard.press('Control+z');
  await expect.poll(saved).toEqual([]);
  await expect.poll(()=>pixel(probe.x,probe.y)).toBe(255);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(saved).toEqual(first);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(saved).toEqual(second);
  await pen.detach();
});

for (const scope of ['scene sparse','scene mixed','symbol mixed'] as const) {
  test(`firm pen preview reaches each delivery window in ${scope}`,async({page})=>{
    await page.setViewportSize({width:1800,height:950});
    const project=newProject();
    project.width=4400;
    project.height=500;
    const symbol=scope==='symbol mixed';
    const layer=project.layers[0];
    layer.drawingMode='merge';
    const artwork:Vector[]=Array.from({length:scope==='scene sparse'?2:768},(_,i)=>{
      const shape:Vector={kind:'rectangle',id:'under-'+i,x:40+i%24*175,y:255+Math.floor(i/24)*7,
        width:80,height:5,rotation:0,fill:'#2780a4',stroke:'#636087',strokeWidth:0,points:[],drawingMode:'merge'};
      if (i%3===1) return {...shape,kind:'ellipse',fill:'#b1a621'};
      if (i%3===2) return {...shape,kind:'path',fillEnabled:false,strokeWidth:2,points:[{x:0,y:0},{x:80,y:4}]};
      return shape;
    });
    if (symbol) {
      const definition:SymbolDefinition={ id:'firm-symbol',name:'Firm trace',width:project.width,height:project.height,shapes:artwork };
      project.symbols=[definition];
      layer.drawingMode='object';
      layer.keys[0].shapes=[symbolInstance(definition,0,0)];
    } else layer.keys[0].shapes=artwork;
    validateProject(project);
    await page.addInitScript(project=>{
      localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
      localStorage.setItem('splash-editor-preferences-v1',JSON.stringify({brushResponse:2}));
    },project);
    await page.goto('/');
    await dismissBrushStartup(page);
    await page.getByRole('button',{name:'Recover changes',exact:true}).click();
    await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.25');
    const stage=page.getByLabel('Drawing stage');
    if (symbol) {
      const view=(await stage.boundingBox())!;
      await page.mouse.dblclick(view.x+(view.width-project.width/4)/2+80/4,
        view.y+(view.height-project.height/4)/2+257/4);
      await expect(page.getByRole('main',{name:'Symbol editing workspace',exact:true})).toBeVisible();
    }
    await page.getByRole('button',{name:'Brush',exact:true}).click();
    await page.getByLabel('Drawing fill',{exact:true}).fill('#552211');
    const {pen,down,up,append,pixel}=await firmPenInput(page,stage,project);
    await down(0,150,.55);
    const early=await append(1,900,'measure');
    await append(901,3598,'frame');
    const late=await append(3599,4498,'measure');
    expect(early).toHaveLength(5);
    expect(late).toHaveLength(5);
    console.log(scope,'preview frame ms',
      [...early,...late].map(value=>Math.round(value*10)/10));
    await up(4499*.9,150+40*Math.sin(4499/60));
    await expect(stage).toHaveAttribute('data-firm-samples',/"count":4500.*"response":2/);
    const probeX=1600, probeY=150+40*Math.sin(probeX/54);
    expect(await pixel(probeX,probeY)).toBeLessThan(180);
    const read=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project));
    if(symbol) {
      const save=page.getByRole('button',{name:'Save and return to scene',exact:true});
      expect((await read()).symbols![0].shapes).toEqual(artwork);
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByRole('main',{name:'Symbol editing workspace',exact:true})).toHaveCount(0);
    }
    const savedArt=async()=>{const saved=await read();return symbol?saved.symbols![0].shapes:saved.layers[0].keys[0].shapes;};
    await expect.poll(async()=>(await savedArt()).filter(shape=>shape.fill==='#552211').length).toBe(1);
    const saved=await savedArt(), [stroke]=saved.filter(shape=>shape.fill==='#552211');
    expect(saved.filter(shape=>shape.fill!=='#552211')).toEqual(artwork);
    expect(stroke.contours?.flat().length).toBeLessThan(500);
    expect(stroke.contours?.[1]).toHaveLength(3);
    if (symbol) expect((await read()).layers).toEqual(project.layers);
    await pen.detach();
  });
}
