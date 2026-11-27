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
import {
  sampledSelectionScaleBounds,
  sampledSelectionScaleHandles,
} from '../../apps/editor/src/sampled-scale-handles';
import { rotationLocal } from '../../apps/editor/src/sampled-rotation-handle';
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
function scaleFixture(mode: string) {
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
function fixture(mode: string) {
  const original = canvasMotionFixture(mode),
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
async function arm(page: Page, action: string, complete = false, publication = false) {
  await page.evaluate(
    ({ action, complete, publication }) => {
      const apply = () => {
        Object.assign(window, { symbolScaleHook: true });
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
        else if (action === 'mode') check('Scale sampled symbol selection', [false, true]);
        else if (action === 'policy') check('Drag sampled symbol selection scale', [false, true]);
        else
          input(
            action === 'y'
              ? 'Sampled symbol selection Y scale'
              : 'Sampled symbol selection X scale',
            action === 'restored' ? ['170', '150'] : ['170'],
          );
      };
      if (complete) {
        const factor =
          Number(
            (
              document.querySelector(
                'input[aria-label="Sampled symbol selection X scale"]',
              ) as HTMLInputElement
            ).value,
          ) / 100;
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
            Object.assign(window, { symbolScalePublicationReads: n });
            apply();
          }
          return out;
        }) as typeof JSON.stringify;
        function symbolLayersForHook(d: SymbolDefinition) {
          return (
            d.timeline?.motionSpans?.length === 2 &&
            d.timeline.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
              ?.transform?.[0] === factor &&
            d.timeline.layers
              ?.filter((l) => l.id === 'extra')
              .every(
                (l) =>
                  l.motionSpans?.length === 2 &&
                  l.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
                    ?.transform?.[0] === factor,
              )
          );
        }
      } else {
        const clone = structuredClone;
        window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
          const out = clone(value, options),
            d = value as SymbolDefinition;
          if (d?.id === 'selection' && d.timeline) {
            window.structuredClone = clone;
            apply();
          }
          return out;
        }) as typeof structuredClone;
      }
    },
    { action, complete, publication },
  );
}
type SymbolScaleFrames = {
  armed: boolean;
  pending: Map<number, FrameRequestCallback>;
  all: Map<number, FrameRequestCallback>;
  flush(): void;
  late(): void;
};
declare global {
  interface Window {
    selectionSymbolScaleFrames: SymbolScaleFrames;
  }
}
function canvasMotionFixture(mode: string) {
  const p = scaleFixture(mode);
  if (mode === 'offview')
    for (const l of p.layers) {
      const end = l.id === 'base' ? 8 : 10;
      for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === end))
        for (const s of k.shapes) s.pivot = localPoint(s, { x: -500, y: -300 });
      l.motionSpans![0].options!.pivots = true;
      refreshBasicMotionSpan(p, [l.id], 0, end);
    }
  if (['opaque', 'locked', 'transparent', 'hidden'].includes(mode))
    p.layers.push({
      id: 'cover',
      name: 'Cover',
      visible: mode !== 'hidden',
      locked: mode === 'locked',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              id: 'cover',
              kind: 'rectangle',
              x: 156,
              y: 76,
              width: 12,
              height: 12,
              rotation: 0,
              fill: '#000000',
              stroke: '#000000',
              strokeWidth: 0,
              points: [],
              ...(mode === 'transparent' ? { opacity: 0 } : {}),
            },
          ],
        },
      ],
    });
  return p;
}
function canvasFixture(mode: string) {
  return fixture(mode);
}
for (const mode of [
  'base',
  'nw',
  'ne',
  'sw',
  'edge-n',
  'edge-e',
  'edge-s',
  'edge-w',
  'shift',
  'css',
  'offset',
  'prior',
  'prior-view',
  'zero',
  'return',
  'multi',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'common',
  'defaults',
  'offview',
  'children',
  'opaque',
  'locked',
  'transparent',
  'hidden',
  'proposed-pick',
  'retained',
  'escape',
  'pointercancel',
  'lostcapture',
  'blur',
  'resize',
  'scroll',
  'view',
  'frame',
  'close',
  'mode',
  'capture-target',
  'capture-policy',
  'capture-source',
  'prepared-target',
  'prepared-policy',
  'prepared-source',
  'release-target',
  'release-restored',
  'release-policy',
  'release-source',
  'release-view',
  'foreign',
  'second-pose',
  'coalesced',
  'cancel',
  'release',
  'guard',
  'negative',
])
  test('isolated sampled selection scale canvas ' + mode, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1800 });
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      canvasFixture(mode),
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        ),
      before = await read();
    const source = before.symbols!.find((s) => s.id === 'selection')!;
    await page
      .getByRole('group', { name: 'Symbol Selection', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
    const frame = page.getByLabel('Symbol frame', { exact: true }),
      show = page.getByLabel('Show sampled symbol stage', { exact: true });
    await frame.fill('5');
    await frame.press('Tab');
    await show.check();
    const stage = page.getByLabel('Sampled symbol stage', { exact: true });
    await page.getByLabel('Select multiple sampled symbol units', { exact: true }).check();
    const editor = page.getByRole('group', { name: 'Sampled symbol selection set' });
    const picks =
      mode === 'multi' || /^(prepared|release)-/.test(mode)
        ? [
            ['@base', 'r'],
            ['@base', 'b'],
            ['extra', 'b'],
          ]
        : [
            ['@base', 'r'],
            ['@base', 'b'],
          ];
    for (const [layer, id] of picks)
      await editor.getByLabel('Sampled symbol unit ' + layer + '/' + id, { exact: true }).check();
    if (mode === 'retained') {
      await editor.getByLabel('Drag sampled symbol selection offsets').check();
      await editor.getByLabel('Author sampled symbol selection drag on release').check();
      await editor.getByLabel('Rotate sampled symbol selection', { exact: true }).check();
      await editor.getByLabel('Drag sampled symbol selection rotation', { exact: true }).check();
      await editor.getByLabel('Author sampled symbol selection rotation on release').check();
    }
    await editor.getByLabel('Scale sampled symbol selection', { exact: true }).check();
    const x = editor.getByLabel('Sampled symbol selection X scale'),
      y = editor.getByLabel('Sampled symbol selection Y scale'),
      tool = editor.getByLabel('Drag sampled symbol selection scale', { exact: true }),
      commit = editor.getByRole('button', {
        name: 'Commit sampled symbol selection scale',
        exact: true,
      });
    const prior = mode === 'prior' || mode === 'prior-view';
    if (prior) {
      await x.fill('140');
      await y.fill('70');
      await editor
        .getByRole('button', { name: 'Preview sampled symbol selection scale', exact: true })
        .click();
    }
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => ({
        definition: source,
        symbols: before.symbols!,
        assets: before.assets,
        frame: 4,
        revision: 0,
      })),
      requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId })),
      owner = cap.resolveScale(requests),
      scene = cap.scene;
    const members = owner.tracks.flatMap((t) =>
        scene
          .find((l) => l.layerId === t.layerId)!
          .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
      ),
      box = sampledSelectionScaleBounds(members);
    await tool.check();
    if (mode === 'css')
      await stage.evaluate((el) => {
        el.style.width = '700px';
        el.style.height = '360px';
      });
    const measure = () =>
      stage.evaluate((el, pivot) => {
        const c = el as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          width = c.width / devicePixelRatio,
          height = c.height / devicePixelRatio;
        return {
          left: r.left,
          top: r.top,
          origin: { x: 20, y: 20 },
          zoom: 290 / 300,
          width,
          height,
          cssWidth: r.width,
          cssHeight: r.height,
          pivot,
        };
      }, owner.pivot);
    const settle = async () => {
      await stage.scrollIntoViewIfNeeded();
      await stage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    };
    await settle();
    let view = await measure();
    const id = mode.startsWith('edge-')
      ? 'scale-' + mode.slice(5)
      : ['nw', 'ne', 'sw'].includes(mode)
        ? mode
        : 'se';
    let handle = sampledSelectionScaleHandles(box, owner.pivot, view).handles.find(
      (h) => h.id === id,
    )!;
    const marker = await stage.evaluate((el, p) => {
      const c = el as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        sx = c.width / r.width,
        sy = c.height / r.height,
        d = c
          .getContext('2d')!
          .getImageData(
            Math.floor((p.x - 6) * sx),
            Math.floor((p.y - 6) * sy),
            Math.ceil(12 * sx) + 1,
            Math.ceil(12 * sy) + 1,
          ).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] < 80 && d[i + 1] > 100 && d[i + 2] > 130 && d[i + 3] === 255) n++;
      return n;
    }, handle.point);
    expect(marker, 'original private scale marker').toBeGreaterThan(8);
    await page.evaluate(() => {
      const request = requestAnimationFrame.bind(window),
        cancel = cancelAnimationFrame.bind(window);
      let next = 1100000000;
      const g: SymbolScaleFrames = {
        armed: false,
        pending: new Map(),
        all: new Map(),
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
        late() {
          g.all.forEach((cb) => cb(performance.now()));
        },
      };
      window.selectionSymbolScaleFrames = g;
      window.requestAnimationFrame = (cb) => {
        if (!g.armed) return request(cb);
        const id = next++;
        g.pending.set(id, cb);
        g.all.set(id, cb);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (g.all.has(id)) g.pending.delete(id);
        else cancel(id);
      };
    });
    await stage.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (event) => {
          const e = event as PointerEvent;
          (c as HTMLElement).dataset.scalePointer = String(e.pointerId);
          (c as HTMLElement).dataset.scaleDown = JSON.stringify({ x: e.clientX, y: e.clientY });
        },
        true,
      ),
    );
    // Keep the actual native target through keyed source/frame remounts and
    // closing the stage; querying the replacement cannot prove capture cleanup.
    let nativeStage = (await stage.elementHandle())!;
    let offset = { x: 0, y: 0 };
    const start = async () => {
      await settle();
      view = await measure();
      handle = sampledSelectionScaleHandles(box, owner.pivot, view).handles.find(
        (h) => h.id === id,
      )!;
      await page.mouse.move(
        view.left + handle.point.x + (mode === 'offset' ? 3 : 0),
        view.top + handle.point.y + (mode === 'offset' ? -2 : 0),
      );
      nativeStage = (await stage.elementHandle())!;
      await page.mouse.down();
      const actual = await nativeStage.evaluate(
          (c) => JSON.parse((c as HTMLElement).dataset.scaleDown!) as { x: number; y: number },
        ),
        point = rotationLocal({ x: actual.x - view.left, y: actual.y - view.top }, view);
      offset = { x: point.x - handle.anchor.x, y: point.y - handle.anchor.y };
    };
    const screen = (sx: number, sy: number) => {
      const p = {
        x: owner.pivot.x + sx * (handle.anchor.x - owner.pivot.x) + offset.x,
        y: owner.pivot.y + sy * (handle.anchor.y - owner.pivot.y) + offset.y,
      };
      return {
        x: view.left + ((p.x * view.zoom + view.origin.x) * view.cssWidth) / view.width,
        y: view.top + ((p.y * view.zoom + view.origin.y) * view.cssHeight) / view.height,
      };
    };
    const send = async (
      type: string,
      sx: number,
      sy: number,
      fields: { pointerId?: number; shiftKey?: boolean; coalesced?: boolean } = {},
    ) => {
      const at = screen(sx, sy);
      await stage.evaluate(
        (c, { type, at, fields }) => {
          const g = window.selectionSymbolScaleFrames,
            id = Number((c as HTMLElement).dataset.scalePointer),
            event = new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: fields.pointerId ?? id,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX: at.x,
              clientY: at.y,
              shiftKey: fields.shiftKey ?? false,
            });
          if (fields.coalesced)
            Object.defineProperty(event, 'getCoalescedEvents', {
              value: () => [
                new PointerEvent(type, { pointerId: id, clientX: at.x - 2, clientY: at.y - 2 }),
                new PointerEvent(type, { pointerId: id, clientX: at.x - 1, clientY: at.y - 1 }),
              ],
            });
          g.armed = true;
          try {
            c.dispatchEvent(event);
          } finally {
            g.armed = false;
          }
        },
        { type, at, fields },
      );
    };
    const captured = () =>
      nativeStage.evaluate((c) =>
        (c as HTMLCanvasElement).hasPointerCapture(Number((c as HTMLElement).dataset.scalePointer)),
      );
    const pending = () => page.evaluate(() => window.selectionSymbolScaleFrames.pending.size);
    const sourceRejected = async () => {
      expect(await read()).toEqual(before);
      await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('15');
      await expect(
        page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
      const expected = structuredClone(before);
      expected.symbols!.find((s) => s.id === 'selection')!.timeline!.duration = 15;
      expect(await read()).toEqual(expected);
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
    };
    if (mode === 'proposed-pick') {
      await x.fill('200');
      await y.fill('50');
      await settle();
      view = await measure();
      const proposed = sampledSelectionScaleHandles(box, owner.pivot, view, {
        x: 2,
        y: 0.5,
      }).handles.find((h) => h.id === id)!;
      await page.mouse.move(view.left + proposed.point.x, view.top + proposed.point.y);
      await page.mouse.down();
      expect(await captured()).toBe(false);
      await page.mouse.up();
      await expect(x).toHaveValue('200');
      expect(await read()).toEqual(before);
    }
    if (mode.startsWith('capture-')) await arm(page, mode.slice(8));
    await start();
    if (mode === 'opaque' || mode === 'locked') {
      expect(await captured()).toBe(false);
      await page.mouse.up();
      expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      return;
    }
    if (mode.startsWith('capture-')) {
      expect(
        await page.evaluate(
          () => (window as unknown as { symbolScaleHook: boolean }).symbolScaleHook,
        ),
      ).toBe(true);
      expect(await captured()).toBe(false);
      await page.mouse.up();
      if (mode === 'capture-source') {
        await sourceRejected();
        return;
      }
      if (mode === 'capture-target') await expect(x).toHaveValue('170');
      expect(await read()).toEqual(before);
      await start();
      expect(await captured()).toBe(true);
    } else expect(await captured()).toBe(true);
    await expect(x).toHaveValue('100');
    await expect(y).toHaveValue('100');
    let sx =
      mode === 'negative'
        ? -1
        : mode.startsWith('edge-') && ['n', 's'].includes(mode.slice(5))
          ? 1
          : 1.5;
    let sy =
      mode.startsWith('edge-') && ['e', 'w'].includes(mode.slice(5))
        ? 1
        : mode === 'shift'
          ? 1.5
          : 0.75;
    if (mode === 'foreign') {
      await send('pointermove', 2, 0.5, { pointerId: 99 });
      await send('pointerup', 2, 0.5, { pointerId: 99 });
      expect(await captured()).toBe(true);
      await expect(x).toHaveValue('100');
      expect(await pending()).toBe(0);
    }
    if (mode === 'zero') {
      await send('pointerup', 1, 1);
      await page.mouse.up();
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      await expect(
        editor.getByRole('status', { name: 'Sampled symbol selection preview', exact: true }),
      ).toHaveCount(0);
      expect(await read()).toEqual(before);
      return;
    }
    await send('pointermove', 1.1, 0.9);
    await send('pointermove', sx, mode === 'shift' ? 0.75 : sy, {
      shiftKey: mode === 'shift',
      coalesced: mode === 'coalesced',
    });
    expect(await pending()).toBe(1);
    if (mode === 'base' || mode === 'children') {
      const source = worldPoint(members[0], { x: 6, y: 14 }),
        p = {
          x: owner.pivot.x + sx * (source.x - owner.pivot.x),
          y: owner.pivot.y + sy * (source.y - owner.pivot.y),
        };
      expect(
        await stage.evaluate((el, p) => {
          const c = el as HTMLCanvasElement;
          return Array.from(
            c
              .getContext('2d')!
              .getImageData(
                Math.floor(20 + (p.x * 290) / 300),
                Math.floor(20 + (p.y * 290) / 300),
                1,
                1,
              ).data,
          );
        }, p),
      ).toEqual([255, 255, 255, 255]);
    }
    if (mode.startsWith('prepared-')) await arm(page, mode.slice(9), true);
    if (mode !== 'release') await page.evaluate(() => window.selectionSymbolScaleFrames.flush());
    if (mode === 'guard' || mode === 'negative') {
      await expect(editor.getByRole('alert')).toBeVisible();
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      await page.mouse.up();
      expect(await read()).toEqual(before);
      if (mode === 'guard') {
        await page.getByLabel('Select multiple sampled symbol units').uncheck();
        await page
          .getByLabel('Sampled symbol artwork', { exact: true })
          .selectOption(JSON.stringify(['@base', 'r']));
        await page
          .getByRole('button', { name: 'Promote sampled symbol pose', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
          .click();
        await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
        expect(await read()).toEqual(before);
      }
      return;
    }
    if (mode.startsWith('prepared-')) {
      expect(
        await page.evaluate(
          () => (window as unknown as { symbolScaleHook: boolean }).symbolScaleHook,
        ),
      ).toBe(true);
      expect(await captured()).toBe(false);
      await page.mouse.up();
      if (mode === 'prepared-source') {
        await sourceRejected();
        return;
      }
      if (mode === 'prepared-target') await expect(x).toHaveValue('170');
      expect(await read()).toEqual(before);
      return;
    }
    const cancellations = [
      'escape',
      'pointercancel',
      'lostcapture',
      'blur',
      'resize',
      'scroll',
      'view',
      'frame',
      'close',
      'mode',
      'return',
      'prior',
      'prior-view',
    ];
    if (cancellations.includes(mode)) {
      if (mode === 'escape' || mode === 'prior') await page.keyboard.press('Escape');
      else if (mode === 'pointercancel') await send('pointercancel', sx, sy);
      else if (mode === 'lostcapture')
        await stage.evaluate((c) => {
          const el = c as HTMLCanvasElement;
          el.releasePointerCapture(Number(el.dataset.scalePointer));
        });
      else if (mode === 'blur') await stage.evaluate((c) => (c as HTMLCanvasElement).blur());
      else if (mode === 'resize' || mode === 'scroll')
        await page.evaluate((kind) => window.dispatchEvent(new Event(kind)), mode);
      else if (mode === 'view' || mode === 'prior-view')
        await stage.evaluate((c) => {
          c.style.width = '700px';
        });
      else if (mode === 'frame')
        await frame.evaluate((el: HTMLInputElement) => {
          el.value = '6';
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      else if (mode === 'close')
        await show.evaluate((el: HTMLInputElement) => {
          el.checked = false;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      else if (mode === 'mode')
        await tool.evaluate((el: HTMLInputElement) => {
          el.checked = false;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      else await send('pointerup', 1, 1);
      await page.mouse.up();
      await page.evaluate(() => window.selectionSymbolScaleFrames.late());
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      expect(await read()).toEqual(before);
      if (mode === 'frame') await expect(frame).toHaveValue('6');
      if (mode === 'close') await expect(show).not.toBeChecked();
      if (prior) {
        await expect(x).toHaveValue('140');
        await expect(y).toHaveValue('70');
        await expect(
          editor.getByRole('status', { name: 'Sampled symbol selection preview', exact: true }),
        ).toBeVisible();
      } else if (await editor.isVisible())
        await expect(
          editor.getByRole('status', { name: 'Sampled symbol selection preview', exact: true }),
        ).toHaveCount(0);
      expect(errors).toEqual([]);
      return;
    }
    const targetX = Number(await x.inputValue()) / 100,
      targetY = Number(await y.inputValue()) / 100;
    const originalMarkers = sampledSelectionScaleHandles(box, owner.pivot, view).handles,
      proposedMarkers = sampledSelectionScaleHandles(box, owner.pivot, view, {
        x: targetX,
        y: targetY,
      }).handles;
    const paint = [
      { x: 6, y: 14 },
      { x: 10, y: 10 },
      { x: 14, y: 14 },
      { x: 14, y: 6 },
      { x: 4, y: 14 },
      { x: 16, y: 16 },
      { x: 8, y: 14 },
      { x: 12, y: 14 },
    ]
      .map((local) => {
        const p = worldPoint(members[0], local);
        return {
          x: owner.pivot.x + targetX * (p.x - owner.pivot.x),
          y: owner.pivot.y + targetY * (p.y - owner.pivot.y),
        };
      })
      .find((p) => {
        const css = {
          x: ((p.x * view.zoom + view.origin.x) * view.cssWidth) / view.width,
          y: ((p.y * view.zoom + view.origin.y) * view.cssHeight) / view.height,
        };
        return (
          originalMarkers.every(
            (h) => Math.max(Math.abs(css.x - h.point.x), Math.abs(css.y - h.point.y)) > 6,
          ) &&
          proposedMarkers.every(
            (h) => Math.max(Math.abs(css.x - h.point.x), Math.abs(css.y - h.point.y)) > 3,
          )
        );
      });
    if (!paint) throw Error('No original interior is clear of the scale markers.');
    const pixel = (p: { x: number; y: number }) =>
      stage.evaluate((c, p) => {
        const el = c as HTMLCanvasElement;
        return Array.from(
          el
            .getContext('2d')!
            .getImageData(
              Math.floor(20 + (p.x * 290) / 300),
              Math.floor(20 + (p.y * 290) / 300),
              1,
              1,
            ).data,
        );
      }, p);
    if (mode !== 'release') await expect.poll(() => pixel(paint)).toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    const proposed = sampledSelectionScaleHandles(box, owner.pivot, view, {
      x: targetX,
      y: targetY,
    }).handles.find((h) => h.id === id)!;
    const orange = await stage.evaluate((c, p) => {
      const el = c as HTMLCanvasElement,
        r = el.getBoundingClientRect(),
        x = (p.x * el.width) / r.width,
        y = (p.y * el.height) / r.height,
        d = el.getContext('2d')!.getImageData(Math.floor(x - 3), Math.floor(y - 3), 7, 7).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] === 255 && d[i + 1] === 191 && d[i + 2] === 102 && d[i + 3] === 255) n++;
      return n;
    }, proposed.point);
    expect(orange, 'proposed display marker at numeric target').toBeGreaterThan(2);
    if (mode === 'second-pose') {
      sx = 1.25;
      sy = 1.2;
      await send('pointermove', sx, sy);
      await page.evaluate(() => window.selectionSymbolScaleFrames.flush());
    }
    if (mode.startsWith('release-') && mode !== 'release-view')
      await arm(page, mode.slice(8), true);
    if (mode === 'release-view')
      await stage.evaluate((el) => {
        const c = el as HTMLCanvasElement,
          release = c.releasePointerCapture.bind(c);
        c.releasePointerCapture = (id) => {
          release(id);
          c.style.width = '700px';
        };
      });
    await send('pointerup', sx, mode === 'shift' ? 0.75 : sy, { shiftKey: mode === 'shift' });
    await page.mouse.up();
    expect(await captured()).toBe(false);
    expect(await pending()).toBe(0);
    if (mode.startsWith('release-')) {
      if (mode !== 'release-view')
        expect(
          await page.evaluate(
            () => (window as unknown as { symbolScaleHook: boolean }).symbolScaleHook,
          ),
        ).toBe(true);
      if (mode === 'release-source') {
        await sourceRejected();
        return;
      }
      if (mode === 'release-target') await expect(x).toHaveValue('170');
      await expect(
        editor.getByRole('status', { name: 'Sampled symbol selection preview', exact: true }),
      ).toHaveCount(0);
      expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      if (mode !== 'release-policy') return;
      await start();
      expect(await captured()).toBe(true);
      sx = 1.25;
      sy = 0.8;
      await send('pointerup', sx, sy);
      await page.mouse.up();
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
    }
    expect(Number(await x.inputValue())).toBeCloseTo(sx * 100, 8);
    expect(Number(await y.inputValue())).toBeCloseTo(sy * 100, 8);
    await expect(
      editor.getByRole('status', { name: 'Sampled symbol selection preview', exact: true }),
    ).toBeVisible();
    expect(await read()).toEqual(before);
    const wanted = cap.prepareScale(
      requests,
      Number(await x.inputValue()) / 100,
      Number(await y.inputValue()) / 100,
    );
    await commit.click();
    await expect(show).not.toBeChecked();
    expect(await read()).toEqual(before);
    const count = owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0),
      readout = page.getByLabel('Authored sampled symbol selection scale');
    await expect(
      page.getByText(count + ' objects selected. Cyan outlines show', { exact: false }),
    ).toBeVisible();
    await expect(readout).toHaveText(
      `Scale · ${(sx * 100).toFixed(2)}%, ${(sy * 100).toFixed(2)}% · Pivot ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`,
    );
    const boxes = owner.tracks.flatMap((t) =>
      symbolLayers(wanted)
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
      return;
    }
    await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const result = await read(),
      actual = result.symbols!.find((s) => s.id === 'selection')!;
    expect(comparable(actual)).toEqual(comparable(wanted));
    expect({ ...result, symbols: before.symbols }).toEqual(before);
    expect(actual.buttonStates).toEqual(source.buttonStates);
    expect(actual.multiFramePivot).toEqual(source.multiFramePivot);
    for (const t of owner.tracks) {
      const l = symbolLayers(actual).find((l) => l.id === t.layerId)!,
        old = symbolLayers(source).find((l) => l.id === t.layerId)!;
      expect(l.motionSpans![0].id).toBe(old.motionSpans![0].id);
      expect(l.keys.filter((k) => [0, t.end, 12].includes(k.frame))).toEqual(
        old.keys.filter((k) => [0, t.end, 12].includes(k.frame)),
      );
    }
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
    expect(errors).toEqual([]);
    cap.dispose();
  });
