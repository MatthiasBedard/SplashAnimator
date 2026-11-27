import { test, expect } from '@playwright/test';
import { newProject, validateProject, type Vector, type Project, type SymbolDefinition } from '../../packages/document/src';
import { hit, worldPoint } from '../../packages/geometry/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { brushInsert, compoundDividerFixture, compoundPaint, ovalInserts } from '../compound-divider-fixture';
import { recoloredBrushFixture } from '../recolored-brush-fixture';

for (const [boundary, isolated] of [['matching curve', false], ['different paint', false],
  ['matching paint with Pencil divider', false], ['matching curve', true]] as const)
test(`Bucket filling an empty enclosure respects ${boundary}${isolated ? ' in an isolated symbol' : ''}`, async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  const layer = project.layers[0];
  layer.drawingMode = 'merge';
  const existing: Vector = {
    id: 'paint', kind: 'polygon', x: 50, y: 75, width: 100, height: 100, rotation: 0,
    fill: boundary === 'different paint' ? '#ff4400' : '#0088ff', fillRule: 'evenodd',
    stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge',
    contours: [[{x:0,y:0, in:{x:8,y:25}}, {x:100,y:0, ...(boundary === 'matching curve' ? {out:{x:116,y:25}} : {})},
      {x:100,y:100, ...(boundary === 'matching curve' ? {in:{x:116,y:75}} : {})}, {x:0,y:100, out:{x:8,y:75}}]],
  };
  const edge: Vector = {
    id: 'enclosure', kind: 'path', x:150, y:75, width:100, height:100, rotation:0,
    points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],
    stroke:'#222222', strokeWidth:2, fill:'#000000', fillEnabled:false, drawingMode:'merge',
  };
  const divider: Vector = {...edge, id:'divider', kind:'line', width:0, points:[{x:0,y:0},{x:0,y:100}]};
  const original = boundary === 'matching paint with Pencil divider' ? [existing,edge,divider] : [existing,edge];
  if (isolated) project.symbols = [{id:'enclosed', name:'Enclosed paint', width:300, height:220, shapes:original}];
  else layer.keys[0].shapes = original;
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project:p, folder:null, manifest:null })), project);
  await page.goto('/');
  await page.getByRole('button', {name:'Recover changes', exact:true}).click();
  const canvas = page.getByLabel('Drawing stage', {exact:true});
  if (isolated) {
    await page.getByRole('option', {name:'Library item Enclosed paint', exact:true}).dblclick();
    await page.getByRole('button', {name:'Advanced symbol timeline tools…', exact:true}).click();
    await page.getByLabel('Symbol canvas tool', {exact:true}).selectOption('bucket');
    await page.getByLabel('New symbol drawing fill', {exact:true}).fill('#0088ff');
    const preview = page.getByLabel('Symbol artwork preview', {exact:true});
    const target = await preview.evaluate((node:HTMLCanvasElement) => {
      const {data} = node.getContext('2d')!.getImageData(0,0,node.width,node.height);
      let left = node.width, right = 0, top = node.height, bottom = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] || data[i+1] !== 136 || data[i+2] !== 255 || data[i+3] !== 255) continue;
        const x = (i/4)%node.width, y = Math.floor(i/4/node.width);
        left = Math.min(left,x); right = Math.max(right,x);
        top = Math.min(top,y); bottom = Math.max(bottom,y);
      }
      if (right <= left || bottom <= top) throw Error('Expected the neighboring blue fill.');
      const box = node.getBoundingClientRect();
      return {x:box.x+(right+(right-left)*0.32)*box.width/node.width,
        y:box.y+(top+bottom)*box.height/(2*node.height)};
    });
    await page.mouse.click(target.x,target.y);
    await expect(page.getByRole('button', {name:'Undo artwork change', exact:true})).toBeEnabled();
    await page.getByRole('button', {name:'Save and return to scene', exact:true}).click();
  } else {
    await page.getByRole('combobox', {name:'Zoom', exact:true}).selectOption('1');
    await page.getByRole('button', {name:'Paint bucket', exact:true}).click();
    await page.getByLabel('Drawing fill', {exact:true}).fill('#0088ff');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x+(box.width-400)/2+200,box.y+(box.height-300)/2+125);
  }
  const read = () => page.evaluate(inSymbol => {
    const p = JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project;
    return inSymbol ? p.symbols![0].shapes : p.layers[0].keys[0].shapes;
  }, isolated);
  const owners = (art:Vector[], x:number) => art.filter(s => s.fillEnabled !== false && hit(s,{x,y:125},0));
  await expect.poll(async () => owners(await read(),200).map(s => s.fill)).toEqual(['#0088ff']);
  const filled = await read();
  expect(filled.filter(s => s.fillEnabled === false)).toEqual(original.slice(1));
  if (boundary === 'matching curve') {
    const [joined] = owners(filled, 200);
    expect(owners(filled,100)).toEqual([joined]);
    expect(joined.contours).toHaveLength(1);
    expect(filled.filter(s => s.fillEnabled !== false)).toHaveLength(1);
    const handlePoints = joined.contours![0].flatMap(node => [node.in, node.out].flatMap(p => p ? [worldPoint(joined,p)] : []));
    expect(handlePoints).toHaveLength(2);
    expect(handlePoints).toEqual(expect.arrayContaining([{x:58,y:100},{x:58,y:150}]));
  } else {
    expect(owners(filled,100)).toEqual([existing]);
    expect(owners(filled,200)[0].id).not.toBe(existing.id);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(original);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(filled);
});

for (const action of ['Line release', 'Pencil release', 'Moved line deselection'] as const)
test(`${action} cuts both curved fills into editable halves`, async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  const layer = project.layers[0];
  layer.drawingMode = 'merge';
  const ellipse: Vector = { id: 'blue', kind: 'ellipse', x: 60, y: 75, width: 100, height: 140,
    rotation: 0, fill: '#0088ff', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge' };
  layer.keys[0].shapes = [ellipse, { ...ellipse, id: 'red', x: 215, rotation: 9, fill: '#dd2222' }];
  if (action === 'Moved line deselection') layer.keys[0].shapes.push({ ...ellipse, id: 'ink', kind: 'path',
    x: 30, y: 25, width: 320, height: 12, points: [{ x: 0, y: 0 }, { x: 320, y: 12 }], fillEnabled: false, strokeWidth: 3 });
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1', JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: action === 'Moved line deselection' ? 'Selection' : action.split(' ')[0], exact: true }).click();
  const canvas = page.getByLabel('Drawing stage');
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => [box.x + (box.width - 400) / 2 + x, box.y + (box.height - 300) / 2 + y] as const;
  const read = () => page.evaluate(() => (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const moved = action === 'Moved line deselection';
  await page.mouse.move(...(moved ? at(110, 28) : at(30, 125)));
  await page.mouse.down();
  await page.mouse.move(...(moved ? at(110, 128) : at(350, 137)), { steps: 12 });
  await page.mouse.up();
  if (moved) await page.mouse.click(...at(355, 250));
  await expect.poll(async () => (await read()).filter(s => s.fillEnabled !== false).length).toBe(4);
  const cut = await read();
  for (const color of ['#0088ff', '#dd2222']) {
    const halves = cut.filter(s => s.fillEnabled !== false && s.fill === color);
    expect(halves).toHaveLength(2);
    expect(halves.flatMap(s => s.contours![0]).filter(n => n.in || n.out)).toHaveLength(8);
  }
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(...at(110, 100));
  await canvas.press('Delete');
  const pixels = () => canvas.evaluate(node => {
    const c = node as HTMLCanvasElement, ctx = c.getContext('2d')!;
    return [[110, 100], [110, 180], [245, 110]].map(([x, y]) =>
      [...ctx.getImageData((c.width - 400) / 2 + x, (c.height - 300) / 2 + y, 1, 1).data]);
  });
  await expect.poll(pixels).toEqual([[255,255,255,255], [0,136,255,255], [221,34,34,255]]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
});

test('Brush crossing is saved with a shared cubic before Bucket recolors it', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 300;
  p.layers[0].drawingMode = 'merge';
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('30');
  await page.getByLabel('Brush simplify amount', { exact: true }).fill('100');
  await page.getByRole('checkbox', { name: 'Brush optimize', exact: true }).check();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const at = ([x, y]: [number, number]) => [box.x + (box.width - p.width) / 2 + x,
    box.y + (box.height - p.height) / 2 + y] as const;
  const fill = page.getByLabel('Drawing fill', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const artwork = async () => (await read()).layers[0].keys[0].shapes;
  const draw = async (color: string, start: [number, number], moves: [number, number][]) => {
    await fill.fill(color);
    await page.mouse.move(...at(start));
    await page.mouse.down();
    for (const point of moves) await page.mouse.move(...at(point));
    await page.mouse.up();
    await expect.poll(async () => (await artwork()).some(shape => shape.fill === color)).toBe(true);
  };
  const blue = '#0088ff', red = '#ff0000';
  await draw(blue, [221, 87], [[210, 126], [232, 171], [217, 222]]);
  await draw(red, [150, 135], [[184, 145], [216, 168], [255, 162], [290, 156]]);
  const cut = await read();
  const vectorEdges = (s: Vector, backwards = false) => s.contours!.flatMap(ring =>
    ring.flatMap((a, i) => {
      const b = ring[(i + 1) % ring.length];
      if (!a.out && !b.in) return [];
      const points = [a, a.out ?? a, b.in ?? b, b].map(p => worldPoint(s, p));
      return [JSON.stringify(backwards ? points.reverse() : points)];
    }));
  const faces = await artwork();
  const upper = faces.find(shape => shape.fill === red)!;
  const pieces = faces.filter(shape => shape.fill === blue);
  expect(pieces).toHaveLength(2);
  for (const piece of pieces)
    expect(vectorEdges(upper).some(edge => vectorEdges(piece, true).includes(edge))).toBe(true);
  // Selecting and deleting the upper blue lobe must leave the lower one at
  // its drawn position. Probe the real canvas as well as recovered vectors.
  const pixels = () => canvas.evaluate((node, doc) => {
    const c = node as HTMLCanvasElement, ctx = c.getContext('2d')!;
    return [[221, 95], [217, 211], [275, 156]].map(([x, y]) =>
      [...ctx.getImageData(x + (c.width - doc.width) / 2, y + (c.height - doc.height) / 2, 1, 1).data]);
  }, { width: p.width, height: p.height });
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(...at([221, 95]));
  await canvas.press('Delete');
  await expect.poll(pixels).toEqual([[255, 255, 255, 255], [0, 136, 255, 255], [255, 0, 0, 255]]);
  expect((await artwork()).map(s => s.id)).toEqual(faces.filter(s => !hit(s, { x: 221, y: 95 }, 0)).map(s => s.id));
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  await fill.fill(blue);
  await page.mouse.click(...at([275, 156]));
  await expect.poll(async () => (await artwork()).map(shape => shape.fill)).toEqual([blue]);
  const after = await read();
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(cut);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(after);
});

for (const tool of ['Brush', 'Rectangle'] as const)
test(`a ${tool} through-cut leaves separately selectable faces with handles around the picked paint`, async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => [box.x + (box.width - 400) / 2 + x, box.y + (box.height - 300) / 2 + y] as const;
  const draw = async (points: [number, number][]) => {
    await page.mouse.move(...at(...points[0]));
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...at(...p), { steps: 4 });
    await page.mouse.up();
  };
  const read = () => page.evaluate(() => (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const fills = async () => (await read()).filter(s => s.fillEnabled !== false);
  const color = page.getByLabel('Drawing fill', { exact: true });
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await color.fill('#0088ff');
  await draw([[105, 60], [235, 240]]);
  await expect.poll(async () => (await fills()).length).toBe(1);
  await page.getByRole('button', { name: tool, exact: true }).click();
  if (tool === 'Brush') await page.getByLabel('Brush size', { exact: true }).fill('24');
  await color.fill('#ff0000');
  await draw(tool === 'Brush' ? [[75, 145], [122, 137], [183, 153], [265, 149]] : [[75, 136], [265, 160]]);
  await expect.poll(async () => (await fills()).filter(s => s.fill === '#0088ff').length).toBe(2);
  const before = await read();
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.click(...at(150, 95));
  await expect.poll(() => canvas.evaluate((node) => {
    const c = node as HTMLCanvasElement, ctx = c.getContext('2d')!;
    const pixels = ctx.getImageData((c.width - 400) / 2 + 100, (c.height - 300) / 2 + 55, 10, 10).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] > 95 && pixels[i] < 180 && pixels[i+1] < 170 && pixels[i+2] > 225) return true;
    return false;
  })).toBe(true);
  await canvas.press('Delete');
  await expect.poll(async () => (await fills()).filter(s => s.fill === '#0088ff').length).toBe(1);
  const [lower] = (await fills()).filter(s => s.fill === '#0088ff');
  expect(hit(lower, { x: 150, y: 95 }, 0)).toBe(false);
  expect(hit(lower, { x: 150, y: 210 }, 0)).toBe(true);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
  // A second pass now crosses three existing paint faces. All four blue
  // quadrants must remain independent, including the ones below the first cut.
  await page.getByRole('button', { name: tool, exact: true }).click();
  await color.fill('#00aa44');
  await draw(tool === 'Brush' ? [[174, 40], [168, 116], [181, 178], [175, 260]] : [[168, 40], [185, 260]]);
  await expect.poll(async () => (await fills()).filter(s => s.fill === '#0088ff').length).toBe(4);
  const quadrants = (await fills()).filter(s => s.fill === '#0088ff');
  const picks = [[135, 90], [210, 90], [135, 210], [210, 210]].map(([x, y]) =>
    quadrants.filter(s => hit(s, { x, y }, 0)).map(s => s.id));
  expect(picks.every(ids => ids.length === 1)).toBe(true);
  expect(new Set(picks.flat()).size).toBe(4);
  if (tool === 'Brush') {
    const painted = await fills();
    const green = painted.find(s => s.fill === '#00aa44')!;
    const cubicKeys = (s: Vector, reverse: boolean) => s.contours!.flatMap(r => r.flatMap((a, i) => {
      const b = r[(i + 1) % r.length];
      if (!a.out && !b.in) return [];
      const points = [a, a.out ?? a, b.in ?? b, b].map(p => worldPoint(s, p));
      return [JSON.stringify(reverse ? points.reverse() : points)];
    }));
    const seams = new Set(cubicKeys(green, false));
    for (const face of painted.filter(s => s !== green))
      expect(cubicKeys(face, true).some(key => seams.has(key)), 'saved common curve on ' + face.fill).toBe(true);
    const separated = await read();
    const tip = () => canvas.evaluate((node) => {
      const c = node as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData((c.width - 400) / 2 + 175, (c.height - 300) / 2 + 250, 1, 1).data];
    });
    await expect.poll(tip).toEqual([0, 170, 68, 255]);
    await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
    await color.fill('#ff0000');
    await page.mouse.click(...at(175, 250));
    await expect.poll(async () => (await fills()).map(s => s.fill).sort()).toEqual([
      '#0088ff', '#0088ff', '#0088ff', '#0088ff', '#ff0000',
    ]);
    await expect.poll(tip).toEqual([255, 0, 0, 255]);
    const joined = await read();
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(separated);
    await canvas.press('Control+Shift+z');
    await expect.poll(read).toEqual(joined);
  }
});

for (const [recolor, resizeFirst] of [['inner', true], ['outer', false]] as const)
test(`the first Bucket click recolors the ${recolor} outlined square while the move is settling`, async ({ page }) => {
  const p = newProject();
  p.width = 500;
  p.height = 300;
  p.layers[0].drawingMode = 'merge';
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
    const NativeWorker = window.Worker;
    const pending: (() => void)[] = [];
    const drop = { hold: false, pending: () => pending.length, release: () => pending.splice(0).forEach(send => send()) };
    Object.assign(window, { squareDrop: drop });
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const send = () => Array.isArray(transfer) ? super.postMessage(message, transfer) : super.postMessage(message, transfer);
        if (drop.hold && (message as { editedPieces?: string[] }).editedPieces) pending.push(send);
        else send();
      }
    };
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + (box.width - p.width) / 2 + x, y: box.y + (box.height - p.height) / 2 + y });
  const drag = async (from: [number, number], to: [number, number]) => {
    const start = at(...from), end = at(...to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const artwork = async () => (await read()).layers[0].keys[0].shapes;
  const fills = async () => (await artwork()).filter(s => s.fillEnabled !== false);
  const red = '#ff0000', blue = '#0088ff';
  const targetColor = recolor === 'inner' ? blue : red;
  const fill = page.getByLabel('Drawing fill', { exact: true });
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(page.getByLabel('Drawing stroke width', { exact: true })).toHaveValue('2');
  await fill.fill(blue);
  await drag([260, 50], [460, 250]);
  await expect.poll(async () => (await fills()).map(s => s.fill)).toEqual([blue]);
  await fill.fill(red);
  await drag(resizeFirst ? [40, 50] : [100, 110], resizeFirst ? [240, 250] : [180, 190]);
  await expect.poll(async () => (await fills()).map(s => s.fill)).toContain(red);
  await fill.fill(targetColor);
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await drag([30, 40], [250, 260]);
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  if (resizeFirst) {
    await page.getByLabel('Transform scale X', { exact: true }).fill('42.3');
    await page.getByLabel('Transform scale Y', { exact: true }).fill('42.3');
    await page.getByRole('button', { name: 'Apply transform', exact: true }).click();
    await expect.poll(async () => (await fills()).some(s => s.fill === red && hit(s, { x: 140, y: 150 }, 0) &&
      !hit(s, { x: 75, y: 150 }, 0))).toBe(true);
    await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  }
  await drag([144, 144], [354, 144]);
  await expect.poll(async () => (await fills()).some(s => s.fill === red && hit(s, { x: 355, y: 150 }, 0))).toBe(true);
  const drop = (action?: 'hold' | 'release') => page.evaluate(action => {
    const fixture = (window as unknown as { squareDrop: { hold: boolean; pending: () => number; release: () => void } }).squareDrop;
    if (action === 'hold') fixture.hold = true;
    if (action === 'release') fixture.release();
    return fixture.pending();
  }, action);
  const before = await read();
  await drop('hold');
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  await expect.poll(() => drop()).toBe(1);
  const pick = recolor === 'inner' ? at(355, 150) : at(280, 75);
  await page.mouse.click(pick.x, pick.y);
  expect(await read()).toEqual(before);
  await drop('release');
  await expect.poll(async () => (await fills()).map(s => s.fill)).toEqual([targetColor]);
  const [joined] = await fills();
  expect(joined.contours).toHaveLength(1);
  const world = joined.contours![0].map(node => worldPoint(joined, node));
  expect(world).toHaveLength(4);
  for (const [x, y] of [[260, 50], [460, 50], [460, 250], [260, 250]])
    expect(world.some(p => Math.hypot(p.x - x, p.y - y) < 1e-9)).toBe(true);
  expect((await artwork()).filter(s => s.fillEnabled === false)).toHaveLength(2);
  const after = await read();
  await canvas.press('Control+z');
  await expect.poll(async () => (await fills()).map(s => s.fill)).toEqual([blue, red]);
  expect((await artwork()).filter(s => s.fillEnabled === false)).toEqual(after.layers[0].keys[0].shapes.filter(s => s.fillEnabled === false));
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(after);
});

test('matching the fill of a moved square inside another square joins it while selected', async ({ page }) => {
  const p = newProject();
  p.width = 500;
  p.height = 300;
  const square = (id: string, x: number, y: number, size: number, fill: string): Vector => ({
    id, kind: 'rectangle', x, y, width: size, height: size, rotation: 0, points: [],
    drawingMode: 'merge', fill, stroke: '#000000', strokeWidth: 0,
  });
  p.layers[0].drawingMode = 'merge';
  const underlay = square('underlay', 200, 75, 40, '#8844ff');
  p.layers[0].keys[0].shapes = [
    underlay,
    square('outer', 215, 55, 200, '#0088ff'),
    square('inner', 55, 115, 80, '#ff0000'),
  ];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const x = box.x + (box.width - p.width) / 2, y = box.y + (box.height - p.height) / 2;
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const art = async () => (await read()).layers[0].keys[0].shapes;
  await page.getByRole('button', { name: 'Selection', exact: true }).click();
  await page.mouse.move(x + 95, y + 155);
  await page.mouse.down();
  await page.mouse.move(x + 310, y + 155, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await art()).filter(s => s.fill === '#ff0000')
    .some(s => hit(s, { x: 310, y: 155 }, 0))).toBe(true);
  const before = await read();
  await page.getByLabel('Selected fill', { exact: true }).fill('#0088ff');
  await expect.poll(async () => (await art()).map(s => s.fill)).toEqual([underlay.fill, '#0088ff']);
  const [unchanged, joined] = await art();
  expect(unchanged).toEqual(underlay);
  expect([joined.x, joined.y, joined.width, joined.height]).toEqual([215, 55, 200, 200]);
  await expect(page.getByLabel('Selected fill', { exact: true })).toBeVisible();
  const after = await read();
  await canvas.press('Escape');
  await expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  expect(await read()).toEqual(after);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(after);
});

for (const outer of [false, true])
  for (const outline of [0, 2])
    test(`matching the ${outer ? 'outer' : 'inner'} drawn square merges its fill with a nested square (stroke ${outline})`, async ({ page }) => {
      const p = newProject();
      p.width = 400;
      p.height = 300;
      p.layers[0].drawingMode = 'merge';
      await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null })), p);
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
      const canvas = page.getByLabel('Drawing stage', { exact: true });
      const box = (await canvas.boundingBox())!;
      const point = (x: number, y: number) => ({ x: box.x + (box.width - p.width) / 2 + x,
        y: box.y + (box.height - p.height) / 2 + y });
      const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
      const art = async () => (await read()).layers[0].keys[0].shapes;
      const fill = page.getByLabel('Drawing fill', { exact: true });
      const red = '#ff0000', blue = '#0088ff';
      await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
      await page.getByLabel('Drawing stroke width', { exact: true }).fill(String(outline));
      for (const [color, start, end] of [[blue, point(80, 55), point(280, 255)],
        [red, point(140, 115), point(220, 195)]] as const) {
        await fill.fill(color);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 8 });
        await page.mouse.up();
        await expect.poll(async () => (await art()).some(s => s.fillEnabled !== false && s.fill === color)).toBe(true);
      }
      const before = await read(), previous = await art();
      expect(previous.filter(s => s.fillEnabled !== false)).toHaveLength(2);
      await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
      await fill.fill(outer ? red : blue);
      const pick = outer ? point(100, 75) : point(180, 155);
      await page.mouse.click(pick.x, pick.y);
      const paint = async () => (await art()).filter(s => s.fillEnabled !== false);
      await expect.poll(async () => (await paint()).map(s => s.fill)).toEqual([outer ? red : blue]);
      const [joined] = await paint();
      expect(joined.contours).toHaveLength(1);
      expect([joined.x, joined.y, joined.width, joined.height]).toEqual([80, 55, 200, 200]);
      expect((await art()).filter(s => s.fillEnabled === false)).toEqual(previous.filter(s => s.fillEnabled === false));
      const after = await read();
      await canvas.press('Control+z');
      await expect.poll(read).toEqual(before);
      await canvas.press('Control+Shift+z');
      await expect.poll(read).toEqual(after);
    });

for (const tool of ['Bucket', 'Properties'])
test(`${tool} merges two touching strokes drawn with the Brush after recoloring the first stroke`, async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 280;
  project.layers[0].drawingMode = 'merge';
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('28');
  const fill = page.getByLabel('Drawing fill', { exact: true });
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width / 2 + x - 200,
    y: box.y + box.height / 2 + y - 140 });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const artwork = async () => (await read()).layers[0].keys[0].shapes;
  for (const [color, start, end] of [
    ['#ff0000', at(93, 130), at(269, 130)],
    ['#0088ff', at(266, 80), at(272, 120)],
  ] as const) {
    await fill.fill(color);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 14 });
    await page.mouse.up();
    await expect.poll(async () => (await artwork()).some(shape => shape.fill === color)).toBe(true);
  }
  const before = await read();
  expect(await artwork()).toHaveLength(2);
  await page.getByRole('button', { name: tool === 'Bucket' ? 'Paint bucket' : 'Selection', exact: true }).click();
  const first = at(112, 130);
  await page.mouse.click(first.x, first.y);
  if (tool === 'Properties') await page.getByLabel('Selected fill', { exact: true }).fill('#0088ff');
  await expect.poll(async () => (await artwork()).every(shape => shape.fill === '#0088ff')).toBe(true);
  await expect.poll(async () => (await artwork()).length).toBe(1);
  const [joined] = await artwork();
  expect(hit(joined, { x: 112, y: 130 }, 0)).toBe(true);
  expect(hit(joined, { x: 267, y: 90 }, 0)).toBe(true);
  const merged = await read();
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(before);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(merged);
});

for (const alreadyMatching of [false, true])
test(`Bucket joins a real Brush cut ${alreadyMatching ? 'when the fills already match' : 'after recoloring'}`, async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.layers[0].drawingMode = 'merge';
  const { shapes, color, foreground } = recoloredBrushFixture();
  if (alreadyMatching) foreground.fill = color;
  p.layers[0].keys[0].shapes = shapes;
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill(color);
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2 + 15);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const art = async () => (await read()).layers[0].keys[0].shapes;
  await expect.poll(async () => (await art()).map(shape => shape.id)).toEqual([foreground.id]);
  const [joined] = await art();
  expect(joined.fill).toBe(color);
  expect(joined.contours).toHaveLength(1);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
  await canvas.press('Control+Shift+z');
  await expect.poll(art).toEqual([joined]);
});

const outlinedFill: Vector = {
  id: 'fill', kind: 'rectangle', x: 100, y: 80, width: 100, height: 80, rotation: 0,
  fill: '#ff0000', stroke: '#000000', strokeWidth: 2, points: [],
};

for (const via of ['Bucket', 'Properties']) {
  test(`${via} joins newly matching fills along a shared edge`, async ({ page }) => {
    const p = newProject();
    p.width = 400;
    p.height = 280;
    p.layers[0].drawingMode = 'merge';
    const left = { ...outlinedFill, strokeWidth: 0, kind: 'polygon' as const, closed: true, fillRule: 'evenodd' as const,
      contours: [[{ x: 0, y: 0, out: { x: 22, y: -18 } }, { x: 100, y: 0, in: { x: 78, y: -18 } },
        { x: 100, y: 80 }, { x: 0, y: 80 }]] };
    const right = { ...outlinedFill, id: 'right', x: 200, fill: '#00ff00', strokeWidth: 0 };
    p.layers[0].keys[0].shapes = [left, right];
    await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
      JSON.stringify({ project, folder: null, manifest: null })), p);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: via === 'Bucket' ? 'Paint bucket' : 'Selection', exact: true }).click();
    if (via === 'Bucket') await page.getByLabel('Drawing fill', { exact: true }).fill(right.fill);
    const canvas = page.getByLabel('Drawing stage', { exact: true });
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 - 80, box.y + box.height / 2 - 20);
    if (via === 'Properties') await page.getByLabel('Selected fill', { exact: true }).fill(right.fill);
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
    const art = async () => (await read()).layers[0].keys[0].shapes;
    await expect.poll(async () => (await art()).map(s => s.id)).toEqual([left.id]);
    const [joined] = await art();
    expect(joined.fill).toBe(right.fill);
    expect(joined.contours).toHaveLength(1);
    expect(joined.contours![0].filter(node => node.in || node.out)).toHaveLength(2);
    expect(joined.width).toBe(200);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(p);
    await canvas.press('Control+Shift+z');
    await expect.poll(art).toEqual([joined]);
  });
}

test('Bucket recolors an intersecting curved fill without rebuilding either shape', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.layers[0].drawingMode = 'merge';
  const curve: Vector = {
    ...outlinedFill, kind: 'polygon', strokeWidth: 0, closed: true, fillRule: 'evenodd',
    contours: [
      [{ x: 0, y: 0, out: { x: 22, y: -18 } }, { x: 100, y: 0, in: { x: 78, y: -18 } },
        { x: 100, y: 80, out: { x: 72, y: 100 } }, { x: 0, y: 80, in: { x: 28, y: 100 } }],
      [{ x: 42, y: 27, out: { x: 62, y: 22 } }, { x: 62, y: 40, in: { x: 65, y: 30 } },
        { x: 43, y: 48, in: { x: 65, y: 49 } }],
    ],
    pivot: { x: 18, y: 37 },
  };
  const crossing: Vector = { ...outlinedFill, id: 'crossing', kind: 'ellipse', x: 165, y: 65,
    width: 95, height: 80, strokeWidth: 0, fill: '#00ff00' };
  p.layers[0].keys[0].shapes = [curve, crossing];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill(crossing.fill);
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 120 - 200, box.y + box.height / 2 + 120 - 140);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const expected = structuredClone(p);
  expected.layers[0].keys[0].shapes[0].fill = crossing.fill;
  await expect.poll(read).toEqual(expected);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(expected);
});

test('scene Bucket and Ink Bottle temporarily select with Control and restore distinct paint cursors', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [outlinedFill];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cursors = new Set<string>();
  for (const name of ['Paint bucket', 'Ink bottle']) {
    const tool = page.getByRole('button', { name, exact: true });
    await tool.click();
    await canvas.focus();
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width / 2 - 50, y = box.y + box.height / 2 - 20;
    await page.mouse.move(x, y);
    const idle = await canvas.evaluate(node => getComputedStyle(node).cursor);
    await page.keyboard.down('Control');
    await expect(canvas).toHaveCSS('cursor', 'default');
    await page.mouse.down();
    await page.mouse.move(x + 20, y + 10);
    await page.keyboard.up('Control');
    await expect(canvas).toHaveCSS('cursor', 'default');
    await page.mouse.up();
    await expect(canvas).toHaveCSS('cursor', idle);
    expect(idle).toMatch(/data:image\/svg\+xml/);
    cursors.add(idle);
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await read()).layers[0].keys[0].shapes)
      .toEqual([{ ...outlinedFill, x: 120, y: 90 }]);
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(p);
  }
  expect(cursors.size).toBe(2);
});

test('scene Eyedropper samples independent paint and hands it to Bucket or Ink Bottle', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  const saved = { ...outlinedFill, strokeWidth: 4 };
  const target = { ...outlinedFill, id: 'target', x: 240, fill: '#0000ff', stroke: '#ffaa00' };
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [saved, target];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const eyedropper = page.getByRole('button', { name: 'Eyedropper', exact: true });
  await eyedropper.click();
  const keepSampling = page.getByRole('checkbox', { name: 'Keep sampling', exact: true });
  await expect(keepSampling).not.toBeChecked();
  await keepSampling.check();
  const fill = page.getByLabel('Drawing fill', { exact: true });
  const stroke = page.getByLabel('Drawing stroke', { exact: true });
  const width = page.getByLabel('Drawing stroke width', { exact: true });
  await fill.fill('#00ff00');
  await stroke.fill('#0000ff');
  await width.fill('8');
  const b = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
  await expect(page.getByLabel('Drawing stage', { exact: true })).toHaveCSS('cursor', /data:image\/svg\+xml/);
  const pick = (x: number) => page.mouse.click(b.x + b.width / 2 + x - 200, b.y + b.height / 2 - 35);
  await pick(104);
  await expect(fill).toHaveValue('#ff0000');
  await expect(stroke).toHaveValue('#0000ff');
  await expect(width).toHaveValue('8');
  await expect(page.getByText('Sampled stored fill', { exact: true })).toBeVisible();
  await fill.fill('#00ff00');
  await pick(100);
  await expect(fill).toHaveValue('#00ff00');
  await expect(stroke).toHaveValue('#000000');
  await expect(width).toHaveValue('4');
  await expect(page.getByText('Sampled stored stroke', { exact: true })).toBeVisible();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const readArtwork = async () => (await read()).layers[0].keys[0].shapes;
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  expect(await read()).toEqual(p);
  await expect(eyedropper).toHaveAttribute('aria-pressed', 'true');
  await keepSampling.uncheck();
  await pick(104);
  await expect(page.getByRole('button', { name: 'Paint bucket', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await read()).toEqual(p);
  await pick(270);
  await expect.poll(readArtwork).toEqual([saved, { ...target, fill: saved.fill }]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
  await eyedropper.click();
  await pick(100);
  await expect(page.getByRole('button', { name: 'Ink bottle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await read()).toEqual(p);
  await pick(240);
  await expect.poll(readArtwork).toEqual([saved, { ...target, stroke: saved.stroke, strokeWidth: saved.strokeWidth }]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(p);
});

for (const scope of ['scene', 'symbol'] as const)
  test(`pen barrel samples paint without opening the ${scope} canvas menu`, async ({ page }) => {
    const project = newProject();
    project.width = 400;
    project.height = 300;
    const red: Vector = { id: 'red', kind: 'rectangle', x: 60, y: 45, width: 280, height: 210,
      rotation: 0, strokeWidth: 0, stroke: '#000000', fill: '#ff0000', points: [] };
    if (scope === 'scene') project.layers[0].keys[0].shapes = [red];
    else project.symbols = [{ id: 'barrel', name: 'Barrel ink', width: 400, height: 300, shapes: [red] }];
    await page.addInitScript(source => localStorage.setItem('splash-recovery-v1', JSON.stringify({
      project: source, folder: null, manifest: null,
    })), project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    if (scope === 'symbol') {
      await page.getByRole('option', { name: 'Library item Barrel ink', exact: true }).dblclick();
      await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
    }
    const brush = page.getByRole('button', { name: 'Brush', exact: true });
    const fill = page.getByLabel('Drawing fill', { exact: true });
    await brush.click();
    await fill.fill('#00ff00');
    const stage = page.getByLabel('Drawing stage', { exact: true });
    const box = (await stage.boundingBox())!;
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    const pixel = () => stage.evaluate((el: HTMLCanvasElement) => [...el.getContext('2d')!
      .getImageData(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1).data]);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await stage.focus();
    await stage.evaluate(el => el.addEventListener('contextmenu', event => {
      el.setAttribute('data-test-menu-pointer', (event as PointerEvent).pointerType);
    }, { once: true }));
    const pen = await page.context().newCDPSession(page);
    await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2,
      clickCount: 1, pointerType: 'pen', force: 0.4 });
    await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0,
      clickCount: 1, pointerType: 'pen' });
    await pen.detach();
    await expect(stage).toHaveAttribute('data-test-menu-pointer', 'pen');
    await expect(fill).toHaveValue('#ff0000');
    await expect(brush).toHaveAttribute('aria-pressed', 'true');
    const contextMenu = page.getByRole('menu', { name: 'Editing actions', exact: true });
    await expect(contextMenu).toHaveCount(0);
    await expect(stage).toBeFocused();
    expect(await pixel()).toEqual([255, 0, 0, 255]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project)).toEqual(project);
    await page.mouse.click(x, y, { button: 'right' });
    await expect(contextMenu).toBeVisible();
    await contextMenu.press('Escape');
    await stage.press('Shift+F10');
    await expect(contextMenu).toBeVisible();
  });

test('scene Bucket and Ink Bottle prefer actual paint before a nearby stroke tolerance hit', async ({ page }) => {
  const p = newProject();
  p.width = 400;
  p.height = 280;
  p.layers[0].drawingMode = 'object';
  const line: Vector = {
    id: 'line', kind: 'line', x: 120, y: 60, width: 0, height: 120, rotation: 0,
    fill: '#000000', fillEnabled: false, stroke: '#0000ff', strokeWidth: 2,
    points: [{ x: 0, y: 0 }, { x: 0, y: 120 }],
  };
  p.layers[0].keys[0].shapes = [outlinedFill, line];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const click = (x: number, y: number) =>
    page.mouse.click(box.x + box.width / 2 + x - 200, box.y + box.height / 2 + y - 140);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const readArtwork = async () => (await read()).layers[0].keys[0].shapes;
  const undo = async () => {
    await canvas.press('Control+z');
    await expect.poll(read).toEqual(p);
  };
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#00ff00');
  await click(123, 105);
  await expect.poll(readArtwork).toEqual([{ ...outlinedFill, fill: '#00ff00' }, line]);
  await undo();
  await click(103, 105);
  await expect.poll(readArtwork).toEqual([{ ...outlinedFill, fill: '#00ff00' }, line]);
  await undo();
  await page.getByRole('button', { name: 'Ink bottle', exact: true }).click();
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#ffaa00');
  await click(123, 105);
  await expect.poll(readArtwork).toEqual([{ ...outlinedFill, stroke: '#ffaa00' }, line]);
  await undo();
  await click(120, 105);
  await expect.poll(readArtwork).toEqual([outlinedFill, { ...line, stroke: '#ffaa00' }]);
  await undo();
});

test('isolated symbol deletion reunites matching paint on the removed divider',async ({page})=>{
  const project = newProject();
  const left: Vector = {...outlinedFill,drawingMode:'merge',strokeWidth:0};
  const right: Vector = {...left,id:'right',x:left.x+left.width};
  const ink: Vector = {...right,id:'divider',kind:'path',width:0,fillEnabled:false,strokeWidth:2,
    points:[{x:0,y:0},{x:0,y:left.height}]};
  project.symbols=[{id:'divided',name:'Divided paint',width:340,height:190,shapes:[left,right,ink]}];
  await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null})),project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('option',{name:'Library item Divided paint',exact:true}).dblclick();
  await page.getByRole('button',{name:'Advanced symbol timeline tools…',exact:true}).click();
  const items=page.getByLabel('Symbol artwork item',{exact:true});
  await items.selectOption('divider');
  await page.getByRole('button',{name:'Delete symbol artwork',exact:true}).click();
  await expect(items.locator('option')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo artwork change',exact:true}).click();
  await expect(items.locator('option')).toHaveCount(3);
  await page.getByRole('button',{name:'Redo artwork change',exact:true}).click();
  await page.getByRole('button',{name:'Save and return to scene',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect.poll(async ()=>(await read()).symbols![0].shapes.map(s=>s.width)).toEqual([left.width+right.width]);
  await page.getByLabel('Drawing stage',{exact:true}).press('Control+z');
  await expect.poll(read).toEqual(project);
});

for (const sharedEdge of [false, true])
test(`isolated symbol Bucket ${sharedEdge ? 'joins a matching fill across a shared edge' : 'recolors the original fill next to its outline'}`, async ({ page }) => {
  const p = newProject();
  const left: Vector = sharedEdge ? { ...outlinedFill, drawingMode: 'merge', strokeWidth: 0 } : outlinedFill;
  const right: Vector = { ...left, id: 'right', x: 200, fill: '#00ff00' };
  p.symbols = [{ id: 'outlined', name: 'Outlined paint', width: sharedEdge ? 340 : 240, height: 190,
    shapes: sharedEdge ? [left, right] : [left] }];
  await page.addInitScript(project => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('option', { name: 'Library item Outlined paint', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  const canvas = page.getByLabel('Symbol artwork preview', { exact: true });
  await page.getByLabel('Symbol canvas tool', { exact: true }).selectOption('bucket');
  await page.getByLabel('New symbol drawing fill', { exact: true }).fill('#00ff00');
  const target = await canvas.evaluate((node: HTMLCanvasElement) => {
    const { data } = node.getContext('2d')!.getImageData(0, 0, node.width, node.height);
    const bounds = node.getBoundingClientRect();
    let left = node.width, top = node.height, bottom = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] || data[i + 2] || data[i + 3] !== 255) continue;
      left = Math.min(left, (i / 4) % node.width);
      top = Math.min(top, Math.floor(i / 4 / node.width));
      bottom = Math.max(bottom, Math.floor(i / 4 / node.width));
    }
    if (top >= bottom) throw Error('Expected the painted rectangle.');
    return {
      x: bounds.x + (left + 0.5) * bounds.width / node.width,
      y: bounds.y + (top + bottom) * bounds.height / (2 * node.height),
    };
  });
  await page.mouse.click(target.x, target.y);
  await expect(page.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const art = async () => (await read()).symbols![0].shapes;
  if (sharedEdge) {
    await expect.poll(async () => (await art()).map(shape => shape.id)).toEqual([left.id]);
    const [joined] = await art();
    expect(joined).toMatchObject({ fill: right.fill, width: 200, kind: 'polygon' });
  } else await expect.poll(art).toEqual([{ ...left, fill: '#00ff00' }]);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(read).toEqual(p);
});

for (const mode of ['object', 'merge'])
  for (const dense of [false, true])
    test(`bucket closes bounded gaps without changing outline paint in ${mode} layers (dense: ${dense})`, async ({
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
      await page.getByLabel('Drawing mode').selectOption(mode);
      await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
      await page.getByRole('button', { name: 'Line', exact: true }).click();
      const lines = [
        [300, 180, 500, 180],
        [500, 180, 500, 340],
        [500, 340, 300, 340],
        [300, 340, 300, 188],
      ];
      for (const [x, y, u, v] of lines) {
        const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
        await page.mouse.move(b.x + x, b.y + y);
        await page.mouse.down();
        await page.mouse.move(b.x + u, b.y + v);
        await page.mouse.up();
        await expect
          .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
          .not.toBe(before);
      }
      if (dense) {
        await page.evaluate(() => {
          const recovery = JSON.parse(localStorage.getItem('splash-recovery-v1')!);
          const shapes = (recovery.project as Project).layers[0].keys[0].shapes;
          for (let i = 0; i < 600; i++)
            shapes.push({
              ...shapes[0],
              id: `distant-open-${i}`,
              kind: 'line',
              x: 2000 + i * 100,
              y: 1000,
              width: 20,
              height: 0,
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
              ],
              nodes: undefined,
              contours: undefined,
              fillEnabled: false,
            });
          localStorage.setItem('splash-recovery-v1', JSON.stringify(recovery));
        });
        await page.reload();
        await page.getByRole('button', { name: 'Recover changes' }).click();
        await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
      }
      const before = await read();
      await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
      await page.mouse.click(b.x + 400, b.y + 260);
      await expect(
        page.getByText('No enclosed region here; adjust gap tolerance or close the outline.', {
          exact: true,
        }),
      ).toBeVisible();
      expect(await read()).toEqual(before);
      await page.getByLabel('Bucket gap tolerance').fill('20');
      await page.mouse.click(b.x + 400, b.y + 260);
      await expect
        .poll(async () => (await read()).some((s) => s.fillEnabled && s.fill === '#ff0000'))
        .toBe(true);
      const pixel = () =>
        canvas.evaluate((c) => {
          const x = c as HTMLCanvasElement;
          return Array.from(x.getContext('2d')!.getImageData(400, 260, 1, 1).data);
        });
      await expect.poll(pixel).toEqual([255, 0, 0, 255]);
      expect((await read()).filter((s) => s.strokeWidth > 0)).toEqual(before);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
      await expect.poll(pixel).toEqual([255, 255, 255, 255]);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });

for (const mode of ['object', 'merge'] as const)
  test(`bucket selects nested paint among distant closed groups with undo in ${mode}`, async ({
    page,
  }) => {
    const project = newProject();
    project.layers[0].drawingMode = mode;
    const outline = (id: string, x: number, y: number, width: number, height: number): Vector => ({
      id,
      kind: 'path',
      x,
      y,
      width,
      height,
      rotation: 0,
      fill: '#000000',
      fillEnabled: false,
      stroke: '#000000',
      strokeWidth: 2,
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 },
      ],
    });
    project.layers[0].keys[0].shapes = [
      outline('outer', 300, 180, 200, 160),
      outline('hole', 340, 220, 120, 80),
      outline('island', 380, 240, 40, 40),
      ...Array.from({ length: 180 }, (_, i) =>
        [100, 60, 20].map((size, j) =>
          outline(
            `remote-${i}-${j}`,
            2000 + i * 150 + (100 - size) / 2,
            1000 + (100 - size) / 2,
            size,
            size,
          ),
        ),
      ).flat(),
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
          [320, 200],
          [350, 230],
          [400, 260],
        ].map(([x, y]) => [...ctx.getImageData(origin.x + x, origin.y + y, 1, 1).data]);
      }, origin);
    const white = [255, 255, 255, 255],
      red = [255, 0, 0, 255];
    await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
    await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
    await page.mouse.click(bounds.x + origin.x + 320, bounds.y + origin.y + 200);
    await expect.poll(pixels).toEqual([red, white, white]);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await expect.poll(pixels).toEqual([white, white, white]);
    await page.mouse.click(bounds.x + origin.x + 400, bounds.y + origin.y + 260);
    await expect.poll(pixels).toEqual([white, white, red]);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await expect.poll(pixels).toEqual([white, white, white]);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

for (const scope of ['scene','symbol'] as const) {
  test(`Bucket and a deleted divider heal only eligible compound seams in ${scope}`,async({page})=>{
    const project=newProject(), {divided,remote}=compoundDividerFixture();
    project.width=450;
    project.height=300;
    const layer=project.layers[0];
    layer.drawingMode=scope==='scene'?'merge':'object';
    if(scope==='symbol'){
      const definition:SymbolDefinition={id:'compound-divider',name:'Compound Divider',width:450,height:300,shapes:divided};
      project.symbols=[definition];
      layer.keys[0].shapes=[symbolInstance(definition,0,0)];
    } else layer.keys[0].shapes=divided;
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
    const workspace=page.getByRole('main',{name:'Symbol editing workspace',exact:true});
    const tool=(name:string)=>page.getByLabel('Drawing tools',{exact:true}).getByRole('button',{name,exact:true});
    const at=async(x:number,y:number)=>{
      const box=(await canvas.boundingBox())!;
      return [box.x+(box.width-project.width)/2+x,box.y+(box.height-project.height)/2+y] as const;
    };
    const pixel=(x:number,y:number)=>canvas.evaluate((el,{x,y,w,h})=>{
      const c=el as HTMLCanvasElement;
      return [...c.getContext('2d')!.getImageData(Math.floor((c.width-w)/2+x),Math.floor((c.height-h)/2+y),1,1).data];
    },{x,y,w:project.width,h:project.height});
    const read=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project));
    const saved=async()=>{
      const document=await read();
      return scope==='symbol'?document.symbols![0].shapes:document.layers[0].keys[0].shapes;
    };
    const open=async()=>{
      if(scope!=='symbol')return;
      await tool('Selection').click();
      await page.mouse.dblclick(...await at(415,258));
      await expect(workspace).toBeVisible();
    };
    const save=async()=>{
      if(scope!=='symbol')return;
      await workspace.getByRole('button',{name:'Save and return to scene',exact:true}).click();
      await expect(workspace).toHaveCount(0);
    };
    const material=(art:Vector[])=>art.filter(s=>!s.strokeWidth&&s.fill===compoundPaint);
    const owner=(art:Vector[],x:number,y:number)=>material(art).find(s=>hit(s,{x,y},0));
    const ink=(art:Vector[],x:number)=>art.find(s=>s.strokeWidth>0&&hit(s,{x,y:165},0));
    const initial=await saved(), protectedInk=ink(initial,250);
    const pink=[255,85,136,255], black=[0,0,0,255];
    expect(material(initial)).toHaveLength(3);

    await open();
    await expect.poll(()=>pixel(90,73)).toEqual([255,0,0,255]);
    await tool('Paint bucket').click();
    await page.getByLabel('Drawing fill',{exact:true}).fill(compoundPaint);
    await page.mouse.click(...await at(90,73));
    await expect.poll(()=>pixel(90,73)).toEqual(pink);
    if(scope==='symbol')expect(await saved()).toEqual(initial);
    await save();
    await expect.poll(async()=>(await saved()).some(s=>s.fill===brushInsert)).toBe(false);
    const recolored=await saved();
    expect(material(recolored)).toHaveLength(3);
    expect(owner(recolored,90,73)).toBe(owner(recolored,115,165));

    const recolorLeft=async(color:string,rgb:number[])=>{
      await open();
      await tool('Paint bucket').click();
      await page.getByLabel('Drawing fill',{exact:true}).fill(color);
      await page.mouse.click(...await at(115,165));
      await expect.poll(()=>pixel(115,165)).toEqual(rgb);
      await save();
    };
    const amber='#dd8844';
    await recolorLeft(amber,[221,136,68,255]);
    const left=owner(recolored,115,165)!;
    await expect.poll(saved).toEqual(recolored.map(s=>s.id===left.id?{...s,fill:amber}:s));
    await recolorLeft(compoundPaint,pink);
    await expect.poll(saved).toEqual(recolored);

    await open();
    await tool('Selection').click();
    await page.mouse.click(...await at(390,275));
    await expect.poll(()=>pixel(150,165)).toEqual(black);
    await page.mouse.click(...await at(150,165));
    await canvas.press('Delete');
    await expect.poll(()=>pixel(150,165)).toEqual(pink);
    await expect.poll(()=>pixel(250,165)).toEqual(black);
    await canvas.press('Control+z');
    await expect.poll(()=>pixel(150,165)).toEqual(black);
    await canvas.press('Control+Shift+z');
    await expect.poll(()=>pixel(150,165)).toEqual(pink);
    if(scope==='symbol')expect(await saved()).toEqual(recolored);
    await save();
    await expect.poll(async()=>material(await saved()).length).toBe(2);
    const healed=await saved();
    expect(owner(healed,120,165)).toBe(owner(healed,175,165));
    expect(owner(healed,175,165)).not.toBe(owner(healed,270,165));
    expect(ink(healed,150)).toBeUndefined();
    expect(ink(healed,250)).toEqual(protectedInk);
    expect(material(healed).map(s=>s.contours?.length)).toEqual([2,2]);

    await recover();
    expect(await saved()).toEqual(healed);
    await open();
    await tool('Pencil').click();
    await page.getByLabel('Pencil mode',{exact:true}).selectOption('ink');
    await page.getByLabel('Drawing stroke width',{exact:true}).fill('2');
    await page.getByLabel('Drawing stroke',{exact:true}).fill('#000000');
    await page.mouse.move(...await at(150,14));
    await page.mouse.down();
    await page.mouse.move(...await at(150,270));
    await page.mouse.up();
    await expect.poll(()=>pixel(150,165)).toEqual(black);
    if(scope==='symbol')expect(await saved()).toEqual(healed);
    await save();
    await expect.poll(async()=>material(await saved()).length).toBe(3);
    const recut=await saved();
    expect(owner(recut,120,165)).not.toBe(owner(recut,175,165));
    expect(ink(recut,250)).toEqual(protectedInk);
    for(const art of [recolored,healed,recut]){
      expect(art.filter(s=>ovalInserts.some(color=>color===s.fill))).toEqual(
        initial.filter(s=>ovalInserts.some(color=>color===s.fill)));
      expect(art.find(s=>s.id===remote.id)).toEqual(initial.find(s=>s.id===remote.id));
    }
    if(scope==='symbol')expect((await read()).layers).toEqual(project.layers);
  });
}
