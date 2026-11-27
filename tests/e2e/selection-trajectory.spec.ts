import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
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

const numbers = {
  base: { startX: 26, startY: 60, endX: -18, endY: 40 },
  extra: { startX: 15, startY: -40, endX: -10, endY: -25 },
};
const requests = (tracks: string[]) =>
  tracks.flatMap((layerId) => ['r', 'b', 'other', 'd'].map((shapeId) => ({ layerId, shapeId })));
async function oracle(
  page: Page,
  project: Project,
  tracks: string[],
  values: Record<string, typeof numbers.base> = numbers,
) {
  const { buildSync } = createRequire(import.meta.resolve('vite'))('esbuild') as {
    buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
  };
  const script = buildSync({
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    tsconfig: 'tsconfig.json',
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `import {captureRememberedSelectionAuthoringFrame} from './packages/animation/src/selection-motion-owner';globalThis.__trajectoryOracle=(project,requests,controls)=>{const cap=captureRememberedSelectionAuthoringFrame(()=>({project,frame:4,revision:0}));try{const owner=cap.resolveSelection(requests);return cap.prepareTrajectories(requests,controls.map(value=>({layerId:value.layerId,shapeId:'r',path:{...(project.layers.find(layer=>layer.id===value.layerId).motionSpans.find(span=>span.id===owner.tracks.find(track=>track.layerId===value.layerId).spanId).path??{}),...value.path}})));}finally{cap.dispose();}};`,
    },
  }).outputFiles[0].text;
  await page.addScriptTag({ content: script });
  return page.evaluate(
    ({ project, selection, controls }) =>
      (
        window as unknown as {
          __trajectoryOracle(
            p: Project,
            r: { layerId: string; shapeId: string }[],
            c: { layerId: string; path: typeof numbers.base }[],
          ): Project;
        }
      ).__trajectoryOracle(project, selection, controls),
    {
      project,
      selection: requests(tracks),
      controls: tracks.map((layerId) => ({
        layerId,
        path: values[layerId],
      })),
    },
  );
}
async function setup(page: Page, mode: string, tracks = ['base']) {
  await page.setViewportSize({ width: 1800, height: 1500 });
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('trajectory-seeded')) {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      sessionStorage.setItem('trajectory-seeded', '1');
    }
  }, fixture(mode));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
  const region = page.getByRole('region', { name: 'Sampled motion stage' });
  if (mode === 'children' || mode.startsWith('nested-')) {
    await region.getByLabel('Remember sampled stage children').check();
    await expect(region.getByLabel('Sampled stage artwork')).toBeEnabled();
  }
  if (mode === 'group-context')
    await region.getByLabel('Select complete sampled stage groups').check();
  await region.getByLabel('Select multiple sampled units').check();
  const editor = region.getByRole('group', { name: 'Sampled selection set', exact: true });
  for (const request of requests(tracks))
    await editor
      .getByLabel('Sampled unit ' + request.layerId + '/' + request.shapeId, { exact: true })
      .check();
  return { read, before, region, editor, errors, stage: page.getByLabel('Drawing stage') };
}
async function fill(page: Page, tracks: string[]) {
  for (const layerId of tracks)
    for (const field of ['startX', 'startY', 'endX', 'endY'] as const) {
      const label = field.replace('X', ' X').replace('Y', ' Y');
      await page
        .getByLabel('Selection trajectory ' + layerId + ' ' + label, { exact: true })
        .fill(String(numbers[layerId as keyof typeof numbers][field]));
    }
}
async function pixel(page: Page, p: { x: number; y: number }) {
  return page.getByLabel('Drawing stage').evaluate((el, p) => {
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
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
  'saved-flags',
  'group-context',
])
  test('main complete-track numeric trajectories ' + mode, async ({ page }) => {
    const tracks = mode === 'multi' ? ['base', 'extra'] : ['base'],
      f = await setup(page, mode, tracks),
      expected = await oracle(page, f.before, tracks);
    await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
    await expect(page.getByLabel('Trajectory selection readout')).toHaveText(
      `${tracks.length * 4} units · ${tracks.length} tracks · ${tracks.length * 6} artwork members`,
    );
    const commit = page.getByRole('button', { name: 'Commit selection trajectories', exact: true });
    await expect(commit).toBeDisabled();
    await fill(page, tracks);
    await expect(commit).toBeEnabled();
    const actual = expected.layers[0].keys.find((key) => key.frame === 4)!.shapes[0],
      point = worldPoint(actual, { x: 12, y: 12 });
    await page.getByRole('button', { name: 'Preview selection trajectories', exact: true }).click();
    await expect(page.getByLabel('Selection trajectory proposal')).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    await expect.poll(() => pixel(page, point)).toEqual([255, 0, 0, 255]);
    if (mode === 'multi') {
      const p = worldPoint(expected.layers[1].keys[4].shapes[0], { x: 12, y: 12 });
      await expect.poll(() => pixel(page, p)).toEqual([0, 0, 255, 255]);
    }
    if (mode === 'children')
      await expect.poll(() => pixel(page, { x: 364, y: 224 })).toEqual([0, 0, 255, 255]);
    if (mode.startsWith('nested-'))
      await expect
        .poll(() =>
          pixel(
            page,
            worldPoint(
              expected.layers[0].keys[4].shapes.find((shape) => shape.id === 'a')!,
              { x: 4, y: 4 },
            ),
          ),
        )
        .toEqual([0, 0, 255, 255]);
    await commit.click();
    await expect.poll(f.read).toEqual(expected);
    await expect(f.region).toHaveCount(0);
    await expect(page.getByLabel('Updated trajectory selection')).toHaveText(
      `Trajectory · ${tracks.length * 4} units · ${tracks.length} tracks · ${tracks.length * 6} artwork members`,
    );
    await expect(
      page.getByText(tracks.length * 6 + ' picked members', { exact: true }),
    ).toBeVisible();
    for (const layerId of tracks) {
      const layer = expected.layers.find((layer) => layer.id === layerId)!,
        old = f.before.layers.find((layer) => layer.id === layerId)!,
        end = layerId === 'base' ? 8 : 10;
      expect(layer.motionSpans).toHaveLength(1);
      expect(layer.motionSpans![0].id).toBe(old.motionSpans![0].id);
      expect(layer.keys.filter((key) => [0, end, 12].includes(key.frame))).toEqual(
        old.keys.filter((key) => [0, end, 12].includes(key.frame)),
      );
      for (const member of layer.keys[4].shapes) {
        const b = objectBounds(member),
          cyan = await f.stage.evaluate((el, b) => {
            const c = el as HTMLCanvasElement,
              d = devicePixelRatio,
              x = Math.max(0, Math.floor(c.width / 2 + (b.left - 254) * d)),
              y = Math.max(0, Math.floor(c.height / 2 + (b.top - 154) * d)),
              w = Math.min(c.width - x, Math.ceil((b.right - b.left + 8) * d)),
              h = Math.min(c.height - y, Math.ceil((b.bottom - b.top + 8) * d)),
              p = c.getContext('2d')!.getImageData(x, y, w, h).data;
            let count = 0;
            for (let i = 0; i < p.length; i += 4)
              if (p[i] < 120 && p[i + 1] > 100 && p[i + 2] > 100 && p[i + 3] === 255) count++;
            return count;
          }, b);
        expect(cyan, layerId + '/' + member.id).toBeGreaterThan(2);
      }
    }
    await f.stage.focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

async function arm(
  page: Page,
  phase: 'snapshot' | 'candidate' | 'publication',
  action: string,
  id: string,
) {
  await page.evaluate(
    ({ phase, action, id }) => {
      Object.assign(window, { trajectoryHook: false, trajectoryPublicationReads: 0 });
      const stringify = JSON.stringify,
        clone = structuredClone,
        descriptors = Object.getOwnPropertyDescriptors;
      let last: Project | undefined,
        reads = 0,
        done = false;
      const field = (node: unknown, name: string): unknown => {
        const n = node as [unknown, [string, unknown][]];
        return Array.isArray(n?.[1]) ? n[1].find((entry) => entry[0] === name)?.[1] : undefined;
      };
      const leaf = (node: unknown) => (node as unknown[])?.[1];
      const complete = (p: Project | undefined) =>
        p?.id === id &&
        p.layers?.[0].motionSpans?.length === 1 &&
        p.layers[0].motionSpans[0].path?.startY === 60;
      const apply = () => {
        if (done) return;
        done = true;
        Object.assign(window, { trajectoryHook: true, trajectoryPublicationReads: reads });
        JSON.stringify = stringify;
        window.structuredClone = clone;
        Object.getOwnPropertyDescriptors = descriptors;
        const input = (name: string, values: string[]) => {
          const node = document.querySelector(
            'input[aria-label="' + name + '"]',
          ) as HTMLInputElement;
          if (!node) throw Error('Missing input ' + name);
          for (const value of values) {
            node.value = value;
            node.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        const check = (name: string, values: boolean[]) => {
          const node = document.querySelector(
            'input[aria-label="' + name + '"]',
          ) as HTMLInputElement;
          if (!node) throw Error('Missing checkbox ' + name);
          for (const value of values) {
            node.checked = value;
            node.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        if (action === 'target' || action === 'restored')
          input('Selection trajectory base start Y', action === 'restored' ? ['61', '60'] : ['61']);
        else if (action === 'selection') check('Sampled unit base/r', [false]);
        else if (action === 'mode' || action === 'mode-restored')
          check(
            'Edit sampled selection trajectories',
            action === 'mode-restored' ? [false, true] : [false],
          );
        else if (action === 'group' || action === 'group-restored')
          check(
            'Select complete sampled stage groups',
            action === 'group-restored' ? [true, false] : [true],
          );
        else if (action === 'children-restored')
          check('Remember sampled stage children', [true, false]);
        else if (action === 'frame' || action === 'close') {
          const text = action === 'frame' ? 'Next frame' : 'Return to authored stage';
          const node = Array.from(document.querySelectorAll('button')).find(
            (node) => node.textContent?.trim() === text,
          );
          if (!node) throw Error('Missing button ' + text);
          node.click();
        } else if (action === 'source')
          (document.querySelector('button[aria-label="Add layer"]') as HTMLButtonElement).click();
        else if (action === 'output') {
          if (!last) throw Error('No completed candidate');
          last.layers[0].keys.find((key) => key.frame === 4)!.shapes[0].x++;
        }
      };
      if (phase === 'publication') {
        Object.getOwnPropertyDescriptors = ((value: unknown) => {
          const out = descriptors(value);
          if (complete(value as Project)) last = value as Project;
          return out;
        }) as typeof Object.getOwnPropertyDescriptors;
        JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
          const out = stringify(value, replacer as never, space),
            tree = value as unknown[][];
          if (tree?.[0]?.[0] === 'array' && tree[0][1] === 4) {
            const candidate = field(tree, '1'),
              path = field(
                field(field(field(field(candidate, 'layers'), '0'), 'motionSpans'), '0'),
                'path',
              );
            if (leaf(field(candidate, 'id')) === id && leaf(field(path, 'startY')) === 60) reads++;
          }
          const p = value as Project;
          if (reads === 7 && p?.id === id && p.layers && !p.layers[0].motionSpans?.[0].path)
            apply();
          return out;
        }) as typeof JSON.stringify;
      } else
        window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
          const out = clone(value, options),
            p = out as Project;
          if (phase === 'candidate' ? complete(p) : p?.id === id && !!p.layers) {
            if (complete(p)) last = p;
            apply();
          }
          return out;
        }) as typeof structuredClone;
    },
    { phase, action, id },
  );
}
for (const phase of ['snapshot', 'candidate', 'publication'] as const)
  for (const action of [
    'target',
    'restored',
    'selection',
    'mode-restored',
    'mode',
    'children-restored',
    'group',
    'group-restored',
    'frame',
    'close',
    'source',
    ...(phase === 'snapshot' ? [] : ['output']),
  ])
    test(`main trajectory rejects ${phase} ${action}`, async ({ page }) => {
      const f = await setup(page, 'multi', ['base', 'extra']);
      await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
      await fill(page, ['base', 'extra']);
      await arm(page, phase, action, f.before.id);
      await page
        .getByRole('button', { name: 'Commit selection trajectories', exact: true })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { trajectoryHook: boolean }).trajectoryHook,
        ),
      ).toBe(true);
      if (phase === 'publication')
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { trajectoryPublicationReads: number })
                .trajectoryPublicationReads,
          ),
        ).toBe(7);
      const after = await f.read();
      if (action === 'source') {
        expect(after.layers).toHaveLength(f.before.layers.length + 1);
        expect(after.layers.slice(0, 2)).toEqual(f.before.layers);
        if (await f.region.isVisible())
          await f.region
            .getByRole('button', { name: 'Return to authored stage', exact: true })
            .click();
        await f.stage.focus();
        await page.keyboard.press('Control+z');
        expect(await f.read()).toEqual(f.before);
      } else expect(after).toEqual(f.before);
      if (action === 'frame')
        await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('6');
      if (action === 'close') await expect(f.region).toHaveCount(0);
      if (action === 'selection')
        await expect(f.editor.getByLabel('Sampled unit base/r', { exact: true })).not.toBeChecked();
      if (action === 'group' || action === 'group-restored') {
        await expect(f.region.getByLabel('Select complete sampled stage groups')).toBeChecked({
          checked: action === 'group',
        });
        await expect(
          f.editor.getByRole('button', { name: 'Commit selection trajectories', exact: true }),
        ).toBeDisabled();
      }
      if (action === 'target' || action === 'restored') {
        await expect(
          page.getByLabel('Selection trajectory base start Y', { exact: true }),
        ).toHaveValue(action === 'target' ? '61' : '60');
        if (action === 'restored') {
          await page
            .getByRole('button', { name: 'Commit selection trajectories', exact: true })
            .click();
          await expect.poll(f.read).not.toEqual(f.before);
        }
      }
      if (action === 'mode-restored') {
        await expect(
          f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }),
        ).toBeChecked();
        await fill(page, ['base', 'extra']);
        await page
          .getByRole('button', { name: 'Commit selection trajectories', exact: true })
          .click();
        await expect.poll(f.read).not.toEqual(f.before);
      }
      expect(f.errors).toEqual([]);
    });

test('main trajectory keeps numeric drafts and release preferences separate', async ({ page }) => {
  const f = await setup(page, 'base');
  await f.editor.getByLabel('Sampled selection X offset').fill('17');
  await f.editor.getByLabel('Sampled selection Y offset').fill('-9');
  await f.editor.getByLabel('Drag sampled selection offsets', { exact: true }).check();
  await f.editor.getByLabel('Author sampled selection drag on release', { exact: true }).check();
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  await fill(page, ['base']);
  await expect(
    f.editor.getByLabel('Drag sampled selection offsets', { exact: true }),
  ).toBeDisabled();
  await expect(
    f.editor.getByLabel('Author sampled selection drag on release', { exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Preview selection trajectories', exact: true }).click();
  await f.stage.scrollIntoViewIfNeeded();
  const box = (await f.stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 80);
  await page.mouse.down();
  expect(await f.stage.evaluate((node) => (node as HTMLCanvasElement).hasPointerCapture(1))).toBe(
    false,
  );
  await page.mouse.up();
  expect(await f.read()).toEqual(f.before);
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).uncheck();
  await expect(f.editor.getByLabel('Sampled selection X offset')).toHaveValue('17');
  await expect(f.editor.getByLabel('Sampled selection Y offset')).toHaveValue('-9');
  await expect(
    f.editor.getByLabel('Author sampled selection drag on release', { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
  expect(await f.read()).toEqual(f.before);
  expect(f.errors).toEqual([]);
});
test('main trajectory rejects incomplete coverage then recovers with original complete units', async ({
  page,
}) => {
  const f = await setup(page, 'base');
  await f.editor.getByLabel('Sampled unit base/other', { exact: true }).uncheck();
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  await expect(
    page.getByRole('button', { name: 'Commit selection trajectories', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('complete');
  await f.editor.getByLabel('Sampled unit base/other', { exact: true }).check();
  await expect(page.getByLabel('Trajectory selection readout')).toHaveText(
    '4 units · 1 tracks · 6 artwork members',
  );
  await fill(page, ['base']);
  await page.getByRole('button', { name: 'Commit selection trajectories', exact: true }).click();
  await expect.poll(f.read).not.toEqual(f.before);
  expect(f.errors).toEqual([]);
});
test('main cubic trajectory protects saved waypoints and ordinary recovery', async ({ page }) => {
  const f = await setup(page, 'waypoints');
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('waypoint');
  await expect(
    page.getByRole('button', { name: 'Commit selection trajectories', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).uncheck();
  await expect(f.editor.getByLabel('Sampled selection X offset')).toBeVisible();
  await f.region.getByRole('button', { name: 'Return to authored stage', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
  expect(f.errors).toEqual([]);
});
test('main trajectory keeps blank/no-op inputs disabled and rejects derived overflow atomically', async ({
  page,
}) => {
  const f = await setup(page, 'base');
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  const commit = page.getByRole('button', { name: 'Commit selection trajectories', exact: true });
  await expect(commit).toBeDisabled();
  await fill(page, ['base']);
  const field = page.getByLabel('Selection trajectory base start Y', { exact: true });
  await field.fill('');
  await expect(commit).toBeDisabled();
  await field.fill('60');
  await page
    .getByLabel('Selection trajectory base start X', { exact: true })
    .fill(String(Number.MAX_VALUE));
  await commit.click();
  expect(await f.read()).toEqual(f.before);
  await expect(page.getByRole('alert')).toBeVisible();
  await fill(page, ['base']);
  await commit.click();
  await expect.poll(f.read).not.toEqual(f.before);
  expect(f.errors).toEqual([]);
});

for (const kind of ['translation', 'skew'])
  test('main trajectory entry cancels active ' + kind + ' capture', async ({ page }) => {
    const f = await setup(page, 'base');
    if (kind === 'skew') {
      await f.editor.getByLabel('Skew sampled selection', { exact: true }).check();
      await f.editor.getByLabel('Drag sampled selection skew', { exact: true }).check();
      await f.editor
        .getByLabel('Author sampled selection skew on release', { exact: true })
        .check();
    } else {
      await f.editor.getByLabel('Drag sampled selection offsets', { exact: true }).check();
      await f.editor
        .getByLabel('Author sampled selection drag on release', { exact: true })
        .check();
    }
    await f.stage.scrollIntoViewIfNeeded();
    const b = (await f.stage.boundingBox())!,
      point = kind === 'skew' ? { x: 180, y: 60 } : { x: 72, y: 72 },
      x = b.x + b.width / 2 + point.x - 250,
      y = b.y + b.height / 2 + point.y - 150;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (kind === 'skew' ? 6 : 24), y, { steps: 2 });
    expect(await f.stage.evaluate((node) => (node as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      true,
    );
    await f.editor
      .getByLabel('Edit sampled selection trajectories', { exact: true })
      .evaluate((node) => {
        const input = node as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    expect(await f.stage.evaluate((node) => (node as HTMLCanvasElement).hasPointerCapture(1))).toBe(
      false,
    );
    await page.mouse.up();
    expect(await f.read()).toEqual(f.before);
    await fill(page, ['base']);
    await page.getByRole('button', { name: 'Commit selection trajectories', exact: true }).click();
    await expect.poll(f.read).toEqual(await oracle(page, f.before, ['base']));
    expect(f.errors).toEqual([]);
  });
for (const tracks of [['base'], ['base', 'extra']])
  test('main trajectory direct commit ' + tracks.join('/'), async ({ page }) => {
    const f = await setup(page, 'multi', tracks);
    await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
    await fill(page, tracks);
    await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
    const expected = await oracle(page, f.before, tracks);
    await page.getByRole('button', { name: 'Commit selection trajectories', exact: true }).click();
    await expect.poll(f.read).toEqual(expected);
    expect(f.errors).toEqual([]);
  });
for (const action of ['target', 'source'])
  test('main trajectory preview rejects actual late ' + action, async ({ page }) => {
    const f = await setup(page, 'multi', ['base', 'extra']),
      expected = await oracle(page, f.before, ['base', 'extra']);
    await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
    await fill(page, ['base', 'extra']);
    await arm(page, 'candidate', action, f.before.id);
    await page.getByRole('button', { name: 'Preview selection trajectories', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { trajectoryHook: boolean }).trajectoryHook),
    ).toBe(true);
    await expect(page.getByLabel('Selection trajectory proposal')).toHaveCount(0);
    const shape = expected.layers[0].keys[4].shapes[0];
    await expect
      .poll(() => pixel(page, worldPoint(shape, { x: 12, y: 12 })))
      .toEqual([255, 255, 255, 255]);
    const after = await f.read();
    if (action === 'source') {
      expect(after.layers.slice(0, 2)).toEqual(f.before.layers);
      expect(after.layers).toHaveLength(3);
    } else expect(after).toEqual(f.before);
    expect(f.errors).toEqual([]);
  });
test('main trajectory reopens its unchanged recipe identity for another whole-route edit', async ({
  page,
}) => {
  const f = await setup(page, 'base');
  await f.editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  await fill(page, ['base']);
  await page.getByRole('button', { name: 'Commit selection trajectories', exact: true }).click();
  await expect.poll(f.read).not.toEqual(f.before);
  const first = await f.read();
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(first);
  await page.getByLabel('Timeline frames').click({ position: { x: 81, y: 40 } });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }).click();
  const region = page.getByRole('region', { name: 'Sampled motion stage' });
  await region.getByLabel('Select multiple sampled units').check();
  const editor = region.getByRole('group', { name: 'Sampled selection set', exact: true });
  for (const request of requests(['base']))
    await editor
      .getByLabel('Sampled unit ' + request.layerId + '/' + request.shapeId, { exact: true })
      .check();
  await editor.getByLabel('Edit sampled selection trajectories', { exact: true }).check();
  await expect(page.getByLabel('Selection trajectory base start Y', { exact: true })).toHaveValue(
    '60',
  );
  await page.getByLabel('Selection trajectory base start Y', { exact: true }).fill('65');
  const expected = await oracle(page, first, ['base'], { base: { ...numbers.base, startY: 65 } });
  await page.getByRole('button', { name: 'Commit selection trajectories', exact: true }).click();
  await expect.poll(f.read).toEqual(expected);
  expect(expected.layers[0].motionSpans![0].id).toBe(first.layers[0].motionSpans![0].id);
  expect(expected.layers[0].motionSpans).toHaveLength(1);
  expect(f.errors).toEqual([]);
});
