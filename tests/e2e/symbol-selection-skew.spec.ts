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
import { worldPoint, localPoint, objectBounds } from '../../packages/geometry/src';
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
  return p;
}
function skewFixture(mode: string) {
  const p = motionFixture(mode === 'absorbed' ? 'affine' : mode);
  if (['common', 'defaults', 'asymmetric', 'clockwise', 'counterclockwise'].includes(mode))
    for (const l of p.layers) {
      const end = l.id === 'base' ? 8 : 10;
      if (mode === 'common' || mode === 'defaults') {
        for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === end))
          for (const s of k.shapes) {
            if (mode === 'defaults') delete s.pivot;
            else s.pivot = localPoint(s, { x: 120, y: 90 });
          }
        if (mode === 'common') l.motionSpans![0].options!.pivots = true;
      }
      if (mode === 'asymmetric')
        for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === end))
          k.shapes.find((s) => s.id === 'a')!.width = 43;
      if (mode === 'clockwise' || mode === 'counterclockwise') {
        l.motionSpans![0].rotation!.direction = mode;
        l.motionSpans![0].rotation!.turns = 1;
      }
      refreshBasicMotionSpan(p, [l.id], 0, end);
    }
  if (mode === 'guard' || mode === 'uniform-only')
    for (const l of p.layers) {
      l.motionSpans![0].rotation!.axisGroupScale = false;
      l.motionSpans![0].rotation!.axisGroupShear = false;
      l.motionSpans![0].rotation!.uniformGroupScale = true;
      refreshBasicMotionSpan(p, [l.id], 0, l.id === 'base' ? 8 : 10);
    }
  return p;
}
function shear(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  axis: 'x' | 'y',
  degrees: number,
) {
  const k = Math.tan((degrees * Math.PI) / 180);
  return {
    x: point.x + (axis === 'x' ? k * (point.y - pivot.y) : 0),
    y: point.y + (axis === 'y' ? k * (point.x - pivot.x) : 0),
  };
}
function fixture(mode: string) {
  const original = skewFixture(mode),
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
function comparable(d: SymbolDefinition) {
  const out = structuredClone(d);
  for (const l of symbolLayers(out)) for (const s of l.motionSpans ?? []) s.id = 'span';
  return out;
}
async function arm(
  page: Page,
  action: string,
  complete = false,
  publication = false,
  metadata = false,
) {
  await page.evaluate(
    ({ action, complete, publication, metadata }) => {
      const apply = () => {
        Object.assign(window, { symbolSkewHook: true });
        const input = (label: string, values: string[], event = 'input') => {
          const e = document.querySelector('input[aria-label="' + label + '"]') as HTMLInputElement;
          for (const v of values) {
            e.value = v;
            e.dispatchEvent(new Event(event, { bubbles: true }));
          }
        };
        const check = (label: string, values: boolean[]) => {
          const e = document.querySelector('input[aria-label="' + label + '"]') as HTMLInputElement;
          for (const checked of values) {
            e.checked = checked;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        if (action === 'source') input('Symbol duration', ['15'], 'change');
        else if (action === 'frame') input('Symbol frame', ['6'], 'change');
        else if (action === 'close') check('Show sampled symbol stage', [false]);
        else if (action === 'selection') check('Sampled symbol unit @base/r', [false]);
        else if (action === 'mode') check('Skew sampled symbol selection', [false, true]);
        else if (action === 'axis' || action === 'axis-restored') {
          const el = document.querySelector(
            'select[aria-label="Sampled symbol selection skew axis"]',
          ) as HTMLSelectElement;
          for (const value of action === 'axis-restored' ? ['y', 'x'] : ['y']) {
            el.value = value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else
          input(
            'Sampled symbol selection skew degrees',
            action === 'restored' ? ['40', '35'] : ['40'],
          );
      };
      if (complete) {
        const stringify = JSON.stringify,
          reads = new WeakMap<object, number>();
        JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
          const out = stringify(value, replacer as never, space),
            d = value as SymbolDefinition;
          if (d?.id === 'selection' && symbolLayersForHook(d)) {
            const n = (reads.get(d) ?? 0) + 1;
            reads.set(d, n);
            if (publication && n < 2) return out;
            JSON.stringify = stringify;
            Object.assign(window, { symbolSkewPublicationReads: n });
            apply();
          }
          return out;
        }) as typeof JSON.stringify;
        function symbolLayersForHook(d: SymbolDefinition) {
          return (
            d.timeline?.motionSpans?.length === 2 &&
            d.timeline.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
              ?.transform?.[2] === Math.tan((35 * Math.PI) / 180) &&
            d.timeline.layers
              ?.filter((l) => l.id === 'extra')
              .every(
                (l) =>
                  l.motionSpans?.length === 2 &&
                  l.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
                    ?.transform?.[2] === Math.tan((35 * Math.PI) / 180),
              )
          );
        }
      } else {
        const clone = structuredClone;
        window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
          const out = clone(value, options),
            d = value as SymbolDefinition;
          const readout = value as { axis?: string; degrees?: number; pivot?: unknown };
          if (
            metadata
              ? readout?.axis === 'x' && readout.degrees === 35 && readout.pivot
              : d?.id === 'selection' && d.timeline
          ) {
            window.structuredClone = clone;
            apply();
          }
          return out;
        }) as typeof structuredClone;
      }
    },
    { action, complete, publication, metadata },
  );
}

for (const mode of [
  'base',
  'y-negative',
  'multi',
  'root-root',
  'group-group',
  'cross-roots',
  'cross-groups',
  'affine',
  'reflected',
  'compound',
  'curved',
  'aligned',
  'asymmetric',
  'common',
  'defaults',
  'children',
  'nested-movie',
  'nested-loop',
  'direct',
  'separate',
  'retained',
  'active-translation',
  'active-rotation',
  'active-scale',
  'discard',
  'cancel',
  'zero',
  'blank',
  'overflow',
  'underflow',
  'right-angle',
  'guard',
  'group-context',
  'preview-target',
  'preview-source',
  'late-target',
  'late-axis',
  'late-axis-restored',
  'late-restored',
  'late-mode',
  'late-selection',
  'late-source',
  'late-frame',
  'late-close',
  'candidate-target',
  'candidate-source',
  'candidate-mode',
  'candidate-axis',
  'publication-target',
  'publication-source',
  'publication-mode',
  'publication-axis',
  'publication-axis-restored',
  'metadata-target',
  'metadata-source',
  'metadata-axis',
])
  test('isolated sampled selection numeric skew ' + mode, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1500 });
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      fixture(mode),
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        ),
      before = await read(),
      source = before.symbols!.find((s) => s.id === 'selection')!;
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
    const editor = page.getByRole('group', { name: 'Sampled symbol selection set' }),
      stage = page.getByLabel('Sampled symbol stage', { exact: true }),
      skew = editor.getByLabel('Skew sampled symbol selection', { exact: true });
    const picks =
      mode === 'root-root'
        ? [
            ['@base', 'r'],
            ['@base', 'other'],
          ]
        : mode === 'group-group'
          ? [
              ['@base', 'b'],
              ['@base', 'd'],
            ]
          : mode === 'cross-roots'
            ? [
                ['@base', 'r'],
                ['extra', 'r'],
              ]
            : mode === 'cross-groups'
              ? [
                  ['@base', 'b'],
                  ['extra', 'b'],
                ]
              : mode === 'multi' || /^(late|candidate|publication|metadata)-/.test(mode)
                ? [
                    ['@base', 'r'],
                    ['@base', 'b'],
                    ['extra', 'b'],
                  ]
                : [
                    ['@base', 'r'],
                    ['@base', 'b'],
                  ];
    for (const [l, id] of picks)
      await editor.getByLabel('Sampled symbol unit ' + l + '/' + id, { exact: true }).check();
    const requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId })),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => ({
        definition: source,
        symbols: before.symbols!,
        assets: before.assets,
        frame: 4,
        revision: 0,
      })),
      owner = cap.resolveSkew(requests),
      scene = cap.scene;
    const undo = page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      redo = page.getByRole('button', { name: 'Redo symbol timeline change', exact: true });
    if (mode === 'separate') {
      await editor.getByLabel('Sampled symbol selection X offset').fill('17');
      await editor.getByLabel('Sampled symbol selection Y offset').fill('-9');
      await editor.getByLabel('Rotate sampled symbol selection', { exact: true }).check();
      await editor.getByLabel('Sampled symbol selection rotation degrees').fill('37');
      await editor.getByLabel('Scale sampled symbol selection', { exact: true }).check();
      await editor.getByLabel('Sampled symbol selection X scale').fill('150');
      await editor.getByLabel('Sampled symbol selection Y scale').fill('75');
      await editor
        .getByRole('button', { name: 'Preview sampled symbol selection scale', exact: true })
        .click();
    }
    if (mode === 'retained' || mode.startsWith('active-')) {
      await editor.getByLabel('Drag sampled symbol selection offsets').check();
      await editor.getByLabel('Author sampled symbol selection drag on release').check();
      if (mode !== 'active-translation') {
        await editor.getByLabel('Rotate sampled symbol selection', { exact: true }).check();
        await editor.getByLabel('Drag sampled symbol selection rotation', { exact: true }).check();
        await editor.getByLabel('Author sampled symbol selection rotation on release').check();
      }
      if (mode === 'active-scale' || mode === 'retained') {
        await editor.getByLabel('Scale sampled symbol selection', { exact: true }).check();
        await editor.getByLabel('Drag sampled symbol selection scale', { exact: true }).check();
        await editor.getByLabel('Author sampled symbol selection scale on release').check();
      }
    }
    if (mode.startsWith('active-')) {
      await stage.scrollIntoViewIfNeeded();
      const b = (await stage.boundingBox())!,
        scale = 290 / 300,
        boxes = owner.tracks
          .flatMap((t) =>
            scene
              .find((l) => l.layerId === t.layerId)!
              .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
          )
          .map(objectBounds);
      const q =
        mode === 'active-rotation'
          ? { x: owner.pivot.x * scale, y: owner.pivot.y * scale - 32 }
          : mode === 'active-scale'
            ? {
                x: Math.max(...boxes.map((b) => b.right)) * scale,
                y: Math.max(...boxes.map((b) => b.bottom)) * scale,
              }
            : { x: 70 * scale, y: 70 * scale };
      await page.mouse.move(
        b.x + ((20 + q.x) * b.width) / 540,
        b.y + ((20 + q.y) * b.height) / 330,
      );
      await page.mouse.down();
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
      await skew.evaluate((el) => {
        (el as HTMLInputElement).checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
      await expect(undo).toBeDisabled();
    } else await skew.check();
    const axis = editor.getByLabel('Sampled symbol selection skew axis'),
      angle = editor.getByLabel('Sampled symbol selection skew degrees'),
      preview = editor.getByRole('button', {
        name: 'Preview sampled symbol selection skew',
        exact: true,
      }),
      commit = editor.getByRole('button', {
        name: 'Commit sampled symbol selection skew',
        exact: true,
      });
    await expect(commit).toBeDisabled();
    await expect(editor.getByLabel('Sampled symbol selection skew pivot')).toHaveText(
      `Original pivot · ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`,
    );
    if (mode === 'zero' || mode === 'blank') {
      for (const v of mode === 'zero' ? ['0', '180', '360'] : ['']) {
        await angle.fill(v);
        await expect(commit).toBeDisabled();
      }
      expect(await read()).toEqual(before);
      await expect(undo).toBeDisabled();
      cap.dispose();
      return;
    }
    const a = mode === 'y-negative' ? 'y' : 'x',
      degrees = mode === 'y-negative' ? -25 : 35;
    await axis.selectOption(a);
    await angle.fill(
      mode === 'overflow'
        ? '1e308'
        : mode === 'underflow'
          ? '5e-324'
          : mode === 'right-angle'
            ? '90'
            : String(degrees),
    );
    if (mode === 'retained') {
      await expect(editor.getByLabel('Drag sampled symbol selection offsets')).toBeDisabled();
      await expect(
        editor.getByLabel('Author sampled symbol selection drag on release'),
      ).toBeChecked();
      await expect(
        editor.getByLabel('Author sampled symbol selection drag on release'),
      ).toBeDisabled();
      const b = (await stage.boundingBox())!;
      await page.mouse.move(b.x + 90, b.y + 90);
      await page.mouse.down();
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.move(b.x + 130, b.y + 110);
      await page.mouse.up();
      await expect(undo).toBeDisabled();
      expect(await read()).toEqual(before);
    }
    const root = scene
        .find((t) => t.layerId === owner.tracks[0].layerId)!
        .key.shapes.find((s) => s.id === owner.tracks[0].shapeIds[0])!,
      destination = shear(worldPoint(root, { x: 2, y: 4 }), owner.pivot, a, degrees);
    const pixel = (p: { x: number; y: number }) =>
      stage.evaluate(
        (el, p) => [
          ...(el as HTMLCanvasElement)
            .getContext('2d')!
            .getImageData(
              Math.floor(20 + (p.x * 290) / 300),
              Math.floor(20 + (p.y * 290) / 300),
              1,
              1,
            ).data,
        ],
        p,
      );
    if (mode === 'base' || mode === 'children')
      expect(await pixel(destination)).toEqual([255, 255, 255, 255]);
    if (mode.startsWith('preview-')) await arm(page, mode.slice(8));
    if (mode !== 'direct') {
      await preview.click();
      if (['overflow', 'underflow', 'right-angle', 'guard'].includes(mode)) {
        await expect(editor.getByRole('alert')).toBeVisible();
        expect(await read()).toEqual(before);
        await expect(undo).toBeDisabled();
        if (mode === 'guard') {
          await toggle.uncheck();
          await page
            .getByLabel('Sampled symbol artwork', { exact: true })
            .selectOption(JSON.stringify(['@base', 'r']));
          await page
            .getByRole('button', { name: 'Promote sampled symbol pose', exact: true })
            .click();
          await undo.click();
          await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
          expect(await read()).toEqual(before);
        }
        expect(errors).toEqual([]);
        cap.dispose();
        return;
      }
      if (mode.startsWith('preview-')) {
        expect(
          await page.evaluate(
            () => (window as unknown as { symbolSkewHook: boolean }).symbolSkewHook,
          ),
        ).toBe(true);
        expect(await read()).toEqual(before);
        if (mode === 'preview-source') {
          await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('15');
          await expect(undo).toBeEnabled();
          await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
          const expected = structuredClone(before);
          expected.symbols!.find((s) => s.id === 'selection')!.timeline!.duration = 15;
          expect(await read()).toEqual(expected);
          await page.getByLabel('Drawing stage').focus();
          await page.keyboard.press('Control+z');
          expect(await read()).toEqual(before);
        } else {
          await expect(angle).toHaveValue('40');
          await expect(undo).toBeDisabled();
          await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
          expect(await read()).toEqual(before);
        }
        expect(errors).toEqual([]);
        cap.dispose();
        return;
      }
      await expect(
        editor.getByRole('status', { name: 'Sampled symbol selection preview' }),
      ).toContainText('Proposed selection skew');
      await expect.poll(() => pixel(destination)).toEqual([255, 0, 0, 255]);
      expect(await read()).toEqual(before);
      if (mode === 'children')
        await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
      if (mode.startsWith('nested-')) {
        const child = scene[0].key.shapes.find((s) => s.id === 'a')!;
        await expect
          .poll(() => pixel(shear(worldPoint(child, { x: 4, y: 4 }), owner.pivot, a, degrees)))
          .toEqual([0, 0, 255, 255]);
      }
      if (mode === 'discard') {
        await editor
          .getByRole('button', { name: 'Discard sampled symbol selection preview', exact: true })
          .click();
        await expect(
          editor.getByRole('status', { name: 'Sampled symbol selection preview' }),
        ).toHaveCount(0);
        await expect(angle).toHaveValue('35');
      }
    }
    if (mode === 'separate' || mode === 'retained') {
      await skew.uncheck();
      if (mode === 'separate') {
        await expect(editor.getByLabel('Sampled symbol selection X offset')).toHaveValue('17');
        await expect(editor.getByLabel('Sampled symbol selection Y offset')).toHaveValue('-9');
      }
      await editor.getByLabel('Rotate sampled symbol selection', { exact: true }).check();
      if (mode === 'separate')
        await expect(editor.getByLabel('Sampled symbol selection rotation degrees')).toHaveValue(
          '37',
        );
      else {
        await expect(
          editor.getByLabel('Author sampled symbol selection rotation on release'),
        ).toBeChecked();
        await expect(
          editor.getByLabel('Drag sampled symbol selection rotation', { exact: true }),
        ).not.toBeChecked();
      }
      await editor.getByLabel('Scale sampled symbol selection', { exact: true }).check();
      if (mode === 'separate') {
        await expect(editor.getByLabel('Sampled symbol selection X scale')).toHaveValue('150');
        await expect(editor.getByLabel('Sampled symbol selection Y scale')).toHaveValue('75');
      } else {
        await expect(
          editor.getByLabel('Author sampled symbol selection scale on release'),
        ).toBeChecked();
        await expect(
          editor.getByLabel('Drag sampled symbol selection scale', { exact: true }),
        ).not.toBeChecked();
      }
      await skew.check();
      await expect(angle).toHaveValue('35');
    }
    if (mode === 'group-context') {
      await toggle.uncheck();
      await page.getByLabel('Select complete sampled symbol groups', { exact: true }).check();
      await expect(
        page.getByLabel('Select complete sampled symbol groups', { exact: true }),
      ).toBeChecked();
      await toggle.check();
      await expect(skew).not.toBeChecked();
      for (const [l, id] of picks) {
        await expect(editor.getByLabel('Sampled symbol unit ' + l + '/' + id)).not.toBeChecked();
        await editor.getByLabel('Sampled symbol unit ' + l + '/' + id).check();
      }
      await skew.check();
      await expect(angle).toHaveValue('0');
      await expect(axis).toHaveValue('x');
      await expect(commit).toBeDisabled();
      await angle.fill('35');
    }
    if (/^(late|candidate|publication|metadata)-/.test(mode)) {
      const action = mode.slice(mode.indexOf('-') + 1);
      await arm(
        page,
        action,
        mode.startsWith('candidate-') || mode.startsWith('publication-'),
        mode.startsWith('publication-'),
        mode.startsWith('metadata-'),
      );
      await commit.click();
      expect(
        await page.evaluate(
          () => (window as unknown as { symbolSkewHook: boolean }).symbolSkewHook,
        ),
      ).toBe(true);
      if (mode.startsWith('publication-'))
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { symbolSkewPublicationReads: number })
                .symbolSkewPublicationReads,
          ),
        ).toBe(2);
      expect(await read()).toEqual(before);
      if (action === 'source') {
        await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('15');
        await expect(undo).toBeEnabled();
        await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
        const expected = structuredClone(before);
        expected.symbols!.find((s) => s.id === 'selection')!.timeline!.duration = 15;
        expect(await read()).toEqual(expected);
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+z');
        expect(await read()).toEqual(before);
        expect(errors).toEqual([]);
        cap.dispose();
        return;
      }
      await expect(undo).toBeDisabled();
      if (action === 'target') await expect(angle).toHaveValue('40');
      if (action === 'axis') await expect(axis).toHaveValue('y');
      if (action === 'frame') await expect(frame).toHaveValue('6');
      if (action === 'close')
        await expect(
          page.getByLabel('Show sampled symbol stage', { exact: true }),
        ).not.toBeChecked();
      if (action === 'selection')
        await expect(editor.getByLabel('Sampled symbol unit @base/r')).not.toBeChecked();
      if (!['restored', 'mode', 'axis-restored'].includes(action)) {
        await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
        expect(await read()).toEqual(before);
        expect(errors).toEqual([]);
        cap.dispose();
        return;
      }
      await expect(angle).toHaveValue('35');
      await expect(axis).toHaveValue('x');
      await expect(skew).toBeChecked();
    }
    const expected = cap.prepareSkew(requests, a, degrees);
    await commit.click();
    await expect(page.getByLabel('Show sampled symbol stage', { exact: true })).not.toBeChecked();
    const count = owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0);
    await expect(
      page.getByText(count + ' objects selected. Cyan outlines show', { exact: false }),
    ).toBeVisible();
    const readout = page.getByLabel('Authored sampled symbol selection skew'),
      text = `Skew · ${a.toUpperCase()} · ${degrees}° · Pivot ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`;
    await expect(readout).toHaveText(text);
    expect(await read()).toEqual(before);
    const boxes = owner.tracks.flatMap((t) =>
      symbolLayers(expected)
        .find((l) => l.id === t.layerId)!
        .keys.find((k) => k.frame === 4)!
        .shapes.filter((s) => t.shapeIds.includes(s.id))
        .map((s) => ({ id: t.layerId + '/' + s.id, ...objectBounds(s) })),
    );
    const cues = await page
      .getByLabel('Symbol timeline preview', { exact: true })
      .evaluate((el, boxes) => {
        const c = el as HTMLCanvasElement,
          d = c.getContext('2d')!.getImageData(0, 0, 540, 330).data,
          scale = 290 / 300;
        return boxes.map((b) => {
          let count = 0;
          for (
            let y = Math.max(0, Math.floor(20 + b.top * scale) - 2);
            y <= Math.min(329, Math.ceil(20 + b.bottom * scale) + 2);
            y++
          )
            for (
              let x = Math.max(0, Math.floor(20 + b.left * scale) - 2);
              x <= Math.min(539, Math.ceil(20 + b.right * scale) + 2);
              x++
            ) {
              const i = (y * 540 + x) * 4;
              if (d[i + 1] > d[i] + 40 && d[i + 2] > d[i] + 50) count++;
            }
          return { id: b.id, count };
        });
      }, boxes);
    for (const cue of cues) expect(cue.count, cue.id + ' selection pixels').toBeGreaterThan(0);
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(readout).toHaveCount(0);
    await redo.click();
    await expect(readout).toHaveText(text);
    await expect(
      page.getByText(count + ' objects selected. Cyan outlines show', { exact: false }),
    ).toBeVisible();
    if (mode === 'cancel') {
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await read()).toEqual(before);
      cap.dispose();
      return;
    }
    await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const result = await read(),
      actual = result.symbols!.find((s) => s.id === 'selection')!;
    expect(comparable(actual)).toEqual(comparable(expected));
    expect({ ...result, symbols: before.symbols }).toEqual(before);
    expect(actual.buttonStates).toEqual(source.buttonStates);
    expect(actual.multiFramePivot).toEqual(source.multiFramePivot);
    for (const t of owner.tracks) {
      const l = symbolLayers(actual).find((l) => l.id === t.layerId)!,
        old = symbolLayers(source).find((l) => l.id === t.layerId)!;
      expect(l.keys.filter((k) => [0, t.end, 12].includes(k.frame))).toEqual(
        old.keys.filter((k) => [0, t.end, 12].includes(k.frame)),
      );
      expect(l.motionSpans![0].id).toBe(old.motionSpans![0].id);
      expect(l.motionSpans![1].id).not.toBe(old.motionSpans![0].id);
    }
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
    expect(errors).toEqual([]);
    cap.dispose();
  });
