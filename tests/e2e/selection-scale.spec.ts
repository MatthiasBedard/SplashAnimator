import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
import { captureRememberedSelectionAuthoringFrame } from '../../packages/animation/src/selection-motion-owner';
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

function scaleFixture(mode: string) {
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
  if (mode === 'guard')
    for (const l of p.layers) {
      l.motionSpans![0].rotation!.axisGroupScale = false;
      l.motionSpans![0].rotation!.uniformGroupScale = true;
      refreshBasicMotionSpan(p, [l.id], 0, l.id === 'base' ? 8 : 10);
    }
  return p;
}
async function arm(page: Page, action: string, complete = false, publication = false) {
  await page.evaluate(
    ({ action, complete, publication }) => {
      const apply = () => {
        Object.assign(window, { scaleHook: true });
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
        else if (action === 'mode') check('Scale sampled selection', [false, true]);
        else if (action === 'children') check('Remember sampled stage children', [true, false]);
        else
          input(
            action === 'y' ? 'Sampled selection Y scale' : 'Sampled selection X scale',
            action === 'restored' ? ['170', '150'] : ['170'],
          );
      };
      if (complete) {
        const stringify = JSON.stringify;
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
                  ?.transform?.[0] === 1.5,
            )
          ) {
            const count = (reads.get(p) ?? 0) + 1;
            reads.set(p, count);
            if (publication && count < 3) return out;
            Object.assign(window, { scalePublicationReads: count });
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
  'uniform',
  'x-only',
  'y-only',
  'root-root',
  'group-group',
  'multi',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'common',
  'defaults',
  'asymmetric',
  'children',
  'nested-movie',
  'nested-loop',
  'direct',
  'separate',
  'retained',
  'active-translation',
  'active-rotation',
  'discard',
  'zero',
  'invalid',
  'overflow',
  'underflow',
  'double-negative',
  'group-context',
  'negative',
  'guard',
  'preview-target',
  'preview-source',
  'late-target',
  'late-y',
  'late-restored',
  'late-mode',
  'late-selection',
  'late-frame',
  'late-close',
  'late-source',
  'late-children',
  'candidate-target',
  'candidate-source',
  'publication-target',
  'publication-source',
  'publication-mode',
])
  test('main sampled selection numeric scale ' + mode, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1400 });
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      scaleFixture(mode),
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
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
      stage = page.getByLabel('Drawing stage');
    if (mode === 'children' || mode.startsWith('nested-')) {
      await region.getByLabel('Remember sampled stage children').check();
      await expect(region.getByLabel('Sampled stage artwork')).toBeEnabled();
    }
    await region.getByLabel('Select multiple sampled units').check();
    const editor = region.getByRole('group', { name: 'Sampled selection set' });
    const picks =
      mode === 'root-root'
        ? [
            ['base', 'r'],
            ['base', 'other'],
          ]
        : mode === 'group-group'
          ? [
              ['base', 'b'],
              ['base', 'd'],
            ]
          : mode === 'multi' || /^(late|candidate|publication)-/.test(mode)
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
    if (mode === 'separate') {
      await editor.getByLabel('Sampled selection X offset').fill('17');
      await editor.getByLabel('Sampled selection Y offset').fill('-9');
      await editor.getByLabel('Rotate sampled selection', { exact: true }).check();
      await editor.getByLabel('Sampled selection rotation degrees').fill('37');
      await editor
        .getByRole('button', { name: 'Preview sampled selection rotation', exact: true })
        .click();
    }
    if (mode === 'retained' || mode.startsWith('active-')) {
      await editor.getByLabel('Drag sampled selection offsets').check();
      await editor.getByLabel('Author sampled selection drag on release').check();
      if (mode !== 'active-translation') {
        await editor.getByLabel('Rotate sampled selection', { exact: true }).check();
        await editor.getByLabel('Drag sampled selection rotation', { exact: true }).check();
        await editor.getByLabel('Author sampled selection rotation on release').check();
      }
    }
    const scaling = editor.getByLabel('Scale sampled selection', { exact: true });
    if (mode.startsWith('active-')) {
      const original = captureRememberedSelectionAuthoringFrame(() => ({
          project: before,
          frame: 4,
          revision: 0,
        })),
        pivot = original.resolveRotation(
          picks.map(([layerId, shapeId]) => ({ layerId, shapeId })),
        ).pivot,
        b = (await stage.boundingBox())!,
        p = mode === 'active-rotation' ? { x: pivot.x, y: pivot.y - 32 } : { x: 70, y: 70 };
      await page.mouse.move(b.x + b.width / 2 + p.x - 250, b.y + b.height / 2 + p.y - 150);
      await page.mouse.down();
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);
      await scaling.evaluate((el) => {
        const input = el as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.up();
      expect(await read()).toEqual(before);
      original.dispose();
    } else await scaling.check();
    const x = editor.getByLabel('Sampled selection X scale'),
      y = editor.getByLabel('Sampled selection Y scale'),
      preview = editor.getByRole('button', {
        name: 'Preview sampled selection scale',
        exact: true,
      }),
      commit = editor.getByRole('button', { name: 'Commit sampled selection scale', exact: true });
    await expect(commit).toBeDisabled();
    const cap = captureRememberedSelectionAuthoringFrame(() => ({
        project: before,
        frame: 4,
        revision: 0,
      })),
      requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId })),
      owner = cap.resolveScale(requests),
      scene = cap.scene;
    await expect(editor.getByLabel('Sampled selection scale pivot')).toHaveText(
      `Original pivot · ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`,
    );
    if (mode === 'zero') {
      for (const values of [
        ['0', '100'],
        ['100', '0'],
        ['100', '100'],
      ]) {
        await x.fill(values[0]);
        await y.fill(values[1]);
        await expect(commit).toBeDisabled();
      }
      expect(await read()).toEqual(before);
      return;
    }
    const sx = mode === 'y-only' ? 1 : 1.5,
      sy = mode === 'x-only' ? 1 : mode === 'uniform' ? 1.5 : 0.75;
    await x.fill(
      mode === 'overflow'
        ? '1e308'
        : mode === 'underflow'
          ? '1e-300'
          : mode === 'negative' || mode === 'double-negative'
            ? '-150'
            : String(sx * 100),
    );
    await y.fill(mode === 'double-negative' ? '-75' : String(sy * 100));
    if (mode === 'invalid') {
      await x.fill('');
      await expect(commit).toBeDisabled();
      expect(await read()).toEqual(before);
      return;
    }
    if (mode === 'retained') {
      await expect(editor.getByLabel('Drag sampled selection offsets')).toBeDisabled();
      await expect(editor.getByLabel('Author sampled selection drag on release')).toBeChecked();
      await expect(editor.getByLabel('Author sampled selection drag on release')).toBeDisabled();
      const b = (await stage.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2 - 180, b.y + b.height / 2 - 80);
      await page.mouse.down();
      expect(await stage.evaluate((c) => (c as HTMLCanvasElement).hasPointerCapture(1))).toBe(
        false,
      );
      await page.mouse.move(b.x + b.width / 2 - 140, b.y + b.height / 2 - 30);
      await page.mouse.up();
      expect(await read()).toEqual(before);
    }
    const root = scene
        .find((t) => t.layerId === owner.tracks[0].layerId)!
        .key.shapes.find((s) => s.id === owner.tracks[0].shapeIds[0])!,
      source = worldPoint(root, { x: 14, y: 14 }),
      destination = {
        x: owner.pivot.x + sx * (source.x - owner.pivot.x),
        y: owner.pivot.y + sy * (source.y - owner.pivot.y),
      };
    const pixel = (p: { x: number; y: number }) =>
      stage.evaluate((el, p) => {
        const c = el as HTMLCanvasElement;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (p.x - 250) * devicePixelRatio),
              Math.round(c.height / 2 + (p.y - 150) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      }, p);
    if (mode === 'base' || mode === 'children')
      expect(await pixel(destination)).toEqual([255, 255, 255, 255]);
    if (mode.startsWith('preview-')) await arm(page, mode.slice(8));
    if (mode !== 'direct') {
      await preview.click();
      if (['overflow', 'underflow', 'negative', 'double-negative', 'guard'].includes(mode)) {
        await expect(editor.getByRole('alert')).toBeVisible();
        expect(await read()).toEqual(before);
        if (mode === 'guard') {
          await region.getByLabel('Select multiple sampled units').uncheck();
          await region
            .getByLabel('Sampled stage artwork')
            .selectOption(JSON.stringify(['base', 'r']));
          await region
            .getByRole('button', { name: 'Promote sampled stage pose', exact: true })
            .click();
          await expect(region).toBeHidden();
          expect((await read()).layers[0].motionSpans).toHaveLength(2);
          await stage.focus();
          await page.keyboard.press('Control+z');
          expect(await read()).toEqual(before);
        }
        return;
      }
      if (mode.startsWith('preview-')) {
        expect(
          await page.evaluate(() => (window as unknown as { scaleHook: boolean }).scaleHook),
        ).toBe(true);
        if (mode === 'preview-source')
          expect((await read()).layers.slice(0, 2)).toEqual(before.layers);
        else expect(await read()).toEqual(before);
        return;
      }
      await expect(
        editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
      ).toContainText(`Proposed selection scale · ${sx * 100}%, ${sy * 100}%`);
      expect(await read()).toEqual(before);
      await expect.poll(() => pixel(destination)).toEqual([255, 0, 0, 255]);
      if (mode === 'children')
        await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
      if (mode.startsWith('nested-')) {
        const child = scene[0].key.shapes.find((s) => s.id === 'a')!,
          point = worldPoint(child, { x: 4, y: 4 });
        await expect
          .poll(() =>
            pixel({
              x: owner.pivot.x + sx * (point.x - owner.pivot.x),
              y: owner.pivot.y + sy * (point.y - owner.pivot.y),
            }),
          )
          .toEqual([0, 0, 255, 255]);
      }
      if (mode === 'discard') {
        await stage.focus();
        await page.keyboard.press('Escape');
        await expect(
          editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
        ).toHaveCount(0);
        await expect(x).toHaveValue('150');
      }
    }
    if (mode === 'group-context') {
      await region.getByLabel('Select multiple sampled units').uncheck();
      await region.getByLabel('Select complete sampled stage groups').check();
      await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();
      await region.getByLabel('Select multiple sampled units').check();
      await expect(scaling).not.toBeChecked();
      for (const [layer, id] of picks) {
        await expect(editor.getByLabel('Sampled unit ' + layer + '/' + id)).not.toBeChecked();
        await editor.getByLabel('Sampled unit ' + layer + '/' + id).check();
      }
      await scaling.check();
      await expect(x).toHaveValue('100');
      await expect(y).toHaveValue('100');
      await expect(commit).toBeDisabled();
      await x.fill('150');
      await y.fill('75');
      expect(await read()).toEqual(before);
    }
    if (mode === 'separate' || mode === 'retained') {
      await scaling.uncheck();
      if (mode === 'separate') {
        await expect(editor.getByLabel('Sampled selection X offset')).toHaveValue('17');
        await expect(editor.getByLabel('Sampled selection Y offset')).toHaveValue('-9');
      }
      await editor.getByLabel('Rotate sampled selection', { exact: true }).check();
      if (mode === 'separate')
        await expect(editor.getByLabel('Sampled selection rotation degrees')).toHaveValue('37');
      else {
        await expect(
          editor.getByLabel('Author sampled selection rotation on release'),
        ).toBeChecked();
        await expect(
          editor.getByLabel('Drag sampled selection rotation', { exact: true }),
        ).not.toBeChecked();
      }
      await scaling.check();
      await expect(x).toHaveValue('150');
      await expect(
        editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
      ).toHaveCount(0);
    }
    if (/^(late|candidate|publication)-/.test(mode)) {
      const action = mode.slice(mode.indexOf('-') + 1);
      await arm(
        page,
        action,
        mode.startsWith('candidate-') || mode.startsWith('publication-'),
        mode.startsWith('publication-'),
      );
      await commit.click();
      expect(
        await page.evaluate(() => (window as unknown as { scaleHook: boolean }).scaleHook),
      ).toBe(true);
      if (mode.startsWith('publication-'))
        expect(
          await page.evaluate(
            () => (window as unknown as { scalePublicationReads: number }).scalePublicationReads,
          ),
        ).toBe(3);
      const after = await read();
      if (action === 'source') {
        expect(after.layers).toHaveLength(before.layers.length + 1);
        expect(after.layers.slice(0, 2)).toEqual(before.layers);
        if (await region.isVisible())
          await region
            .getByRole('button', { name: 'Return to authored stage', exact: true })
            .click();
        await stage.focus();
        await page.keyboard.press('Control+z');
        expect(await read()).toEqual(before);
      } else expect(after).toEqual(before);
      if (action === 'target') await expect(x).toHaveValue('170');
      if (action === 'y') await expect(y).toHaveValue('170');
      if (action === 'frame')
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
      if (action === 'close') await expect(region).toBeHidden();
      if (action === 'selection')
        await expect(editor.getByLabel('Sampled unit base/r')).not.toBeChecked();
      expect(errors).toEqual([]);
      if (action !== 'restored' && action !== 'mode') return;
      await expect(x).toHaveValue('150');
      await expect(scaling).toBeChecked();
      await expect(
        editor.getByRole('status', { name: 'Sampled selection preview', exact: true }),
      ).toHaveCount(0);
    }
    const expected = cap.prepareScale(requests, sx, sy);
    await commit.click();
    await expect(region).toBeHidden();
    const result = await read();
    expect(comparable(result)).toEqual(comparable(expected));
    expect(result.assets).toEqual(before.assets);
    expect(result.symbols).toEqual(before.symbols);
    const count = owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0);
    await expect(page.getByText(count + ' picked members', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Authored sampled selection scale')).toHaveText(
      `Scale · ${(sx * 100).toFixed(2)}%, ${(sy * 100).toFixed(2)}% · Pivot ${owner.pivot.x.toFixed(2)}, ${owner.pivot.y.toFixed(2)}`,
    );
    for (const t of owner.tracks) {
      const actual = result.layers.find((l) => l.id === t.layerId)!,
        old = before.layers.find((l) => l.id === t.layerId)!;
      expect(actual.keys.filter((k) => [0, t.end, 12].includes(k.frame))).toEqual(
        old.keys.filter((k) => [0, t.end, 12].includes(k.frame)),
      );
      expect(actual.motionSpans![0].id).toBe(old.motionSpans![0].id);
      expect(actual.motionSpans![1].id).not.toBe(old.motionSpans![0].id);
      for (const member of actual.keys
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
