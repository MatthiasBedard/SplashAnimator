import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
import { captureRememberedSelectionAuthoringFrame } from '../../packages/animation/src/selection-motion-owner';
import { sampledSelectionScaleBounds } from '../../apps/editor/src/sampled-scale-handles';
import { sampledSelectionSkewHandles } from '../../apps/editor/src/sampled-skew-handles';
import { rotationLocal } from '../../apps/editor/src/sampled-rotation-handle';
import { worldPoint, localPoint, objectBounds } from '../../packages/geometry/src';
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

function skewFixture(mode: string) {
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
function canvasFixture(mode: string) {
  const p = skewFixture(mode);
  if (mode === 'offview')
    for (const l of p.layers) {
      const end = l.id === 'base' ? 8 : 10;
      for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === end))
        for (const s of k.shapes) s.pivot = localPoint(s, { x: -500, y: -300 });
      l.motionSpans![0].options!.pivots = true;
      refreshBasicMotionSpan(p, [l.id], 0, end);
    }
  if (mode === 'edge-e')
    for (const l of p.layers) {
      for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === (l.id === 'base' ? 8 : 10)))
        for (const s of k.shapes) if (s.id === 'other') s.opacity = 0;
      refreshBasicMotionSpan(p, [l.id], 0, l.id === 'base' ? 8 : 10);
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
              x: 106,
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
type SkewReleaseFrames = {
  armed: boolean;
  pending: Map<number, FrameRequestCallback>;
  all: Map<number, FrameRequestCallback>;
  flush(): void;
  late(): void;
};
declare global {
  interface Window {
    selectionSkewReleaseFrames: SkewReleaseFrames;
  }
}
async function arm(page: Page, action: string, complete = false, publication = false) {
  await page.evaluate(
    ({ action, complete, publication }) => {
      const angle = (
        document.querySelector(
          'input[aria-label="Sampled selection skew degrees"]',
        ) as HTMLInputElement
      ).value;
      const apply = () => {
        Object.assign(window, { skewHook: true });
        const input = (label: string, values: string[]) => {
          const el = document.querySelector(
            'input[aria-label="' + label + '"]',
          ) as HTMLInputElement;
          for (const v of values) {
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        const check = (label: string, values: boolean[]) => {
          const el = document.querySelector(
            'input[aria-label="' + label + '"]',
          ) as HTMLInputElement;
          for (const checked of values) {
            el.checked = checked;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        if (action === 'source')
          (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
        else if (action === 'frame' || action === 'close')
          (
            Array.from(document.querySelectorAll('button')).find(
              (b) =>
                b.textContent === (action === 'frame' ? 'Next frame' : 'Return to authored stage'),
            ) as HTMLButtonElement
          ).click();
        else if (action === 'selection') check('Sampled unit base/r', [false]);
        else if (action === 'mode') check('Skew sampled selection', [false, true]);
        else if (action === 'policy') check('Drag sampled selection skew', [false, true]);
        else if (action === 'author')
          check('Author sampled selection skew on release', [false, true]);
        else if (action === 'escape')
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }),
          );
        else if (action === 'children') check('Remember sampled stage children', [true, false]);
        else if (action === 'axis' || action === 'axis-restored') {
          const e = document.querySelector(
            'select[aria-label="Sampled selection skew axis"]',
          ) as HTMLSelectElement;
          for (const value of action === 'axis-restored' ? ['y', 'x'] : ['y']) {
            e.value = value;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (action === 'view') {
          (
            document.querySelector('canvas[aria-label="Drawing stage"]') as HTMLCanvasElement
          ).style.width = '700px';
        } else
          input('Sampled selection skew degrees', action === 'restored' ? ['40', angle] : ['40']);
      };
      if (complete) {
        const stringify = JSON.stringify;
        const factor = Math.tan((Number(angle) * Math.PI) / 180);
        const reads = new WeakMap<object, number>();
        JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
          const out = stringify(value, replacer as never, space),
            p = value as Project;
          if (
            p?.layers?.length === 2 &&
            p.layers.every(
              (l) =>
                l.motionSpans?.length === 2 &&
                l.keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'b')
                  ?.transform?.[2] === factor,
            )
          ) {
            const count = (reads.get(p) ?? 0) + 1;
            reads.set(p, count);
            if (publication && count < 3) return out;
            const c = document.querySelector(
              'canvas[aria-label="Drawing stage"]',
            ) as HTMLCanvasElement;
            Object.assign(window, {
              skewPublicationReads: count,
              skewHookCapture: c.hasPointerCapture(Number(c.dataset.skewPointer)),
            });
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
    { action, complete, publication },
  );
}

for (const mode of [
  'base',
  'draft',
  'opted-out',
  'capture-author',
  'release-author',
  'publication-author',
  'publication-target',
  'publication-source',
  'retry-author',
  'edge-n',
  'edge-e',
  'edge-s',
  'edge-w',
  'shift',
  'css',
  'offset',
  'offview',
  'affine',
  'reflected',
  'compound',
  'curved',
  'aligned',
  'multi',
  'children',
  'retained',
  'guard',
  'zero',
  'return',
  'prior',
  'prior-view',
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
  'source',
  'target',
  'axis',
  'restored-target',
  'restored-axis',
  'restored-policy',
  'foreign',
  'proposed-pick',
  'opaque',
  'locked',
  'transparent',
  'hidden',
  'burst',
  'second',
  'coalesced',
  'release',
  'prepared-target',
  'prepared-source',
  'prepared-policy',
  'release-target',
  'release-axis',
  'release-policy',
  'release-source',
  'release-view',
  'release-escape',
  'release-close',
  'capture-target',
  'capture-policy',
  'capture-source',
  'capture-view',
])
  test('main sampled selection skew direct release ' + mode, async ({ page }) => {
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
      mode === 'multi' || /^(prepared|release|publication)-/.test(mode) || mode === 'retry-author'
        ? [
            ['base', 'r'],
            ['base', 'b'],
            ['extra', 'b'],
          ]
        : [
            ['base', 'r'],
            ['base', 'b'],
          ];
    for (const [l, id] of picks)
      await editor.getByLabel('Sampled unit ' + l + '/' + id, { exact: true }).check();
    if (mode === 'retained') {
      await editor.getByLabel('Drag sampled selection offsets').check();
      await editor.getByLabel('Author sampled selection drag on release').check();
      await editor.getByLabel('Rotate sampled selection', { exact: true }).check();
      await editor.getByLabel('Drag sampled selection rotation', { exact: true }).check();
      await editor.getByLabel('Author sampled selection rotation on release').check();
      await editor.getByLabel('Scale sampled selection', { exact: true }).check();
      await editor.getByLabel('Drag sampled selection scale', { exact: true }).check();
      await editor.getByLabel('Author sampled selection scale on release').check();
    }
    await editor.getByLabel('Skew sampled selection', { exact: true }).check();
    const axis = editor.getByLabel('Sampled selection skew axis'),
      angle = editor.getByLabel('Sampled selection skew degrees'),
      tool = editor.getByLabel('Drag sampled selection skew', { exact: true }),
      commit = editor.getByRole('button', { name: 'Commit sampled selection skew', exact: true });
    const author = editor.getByLabel('Author sampled selection skew on release', { exact: true });
    if (!['draft', 'retained'].includes(mode)) await author.check();
    if (mode === 'opted-out') await author.uncheck();
    const prior = mode === 'prior' || mode === 'prior-view';
    if (prior) {
      await axis.selectOption('y');
      await angle.fill('-17');
      await editor
        .getByRole('button', { name: 'Preview sampled selection skew', exact: true })
        .click();
    }
    const cap = captureRememberedSelectionAuthoringFrame(() => ({
        project: before,
        frame: 4,
        revision: 0,
      })),
      requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId })),
      owner = cap.resolveSkew(requests),
      scene = cap.scene;
    const members = owner.tracks.flatMap((t) =>
        scene
          .find((l) => l.layerId === t.layerId)!
          .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
      ),
      box = sampledSelectionScaleBounds(members);
    await tool.check();
    if (mode === 'css')
      await stage.evaluate((c) => {
        c.style.width = '700px';
        c.style.height = '360px';
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
    const id = mode.startsWith('edge-') ? 'skew-' + mode.slice(5) : 'skew-s';
    let handle = sampledSelectionSkewHandles(box, owner.pivot, view).handles.find(
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
    expect(marker, 'original private diamond').toBeGreaterThan(8);
    await page.evaluate(() => {
      const request = requestAnimationFrame.bind(window),
        cancel = cancelAnimationFrame.bind(window);
      let next = 1200000000;
      const g: SkewReleaseFrames = {
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
      window.selectionSkewReleaseFrames = g;
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
          (c as HTMLElement).dataset.skewPointer = String(e.pointerId);
          (c as HTMLElement).dataset.skewDown = JSON.stringify({ x: e.clientX, y: e.clientY });
        },
        true,
      ),
    );
    let offset = { x: 0, y: 0 };
    const start = async () => {
      await settle();
      view = await measure();
      handle = sampledSelectionSkewHandles(box, owner.pivot, view).handles.find(
        (h) => h.id === id,
      )!;
      await page.mouse.move(
        view.left + handle.point.x + (mode === 'offset' ? 3 : 0),
        view.top + handle.point.y + (mode === 'offset' ? -2 : 0),
      );
      await page.mouse.down();
      const actual = await stage.evaluate(
          (c) => JSON.parse((c as HTMLElement).dataset.skewDown!) as { x: number; y: number },
        ),
        p = rotationLocal({ x: actual.x - view.left, y: actual.y - view.top }, view);
      offset = { x: p.x - handle.anchor.x, y: p.y - handle.anchor.y };
    };
    const screen = (degrees: number) => {
      const k = Math.tan((degrees * Math.PI) / 180),
        x =
          handle.anchor.x +
          (handle.axis === 'x' ? k * (handle.anchor.y - owner.pivot.y) : 0) +
          offset.x,
        y =
          handle.anchor.y +
          (handle.axis === 'y' ? k * (handle.anchor.x - owner.pivot.x) : 0) +
          offset.y;
      return {
        x: view.left + ((x + view.origin.x) * view.cssWidth) / view.width,
        y: view.top + ((y + view.origin.y) * view.cssHeight) / view.height,
      };
    };
    const send = async (
      type: string,
      degrees: number,
      fields: { pointerId?: number; shiftKey?: boolean; coalesced?: boolean } = {},
    ) => {
      const at = screen(degrees);
      await stage.evaluate(
        (c, { type, at, fields }) => {
          const g = window.selectionSkewReleaseFrames,
            id = Number((c as HTMLElement).dataset.skewPointer),
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
    const release = async (degrees: number, shiftKey = false) => {
      await send('pointermove', degrees, { shiftKey });
      const exact = {
        axis: (await axis.inputValue()) as 'x' | 'y',
        degrees: Number(await angle.inputValue()),
      };
      await send('pointerup', degrees, { shiftKey });
      return exact;
    };
    const captured = () =>
        stage.evaluate((c) =>
          (c as HTMLCanvasElement).hasPointerCapture(
            Number((c as HTMLElement).dataset.skewPointer),
          ),
        ),
      pending = () => page.evaluate(() => window.selectionSkewReleaseFrames.pending.size);
    const sourceRejected = async () => {
      const after = await read();
      expect(after.layers).toHaveLength(before.layers.length + 1);
      expect(after.layers.slice(0, before.layers.length)).toEqual(before.layers);
      if (await region.isVisible())
        await region.getByRole('button', { name: 'Return to authored stage', exact: true }).click();
      await stage.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
    };
    if (mode === 'proposed-pick') {
      await angle.fill('55');
      await settle();
      view = await measure();
      const proposed = sampledSelectionSkewHandles(box, owner.pivot, view, 'x', 55).handles.find(
        (h) => h.id === id,
      )!;
      await page.mouse.move(view.left + proposed.point.x, view.top + proposed.point.y);
      await page.mouse.down();
      expect(await captured()).toBe(false);
      await page.mouse.up();
      await expect(angle).toHaveValue('55');
      expect(await read()).toEqual(before);
    }
    if (mode.startsWith('capture-')) await arm(page, mode.slice(8));
    await start();
    if (mode === 'opaque' || mode === 'locked') {
      expect(await captured()).toBe(false);
      await page.mouse.up();
      expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    if (mode.startsWith('capture-')) {
      expect(await page.evaluate(() => (window as unknown as { skewHook: boolean }).skewHook)).toBe(
        true,
      );
      expect(await captured()).toBe(false);
      await page.mouse.up();
      if (mode === 'capture-source') {
        await sourceRejected();
        cap.dispose();
        return;
      }
      if (mode === 'capture-target') await expect(angle).toHaveValue('40');
      expect(await read()).toEqual(before);
      await start();
      expect(await captured()).toBe(true);
    } else expect(await captured()).toBe(true);
    await expect(axis).toHaveValue(handle.axis);
    await expect(angle).toHaveValue('0');
    if (mode === 'foreign') {
      await send('pointermove', 25, { pointerId: 99 });
      await send('pointerup', 25, { pointerId: 99 });
      expect(await captured()).toBe(true);
      await expect(angle).toHaveValue('0');
      expect(await pending()).toBe(0);
    }
    if (mode === 'zero') {
      await send('pointerup', 0);
      await page.mouse.up();
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      expect(await read()).toEqual(before);
      cap.dispose();
      return;
    }
    await send('pointermove', 15);
    await send('pointermove', mode === 'shift' ? 23 : 35, {
      shiftKey: mode === 'shift',
      coalesced: mode === 'coalesced',
    });
    expect(await pending()).toBe(1);
    if (mode === 'burst') for (let i = 0; i < 20; i++) await send('pointermove', 20 + i * 0.5);
    expect(await pending()).toBe(1);
    const fields = async () => ({
      axis: (await axis.inputValue()) as 'x' | 'y',
      degrees: Number(await angle.inputValue()),
    });
    const moved = await fields(),
      sheared = (p: { x: number; y: number }) => {
        const k = Math.tan((moved.degrees * Math.PI) / 180);
        return {
          x: p.x + (moved.axis === 'x' ? k * (p.y - owner.pivot.y) : 0),
          y: p.y + (moved.axis === 'y' ? k * (p.x - owner.pivot.x) : 0),
        };
      };
    // Fixed-CSS-size markers cover a larger document area under nonuniform
    // presentation. Keep the destination away from the original west diamond
    // and outline antialias fringe, with a three-unit inset into the new paint.
    const probe =
      mode === 'css' || mode === 'capture-view'
        ? { x: 15, y: 7 }
        : mode === 'base' || mode === 'children'
          ? { x: 3, y: 2 }
          : { x: 2, y: mode === 'shift' || mode === 'burst' ? 2 : 4 };
    const destination = sheared(worldPoint(members[0], probe));
    const pixel = (p: { x: number; y: number }) =>
      stage.evaluate((el, p) => {
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
    if (mode === 'base' || mode === 'children')
      expect(await pixel(destination)).toEqual([255, 255, 255, 255]);
    if (mode.startsWith('prepared-')) await arm(page, mode.slice(9), true);
    if (mode !== 'release') await page.evaluate(() => window.selectionSkewReleaseFrames.flush());
    if (mode === 'guard') {
      await expect(editor.getByRole('alert')).toBeVisible();
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      await page.mouse.up();
      expect(await read()).toEqual(before);
      await region.getByLabel('Select multiple sampled units').uncheck();
      await region.getByLabel('Sampled stage artwork').selectOption(JSON.stringify(['base', 'r']));
      await region.getByRole('button', { name: 'Promote sampled stage pose', exact: true }).click();
      await stage.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    if (mode.startsWith('prepared-')) {
      expect(await page.evaluate(() => (window as unknown as { skewHook: boolean }).skewHook)).toBe(
        true,
      );
      expect(
        await page.evaluate(
          () => (window as unknown as { skewHookCapture: boolean }).skewHookCapture,
        ),
      ).toBe(true);
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      await page.mouse.up();
      if (mode === 'prepared-source') await sourceRejected();
      else {
        if (mode === 'prepared-target') await expect(angle).toHaveValue('40');
        expect(await read()).toEqual(before);
      }
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    if (mode !== 'release') {
      await expect.poll(() => pixel(destination)).toEqual([255, 0, 0, 255]);
      if (mode === 'children')
        await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
      const proposed = sampledSelectionSkewHandles(
        box,
        owner.pivot,
        view,
        moved.axis,
        moved.degrees,
      ).handles.find((h) => h.id === id)!;
      const orange = await stage.evaluate((el, p) => {
        const c = el as HTMLCanvasElement,
          r = c.getBoundingClientRect(),
          d = c
            .getContext('2d')!
            .getImageData(
              Math.round(((p.x - 3) * c.width) / r.width),
              Math.round(((p.y - 3) * c.height) / r.height),
              Math.ceil((6 * c.width) / r.width) + 1,
              Math.ceil((6 * c.height) / r.height) + 1,
            ).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] > 230 && d[i + 1] > 130 && d[i + 1] < 220 && d[i + 2] < 140) n++;
        return n;
      }, proposed.point);
      expect(orange, 'prepared original-owned proposal marker').toBeGreaterThan(0);
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
      'source',
      'target',
      'axis',
      'restored-target',
      'restored-axis',
      'restored-policy',
    ];
    if (cancellations.includes(mode)) {
      if (
        [
          'source',
          'target',
          'axis',
          'restored-target',
          'restored-axis',
          'restored-policy',
        ].includes(mode)
      ) {
        await send('pointermove', 37);
        await arm(
          page,
          mode === 'restored-target'
            ? 'restored'
            : mode === 'restored-axis'
              ? 'axis-restored'
              : mode === 'restored-policy'
                ? 'policy'
                : mode,
        );
        await page.evaluate(() => window.selectionSkewReleaseFrames.flush());
        expect(
          await page.evaluate(() => (window as unknown as { skewHook: boolean }).skewHook),
        ).toBe(true);
      } else if (mode === 'escape' || mode === 'prior') await page.keyboard.press('Escape');
      else if (mode === 'pointercancel') await send('pointercancel', 35);
      else if (mode === 'lostcapture')
        await stage.evaluate((c) =>
          (c as HTMLCanvasElement).releasePointerCapture(
            Number((c as HTMLElement).dataset.skewPointer),
          ),
        );
      else if (mode === 'blur') await stage.evaluate((c) => (c as HTMLCanvasElement).blur());
      else if (mode === 'resize' || mode === 'scroll')
        await page.evaluate((kind) => window.dispatchEvent(new Event(kind)), mode);
      else if (mode === 'view' || mode === 'prior-view')
        await stage.evaluate((c) => {
          c.style.width = '700px';
        });
      else if (mode === 'frame')
        await page
          .getByRole('button', { name: 'Next frame', exact: true })
          .evaluate((e) => (e as HTMLButtonElement).click());
      else if (mode === 'close')
        await region
          .getByRole('button', { name: 'Return to authored stage', exact: true })
          .evaluate((e) => (e as HTMLButtonElement).click());
      else if (mode === 'mode')
        await editor.getByLabel('Skew sampled selection', { exact: true }).evaluate((el) => {
          for (const checked of [false, true]) {
            (el as HTMLInputElement).checked = checked;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      else await send('pointerup', 0);
      await page.mouse.up();
      await page.evaluate(() => window.selectionSkewReleaseFrames.late());
      expect(await captured()).toBe(false);
      expect(await pending()).toBe(0);
      if (mode === 'source') {
        await sourceRejected();
        cap.dispose();
        return;
      }
      expect(await read()).toEqual(before);
      if (mode === 'target') await expect(angle).toHaveValue('40');
      if (mode === 'axis') await expect(axis).toHaveValue('y');
      if (prior) {
        await expect(axis).toHaveValue('y');
        await expect(angle).toHaveValue('-17');
        await expect(
          editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
        ).toContainText('Proposed selection skew');
      }
      if (mode === 'frame')
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
      if (mode === 'close') await expect(region).toBeHidden();
      if (mode === 'mode') await expect(tool).not.toBeChecked();
      expect(errors).toEqual([]);
      cap.dispose();
      return;
    }
    if (mode === 'second') {
      await send('pointermove', 20);
      await page.evaluate(() => window.selectionSkewReleaseFrames.flush());
    }
    if (mode === 'retry-author') await arm(page, 'author', true);
    if (mode.startsWith('publication-')) await arm(page, mode.slice(12), true, true);
    if (mode.startsWith('release-')) await arm(page, mode.slice(8), true);
    let actual = await release(
      mode === 'shift' ? 23 : mode === 'second' ? 20 : mode === 'burst' ? 29.5 : 35,
      mode === 'shift',
    );
    await page.mouse.up();
    expect(await captured()).toBe(false);
    expect(await pending()).toBe(0);
    if (mode.startsWith('release-') || mode.startsWith('publication-') || mode === 'retry-author') {
      if (mode.startsWith('publication-'))
        expect(
          await page.evaluate(
            () => (window as unknown as { skewPublicationReads: number }).skewPublicationReads,
          ),
        ).toBeGreaterThanOrEqual(3);
      expect(await page.evaluate(() => (window as unknown as { skewHook: boolean }).skewHook)).toBe(
        true,
      );
      expect(
        await page.evaluate(
          () => (window as unknown as { skewHookCapture: boolean }).skewHookCapture,
        ),
      ).toBe(false);
      if (mode === 'release-source' || mode === 'publication-source') {
        await sourceRejected();
        cap.dispose();
        return;
      }
      expect(await read()).toEqual(before);
      if (mode === 'release-target' || mode === 'publication-target')
        await expect(angle).toHaveValue('40');
      if (mode === 'release-axis') await expect(axis).toHaveValue('y');
      if (!['release-policy', 'release-author', 'retry-author'].includes(mode)) {
        expect(errors).toEqual([]);
        cap.dispose();
        return;
      }
      if (mode === 'retry-author') {
        await author.uncheck();
        await start();
        await release(25);
        await page.mouse.up();
        expect(await read()).toEqual(before);
        await expect(
          editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
        ).toBeVisible();
        await author.check();
      }
      await start();
      expect(await captured()).toBe(true);
      actual = await release(25);
      await page.mouse.up();
    }
    expect(actual.axis).toBe(handle.axis);
    const expected = cap.prepareSkew(requests, actual.axis, actual.degrees);
    if (['draft', 'opted-out', 'retained'].includes(mode)) {
      expect(await read()).toEqual(before);
      await expect(
        editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
      ).toBeVisible();
      await commit.click();
    }
    await expect(region).toBeHidden();
    const result = await read();
    expect(comparable(result)).toEqual(comparable(expected));
    expect(result.assets).toEqual(before.assets);
    expect(result.symbols).toEqual(before.symbols);
    const count = owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0);
    await expect(page.getByText(count + ' picked members', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Authored sampled selection skew')).toHaveText(
      `Skew · ${actual.axis.toUpperCase()} · ${actual.degrees}° · Pivot ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`,
    );
    for (const t of owner.tracks) {
      const a = result.layers.find((l) => l.id === t.layerId)!,
        b = before.layers.find((l) => l.id === t.layerId)!;
      expect(a.keys.filter((k) => [0, t.end, 12].includes(k.frame))).toEqual(
        b.keys.filter((k) => [0, t.end, 12].includes(k.frame)),
      );
      expect(a.motionSpans![0].id).toBe(b.motionSpans![0].id);
      for (const member of a.keys
        .find((k) => k.frame === 4)!
        .shapes.filter((s) => t.shapeIds.includes(s.id))) {
        const b = objectBounds(member),
          cyan = await stage.evaluate((el, b) => {
            const c = el as HTMLCanvasElement,
              d = devicePixelRatio,
              x = Math.max(0, Math.floor(c.width / 2 + (b.left - 254) * d)),
              y = Math.max(0, Math.floor(c.height / 2 + (b.top - 154) * d)),
              w = Math.min(c.width - x, Math.ceil((b.right - b.left + 8) * d)),
              h = Math.min(c.height - y, Math.ceil((b.bottom - b.top + 8) * d)),
              pixels = c.getContext('2d')!.getImageData(x, y, w, h).data;
            let n = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (
                pixels[i] < 120 &&
                pixels[i + 1] > 100 &&
                pixels[i + 2] > 100 &&
                pixels[i + 3] === 255
              )
                n++;
            return n;
          }, b);
        expect(cyan, t.layerId + '/' + member.id + ' selection pixels').toBeGreaterThan(2);
      }
    }
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
    expect(errors).toEqual([]);
    cap.dispose();
  });
