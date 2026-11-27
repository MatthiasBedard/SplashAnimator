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
  'prior',
])
  test('isolated trajectory canvas drafts ' + mode, async ({ page }) => {
    const tracks = mode === 'multi' || mode.startsWith('extra') ? ['@base', 'extra'] : ['@base'],
      f = await begin(page, mode, tracks);
    const commit = page.getByRole('button', {
      name: 'Commit symbol selection trajectories',
      exact: true,
    });
    if (mode === 'prior') {
      await fill(page, tracks);
      await page
        .getByRole('button', { name: 'Preview symbol selection trajectories', exact: true })
        .click();
      await f.stage.scrollIntoViewIfNeeded();
    }
    const { box, start } = await f.measure(),
      offset = mode === 'offset' ? { x: 3, y: 2 } : { x: 0, y: 0 };
    const marker = await f.stage.evaluate((el, point) => {
      const c = el as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        sx = c.width / r.width,
        sy = c.height / r.height,
        data = c
          .getContext('2d')!
          .getImageData(
            Math.floor((point.x - r.left - 7) * sx),
            Math.floor((point.y - r.top - 7) * sy),
            Math.ceil(14 * sx),
            Math.ceil(14 * sy),
          ).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 120 && data[i + 1] > 100 && data[i + 2] > 130 && data[i + 3] === 255) n++;
      return n;
    }, start);
    expect(marker).toBeGreaterThan(8);
    await page.mouse.move(start.x + offset.x, start.y + offset.y);
    await page.mouse.down();
    expect(await f.captured()).toBe(true);
    await expect(commit).toBeDisabled();
    if (mode === 'zero') {
      await page.mouse.up();
      expect(await f.captured()).toBe(false);
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Symbol selection trajectory proposal')).toHaveCount(0);
      return;
    }
    if (mode === 'shift') await page.keyboard.down('Shift');
    await page.mouse.move(
      start.x + offset.x + ((mode === 'shift' ? 10 : 26) * f.scale * box.width) / 540,
      start.y + offset.y + (60 * f.scale * box.height) / 330,
      { steps: 1 },
    );
    const delivered = await f.stage.evaluate((el) => ({
      a: JSON.parse(el.dataset.pointerdown!),
      b: JSON.parse(el.dataset.pointermove!),
    }));
    let dx = ((delivered.b.x - delivered.a.x) * 540) / box.width / f.scale,
      dy = ((delivered.b.y - delivered.a.y) * 330) / box.height / f.scale;
    if (mode === 'shift') {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    await expect(f.field('X')).toHaveValue(String(f.offset.x + dx));
    await expect(f.field('Y')).toHaveValue(String(f.offset.y + dy));
    expect(await f.read()).toEqual(f.before);
    if (mode === 'return') {
      await page.mouse.move(start.x + offset.x, start.y + offset.y);
      await page.mouse.up();
      await expect(f.field('X')).toHaveValue('0');
      await expect(f.field('Y')).toHaveValue('0');
      await expect(page.getByLabel('Symbol selection trajectory proposal')).toHaveCount(0);
      return;
    }
    if (mode === 'prior') {
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(f.field('X')).toHaveValue(String(offsets.startX));
      await expect(f.field('Y')).toHaveValue(String(offsets.startY));
      await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
      expect(await f.captured()).toBe(false);
      return;
    }
    await page.mouse.up();
    if (mode === 'shift') await page.keyboard.up('Shift');
    expect(await f.captured()).toBe(false);
    await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
    expect(await f.read()).toEqual(f.before);
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
    const candidate = expected(f.before, f.definition, tracks, values),
      sampled = symbolLayers(candidate)[0].keys.find((k) => k.frame === 4)!,
      pixel = (point: { x: number; y: number }) =>
        f.stage.evaluate(
          (el, p) => [
            ...(el as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(Math.round(20 + p.x * p.scale), Math.round(20 + p.y * p.scale), 1, 1)
              .data,
          ],
          { ...point, scale: f.scale },
        );
    await expect
      .poll(() => pixel(worldPoint(sampled.shapes[0], { x: 12, y: 12 })))
      .toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    if (mode === 'nested-movie')
      await expect
        .poll(() => pixel(worldPoint(sampled.shapes[2], { x: 4, y: 4 })))
        .toEqual([0, 0, 255, 255]);
    await commit.click();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveText(
      `Trajectory · ${4 * tracks.length} units · ${tracks.length} tracks · ${6 * tracks.length} artwork members`,
    );
    expect(await f.read()).toEqual(f.before);
    await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
    await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const result = {
      ...f.before,
      symbols: f.before.symbols!.map((s) => (s.id === candidate.id ? candidate : s)),
    };
    await expect.poll(f.read).toEqual(result);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(result);
    expect(f.errors).toEqual([]);
  });

async function armCanvas(page: Page, phase: 'capture' | 'movement' | 'release', action: string) {
  await page.evaluate(
    ({ phase, action }) => {
      Object.assign(window, { isolatedCanvasHook: false });
      const clone = structuredClone;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = clone(value, options),
          d = out as SymbolDefinition;
        if (
          d?.id === 'selection' &&
          d.timeline?.motionSpans?.length === 1 &&
          (phase === 'capture' || (d.timeline.motionSpans[0].path?.startY ?? 0) > 40)
        ) {
          window.structuredClone = clone;
          const canvas = document.querySelector(
            'canvas[aria-label="Sampled symbol stage"]',
          ) as HTMLCanvasElement;
          Object.assign(window, {
            isolatedCanvasHook: true,
            isolatedCanvasNative: canvas.hasPointerCapture(Number(canvas.dataset.pointer)),
          });
          if (action === 'restored-policy') {
            const node = document.querySelector(
              'input[aria-label="Drag symbol selection trajectory controls"]',
            ) as HTMLInputElement;
            for (const value of [false, true]) {
              node.checked = value;
              node.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else {
            const node = document.querySelector(
              'input[aria-label="' +
                (action === 'source'
                  ? 'Symbol duration'
                  : 'Symbol selection trajectory @base start Y') +
                '"]',
            ) as HTMLInputElement;
            node.value = action === 'source' ? '15' : '77';
            node.dispatchEvent(
              new Event(action === 'source' ? 'change' : 'input', { bubbles: true }),
            );
          }
        }
        return out;
      }) as typeof structuredClone;
    },
    { phase, action },
  );
}
for (const phase of ['capture', 'movement', 'release'] as const)
  for (const action of ['source', 'target', 'restored-policy'])
    test('isolated trajectory canvas rejects ' + phase + ' ' + action, async ({ page }) => {
      const f = await begin(page),
        { box, start } = await f.measure();
      if (phase === 'capture') await armCanvas(page, phase, action);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (phase !== 'capture') {
        expect(await f.captured()).toBe(true);
        if (phase === 'movement') await armCanvas(page, phase, action);
        await page.mouse.move(
          start.x + (26 * f.scale * box.width) / 540,
          start.y + (60 * f.scale * box.height) / 330,
        );
        if (phase === 'release') {
          await f.stage.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
          expect(await f.captured()).toBe(true);
          await armCanvas(page, phase, action);
        } else
          await expect
            .poll(() =>
              page.evaluate(
                () => (window as unknown as { isolatedCanvasHook: boolean }).isolatedCanvasHook,
              ),
            )
            .toBe(true);
      }
      await page.mouse.up();
      expect(
        await page.evaluate(
          () => (window as unknown as { isolatedCanvasHook: boolean }).isolatedCanvasHook,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { isolatedCanvasNative: boolean }).isolatedCanvasNative,
        ),
      ).toBe(phase === 'movement');
      expect(await f.captured()).toBe(false);
      expect(await f.read()).toEqual(f.before);
      await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
      if (action === 'source') {
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('15');
        await page
          .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
          .click();
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
      } else {
        await expect(
          page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
        ).toBeDisabled();
        if (action === 'target') await expect(f.field('Y')).toHaveValue('77');
        await f.stage.scrollIntoViewIfNeeded();
        const again = await f.measure();
        await page.mouse.move(again.start.x, again.start.y);
        await page.mouse.down();
        expect(await f.captured()).toBe(true);
        await page.mouse.move(
          again.start.x + (15 * f.scale * again.box.width) / 540,
          again.start.y + (45 * f.scale * again.box.height) / 330,
        );
        await page.mouse.up();
        await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
        expect(await f.read()).toEqual(f.before);
      }
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await f.read()).toEqual(f.before);
      expect(f.errors).toEqual([]);
    });
for (const reason of ['escape', 'native', 'view', 'role', 'frame', 'group', 'close'])
  test('isolated trajectory canvas cleanup ' + reason, async ({ page }) => {
    const f = await begin(page),
      { box, start } = await f.measure();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    expect(await f.captured()).toBe(true);
    await page.mouse.move(
      start.x + (26 * f.scale * box.width) / 540,
      start.y + (60 * f.scale * box.height) / 330,
    );
    if (reason === 'escape') await page.keyboard.press('Escape');
    else if (reason === 'native')
      await f.stage.evaluate((el) =>
        (el as HTMLCanvasElement).releasePointerCapture(Number(el.dataset.pointer)),
      );
    else if (reason === 'view')
      await f.stage.evaluate((el) => {
        el.style.width = '600px';
      });
    else if (reason === 'role')
      await page
        .getByLabel('Symbol selection trajectory control role', { exact: true })
        .selectOption('end');
    else if (reason === 'frame') {
      await page.getByLabel('Symbol frame', { exact: true }).fill('6');
      await page.getByLabel('Symbol frame', { exact: true }).press('Tab');
    } else if (reason === 'group') {
      const node = page.getByLabel('Select complete sampled symbol groups', { exact: true });
      await node.evaluate((el) => {
        const input = el as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect(node).toBeChecked();
    } else {
      const node = page.getByLabel('Show sampled symbol stage', { exact: true });
      await node.evaluate((el) => {
        const input = el as HTMLInputElement;
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect(node).not.toBeChecked();
    }
    await page.mouse.up();
    if (reason !== 'close') expect(await f.captured()).toBe(false);
    await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
    ).toBeDisabled();
    expect(await f.read()).toEqual(f.before);
    await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
    expect(await f.read()).toEqual(f.before);
    expect(f.errors).toEqual([]);
  });

test('isolated trajectory canvas explicit discard owns a pending prior restoration', async ({
  page,
}) => {
  const f = await begin(page);
  await fill(page, ['@base']);
  await page
    .getByRole('button', { name: 'Preview symbol selection trajectories', exact: true })
    .click();
  await f.stage.scrollIntoViewIfNeeded();
  const { box, start } = await f.measure();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  expect(await f.captured()).toBe(true);
  await page.mouse.move(
    start.x + (10 * f.scale * box.width) / 540,
    start.y + (30 * f.scale * box.height) / 330,
  );
  await page
    .getByRole('button', { name: 'Discard selection trajectory preview', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await page.mouse.up();
  await expect(page.getByLabel('Symbol selection trajectory proposal')).toHaveCount(0);
  expect(await f.captured()).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
  expect(f.errors).toEqual([]);
});
test('isolated trajectory canvas release ignores retained authoring preferences and Cancel preserves document', async ({
  page,
}) => {
  const f = await setup(page);
  await f.editor.getByLabel('Drag sampled symbol selection offsets', { exact: true }).check();
  await f.editor
    .getByLabel('Author sampled symbol selection drag on release', { exact: true })
    .check();
  await f.editor.getByLabel('Edit sampled symbol selection trajectories', { exact: true }).check();
  await page.getByLabel('Drag symbol selection trajectory controls', { exact: true }).check();
  await f.stage.scrollIntoViewIfNeeded();
  const box = (await f.stage.boundingBox())!,
    scale = Math.min(500 / f.definition.width, 290 / f.definition.height),
    shape = symbolLayers(f.definition)[0].keys[0].shapes[0],
    start = {
      x: box.x + ((20 + shape.x * scale) * box.width) / 540,
      y: box.y + ((20 + shape.y * scale) * box.height) / 330,
    };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(
    start.x + (26 * scale * box.width) / 540,
    start.y + (60 * scale * box.height) / 330,
  );
  await page.mouse.up();
  await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
  expect(f.errors).toEqual([]);
});
