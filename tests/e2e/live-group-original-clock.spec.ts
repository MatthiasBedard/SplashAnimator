import { test, expect, type Page } from '@playwright/test';
import { restrictedArcProject } from '../restricted-arc-project-fixture';
import type { Project } from '../../packages/document/src';
import { captureLiveMotionStage } from '../../packages/animation/src/live-motion-stage';
import {
  captureLiveGroupMotionAuthoringFrame,
  prepareRestrictedArcLiveGroupMotionSpans,
} from '../../packages/animation/src/live-group-motion-owner';

const policy = 'Keep original group distance timing';
const insertName = 'Insert preserved live group key';
const previewName = 'Preview preserved live group key';

async function setup(page: Page, p = restrictedArcProject().p) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('clock-seeded')) {
      sessionStorage.setItem('clock-seeded', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function open(page: Page, optIn = true) {
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Insert live group tween key…', exact: true }).click();
  await expect(page.getByLabel(policy, { exact: true })).not.toBeChecked();
  await page.getByLabel('Live group split frame', { exact: true }).fill('5');
  if (optIn) await page.getByLabel(policy, { exact: true }).check();
}
async function insert(page: Page) {
  await page.getByRole('button', { name: insertName, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function undo(page: Page, redo = false) {
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}
function expected(p: Project, q: Project, ids = ['track']) {
  const c = captureLiveGroupMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 4 }));
  try {
    return prepareRestrictedArcLiveGroupMotionSpans(
      ids.map((id) => ({
        owner: c.resolve(id, 'outer'),
        rightSpanId: q.layers.find((l) => l.id === id)!.liveMotionSpans![1].id,
      })),
    );
  } finally {
    c.dispose();
  }
}
function probes(p: Project, frame = 4) {
  const c = captureLiveMotionStage(() => ({ project: p, revision: 0 }));
  try {
    const shapes = c.sample(frame).project.layers[0].keys.find((k) => k.frame === frame)!.shapes;
    return ['a', 'c', 'loose'].map((id) => {
      const s = shapes.find((s) => s.id === id)!,
        b = s.transform!;
      return {
        x: Math.floor(s.x + b[0] * 6 + b[2] * 5),
        y: Math.floor(s.y + b[1] * 6 + b[3] * 5),
        color: id === 'a' ? [255, 0, 0, 255] : id === 'c' ? [0, 255, 0, 255] : [0, 0, 255, 255],
      };
    });
  } finally {
    c.dispose();
  }
}
async function pixels(page: Page, p: Project, points: ReturnType<typeof probes>, preview = false) {
  return page
    .locator(
      preview
        ? 'img[alt="Preserved live group split preview"]'
        : 'canvas[aria-label="Drawing stage"]',
    )
    .evaluate(
      (node, { p, points, preview }) => {
        let canvas = node as HTMLCanvasElement;
        if (preview) {
          const image = node as HTMLImageElement;
          canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext('2d')!.drawImage(image, 0, 0);
        }
        return points.map(({ x, y }) =>
          Array.from(
            canvas
              .getContext('2d')!
              .getImageData(
                preview ? x : canvas.width / 2 + (x - p.width / 2) * devicePixelRatio,
                preview ? y : canvas.height / 2 + (y - p.height / 2) * devicePixelRatio,
                1,
                1,
              ).data,
          ),
        );
      },
      { p, points, preview },
    );
}

for (const basis of ['plain', 'affine', 'reflected'])
  test(`original-clock ${basis} preview and insertion retain exact data, stage/PNG pixels, complete selection and history`, async ({
    page,
  }) => {
    const f = await setup(page, restrictedArcProject(basis).p),
      points = probes(f.p);
    await open(page);
    await page.getByRole('button', { name: previewName, exact: true }).click();
    await expect(
      page.getByRole('img', { name: 'Preserved live group split preview' }),
    ).toBeVisible();
    await expect.poll(() => pixels(page, f.p, points, true)).toEqual(points.map((p) => p.color));
    expect(await f.read()).toEqual(f.p);
    await insert(page);
    const out = await f.read();
    expect(out).toEqual(expected(f.p, out));
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
    await expect.poll(() => pixels(page, f.p, points)).toEqual(points.map((p) => p.color));
    await expect(
      page.getByText('5 vectors selected. Drag or use arrow keys to move together.', {
        exact: true,
      }),
    ).toBeVisible();
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    await undo(page, true);
    expect(await f.read()).toEqual(out);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    expect(await f.read()).toEqual(out);
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }).click();
    let current = 0;
    for (const frame of [3, 5]) {
      await page.getByLabel('Timeline frames', { exact: true }).focus();
      while (current < frame) {
        await page.keyboard.press('ArrowRight');
        current++;
      }
      const originalPoints = probes(f.p, frame);
      await expect
        .poll(() => pixels(page, f.p, originalPoints))
        .toEqual(originalPoints.map((p) => p.color));
      expect(await f.read()).toEqual(out);
    }
    expect(f.errors).toEqual([]);
  });

test('default remains conservative; Cancel is history-free and opted-in retry succeeds', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page, false);
  await page.getByRole('button', { name: insertName, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel(policy).check();
  await page.getByRole('button', { name: previewName, exact: true }).click();
  await expect(page.getByRole('img', { name: 'Preserved live group split preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await open(page);
  await insert(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});

for (const invalid of ['ease', 'artwork', 'shared', 'numeric', 'persisted'])
  test(`original-clock rejects ${invalid} without changing options or history`, async ({
    page,
  }) => {
    const data = restrictedArcProject(),
      p = invalid === 'persisted' ? data.q : data.p;
    const span = p.layers[0].liveMotionSpans![0];
    if (invalid === 'ease') span.ease = 'in-out';
    if (invalid === 'artwork') p.layers[0].keys[1].shapes[0].fill = '#222222';
    if (invalid === 'shared') span.path = { startX: 0, startY: 10, endX: 0, endY: 10 };
    const f = await setup(page, p);
    await open(page);
    if (invalid === 'numeric' || invalid === 'persisted' || invalid === 'ease')
      await page.getByLabel('Live group split frame').fill('3');
    await page.getByRole('button', { name: insertName, exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(p);
    await page.keyboard.press('Escape');
    await undo(page);
    expect(await f.read()).toEqual(p);
    if (invalid === 'numeric') {
      await open(page);
      await insert(page);
      await undo(page);
      expect(await f.read()).toEqual(p);
    }
    expect(f.errors).toEqual([]);
  });

test('all-track admission is atomic and a failed later track permits a single-track retry', async ({
  page,
}) => {
  const p = restrictedArcProject().p;
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
  p.layers[1].keys[1].shapes[0].fill = '#336699';
  const f = await setup(page, p);
  await open(page);
  await page.getByLabel('Split live group track Later').check();
  await page.getByRole('button', { name: insertName }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(p);
  await page.getByLabel('Split live group track Later').uncheck();
  await insert(page);
  const out = await f.read();
  expect(out).toEqual(expected(p, out));
  expect(out.layers[1]).toEqual(p.layers[1]);
  await undo(page);
  expect(await f.read()).toEqual(p);
});

test('two-track original-clock preview retains stable right identities and complete library/settings through one edit', async ({
  page,
}) => {
  const p = restrictedArcProject().p;
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
  const f = await setup(page, p);
  await open(page);
  await page.getByLabel('Split live group track Later').check();
  await page.evaluate(() => {
    const clone = structuredClone;
    Object.assign(window, { clockPreviewIds: [] });
    window.structuredClone = <T>(v: T): T => {
      const out = clone(v),
        p = v as Project;
      if (
        p?.layers?.every(
          (l) =>
            l.liveMotionSpans?.length === 2 &&
            l.liveMotionSpans.every((s) => s.groupPaths?.every((b) => !!b.restrictedArc)),
        )
      )
        Object.assign(window, { clockPreviewIds: p.layers.map((l) => l.liveMotionSpans![1].id) });
      return out;
    };
  });
  await page.getByLabel('Group split remembered children').check();
  await page.getByRole('button', { name: previewName }).click();
  await expect(page.getByRole('img', { name: 'Preserved live group split preview' })).toBeVisible();
  const ids = await page.evaluate(
    () => (window as unknown as { clockPreviewIds: string[] }).clockPreviewIds,
  );
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(await f.read()).toEqual(p);
  await insert(page);
  const out = await f.read();
  expect(out.layers.map((l) => l.liveMotionSpans![1].id)).toEqual(ids);
  expect(out).toEqual(expected(p, out, ['track', 'later']));
  await undo(page);
  expect(await f.read()).toEqual(p);
  await undo(page, true);
  expect(await f.read()).toEqual(out);
  expect(f.errors).toEqual([]);
});

test('changed-and-restored policy cancels pending PNG work and permits a fresh preview', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await page.evaluate(() => {
    Object.assign(window, { clockPngHeld: false, clockPngRelease: undefined });
  });
  // PNG encoding belongs to the detached renderer's realm, not the main canvas.
  await page.addInitScript(() => {
    if (window === window.parent) return;
    const host = window.parent as unknown as {
      clockPngHeld: boolean;
      clockPngRelease?: () => void;
    };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (host.clockPngHeld) return toBlob.call(this, callback, ...args);
      host.clockPngHeld = true;
      host.clockPngRelease = () => toBlob.call(this, callback, ...args);
      HTMLCanvasElement.prototype.toBlob = toBlob;
    };
  });
  await page.getByRole('button', { name: previewName }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { clockPngHeld: boolean }).clockPngHeld))
    .toBe(true);
  await page.getByLabel(policy).uncheck();
  await page.getByLabel(policy).check();
  await page.evaluate(() =>
    (window as unknown as { clockPngRelease: () => void }).clockPngRelease(),
  );
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Preserved live group split preview' })).toHaveCount(
    0,
  );
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: previewName }).click();
  await expect(page.getByRole('img', { name: 'Preserved live group split preview' })).toBeVisible();
  await page.getByLabel(policy).uncheck();
  await expect(page.getByRole('img', { name: 'Preserved live group split preview' })).toHaveCount(
    0,
  );
  await page.getByLabel(policy).check();
  await insert(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('initial opted-out policy cannot be changed and restored during source preparation', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page, false);
  await page.evaluate((policy) => {
    const clone = structuredClone;
    Object.assign(window, { clockOptOutHit: false });
    window.structuredClone = <T>(value: T): T => {
      const out = clone(value),
        input = value as { originalClock?: boolean; target?: number };
      if (
        !(window as unknown as { clockOptOutHit: boolean }).clockOptOutHit &&
        input?.originalClock === false &&
        input?.target === 4
      ) {
        Object.assign(window, { clockOptOutHit: true });
        const e = document.querySelector(`[aria-label="${policy}"]`) as HTMLInputElement;
        e.click();
        e.click();
      }
      return out;
    };
  }, policy);
  await page.getByRole('button', { name: insertName }).click();
  expect(
    await page.evaluate(() => (window as unknown as { clockOptOutHit: boolean }).clockOptOutHit),
  ).toBe(true);
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('choices changed');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel(policy).check();
  await insert(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});

for (const phase of ['initial', 'clone', 'recovery'])
  for (const action of ['policy', 'frame', 'source', 'history'])
    test(`${phase} actual ${action} edit rejects stale original-clock insertion with a fresh retry`, async ({
      page,
    }) => {
      const f = await setup(page);
      await open(page);
      if (action === 'history')
        await page
          .getByRole('button', { name: 'Edit', exact: true })
          .evaluate((e: HTMLButtonElement) => e.click());
      await page.evaluate(
        ({ phase, action, policy }) => {
          const win = window as unknown as { clockHookHit: boolean };
          win.clockHookHit = false;
          const clone = structuredClone,
            stringify = JSON.stringify;
          function fire(value: unknown) {
            const wrapper = value as { project?: Project },
              p = (phase === 'recovery' ? wrapper?.project : value) as Project;
            const initial = value as { originalClock?: boolean; target?: number };
            if (
              win.clockHookHit ||
              (phase === 'initial'
                ? initial?.originalClock !== true || initial?.target !== 4
                : !p?.layers?.[0]?.liveMotionSpans?.some((s) =>
                    s.groupPaths?.some((b) => !!b.restrictedArc),
                  ))
            )
              return;
            win.clockHookHit = true;
            if (action === 'policy') {
              const e = document.querySelector(`[aria-label="${policy}"]`) as HTMLInputElement;
              e.click();
              e.click();
            } else if (action === 'frame') {
              const e = document.querySelector(
                '[aria-label="Live group split frame"]',
              ) as HTMLInputElement;
              for (const v of ['6', '5']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } else {
              const e = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
              e.value = '#000000';
              e.dispatchEvent(new Event('change', { bubbles: true }));
              if (action === 'history') {
                // A real separate edit and Undo restores source values but changes history ownership.
                const button = [...document.querySelectorAll('button')].find((b) =>
                  b.textContent?.trim().startsWith('Undo '),
                );
                if (!button) throw Error('Missing Undo action');
                button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              }
            }
          }
          if (phase === 'recovery')
            JSON.stringify = ((...args: Parameters<typeof stringify>) => {
              const out = stringify(...args);
              fire(args[0]);
              return out;
            }) as typeof stringify;
          else
            window.structuredClone = <T>(v: T) => {
              const out = clone(v);
              fire(v);
              return out;
            };
        },
        { phase, action, policy },
      );
      await page.getByRole('button', { name: insertName }).click();
      expect(
        await page.evaluate(() => (window as unknown as { clockHookHit: boolean }).clockHookHit),
      ).toBe(true);
      const out = await f.read();
      expect(out.layers).toEqual(f.p.layers);
      if (action === 'source') {
        expect(out.background).toBe('#000000');
        await undo(page);
        expect(await f.read()).toEqual(f.p);
      } else expect(out).toEqual(f.p);
      if (action === 'policy' || action === 'frame') {
        await expect(page.getByLabel(policy)).toBeChecked();
        await page.getByLabel(policy).uncheck();
        await page.getByRole('button', { name: insertName }).click();
        expect(await f.read()).toEqual(f.p);
        await page.getByLabel(policy).check();
      } else await open(page);
      await insert(page);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });
