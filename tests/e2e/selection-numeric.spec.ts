import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';
import { captureRememberedSelectionAuthoringFrame } from '../../packages/animation/src/selection-motion-owner';
import { worldPoint, objectBounds } from '../../packages/geometry/src';

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
    p.symbols = [{ id: 'child', name: 'Child', width: 8, height: 8, shapes: [{ ...ink('kid', 0), x: 0, y: 0, width: 8, height: 8, fill: '#0000ff' }] }];
    shapes[2] = { ...shapes[2], kind: 'symbol', symbolId: 'child', width: 8, height: 8, symbolPlayback: { mode: mode.slice(7) as 'loop' | 'once' | 'single' | 'movie', firstFrame: 0 } };
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
async function arm(page: Page, action: string, complete = false) {
  await page.evaluate(
    ({ action, complete }) => {
      const apply = () => {
        Object.assign(window, { selectionHook: true });
        const event = (label: string, values: string[]) => {
          const el = document.querySelector(
            'input[aria-label="' + label + '"]',
          ) as HTMLInputElement;
          for (const value of values) {
            el.value = value;
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
        else if (action === 'mode') check('Select multiple sampled units', [false, true]);
        else if (action === 'children') check('Remember sampled stage children', [true, false]);
        else event('Sampled selection X offset', action === 'restored' ? ['111', '50'] : ['111']);
      };
      if (complete) {
        const stringify = JSON.stringify;
        JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
          const result = stringify(value, replacer as never, space),
            p = value as Project;
          if (
            p?.layers?.[0].motionSpans?.length === 2 &&
            p.layers[0].keys.find((k) => k.frame === 4)?.shapes.find((s) => s.id === 'r')?.x === 110
          ) {
            JSON.stringify = stringify;
            apply();
          }
          return result;
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
    { action, complete },
  );
}

for (const mode of [
  'base',
  'default-track',
  'direct',
  'root-root',
  'group-group',
  'multi',
  'cross-roots',
  'cross-groups',
  'offview',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'fresh',
  'children',
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
  'retained',
  'retained-group',
  'separate',
  'discard',
  'invalid',
  'zero',
  'overflow',
  'absorbed',
  'guard',
  'preview-target',
  'preview-source',
  'late-target',
  'late-restored',
  'late-selection',
  'late-mode',
  'late-children',
  'late-frame',
  'late-close',
  'late-source',
  'candidate-target',
  'candidate-source',
  'candidate-mode',
  'candidate-restored',
  'candidate-selection',
])
  test('main sampled selection numeric authoring ' + mode, async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 1400 });
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
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
    if (mode === 'retained-group') {
      await region.getByLabel('Select complete sampled stage groups').check();
      await region.getByLabel('Sampled stage artwork').selectOption(JSON.stringify(['base', 'b']));
      await region.getByLabel('Drag sampled group offsets').check();
      await region.getByLabel('Author sampled group on drag release').check();
    }
    if (mode === 'retained' || mode === 'separate') {
      await region.getByLabel('Sampled stage artwork').selectOption(JSON.stringify(['base', 'r']));
      if (mode === 'retained')
        await region.getByLabel('Author sampled pose by dragging', { exact: true }).check();
      else {
        await region.getByLabel('Sampled stage X offset', { exact: true }).fill('7');
        await region.getByLabel('Sampled stage Y offset', { exact: true }).fill('9');
        await region
          .getByRole('button', { name: 'Preview sampled stage move', exact: true })
          .click();
      }
    }
    const enabled = region.getByLabel('Select multiple sampled units');
    await enabled.check();
    const editor = region.getByRole('group', { name: 'Sampled selection set' });
    let picks =
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
          : mode === 'multi'
            ? [
                ['base', 'r'],
                ['base', 'd'],
                ['extra', 'b'],
              ]
            : [
                ['base', 'r'],
                ['base', 'b'],
              ];
    if (mode === 'cross-roots') picks = [['base', 'r'], ['extra', 'r']];
    if (mode === 'cross-groups') picks = [['base', 'b'], ['extra', 'b']];
    for (const [layer, id] of picks)
      await editor.getByLabel('Sampled unit ' + layer + '/' + id, { exact: true }).check();
    const x = editor.getByLabel('Sampled selection X offset'),
      y = editor.getByLabel('Sampled selection Y offset');
    const commit = editor.getByRole('button', {
        name: 'Commit sampled selection translation',
        exact: true,
      }),
      preview = editor.getByRole('button', {
        name: 'Preview sampled selection translation',
        exact: true,
      });
    await expect(commit).toBeDisabled();
    if (mode === 'zero') {
      expect(await read()).toEqual(before);
      expect(errors).toEqual([]);
      return;
    }
    const delta = mode === 'offview' ? { x: -5000, y: -6000 } : mode === 'absorbed' ? { x: Number.MIN_VALUE, y: 0 } : { x: 50, y: 30 };
    await x.fill(String(delta.x));
    await y.fill(String(delta.y));
    if (mode === 'invalid') {
      await x.fill('');
      await expect(commit).toBeDisabled();
      expect(await read()).toEqual(before);
      return;
    }
    if (mode === 'retained' || mode === 'retained-group') {
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
    if (mode === 'separate') {
      await enabled.uncheck();
      await expect(region.getByLabel('Sampled stage X offset', { exact: true })).toHaveValue('7');
      await expect(region.getByLabel('Sampled stage Y offset', { exact: true })).toHaveValue('9');
      await expect(region.getByRole('status')).toContainText('Proposed move');
      await enabled.check();
      for (const [layer, id] of picks)
        await editor.getByLabel('Sampled unit ' + layer + '/' + id, { exact: true }).check();
      await x.fill('50');
      await y.fill('30');
    }
    if (mode === 'overflow') await x.fill('1e308');
    const cap = captureRememberedSelectionAuthoringFrame(() => ({
      project: before,
      frame: 4,
      revision: 0,
    }));
    let requests = picks.map(([layerId, shapeId]) => ({ layerId, shapeId }));
    let owner = cap.resolveSelection(requests);
    const originalPose = cap.scene;
    const probe = worldPoint(
      originalPose
        .find((t) => t.layerId === owner.tracks[0].layerId)!
        .key.shapes.find((s) => s.id === owner.tracks[0].shapeIds[0])!,
      { x: 14, y: 14 },
    );
    const pixel = (point: { x: number; y: number }) =>
      stage.evaluate((el, point) => {
        const c = el as HTMLCanvasElement;
        return [
          ...c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (point.x - 250) * devicePixelRatio),
              Math.round(c.height / 2 + (point.y - 150) * devicePixelRatio),
              1,
              1,
            ).data,
        ];
      }, point);
    const destination = { x: probe.x + 50, y: probe.y + 30 };
    if (mode !== 'offview') expect(await pixel(destination)).toEqual([255, 255, 255, 255]);
    if (mode.startsWith('preview-')) await arm(page, mode.slice(8));
    if (mode !== 'direct') {
      await preview.click();
      if (mode === 'overflow' || mode === 'guard' || mode === 'absorbed') {
        await expect(editor.getByRole('alert')).toBeVisible();
        await expect(editor.getByRole('status', { name: 'Sampled selection preview', exact: true })).toHaveCount(0);
        expect(await read()).toEqual(before);
        if (mode === 'guard') {
          await enabled.uncheck();
          await region.getByLabel('Sampled stage artwork').selectOption(JSON.stringify(['base', 'r']));
          await region.getByRole('button', { name: 'Promote sampled stage pose', exact: true }).click();
          await expect(region).toBeHidden(); expect((await read()).layers[0].motionSpans).toHaveLength(2);
          await stage.focus(); await page.keyboard.press('Control+z'); expect(await read()).toEqual(before);
        }
        cap.dispose();
        return;
      }
      if (mode.startsWith('preview-')) {
        expect(
          await page.evaluate(
            () => (window as unknown as { selectionHook: boolean }).selectionHook,
          ),
        ).toBe(true);
        if (mode === 'preview-source') {
          const after = await read(); expect(after.layers).toHaveLength(before.layers.length + 1);
          expect(after.layers.slice(0, 2)).toEqual(before.layers);
        }
        else expect(await read()).toEqual(before);
        cap.dispose();
        return;
      }
      await expect(editor.getByRole('status', { name: 'Sampled selection preview', exact: true })).toContainText('Proposed selection translation');
      expect(await read()).toEqual(before);
      if (mode !== 'offview') await expect.poll(() => pixel(destination)).toEqual([255, 0, 0, 255]);
      if (mode === 'children')
        await expect.poll(() => pixel({ x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
      if (mode.startsWith('nested-')) {
        const child = originalPose[0].key.shapes.find(s => s.id === 'a')!;
        await expect.poll(() => pixel({ x: child.x + 54, y: child.y + 34 })).toEqual([0, 0, 255, 255]);
      }
      if (mode === 'discard') {
        await stage.focus();
        await page.keyboard.press('Escape');
        await expect(editor.getByRole('status', { name: 'Sampled selection preview', exact: true })).toHaveCount(0);
        await expect(x).toHaveValue('50');
        await expect.poll(() => pixel(destination)).toEqual([255, 255, 255, 255]);
      }
    }
    if (mode.startsWith('late-') || mode.startsWith('candidate-')) {
      const action = mode.slice(mode.indexOf('-') + 1);
      await arm(page, action, mode.startsWith('candidate-'));
      await commit.click();
      expect(
        await page.evaluate(() => (window as unknown as { selectionHook: boolean }).selectionHook),
      ).toBe(true);
      const after = await read();
      if (action === 'source') {
        expect(after.layers).toHaveLength(before.layers.length + 1);
        expect(after.layers.slice(0, 2)).toEqual(before.layers);
      } else expect(after).toEqual(before);
      if (action === 'target') await expect(x).toHaveValue('111');
      if (action === 'frame')
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
      if (action === 'close') await expect(region).toBeHidden();
      expect(errors).toEqual([]);
      if (action === 'mode' || action === 'children') {
        await expect(editor.getByLabel('Sampled unit base/r', { exact: true })).not.toBeChecked();
        for (const [layer, id] of picks) await editor.getByLabel('Sampled unit ' + layer + '/' + id, { exact: true }).check();
        await x.fill('50'); await y.fill('30');
      } else if (action === 'selection') {
        requests = requests.filter(r => !(r.layerId === 'base' && r.shapeId === 'r')); owner = cap.resolveSelection(requests);
      } else if (action !== 'restored') {
        cap.dispose();
        return;
      }
      await expect(x).toHaveValue('50');
      await expect(editor.getByRole('status', { name: 'Sampled selection preview', exact: true })).toHaveCount(0);
    }
    const wanted = cap.prepareTranslation(requests, delta);
    cap.dispose();
    await commit.click();
    await expect(region).toBeHidden();
    const result = await read();
    expect(comparable(result)).toEqual(comparable(wanted));
    expect(result.symbols).toEqual(before.symbols);
    expect(result.assets).toEqual(before.assets);
    const count = owner.tracks.reduce((n, t) => n + t.shapeIds.length, 0);
    await expect(page.getByText(count + ' picked members', { exact: true })).toBeVisible();
    for (const original of before.layers.filter(l => !owner.tracks.some(t => t.layerId === l.id)))
      expect(result.layers.find(l => l.id === original.id)).toEqual(original);
    for (const track of owner.tracks) {
      const actual = result.layers.find((l) => l.id === track.layerId)!,
        original = before.layers.find((l) => l.id === track.layerId)!;
      expect(actual.keys.filter((k) => [0, track.end, 12].includes(k.frame))).toEqual(
        original.keys.filter((k) => [0, track.end, 12].includes(k.frame)),
      );
      expect(actual.motionSpans!.map((s) => [s.options, s.rotation])).toEqual(
        [original.motionSpans![0], original.motionSpans![0]].map((s) => [s.options, s.rotation]),
      );
      if (mode !== 'offview') for (const member of actual.keys.find(k => k.frame === 4)!.shapes.filter(s => track.shapeIds.includes(s.id))) {
        const bounds = objectBounds(member);
        const cyan = await stage.evaluate((el, b) => {
          const c = el as HTMLCanvasElement, dpr = devicePixelRatio;
          const x = Math.max(0, Math.floor(c.width / 2 + (b.left - 254) * dpr)), y = Math.max(0, Math.floor(c.height / 2 + (b.top - 154) * dpr));
          const w = Math.min(c.width - x, Math.ceil((b.right - b.left + 8) * dpr)), h = Math.min(c.height - y, Math.ceil((b.bottom - b.top + 8) * dpr));
          const pixels = c.getContext('2d')!.getImageData(x, y, w, h).data; let n = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 120 && pixels[i + 1] > 100 && pixels[i + 2] > 100 && pixels[i + 3] === 255) n++;
          return n;
        }, bounds);
        expect(cyan, track.layerId + '/' + member.id + ' retains authored selection pixels').toBeGreaterThan(2);
      }
    }
    await stage.focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
    expect(errors).toEqual([]);
  });
