import { browserSymbolRotationOracle } from './browser-rotation-oracle';
import {
  sampledSelectionRotationHandle,
  rotationLocal,
} from '../../apps/editor/src/sampled-rotation-handle';
import { test, expect } from '@playwright/test';
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
  if (mode === 'compound' || mode === 'aligned')
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
function rotationFixture(mode: string) {
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
  return p;
}
function rotate(point: { x: number; y: number }, pivot: { x: number; y: number }, angle: number) {
  const a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    x = point.x - pivot.x,
    y = point.y - pivot.y;
  return { x: pivot.x + c * x - s * y, y: pivot.y + s * x + c * y };
}

function fixture(mode: string) {
  const original = rotationFixture(mode),
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

for (const mode of [
  'base',
  'multi',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'common',
  'defaults',
  'clockwise',
  'counterclockwise',
  'children',
  'nested-movie',
  'css',
  'shift',
  'offset',
  'coalesced',
  'burst',
  'retained',
  'prior',
  'prior-view',
  'zero',
  'return',
  'full',
  'escape',
  'lost',
  'scroll',
  'view',
  'target',
  'restored-target',
  'policy',
  'restored-policy',
  'frame',
  'close',
  'source',
  'prepared-target',
  'prepared-policy',
  'prepared-source',
  'release-target',
  'release-policy',
  'release-source',
  'cancel',
  'selection',
  'mode',
  'proposed',
])
  test('isolated sampled selection rotation canvas ' + mode, async ({ page }) => {
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
    await page.getByLabel('Select multiple sampled symbol units', { exact: true }).check();
    const editor = page.getByRole('group', { name: 'Sampled symbol selection set' }),
      stage = page.getByLabel('Sampled symbol stage', { exact: true });
    const picks =
      mode === 'multi' || mode.startsWith('prepared-') || mode.startsWith('release-')
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
    if (mode === 'retained') {
      await editor.getByLabel('Drag sampled symbol selection offsets').check();
      await editor.getByLabel('Author sampled symbol selection drag on release').check();
    }
    await editor.getByLabel('Rotate sampled symbol selection', { exact: true }).check();
    const input = editor.getByLabel('Sampled symbol selection rotation degrees'),
      tool = editor.getByLabel('Drag sampled symbol selection rotation', { exact: true }),
      commit = editor.getByRole('button', {
        name: 'Commit sampled symbol selection rotation',
        exact: true,
      });
    const base =
      mode === 'proposed' ? 90 : ['offset', 'prior', 'prior-view'].includes(mode) ? 30 : 0;
    if (base) {
      await input.fill(String(base));
      if (mode !== 'offset')
        await editor
          .getByRole('button', { name: 'Preview sampled symbol selection rotation', exact: true })
          .click();
    }
    const requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId }));
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => ({
        definition: source,
        symbols: before.symbols!,
        assets: before.assets,
        frame: 4,
        revision: 0,
      })),
      owner = cap.resolveRotation(requests),
      scene = cap.scene;
    await tool.check();
    if (mode === 'css')
      await stage.evaluate((el) => {
        el.style.width = '700px';
        el.style.height = '240px';
      });
    await stage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    const measure = () =>
      stage.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          origin: { x: 20, y: 20 },
          zoom: 290 / 300,
          width: 540,
          height: 330,
          cssWidth: r.width,
          cssHeight: r.height,
        };
      });
    let view = await measure();
    const h = sampledSelectionRotationHandle(owner.pivot, view);
    let start = rotationLocal(
      { x: h.knob.x + (mode === 'offset' ? 3 : 0), y: h.knob.y + (mode === 'offset' ? -2 : 0) },
      view,
    );
    const screen = (a: number) => {
      const p = rotate(start, owner.pivot, a);
      return {
        x: view.left + ((p.x * view.zoom + view.origin.x) * view.cssWidth) / view.width,
        y: view.top + ((p.y * view.zoom + view.origin.y) * view.cssHeight) / view.height,
      };
    };
    const marker = await stage.evaluate((el, p) => {
      const c = el as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        sx = c.width / r.width,
        sy = c.height / r.height,
        d = c
          .getContext('2d')!
          .getImageData(
            Math.floor((p.x - 8) * sx),
            Math.floor((p.y - 8) * sy),
            Math.ceil(16 * sx) + 1,
            Math.ceil(16 * sy) + 1,
          ).data;
      let cyan = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] < 80 && d[i + 1] > 100 && d[i + 2] > 130 && d[i + 3] === 255) cyan++;
      return cyan;
    }, h.knob);
    expect(marker, 'original private handle').toBeGreaterThan(10);
    type Gate = {
      armed: boolean;
      pending: Map<number, FrameRequestCallback>;
      all: Map<number, FrameRequestCallback>;
      requests: number;
      flush(): void;
    };
    await page.evaluate(() => {
      const native = requestAnimationFrame.bind(window),
        cancel = cancelAnimationFrame.bind(window);
      let id = 1200000000;
      const g = {
        armed: false,
        pending: new Map<number, FrameRequestCallback>(),
        all: new Map<number, FrameRequestCallback>(),
        requests: 0,
        flush() {
          const work = [...g.pending.values()];
          g.pending.clear();
          g.armed = true;
          try {
            work.forEach((cb) => cb(performance.now()));
          } finally {
            g.armed = false;
          }
        },
      };
      Object.assign(window, { symbolRotationCanvasFrames: g });
      window.requestAnimationFrame = (cb) => {
        if (!g.armed) return native(cb);
        const n = id++;
        g.pending.set(n, cb);
        g.all.set(n, cb);
        g.requests++;
        return n;
      };
      window.cancelAnimationFrame = (n) => {
        if (g.all.has(n)) g.pending.delete(n);
        else cancel(n);
      };
    });
    const gate = () =>
      page.evaluate(
        () =>
          (window as unknown as { symbolRotationCanvasFrames: Gate }).symbolRotationCanvasFrames
            .pending.size,
      );
    const flush = () =>
      page.evaluate(() =>
        (
          window as unknown as { symbolRotationCanvasFrames: Gate }
        ).symbolRotationCanvasFrames.flush(),
      );
    const synth = async (type: string, a: number, coalesced = false) => {
      const p = screen(a),
        points = coalesced ? [90, 180, 270, 360].map((a) => screen(a)) : [];
      await stage.evaluate(
        (el, { type, p, points }) => {
          const g = (window as unknown as { symbolRotationCanvasFrames: Gate })
            .symbolRotationCanvasFrames;
          g.armed = true;
          try {
            const e = new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              isPrimary: true,
              pointerType: 'mouse',
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX: p.x,
              clientY: p.y,
            });
            if (points.length)
              Object.defineProperty(e, 'getCoalescedEvents', {
                value: () =>
                  points.map(
                    (p) =>
                      new PointerEvent('pointermove', { pointerId: 1, clientX: p.x, clientY: p.y }),
                  ),
              });
            el.dispatchEvent(e);
          } finally {
            g.armed = false;
          }
        },
        { type, p, points },
      );
    };
    const hook = async (kind: string) =>
      page.evaluate((kind) => {
        const stringify = JSON.stringify;
        const target = Number(
          (
            document.querySelector(
              'input[aria-label="Sampled symbol selection rotation degrees"]',
            ) as HTMLInputElement
          ).value,
        );
        JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
          const out = stringify(value, replacer as never, space),
            d = value as SymbolDefinition;
          if (
            d?.id === 'selection' &&
            d.timeline?.motionSpans?.length === 2 &&
            d.timeline.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
              ?.rotation === target &&
            d.timeline.layers
              ?.find((l) => l.id === 'extra')
              ?.keys.find((k) => k.frame === 4)
              ?.shapes.find((s) => s.id === 'b')?.rotation === target
          ) {
            JSON.stringify = stringify;
            document.documentElement.dataset.symbolRotationCanvasHook = 'yes';
            if (kind === 'source') {
              const e = document.querySelector(
                'input[aria-label="Symbol duration"]',
              ) as HTMLInputElement;
              e.value = '15';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (kind === 'target') {
              const e = document.querySelector(
                'input[aria-label="Sampled symbol selection rotation degrees"]',
              ) as HTMLInputElement;
              e.value = '111';
              e.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              const e = document.querySelector(
                'input[aria-label="Drag sampled symbol selection rotation"]',
              ) as HTMLInputElement;
              for (const checked of [false, true]) {
                e.checked = checked;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
          return out;
        }) as typeof JSON.stringify;
      }, kind);
    if (mode === 'proposed') {
      const point = screen(90);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      expect(await stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
    }
    await stage.evaluate((el) =>
      el.addEventListener(
        'pointerdown',
        (e) => {
          Object.assign(window, {
            symbolRotationDelivered: {
              x: (e as PointerEvent).clientX,
              y: (e as PointerEvent).clientY,
            },
          });
        },
        { once: true },
      ),
    );
    const down = screen(0);
    await page.mouse.move(down.x, down.y);
    await page.mouse.down();
    expect(await stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
    const delivered = await page.evaluate(
      () =>
        (window as unknown as { symbolRotationDelivered: { x: number; y: number } })
          .symbolRotationDelivered,
    );
    start = rotationLocal({ x: delivered.x - view.left, y: delivered.y - view.top }, view);
    let delta = mode === 'shift' ? 38 : mode === 'coalesced' ? 450 : 90;
    if (mode === 'zero') delta = 0;
    if (mode === 'full') {
      await synth('pointermove', 90);
      await synth('pointermove', 180);
      await synth('pointermove', 270);
      delta = 360;
    }
    if (mode === 'return') {
      await synth('pointermove', 45);
      delta = 0;
    }
    if (mode === 'shift') {
      await page.keyboard.down('Shift');
      const p = screen(delta);
      await page.mouse.move(p.x, p.y);
      await page.keyboard.up('Shift');
      delta = 45;
    } else if (!['zero', 'return', 'full'].includes(mode)) {
      if (mode === 'burst') {
        await synth('pointermove', 15);
        await synth('pointermove', 30);
      }
      await synth('pointermove', delta, mode === 'coalesced');
    }
    if (mode.startsWith('prepared-')) await hook(mode.slice(9));
    await flush();
    const rejection = [
      'escape',
      'lost',
      'scroll',
      'view',
      'target',
      'restored-target',
      'policy',
      'restored-policy',
      'frame',
      'close',
      'source',
      'prior',
      'prior-view',
      'selection',
      'mode',
    ].includes(mode);
    if (rejection) {
      if (mode === 'escape' || mode === 'prior' || mode === 'prior-view') {
        if (mode === 'prior-view')
          await stage.evaluate((el) => {
            el.style.width = '700px';
          });
        await page.keyboard.press('Escape');
      }
      if (mode === 'lost')
        await stage.evaluate((el) => (el as HTMLCanvasElement).releasePointerCapture(1));
      if (mode === 'scroll') await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
      if (mode === 'view') {
        await stage.evaluate((el) => {
          el.style.width = '700px';
        });
        await page.waitForTimeout(80);
      }
      if (mode === 'target' || mode === 'restored-target')
        await input.evaluate((el, restore) => {
          const e = el as HTMLInputElement,
            old = e.value;
          for (const value of restore ? ['111', old] : ['111']) {
            e.value = value;
            e.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, mode === 'restored-target');
      if (mode === 'policy' || mode === 'restored-policy')
        await tool.evaluate((el, restore) => {
          const e = el as HTMLInputElement;
          for (const checked of restore ? [false, true] : [false]) {
            e.checked = checked;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, mode === 'restored-policy');
      if (mode === 'selection')
        await editor.getByLabel('Sampled symbol unit @base/r', { exact: true }).evaluate((el) => {
          const e = el as HTMLInputElement;
          e.checked = false;
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      if (mode === 'mode')
        await editor
          .getByLabel('Rotate sampled symbol selection', { exact: true })
          .evaluate((el) => {
            const e = el as HTMLInputElement;
            e.checked = false;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          });
      if (mode === 'frame') {
        await frame.fill('6');
        await frame.press('Tab');
      }
      if (mode === 'close')
        await page.getByLabel('Show sampled symbol stage', { exact: true }).evaluate((el) => {
          const e = el as HTMLInputElement;
          e.checked = false;
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      if (mode === 'source') {
        const duration = page.getByLabel('Symbol duration', { exact: true });
        await duration.fill('15');
        await duration.press('Tab');
      }
      await page.mouse.up();
      if (!['close', 'frame', 'source'].includes(mode))
        expect(await stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(
          false,
        );
      if (mode === 'prior' || mode === 'prior-view') {
        await expect(input).toHaveValue('30');
        await expect(editor.getByLabel('Sampled symbol selection preview')).toBeVisible();
      } else if (!['close', 'frame', 'source'].includes(mode))
        await expect(editor.getByLabel('Sampled symbol selection preview')).toHaveCount(0);
      if (mode === 'restored-policy') {
        await input.fill('0');
        await stage.scrollIntoViewIfNeeded();
        await page.waitForTimeout(80);
        view = await measure();
        const fresh = sampledSelectionRotationHandle(owner.pivot, view);
        start = rotationLocal(fresh.knob, view);
        await stage.evaluate((el) =>
          el.addEventListener(
            'pointerdown',
            (e) =>
              Object.assign(window, {
                symbolRotationDelivered: {
                  x: (e as PointerEvent).clientX,
                  y: (e as PointerEvent).clientY,
                },
              }),
            { once: true },
          ),
        );
        const point = screen(0);
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        expect(await stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(
          true,
        );
        const at = await page.evaluate(
          () =>
            (window as unknown as { symbolRotationDelivered: { x: number; y: number } })
              .symbolRotationDelivered,
        );
        start = rotationLocal({ x: at.x - view.left, y: at.y - view.top }, view);
        await synth('pointermove', 45);
        await synth('pointerup', 45);
        await page.mouse.up();
        await expect(editor.getByLabel('Sampled symbol selection preview')).toBeVisible();
        expect(Number(await input.inputValue())).toBeCloseTo(45, 8);
        await expect(
          page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
        ).toBeDisabled();
      }
      expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    if (mode.startsWith('prepared-')) {
      await expect(page.locator('html')).toHaveAttribute('data-symbol-rotation-canvas-hook', 'yes');
      await page.mouse.up();
      expect(await read()).toEqual(before);
      const undo = page.getByRole('button', { name: 'Undo symbol timeline change', exact: true });
      if (mode === 'prepared-source') await expect(undo).toBeEnabled();
      else await expect(undo).toBeDisabled();
      if (mode !== 'prepared-source')
        await expect(editor.getByLabel('Sampled symbol selection preview')).toHaveCount(0);
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    if (['zero', 'return', 'full'].includes(mode)) {
      await synth('pointerup', delta);
      await page.mouse.up();
      await expect(editor.getByLabel('Sampled symbol selection preview')).toHaveCount(0);
      await expect(input).toHaveValue(String(base));
      expect(await read()).toEqual(before);
      await expect(
        page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      ).toBeDisabled();
      cap.dispose();
      return;
    }
    if (mode === 'burst' || mode === 'coalesced')
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { symbolRotationCanvasFrames: Gate }).symbolRotationCanvasFrames
              .requests,
        ),
      ).toBe(1);
    if (mode.startsWith('release-')) await hook(mode.slice(8));
    await synth('pointerup', delta);
    await page.mouse.up();
    expect(await gate()).toBe(0);
    expect(await stage.evaluate((el) => (el as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      false,
    );
    expect(await read()).toEqual(before);
    if (mode.startsWith('release-')) {
      await expect(page.locator('html')).toHaveAttribute('data-symbol-rotation-canvas-hook', 'yes');
      if (mode !== 'release-source')
        await expect(editor.getByLabel('Sampled symbol selection preview')).toHaveCount(0);
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    await expect(editor.getByLabel('Sampled symbol selection preview')).toBeVisible();
    const degrees = Number(await input.inputValue());
    expect(degrees).toBeCloseTo(base + delta, 7);
    await expect(
      page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
    ).toBeDisabled();
    const expected = await browserSymbolRotationOracle(page, before, requests, degrees);
    // Independent world rotation of an actual original member interior.
    const original = scene[0].key.shapes.find((s) => s.id === 'b')!,
      expectedShape = symbolLayers(expected)[0]
        .keys.find((k) => k.frame === 4)!
        .shapes.find((s) => s.id === 'b')!;
    const point = rotate(worldPoint(original, { x: 14, y: 14 }), owner.pivot, degrees),
      actualPoint = worldPoint(expectedShape, { x: 14, y: 14 });
    expect(actualPoint.x).toBeCloseTo(point.x, 8);
    expect(actualPoint.y).toBeCloseTo(point.y, 8);
    const localPixel = (p: { x: number; y: number }) =>
      stage.evaluate((el, p) => {
        const c = el as HTMLCanvasElement,
          x = Math.floor(20 + (p.x * 290) / 300),
          y = Math.floor(20 + (p.y * 290) / 300);
        return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
      }, p);
    const controls = sampledSelectionRotationHandle(owner.pivot, view, degrees);
    const interior = [
      { x: 6, y: 14 },
      { x: 14, y: 14 },
      { x: 14, y: 6 },
      { x: 4, y: 14 },
      { x: 16, y: 16 },
    ]
      .map((p) => rotate(worldPoint(original, p), owner.pivot, degrees))
      .find((p) => {
        const at = {
          x: ((20 + p.x * view.zoom) * view.cssWidth) / 540,
          y: ((20 + p.y * view.zoom) * view.cssHeight) / 330,
        };
        return (
          Math.hypot(at.x - h.knob.x, at.y - h.knob.y) > 9 &&
          Math.hypot(at.x - controls.knob.x, at.y - controls.knob.y) > 7 &&
          Math.hypot(at.x - h.center.x, at.y - h.center.y) > 7
        );
      });
    expect(interior, 'visible original artwork interior').toBeDefined();
    await expect.poll(() => localPixel(interior!)).toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => localPixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    await commit.click();
    await expect(page.getByLabel('Show sampled symbol stage', { exact: true })).not.toBeChecked();
    const readout = page.getByLabel('Authored sampled symbol selection rotation');
    await expect(readout).toHaveText(
      `Rotation \u00b7 ${degrees}\u00b0 \u00b7 Pivot ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`,
    );
    const selectedCount = owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0);
    await expect(
      page.getByText(selectedCount + ' objects selected. Cyan outlines show', { exact: false }),
    ).toBeVisible();
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
    for (const cue of cues)
      expect(cue.count, cue.id + ' authored selection pixels').toBeGreaterThan(0);
    const undo = page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      redo = page.getByRole('button', { name: 'Redo symbol timeline change', exact: true });
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(readout).toHaveCount(0);
    await redo.click();
    await expect(readout).toBeVisible();
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
    }
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
    expect(errors).toEqual([]);
    cap.dispose();
  });
