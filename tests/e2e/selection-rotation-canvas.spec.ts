import { test, expect, type Page } from '@playwright/test';
import { browserRotationOracle } from './browser-rotation-oracle';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
import { captureRememberedSelectionAuthoringFrame } from '../../packages/animation/src/selection-motion-owner';
import { worldPoint, localPoint } from '../../packages/geometry/src';
import {
  sampledSelectionRotationHandle,
  rotationLocal,
} from '../../apps/editor/src/sampled-rotation-handle';
type RotationFrames = {
  armed: boolean;
  pending: Map<number, FrameRequestCallback>;
  all: Map<number, FrameRequestCallback>;
  requests: number;
  flush(): void;
  late(): void;
};
declare global {
  interface Window {
    selectionRotationFrames: RotationFrames;
  }
}
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
function comparable(project: Project) {
  return {
    ...project,
    layers: project.layers.map((l) => ({
      ...l,
      motionSpans: l.motionSpans?.map((s) => ({ ...s, id: 'prepared-span' })),
    })),
  };
}

function rotationFixture(mode: string) {
  const p = fixture(mode === 'absorbed' ? 'affine' : mode);
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

function canvasFixture(mode: string) {
  const p = rotationFixture(mode);
  if (mode === 'foreground') {
    const cap = captureRememberedSelectionAuthoringFrame(() => ({
        project: p,
        frame: 4,
        revision: 0,
      })),
      owner = cap.resolveRotation([
        { layerId: 'base', shapeId: 'r' },
        { layerId: 'base', shapeId: 'b' },
      ]);
    cap.dispose();
    p.layers.push({
      id: 'front',
      name: 'Locked foreground',
      locked: true,
      visible: true,
      drawingMode: 'object',
      keys: [
        {
          frame: 0,
          shapes: [
            {
              id: 'cover',
              kind: 'rectangle',
              x: owner.pivot.x - 8,
              y: owner.pivot.y - 40,
              width: 16,
              height: 16,
              rotation: 0,
              fill: '#00ff00',
              stroke: '#00ff00',
              strokeWidth: 0,
              points: [],
            },
          ],
        },
      ],
    });
  }
  return p;
}
async function frameState(page: Page) {
  return page.evaluate(() => ({
    pending: window.selectionRotationFrames.pending.size,
    requests: window.selectionRotationFrames.requests,
  }));
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
  'css',
  'shift',
  'offset',
  'children',
  'burst',
  'coalesced',
  'second-pose',
  'release',
  'retained',
  'foreground',
  'proposed',
  'prior',
  'prior-view',
  'zero',
  'return',
  'zero-total',
  'escape',
  'pointercancel',
  'lost',
  'blur',
  'canvas-blur',
  'scroll',
  'view',
  'target',
  'restored-target',
  'selection',
  'policy',
  'restored-policy',
  'source',
  'frame',
  'close',
  'mode',
  'capture-policy',
  'capture-target',
  'capture-restored-target',
  'prepared-policy',
  'prepared-target',
  'prepared-source',
  'release-policy',
  'release-target',
  'release-restored-target',
  'release-source',
  'release-view',
  'wrong-pointer',
  'touch',
  'secondary',
])
  test('main sampled selection rotation canvas ' + mode, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1800 });
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
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
    await page.getByLabel('Timeline frames').click({ position: { x: 81, y: 40 } });
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    const region = page.getByRole('region', { name: 'Sampled motion stage' }),
      stage = page.getByLabel('Drawing stage', { exact: true });
    if (mode === 'children') {
      await region.getByLabel('Remember sampled stage children').check();
      await expect(region.getByLabel('Sampled stage artwork')).toBeEnabled();
    }
    await region.getByLabel('Select multiple sampled units').check();
    const editor = region.getByRole('group', { name: 'Sampled selection set' });
    const picks =
      mode === 'multi' || mode.startsWith('prepared-') || mode.startsWith('release-')
        ? [
            ['base', 'r'],
            ['base', 'b'],
            ['extra', 'b'],
          ]
        : [
            ['base', 'r'],
            ['base', 'b'],
          ];
    for (const [layer, id] of picks)
      await editor.getByLabel('Sampled unit ' + layer + '/' + id, { exact: true }).check();
    if (mode === 'retained') {
      await editor.getByLabel('Drag sampled selection offsets').check();
      await editor.getByLabel('Author sampled selection drag on release').check();
    }
    await editor.getByLabel('Rotate sampled selection', { exact: true }).check();
    const input = editor.getByLabel('Sampled selection rotation degrees'),
      tool = editor.getByLabel('Drag sampled selection rotation', { exact: true });
    let base = mode === 'offset' || mode === 'prior' || mode === 'prior-view' ? 30 : 0;
    if (base) {
      await input.fill(String(base));
      if (mode !== 'offset')
        await editor
          .getByRole('button', { name: 'Preview sampled selection rotation', exact: true })
          .click();
    }
    const cap = captureRememberedSelectionAuthoringFrame(() => ({
        project: before,
        frame: 4,
        revision: 0,
      })),
      requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId })),
      owner = cap.resolveRotation(requests),
      scene = cap.scene;
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
          origin: { x: width / 2 - 250, y: height / 2 - 150 },
          zoom: 1,
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
    const original = sampledSelectionRotationHandle(owner.pivot, view);
    let startLocal = rotationLocal(
      {
        x: original.knob.x + (mode === 'offset' ? 3 : 0),
        y: original.knob.y + (mode === 'offset' ? -2 : 0),
      },
      view,
    );
    const initialMarkers = await stage.evaluate((el, p) => {
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
    }, original.knob);
    expect(initialMarkers, 'original private rotation handle').toBeGreaterThan(10);
    const screen = (degrees: number, v = view) => {
      const point = rotate(startLocal, owner.pivot, degrees);
      return {
        x: v.left + ((point.x + v.origin.x) * v.cssWidth) / v.width,
        y: v.top + ((point.y + v.origin.y) * v.cssHeight) / v.height,
      };
    };
    await page.evaluate(() => {
      const request = requestAnimationFrame.bind(window),
        cancel = cancelAnimationFrame.bind(window);
      let next = 1100000000;
      const g: RotationFrames = {
        armed: false,
        pending: new Map(),
        all: new Map(),
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
        late() {
          g.all.forEach((cb) => cb(performance.now()));
        },
      };
      window.selectionRotationFrames = g;
      window.requestAnimationFrame = (cb) => {
        if (!g.armed) return request(cb);
        const id = next++;
        g.pending.set(id, cb);
        g.all.set(id, cb);
        g.requests++;
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (g.all.has(id)) g.pending.delete(id);
        else cancel(id);
      };
    });
    const hook = async (kind: string, complete = false) =>
      page.evaluate(
        ({ kind, complete }) => {
          const apply = () => {
            document.documentElement.dataset.selectionRotationHook = 'yes';
            const change = (value: string) => {
              const e = document.querySelector(
                'input[aria-label="Sampled selection rotation degrees"]',
              ) as HTMLInputElement;
              e.value = value;
              e.dispatchEvent(new Event('input', { bubbles: true }));
            };
            if (kind.endsWith('target')) {
              const e = document.querySelector(
                  'input[aria-label="Sampled selection rotation degrees"]',
                ) as HTMLInputElement,
                previous = e.value;
              change('111');
              if (kind.includes('restored-target')) change(previous);
            } else if (kind.endsWith('source'))
              (
                document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement
              ).click();
            else {
              const e = document.querySelector(
                'input[aria-label="Drag sampled selection rotation"]',
              ) as HTMLInputElement;
              e.checked = false;
              e.dispatchEvent(new Event('change', { bubbles: true }));
              e.checked = true;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };
          if (complete) {
            const stringify = JSON.stringify;
            const target = Number(
              (
                document.querySelector(
                  'input[aria-label="Sampled selection rotation degrees"]',
                ) as HTMLInputElement
              ).value,
            );
            JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
              const out = stringify(value, replacer as never, space),
                p = value as Project;
              if (
                p?.layers?.length === 2 &&
                p.layers.every(
                  (l) =>
                    l.motionSpans?.length === 2 &&
                    l.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
                      ?.rotation === target,
                )
              ) {
                JSON.stringify = stringify;
                apply();
              }
              return out;
            }) as typeof JSON.stringify;
          } else {
            const clone = structuredClone;
            window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
              const out = clone(value, options);
              if ((value as Project)?.layers) {
                window.structuredClone = clone;
                apply();
              }
              return out;
            }) as typeof structuredClone;
          }
        },
        { kind, complete },
      );
    if (mode.startsWith('capture-')) await hook(mode);
    await stage.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (event) => {
          (c as HTMLElement).dataset.rotationDown = JSON.stringify({
            x: (event as PointerEvent).clientX,
            y: (event as PointerEvent).clientY,
          });
        },
        true,
      ),
    );
    const start = async () => {
      await settle();
      view = await measure();
      const baseHandle = sampledSelectionRotationHandle(owner.pivot, view);
      startLocal = rotationLocal(
        {
          x: baseHandle.knob.x + (mode === 'offset' ? 3 : 0),
          y: baseHandle.knob.y + (mode === 'offset' ? -2 : 0),
        },
        view,
      );
      const p = screen(0);
      expect(
        await page.evaluate(
          (p) => document.elementFromPoint(p.x, p.y)?.getAttribute('aria-label'),
          p,
        ),
      ).toBe('Drawing stage');
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      const delivered = await stage.evaluate(
        (c) => JSON.parse((c as HTMLElement).dataset.rotationDown!) as { x: number; y: number },
      );
      startLocal = rotationLocal({ x: delivered.x - view.left, y: delivered.y - view.top }, view);
    };
    if (mode === 'proposed') {
      await input.fill('90');
      const p = sampledSelectionRotationHandle(owner.pivot, view, 90);
      await page.mouse.move(view.left + p.knob.x, view.top + p.knob.y);
      await page.mouse.down();
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
      await input.fill('0');
    }
    if (mode === 'touch' || mode === 'secondary') {
      const p = screen(0);
      await stage.dispatchEvent('pointerdown', {
        pointerId: 9,
        pointerType: mode === 'touch' ? 'touch' : 'mouse',
        isPrimary: true,
        button: mode === 'secondary' ? 2 : 0,
        clientX: p.x,
        clientY: p.y,
        bubbles: true,
      });
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(9))).toBe(
        false,
      );
      expect(await read()).toEqual(before);
      return;
    }
    await start();
    if (mode === 'foreground') {
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
      expect(await read()).toEqual(before);
      return;
    }
    if (mode.startsWith('capture-')) {
      expect(
        await page.evaluate(() => document.documentElement.dataset.selectionRotationHook),
      ).toBe('yes');
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
      if (mode === 'capture-target') {
        base = 111;
        await expect(input).toHaveValue('111');
      }
      await start();
    }
    expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
    const move = async (degrees: number, id = 1) => {
      const p = screen(degrees);
      await stage.evaluate(
        (c, p) => {
          window.selectionRotationFrames.armed = true;
          try {
            const event = new PointerEvent('pointermove', {
              pointerId: p.id,
              pointerType: 'mouse',
              isPrimary: true,
              buttons: 1,
              clientX: p.x,
              clientY: p.y,
              shiftKey: p.shift,
              bubbles: true,
            });
            if (p.samples.length)
              Object.defineProperty(event, 'getCoalescedEvents', {
                value: () =>
                  p.samples.map(
                    (point) =>
                      new PointerEvent('pointermove', {
                        pointerId: p.id,
                        pointerType: 'mouse',
                        isPrimary: true,
                        buttons: 1,
                        clientX: point.x,
                        clientY: point.y,
                        bubbles: true,
                      }),
                  ),
              });
            c.dispatchEvent(event);
          } finally {
            window.selectionRotationFrames.armed = false;
          }
        },
        {
          ...p,
          id,
          shift: mode === 'shift',
          samples: mode === 'coalesced' ? [90, 180, 270, 360].map((angle) => screen(angle)) : [],
        },
      );
    };
    const release = (degrees = 90) => {
      const p = screen(degrees);
      return stage.dispatchEvent('pointerup', {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: p.x,
        clientY: p.y,
        shiftKey: mode === 'shift',
        bubbles: true,
      });
    };
    if (mode === 'wrong-pointer') {
      await move(45, 2);
      await stage.dispatchEvent('pointercancel', { pointerId: 2 });
      expect((await frameState(page)).pending).toBe(0);
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
    }
    if (mode === 'zero') {
      await release(0);
      await page.mouse.up();
      expect(await frameState(page)).toEqual({ pending: 0, requests: 0 });
      expect(await read()).toEqual(before);
      return;
    }
    const pointerAngle =
      mode === 'coalesced' ? 450 : mode === 'shift' ? 38 : mode === 'zero-total' ? -30 : 90;
    if (mode === 'zero-total') {
      base = 30;
      await input.evaluate((e: HTMLInputElement) => {
        e.value = '30';
        e.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.mouse.up();
      await start();
    }
    if (mode === 'burst') for (const angle of [10, 20, 30, 40, 50, 60, 70, 80]) await move(angle);
    await move(pointerAngle);
    const expected = base + (mode === 'shift' ? 45 : pointerAngle);
    if (mode === 'zero-total') {
      await release(pointerAngle);
      await page.mouse.up();
      expect(Number(await input.inputValue())).toBe(30);
      expect((await frameState(page)).pending).toBe(0);
      expect(await read()).toEqual(before);
      return;
    }
    expect(Number(await input.inputValue())).toBeCloseTo(expected, 8);
    expect((await frameState(page)).pending).toBe(1);
    if (mode === 'burst' || mode === 'coalesced') expect((await frameState(page)).requests).toBe(1);
    if (mode === 'return') {
      await move(0);
      await release(0);
      await page.mouse.up();
      expect(Number(await input.inputValue())).toBe(base);
      expect((await frameState(page)).pending).toBe(0);
      expect(await read()).toEqual(before);
      return;
    }
    if (
      [
        'escape',
        'pointercancel',
        'lost',
        'blur',
        'canvas-blur',
        'scroll',
        'view',
        'target',
        'restored-target',
        'selection',
        'policy',
        'restored-policy',
        'source',
        'frame',
        'close',
        'mode',
        'prior',
        'prior-view',
      ].includes(mode)
    ) {
      if (mode === 'escape' || mode === 'prior') await page.keyboard.press('Escape');
      else if (mode === 'pointercancel')
        await stage.dispatchEvent('pointercancel', { pointerId: 1 });
      else if (mode === 'lost')
        await stage.evaluate((c) => (c as HTMLCanvasElement).releasePointerCapture(1));
      else if (mode === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (mode === 'canvas-blur') await stage.dispatchEvent('blur');
      else if (mode === 'scroll')
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
      else if (mode === 'view' || mode === 'prior-view')
        await stage.evaluate((el) => {
          el.style.width = '700px';
        });
      else if (mode === 'target' || mode === 'restored-target')
        await input.evaluate((e: HTMLInputElement, restored) => {
          const prior = e.value;
          e.value = '77';
          e.dispatchEvent(new Event('input', { bubbles: true }));
          if (restored) {
            e.value = prior;
            e.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, mode === 'restored-target');
      else if (mode === 'selection')
        await editor.getByLabel('Sampled unit base/b').evaluate((e: HTMLInputElement) => {
          e.checked = false;
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      else if (mode === 'policy' || mode === 'restored-policy')
        await tool.evaluate((e: HTMLInputElement, restored) => {
          e.checked = false;
          e.dispatchEvent(new Event('change', { bubbles: true }));
          if (restored) {
            e.checked = true;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, mode === 'restored-policy');
      else if (mode === 'mode')
        await editor.getByLabel('Rotate sampled selection').evaluate((e: HTMLInputElement) => {
          e.checked = false;
          e.dispatchEvent(new Event('change', { bubbles: true }));
          e.checked = true;
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
      else if (mode === 'source')
        await page
          .getByRole('button', { name: 'Add layer', exact: true })
          .evaluate((el: HTMLButtonElement) => el.click());
      else if (mode === 'frame')
        await page
          .getByRole('button', { name: 'Next frame', exact: true })
          .evaluate((el: HTMLButtonElement) => el.click());
      else
        await region
          .getByRole('button', { name: 'Return to authored stage', exact: true })
          .evaluate((el: HTMLButtonElement) => el.click());
      await page.mouse.up();
      await page.evaluate(() => window.selectionRotationFrames.late());
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      expect((await frameState(page)).pending).toBe(0);
      if (mode === 'target') await expect(input).toHaveValue('77');
      if (mode === 'restored-target')
        expect(Number(await input.inputValue())).toBeCloseTo(expected, 8);
      if (mode === 'frame')
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
      if (mode === 'close') await expect(region).toBeHidden();
      if (mode === 'prior' || mode === 'prior-view') {
        await expect(input).toHaveValue('30');
        await expect(
          editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
        ).toBeVisible();
      }
      if (mode === 'restored-policy') {
        await start();
        expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
          true,
        );
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      if (mode === 'source') {
        const changed = await read();
        expect(changed.layers).toHaveLength(before.layers.length + 1);
        expect(changed.layers.slice(0, 2)).toEqual(before.layers);
      } else expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      return;
    }
    if (mode.startsWith('prepared-')) {
      await hook(mode, true);
      await page.evaluate(() => window.selectionRotationFrames.flush());
      expect(
        await page.evaluate(() => document.documentElement.dataset.selectionRotationHook),
      ).toBe('yes');
      await page.mouse.up();
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      expect((await frameState(page)).pending).toBe(0);
      await page.evaluate(() => window.selectionRotationFrames.late());
      if (mode === 'prepared-target') await expect(input).toHaveValue('111');
      if (mode === 'prepared-source')
        expect((await read()).layers.slice(0, 2)).toEqual(before.layers);
      else expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      return;
    }
    if (mode !== 'release') await page.evaluate(() => window.selectionRotationFrames.flush());
    const first = scene
        .find((t) => t.layerId === owner.tracks[0].layerId)!
        .key.shapes.find((s) => s.id === owner.tracks[0].shapeIds[0])!,
      paintPoint = [
        { x: 6, y: 14 },
        { x: 14, y: 14 },
        { x: 14, y: 6 },
        { x: 4, y: 14 },
        { x: 16, y: 16 },
      ]
        .map((point) => rotate(worldPoint(first, point), owner.pivot, expected))
        .find((point) => {
          const css = {
            x: ((point.x + view.origin.x) * view.cssWidth) / view.width,
            y: ((point.y + view.origin.y) * view.cssHeight) / view.height,
          };
          const handle = sampledSelectionRotationHandle(owner.pivot, view, expected);
          return (
            Math.hypot(css.x - original.knob.x, css.y - original.knob.y) > 9 &&
            Math.hypot(css.x - handle.knob.x, css.y - handle.knob.y) > 7 &&
            Math.hypot(css.x - handle.center.x, css.y - handle.center.y) > 7
          );
        });
    if (!paintPoint) throw Error('No fixture interior is clear of the control overlays.');
    const pixel = (p: { x: number; y: number }) =>
      stage.evaluate(
        (c, p) =>
          Array.from(
            (c as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(
                Math.round((c as HTMLCanvasElement).width / 2 + (p.x - 250) * devicePixelRatio),
                Math.round((c as HTMLCanvasElement).height / 2 + (p.y - 150) * devicePixelRatio),
                1,
                1,
              ).data,
          ),
        p,
      );
    if (mode !== 'release') await expect.poll(() => pixel(paintPoint)).toEqual([255, 0, 0, 255]);
    if (mode === 'children')
      await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    const proposed = sampledSelectionRotationHandle(owner.pivot, view, expected);
    const orange = await stage.evaluate((el, p) => {
      const c = el as HTMLCanvasElement,
        r = c.getBoundingClientRect(),
        x = (p.x * c.width) / r.width,
        y = (p.y * c.height) / r.height,
        d = c.getContext('2d')!.getImageData(Math.floor(x - 3), Math.floor(y - 3), 7, 7).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] === 255 && d[i + 1] === 191 && d[i + 2] === 102 && d[i + 3] === 255) n++;
      return n;
    }, proposed.knob);
    expect(orange, 'proposed marker at the admitted numeric target').toBeGreaterThan(5);
    if (mode === 'second-pose') {
      await move(45);
      await page.evaluate(() => window.selectionRotationFrames.flush());
    }
    if (mode.startsWith('release-') && mode !== 'release-view') await hook(mode, true);
    if (mode === 'release-view')
      await stage.evaluate((el) => {
        const c = el as HTMLCanvasElement,
          release = c.releasePointerCapture.bind(c);
        c.releasePointerCapture = (id) => {
          release(id);
          c.style.width = '700px';
        };
      });
    await release(pointerAngle);
    await page.mouse.up();
    expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
    expect((await frameState(page)).pending).toBe(0);
    if (mode.startsWith('release-')) {
      if (mode !== 'release-view')
        expect(
          await page.evaluate(() => document.documentElement.dataset.selectionRotationHook),
        ).toBe('yes');
      if (mode === 'release-target') await expect(input).toHaveValue('111');
      if (mode === 'release-restored-target')
        expect(Number(await input.inputValue())).toBeCloseTo(90, 8);
      await expect(
        editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
      ).toHaveCount(0);
      if (mode === 'release-source')
        expect((await read()).layers.slice(0, 2)).toEqual(before.layers);
      else expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      return;
    }
    expect(Number(await input.inputValue())).toBeCloseTo(expected, 8);
    await expect(
      editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
    ).toBeVisible();
    expect(await read()).toEqual(before);
    const target = Number(await input.inputValue()),
      wanted = await browserRotationOracle(page, before, requests, target);
    await editor
      .getByRole('button', { name: 'Commit sampled selection rotation', exact: true })
      .click();
    await expect(region).toBeHidden();
    const result = await read();
    expect(comparable(result)).toEqual(comparable(wanted));
    expect(result.assets).toEqual(before.assets);
    expect(result.symbols).toEqual(before.symbols);
    await expect(
      page.getByText(owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0) + ' picked members', {
        exact: true,
      }),
    ).toBeVisible();
    for (const t of owner.tracks)
      expect(result.layers.find((l) => l.id === t.layerId)!.motionSpans![0].id).toBe(
        before.layers.find((l) => l.id === t.layerId)!.motionSpans![0].id,
      );
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
    expect(errors).toEqual([]);
    cap.dispose();
  });
