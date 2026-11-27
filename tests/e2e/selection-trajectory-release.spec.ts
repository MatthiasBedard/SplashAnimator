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

async function releaseSetup(page: Page, mode = 'base', tracks = ['base'], author = true) {
  const f = await begin(page, mode, tracks);
  if (author)
    await page.getByLabel('Author selection trajectory on release', { exact: true }).check();
  const measure = async () => {
    await f.stage.scrollIntoViewIfNeeded();
    const box = (await f.stage.boundingBox())!,
      size = await f.stage.evaluate((el) => ({
        width: (el as HTMLCanvasElement).width / devicePixelRatio,
        height: (el as HTMLCanvasElement).height / devicePixelRatio,
      }));
    return {
      box,
      size,
      start: {
        x: box.x + ((size.width / 2 + f.point.x - 250) * box.width) / size.width,
        y: box.y + ((size.height / 2 + f.point.y - 150) * box.height) / size.height,
      },
    };
  };
  const captured = () =>
    f.stage.evaluate((el) =>
      (el as HTMLCanvasElement).hasPointerCapture(Number((el as HTMLElement).dataset.routePointer)),
    );
  return { ...f, measure, captured };
}
async function values(page: Page, tracks: string[]) {
  return Object.fromEntries(
    await Promise.all(
      tracks.map(async (layerId) => [
        layerId,
        Object.fromEntries(
          await Promise.all(
            ['startX', 'startY', 'endX', 'endY'].map(async (key) => [
              key,
              Number(
                await page
                  .getByLabel(
                    'Selection trajectory ' +
                      layerId +
                      ' ' +
                      key.replace('X', ' X').replace('Y', ' Y'),
                    { exact: true },
                  )
                  .inputValue(),
              ),
            ]),
          ),
        ),
      ]),
    ),
  ) as Record<string, typeof numbers.base>;
}
for (const mode of [
  'base',
  'end',
  'multi',
  'extra',
  'extra-end',
  'affine',
  'reflected',
  'compound',
  'curved',
  'aligned',
  'children',
  'nested-movie',
  'saved-flags',
  'css',
  'shift',
  'offset',
  'zero',
  'return',
  'draft',
])
  test('main trajectory direct release ' + mode, async ({ page }) => {
    const tracks = mode === 'multi' || mode.startsWith('extra') ? ['base', 'extra'] : ['base'],
      f = await releaseSetup(page, mode, tracks, mode !== 'draft'),
      { box, size, start } = await f.measure(),
      offset = mode === 'offset' ? { x: 3, y: 2 } : { x: 0, y: 0 };
    await page.mouse.move(start.x + offset.x, start.y + offset.y);
    await page.mouse.down();
    expect(await f.captured()).toBe(true);
    if (mode === 'zero') {
      await page.mouse.up();
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Updated trajectory selection')).toHaveCount(0);
      return;
    }
    if (mode === 'shift') await page.keyboard.down('Shift');
    await page.mouse.move(
      start.x + offset.x + ((mode === 'shift' ? 10 : 26) * box.width) / size.width,
      start.y + offset.y + (60 * box.height) / size.height,
    );
    expect(await f.read()).toEqual(f.before);
    expect(await f.captured()).toBe(true);
    if (mode === 'return') {
      await page.mouse.move(start.x + offset.x, start.y + offset.y);
      await page.mouse.up();
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Updated trajectory selection')).toHaveCount(0);
      return;
    }
    const input = await values(page, tracks),
      candidate = await oracle(page, f.before, tracks, input);
    await expect
      .poll(() =>
        pixel(
          page,
          worldPoint(candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes[0], {
            x: 12,
            y: 12,
          }),
        ),
      )
      .toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => pixel(page, { x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    if (mode === 'nested-movie')
      await expect
        .poll(() =>
          pixel(
            page,
            worldPoint(candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes[2], {
              x: 4,
              y: 4,
            }),
          ),
        )
        .toEqual([0, 0, 255, 255]);
    await page.mouse.up();
    if (mode === 'shift') await page.keyboard.up('Shift');
    expect(await f.captured()).toBe(false);
    if (mode === 'draft') {
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
      await page
        .getByRole('button', { name: 'Commit selection trajectories', exact: true })
        .click();
    }
    await expect.poll(f.read).toEqual(candidate);
    await expect(page.getByLabel('Updated trajectory selection')).toHaveText(
      `Trajectory · ${4 * tracks.length} units · ${tracks.length} tracks · ${6 * tracks.length} artwork members`,
    );
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(candidate);
    expect(f.errors).toEqual([]);
  });
async function armRelease(page: Page, phase: 'capture' | 'release', action: string) {
  await page.evaluate(
    ({ phase, action }) => {
      const clone = structuredClone;
      Object.assign(window, { trajectoryReleaseHook: false });
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = clone(value, options),
          p = out as Project;
        if (
          p?.layers &&
          (phase === 'capture' || (p.layers[0].motionSpans?.[0].path?.startY ?? 0) > 40)
        ) {
          window.structuredClone = clone;
          const canvas = document.querySelector(
            'canvas[aria-label="Drawing stage"]',
          ) as HTMLCanvasElement;
          Object.assign(window, {
            trajectoryReleaseHook: true,
            trajectoryReleaseNative: canvas.hasPointerCapture(Number(canvas.dataset.routePointer)),
            trajectoryReleaseComplete: !!p.layers[0].motionSpans?.[0].path,
          });
          const check = (label: string, vals: boolean[]) => {
            const n = document.querySelector(
              'input[aria-label="' + label + '"]',
            ) as HTMLInputElement;
            for (const v of vals) {
              n.checked = v;
              n.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          if (action === 'source')
            (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
          else if (action === 'author' || action === 'restored-author')
            check(
              'Author selection trajectory on release',
              action === 'author' ? [false] : [false, true],
            );
          else if (action === 'restored-gesture')
            check('Drag selection trajectory controls', [false, true]);
          else if (action === 'close') {
            const b = Array.from(document.querySelectorAll('button')).find(
              (n) => n.textContent?.trim() === 'Return to authored stage',
            );
            if (!b) throw Error('Missing close');
            b.click();
          } else if (action === 'target') {
            const n = document.querySelector(
              'input[aria-label="Selection trajectory base start Y"]',
            ) as HTMLInputElement;
            n.value = '77';
            n.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (action === 'view') canvas.style.width = '600px';
          else if (action === 'output') p.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
        }
        return out;
      }) as typeof structuredClone;
    },
    { phase, action },
  );
}
for (const phase of ['capture', 'release'] as const)
  for (const action of [
    'source',
    'target',
    'author',
    'restored-author',
    'restored-gesture',
    'close',
    'view',
  ])
    test('main trajectory direct release rejects ' + phase + ' ' + action, async ({ page }) => {
      const f = await releaseSetup(page),
        { box, size, start } = await f.measure();
      if (phase === 'capture') await armRelease(page, phase, action);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (phase === 'release') {
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          start.x + (26 * box.width) / size.width,
          start.y + (60 * box.height) / size.height,
        );
        await f.stage.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await armRelease(page, phase, action);
      }
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { trajectoryReleaseHook: boolean }).trajectoryReleaseHook,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { trajectoryReleaseNative: boolean }).trajectoryReleaseNative,
        ),
      ).toBe(false);
      if (phase === 'release')
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { trajectoryReleaseComplete: boolean })
                .trajectoryReleaseComplete,
          ),
        ).toBe(true);
      expect(await f.captured()).toBe(false);
      await expect(page.getByLabel('Updated trajectory selection')).toHaveCount(0);
      if (action === 'source') {
        const after = await f.read();
        expect(after.layers).toHaveLength(f.before.layers.length + 1);
        expect(after.layers.slice(0, 2)).toEqual(f.before.layers);
        await f.region
          .getByRole('button', { name: 'Return to authored stage', exact: true })
          .click();
        await f.stage.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.before);
      } else expect(await f.read()).toEqual(f.before);
      if (action === 'target')
        await expect(
          page.getByLabel('Selection trajectory base start Y', { exact: true }),
        ).toHaveValue('77');
      if (['author', 'restored-author', 'restored-gesture', 'target'].includes(action)) {
        await page.getByLabel('Author selection trajectory on release', { exact: true }).uncheck();
        const again = await f.measure();
        await page.mouse.move(again.start.x, again.start.y);
        await page.mouse.down();
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          again.start.x + (13 * again.box.width) / again.size.width,
          again.start.y + (25 * again.box.height) / again.size.height,
        );
        await page.mouse.up();
        await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
        expect(await f.read()).toEqual(f.before);
        await page.getByLabel('Author selection trajectory on release', { exact: true }).check();
        const last = await f.measure();
        await page.mouse.move(last.start.x, last.start.y);
        await page.mouse.down();
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          last.start.x + (15 * last.box.width) / last.size.width,
          last.start.y + (28 * last.box.height) / last.size.height,
        );
        await page.mouse.up();
        await expect(page.getByLabel('Updated trajectory selection')).toBeVisible();
      }
      expect(f.errors).toEqual([]);
    });

async function armPublication(page: Page, id: string, action: string) {
  await page.evaluate(
    ({ id, action }) => {
      const clone = structuredClone,
        parse = JSON.parse,
        descriptors = Object.getOwnPropertyDescriptors;
      let complete = false,
        armed = false;
      Object.assign(window, { routeReleasePublicationHook: false, routeReleaseBeforeImage: false });
      const edited = (p: Project) =>
        p?.id === id && (p.layers?.[0].motionSpans?.[0].path?.startY ?? 0) > 40;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = clone(value, options);
        if (edited(out as Project)) {
          complete = true;
          window.structuredClone = clone;
        }
        return out;
      }) as typeof structuredClone;
      JSON.parse = ((text: string, reviver?: never) => {
        const out = parse(text, reviver),
          p = out as Project;
        if (complete && p?.id === id && p.layers && !p.layers[0].motionSpans?.[0].path) {
          armed = true;
          JSON.parse = parse;
          Object.assign(window, { routeReleaseBeforeImage: true });
        }
        return out;
      }) as typeof JSON.parse;
      Object.getOwnPropertyDescriptors = ((value: unknown) => {
        const out = descriptors(value);
        if (armed && edited(value as Project)) {
          Object.getOwnPropertyDescriptors = descriptors;
          const canvas = document.querySelector(
            'canvas[aria-label="Drawing stage"]',
          ) as HTMLCanvasElement;
          Object.assign(window, {
            routeReleasePublicationHook: true,
            routeReleasePublicationNative: canvas.hasPointerCapture(
              Number(canvas.dataset.routePointer),
            ),
          });
          const check = (label: string) => {
            const n = document.querySelector(
              'input[aria-label="' + label + '"]',
            ) as HTMLInputElement;
            for (const v of [false, true]) {
              n.checked = v;
              n.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          if (action === 'source')
            (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
          else if (action === 'restored-author') check('Author selection trajectory on release');
          else if (action === 'restored-gesture') check('Drag selection trajectory controls');
          else if (action === 'target') {
            const n = document.querySelector(
              'input[aria-label="Selection trajectory base start Y"]',
            ) as HTMLInputElement;
            n.value = '77';
            n.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (action === 'close') {
            const b = Array.from(document.querySelectorAll('button')).find(
              (n) => n.textContent?.trim() === 'Return to authored stage',
            );
            if (!b) throw Error('Missing close');
            b.click();
          } else if (action === 'view') canvas.style.width = '600px';
          else (value as Project).layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
        }
        return out;
      }) as typeof Object.getOwnPropertyDescriptors;
    },
    { id, action },
  );
}
for (const action of [
  'source',
  'target',
  'restored-author',
  'restored-gesture',
  'close',
  'view',
  'output',
])
  test(
    'main trajectory direct release rejects complete publication ' + action,
    async ({ page }) => {
      const f = await releaseSetup(page),
        { box, size, start } = await f.measure();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      expect(await f.captured()).toBe(true);
      await page.mouse.move(
        start.x + (26 * box.width) / size.width,
        start.y + (60 * box.height) / size.height,
      );
      await f.stage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await armPublication(page, f.before.id, action);
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { routeReleaseBeforeImage: boolean }).routeReleaseBeforeImage,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { routeReleasePublicationHook: boolean })
              .routeReleasePublicationHook,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { routeReleasePublicationNative: boolean })
              .routeReleasePublicationNative,
        ),
      ).toBe(false);
      expect(await f.captured()).toBe(false);
      await expect(page.getByLabel('Updated trajectory selection')).toHaveCount(0);
      if (action === 'source') {
        const after = await f.read();
        expect(after.layers).toHaveLength(f.before.layers.length + 1);
        expect(after.layers.slice(0, 2)).toEqual(f.before.layers);
        await f.region
          .getByRole('button', { name: 'Return to authored stage', exact: true })
          .click();
        await f.stage.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.before);
      } else expect(await f.read()).toEqual(f.before);
      if (action === 'target')
        await expect(
          page.getByLabel('Selection trajectory base start Y', { exact: true }),
        ).toHaveValue('77');
      expect(f.errors).toEqual([]);
    },
  );
test('main trajectory direct release rejects modified complete cloned output', async ({ page }) => {
  const f = await releaseSetup(page),
    { box, size, start } = await f.measure();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(
    start.x + (26 * box.width) / size.width,
    start.y + (60 * box.height) / size.height,
  );
  await f.stage.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await armRelease(page, 'release', 'output');
  await page.mouse.up();
  expect(
    await page.evaluate(
      () => (window as unknown as { trajectoryReleaseHook: boolean }).trajectoryReleaseHook,
    ),
  ).toBe(true);
  expect(await f.captured()).toBe(false);
  expect(await f.read()).toEqual(f.before);
  await expect(page.getByLabel('Updated trajectory selection')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
