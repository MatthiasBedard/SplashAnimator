import { test, expect, type Page } from '@playwright/test';
import { recursiveRestrictedArcProject } from '../recursive-restricted-arc-fixture';
import type { Project } from '../../packages/document/src';
import { captureLiveMotionStage } from '../../packages/animation/src/live-motion-stage';
import {
  captureLiveGroupMotionAuthoringFrame,
  prepareRecursiveRestrictedArcLiveGroupMotionSpans,
} from '../../packages/animation/src/live-group-motion-owner';

const policy = 'Continue saved group distance timing';
const creationPolicy = 'Keep original group distance timing';
const insertName = 'Insert preserved live group key';
const previewName = 'Preview preserved live group key';

async function setup(page: Page, p = recursiveRestrictedArcProject().q) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('recursive-clock-seeded')) {
      sessionStorage.setItem('recursive-clock-seeded', 'yes');
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
  await expect(page.getByLabel(creationPolicy, { exact: true })).not.toBeChecked();
  await page.getByLabel('Live group split frame', { exact: true }).fill('3');
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
function expected(p: Project, q: Project, ids = ['track'], frame = 2) {
  const c = captureLiveGroupMotionAuthoringFrame(() => ({ project: p, revision: 0, frame }));
  try {
    return prepareRecursiveRestrictedArcLiveGroupMotionSpans(
      ids.map((id) => ({
        owner: c.resolve(id, 'outer'),
        rightSpanId: q.layers
          .find((l) => l.id === id)!
          .liveMotionSpans!.find((s) => s.start === frame)!.id,
      })),
    );
  } finally {
    c.dispose();
  }
}
function probes(p: Project, frame = 2) {
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

test('insert original and continued distance keys during an accelerating fade and changing stroke width with Undo and recovery',async({page})=>{
  const {p}=recursiveRestrictedArcProject('reflected',{fade:true,accelerate:true,varyStroke:true,varyColor:true});
  const f=await setup(page,p);
  let previous=p;
  for(const frame of [4,2,6]) {
    await open(page,false);
    await page.getByLabel('Live group split frame',{exact:true}).fill(String(frame+1));
    await page.getByLabel(frame===4?creationPolicy:policy,{exact:true}).check();
    await page.getByRole('button',{name:previewName,exact:true}).click();
    await expect(page.getByRole('img',{name:'Preserved live group split preview'})).toBeVisible();
    const uColor=frame/8, looseProbe=probes(p,frame)[2];
    await expect.poll(()=>pixels(page,p,[looseProbe],true)).toEqual([[16+192*uColor,32+96*uColor,48+64*uColor,255]]);
    await insert(page);
    const out=await f.read(), layer=out.layers[0], u=frame/8;
    expect(layer.keys.find(k=>k.frame===frame)!.shapes[0].opacity).toBeCloseTo(1-0.75*(2*u-u*u),10);
    expect(layer.liveMotionSpans!.find(s=>s.end===frame)!.groupPaths![0].restrictedArc!.descriptor.to).toBeCloseTo(u*u,12);
    expect(layer.keys.find(k=>k.frame===frame)!.shapes[0].strokeWidth).toBeCloseTo(2+16*u*u,10);
    expect(layer.liveMotionSpans!.every(s=>s.options?.strokeWidth===true)).toBe(true);
    expect(layer.keys.filter(k=>k.frame!==frame)).toEqual(previous.layers[0].keys);
    await undo(page); await expect.poll(f.read).toEqual(previous);
    await undo(page,true); await expect.poll(f.read).toEqual(out);
    previous=out;
  }
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  expect(await f.read()).toEqual(previous);
  expect(f.errors).toEqual([]);
});

for (const basis of ['plain', 'affine', 'reflected'])
  test(`recursive original-clock ${basis} preview and insertion retain exact data, stage/PNG pixels, complete selection and history`, async ({
    page,
  }) => {
    const f = await setup(page, recursiveRestrictedArcProject(basis).q),
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
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 8, 10]);
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

test('successive saved-timing edits reopen independently and retain two separate Undo/Redo records', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page);
  await insert(page);
  const a = await f.read();
  expect(a).toEqual(expected(f.p, a));
  await open(page);
  await page.getByLabel('Live group split frame').fill('7');
  await insert(page);
  const b = await f.read();
  expect(b).toEqual(expected(a, b, ['track'], 6));
  expect(b.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 8, 10]);
  await expect(
    page.getByText('5 vectors selected. Drag or use arrow keys to move together.', { exact: true }),
  ).toBeVisible();
  await undo(page);
  expect(await f.read()).toEqual(a);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await undo(page, true);
  expect(await f.read()).toEqual(a);
  await undo(page, true);
  expect(await f.read()).toEqual(b);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(b);
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

test('creation preference cannot authorize persisted timing; conflicting choices stay disabled until corrected', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page, false);
  await page.getByLabel(creationPolicy).check();
  await page.getByRole('button', { name: insertName }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel(policy).check();
  await expect(page.getByRole('button', { name: insertName })).toBeDisabled();
  await expect(page.getByRole('button', { name: previewName })).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText(
    'Choose one distance timing option.',
  );
  await page.getByLabel(creationPolicy).uncheck();
  await insert(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
});

for (const invalid of ['ease', 'artwork', 'shared', 'numeric', 'ordinary', 'mixed'])
  test(`recursive original-clock rejects ${invalid} without changing options or history`, async ({
    page,
  }) => {
    const data = recursiveRestrictedArcProject(),
      p = invalid === 'ordinary' || invalid === 'shared' ? data.p : data.q;
    const span = p.layers[0].liveMotionSpans![0];
    if (invalid === 'ease') {
      // A longer saved half admits an interior cut away from the ease-in-out midpoint.
      p.duration *= 2;
      for (const key of p.layers[0].keys) key.frame *= 2;
      for (const recipe of p.layers[0].liveMotionSpans!) {
        recipe.start *= 2;
        recipe.end *= 2;
      }
      span.ease = 'in-out';
    }
    if (invalid === 'artwork') p.layers[0].keys[1].shapes[0].fill = '#222222';
    if (invalid === 'shared') span.path = { startX: 0, startY: 10, endX: 0, endY: 10 };
    if (invalid === 'mixed') delete span.groupPaths![1].restrictedArc;
    if (invalid === 'numeric')
      for (const key of p.layers[0].keys) for (const shape of key.shapes) shape.y += 80;
    const f = await setup(page, p);
    await open(page);
    await page.getByRole('button', { name: insertName, exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(p);
    if (invalid === 'numeric') {
      await page.getByLabel('Live group split frame').fill('7');
      await insert(page);
      await undo(page);
      expect(await f.read()).toEqual(p);
    } else {
      await page.keyboard.press('Escape');
      await undo(page);
      expect(await f.read()).toEqual(p);
    }
    expect(f.errors).toEqual([]);
  });

test('all-track admission is atomic and a failed later track permits a single-track retry', async ({
  page,
}) => {
  const p = recursiveRestrictedArcProject().q;
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
  const p = recursiveRestrictedArcProject().q;
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
            l.liveMotionSpans?.length === 3 &&
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

test('initial opted-out recursive policy cannot be changed and restored during source preparation', async ({
  page,
}) => {
  const f = await setup(page);
  await open(page, false);
  await page.evaluate((policy) => {
    const clone = structuredClone;
    Object.assign(window, { clockOptOutHit: false });
    window.structuredClone = <T>(value: T): T => {
      const out = clone(value),
        input = value as { recursiveClock?: boolean; target?: number };
      if (
        !(window as unknown as { clockOptOutHit: boolean }).clockOptOutHit &&
        input?.recursiveClock === false &&
        input?.target === 2
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
  for (const action of ['policy', 'creationPolicy', 'frame', 'tracks', 'source', 'history'])
    test(`${phase} actual ${action} edit rejects stale recursive original-clock insertion with a fresh retry`, async ({
      page,
    }) => {
      const f = await setup(page);
      await open(page);
      if (action === 'history')
        await page
          .getByRole('button', { name: 'Edit', exact: true })
          .evaluate((e: HTMLButtonElement) => e.click());
      await page.evaluate(
        ({ phase, action, policy, creationPolicy }) => {
          const win = window as unknown as { clockHookHit: boolean };
          win.clockHookHit = false;
          const clone = structuredClone,
            stringify = JSON.stringify;
          function fire(value: unknown) {
            const wrapper = value as { project?: Project },
              p = (phase === 'recovery' ? wrapper?.project : value) as Project;
            const initial = value as { recursiveClock?: boolean; target?: number };
            if (
              win.clockHookHit ||
              (phase === 'initial'
                ? initial?.recursiveClock !== true || initial?.target !== 2
                : p?.layers?.[0]?.liveMotionSpans?.length !== 3 ||
                  !p.layers[0].keys.some((k) => k.frame === 2))
            )
              return;
            win.clockHookHit = true;
            if (action === 'policy' || action === 'creationPolicy') {
              const e = document.querySelector(
                `[aria-label="${action === 'creationPolicy' ? creationPolicy : policy}"]`,
              ) as HTMLInputElement;
              e.click();
              e.click();
            } else if (action === 'frame') {
              const e = document.querySelector(
                '[aria-label="Live group split frame"]',
              ) as HTMLInputElement;
              for (const v of ['4', '3']) {
                e.value = v;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } else if (action === 'tracks') {
              const e = document.querySelector(
                'input[aria-label^="Split live group track "]',
              ) as HTMLInputElement;
              e.click();
              e.click();
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
        { phase, action, policy, creationPolicy },
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
      if (
        action === 'policy' ||
        action === 'creationPolicy' ||
        action === 'frame' ||
        action === 'tracks'
      ) {
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
