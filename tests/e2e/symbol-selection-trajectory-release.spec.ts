import { test, expect, type Page } from '@playwright/test';
import {
  newProject,
  symbolLayers,
  type Project,
  type Vector,
  type SymbolDefinition,
} from '../../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
import { captureSymbolRememberedSelectionAuthoringFrame } from '../../packages/animation/src/symbol-selection-motion-owner';
import { worldPoint } from '../../packages/geometry/src';
function motionFixture(mode: string) {
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

function fixture(mode: string) {
  const original = motionFixture(mode),
    base = original.layers[0];
  const definition: SymbolDefinition = {
    id: 'selection',
    name: 'Selection',
    width: 500,
    height: 300,
    buttonStates: { up: 0, over: 4, down: 8, hit: 12 },
    multiFramePivot: { x: 7, y: 9 },
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: original.layers.slice(1),
    },
  };
  const p = newProject();
  p.width = 500;
  p.height = 300;
  p.duration = 14;
  p.symbols = [...(original.symbols ?? []), definition];
  p.assets = original.assets;
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          id: 'instance',
          kind: 'symbol',
          symbolId: 'selection',
          x: 0,
          y: 0,
          width: 500,
          height: 300,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
  ];
  return p;
}

const offsets = { startX: 26, startY: 60, endX: -18, endY: 40 };
const labels = { startX: 'start X', startY: 'start Y', endX: 'end X', endY: 'end Y' } as const;
const requests = (tracks: string[]) =>
  tracks.flatMap((layerId) => ['r', 'b', 'other', 'd'].map((shapeId) => ({ layerId, shapeId })));
async function setup(page: Page, mode = 'base', tracks = ['@base']) {
  await page.setViewportSize({ width: 1800, height: 1600 });
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    fixture(mode),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    before = await read(),
    definition = before.symbols!.find((s) => s.id === 'selection')!;
  await page
    .getByRole('group', { name: 'Symbol Selection', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const frame = page.getByLabel('Symbol frame', { exact: true });
  await frame.fill('5');
  await frame.press('Tab');
  await page.getByLabel('Show sampled symbol stage', { exact: true }).check();
  const toggle = page.getByLabel('Select multiple sampled symbol units', { exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.check();
  const editor = page.getByRole('group', { name: 'Sampled symbol selection set', exact: true }),
    stage = page.getByLabel('Sampled symbol stage', { exact: true });
  for (const r of requests(tracks))
    await editor
      .getByLabel('Sampled symbol unit ' + r.layerId + '/' + r.shapeId, { exact: true })
      .check();
  return { read, before, definition, editor, stage, errors };
}
async function fill(page: Page, tracks: string[]) {
  for (const track of tracks)
    for (const field of Object.keys(labels) as (keyof typeof labels)[])
      await page
        .getByLabel('Symbol selection trajectory ' + track + ' ' + labels[field], { exact: true })
        .fill(String(offsets[field]));
}
function expected(
  project: Project,
  definition: SymbolDefinition,
  tracks: string[],
  values: Record<string, typeof offsets>,
) {
  const source = {
      definition,
      symbols: project.symbols!,
      assets: project.assets,
      frame: 4,
      revision: 0,
    },
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => source);
  try {
    return cap.prepareTrajectories(
      requests(tracks),
      tracks.map((layerId) => ({
        layerId,
        shapeId: 'r',
        path: {
          ...symbolLayers(definition).find((l) => l.id === layerId)!.motionSpans![0].path,
          ...values[layerId],
        },
      })),
    );
  } finally {
    cap.dispose();
  }
}

async function begin(page: Page, mode = 'base', tracks = ['@base']) {
  const f = await setup(page, mode, tracks);
  await f.editor.getByLabel('Edit sampled symbol selection trajectories', { exact: true }).check();
  if (tracks.length > 1) await fill(page, tracks);
  const role = mode === 'end' || mode === 'extra-end' ? 'end' : 'start',
    layerId = mode.startsWith('extra') ? 'extra' : '@base';
  await page
    .getByLabel('Symbol selection trajectory gesture track', { exact: true })
    .selectOption(layerId);
  await page
    .getByLabel('Symbol selection trajectory control role', { exact: true })
    .selectOption(role);
  await page.getByLabel('Drag symbol selection trajectory controls', { exact: true }).check();
  if (mode === 'css')
    await f.stage.evaluate((el) => {
      el.style.width = '675px';
      el.style.height = '264px';
    });
  await f.stage.scrollIntoViewIfNeeded();
  await f.stage.evaluate((el) => {
    for (const type of ['pointerdown', 'pointermove', 'pointerup'])
      el.addEventListener(type, (event) => {
        const e = event as PointerEvent;
        el.dataset[type] = JSON.stringify({ x: e.clientX, y: e.clientY });
        if (type === 'pointerdown') el.dataset.pointer = String(e.pointerId);
      });
  });
  const layer = symbolLayers(f.definition).find((l) => l.id === layerId)!,
    span = layer.motionSpans![0],
    anchor = layer.keys.find((k) => k.frame === (role === 'start' ? span.start : span.end))!
      .shapes[0],
    offset = {
      x: span.path?.[role === 'start' ? 'startX' : 'endX'] ?? 0,
      y: span.path?.[role === 'start' ? 'startY' : 'endY'] ?? 0,
    },
    point = { x: anchor.x + offset.x, y: anchor.y + offset.y },
    scale = Math.min(500 / f.definition.width, 290 / f.definition.height);
  const measure = async () => {
    const box = (await f.stage.boundingBox())!;
    return {
      box,
      start: {
        x: box.x + ((20 + point.x * scale) * box.width) / 540,
        y: box.y + ((20 + point.y * scale) * box.height) / 330,
      },
    };
  };
  const captured = () =>
    f.stage.evaluate((el) =>
      (el as HTMLCanvasElement).hasPointerCapture(Number(el.dataset.pointer)),
    );
  const field = (axis: string) =>
    page.getByLabel('Symbol selection trajectory ' + layerId + ' ' + role + ' ' + axis, {
      exact: true,
    });
  return { ...f, role, layerId, offset, point, scale, measure, captured, field };
}

async function releaseSetup(page: Page, mode = 'base', tracks = ['@base'], author = true) {
  const f = await begin(page, mode, tracks);
  if (author)
    await page.getByLabel('Author symbol selection trajectory on release', { exact: true }).check();
  await f.stage.scrollIntoViewIfNeeded();
  const native = (await f.stage.elementHandle())!,
    captured = () =>
      native.evaluate((el) =>
        (el as HTMLCanvasElement).hasPointerCapture(Number((el as HTMLElement).dataset.pointer)),
      );
  return { ...f, native, captured };
}
async function controls(page: Page, tracks: string[]) {
  const values: Record<string, typeof offsets> = {};
  for (const id of tracks) {
    const v = { ...offsets };
    for (const key of Object.keys(labels) as (keyof typeof labels)[])
      v[key] = Number(
        await page
          .getByLabel('Symbol selection trajectory ' + id + ' ' + labels[key], { exact: true })
          .inputValue(),
      );
    values[id] = v;
  }
  return values;
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
  'saved-flags',
  'children',
  'nested-movie',
  'css',
  'shift',
  'offset',
  'zero',
  'return',
  'draft',
])
  test('isolated trajectory direct release ' + mode, async ({ page }) => {
    const tracks = mode === 'multi' || mode.startsWith('extra') ? ['@base', 'extra'] : ['@base'],
      f = await releaseSetup(page, mode, tracks, mode !== 'draft'),
      { box, start } = await f.measure(),
      offset = mode === 'offset' ? { x: 3, y: 2 } : { x: 0, y: 0 };
    await page.mouse.move(start.x + offset.x, start.y + offset.y);
    await page.mouse.down();
    expect(await f.captured()).toBe(true);
    if (mode === 'zero') {
      await page.mouse.up();
      expect(await f.captured()).toBe(false);
      expect(await f.read()).toEqual(f.before);
      await expect(
        page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      ).toBeDisabled();
      return;
    }
    if (mode === 'shift') await page.keyboard.down('Shift');
    await page.mouse.move(
      start.x + offset.x + ((mode === 'shift' ? 10 : 26) * f.scale * box.width) / 540,
      start.y + offset.y + (60 * f.scale * box.height) / 330,
    );
    const values = await controls(page, tracks),
      candidate = expected(f.before, f.definition, tracks, values),
      sampled = symbolLayers(candidate)[0].keys.find((k) => k.frame === 4)!,
      pixel = (p: { x: number; y: number }) =>
        f.stage.evaluate(
          (el, p) => [
            ...(el as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(Math.round(20 + p.x * p.scale), Math.round(20 + p.y * p.scale), 1, 1)
              .data,
          ],
          { ...p, scale: f.scale },
        );
    expect(await f.read()).toEqual(f.before);
    expect(await f.captured()).toBe(true);
    if (mode === 'return') {
      await page.mouse.move(start.x + offset.x, start.y + offset.y);
      await page.mouse.up();
      expect(await f.captured()).toBe(false);
      await expect(
        page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      ).toBeDisabled();
      expect(await f.read()).toEqual(f.before);
      return;
    }
    await expect
      .poll(() => pixel(worldPoint(sampled.shapes[0], { x: 12, y: 12 })))
      .toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    if (mode === 'nested-movie')
      await expect
        .poll(() => pixel(worldPoint(sampled.shapes[2], { x: 4, y: 4 })))
        .toEqual([0, 0, 255, 255]);
    await page.mouse.up();
    if (mode === 'shift') await page.keyboard.up('Shift');
    expect(await f.captured()).toBe(false);
    if (mode === 'draft') {
      await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      ).toBeDisabled();
      await page
        .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
        .click();
    }
    await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveText(
      `Trajectory · ${4 * tracks.length} units · ${tracks.length} tracks · ${6 * tracks.length} artwork members`,
    );
    expect(await f.read()).toEqual(f.before);
    if (!['compound', 'curved', 'aligned'].includes(mode)) {
      await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
      await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
      await page.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
      await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const result = {
      ...f.before,
      symbols: f.before.symbols!.map((s) => (s.id === candidate.id ? candidate : s)),
    };
    await expect.poll(f.read).toEqual(result);
    if (!['compound', 'curved', 'aligned'].includes(mode)) {
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
      expect(await f.read()).toEqual(f.before);
      await page.keyboard.press('Control+Shift+z');
      expect(await f.read()).toEqual(result);
    }
    expect(f.errors).toEqual([]);
  });
async function armRelease(page: Page, phase: 'capture' | 'release', action: string) {
  await page.evaluate(
    ({ phase, action }) => {
      const clone = structuredClone;
      Object.assign(window, { isolatedReleaseHook: false });
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = clone(value, options),
          d = out as SymbolDefinition;
        if (
          d?.id === 'selection' &&
          (phase === 'capture' || (d.timeline?.motionSpans?.[0].path?.startY ?? 0) > 40)
        ) {
          window.structuredClone = clone;
          const canvas = document.querySelector(
            'canvas[aria-label="Sampled symbol stage"]',
          ) as HTMLCanvasElement;
          Object.assign(window, {
            isolatedReleaseHook: true,
            isolatedReleaseNative: canvas.hasPointerCapture(Number(canvas.dataset.pointer)),
            isolatedReleaseComplete: !!d.timeline?.motionSpans?.[0].path,
          });
          const check = (label: string, vals: boolean[]) => {
            const n = document.querySelector(
              'input[aria-label="' + label + '"]',
            ) as HTMLInputElement;
            if (!n) throw Error('Missing ' + label);
            for (const v of vals) {
              n.checked = v;
              n.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          const input = (label: string, value: string, type = 'input') => {
            const n = document.querySelector(
              'input[aria-label="' + label + '"]',
            ) as HTMLInputElement;
            if (!n) throw Error('Missing ' + label);
            n.value = value;
            n.dispatchEvent(new Event(type, { bubbles: true }));
          };
          if (action === 'source') input('Symbol duration', '15', 'change');
          else if (action === 'target') input('Symbol selection trajectory @base start Y', '77');
          else if (action === 'author' || action === 'restored-author')
            check(
              'Author symbol selection trajectory on release',
              action === 'author' ? [false] : [false, true],
            );
          else if (action === 'restored-gesture')
            check('Drag symbol selection trajectory controls', [false, true]);
          else if (action === 'group') check('Select complete sampled symbol groups', [true]);
          else if (action === 'frame') input('Symbol frame', '6', 'change');
          else if (action === 'close') check('Show sampled symbol stage', [false]);
          else if (action === 'view') canvas.style.width = '600px';
          else d.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x++;
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
    'frame',
    'group',
    'view',
  ])
    test('isolated trajectory direct release rejects ' + phase + ' ' + action, async ({ page }) => {
      const f = await releaseSetup(page),
        { box, start } = await f.measure();
      if (phase === 'capture') await armRelease(page, phase, action);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (phase === 'release') {
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          start.x + (26 * f.scale * box.width) / 540,
          start.y + (60 * f.scale * box.height) / 330,
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
          () => (window as unknown as { isolatedReleaseHook: boolean }).isolatedReleaseHook,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { isolatedReleaseNative: boolean }).isolatedReleaseNative,
        ),
      ).toBe(false);
      if (phase === 'release')
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { isolatedReleaseComplete: boolean }).isolatedReleaseComplete,
          ),
        ).toBe(true);
      expect(await f.captured()).toBe(false);
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
      if (action === 'source') {
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('15');
        await page
          .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
          .click();
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
      } else
        await expect(
          page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
        ).toBeDisabled();
      if (action === 'frame')
        await expect(page.getByLabel('Symbol frame', { exact: true })).toHaveValue('6');
      if (action === 'close')
        await expect(
          page.getByLabel('Show sampled symbol stage', { exact: true }),
        ).not.toBeChecked();
      if (action === 'target')
        await expect(
          page.getByLabel('Symbol selection trajectory @base start Y', { exact: true }),
        ).toHaveValue('77');
      if (['target', 'author', 'restored-author', 'restored-gesture'].includes(action)) {
        await page
          .getByLabel('Author symbol selection trajectory on release', { exact: true })
          .uncheck();
        const again = await f.measure();
        await page.mouse.move(again.start.x, again.start.y);
        await page.mouse.down();
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          again.start.x + (13 * f.scale * again.box.width) / 540,
          again.start.y + (25 * f.scale * again.box.height) / 330,
        );
        await page.mouse.up();
        await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
        ).toBeDisabled();
        await page
          .getByLabel('Author symbol selection trajectory on release', { exact: true })
          .check();
        const last = await f.measure();
        await page.mouse.move(last.start.x, last.start.y);
        await page.mouse.down();
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          last.start.x + (15 * f.scale * last.box.width) / 540,
          last.start.y + (28 * f.scale * last.box.height) / 330,
        );
        await page.mouse.up();
        await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
        expect(await f.read()).toEqual(f.before);
      }
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await f.read()).toEqual(f.before);
      expect(f.errors).toEqual([]);
    });

async function armPublication(page: Page, action: string) {
  await page.evaluate((action) => {
    const stringify = JSON.stringify,
      parse = JSON.parse,
      descriptors = Object.getOwnPropertyDescriptors;
    let parent = false,
      before = false,
      encoded = false;
    Object.assign(window, {
      symbolReleasePublicationHook: false,
      symbolReleaseParent: false,
      symbolReleaseBefore: false,
      symbolReleaseEncoded: false,
    });
    const edited = (value: unknown) => {
      const d = value as SymbolDefinition;
      return d?.id === 'selection' && (d.timeline?.motionSpans?.[0].path?.startY ?? 0) > 40;
    };
    JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
      const out = stringify(value, replacer as never, space),
        v = value as unknown[];
      if (
        Array.isArray(v) &&
        v.length === 11 &&
        (v[0] as SymbolDefinition)?.id === 'selection' &&
        Array.isArray(v[1]) &&
        Array.isArray(v[2]) &&
        v[3] === 4 &&
        v[10] === true
      ) {
        parent = true;
        Object.assign(window, { symbolReleaseParent: true });
      }
      if (parent && before && edited(value)) {
        encoded = true;
        Object.assign(window, { symbolReleaseEncoded: true });
        JSON.stringify = stringify;
      }
      return out;
    }) as typeof JSON.stringify;
    JSON.parse = ((text: string, reviver?: never) => {
      const out = parse(text, reviver),
        d = out as SymbolDefinition;
      if (parent && d?.id === 'selection' && !d.timeline?.motionSpans?.[0].path) {
        before = true;
        Object.assign(window, { symbolReleaseBefore: true });
        JSON.parse = parse;
      }
      return out;
    }) as typeof JSON.parse;
    Object.getOwnPropertyDescriptors = ((value: unknown) => {
      const out = descriptors(value);
      if (encoded && edited(value)) {
        Object.getOwnPropertyDescriptors = descriptors;
        const canvas = document.querySelector(
          'canvas[aria-label="Sampled symbol stage"]',
        ) as HTMLCanvasElement;
        Object.assign(window, {
          symbolReleasePublicationHook: true,
          symbolReleasePublicationNative: canvas.hasPointerCapture(Number(canvas.dataset.pointer)),
        });
        const input = (label: string, value: string, type = 'input') => {
          const n = document.querySelector('input[aria-label="' + label + '"]') as HTMLInputElement;
          if (!n) throw Error('Missing ' + label);
          n.value = value;
          n.dispatchEvent(new Event(type, { bubbles: true }));
        };
        const check = (label: string, vals: boolean[]) => {
          const n = document.querySelector('input[aria-label="' + label + '"]') as HTMLInputElement;
          if (!n) throw Error('Missing ' + label);
          for (const v of vals) {
            n.checked = v;
            n.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        if (action === 'source') input('Symbol duration', '15', 'change');
        else if (action === 'target') input('Symbol selection trajectory @base start Y', '77');
        else if (action === 'restored-author')
          check('Author symbol selection trajectory on release', [false, true]);
        else if (action === 'restored-gesture')
          check('Drag symbol selection trajectory controls', [false, true]);
        else if (action === 'frame') input('Symbol frame', '6', 'change');
        else if (action === 'close') check('Show sampled symbol stage', [false]);
        else (value as SymbolDefinition).timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x++;
      }
      return out;
    }) as typeof Object.getOwnPropertyDescriptors;
  }, action);
}
for (const action of [
  'source',
  'target',
  'restored-author',
  'restored-gesture',
  'frame',
  'close',
  'output',
])
  test(
    'isolated trajectory direct release rejects complete parent publication ' + action,
    async ({ page }) => {
      const f = await releaseSetup(page),
        { box, start } = await f.measure();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      expect(await f.captured()).toBe(true);
      await page.mouse.move(
        start.x + (26 * f.scale * box.width) / 540,
        start.y + (60 * f.scale * box.height) / 330,
      );
      await f.stage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await armPublication(page, action);
      await page.mouse.up();
      for (const name of [
        'symbolReleaseParent',
        'symbolReleaseBefore',
        'symbolReleaseEncoded',
        'symbolReleasePublicationHook',
      ])
        expect(
          await page.evaluate((name) => (window as unknown as Record<string, boolean>)[name], name),
        ).toBe(true);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { symbolReleasePublicationNative: boolean })
              .symbolReleasePublicationNative,
        ),
      ).toBe(false);
      expect(await f.captured()).toBe(false);
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
      if (action === 'source') {
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('15');
        await page
          .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
          .click();
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
      } else
        await expect(
          page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
        ).toBeDisabled();
      if (action === 'target')
        await expect(
          page.getByLabel('Symbol selection trajectory @base start Y', { exact: true }),
        ).toHaveValue('77');
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await f.read()).toEqual(f.before);
      expect(f.errors).toEqual([]);
    },
  );
test('isolated trajectory direct release rejects modified complete clone', async ({ page }) => {
  const f = await releaseSetup(page),
    { box, start } = await f.measure();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(
    start.x + (26 * f.scale * box.width) / 540,
    start.y + (60 * f.scale * box.height) / 330,
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
      () => (window as unknown as { isolatedReleaseHook: boolean }).isolatedReleaseHook,
    ),
  ).toBe(true);
  expect(await f.captured()).toBe(false);
  expect(await f.read()).toEqual(f.before);
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
