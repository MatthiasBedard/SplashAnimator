import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
type Basis = [number, number, number, number];
function fixture(mode = 'rigid', basis = 'plain', many = false) {
  const p = newProject();
  p.width = 300;
  p.height = 200;
  p.duration = 12;
  p.fps = 1;
  const b: Basis =
    basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -1.4 : 1.4, 0.2, 0.3, 1];
  const h: Basis =
    mode === 'uniform'
      ? [1.5, 0, 0, 1.5]
      : mode === 'axes'
        ? [2, 0, 0, 0.5]
        : mode === 'shear'
          ? [2, 0, 0.25, 0.5]
          : mode === 'both'
            ? [2, 0.2, 0.25, 0.5]
            : [1, 0, 0, 1];
  const multiply = (a: Basis, b: Basis): Basis => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
  ];
  const rect = (id: string, x: number, y: number, fill: string, groups?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 12,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    transform: [...b],
    ...(groups ? { groups } : {}),
  });
  const a = [
    rect('a', 0, 20, '#ff0000', ['outer', 'inner']),
    rect('b', 40, 20, '#0000ff', ['outer', 'inner']),
  ];
  if (many)
    a.push(
      rect('c', 160, 100, '#00aa00', ['second']),
      rect('d', 200, 100, '#ffff00', ['second', 'child']),
      rect('loose', 240, 20, '#000000'),
    );
  const end = a.map((s): Vector => {
    const leader = s.groups?.[0] === 'second' ? a[2] : a[0];
    const dx = s.x - leader.x,
      dy = s.y - leader.y;
    return {
      ...structuredClone(s),
      x: s.groups ? leader.x + 80 - (h[1] * dx + h[3] * dy) : s.x,
      y: s.groups ? leader.y + (h[0] * dx + h[2] * dy) : s.y + 80,
      rotation: s.groups ? 90 : 0,
      transform: s.groups ? multiply(h, b) : [...b],
    };
  });
  p.layers[0].id = 'group';
  p.layers[0].name = 'Group';
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys = [
    { frame: 0, shapes: a },
    { frame: 8, shapes: end },
    { frame: 10, shapes: [] },
  ];
  p.symbols = [
    {
      id: 'preserve',
      name: 'Preserve',
      width: 10,
      height: 10,
      shapes: [rect('library', 0, 0, '#123456')],
    },
  ];
  return { p, b, h };
}
async function setup(
  page: Page,
  mode = 'rigid',
  basis = 'plain',
  many = false,
  special?: 'laterBad' | 'plain' | 'two',
) {
  const f = fixture(mode, basis, many),
    errors: string[] = [];
  if (special === 'laterBad' || special === 'two') {
    const later = structuredClone(f.p.layers[0]);
    later.id = 'later';
    later.name = 'Later';
    if (special === 'laterBad') later.keys[1].shapes[1].x += 5;
    f.p.layers.push(later);
  }
  if (special === 'plain')
    for (const key of f.p.layers[0].keys) for (const shape of key.shapes) delete shape.groups;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('group-create-seeded')) {
      sessionStorage.setItem('group-create-seeded', '1');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, f.p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const open = async () => {
    const cmd = page.getByRole('button', { name: 'Create live tween…', exact: true });
    if (!(await cmd.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await cmd.click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Create live tween', exact: true });
  await expect(d.getByLabel('Live tween motion mode')).toHaveValue('plain');
  if (special !== 'plain')
    await expect(d.getByRole('button', { name: 'Create live tween', exact: true })).toBeDisabled();
  await d.getByLabel('Live tween motion mode').selectOption('groups');
  if (mode !== 'rigid') {
    await d
      .getByLabel(
        mode === 'uniform' ? 'Live group uniform scaling' : 'Live group independent axis scaling',
      )
      .check();
    if (mode === 'shear' || mode === 'both') await d.getByLabel('Live group shared shear').check();
    await d.getByText('Interpolation options', { exact: true }).click();
    await d.getByLabel('Live tween Scale and skew', { exact: true }).check();
  }
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const commit = async () => {
    await d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    await expect(d).toBeHidden();
  };
  const undo = async (redo = false) => {
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
  };
  return { ...f, d, read, commit, undo, open, errors };
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage').evaluate(
    (el, { p, x, y }) => {
      const c = el as HTMLCanvasElement;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (x - p.width / 2) * devicePixelRatio,
            c.height / 2 + (y - p.height / 2) * devicePixelRatio,
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`explicit live group creation ${mode} ${basis} retains exact keys and renders qualified motion`, async ({
      page,
    }) => {
      const f = await setup(page, mode, basis);
      await f.commit();
      const out = await f.read(),
        span = out.layers[0].liveMotionSpans![0];
      const expected = {
        id: span.id,
        start: 0,
        end: 8,
        ease: 'linear',
        rotation: {
          direction: 'shortest',
          turns: 0,
          rigidGroups: true,
          ...(mode === 'uniform'
            ? { uniformGroupScale: true }
            : mode !== 'rigid'
              ? {
                  axisGroupScale: true,
                  ...(mode === 'shear' || mode === 'both' ? { axisGroupShear: true } : {}),
                }
              : {}),
        },
        ...(mode !== 'rigid' ? { options: { affine: true } } : {}),
      };
      expect(out).toEqual({ ...f.p, layers: [{ ...f.p.layers[0], liveMotionSpans: [expected] }] });
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const h = f.h,
        b = f.b,
        local = { x: b[0] * 6 + b[2] * 6, y: b[1] * 6 + b[3] * 6 },
        hm = [(1 + h[0]) / 2, h[1] / 2, h[2] / 2, (1 + h[3]) / 2];
      for (const [offset, color] of [
        [0, [255, 0, 0, 255]],
        [40, [0, 0, 255, 255]],
      ] as const) {
        const u = hm[0] * (offset + local.x) + hm[2] * local.y,
          v = hm[1] * (offset + local.x) + hm[3] * local.y;
        await expect
          .poll(() => pixel(page, f.p, 40 + (u - v) / Math.SQRT2, 20 + (u + v) / Math.SQRT2))
          .toEqual(color);
      }
      await f.undo();
      await expect.poll(f.read).toEqual(f.p);
      await f.undo(true);
      await expect.poll(f.read).toEqual(out);
      await page.reload();
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      expect(await f.read()).toEqual(out);
      expect(f.errors).toEqual([]);
    });
test('explicit multiple nested groups and loose roots publish one complete selection and history step', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', true);
  await f.commit();
  const out = await f.read();
  expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(out.symbols).toEqual(f.p.symbols);
  await expect(
    page.getByText('5 vectors selected. Drag or use arrow keys to move together.', { exact: true }),
  ).toBeVisible();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.undo(true);
  expect(await f.read()).toEqual(out);
  expect(f.errors).toEqual([]);
});
for (const [direction, turns] of [
  ['clockwise', 1],
  ['counterclockwise', 0],
] as const)
  test(`explicit group rotation ${direction} ${turns} survives publication`, async ({ page }) => {
    const f = await setup(page);
    await f.d.getByLabel('Live group rotation direction').selectOption(direction);
    await f.d.getByLabel('Live group extra turns').fill(String(turns));
    await f.commit();
    expect((await f.read()).layers[0].liveMotionSpans![0].rotation).toEqual({
      direction,
      turns,
      rigidGroups: true,
    });
    await page.getByLabel('Timeline frames').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(() => pixel(page, f.p, 40, 20 - 6 * Math.SQRT2)).toEqual([255, 0, 0, 255]);
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
for (const invalid of [
  'missingAffine',
  'shearDependency',
  'conflict',
  'shortestTurns',
  'fraction',
  'NaN',
] as const)
  test(`group creation rejects ${invalid} and retains a fresh retry`, async ({ page }) => {
    const f = await setup(page, invalid === 'missingAffine' ? 'axes' : 'rigid');
    if (invalid === 'missingAffine')
      await f.d.getByLabel('Live tween Scale and skew', { exact: true }).uncheck();
    if (invalid === 'shearDependency') await f.d.getByLabel('Live group shared shear').check();
    if (invalid === 'conflict') {
      await f.d.getByLabel('Live group uniform scaling').check();
      await f.d.getByLabel('Live group independent axis scaling').check();
    }
    if (['shortestTurns', 'fraction', 'NaN'].includes(invalid))
      await f.d
        .getByLabel('Live group extra turns')
        .fill(invalid === 'NaN' ? '' : invalid === 'fraction' ? '0.5' : '1');
    await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    await expect(f.d.getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Escape');
    await f.open();
    await f.d.getByLabel('Live tween motion mode').selectOption('groups');
    if (invalid === 'missingAffine') {
      await f.d.getByLabel('Live group independent axis scaling').check();
      await f.d.getByText('Interpolation options', { exact: true }).click();
      await f.d.getByLabel('Live tween Scale and skew', { exact: true }).check();
    }
    await f.commit();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

for (const hook of ['clone', 'serialize'] as const)
  for (const action of [
    'mode',
    'direction',
    'turns',
    'uniform',
    'axes',
    'shear',
    'source',
    'close',
  ] as const)
    test(`group creation ${hook} rejects late restored ${action} after group candidates exist`, async ({
      page,
    }) => {
      const f = await setup(page);
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { groupCreateHook: state });
          const fire = (value: unknown) => {
            if (
              state.hit ||
              !(value as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.rotation?.rigidGroups
            )
              return;
            state.hit = true;
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Independent group source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
            else if (action === 'uniform' || action === 'axes' || action === 'shear') {
              const label =
                action === 'uniform'
                  ? 'Live group uniform scaling'
                  : action === 'axes'
                    ? 'Live group independent axis scaling'
                    : 'Live group shared shear';
              const e = document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
              e.click();
              e.click();
            } else if (action === 'turns') {
              const e = document.querySelector(
                '[aria-label="Live group extra turns"]',
              ) as HTMLInputElement;
              for (const value of ['1', '0']) {
                e.value = value;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } else {
              const label =
                  action === 'mode' ? 'Live tween motion mode' : 'Live group rotation direction',
                e = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
              for (const value of action === 'mode'
                ? ['plain', 'groups']
                : ['clockwise', 'shortest']) {
                e.value = value;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(value: T) => {
              const out = clone(value);
              fire(value);
              return out;
            };
          } else {
            const stringify = JSON.stringify;
            JSON.stringify = ((...args: Parameters<typeof stringify>) => {
              const out = stringify(...args);
              fire(args[0]);
              return out;
            }) as typeof stringify;
          }
        },
        { hook, action },
      );
      await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { groupCreateHook: { hit: boolean } }).groupCreateHook.hit,
        ),
      ).toBe(true);
      const after = await f.read();
      expect(after.layers[0].liveMotionSpans).toBeUndefined();
      expect(after.layers[0].keys).toEqual(f.p.layers[0].keys);
      if (action === 'source') {
        expect(after.layers[0].name).toBe('Independent group source edit');
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      } else expect(after).toEqual(f.p);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      await f.open();
      await f.d.getByLabel('Live tween motion mode').selectOption('groups');
      await f.commit();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });
test('all-track group creation rejects a later incompatible group atomically and retains retry IDs', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'laterBad');
  await f.d.getByLabel('Create live track Later').check();
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { ids: [] as string[] };
    Object.assign(window, { groupCreateIDs: state });
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (Array.isArray(value) && value[0]?.span?.rotation?.rigidGroups)
        state.ids.push(value[0].span.id);
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Create live track Later').uncheck();
  await f.commit();
  const out = await f.read(),
    ids = await page.evaluate(
      () => (window as unknown as { groupCreateIDs: { ids: string[] } }).groupCreateIDs.ids,
    );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(out.layers[0].liveMotionSpans![0].id).toBe(ids[0]);
  expect(out.layers[1]).toEqual(f.p.layers[1]);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('group mode cannot authorize ungrouped tracks and hidden group preferences leave plain defaults exact', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'plain');
  await expect(f.d.getByRole('button', { name: 'Create live tween', exact: true })).toBeDisabled();
  await f.d.getByLabel('Live group uniform scaling').check();
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).evaluate((e) => {
    (e as HTMLButtonElement).disabled = false;
    (e as HTMLButtonElement).click();
  });
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Live tween motion mode').selectOption('plain');
  await f.commit();
  const span = (await f.read()).layers[0].liveMotionSpans![0];
  expect(span).toEqual({ id: span.id, start: 0, end: 8, ease: 'linear' });
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('cloned group header getter rejects without reads and fresh creation recovers', async ({
  page,
}) => {
  const f = await setup(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { hit: false, reads: 0 };
    Object.assign(window, { groupHeaderGetter: state });
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      const input = out as { tracks?: string[]; rotation?: { turns: number } };
      if (!state.hit && input.tracks && input.rotation) {
        state.hit = true;
        Object.defineProperty(input.rotation, 'turns', {
          enumerable: true,
          get() {
            state.reads++;
            return 0;
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { groupHeaderGetter: { hit: boolean; reads: number } })
          .groupHeaderGetter,
    ),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await f.commit();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

test('two complete group tracks publish together with independent IDs and one history transaction', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'two');
  await f.d.getByLabel('Create live track Later').check();
  await f.commit();
  const out = await f.read();
  const ids = out.layers.map((l) => l.liveMotionSpans![0].id);
  expect(new Set(ids).size).toBe(2);
  expect(out.symbols).toEqual(f.p.symbols);
  for (let i = 0; i < 2; i++) {
    expect(out.layers[i].keys).toEqual(f.p.layers[i].keys);
    expect(out.layers[i].liveMotionSpans![0]).toEqual({
      id: ids[i],
      start: 0,
      end: 8,
      ease: 'linear',
      rotation: { direction: 'shortest', turns: 0, rigidGroups: true },
    });
  }
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.undo(true);
  expect(await f.read()).toEqual(out);
});
for (const action of ['mode', 'direction', 'source', 'candidate', 'reentry'] as const)
  test(`group final recovery preparation rejects stale ${action} or retains one admitted transaction`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { groupRecoveryHook: state });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const result = stringify(...args),
          wrapper = args[0] as { project?: Project };
        if (
          !state.hit &&
          wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.rotation?.rigidGroups
        ) {
          state.hit = true;
          if (action === 'candidate') wrapper.project.layers[0].keys[0].shapes[0].x += 100;
          else if (action === 'source') {
            const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            e.value = 'Final independent edit';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (action === 'reentry') {
            const button = [...document.querySelectorAll('button')].find(
              (e) => e.textContent === 'Create live tween',
            )!;
            button.disabled = false;
            button.click();
          } else {
            const e = document.querySelector(
              `[aria-label="${action === 'mode' ? 'Live tween motion mode' : 'Live group rotation direction'}"]`,
            ) as HTMLSelectElement;
            for (const value of action === 'mode'
              ? ['plain', 'groups']
              : ['clockwise', 'shortest']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return result;
      }) as typeof stringify;
    }, action);
    await f.d.getByRole('button', { name: 'Create live tween', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { groupRecoveryHook: { hit: boolean } }).groupRecoveryHook.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      await expect(f.d).toBeHidden();
      expect((await f.read()).layers[0].liveMotionSpans).toHaveLength(1);
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      return;
    }
    const out = await f.read();
    expect(out.layers[0].liveMotionSpans).toBeUndefined();
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    if (action === 'source') {
      expect(out.layers[0].name).toBe('Final independent edit');
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else expect(out).toEqual(f.p);
    if (await f.d.isVisible()) await page.keyboard.press('Escape');
    await f.open();
    await f.d.getByLabel('Live tween motion mode').selectOption('groups');
    await f.commit();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
