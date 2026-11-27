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
function expected(project: Project, definition: SymbolDefinition, tracks: string[]) {
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
          ...offsets,
        },
      })),
    );
  } finally {
    cap.dispose();
  }
}
for (const mode of [
  'base',
  'multi',
  'affine',
  'reflected',
  'compound',
  'curved',
  'aligned',
  'children',
  'saved-flags',
  'default-track',
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
])
  test('isolated complete-track numeric trajectories ' + mode, async ({ page }) => {
    const tracks = mode === 'multi' ? ['@base', 'extra'] : ['@base'],
      f = await setup(page, mode, tracks),
      candidate = expected(f.before, f.definition, tracks);
    await f.editor
      .getByLabel('Edit sampled symbol selection trajectories', { exact: true })
      .check();
    await expect(
      page.getByRole('button', { name: 'Commit symbol selection trajectories', exact: true }),
    ).toBeDisabled();
    await fill(page, tracks);
    const target = worldPoint(
        symbolLayers(candidate)[0].keys.find((k) => k.frame === 4)!.shapes[0],
        { x: 12, y: 12 },
      ),
      scale = Math.min(500 / f.definition.width, 290 / f.definition.height);
    const pixel = () =>
      f.stage.evaluate(
        (el, p) =>
          Array.from(
            (el as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(Math.round(20 + p.x * p.scale), Math.round(20 + p.y * p.scale), 1, 1)
              .data,
          ),
        { ...target, scale },
      );
    await expect.poll(pixel).toEqual([255, 255, 255, 255]);
    await page
      .getByRole('button', { name: 'Preview symbol selection trajectories', exact: true })
      .click();
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    const colorAt = (point: { x: number; y: number }) =>
      f.stage.evaluate(
        (el, p) =>
          Array.from(
            (el as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(Math.round(20 + p.x * p.scale), Math.round(20 + p.y * p.scale), 1, 1)
              .data,
          ),
        { ...point, scale },
      );
    if (mode === 'multi')
      await expect
        .poll(() =>
          colorAt(
            worldPoint(symbolLayers(candidate)[1].keys.find((k) => k.frame === 4)!.shapes[0], {
              x: 12,
              y: 12,
            }),
          ),
        )
        .toEqual([0, 0, 255, 255]);
    if (mode === 'children')
      await expect.poll(() => colorAt({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    if (mode.startsWith('nested-'))
      await expect
        .poll(() =>
          colorAt(
            worldPoint(symbolLayers(candidate)[0].keys.find((k) => k.frame === 4)!.shapes[2], {
              x: 4,
              y: 4,
            }),
          ),
        )
        .toEqual([0, 0, 255, 255]);

    await expect(page.getByLabel('Symbol selection trajectory proposal')).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    await page
      .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
      .click();
    await expect(page.getByLabel('Show sampled symbol stage', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveText(
      `Trajectory · ${4 * tracks.length} units · ${tracks.length} tracks · ${6 * tracks.length} artwork members`,
    );
    expect(await f.read()).toEqual(f.before);
    const undo = page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      redo = page.getByRole('button', { name: 'Redo symbol timeline change', exact: true });
    await undo.click();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
    await redo.click();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
    await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    await expect.poll(f.read).toEqual({
      ...f.before,
      symbols: f.before.symbols!.map((s) => (s.id === candidate.id ? candidate : s)),
    });
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    expect((await f.read()).symbols!.find((s) => s.id === candidate.id)).toEqual(candidate);
    expect(f.errors).toEqual([]);
  });

async function arm(page: Page, phase: 'candidate' | 'publication', action: string) {
  await page.evaluate(
    ({ phase, action }) => {
      Object.assign(window, { symbolTrajectoryHook: false });
      const apply = (candidate: SymbolDefinition) => {
        Object.assign(window, { symbolTrajectoryHook: true });
        const input = (label: string, values: string[], type = 'input') => {
          const node = document.querySelector(
            'input[aria-label="' + label + '"]',
          ) as HTMLInputElement;
          if (!node) throw Error('Missing ' + label);
          for (const value of values) {
            node.value = value;
            node.dispatchEvent(new Event(type, { bubbles: true }));
          }
        };
        const check = (label: string, values: boolean[]) => {
          const node = document.querySelector(
            'input[aria-label="' + label + '"]',
          ) as HTMLInputElement;
          if (!node) throw Error('Missing ' + label);
          for (const value of values) {
            node.checked = value;
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        if (action === 'source') input('Symbol duration', ['15'], 'change');
        else if (action === 'frame') input('Symbol frame', ['6'], 'change');
        else if (action === 'close') check('Show sampled symbol stage', [false]);
        else if (action === 'selection') check('Sampled symbol unit @base/r', [false]);
        else if (action === 'group' || action === 'group-restored')
          check(
            'Select complete sampled symbol groups',
            action === 'group' ? [true] : [true, false],
          );
        else if (action === 'mode' || action === 'mode-restored')
          check(
            'Edit sampled symbol selection trajectories',
            action === 'mode' ? [false] : [false, true],
          );
        else if (action === 'output')
          candidate.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x++;
        else
          input(
            'Symbol selection trajectory @base start Y',
            action === 'restored' ? ['61', '60'] : ['61'],
          );
      };
      const complete = (d: SymbolDefinition) =>
        d?.id === 'selection' &&
        d.timeline?.motionSpans?.length === 1 &&
        d.timeline.motionSpans[0].path?.startY === 60;
      if (phase === 'candidate') {
        const clone = structuredClone;
        window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
          const out = clone(value, options);
          if (complete(out as SymbolDefinition)) {
            window.structuredClone = clone;
            apply(out as SymbolDefinition);
          }
          return out;
        }) as typeof structuredClone;
      } else {
        const stringify = JSON.stringify;
        JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
          const out = stringify(value, replacer as never, space);
          if (complete(value as SymbolDefinition)) {
            JSON.stringify = stringify;
            apply(value as SymbolDefinition);
          }
          return out;
        }) as typeof JSON.stringify;
      }
    },
    { phase, action },
  );
}
for (const phase of ['candidate', 'publication'] as const)
  for (const action of [
    'target',
    'restored',
    'selection',
    'mode',
    'mode-restored',
    'group',
    'group-restored',
    'source',
    'frame',
    'close',
    'output',
  ])
    test('isolated trajectory rejects ' + phase + ' ' + action, async ({ page }) => {
      const f = await setup(page, 'multi', ['@base', 'extra']);
      await f.editor
        .getByLabel('Edit sampled symbol selection trajectories', { exact: true })
        .check();
      await fill(page, ['@base', 'extra']);
      await arm(page, phase, action);
      await page
        .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { symbolTrajectoryHook: boolean }).symbolTrajectoryHook,
        ),
      ).toBe(true);
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
      if (action === 'group' || action === 'group-restored')
        await expect(page.getByLabel('Select complete sampled symbol groups')).toBeChecked({
          checked: action === 'group',
        });
      if (action === 'restored') {
        await page
          .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
          .click();
        await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
      }
      expect(f.errors).toEqual([]);
    });
for (const mode of ['incomplete', 'waypoints', 'cancel', 'retained'])
  test('isolated trajectory recovery ' + mode, async ({ page }) => {
    const f = await setup(page, mode === 'waypoints' ? 'waypoints' : 'base');
    if (mode === 'retained') {
      await f.editor.getByLabel('Sampled symbol selection X offset').fill('17');
      await f.editor.getByLabel('Drag sampled symbol selection offsets', { exact: true }).check();
      await f.editor
        .getByLabel('Author sampled symbol selection drag on release', { exact: true })
        .check();
    }
    if (mode === 'incomplete')
      await f.editor.getByLabel('Sampled symbol unit @base/other', { exact: true }).uncheck();
    await f.editor
      .getByLabel('Edit sampled symbol selection trajectories', { exact: true })
      .check();
    const commit = page.getByRole('button', {
      name: 'Commit symbol selection trajectories',
      exact: true,
    });
    if (mode === 'incomplete' || mode === 'waypoints') {
      await expect(commit).toBeDisabled();
      await expect(page.getByRole('alert')).toBeVisible();
    }
    if (mode === 'incomplete') {
      await f.editor.getByLabel('Sampled symbol unit @base/other', { exact: true }).check();
      await fill(page, ['@base']);
      await commit.click();
      await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
    }
    if (mode === 'cancel') {
      await fill(page, ['@base']);
      await commit.click();
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
    }
    if (mode === 'retained') {
      await fill(page, ['@base']);
      await page
        .getByRole('button', { name: 'Preview symbol selection trajectories', exact: true })
        .click();
      await f.editor
        .getByLabel('Edit sampled symbol selection trajectories', { exact: true })
        .uncheck();
      await expect(f.editor.getByLabel('Sampled symbol selection X offset')).toHaveValue('17');
      await expect(
        f.editor.getByLabel('Author sampled symbol selection drag on release', { exact: true }),
      ).toBeChecked();
      await expect(page.getByLabel('Symbol selection trajectory proposal')).toHaveCount(0);
    }
    expect(await f.read()).toEqual(f.before);
    expect(f.errors).toEqual([]);
  });

for (const kind of ['translation', 'skew'])
  test('isolated trajectory cancels active ' + kind + ' capture', async ({ page }) => {
    const f = await setup(page);
    if (kind === 'skew') {
      await f.editor.getByLabel('Skew sampled symbol selection', { exact: true }).check();
      await f.editor.getByLabel('Drag sampled symbol selection skew', { exact: true }).check();
      await f.editor
        .getByLabel('Author sampled symbol selection skew on release', { exact: true })
        .check();
    } else {
      await f.editor.getByLabel('Drag sampled symbol selection offsets', { exact: true }).check();
      await f.editor
        .getByLabel('Author sampled symbol selection drag on release', { exact: true })
        .check();
    }
    await f.stage.scrollIntoViewIfNeeded();
    const box = (await f.stage.boundingBox())!,
      scale = Math.min(500 / f.definition.width, 290 / f.definition.height),
      p = kind === 'skew' ? { x: 180, y: 60 } : { x: 72, y: 72 };
    await page.mouse.move(box.x + 20 + p.x * scale, box.y + 20 + p.y * scale);
    await page.mouse.down();
    await page.mouse.move(box.x + 20 + p.x * scale + 6, box.y + 20 + p.y * scale, { steps: 2 });
    expect(await f.stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      true,
    );
    await f.editor
      .getByLabel('Edit sampled symbol selection trajectories', { exact: true })
      .evaluate((el) => {
        const n = el as HTMLInputElement;
        n.checked = true;
        n.dispatchEvent(new Event('change', { bubbles: true }));
      });
    expect(await f.stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      false,
    );
    await page.mouse.up();
    await expect(
      page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
    ).toBeDisabled();
    await fill(page, ['@base']);
    await page
      .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
      .click();
    await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    expect(f.errors).toEqual([]);
  });
test('isolated trajectory blank overflow and fresh direct commit recovery', async ({ page }) => {
  const f = await setup(page);
  await f.editor.getByLabel('Edit sampled symbol selection trajectories', { exact: true }).check();
  await fill(page, ['@base']);
  const target = page.getByLabel('Symbol selection trajectory @base start Y', { exact: true }),
    commit = page.getByRole('button', {
      name: 'Commit symbol selection trajectories',
      exact: true,
    });
  await target.fill('');
  await expect(commit).toBeDisabled();
  await target.fill(String(Number.MAX_VALUE));
  await commit.click();
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('alert')).toBeVisible();
  await fill(page, ['@base']);
  await commit.click();
  await expect(page.getByLabel('Updated symbol trajectory selection')).toBeVisible();
  expect(await f.read()).toEqual(f.before);
  expect(f.errors).toEqual([]);
});
test('isolated trajectory reopens unchanged recipe identity for later editing', async ({
  page,
}) => {
  const f = await setup(page);
  await f.editor.getByLabel('Edit sampled symbol selection trajectories', { exact: true }).check();
  await fill(page, ['@base']);
  await page
    .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
    .click();
  await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const first = await f.read();
  await page
    .getByRole('group', { name: 'Symbol Selection', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const frame = page.getByLabel('Symbol frame', { exact: true });
  await frame.fill('5');
  await frame.press('Tab');
  await page.getByLabel('Show sampled symbol stage', { exact: true }).check();
  await page.getByLabel('Select multiple sampled symbol units', { exact: true }).check();
  const editor = page.getByRole('group', { name: 'Sampled symbol selection set', exact: true });
  for (const r of requests(['@base']))
    await editor
      .getByLabel('Sampled symbol unit ' + r.layerId + '/' + r.shapeId, { exact: true })
      .check();
  await editor.getByLabel('Edit sampled symbol selection trajectories', { exact: true }).check();
  await expect(
    page.getByLabel('Symbol selection trajectory @base start Y', { exact: true }),
  ).toHaveValue('60');
  await page.getByLabel('Symbol selection trajectory @base start Y', { exact: true }).fill('65');
  await page
    .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
    .click();
  await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const second = await f.read(),
    before = first.symbols!.find((s) => s.id === 'selection')!,
    after = second.symbols!.find((s) => s.id === 'selection')!;
  expect(after.timeline!.motionSpans).toHaveLength(1);
  expect(after.timeline!.motionSpans![0].id).toBe(before.timeline!.motionSpans![0].id);
  expect(after.timeline!.motionSpans![0].path?.startY).toBe(65);
  expect(f.errors).toEqual([]);
});

test('isolated trajectory rejects close after final complete-data admission', async ({ page }) => {
  const f = await setup(page);
  await f.editor.getByLabel('Edit sampled symbol selection trajectories', { exact: true }).check();
  await fill(page, ['@base']);
  await page.evaluate(() => {
    const stringify = JSON.stringify,
      descriptors = Object.getOwnPropertyDescriptors;
    let armed = false,
      reads = 0;
    const complete = (value: unknown) => {
      const d = value as SymbolDefinition;
      return (
        d?.id === 'selection' &&
        d.timeline?.motionSpans?.length === 1 &&
        d.timeline.motionSpans[0].path?.startY === 60
      );
    };
    Object.assign(window, { symbolTrajectoryFinalReads: 0 });
    JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
      const out = stringify(value, replacer as never, space);
      if (complete(value)) {
        armed = true;
        JSON.stringify = stringify;
      }
      return out;
    }) as typeof JSON.stringify;
    Object.getOwnPropertyDescriptors = ((value: unknown) => {
      const out = descriptors(value);
      if (armed && complete(value) && ++reads === 8) {
        Object.getOwnPropertyDescriptors = descriptors;
        Object.assign(window, { symbolTrajectoryFinalReads: reads });
        const n = document.querySelector(
          'input[aria-label="Show sampled symbol stage"]',
        ) as HTMLInputElement;
        n.checked = false;
        n.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return out;
    }) as typeof Object.getOwnPropertyDescriptors;
  });
  await page
    .getByRole('button', { name: 'Commit symbol selection trajectories', exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { symbolTrajectoryFinalReads: number }).symbolTrajectoryFinalReads,
    ),
  ).toBe(8);
  await expect(page.getByLabel('Show sampled symbol stage', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Updated symbol trajectory selection')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  expect(f.errors).toEqual([]);
});
