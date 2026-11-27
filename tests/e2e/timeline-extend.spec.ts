import { expect, test, type Page } from '@playwright/test';
import { type Project, newLayer } from '../../packages/document/src';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';
import { prepareTimelineFrameInsertion } from '../../apps/editor/src/timeline-keyframe';

async function setup(
  page: Page,
  live = false,
  long = false,
  locked = false,
  kind?: 'motion' | 'shape',
) {
  let p = liveSplitFixture();
  p.layers[0].keys.pop();
  p.layers[0].drawingMode = 'object';
  p.layers[0].locked = locked;
  if (!live) delete p.layers[0].liveMotionSpans;
  if (kind) {
    delete p.layers[0].liveMotionSpans;
    p = prepareTimelineTween(p, 'track', {
      start: 0,
      end: 8,
      kind,
      symbolize: kind === 'motion',
      ease: 'linear',
      affine: false,
      createEndpoints: false,
    });
  }
  if (long) p.duration = 80;
  const other = newLayer('Other');
  other.locked = true;
  p.layers.unshift(other);
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('timeline-extend-seeded')) return;
    sessionStorage.setItem('timeline-extend-seeded', '1');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true }),
    scroll = page.getByLabel('Timeline scroll', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const future = async () => {
    const b = (await timeline.boundingBox())!,
      offset = await scroll.evaluate((n) => Math.round(n.scrollLeft / 18));
    return offset + Math.floor(b.width / 18) - 2;
  };
  const point = async (at: number, row = 0) => {
    const b = (await timeline.boundingBox())!,
      offset = await scroll.evaluate((n) => Math.round(n.scrollLeft / 18));
    return { x: b.x + (at - offset) * 18 + 9, y: b.y + 39 + row * 28 };
  };
  const open = async (at: number) => {
    const p = await point(at);
    await page.mouse.click(p.x, p.y, { button: 'right' });
  };
  const pixel = () =>
    canvas.evaluate((c: HTMLCanvasElement) =>
      Array.from(
        c
          .getContext('2d')!
          .getImageData(
            Math.round(c.width / 2 + 13 * devicePixelRatio),
            Math.round(c.height / 2 - 33 * devicePixelRatio),
            1,
            1,
          ).data,
      ),
    );
  const history = async (out: Project) => {
    await timeline.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(out);
  };
  return { p, timeline, canvas, scroll, read, future, point, open, pixel, history };
}
for (const action of ['F6', 'F7'] as const)
  test(`clicking a future cell leaves the playhead in place until ${action} inserts there`, async ({
    page,
  }) => {
    const f = await setup(page, action === 'F7');
    const authored = await f.point(3);
    await page.mouse.click(authored.x, authored.y);
    const readout = page.locator('.frame-readout');
    await expect(readout).toHaveText(`Frame 4 / ${f.p.duration}`);
    const at = await f.future(),
      target = await f.point(at);
    const border = () =>
      f.timeline.evaluate(
        (node, { clientX, clientY }) => {
          const canvas = node as HTMLCanvasElement,
            box = canvas.getBoundingClientRect();
          const x = Math.floor(((clientX - box.left - 9) * canvas.width) / box.width);
          const y = Math.floor(((clientY - box.top) * canvas.height) / box.height);
          return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
        },
        { clientX: target.x, clientY: target.y },
      );
    const oldBorder = await border();
    await page.mouse.click(target.x, target.y);
    await expect(readout).toHaveText(`Frame 4 / ${f.p.duration}`);
    await expect.poll(border).not.toEqual(oldBorder);
    expect(await f.read()).toEqual(f.p);
    await f.timeline.press(action);
    const expected = structuredClone(f.p);
    expected.duration = at + 1;
    expected.layers[1].keys.push({
      frame: at,
      shapes: action === 'F7' ? [] : structuredClone(f.p.layers[1].keys.at(-1)!.shapes),
    });
    await expect.poll(f.read).toEqual(expected);
    await expect(readout).toHaveText(`Frame ${at + 1} / ${at + 1}`);
    await f.history(expected);
  });

test('a future click replaces an existing frame block selection without moving any keys', async ({
  page,
}) => {
  const f = await setup(page);
  const start = await f.point(f.p.duration - 1),
    end = await f.point(3),
    future = await f.point(await f.future());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  const readout = page.locator('.frame-readout');
  await expect(readout).toHaveText(`Frame 4 / ${f.p.duration}`);
  await page.mouse.click(future.x, future.y);
  await expect(readout).toHaveText(`Frame 4 / ${f.p.duration}`);
  expect(await f.read()).toEqual(f.p);
  await f.timeline.press('Escape');
  await f.timeline.press('F7');
  await expect
    .poll(async () => (await f.read()).layers[1].keys.find((k) => k.frame === 3)?.shapes)
    .toEqual([]);
  expect((await f.read()).duration).toBe(f.p.duration);
});

test('a drag can start past the scene duration and select multiple frames across layers', async ({ page }) => {
  const f = await setup(page);
  const end = f.p.duration, readout = page.locator('.frame-readout');
  const drag = async (from: number, to: number) => {
    const a = await f.point(from, 1), b = await f.point(to, 0);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  const shade = async (at: number, row: number) => f.timeline.evaluate((node, p) => {
    const c = node as HTMLCanvasElement;
    const box = c.getBoundingClientRect();
    const x = Math.floor((p.x - box.left + 3) * c.width / box.width);
    const y = Math.floor((p.y - box.top - 7) * c.height / box.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data);
  }, await f.point(at, row));
  const unselected = await shade(end + 3, 1);
  await drag(end + 1, end + 5);
  await expect.poll(() => shade(end + 3, 1)).not.toEqual(unselected);
  const selected = await shade(end + 3, 1);
  await expect(readout).toHaveText(`Frame 1 / ${end}`);
  for (const row of [0, 1]) await expect.poll(() => shade(end + 3, row)).toEqual(selected);
  await f.timeline.press('Control+x');
  await f.timeline.press('Shift+F5');
  expect(await f.read()).toEqual(f.p);
  await f.timeline.press('Escape');
  await expect.poll(() => shade(end + 3, 1)).toEqual(unselected);

  await drag(end + 3, end - 4);
  await expect(readout).toHaveText(`Frame ${end - 3} / ${end}`);
  for (const row of [0, 1]) {
    await expect.poll(() => shade(end + 1, row)).toEqual(selected);
    await expect.poll(() => shade(end - 2, row)).toEqual(selected);
  }
  expect(await f.read()).toEqual(f.p);
});
for (const live of [false, true])
  for (const action of [
    'Insert keyframe',
    'Convert to keyframe',
    'Insert blank keyframe',
    'Insert frame',
  ])
    test(`right-click ${action} extends to the far-right column, live=${live}, with exact history`, async ({
      page,
    }) => {
      const f = await setup(page, live),
        at = await f.future();
      expect(at).toBeGreaterThan(f.p.duration);
      await f.open(at);
      expect(await f.read()).toEqual(f.p);
      await expect(page.locator('.frame-readout')).toHaveText(`Frame 1 / ${f.p.duration}`);
      await page.getByRole('menuitem', { name: action, exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      const out = await f.read(),
        expected = structuredClone(f.p);
      expected.duration = at + 1;
      if (action !== 'Insert frame')
        expected.layers[1].keys.push({
          frame: at,
          shapes:
            action === 'Insert blank keyframe'
              ? []
              : structuredClone(f.p.layers[1].keys.at(-1)!.shapes),
        });
      if (live && (action === 'Insert keyframe' || action === 'Convert to keyframe')) {
        const continued = out.layers[1].liveMotionSpans!.at(-1)!;
        expect(continued).toEqual({ id: expect.any(String), start: 8, end: at, ease: 'linear' });
        expected.layers[1].liveMotionSpans!.push(continued);
      }
      expect(out).toEqual(expected);
      await expect(page.locator('.frame-readout')).toHaveText(`Frame ${at + 1} / ${at + 1}`);
      await expect
        .poll(f.pixel)
        .toEqual(action === 'Insert blank keyframe' ? [255, 255, 255, 255] : [255, 0, 0, 255]);
      await f.history(out);
    });
test('scrolling past the old duration exposes future columns and the inserted key survives reload', async ({
  page,
}) => {
  const f = await setup(page, true, true);
  await f.scroll.focus();
  await f.scroll.press('End');
  const at = await f.future();
  expect(at).toBeGreaterThan(f.p.duration);
  expect(await f.read()).toEqual(f.p);
  await f.open(at);
  await page.getByRole('menuitem', { name: 'Insert keyframe', exact: true }).click();
  const out = await f.read();
  expect(out.duration).toBe(at + 1);
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 8, at]);
  expect(out.layers[1].liveMotionSpans).toEqual([
    ...f.p.layers[1].liveMotionSpans!,
    { id: expect.any(String), start: 8, end: at, ease: 'linear' },
  ]);
  await f.history(out);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(out);
});

for (const kind of ['motion', 'shape'] as const)
  test(`extends ${kind} holds, continues with F6, and removes only the clicked tween`, async ({
    page,
  }) => {
    const f = await setup(page, true, false, false, kind);
    const action = (name: string) => page.getByRole('menuitem', { name, exact: true });
    const color = kind === 'motion' ? [96, 165, 250, 255] : [74, 222, 128, 255];
    const cellColor = (at: number) =>
      f.timeline.evaluate(
        (node: HTMLCanvasElement, at) =>
          Array.from(
            node
              .getContext('2d')!
              .getImageData((at * 18 + 4) * devicePixelRatio, 29 * devicePixelRatio, 1, 1).data,
          ),
        at,
      );
    await f.open(8);
    await action('Insert frame').click();
    const frame = await f.read();
    expect(frame.duration).toBe(f.p.duration + 1);
    expect(frame.layers).toEqual(f.p.layers);
    await expect.poll(() => cellColor(9)).toEqual(color);
    const at = await f.point(9);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('F6');
    const keyed = await f.read();
    expect(keyed.layers[1].keys.map((k) => k.frame)).toEqual([0, 8, 9]);
    expect(keyed.layers[1].liveMotionSpans![1]).toMatchObject({ start: 8, end: 9 });
    await expect.poll(() => cellColor(10)).toEqual(color);
    await f.open(10);
    await action(`Remove ${kind} tween`).click();
    const removed = await f.read();
    expect(removed.layers[1].keys).toEqual(keyed.layers[1].keys);
    expect(removed.layers[1].liveMotionSpans).toEqual(f.p.layers[1].liveMotionSpans);
    await expect.poll(() => cellColor(10)).not.toEqual(color);
    await f.timeline.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(keyed);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(removed);
    await f.open(9);
    await expect(action(`Remove ${kind} tween`)).toHaveCount(0);
  });

test('a plain authored key stops shape tween inheritance while holding its artwork', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, 'shape');
  await f.open(9);
  await page.getByRole('menuitem', { name: 'Insert plain keyframe', exact: true }).click();
  const out = await f.read();
  expect(out.layers[1].liveMotionSpans).toEqual(f.p.layers[1].liveMotionSpans);
  expect(out.layers[1].keys[2]).toEqual({ ...f.p.layers[1].keys[1], frame: 9 });
  await f.open(10);
  await expect(page.getByRole('menuitem', { name: 'Remove shape tween', exact: true })).toHaveCount(
    0,
  );
});
test('a future menu protects existing keys and cancellation leaves the project unchanged', async ({
  page,
}) => {
  const f = await setup(page),
    at = await f.future();
  await f.open(at);
  for (const name of [
    'Remove keyframes',
    'Copy frames',
    'Cut frames',
    'Convert to motion tween',
    'Convert to shape tween',
  ])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(f.p);
});
test('canceling a future menu and opening a locked layer never extend the project', async ({
  page,
}) => {
  const f = await setup(page, false, false, true),
    at = await f.future();
  await f.open(at);
  for (const name of [
    'Insert frame',
    'Insert keyframe',
    'Convert to keyframe',
    'Insert blank keyframe',
  ])
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(f.p);
});
for (const change of ['source', 'frame'] as const)
  test(`actual late ${change} changes after future-key preparation reject publication and permit a fresh retry`, async ({
    page,
  }) => {
    const f = await setup(page, true),
      at = await f.future();
    await f.open(at);
    await page.evaluate(
      ({ duration, change }) => {
        const clone = window.structuredClone;
        (window as unknown as { extendHook: number }).extendHook = 0;
        window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
          if (
            (value as Project)?.duration === duration &&
            !(window as unknown as { extendHook: number }).extendHook
          ) {
            (window as unknown as { extendHook: number }).extendHook++;
            if (change === 'source') {
              const i = document.querySelector<HTMLInputElement>('input[aria-label="Layer name"]')!;
              i.value = 'User edit';
              i.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              document.querySelector('[aria-label="Timeline frames"]')!.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'ArrowRight',
                  bubbles: true,
                  cancelable: true,
                }),
              );
            }
          }
          return clone(value, options);
        };
      },
      { duration: at + 1, change },
    );
    await page.getByRole('menuitem', { name: 'Insert keyframe', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { extendHook: number }).extendHook),
    ).toBe(1);
    const expected = structuredClone(f.p);
    if (change === 'source') expected.layers[1].name = 'User edit';
    expect(await f.read()).toEqual(expected);
    if (change === 'frame')
      await expect(page.locator('.frame-readout')).toHaveText(`Frame 2 / ${f.p.duration}`);
    await f.open(at);
    await page.getByRole('menuitem', { name: 'Insert keyframe', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await f.read()).duration).toBe(at + 1);
    await f.timeline.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(expected);
  });

for (const kind of ['motion', 'shape'] as const)
  for (const command of ['F5', 'context', 'menu'] as const)
    test(`${command} inserts time inside a ${kind} tween with exact sparse keys and history`, async ({
      page,
    }) => {
      const f = await setup(page, true, false, false, kind),
        at = 4;
      await f.open(at);
      await page.keyboard.press('Escape');
      if (command === 'F5') {
        await f.timeline.focus();
        await page.keyboard.press('F5');
      } else if (command === 'context') {
        await f.open(at);
        await expect(
          page.getByRole('menuitem', { name: 'Insert frame', exact: true }),
        ).toBeEnabled();
        await page.getByRole('menuitem', { name: 'Insert frame', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Insert', exact: true }).click();
        await page.getByRole('button', { name: 'Frame F5', exact: true }).click();
      }
      await expect(page.getByRole('alert')).toHaveCount(0);
      const out = await f.read(),
        expected = prepareTimelineFrameInsertion(f.p, 'track', at, 'frame');
      expect(out).toEqual(expected);
      expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 9]);
      expect(out.layers[1].liveMotionSpans![0].end).toBe(9);
      await expect(page.locator('.frame-readout')).toHaveText('Frame 5 / 13');
      // The retimed in-between is visible and neither endpoint was baked away.
      const pixels = await f.canvas.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let red = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] > 200 && d[i + 1] < 30 && d[i + 2] < 30 && d[i + 3] === 255) red++;
        return red;
      });
      expect(pixels).toBeGreaterThan(100);
      await f.history(out);
      await page.reload();
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      expect(await f.read()).toEqual(out);
    });

test('repeated F5 inside a motion tween extends its recipe without inventing keys, then F6 authors a pose', async ({
  page,
}) => {
  const f = await setup(page, true, false, false, 'motion');
  await f.open(4);
  await page.keyboard.press('Escape');
  await f.timeline.focus();
  let expected = f.p;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('F5');
    expected = prepareTimelineFrameInsertion(expected, 'track', 4, 'frame');
    await expect.poll(f.read).toEqual(expected);
  }
  expect(expected.layers[1].keys.map((k) => k.frame)).toEqual([0, 11]);
  await page.keyboard.press('F6');
  const out = await f.read();
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 4, 11]);
  expect(out.duration).toBe(15);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
});

for (const change of ['source', 'frame'] as const)
  test(`F5 rejects a real late ${change} edit after retimed recipes exist and permits a fresh retry`, async ({
    page,
  }) => {
    const f = await setup(page, true, false, false, 'motion');
    await f.open(4);
    await page.keyboard.press('Escape');
    await page.evaluate((change) => {
      const native = structuredClone;
      Object.assign(window, { sparseTimeHook: 0 });
      window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
        const q = value as Project,
          w = window as unknown as { sparseTimeHook: number };
        if (
          !w.sparseTimeHook &&
          q?.layers?.find((l) => l.id === 'track')?.liveMotionSpans?.[0]?.end === 9
        ) {
          w.sparseTimeHook++;
          const input = document.querySelector(
            `input[aria-label="${change === 'source' ? 'Layer name' : 'Go to frame'}"]`,
          ) as HTMLInputElement;
          input.value = change === 'source' ? 'User edit' : '2';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return native(value, options);
      };
    }, change);
    await f.timeline.focus();
    await page.keyboard.press('F5');
    expect(
      await page.evaluate(() => (window as unknown as { sparseTimeHook: number }).sparseTimeHook),
    ).toBe(1);
    const before = structuredClone(f.p);
    if (change === 'source') before.layers[1].name = 'User edit';
    expect(await f.read()).toEqual(before);
    await f.open(4);
    await page.keyboard.press('Escape');
    await f.timeline.focus();
    await page.keyboard.press('F5');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const out = await f.read();
    expect(out).toEqual(prepareTimelineFrameInsertion(before, 'track', 4, 'frame'));
    await f.timeline.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
  });
