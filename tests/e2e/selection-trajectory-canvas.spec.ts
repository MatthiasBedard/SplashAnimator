import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
import { worldPoint } from '../../packages/geometry/src';
function fixture(mode: string) {
  const p = newProject();
  p.width = 500;
  p.height = 300;
  p.duration = 14;
  const layer = p.layers[0];
  layer.id = 'base';
  layer.drawingMode = 'object';
  const ink = (id: string, x: number, groups?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y: 60,
    width: 20,
    height: 20,
    rotation: 0,
    pivot: { x: 3, y: 4 },
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  });
  const shapes = [
    ink('r', 20),
    ink('b', 70, ['outer', 'inner']),
    ink('a', 100, ['outer']),
    ink('other', 150),
    ink('d', 210, ['second']),
    ink('e', 240, ['second']),
  ];
  if (mode.startsWith('nested-')) {
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 8,
        height: 8,
        shapes: [{ ...ink('kid', 0), x: 0, y: 0, width: 8, height: 8, fill: '#0000ff' }],
      },
    ];
    shapes[2] = {
      ...shapes[2],
      kind: 'symbol',
      symbolId: 'child',
      width: 8,
      height: 8,
      symbolPlayback: {
        mode: mode.slice(7) as 'loop' | 'once' | 'single' | 'movie',
        firstFrame: 0,
      },
    };
  }
  if (mode === 'affine' || mode === 'reflected')
    for (const s of shapes) {
      s.rotation = 20;
      s.transform = [mode === 'reflected' ? -1.3 : 1.3, 0.2, 0.4, 0.8];
    }
  if (mode === 'compound' || mode === 'aligned' || mode === 'curved')
    for (const s of shapes) {
      s.kind = 'polygon';
      s.closed = true;
      s.fillRule = 'evenodd';
      s.contours = [
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        [
          [5, 5],
          [5, 9],
          [9, 5],
        ],
      ].map((r) => r.map(([x, y]) => ({ x, y })));
    }
  if (mode === 'curved')
    for (const shape of shapes)
      for (const ring of shape.contours!) ring[0].out = { x: ring[0].x + 3, y: ring[0].y };
  const end = (distance: number) =>
    shapes.map((s) => ({
      ...structuredClone(s),
      x: s.x + distance,
      ...(mode === 'aligned'
        ? { contours: [...s.contours!].reverse().map((r) => [r[1], r[0], ...r.slice(2).reverse()]) }
        : {}),
    }));
  layer.keys = [
    { frame: 0, shapes },
    { frame: 8, shapes: end(80) },
    { frame: 12, shapes: [] },
  ];
  const rotation =
    mode === 'aligned'
      ? undefined
      : {
          direction: 'shortest' as const,
          turns: 0,
          rigidGroups: true,
          axisGroupScale: true,
          axisGroupShear: true,
        };
  const correspondence =
    mode === 'aligned' ? { order: [1, 0], start: [1, 1], reverse: [true, true] } : undefined;
  createBasicMotionSpan(
    p,
    ['base'],
    0,
    8,
    'linear',
    { affine: true, ...(mode === 'aligned' ? { nodes: true } : {}) },
    undefined,
    rotation,
    correspondence,
  );
  const extra = {
    ...structuredClone(layer),
    id: 'extra',
    name: 'Extra',
    keys: [
      { frame: 0, shapes: shapes.map((s) => ({ ...structuredClone(s), y: 140, fill: '#0000ff' })) },
      { frame: 10, shapes: end(100).map((s) => ({ ...s, y: 140, fill: '#0000ff' })) },
      { frame: 12, shapes: [] },
    ],
    motionSpans: undefined,
  };
  p.layers.push(extra);
  createBasicMotionSpan(
    p,
    ['extra'],
    0,
    10,
    'linear',
    { affine: true, ...(mode === 'aligned' ? { nodes: true } : {}) },
    undefined,
    rotation,
    correspondence,
  );
  if (mode === 'guard')
    for (const l of p.layers) l.motionSpans![0].rotation!.axisGroupShear = false;
  if (mode === 'fresh')
    for (const l of p.layers)
      for (const s of l.keys.find((k) => k.frame === (l.id === 'base' ? 8 : 10))!.shapes) s.x += 40;
  if (mode === 'children') {
    const child = newProject();
    child.duration = 12;
    const track = child.layers[0],
      blue = { ...ink('blue', 0), x: 0, y: 0, width: 8, height: 8, fill: '#0000ff' };
    track.keys = [
      { frame: 0, shapes: [blue] },
      { frame: 8, shapes: [{ ...blue, x: 8 }] },
    ];
    createBasicMotionSpan(child, [track.id], 0, 8, 'linear');
    track.keys[8].shapes[0].x = 16;
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 30,
        height: 10,
        shapes: track.keys[0].shapes,
        timeline: { duration: 12, keys: track.keys.slice(1), motionSpans: track.motionSpans },
      },
    ];
    p.layers.push({
      id: 'children',
      name: 'Children',
      visible: true,
      locked: false,
      drawingMode: 'object',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              ...blue,
              id: 'instance',
              kind: 'symbol',
              symbolId: 'child',
              x: 350,
              y: 220,
              width: 30,
              height: 10,
              symbolPlayback: { mode: 'loop', firstFrame: 0 },
            },
          ],
        },
      ],
    });
  }
  if (mode === 'default-track') for (const track of p.layers) delete track.drawingMode;
  if (mode === 'saved-flags' || mode === 'waypoints')
    for (const layer of p.layers)
      refreshBasicMotionSpan(
        p,
        [layer.id],
        0,
        layer.id === 'base' ? 8 : 10,
        undefined,
        mode === 'waypoints'
          ? {
              startX: 0,
              startY: 0,
              endX: 0,
              endY: 0,
              waypoints: [
                { x: 30, y: 20 },
                { x: 60, y: -10 },
              ],
            }
          : { startX: 8, startY: 20, endX: -8, endY: 15, distance: false, tangent: false },
      );
  return p;
}

const numbers = {
  base: { startX: 26, startY: 60, endX: -18, endY: 40 },
  extra: { startX: 15, startY: -40, endX: -10, endY: -25 },
};
const requests = (tracks: string[]) =>
  tracks.flatMap((layerId) => ['r', 'b', 'other', 'd'].map((shapeId) => ({ layerId, shapeId })));
async function oracle(
  page: Page,
  project: Project,
  tracks: string[],
  values: Record<string, typeof numbers.base> = numbers,
) {
  const { buildSync } = createRequire(import.meta.resolve('vite'))('esbuild') as {
    buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
  };
  const script = buildSync({
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    tsconfig: 'tsconfig.json',
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `import {captureRememberedSelectionAuthoringFrame} from './packages/animation/src/selection-motion-owner';globalThis.__trajectoryOracle=(project,requests,controls)=>{const cap=captureRememberedSelectionAuthoringFrame(()=>({project,frame:4,revision:0}));try{const owner=cap.resolveSelection(requests);return cap.prepareTrajectories(requests,controls.map(value=>({layerId:value.layerId,shapeId:'r',path:{...(project.layers.find(layer=>layer.id===value.layerId).motionSpans.find(span=>span.id===owner.tracks.find(track=>track.layerId===value.layerId).spanId).path??{}),...value.path}})));}finally{cap.dispose();}};`,
    },
  }).outputFiles[0].text;
  await page.addScriptTag({ content: script });
  return page.evaluate(
    ({ project, selection, controls }) =>
      (
        window as unknown as {
          __trajectoryOracle(
            p: Project,
            r: { layerId: string; shapeId: string }[],
            c: { layerId: string; path: typeof numbers.base }[],
          ): Project;
        }
      ).__trajectoryOracle(project, selection, controls),
    {
      project,
      selection: requests(tracks),
      controls: tracks.map((layerId) => ({
        layerId,
        path: values[layerId],
      })),
    },
  );
}
async function setup(page: Page, mode: string, tracks = ['base']) {
  await page.setViewportSize({ width: 1800, height: 1800 });
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('trajectory-seeded')) {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      sessionStorage.setItem('trajectory-seeded', '1');
    }
  }, fixture(mode));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    before = await read();
  await page.getByLabel('Timeline frames').click({ position: { x: 81, y: 40 } });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const region = page.getByRole('region', { name: 'Sampled motion stage' });
  if (mode === 'children' || mode.startsWith('nested-')) {
    await region.getByLabel('Remember sampled stage children').check();
    await expect(region.getByLabel('Sampled stage artwork')).toBeEnabled();
  }
  if (mode === 'group-context')
    await region.getByLabel('Select complete sampled stage groups').check();
  await region.getByLabel('Select multiple sampled units').check();
  const editor = region.getByRole('group', { name: 'Sampled selection set', exact: true });
  for (const request of requests(tracks))
    await editor
      .getByLabel('Sampled unit ' + request.layerId + '/' + request.shapeId, { exact: true })
      .check();
  return { read, before, region, editor, errors, stage: page.getByLabel('Drawing stage') };
}
async function fill(page: Page, tracks: string[]) {
  for (const layerId of tracks)
    for (const field of ['startX', 'startY', 'endX', 'endY'] as const) {
      const label = field.replace('X', ' X').replace('Y', ' Y');
      await page
        .getByLabel('Selection trajectory ' + layerId + ' ' + label, { exact: true })
        .fill(String(numbers[layerId as keyof typeof numbers][field]));
    }
}
async function pixel(page: Page, p: { x: number; y: number }) {
  return page.getByLabel('Drawing stage').evaluate((el, p) => {
    const c = el as HTMLCanvasElement;
    return [
      ...c
        .getContext('2d')!
        .getImageData(
          Math.round(c.width / 2 + (p.x - 250) * devicePixelRatio),
          Math.round(c.height / 2 + (p.y - 150) * devicePixelRatio),
          1,
          1,
        ).data,
    ];
  }, p);
}

async function begin(page: Page, mode = 'base', tracks = ['base']) {
  const f = await setup(page, mode, tracks);
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  if (tracks.length > 1) await fill(page, tracks);
  const role = mode === 'end' || mode === 'extra-end' ? 'end' : 'start';
  const gestureLayer = mode.startsWith('extra') ? 'extra' : 'base';
  await page
    .getByLabel('Selection trajectory gesture track', { exact: true })
    .selectOption(gestureLayer);
  await page.getByLabel('Selection trajectory control role', { exact: true }).selectOption(role);
  await page.getByLabel('Drag selection trajectory controls', { exact: true }).check();
  if (mode === 'css')
    await f.stage.evaluate((el) => {
      el.style.width = '700px';
      el.style.height = '360px';
    });
  await f.stage.scrollIntoViewIfNeeded();
  await f.stage.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const layer = f.before.layers.find((l) => l.id === gestureLayer)!,
    shape = layer.keys.find(
      (k) =>
        k.frame === (role === 'start' ? layer.motionSpans![0].start : layer.motionSpans![0].end),
    )!.shapes[0],
    path = layer.motionSpans![0].path,
    point = {
      x: shape.x + (path?.[role === 'start' ? 'startX' : 'endX'] ?? 0),
      y: shape.y + (path?.[role === 'start' ? 'startY' : 'endY'] ?? 0),
    };
  const box = (await f.stage.boundingBox())!,
    size = await f.stage.evaluate((el) => ({
      width: (el as HTMLCanvasElement).width / devicePixelRatio,
      height: (el as HTMLCanvasElement).height / devicePixelRatio,
    }));
  const start = {
    x: box.x + ((size.width / 2 + point.x - 250) * box.width) / size.width,
    y: box.y + ((size.height / 2 + point.y - 150) * box.height) / size.height,
  };
  await f.stage.evaluate((el) =>
    el.addEventListener('pointerdown', (event) => {
      (el as HTMLElement).dataset.routePointer = String((event as PointerEvent).pointerId);
      (el as HTMLElement).dataset.routeDown = JSON.stringify({
        x: (event as PointerEvent).clientX,
        y: (event as PointerEvent).clientY,
      });
    }),
  );
  await f.stage.evaluate((el) => {
    for (const type of ['pointermove', 'pointerup'])
      el.addEventListener(type, (event) => {
        const e = event as PointerEvent;
        (el as HTMLElement).dataset[type] = JSON.stringify({ x: e.clientX, y: e.clientY });
      });
  });
  return {
    ...f,
    box,
    size,
    role,
    point,
    start,
    gestureLayer,
    originalOffset: {
      x: path?.[role === 'start' ? 'startX' : 'endX'] ?? 0,
      y: path?.[role === 'start' ? 'startY' : 'endY'] ?? 0,
    },
  };
}
for (const mode of [
  'base',
  'end',
  'multi',
  'extra',
  'extra-end',
  'saved-flags',
  'affine',
  'reflected',
  'compound',
  'curved',
  'aligned',
  'children',
  'nested-movie',
  'css',
  'shift',
  'offset',
  'zero',
  'return',
  'prior',
  'retained',
])
  test('main trajectory canvas drafts ' + mode, async ({ page }) => {
    const tracks = mode === 'multi' || mode.startsWith('extra') ? ['base', 'extra'] : ['base'],
      f = await begin(page, mode, tracks);
    const field = (suffix: string) =>
        page.getByLabel('Selection trajectory ' + f.gestureLayer + ' ' + f.role + ' ' + suffix, {
          exact: true,
        }),
      commit = page.getByRole('button', { name: 'Commit selection trajectories', exact: true });
    if (mode === 'retained') {
      await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).uncheck();
      await f.editor.getByLabel('Drag sampled selection offsets', { exact: true }).check();
      await f.editor
        .getByLabel('Author sampled selection drag on release', { exact: true })
        .check();
      await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
      await page.getByLabel('Drag selection trajectory controls', { exact: true }).check();
      await f.stage.scrollIntoViewIfNeeded();
    }
    if (mode === 'prior') {
      await fill(page, ['base']);
      await page
        .getByRole('button', { name: 'Preview selection trajectories', exact: true })
        .click();
      await f.stage.scrollIntoViewIfNeeded();
    }
    // Remeasure after optional control/proposal rows have settled.
    const box = (await f.stage.boundingBox())!,
      size = await f.stage.evaluate((el) => ({
        width: (el as HTMLCanvasElement).width / devicePixelRatio,
        height: (el as HTMLCanvasElement).height / devicePixelRatio,
      })),
      start = {
        x: box.x + ((size.width / 2 + f.point.x - 250) * box.width) / size.width,
        y: box.y + ((size.height / 2 + f.point.y - 150) * box.height) / size.height,
      };
    const marker = await f.stage.evaluate((el, position) => {
      const c = el as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        sx = c.width / r.width,
        sy = c.height / r.height,
        p = c
          .getContext('2d')!
          .getImageData(
            Math.floor((position.x - r.left - 7) * sx),
            Math.floor((position.y - r.top - 7) * sy),
            Math.ceil(14 * sx),
            Math.ceil(14 * sy),
          ).data;
      let n = 0;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] < 120 && p[i + 1] > 100 && p[i + 2] > 130 && p[i + 3] === 255) n++;
      return n;
    }, start);
    expect(marker).toBeGreaterThan(8);
    const offset = mode === 'offset' ? { x: 3, y: 2 } : { x: 0, y: 0 };
    await page.mouse.move(start.x + offset.x, start.y + offset.y);
    await page.mouse.down();
    const captured = () =>
      f.stage.evaluate((el) =>
        (el as HTMLCanvasElement).hasPointerCapture(
          Number((el as HTMLElement).dataset.routePointer),
        ),
      );
    expect(await captured()).toBe(true);
    await expect(commit).toBeDisabled();
    if (mode === 'zero') {
      await page.mouse.up();
      expect(await captured()).toBe(false);
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
      return;
    }
    if (mode === 'shift') await page.keyboard.down('Shift');
    const dx = mode === 'shift' ? 10 : 26,
      dy = mode === 'shift' ? 40 : 60;
    await page.mouse.move(
      start.x + offset.x + (dx * box.width) / size.width,
      start.y + offset.y + (dy * box.height) / size.height,
      { steps: 3 },
    );
    const delivered = await f.stage.evaluate((el) => ({
      down: JSON.parse((el as HTMLElement).dataset.routeDown!),
      move: JSON.parse((el as HTMLElement).dataset.pointermove!),
    }));
    let expectedX = ((delivered.move.x - delivered.down.x) * size.width) / box.width,
      expectedY = ((delivered.move.y - delivered.down.y) * size.height) / box.height;
    if (mode === 'shift') {
      if (Math.abs(expectedX) >= Math.abs(expectedY)) expectedY = 0;
      else expectedX = 0;
    }
    expectedX += f.originalOffset.x;
    expectedY += f.originalOffset.y;
    await expect(field('X')).toHaveValue(String(expectedX));
    await expect(field('Y')).toHaveValue(String(expectedY));
    expect(await f.read()).toEqual(f.before);
    expect(await captured()).toBe(true);
    if (mode === 'return') {
      await page.mouse.move(start.x + offset.x, start.y + offset.y);
      await page.mouse.up();
      expect(await captured()).toBe(false);
      await expect(field('X')).toHaveValue('0');
      await expect(field('Y')).toHaveValue('0');
      await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
      return;
    }
    if (mode === 'prior') {
      await page.keyboard.press('Escape');
      expect(await captured()).toBe(false);
      await expect(field('X')).toHaveValue('26');
      await expect(field('Y')).toHaveValue('60');
      await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
      await page.mouse.up();
      expect(await f.read()).toEqual(f.before);
      return;
    }
    await page.mouse.up();
    if (mode === 'shift') await page.keyboard.up('Shift');
    expect(await captured()).toBe(false);
    await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    const values = Object.fromEntries(
      await Promise.all(
        tracks.map(async (layerId) => [
          layerId,
          {
            startX: Number(
              await page
                .getByLabel('Selection trajectory ' + layerId + ' start X', { exact: true })
                .inputValue(),
            ),
            startY: Number(
              await page
                .getByLabel('Selection trajectory ' + layerId + ' start Y', { exact: true })
                .inputValue(),
            ),
            endX: Number(
              await page
                .getByLabel('Selection trajectory ' + layerId + ' end X', { exact: true })
                .inputValue(),
            ),
            endY: Number(
              await page
                .getByLabel('Selection trajectory ' + layerId + ' end Y', { exact: true })
                .inputValue(),
            ),
          },
        ]),
      ),
    );
    const expected = await oracle(page, f.before, tracks, values as never),
      target = worldPoint(expected.layers[0].keys[4].shapes[0], { x: 12, y: 12 });
    // Independent candidate point must contain the prepared red pose.
    await expect.poll(() => pixel(page, target)).toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => pixel(page, { x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    if (mode === 'nested-movie')
      await expect
        .poll(() => pixel(page, worldPoint(expected.layers[0].keys[4].shapes[2], { x: 4, y: 4 })))
        .toEqual([0, 0, 255, 255]);
    await commit.click();
    await expect.poll(f.read).toEqual(expected);
    await expect(page.getByLabel('Updated trajectory selection')).toHaveText(
      `${4 * tracks.length} units · ${tracks.length} tracks · ${6 * tracks.length} artwork members`.replace(
        /^/,
        'Trajectory · ',
      ),
    );
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

async function late(page: Page, phase: 'capture' | 'movement' | 'release', action: string) {
  await page.evaluate(
    ({ phase, action }) => {
      Object.assign(window, { routeCanvasHook: false });
      const clone = structuredClone;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = clone(value, options),
          p = out as Project;
        if (
          p?.layers &&
          (phase === 'capture' ||
            (p.layers[0].motionSpans?.length === 1 &&
              p.layers[0].motionSpans[0].path?.startY === 60))
        ) {
          window.structuredClone = clone;
          const canvas = document.querySelector(
            'canvas[aria-label="Drawing stage"]',
          ) as HTMLCanvasElement;
          Object.assign(window, {
            routeCanvasHook: true,
            routeCanvasHookNative: canvas.hasPointerCapture(Number(canvas.dataset.routePointer)),
          });
          const check = (label: string, values: boolean[]) => {
            const n = document.querySelector(
              'input[aria-label="' + label + '"]',
            ) as HTMLInputElement;
            if (!n) throw Error('Missing ' + label);
            for (const checked of values) {
              n.checked = checked;
              n.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          if (action === 'source')
            (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
          else if (action === 'policy' || action === 'restored-policy')
            check(
              'Drag selection trajectory controls',
              action === 'policy' ? [false] : [false, true],
            );
          else if (action === 'target') {
            const n = document.querySelector(
              'input[aria-label="Selection trajectory base start Y"]',
            ) as HTMLInputElement;
            n.value = '77';
            n.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        return out;
      }) as typeof structuredClone;
    },
    { phase, action },
  );
}
for (const phase of ['capture', 'movement', 'release'] as const)
  for (const action of ['source', 'target', 'policy', 'restored-policy'])
    test('main trajectory canvas rejects ' + phase + ' ' + action, async ({ page }) => {
      const f = await begin(page),
        captured = () =>
          f.stage.evaluate((el) =>
            (el as HTMLCanvasElement).hasPointerCapture(
              Number((el as HTMLElement).dataset.routePointer),
            ),
          );
      if (phase === 'capture') await late(page, phase, action);
      await page.mouse.move(f.start.x, f.start.y);
      await page.mouse.down();
      if (phase !== 'capture') {
        expect(await captured()).toBe(true);
        if (phase === 'movement') await late(page, phase, action);
        await page.mouse.move(
          f.start.x + (26 * f.box.width) / f.size.width,
          f.start.y + (60 * f.box.height) / f.size.height,
        );
        if (phase === 'movement') {
          await expect
            .poll(() =>
              page.evaluate(
                () => (window as unknown as { routeCanvasHook: boolean }).routeCanvasHook,
              ),
            )
            .toBe(true);
          await expect.poll(captured).toBe(false);
        }
        if (phase === 'release') {
          await f.stage.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          expect(await captured()).toBe(true);
          await late(page, phase, action);
        }
      }
      await page.mouse.up();
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { routeCanvasHook: boolean }).routeCanvasHook),
        )
        .toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { routeCanvasHookNative: boolean }).routeCanvasHookNative,
        ),
      ).toBe(phase === 'movement');
      expect(await captured()).toBe(false);
      await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
      const after = await f.read();
      if (action === 'source') {
        expect(after.layers).toHaveLength(f.before.layers.length + 1);
        expect(after.layers.slice(0, 2)).toEqual(f.before.layers);
        await f.region
          .getByRole('button', { name: 'Return to authored stage', exact: true })
          .click();
        await f.stage.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.before);
      } else expect(after).toEqual(f.before);
      if (action === 'target')
        await expect(
          page.getByLabel('Selection trajectory base start Y', { exact: true }),
        ).toHaveValue('77');
      if (action === 'restored-policy' || action === 'target') {
        await f.stage.scrollIntoViewIfNeeded();
        await f.stage.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const b = (await f.stage.boundingBox())!,
          z = await f.stage.evaluate((el) => ({
            w: (el as HTMLCanvasElement).width / devicePixelRatio,
            h: (el as HTMLCanvasElement).height / devicePixelRatio,
          })),
          start = {
            x: b.x + ((z.w / 2 + f.point.x - 250) * b.width) / z.w,
            y: b.y + ((z.h / 2 + f.point.y - 150) * b.height) / z.h,
          };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        expect(await captured()).toBe(true);
        await page.mouse.move(start.x + (10 * b.width) / z.w, start.y + (20 * b.height) / z.h);
        await page.mouse.up();
        expect(await captured()).toBe(false);
        await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
        expect(await f.read()).toEqual(f.before);
      }
      expect(f.errors).toEqual([]);
    });
for (const mode of [
  'escape',
  'native-cancel',
  'capture-loss',
  'view',
  'frame',
  'group',
  'close',
  'numeric',
  'role',
  'track',
  'foreign',
  'proposed-pick',
  'gesture-track',
])
  test('main trajectory canvas lifetime ' + mode, async ({ page }) => {
    const f = await begin(
        page,
        mode === 'gesture-track' ? 'multi' : 'base',
        mode === 'gesture-track' ? ['base', 'extra'] : ['base'],
      ),
      captured = () =>
        f.stage.evaluate((el) =>
          (el as HTMLCanvasElement).hasPointerCapture(
            Number((el as HTMLElement).dataset.routePointer),
          ),
        );
    if (mode === 'proposed-pick') {
      await fill(page, ['base']);
      await f.stage.scrollIntoViewIfNeeded();
      const b = (await f.stage.boundingBox())!,
        z = await f.stage.evaluate((el) => ({
          w: (el as HTMLCanvasElement).width / devicePixelRatio,
          h: (el as HTMLCanvasElement).height / devicePixelRatio,
        }));
      await page.mouse.move(
        b.x + ((z.w / 2 + 46 - 250) * b.width) / z.w,
        b.y + ((z.h / 2 + 120 - 150) * b.height) / z.h,
      );
      await page.mouse.down();
      expect(await captured()).toBe(false);
      await page.mouse.up();
      expect(await f.read()).toEqual(f.before);
      expect(f.errors).toEqual([]);
      return;
    }
    await page.mouse.move(f.start.x, f.start.y);
    await page.mouse.down();
    expect(await captured()).toBe(true);
    await page.mouse.move(
      f.start.x + (26 * f.box.width) / f.size.width,
      f.start.y + (60 * f.box.height) / f.size.height,
    );
    if (mode === 'escape') await page.keyboard.press('Escape');
    else if (mode === 'native-cancel' || mode === 'capture-loss')
      await f.stage.evaluate((el, mode) => {
        const n = el as HTMLCanvasElement,
          id = Number(n.dataset.routePointer);
        if (mode === 'capture-loss') n.releasePointerCapture(id);
        else n.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: id }));
      }, mode);
    else if (mode === 'view')
      await f.stage.evaluate((el) => {
        el.style.width = el.getBoundingClientRect().width - 1 + 'px';
      });
    else if (mode === 'frame')
      await page
        .getByRole('button', { name: 'Next frame', exact: true })
        .evaluate((el) => (el as HTMLButtonElement).click());
    else if (mode === 'group')
      await f.region.getByLabel('Select complete sampled stage groups').evaluate((el) => {
        const n = el as HTMLInputElement;
        n.checked = true;
        n.dispatchEvent(new Event('change', { bubbles: true }));
      });
    else if (mode === 'close')
      await f.region
        .getByRole('button', { name: 'Return to authored stage', exact: true })
        .evaluate((el) => (el as HTMLButtonElement).click());
    else if (mode === 'numeric')
      await page.getByLabel('Selection trajectory base start Y', { exact: true }).evaluate((el) => {
        const n = el as HTMLInputElement;
        n.value = '77';
        n.dispatchEvent(new Event('input', { bubbles: true }));
      });
    else if (mode === 'role')
      await page.getByLabel('Selection trajectory control role', { exact: true }).evaluate((el) => {
        const n = el as HTMLSelectElement;
        n.value = 'end';
        n.dispatchEvent(new Event('change', { bubbles: true }));
      });
    else if (mode === 'gesture-track')
      await page
        .getByLabel('Selection trajectory gesture track', { exact: true })
        .evaluate((el) => {
          const n = el as HTMLSelectElement;
          n.value = 'extra';
          n.dispatchEvent(new Event('change', { bubbles: true }));
        });
    else if (mode === 'track')
      await f.editor.getByLabel('Sampled unit base/other', { exact: true }).evaluate((el) => {
        const n = el as HTMLInputElement;
        n.checked = false;
        n.dispatchEvent(new Event('change', { bubbles: true }));
      });
    else if (mode === 'foreign') {
      await f.stage.evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, pointerId: 99, clientX: 0, clientY: 0 }),
        ),
      );
      expect(await captured()).toBe(true);
      await page.keyboard.press('Escape');
    }
    await page.mouse.up();
    expect(await captured()).toBe(false);
    await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
    expect(await f.read()).toEqual(f.before);
    if (mode === 'gesture-track')
      await expect(
        page.getByLabel('Selection trajectory gesture track', { exact: true }),
      ).toHaveValue('extra');
    if (mode === 'numeric')
      await expect(
        page.getByLabel('Selection trajectory base start Y', { exact: true }),
      ).toHaveValue('77');
    if (mode === 'frame')
      await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
    expect(f.errors).toEqual([]);
  });

test('main trajectory canvas commit rejects close at final complete-data admission', async ({
  page,
}) => {
  const f = await begin(page);
  await page.mouse.move(f.start.x, f.start.y);
  await page.mouse.down();
  await page.mouse.move(
    f.start.x + (26 * f.box.width) / f.size.width,
    f.start.y + (60 * f.box.height) / f.size.height,
  );
  await page.mouse.up();
  await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
  await page.evaluate((id) => {
    const stringify = JSON.stringify,
      descriptors = Object.getOwnPropertyDescriptors;
    let completeReads = 0,
      armed = false,
      candidateReads = 0;
    Object.assign(window, { routeCanvasFinalReads: 0 });
    const field = (node: unknown, key: string) => {
      const n = node as [unknown, [string, unknown][]];
      return Array.isArray(n?.[1]) ? n[1].find((e) => e[0] === key)?.[1] : undefined;
    };
    const leaf = (node: unknown) => (node as unknown[])?.[1];
    JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
      const out = stringify(value, replacer as never, space),
        tree = value as unknown[][];
      if (tree?.[0]?.[0] === 'array' && tree[0][1] === 4) {
        const p = field(tree, '1'),
          path = field(field(field(field(field(p, 'layers'), '0'), 'motionSpans'), '0'), 'path');
        if (leaf(field(p, 'id')) === id && leaf(field(path, 'startY')) === 60) completeReads++;
      }
      const p = value as Project;
      if (completeReads === 7 && p?.id === id && p.layers && !p.layers[0].motionSpans?.[0].path) {
        armed = true;
        JSON.stringify = stringify;
      }
      return out;
    }) as typeof JSON.stringify;
    Object.getOwnPropertyDescriptors = ((value: unknown) => {
      const out = descriptors(value),
        p = value as Project;
      if (
        armed &&
        p?.id === id &&
        p.layers?.[0].motionSpans?.[0].path?.startY === 60 &&
        ++candidateReads === 4
      ) {
        Object.getOwnPropertyDescriptors = descriptors;
        Object.assign(window, { routeCanvasFinalReads: candidateReads });
        const button = Array.from(document.querySelectorAll('button')).find(
          (n) => n.textContent?.trim() === 'Return to authored stage',
        );
        if (!button) throw Error('Missing stage close');
        button.click();
      }
      return out;
    }) as typeof Object.getOwnPropertyDescriptors;
  }, f.before.id);
  await page.getByRole('button', { name: 'Commit selection trajectories', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { routeCanvasFinalReads: number }).routeCanvasFinalReads,
    ),
  ).toBe(4);
  expect(await f.read()).toEqual(f.before);
  await expect(f.region).toHaveCount(0);
  await expect(page.getByLabel('Updated trajectory selection')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
