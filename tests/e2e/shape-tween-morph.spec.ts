import { expect, test, type Page } from '@playwright/test';
import { newLayer, newProject, type Project, type Vector } from '../../packages/document/src';
import { createMotionFrameSampler } from '../../packages/animation/src/motion-frames';

async function setup(
  page: Page,
  mode: 'object' | 'merge' = 'object',
  type:
    | 'closed'
    | 'pencil'
    | 'compound'
    | 'hint-birth'
    | 'hint-close'
    | 'hint-hole'
    | 'multi-hint'
    | 'paint-move'
    | 'hole-birth'
    | 'hole-close'
    | 'island'
    | 'count-birth'
    | 'count-death'
    | 'open-closed'
    | 'brush' = 'closed',
  blank = false,
  scripted = false,
) {
  const p = newProject();
  p.width = 300;
  p.height = 200;
  p.duration = 12;
  p.fps = 4;
  if (scripted)
    p.frameScripts = [
      { frame: 4, source: "throw new Error('shape preview must stay script-free')" },
    ];
  const a: Vector = {
    id: 'square',
    kind: 'rectangle',
    x: 20,
    y: 30,
    width: 80,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#ff0000',
    strokeWidth: 0,
    points: [],
  };
  const b: Vector = {
    ...a,
    id: 'separately-drawn-circle',
    kind: 'ellipse',
    x: 100,
    fill: '#0000ff',
    stroke: '#0000ff',
  };
  if (type === 'pencil') {
    Object.assign(a, {
      kind: 'bezier',
      fillEnabled: false,
      strokeWidth: 6,
      nodes: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
      ],
    });
    Object.assign(b, {
      kind: 'bezier',
      fillEnabled: false,
      strokeWidth: 6,
      nodes: [
        { x: 0, y: 0 },
        { x: 40, y: 60 },
        { x: 80, y: 0 },
      ],
    });
  }
  if (type === 'compound' || type === 'paint-move' || (['hint-hole','multi-hint','hint-birth','hint-close'].includes(type))) {
    Object.assign(a, {
      kind: 'polygon',
      fillRule: 'evenodd',
      drawingMode: 'merge',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 80 },
          { x: 0, y: 80 },
        ],
        [
          { x: 20, y: 20 },
          { x: 60, y: 20 },
          { x: 60, y: 60 },
          { x: 20, y: 60 },
        ],
      ],
    });
    Object.assign(b, structuredClone(a), { id: 'replacement-paint', x: 100, fill: '#0000ff' });
    if ((['hint-hole','multi-hint','hint-birth','hint-close'].includes(type))) b.contours![1].splice(1,0,{x:40,y:20});
    if (type === 'hint-birth' || type === 'hint-close') {
      a.transform = b.transform = [1,0,0.25,1];
      const compound = type === 'hint-birth' ? b : a;
      compound.contours!.unshift([{x:4,y:4},{x:10,y:4},{x:10,y:10},{x:4,y:10}]);
    }
    b.contours![type === 'hint-birth' ? 1 : 0][1].y = -10;
    b.contours![type === 'hint-birth' ? 1 : 0][1].out = { x: 100, y: 30 };
  }
  p.layers[0].drawingMode = mode;
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: blank ? [] : [b] },
    { frame: 10, shapes: [] },
  ];
  if (type === 'multi-hint') {
    const rect:Vector={id:'companion',kind:'rectangle',x:220,y:20,width:20,height:20,
      fill:'#00aa00',stroke:'#000000',strokeWidth:0,rotation:0,points:[]};
    p.layers[0].keys[0].shapes.unshift(rect);
    p.layers[0].keys[1].shapes.unshift({...rect,id:'end-companion',y:60});
    p.layers[0].keys[1].shapes.push({...rect,id:'birth',x:230,y:120});
  }
  if (type === 'paint-move') {
    for (const key of p.layers[0].keys.slice(0, 2)) {
      const paint = key.shapes[0];
      key.shapes.push({
        ...a, id: 'other-paint', x: 125, y: 20, width: 22, height: 95, fill: '#008000',
        contours: [[{x:0,y:0},{x:22,y:0},{x:22,y:95},{x:0,y:95}]],
      });
      paint.contours![0] = paint.contours![0].flatMap((point, i, ring) => {
        const next = ring[(i + 1) % ring.length];
        return Array.from({ length: 100 }, (_, n) => ({
          x: point.x + (next.x - point.x) * n / 100,
          y: point.y + (next.y - point.y) * n / 100,
        }));
      });
    }
  }
  const square = (x: number, y: number, size: number) => [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  if (type === 'hole-birth' || type === 'hole-close' || type === 'island') {
    Object.assign(b, {
      kind: 'polygon',
      fillRule: 'evenodd',
      contours: [square(0, 0, 80), type === 'island' ? square(120, 20, 40) : square(20, 20, 40)],
    });
    if (type === 'hole-close')
      [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
        p.layers[0].keys[1].shapes,
        p.layers[0].keys[0].shapes,
      ];
  }
  if (type === 'count-birth' || type === 'count-death') {
    p.layers[0].keys[1].shapes.push({
      ...b,
      id: 'extra',
      kind: 'rectangle',
      x: 220,
      y: 50,
      width: 40,
      height: 40,
    });
    if (type === 'count-death')
      [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
        p.layers[0].keys[1].shapes,
        p.layers[0].keys[0].shapes,
      ];
  }
  if (type === 'open-closed') {
    Object.assign(a, {
      kind: 'bezier',
      nodes: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
      ],
      fillEnabled: false,
      strokeWidth: 6,
    });
    b.kind = 'rectangle';
  }
  if (type === 'brush')
    Object.assign(a, {
      kind: 'brush',
      strokeWidth: 14,
      brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 },
      points: Array.from({ length: 41 }, (_, i) => ({ x: i * 2, y: 8 * Math.sin(i / 20) })),
    });
  p.layers.push(newLayer('Other'));
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, p);
  await page.goto('/');
  await recoverShapeProject(page);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  async function point(at: number) {
    const r = (await timeline.boundingBox())!;
    return { x: r.x + at * 18 + 9, y: r.y + 25 + 28 + 14 };
  }
  async function seek(at: number) {
    const r = await point(at);
    await page.mouse.click(r.x, r.y);
  }
  async function convert() {
    const r = await point(2);
    await page.mouse.click(r.x, r.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Convert to shape tween', exact: true }).click();
  }
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (c: HTMLCanvasElement, { x, y }) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - 150) * devicePixelRatio),
              Math.round(c.height / 2 + (y - 100) * devicePixelRatio),
              1,
              1,
            ).data,
        ),
      { x, y },
    );
  async function stagePoint(x: number, y: number) {
    const r = (await canvas.boundingBox())!;
    return { x: r.x + r.width / 2 + x - 150, y: r.y + r.height / 2 + y - 100 };
  }
  return { p, read, timeline, canvas, point, seek, convert, pixel, stagePoint };
}
test('moving whole merged Brush paint across neighboring paint keeps the live shape tween and exact contours', async ({ page }) => {
  const f = await setup(page, 'merge', 'paint-move');
  await f.convert();
  const before = await f.read();
  const layer = before.layers[0], [paint, other] = layer.keys[0].shapes;
  expect(layer.liveMotionSpans).toHaveLength(1);
  await f.seek(0);
  const from = await f.stagePoint(29, 40), to = await f.stagePoint(89, 40);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect.poll(() => f.pixel(89, 40)).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(before);
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].x).toBe(paint.x + 60);
  const moved = await f.read();
  expect(moved.layers[0].keys[0].shapes).toEqual([{ ...paint, x: paint.x + 60 }, other]);
  expect(moved.layers[0].keys.slice(1)).toEqual(layer.keys.slice(1));
  expect(moved.layers[0].liveMotionSpans).toEqual(layer.liveMotionSpans);
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes).toEqual([{ ...paint, x: paint.x + 61 }, other]);
  await f.seek(4);
  await expect.poll(() => f.pixel(115, 44)).not.toEqual([255, 255, 255, 255]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await f.seek(0);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(moved);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(before);
});
for (const mode of ['object', 'merge'] as const)
  test(`${mode} square morphs into a separately drawn circle with visible intermediate geometry, exact endpoints and history`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.convert();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const q = await f.read();
    expect(q.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(q.layers[1]).toEqual(f.p.layers[1]);
    expect(q.symbols).toEqual(f.p.symbols);
    for (const [frame, x, color] of [
      [2, 80, [191, 0, 64, 255]],
      [4, 100, [128, 0, 128, 255]],
      [6, 120, [64, 0, 191, 255]],
    ] as const) {
      await f.seek(frame);
      await expect.poll(() => f.pixel(x, 70)).toEqual(color);
    }
    await f.seek(0);
    await expect.poll(() => f.pixel(24, 34)).toEqual([255, 0, 0, 255]);
    await f.seek(8);
    await expect.poll(() => f.pixel(104, 34)).toEqual([255, 255, 255, 255]);
    await expect.poll(() => f.pixel(140, 70)).toEqual([0, 0, 255, 255]);
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    expect(await f.read()).toEqual(q);
    await f.seek(4);
    await expect.poll(() => f.pixel(100, 70)).toEqual([128, 0, 128, 255]);
  });
for (const type of ['pencil', 'compound'] as const)
  test(`${type} separately drawn shapes interpolate real strokes or paint holes`, async ({
    page,
  }) => {
    const f = await setup(page, 'merge', type);
    await f.convert();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const q = await f.read();
    expect(q.layers[0].keys).toEqual(f.p.layers[0].keys);
    await f.seek(4);
    if (type === 'compound') {
      await expect.poll(() => f.pixel(65, 70)).toEqual([128, 0, 128, 255]);
      await expect.poll(() => f.pixel(100, 70)).toEqual([255, 255, 255, 255]);
    } else {
      await expect.poll(() => f.pixel(100, 60)).toEqual([128, 0, 128, 255]);
      await expect.poll(() => f.pixel(100, 30)).toEqual([255, 255, 255, 255]);
    }
  });
test('F6 inserts an editable intermediate morph, and changing its placement updates both adjoining tweens', async ({
  page,
}) => {
  const f = await setup(page);
  await f.convert();
  const before = await f.read();
  await f.seek(4);
  await f.timeline.focus();
  await page.keyboard.press('F6');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const split = await f.read();
  expect(split.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  expect(split.layers[0].keys[0]).toEqual(f.p.layers[0].keys[0]);
  expect(split.layers[0].keys[2]).toEqual(f.p.layers[0].keys[1]);
  await expect.poll(() => f.pixel(100, 70)).toEqual([128, 0, 128, 255]);
  const pick = await f.stagePoint(100, 70);
  await page.mouse.click(pick.x, pick.y);
  await page.getByLabel('Shape X', { exact: true }).fill('80');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await f.read()).layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x).toBe(80);
  await f.seek(2);
  await expect.poll(() => f.pixel(90, 70)).toEqual([192, 0, 64, 255]);
  await expect.poll(() => f.pixel(55, 70)).toEqual([255, 255, 255, 255]);
  await f.seek(6);
  await expect.poll(() => f.pixel(130, 70)).toEqual([64, 0, 192, 255]);
  await f.seek(4);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(split);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(before);
});
test('draw a different vector in a blank end key, then create and scrub a shape tween', async ({
  page,
}) => {
  const f = await setup(page, 'object', 'closed');
  await f.seek(8);
  await f.timeline.focus();
  await page.keyboard.press('F7');
  await expect.poll(async () => (await f.read()).layers[0].keys[1].shapes).toEqual([]);
  await page.getByRole('button', { name: 'Oval', exact: true }).click();
  await page.getByLabel('Drawing fill', { exact: true }).fill('#ff0000');
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
  const a = await f.stagePoint(100, 30),
    b = await f.stagePoint(180, 110);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await f.read()).layers[0].keys[1].shapes.length).toBe(1);
  const drawn = await f.read();
  await f.convert();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await f.read()).layers[0].keys).toEqual(drawn.layers[0].keys);
  await f.seek(4);
  await expect.poll(() => f.pixel(100, 70)).toEqual([255, 0, 0, 255]);
});

for (const type of [
  'hole-birth',
  'hole-close',
  'island',
  'count-birth',
  'count-death',
  'open-closed',
  'brush',
] as const)
  test(`${type} shape tween visibly morphs mismatched topology, preserves endpoint drawings and supports editable keys`, async ({
    page,
  }) => {
    const f = await setup(page, 'merge', type),
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await f.convert();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const q = await f.read();
    expect(q.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(q.layers[1]).toEqual(f.p.layers[1]);
    expect(q.symbols).toEqual(f.p.symbols);
    const sampler = createMotionFrameSampler(q, q.layers[0].id, q.layers[0].liveMotionSpans![0]);
    const expected = sampler.sample(4);
    sampler.dispose();
    await f.seek(4);
    if (type === 'hole-birth' || type === 'hole-close') {
      await expect.poll(() => f.pixel(70, 40)).toEqual([128, 0, 128, 255]);
      await expect.poll(() => f.pixel(100, 70)).toEqual([255, 255, 255, 255]);
      expect(expected[0].contours).toHaveLength(2);
    } else if (type === 'island') {
      await expect.poll(() => f.pixel(165, 70)).toEqual([128, 0, 128, 255]);
      await expect.poll(() => f.pixel(148, 70)).toEqual([255, 255, 255, 255]);
    } else if (type === 'count-birth' || type === 'count-death') {
      expect(expected).toHaveLength(2);
      expect(expected[1].opacity).toBe(0.5);
      const c = await f.pixel(165, 70);
      expect(c[2]).toBe(255);
      expect(c[0]).toBeGreaterThan(120);
      expect(c[0]).toBeLessThan(140);
    } else {
      const pixels = await f.canvas.evaluate((c: HTMLCanvasElement) => {
        const a = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let count = 0;
        for (let i = 0; i < a.length; i += 4)
          if (a[i] > 60 && a[i] < 240 && a[i + 2] > 60 && a[i + 2] < 240 && a[i + 3] === 255)
            count++;
        return count;
      });
      expect(pixels).toBeGreaterThan(100);
      expect(expected[0].nodes ?? expected[0].contours).toBeDefined();
    }
    await f.timeline.focus();
    await page.keyboard.press('F6');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await f.read()).layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual(expected);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(q);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(q);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    expect(await f.read()).toEqual(q);
    expect(errors).toEqual([]);
  });

for (const type of ['hole-birth', 'count-birth'] as const)
  test(`${type} topology morph also renders in script-free Test Movie without changing artwork`, async ({
    page,
  }) => {
    const f = await setup(page, 'object', type, false, true);
    await f.convert();
    const q = await f.read();
    await f.seek(4);
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page
      .getByRole('button', { name: 'Test movie', exact: false })
      .filter({ hasText: 'Ctrl Enter' })
      .click();
    const d = page.getByRole('dialog', { name: 'Test live movie', exact: true });
    await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
    await d.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
    await d.getByRole('button', { name: 'Restart live movie', exact: true }).click();
    await expect(d.getByLabel('Live movie position')).toContainText('Frame 5');
    await expect(d.getByLabel('Live movie position')).toContainText('Tick 0');
    await expect(d.getByLabel('Live movie status')).toContainText('Live movie ready');
    const pixels = await d.getByLabel('Live movie interaction').evaluate((el, type) => {
      const c = el as HTMLCanvasElement,
        ctx = c.getContext('2d')!;
      return type === 'hole-birth'
        ? [...ctx.getImageData(100, 70, 1, 1).data, ...ctx.getImageData(70, 40, 1, 1).data]
        : [...ctx.getImageData(165, 70, 1, 1).data];
    }, type);
    if (type === 'hole-birth') expect(pixels).toEqual([255, 255, 255, 255, 128, 0, 128, 255]);
    else {
      expect(pixels[2]).toBe(255);
      expect(pixels[0]).toBeGreaterThan(120);
      expect(pixels[0]).toBeLessThan(140);
    }
    await page.keyboard.press('Escape');
    expect(await f.read()).toEqual(q);
  });

test('an appearing shape can be promoted with F6 and edited between both adjoining morphs', async ({
  page,
}) => {
  const f = await setup(page, 'object', 'count-birth');
  await f.convert();
  await f.seek(4);
  await f.timeline.focus();
  await page.keyboard.press('F6');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const split = await f.read(),
    point = await f.stagePoint(165, 70);
  await page.mouse.click(point.x, point.y);
  await page.getByLabel('Shape X', { exact: true }).fill('250');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(out.layers[0].keys.find((k) => k.frame === 4)!.shapes[1].x).toBe(250);
  expect(out.layers[0].keys[0]).toEqual(f.p.layers[0].keys[0]);
  expect(out.layers[0].keys.find((k) => k.frame === 8)).toEqual(f.p.layers[0].keys[1]);
  for (const frame of [2, 6]) {
    await f.seek(frame);
    const sampler = createMotionFrameSampler(
      out,
      out.layers[0].id,
      out.layers[0].liveMotionSpans!.find((s) => s.start < frame && frame < s.end)!,
    );
    expect(sampler.sample(frame)).toHaveLength(2);
    sampler.dispose();
  }
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(split);
});

test('retarget a hole node hint on stage and generate the edited morph', async ({page}) => {
  const p = newProject();
  p.width = 300; p.height = 200; p.duration = 6;
  const outer = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
  const hole = [{x:20,y:20},{x:20,y:60},{x:65,y:30}];
  const a:Vector = { id:'compound',kind:'polygon',x:40,y:30,width:100,height:100,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],fillRule:'evenodd',contours:[outer,hole] };
  const b=structuredClone(a);
  b.contours![1]=[{x:20,y:20},{x:18,y:42},{x:35,y:70},{x:70,y:30}];
  p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[b]}];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',
    JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const timeline=page.getByLabel('Timeline frames',{exact:true});
  await timeline.click({position:{x:9,y:40}});
  await timeline.click({position:{x:81,y:40},modifiers:['Shift']});
  await page.getByLabel('Motion interpolate curve nodes',{exact:true}).check();
  await page.getByLabel('Motion match straight nodes',{exact:true}).check();
  const hints=page.getByLabel('Motion node hints',{exact:true});
  await hints.fill('1:1; 1:1');
  const toggle=page.getByLabel('Edit node hints on stage',{exact:true});
  await toggle.check();
  await page.getByLabel('Stage motion hint contour').selectOption('1');
  const edit=page.getByLabel('Stage motion edit node pair 1:1',{exact:true});
  await edit.click();
  await page.getByLabel('Stage motion endpoint').selectOption('1');
  const anchor=page.getByLabel('Stage motion target node 2',{exact:true});
  await anchor.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Cancel pair edit',exact:true}).click();
  await expect(hints).toHaveValue('1:1; 1:1');
  await edit.click(); await anchor.focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Stage motion update node pair',{exact:true}).click();
  await expect(hints).toHaveValue('1:1; 1:2');
  expect(await read()).toEqual(p);
  await toggle.uncheck();
  await page.getByText('Choose node pairs visually',{exact:true}).click();
  await page.getByLabel('Motion hint contour',{exact:true}).selectOption('1');
  const existing=page.getByLabel('Motion edit node pair 1:2',{exact:true});
  await existing.click();
  await page.getByLabel('Motion target node 1',{exact:true}).click();
  await page.getByLabel('Motion update node pair',{exact:true}).press('Escape');
  await expect(hints).toHaveValue('1:1; 1:2');
  await expect(existing).toBeVisible();
  await page.getByRole('button',{name:'Generate motion in-betweens',exact:true}).click();
  await expect.poll(read).not.toEqual(p);
  const saved = await read(), keys=saved.layers[0].keys;
  expect(keys[0].shapes).toEqual([a]);
  expect(keys.at(-1)!.shapes).toEqual([b]);
  const middle=keys.find(key=>key.frame===2)!.shapes[0].contours!;
  expect(middle[0]).toEqual(outer);
  expect(middle[1]).toContainEqual({x:27.5,y:65});
  await page.getByLabel('Drawing stage',{exact:true}).focus();
  await page.keyboard.press('Control+z'); await expect.poll(read).toEqual(p);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(read).toEqual(saved);
});

async function recoverShapeProject(page: Page) {
  const splash = page.getByRole('button', {name:'Open editor',exact:true});
  const recover = page.getByRole('button', {name:'Recover changes',exact:true});
  await expect(splash.or(recover).first()).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
}

for (const fixture of ['hint-hole','multi-hint','hint-birth','hint-close'] as const) test('edit a live compound shape hint with detached preview, cancel, history and recovery: '+fixture, async ({page}) => {
  const multi = fixture === 'multi-hint';
  const f = await setup(page,'merge',fixture);
  await f.convert(); const before=await f.read();
  const open=async()=>{
    const xy=await f.point(4);
    await page.mouse.click(xy.x,xy.y,{button:'right'});
    await page.getByRole('menuitem',{name:'Edit shape hints',exact:true}).click();
    await expect(page.getByLabel('Shape tween node pairs',{exact:true})).toBeFocused();
    if (multi) {
      const pair=page.getByLabel('Shape tween artwork pair');
      await expect(pair.locator('option')).toHaveCount(2);
      await page.getByRole('button',{name:'Pick from start frame'}).click();
      const source=page.getByLabel('Start frame artwork');
      const bounds=(await source.boundingBox())!;
      await source.click({position:{x:bounds.width*30/300,y:bounds.height*40/200}});
      await expect(pair).toHaveValue('1');
    }
  };
  const previewButton=page.getByRole('button',{name:'Preview shape hints',exact:true});
  const draw=()=>fixture === 'hint-birth' ? previewButton.press('Enter') : previewButton.click();
  const apply=page.getByRole('button',{name:'Apply shape hints',exact:true});
  const text=page.getByLabel('Shape tween node pairs',{exact:true});
  await open(); await draw();
  const preview=page.getByLabel('Shape tween midpoint',{exact:true});
  const alphas=()=>preview.evaluate(el=>{
    const c=el as HTMLCanvasElement, rgba=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
    return Array.from(rgba.filter((_,i)=>i%4===3));
  });
  const originalPixels=await alphas();
  await text.fill('; 1:99'); await draw();
  await expect(apply).toBeDisabled(); expect(await f.read()).toEqual(before);
  await text.fill('; 1:3'); await draw();
  const changedPixels=await alphas();
  // Find an interior patch uncovered by the revised hole, away from antialiased edges.
  const stride=330;
  const probe=originalPixels.findIndex((_,i)=>[-stride,0,stride].every(row=>
    [-1,0,1].every(col=>originalPixels[i+row+col]===0 && changedPixels[i+row+col]===255)));
  expect(probe).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByLabel('Timeline frames',{exact:true})).toBeFocused();
  expect(await f.read()).toEqual(before);
  await open();
  if (fixture === 'hint-birth' || fixture === 'hint-close') {
    const pick = page.getByRole('button',{name:'Pick anchors on stage',exact:true});
    const back = page.getByRole('button',{name:'Return to shape hints',exact:true});
    await pick.press('Enter');
    await expect(back).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pick).toBeFocused();
    await pick.press('Enter');
    await expect(back).toBeFocused();
    await page.getByLabel('Live stage hint hint contour').selectOption('1');
    const clickAnchor = async (x:number, y:number, label:string) => {
      const point = await f.stagePoint(x,y);
      await page.mouse.click(point.x,point.y);
      await expect(page.getByLabel(label,{exact:true})).toHaveAttribute('aria-pressed','true');
    };
    await clickAnchor(20+60+0.25*20,30+20,'Live stage hint source node 1');
    await page.getByLabel('Live stage hint endpoint').selectOption('1');
    await clickAnchor(100+60+0.25*60,30+60,'Live stage hint target node 3');
    await page.getByLabel('Live stage hint add node pair',{exact:true}).click();
    await page.getByRole('button',{name:'Return to shape hints'}).click();
    await expect(pick).toBeFocused();
  } else {
  await page.getByRole('dialog',{name:'Edit shape hints',exact:true}).getByText('Choose node pairs visually',{exact:true}).click();
  await page.getByLabel('Shape tween hint contour',{exact:true}).selectOption('1');
  await page.getByLabel('Shape tween source node 1',{exact:true}).click();
  await page.getByLabel('Shape tween target node 3',{exact:true}).click();
  await page.getByLabel('Shape tween add node pair',{exact:true}).click();
  }
  await expect(text).toHaveValue('; 1:3'); await draw();
  if (fixture === 'hint-birth') await apply.press('Enter');
  else await apply.click();
  await expect(page.getByLabel('Timeline frames',{exact:true})).toBeFocused();
  const expected=structuredClone(before);
  const nodes=expected.layers[0].liveMotionSpans![0].correspondence!.nodes!;
  if (typeof nodes==='boolean') throw Error('Expected shape correspondence');
  if (multi) nodes.artworkHints=[{sourceId:'square',targetId:'replacement-paint',hints:[[],[[1,3]]]}];
  else if (fixture === 'hint-birth' || fixture === 'hint-close')
    nodes.artworkHints=[{sourceId:'square',targetId:'replacement-paint',hints:[[],[[1,3]]],
      contourOwners:[null,fixture === 'hint-birth' ? [1,2] : [2,1]]}];
  else nodes.hints=[[],[[1,3]]];
  await expect.poll(f.read).toEqual(expected);
  await f.canvas.focus(); await page.keyboard.press('Control+z'); await expect.poll(f.read).toEqual(before);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await recoverShapeProject(page);
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await f.seek(4); await expect.poll(()=>f.pixel((probe%stride)/1.1,Math.floor(probe/stride)/1.1)).toEqual([128,0,128,255]);
  await open(); await expect(text).toHaveValue('; 1:3');
  if (fixture === 'hint-birth' || fixture === 'hint-close') {
    const midpoint = (project:Project) => {
      const layer = project.layers[0], sampler = createMotionFrameSampler(project, layer.id, layer.liveMotionSpans![0]);
      try { return sampler.sample(4)[0].contours!; } finally { sampler.dispose(); }
    };
    const automatic = midpoint(before), hinted = midpoint(expected);
    expect(hinted).toHaveLength(3);
    expect(hinted[0]).toEqual(automatic[0]);
    expect(hinted[1]).not.toEqual(automatic[1]);
    expect(hinted[2]).toEqual(automatic[2]);
    // Reopen an endpoint edit that makes the formerly smallest ring outrank the hint.
    const edited = structuredClone(expected);
    const endpoint = edited.layers[0].keys[fixture === 'hint-birth' ? 1 : 0].shapes[0];
    endpoint.contours![0] = [{x:90,y:0},{x:140,y:0},{x:140,y:50},{x:90,y:50}];
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.addInitScript(project=>{
      localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));
    },edited);
    await page.reload();
    await recoverShapeProject(page);
    await open(); await draw(); await expect(apply).toBeEnabled();
    expect(midpoint(await f.read())[1]).toEqual(hinted[1]);
    await page.getByRole('button',{name:'Pick anchors on stage'}).click();
    await page.getByLabel('Live stage hint hint contour').selectOption('1');
    await page.getByLabel('Live stage hint endpoint').selectOption(fixture === 'hint-birth' ? '1' : '0');
    const anchor = page.getByLabel('Live stage hint '+(fixture === 'hint-birth' ? 'target' : 'source')+' node 1',{exact:true}).locator('circle');
    // Node 1 belongs to the original 40-unit hole in each transformed endpoint.
    expect(Number(await anchor.getAttribute('cx'))).toBe(fixture === 'hint-birth' ? 145 : 85);
    await page.getByRole('button',{name:'Return to shape hints'}).click();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    expect(await f.read()).toEqual(edited);

  }
  if (multi) {
    await page.getByLabel('Shape tween artwork pair').selectOption('0');
    await expect(text).toHaveValue('');
    const poses=(project:Project)=>{
      const layer=project.layers[0], sampler=createMotionFrameSampler(project,layer.id,layer.liveMotionSpans![0]);
      try { return sampler.sample(4); } finally { sampler.dispose(); }
    };
    const prev=poses(before), after=poses(await f.read());
    expect(after).toHaveLength(3);
    expect(after[0]).toEqual(prev[0]); expect(after[2]).toEqual(prev[2]);
    expect(after[1]).not.toEqual(prev[1]);
  }
});
