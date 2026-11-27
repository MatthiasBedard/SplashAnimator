import { test, expect, type Page } from '@playwright/test';
import { type Project, newLayer } from '../../packages/document/src';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { prepareTimelineTween } from '../../apps/editor/src/timeline-tween';
import { prepareTimelineKeyframe } from '../../apps/editor/src/timeline-keyframe';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';

async function setup(page: Page, kind: 'motion' | 'shape' = 'motion', middle = false, two = false, destinations = false, rememberedSecond = false, mergeDestination = false) {
  let p = liveSplitFixture();
  delete p.layers[0].liveMotionSpans;
  p.layers[0].drawingMode = 'object';
  p = prepareTimelineTween(p, 'track', {
    start: 0,
    end: 8,
    kind,
    symbolize: kind === 'motion',
    affine: false,
    createEndpoints: false,
    ease: 'linear',
  });
  if (middle) p = prepareTimelineKeyframe(p, 'track', 4);
  if (two) {
    const l = structuredClone(p.layers[0]);
    l.id = 'other';
    l.name = 'Other';
    if (rememberedSecond) {
      delete l.liveMotionSpans;
      l.keys = liveSplitFixture().layers[0].keys;
    }
    p.layers.push(l);
    if (rememberedSecond) createBasicMotionSpan(p, [l.id], 0, 8, 'linear');
  } else {
    const l = newLayer('Untouched');
    l.locked = true;
    p.layers.unshift(l);
  }
  if (destinations) {
    p.duration = 14;
    const occupied = structuredClone(p.layers[0]);
    occupied.id = 'occupied';
    occupied.name = 'Occupied tween';
    occupied.keys = [{ frame: 0, shapes: [] }, ...occupied.keys.slice(0, 2).map(key => ({ ...key, frame: key.frame + 2 })), { frame: 11, shapes: [] }];
    occupied.liveMotionSpans = occupied.liveMotionSpans!.map(span => ({ ...span, start: span.start + 2, end: span.end + 2 }));
    const plain = newLayer('Occupied keys');
    plain.id = 'plain';
    plain.keys.push({ frame: 2, shapes: [] }, { frame: 12, shapes: [] });
    p.layers.unshift(plain, occupied);
  } else if (mergeDestination) {
    const plain = newLayer('Merge Drawing');
    plain.id = 'plain';
    plain.drawingMode = 'merge';
    p.layers.unshift(plain);
  }
  await page.addInitScript((p) => {
    if (sessionStorage.getItem('live-frame-move-seeded')) return;
    sessionStorage.setItem('live-frame-move-seeded', '1');
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    canvas = page.getByLabel('Drawing stage', { exact: true });
  const point = async (frame: number, row = 0) => {
    const b = (await timeline.boundingBox())!;
    return { x: b.x + frame * 18 + 9, y: b.y + 25 + row * 28 + 14 };
  };
  const drag = async (from: number, to: number, row = 0, endRow = row) => {
    const a = await point(from, row),
      b = await point(to, endRow);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  const seek = async (at: number) => {
    const q = await point(at);
    await page.mouse.click(q.x, q.y);
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (c: HTMLCanvasElement, { x, y }) =>
        Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (x - 80) * devicePixelRatio),
              Math.round(c.height / 2 + (y - 50) * devicePixelRatio),
              1,
              1,
            ).data,
        ),
      { x, y },
    );
  const history = async (out: Project) => {
    await timeline.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(out);
  };
  return { p, timeline, canvas, point, drag, seek, read, pixel, history };
}
test('moves a complete live tween block across two layers and replaces occupied destinations', async ({ page }) => {
  const f = await setup(page, 'motion', false, true, true);
  await f.drag(0, 8, 0, 1);
  expect(await f.read()).toEqual(f.p);
  await f.drag(0, 2, 0, 2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(out.duration).toBe(f.p.duration);
  expect(out.symbols).toEqual(f.p.symbols);
  for (const layer of out.layers.slice(2)) {
    expect(layer.liveMotionSpans).toBeUndefined();
    expect(layer.keys).toEqual([{ frame: 0, shapes: [] }, { frame: 10, shapes: [] }]);
  }
  for (const [i, layer] of out.layers.slice(0, 2).entries()) {
    const source = f.p.layers[i + 2];
    expect(layer.keys.map(key => key.frame)).toEqual([0, 2, 10, i ? 11 : 12]);
    expect(layer.keys.at(-1)).toEqual(f.p.layers[i].keys.at(-1));
    expect(layer.liveMotionSpans).toEqual([{ ...source.liveMotionSpans![0], start: 2, end: 10 }]);
    expect(layer.keys[1].shapes[0].id).toBe(layer.keys[2].shapes[0].id);
    expect(layer.keys[1].shapes[0].id).not.toBe(source.keys[0].shapes[0].id);
  }
  await f.seek(6);
  await expect.poll(() => f.pixel(55, 20)).toEqual([255, 0, 0, 255]);
  await f.history(out);
});
test('moves part of a motion tween onto an ordinary Merge Drawing layer', async ({ page }) => {
  const f = await setup(page, 'motion', false, true, false, false, true);
  await f.drag(2, 4, 1);
  await f.drag(2, 4, 1, 2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  const [target, source] = out.layers;
  expect(target.drawingMode).toBe('object');
  expect(out.layers[2]).toEqual(f.p.layers[2]);
  expect(source.keys.some(key => key.frame >= 2 && key.frame <= 4)).toBe(false);
  expect(source.liveMotionSpans).toEqual([expect.objectContaining({ start: 5, end: 8 })]);
  expect(target.liveMotionSpans).toEqual([expect.objectContaining({ start: 4, end: 6 })]);
  expect(target.keys.map(key => key.frame)).toEqual([0, 4, 6]);
  await f.history(out);
});
test('Alt-drag copies a complete live and remembered tween block across rows', async ({ page }) => {
  const f = await setup(page, 'motion', false, true, true, true);
  await f.drag(0, 8, 0, 1);
  const copy = async (at: number) => {
    await page.keyboard.down('Alt');
    try { await f.drag(0, at, 0, 2); }
    finally { await page.keyboard.up('Alt'); }
  };
  await copy(4);
  await expect(page.getByRole('alert')).toContainText('part of a live tween');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await copy(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(out.duration).toBe(f.p.duration);
  expect(out.symbols).toEqual(f.p.symbols);
  expect(out.layers.slice(2)).toEqual(f.p.layers.slice(2));
  for (const [i, layer] of out.layers.slice(0, 2).entries()) {
    const original = f.p.layers[i + 2];
    expect(layer.keys.map(key => key.frame)).toEqual(i ? [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 2, 10, 12]);
    expect(layer.keys.at(-1)).toEqual(f.p.layers[i].keys.at(-1));
    if (original.liveMotionSpans) {
      const span = layer.liveMotionSpans![0];
      expect(span).toEqual({ ...original.liveMotionSpans![0], id: span.id, start: 2, end: 10 });
      expect(span.id).not.toBe(original.liveMotionSpans![0].id);
    } else {
      const span = layer.motionSpans![0];
      expect(span).toEqual({ ...original.motionSpans![0], id: span.id, start: 2, end: 10, baseline: span.baseline });
      expect(span.id).not.toBe(original.motionSpans![0].id);
      expect(JSON.parse(span.baseline)).toEqual(layer.keys.slice(2, -2));
    }
    expect(layer.keys[1].shapes[0].id).toBe(layer.keys.at(-2)!.shapes[0].id);
    expect(layer.keys[1].shapes[0].id).not.toBe(original.keys[0].shapes[0].id);
  }
  await f.seek(6);
  await expect.poll(() => f.pixel(55, 20)).toEqual([255, 0, 0, 255]);
  await f.history(out);
});
test('internal Copy Cut and Paste preserve animated frame blocks and undo each edit', async ({ page }) => {
  const f = await setup(page, 'motion', false, true, true, true);
  const select = () => f.drag(0, 8, 0, 1);
  const pasteAt = async (at: number) => {
    const point = await f.point(at, 2);
    await page.mouse.click(point.x, point.y);
    await f.timeline.press('Control+v');
  };
  await select();
  await f.timeline.press('Control+c');
  expect(await f.read()).toEqual(f.p);
  await pasteAt(4);
  await expect(page.getByRole('alert')).toContainText('part of a live tween');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await pasteAt(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const copied = await f.read();
  expect(copied.layers.slice(2)).toEqual(f.p.layers.slice(2));
  expect(copied.duration).toBe(f.p.duration);
  expect(copied.layers[0].liveMotionSpans?.[0]).toMatchObject({ start: 2, end: 10 });
  expect(copied.layers[1].motionSpans?.[0]).toMatchObject({ start: 2, end: 10 });
  expect(copied.layers[0].keys.map(key => key.frame)).toEqual([0, 2, 10, 12]);
  expect(copied.layers[1].keys.map(key => key.frame)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await select();
  await f.timeline.press('Control+x');
  const cut = await f.read();
  expect(cut.layers.slice(0, 2)).toEqual(f.p.layers.slice(0, 2));
  for (const layer of cut.layers.slice(2)) {
    expect(layer.keys).toEqual([{ frame: 0, shapes: [] }, { frame: 10, shapes: [] }]);
    expect(layer.liveMotionSpans).toBeUndefined();
    expect(layer.motionSpans).toBeUndefined();
  }
  await pasteAt(2);
  const pasted = await f.read();
  expect(pasted.layers.slice(2)).toEqual(cut.layers.slice(2));
  expect(pasted.duration).toBe(f.p.duration);
  expect(pasted.layers[0].liveMotionSpans?.[0]?.id).not.toBe(copied.layers[0].liveMotionSpans?.[0]?.id);
  expect(pasted.layers[1].motionSpans?.[0]?.start).toBe(2);
  await f.seek(6);
  await expect.poll(() => f.pixel(55, 20)).toEqual([255, 0, 0, 255]);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(cut);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.timeline.press('Control+Shift+z');
  await f.timeline.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(pasted);
});
test('retains the moved frame selection for another drag and recovers the sparse animation after reload', async ({
  page,
}) => {
  const f = await setup(page);
  await f.seek(8);
  await f.drag(8, 6);
  const first = await f.read();
  await f.drag(6, 4);
  const second = await f.read();
  expect(second.layers[1].keys.map((k) => k.frame)).toEqual([0, 4, 10]);
  expect(second.layers[1].liveMotionSpans![0].end).toBe(4);
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(first);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(second);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  expect(await f.read()).toEqual(second);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await f.seek(2);
  await expect.poll(() => f.pixel(55, 20)).toEqual([255, 0, 0, 255]);
});
test('moving past an unselected outside key rejects without edits and permits an endpoint replacement retry', async ({
  page,
}) => {
  const f = await setup(page);
  await f.seek(8);
  await f.drag(8, 11);
  await expect(page.getByRole('alert')).toContainText('cross another keyframe');
  expect(await f.read()).toEqual(f.p);
  await f.seek(8);
  await f.drag(8, 10);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 10]);
  expect(out.layers[1].keys[1].shapes).toEqual(f.p.layers[1].keys[1].shapes);
  expect(out.layers[1].liveMotionSpans![0].end).toBe(10);
  await f.history(out);
});
for (const kind of ['motion', 'shape'] as const) {
  test(`${kind} tween endpoint moves with native drag, pixels and exact history`, async ({
    page,
  }) => {
    const f = await setup(page, kind),
      track = f.p.layers[1];
    await f.seek(8);
    await f.drag(8, 6);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const out = await f.read(),
      layer = out.layers[1];
    expect(layer.keys.map((k) => k.frame)).toEqual([0, 6, 10]);
    expect(layer.keys).toEqual(track.keys.map((k) => (k.frame === 8 ? { ...k, frame: 6 } : k)));
    expect(layer.liveMotionSpans).toEqual([{ ...track.liveMotionSpans![0], end: 6 }]);
    expect(out.layers[0]).toEqual(f.p.layers[0]);
    expect(out.symbols).toEqual(f.p.symbols);
    await f.seek(3);
    await expect.poll(() => f.pixel(55, 20)).toEqual([255, 0, 0, 255]);
    await f.history(out);
  });
  test(`${kind} sampled cell becomes its original pose key and moves without losing the tween`, async ({
    page,
  }) => {
    const f = await setup(page, kind);
    await f.seek(3);
    await f.drag(3, 5);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const out = await f.read(),
      layer = out.layers[1];
    expect(layer.keys.map((k) => k.frame)).toEqual([0, 5, 8, 10]);
    expect(layer.keys[1].shapes[0].x).toBe(38);
    expect(layer.liveMotionSpans!.map((s) => [s.start, s.end])).toEqual([
      [0, 5],
      [5, 8],
    ]);
    expect(layer.keys.filter((k) => k.frame !== 5)).toEqual(f.p.layers[1].keys);
    expect(out.symbols).toEqual(f.p.symbols);
    await expect.poll(() => f.pixel(45, 20)).toEqual([255, 0, 0, 255]);
    await f.history(out);
  });
  test(`${kind} shared endpoint replaces the destination key without adding padding frames`, async ({
    page,
  }) => {
    const f = await setup(page, kind, true);
    await f.seek(4);
    await f.drag(4, 8);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const out = await f.read(),
      layer = out.layers[1];
    expect(layer.keys).toEqual(
      f.p.layers[1].keys
        .filter((k) => k.frame !== 8)
        .map((k) => (k.frame === 4 ? { ...k, frame: 8 } : k)),
    );
    expect(layer.liveMotionSpans).toEqual([{ ...f.p.layers[1].liveMotionSpans![0], end: 8 }]);
    await expect.poll(() => f.pixel(55, 20)).toEqual([255, 0, 0, 255]);
    await f.history(out);
  });
}
test('moves both selected tween tracks together with exact replacement and one Undo', async ({
  page,
}) => {
  const f = await setup(page, 'motion', false, true);
  await f.drag(8, 8, 0, 1);
  expect(await f.read()).toEqual(f.p);
  await f.drag(8, 6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  for (const [i, l] of out.layers.entries()) {
    expect(l.keys).toEqual(f.p.layers[i].keys.map((k) => (k.frame === 8 ? { ...k, frame: 6 } : k)));
    expect(l.liveMotionSpans).toEqual([{ ...f.p.layers[i].liveMotionSpans![0], end: 6 }]);
  }
  await f.history(out);
});
test('the existing Drag selected frames mode also moves a live key instead of hitting clipboard ownership guards', async ({
  page,
}) => {
  const f = await setup(page);
  await f.seek(8);
  await page.getByLabel('Drag selected frames', { exact: true }).check();
  await f.drag(8, 6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(out.layers[1].keys).toEqual(
    f.p.layers[1].keys.map((k) => (k.frame === 8 ? { ...k, frame: 6 } : k)),
  );
  expect(out.layers[1].liveMotionSpans).toEqual([{ ...f.p.layers[1].liveMotionSpans![0], end: 6 }]);
  await f.history(out);
});
test('cancels native tween-key movement without edits and rejects a source edit during capture', async ({
  page,
}) => {
  const f = await setup(page);
  await f.seek(8);
  const a = await f.point(8),
    b = await f.point(6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(f.p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.getByLabel('Layer name', { exact: true }).evaluate((n) => {
    const i = n as HTMLInputElement;
    i.value = 'User edit';
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.mouse.up();
  const expected = structuredClone(f.p);
  expected.layers[1].name = 'User edit';
  expect(await f.read()).toEqual(expected);
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});
test('source edit after the complete moved candidate exists rejects stale publication and permits a retry', async ({
  page,
}) => {
  const f = await setup(page);
  await f.seek(8);
  await page.evaluate(() => {
    const clone = window.structuredClone;
    (window as unknown as { moveHook: number }).moveHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const p = value as Project;
      if (
        p?.layers?.some((l) => l.liveMotionSpans?.some((s) => s.end === 6)) &&
        !(window as unknown as { moveHook: number }).moveHook
      ) {
        (window as unknown as { moveHook: number }).moveHook++;
        const i = document.querySelector('input[aria-label="Layer name"]') as HTMLInputElement;
        i.value = 'Late source edit';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return clone(value, options);
    };
  });
  await f.drag(8, 6);
  expect(await page.evaluate(() => (window as unknown as { moveHook: number }).moveHook)).toBe(1);
  const expected = structuredClone(f.p);
  expected.layers[1].name = 'Late source edit';
  expect(await f.read()).toEqual(expected);
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.seek(8);
  await f.drag(8, 6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await f.read()).layers[1].liveMotionSpans![0].end).toBe(6);
});
test('a real frame change after detached movement rejects stale publication without creating history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.seek(8);
  await page.evaluate(() => {
    const clone = window.structuredClone;
    (window as unknown as { contextHook: number }).contextHook = 0;
    window.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
      const p = value as Project;
      if (
        p?.layers?.some((l) => l.liveMotionSpans?.some((s) => s.end === 6)) &&
        !(window as unknown as { contextHook: number }).contextHook
      ) {
        (window as unknown as { contextHook: number }).contextHook++;
        const i = document.querySelector('input[aria-label="Go to frame"]') as HTMLInputElement;
        i.value = '3';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return clone(value, options);
    };
  });
  await f.drag(8, 6);
  expect(
    await page.evaluate(() => (window as unknown as { contextHook: number }).contextHook),
  ).toBe(1);
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('3');
  expect(await f.read()).toEqual(f.p);
  await f.seek(8);
  await f.drag(8, 6);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const out = await f.read();
  expect(out.layers[1].liveMotionSpans![0].end).toBe(6);
  await f.history(out);
});
