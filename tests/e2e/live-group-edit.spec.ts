import { expect, test, type Page } from '@playwright/test';
import { liveRotationFixture, secondRotationTrack } from '../live-motion-rotation-fixture';
import type { Project } from '../../packages/document/src';
async function setup(page: Page, mode = 'rigid', basis = 'plain', many = false, special = '') {
  const f = liveRotationFixture(mode, basis, many);
  f.p.layers[0].name = 'Group';
  for (const key of f.p.layers[0].keys)
    for (const s of key.shapes) {
      s.y += 80;
      s.x += 80;
      if (s.id === 'b') s.fill = '#0000ff';
    }
  if (
    special === 'mixed' ||
    special === 'locked' ||
    special === 'hidden' ||
    special === 'twoGroups'
  ) {
    const later = secondRotationTrack(f.p);
    later.name = 'Later';
    if (special === 'locked') later.locked = true;
    if (special === 'hidden') later.visible = false;
    if (special === 'mixed') {
      for (const key of later.keys) for (const shape of key.shapes) delete shape.groups;
      later.liveMotionSpans![0].rotation = { direction: 'clockwise', turns: 0, rigidGroups: false };
    } else if (special === 'twoGroups') {
      later.liveMotionSpans![0].rotation = {
        ...later.liveMotionSpans![0].rotation!,
        direction: 'counterclockwise',
        turns: 0,
        groupDepth: 0,
        savedGroupPivots: false,
      };
      later.liveMotionSpans![0].ease = 'out';
    }
  }
  if (special.startsWith('flag:')) {
    const [, key, action] = special.split(':');
    const rotation = f.p.layers[0].liveMotionSpans![0].rotation!;
    Object.assign(rotation, {
      uniformGroupScale: false,
      axisGroupScale: key === 'axisGroupShear',
      axisGroupShear: false,
    });
    Object.assign(rotation, { [key]: action !== 'enable' });
    f.p.layers[0].liveMotionSpans![0].options!.affine = true;
  }
  if (special === 'advanced') {
    const span = f.p.layers[0].liveMotionSpans![0];
    Object.assign(span.rotation!, {
      groupDepth: 0,
      savedGroupPivots: false,
      axisGroupScale: false,
      uniformGroupScale: false,
      axisGroupShear: false,
    });
    span.path = {
      startX: 10,
      startY: 0,
      endX: -10,
      endY: 0,
      waypoints: [{ x: 40, y: 0 }],
      curvedWaypoints: true,
      waypointTangents: [
        { x: 10, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
      ],
      waypointIncoming: [{ x: -10, y: 0 }],
      distance: true,
    };
    span.options!.gradientStops = { pairs: 'auto' };
    span.options!.gradientGeometry = true;
  }
  if (special === 'channels') {
    for (const shape of f.p.layers[0].keys[0].shapes) shape.opacity = 0.2;
    for (const shape of f.p.layers[0].keys[1].shapes) shape.opacity = 1;
    f.p.layers[0].keys[1].shapes[0].fill = '#0000ff';
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-group-edit-seed')) {
      sessionStorage.setItem('live-group-edit-seed', '1');
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
    const cmd = page.getByRole('button', { name: 'Edit live tween…', exact: true });
    if (!(await cmd.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await cmd.click();
  };
  await open();
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true }),
    group = d.getByLabel('Edit live tween Group frames 1–9', { exact: true });
  await expect(group).toBeDisabled();
  await d.getByLabel('Include complete group live tweens').check();
  await group.check();
  if (special === 'mixed')
    await d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).uncheck();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    apply = async () => {
      await d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
      await expect(d).toBeHidden();
    },
    undo = async (redo = false) => {
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
    };
  return { ...f, d, read, apply, undo, open, errors };
}
async function direction(page: Page) {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByLabel('Edit live group direction').selectOption('clockwise');
  await d.getByLabel('Edit live group turns mode').selectOption('set');
  await d.getByLabel('Edit live group turns', { exact: true }).fill('1');
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
    test(`live group edit ${mode} ${basis} preserves complete artwork and renders changed rotation`, async ({
      page,
    }) => {
      const f = await setup(page, mode, basis);
      await direction(page);
      await f.apply();
      const out = await f.read(),
        expected = structuredClone(f.p);
      expected.layers[0].liveMotionSpans![0].rotation = {
        ...expected.layers[0].liveMotionSpans![0].rotation!,
        direction: 'clockwise',
        turns: 1,
      };
      expect(out).toEqual(expected);
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      const h = f.h,
        b = f.b,
        hm = [(1 + h[0]) / 2, h[1] / 2, h[2] / 2, (1 + h[3]) / 2],
        local = { x: b[0] * 6 + b[2] * 5, y: b[1] * 6 + b[3] * 5 };
      for (const [offset, color] of [
        [0, [255, 64, 64, 255]],
        [40, [64, 64, 255, 255]],
      ] as const) {
        const u = hm[0] * (offset + local.x) + hm[2] * local.y,
          v = hm[1] * (offset + local.x) + hm[3] * local.y;
        await expect
          .poll(() => pixel(page, f.p, 120 + (-u + v) / Math.SQRT2, 100 + (-u - v) / Math.SQRT2))
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
test('multiple nested groups and loose roots retain complete authored selection', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', true);
  await direction(page);
  await f.apply();
  await expect(
    page.getByText('5 vectors selected. Drag or use arrow keys to move together.', { exact: true }),
  ).toBeVisible();
  expect((await f.read()).layers[0].keys).toEqual(f.p.layers[0].keys);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('mixed original group headers keep each unchosen setting and one all-track edit', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'twoGroups');
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
  await f.d.getByLabel('Change live tween easing').check();
  await f.d.getByLabel('Edited live tween easing').selectOption('in');
  await f.apply();
  const expected = structuredClone(f.p);
  for (const layer of expected.layers) layer.liveMotionSpans![0].ease = 'in';
  expect(await f.read()).toEqual(expected);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('mixed group and plain edits never add group rotation flags to plain recipes', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'mixed');
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
  await direction(page);
  await f.d.getByLabel('Change live tween easing').check();
  await f.d.getByLabel('Edited live tween easing').selectOption('in');
  await f.apply();
  const expected = structuredClone(f.p);
  for (const layer of expected.layers) layer.liveMotionSpans![0].ease = 'in';
  expected.layers[0].liveMotionSpans![0].rotation = {
    ...expected.layers[0].liveMotionSpans![0].rotation!,
    direction: 'clockwise',
    turns: 1,
  };
  expect(await f.read()).toEqual(expected);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

for (const key of ['uniformGroupScale', 'axisGroupScale', 'axisGroupShear'] as const)
  for (const mode of ['enable', 'disable', 'remove'] as const)
    test(`group flag ${key} ${mode} preserves every unchosen header field`, async ({ page }) => {
      const f = await setup(page, 'rigid', 'plain', false, 'flag:' + key + ':' + mode);
      await f.d.getByLabel('Edit live group ' + key, { exact: true }).selectOption(mode);
      if (mode !== 'enable' && key !== 'axisGroupShear') {
        await f.d.getByText('Interpolation option changes', { exact: true }).click();
        await f.d.getByLabel('Edit live option affine').selectOption('disable');
      }
      await f.apply();
      const expected = structuredClone(f.p),
        header = expected.layers[0].liveMotionSpans![0].rotation!;
      if (mode === 'remove') delete header[key];
      else header[key] = mode === 'enable';
      if (mode !== 'enable' && key !== 'axisGroupShear')
        expected.layers[0].liveMotionSpans![0].options!.affine = false;
      expect(await f.read()).toEqual(expected);
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    });
test('rotation edits keep original advanced path/channel/options and false metadata exact', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'advanced');
  await direction(page);
  await f.apply();
  const expected = structuredClone(f.p);
  Object.assign(expected.layers[0].liveMotionSpans![0].rotation!, {
    direction: 'clockwise',
    turns: 1,
  });
  expect(await f.read()).toEqual(expected);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
for (const invalid of [
  'missingAffine',
  'dependency',
  'conflict',
  'dropScale',
  'NaN',
  'fraction',
  'shortestTurns',
  'scopeOff',
] as const)
  test(`group editing rejects ${invalid} without clearing choices and permits a fresh correction`, async ({
    page,
  }) => {
    const f = await setup(page, invalid === 'dropScale' ? 'axes' : 'rigid');
    await direction(page);
    if (invalid === 'missingAffine')
      await f.d
        .getByLabel('Edit live group uniformGroupScale', { exact: true })
        .selectOption('enable');
    if (invalid === 'dependency')
      await f.d
        .getByLabel('Edit live group axisGroupShear', { exact: true })
        .selectOption('enable');
    if (invalid === 'conflict') {
      await f.d
        .getByLabel('Edit live group uniformGroupScale', { exact: true })
        .selectOption('enable');
      await f.d
        .getByLabel('Edit live group axisGroupScale', { exact: true })
        .selectOption('enable');
    }
    if (invalid === 'dropScale')
      await f.d
        .getByLabel('Edit live group axisGroupScale', { exact: true })
        .selectOption('disable');
    if (invalid === 'NaN' || invalid === 'fraction')
      await f.d
        .getByLabel('Edit live group turns', { exact: true })
        .fill(invalid === 'NaN' ? '' : '0.5');
    if (invalid === 'shortestTurns')
      await f.d.getByLabel('Edit live group direction').selectOption('shortest');
    if (invalid === 'scopeOff')
      await f.d.getByLabel('Include complete group live tweens').uncheck();
    await f.d
      .getByRole('button', { name: 'Apply live tween changes', exact: true })
      .evaluate((e) => {
        (e as HTMLButtonElement).disabled = false;
        (e as HTMLButtonElement).click();
      });
    await expect(f.d.getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(f.p);
    if (invalid === 'scopeOff') await f.d.getByLabel('Include complete group live tweens').check();
    else if (invalid === 'missingAffine') {
      await f.d.getByText('Interpolation option changes', { exact: true }).click();
      await f.d.getByLabel('Edit live option affine').selectOption('enable');
    } else if (invalid === 'dependency')
      await f.d.getByLabel('Edit live group axisGroupShear', { exact: true }).selectOption('keep');
    else if (invalid === 'conflict') {
      await f.d
        .getByLabel('Edit live group uniformGroupScale', { exact: true })
        .selectOption('keep');
      await f.d.getByLabel('Edit live group axisGroupScale', { exact: true }).selectOption('keep');
    } else if (invalid === 'dropScale')
      await f.d.getByLabel('Edit live group axisGroupScale', { exact: true }).selectOption('keep');
    else if (invalid === 'shortestTurns')
      await f.d.getByLabel('Edit live group direction').selectOption('clockwise');
    else await f.d.getByLabel('Edit live group turns', { exact: true }).fill('1');
    await f.apply();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const special of ['locked', 'hidden'])
  test(`explicit group opt-in still rejects forged ${special} record selection`, async ({
    page,
  }) => {
    const f = await setup(page, 'rigid', 'plain', false, special);
    await direction(page);
    const later = f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true });
    await expect(later).toBeDisabled();
    await later.evaluate((e) => {
      (e as HTMLInputElement).checked = true;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    await expect(f.d.getByRole('status')).toContainText('visible unlocked');
    expect(await f.read()).toEqual(f.p);
    await later.evaluate((e) => {
      (e as HTMLInputElement).checked = false;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await f.apply();
    expect((await f.read()).layers[1]).toEqual(f.p.layers[1]);
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
for (const mode of ['equalDirection', 'removeAbsent'] as const)
  test(`group ${mode} cannot add no-op history`, async ({ page }) => {
    const f = await setup(page);
    if (mode === 'equalDirection')
      await f.d.getByLabel('Edit live group direction').selectOption('shortest');
    else
      await f.d
        .getByLabel('Edit live group uniformGroupScale', { exact: true })
        .selectOption('remove');
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    await expect(f.d.getByRole('status')).toContainText('unchanged');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Escape');
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
test('group-only header settings do not silently drop a selected plain record', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'mixed'),
    later = f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true });
  await later.check();
  await direction(page);
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await later.uncheck();
  await f.apply();
  expect((await f.read()).layers[1]).toEqual(f.p.layers[1]);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

for (const hook of ['clone', 'serialize'] as const)
  for (const action of [
    'scope',
    'direction',
    'turnMode',
    'turns',
    'uniform',
    'axes',
    'shear',
    'source',
    'frame',
    'tool',
    'close',
  ] as const)
    test(`existing group edit ${hook} rejects late ${action} after changed candidates exist`, async ({
      page,
    }) => {
      const f = await setup(page);
      await direction(page);
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { groupEditHook: state });
          const fire = (value: unknown) => {
            const p = value as Project;
            if (state.hit || p?.layers?.[0]?.liveMotionSpans?.[0]?.rotation?.turns !== 1) return;
            state.hit = true;
            if (action === 'scope') {
              const e = document.querySelector(
                '[aria-label="Include complete group live tweens"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            } else if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Independent group edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (action === 'frame')
              for (const title of ['Last frame', 'First frame'])
                (
                  document.querySelector('button[title="' + title + '"]') as HTMLButtonElement
                ).click();
            else if (action === 'tool')
              for (const label of ['Brush', 'Selection'])
                (
                  document.querySelector('[aria-label="' + label + '"]') as HTMLButtonElement
                ).click();
            else if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
            else if (action === 'turns') {
              const e = document.querySelector(
                '[aria-label="Edit live group turns"]',
              ) as HTMLInputElement;
              for (const value of ['2', '1']) {
                e.value = value;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } else {
              const label =
                  action === 'direction'
                    ? 'Edit live group direction'
                    : action === 'turnMode'
                      ? 'Edit live group turns mode'
                      : action === 'uniform'
                        ? 'Edit live group uniformGroupScale'
                        : action === 'axes'
                          ? 'Edit live group axisGroupScale'
                          : 'Edit live group axisGroupShear',
                e = document.querySelector('[aria-label="' + label + '"]') as HTMLSelectElement;
              for (const value of action === 'direction'
                ? ['counterclockwise', 'clockwise']
                : action === 'turnMode'
                  ? ['keep', 'set']
                  : ['enable', 'keep']) {
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
      await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { groupEditHook: { hit: boolean } }).groupEditHook.hit,
        ),
      ).toBe(true);
      const out = await f.read();
      expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
      expect(out.layers[0].liveMotionSpans).toEqual(f.p.layers[0].liveMotionSpans);
      if (action === 'source') {
        expect(out.layers[0].name).toBe('Independent group edit');
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      } else expect(out).toEqual(f.p);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      await f.open();
      await f.d.getByLabel('Include complete group live tweens').check();
      await f.d.getByLabel('Edit live tween Group frames 1–9', { exact: true }).check();
      await direction(page);
      await f.apply();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });
for (const action of ['scope', 'direction', 'source', 'candidate', 'reentry'] as const)
  test(`existing group final recovery ${action} cannot publish stale data or duplicate history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await direction(page);
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { groupEditRecovery: state });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const out = stringify(...args),
          wrapper = args[0] as { project?: Project };
        if (
          !state.hit &&
          wrapper?.project?.layers?.[0]?.liveMotionSpans?.[0]?.rotation?.turns === 1
        ) {
          state.hit = true;
          if (action === 'scope') {
            const e = document.querySelector(
              '[aria-label="Include complete group live tweens"]',
            ) as HTMLInputElement;
            e.click();
            e.click();
          } else if (action === 'direction') {
            const e = document.querySelector(
              '[aria-label="Edit live group direction"]',
            ) as HTMLSelectElement;
            for (const value of ['counterclockwise', 'clockwise']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (action === 'candidate') wrapper.project.layers[0].keys[0].shapes[0].x += 100;
          else if (action === 'source') {
            const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            e.value = 'Final independent group edit';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const button = [...document.querySelectorAll('button')].find(
              (e) => e.textContent === 'Apply live tween changes',
            )!;
            button.disabled = false;
            button.click();
          }
        }
        return out;
      }) as typeof stringify;
    }, action);
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { groupEditRecovery: { hit: boolean } }).groupEditRecovery.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      await expect(f.d).toBeHidden();
      expect((await f.read()).layers[0].liveMotionSpans![0].rotation!.turns).toBe(1);
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      return;
    }
    const out = await f.read();
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(out.layers[0].liveMotionSpans).toEqual(f.p.layers[0].liveMotionSpans);
    if (action === 'source') {
      expect(out.layers[0].name).toBe('Final independent group edit');
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else expect(out).toEqual(f.p);
    if (await f.d.isVisible()) await page.keyboard.press('Escape');
    await f.open();
    await f.d.getByLabel('Include complete group live tweens').check();
    await f.d.getByLabel('Edit live tween Group frames 1–9', { exact: true }).check();
    await direction(page);
    await f.apply();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
test('existing group cloned header getters reject with zero reads and a fresh correction remains usable', async ({
  page,
}) => {
  const f = await setup(page);
  await direction(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { hit: false, reads: 0 };
    Object.assign(window, { groupEditGetter: state });
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (!state.hit && Array.isArray(out) && out[0]?.changes?.rotation) {
        state.hit = true;
        Object.defineProperty(out[0].changes.rotation, 'turns', {
          enumerable: true,
          get() {
            state.reads++;
            return 1;
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { groupEditGetter: { hit: boolean; reads: number } }).groupEditGetter,
    ),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await f.apply();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

test('group channel timing stays independent of geometry and leaves rotation metadata untouched', async ({
  page,
}) => {
  const f = await setup(page, 'rigid', 'plain', false, 'channels');
  await f.d.getByLabel('Live opacity easing mode').selectOption('set');
  await f.d.getByLabel('Live opacity easing', { exact: true }).selectOption('linear');
  await f.d.getByLabel('Live paint easing mode').selectOption('set');
  await f.d.getByLabel('Live paint easing', { exact: true }).selectOption('in');
  await f.apply();
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].opacityEase = 'linear';
  expected.layers[0].liveMotionSpans![0].paintEase = 'in';
  expect(await f.read()).toEqual(expected);
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => pixel(page, f.p, 120 + 1 / Math.SQRT2, 100 + 11 / Math.SQRT2))
    .toEqual([217, 102, 140, 255]);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
for (const action of ['remove', 'replace'] as const)
  test(`explicit group trajectory ${action} keeps header/channel/options and original keys`, async ({
    page,
  }) => {
    const f = await setup(page, 'rigid', 'plain', false, 'advanced');
    await f.d.getByLabel('Live trajectory mode').selectOption(action);
    if (action === 'replace') {
      await f.d.getByLabel('Live cubic startY', { exact: true }).fill('40');
      await f.d.getByLabel('Live cubic endY', { exact: true }).fill('40');
    }
    await f.apply();
    const expected = structuredClone(f.p);
    if (action === 'remove') delete expected.layers[0].liveMotionSpans![0].path;
    else expected.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
    expect(await f.read()).toEqual(expected);
    if (action === 'replace') {
      await page.getByLabel('Timeline frames').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await expect
        .poll(() => pixel(page, f.p, 120 + 1 / Math.SQRT2, 130 + 11 / Math.SQRT2))
        .toEqual([255, 64, 64, 255]);
      await expect
        .poll(() => pixel(page, f.p, 120 + 1 / Math.SQRT2, 100 + 11 / Math.SQRT2))
        .toEqual([255, 255, 255, 255]);
    }
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });

test('forged unknown interpolation mode rejects instead of silently disabling a group dependency', async ({
  page,
}) => {
  const f = await setup(page);
  await direction(page);
  await f.d.getByText('Interpolation option changes', { exact: true }).click();
  const select = f.d.getByLabel('Edit live option affine');
  await select.evaluate((e) => {
    const s = e as HTMLSelectElement;
    s.add(new Option('Invalid mode', 'unsupported'));
    s.value = 'unsupported';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('option modes');
  expect(await f.read()).toEqual(f.p);
  await select.selectOption('keep');
  await f.apply();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
