import { test, expect, type Page } from '@playwright/test';
import { newProject, newLayer, type Project, type Vector } from '../../packages/document/src';

test('external frame JSON inserts a complete timed layer block with fresh IDs and atomic history', async ({ page, context }) => {
  const p = newProject();
  p.duration = 16;
  p.layers = ['Untouched', 'Merge destination', 'Object destination', 'Merge source', 'Object source'].map(newLayer);
  p.layers[1].drawingMode = p.layers[3].drawingMode = 'merge';
  const shape = (id: string, x: number): Vector => ({
    id, kind: 'rectangle', x, y: 50, width: 25, height: 20, rotation: 0,
    fill: '#e04000', stroke: '#000000', strokeWidth: 0, points: [],
  });
  p.layers[4].keys = [{ frame: 0, shapes: [{ ...shape('object', 100), groups: ['source-group'] }] },
    { frame: 3, shapes: [] }, { frame: 4, shapes: [{ ...shape('object', 140), groups: ['source-group'] }] }];
  p.layers[3].keys = [{ frame: 0, shapes: [shape('merge', 200)] }, { frame: 3, shapes: [] },
    { frame: 4, shapes: [shape('merge', 220)] }];
  p.layers[2].keys = [{ frame: 0, shapes: [shape('held', 320)] }, { frame: 8, shapes: [] }];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const b = (await timeline.boundingBox())!;
  const x = (frame: number) => b.x + 18 * frame + 9;
  const y = (row: number) => b.y + 25 + 28 * row + 14;
  const action = async (name: 'Copy' | 'Insert', at: number, row: number) => {
    await page.mouse.click(x(at), y(row), { button: 'right' });
    await page.getByRole('menuitem', { name: name + ' Splash Frame JSON', exact: true }).click();
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.move(x(1), y(0));
  await page.mouse.down();
  await page.mouse.move(x(4), y(1), { steps: 5 });
  await page.mouse.up();
  await action('Copy', 2, 0);
  await expect(page.getByText('Copied Splash Frame JSON', { exact: true })).toBeVisible();
  const clipboard = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(clipboard).toMatchObject({ format: 'splash-frames-1', duration: 4, tracks: [
    { mode: 'object', keys: [{ frame: 0 }, { frame: 2, shapes: [] }, { frame: 3 }] },
    { mode: 'merge', keys: [{ frame: 0 }, { frame: 2, shapes: [] }, { frame: 3 }] },
  ] });
  expect(clipboard.tracks[0].keys[0].shapes).toEqual(p.layers[4].keys[0].shapes);
  expect(await read()).toEqual(p);
  clipboard.tracks[0].keys[0].shapes[0].fill = '#0040d0';
  await page.evaluate(text => navigator.clipboard.writeText(text), JSON.stringify(clipboard));
  await action('Insert', 6, 2);
  await expect(page.getByText('Inserted Splash Frame JSON', { exact: true })).toBeVisible();
  const pasted = await read();
  expect(pasted.duration).toBe(20);
  expect(pasted.layers.slice(3)).toEqual(p.layers.slice(3));
  expect(pasted.layers[0]).toEqual(p.layers[0]);
  const a = pasted.layers[2].keys, m = pasted.layers[1].keys;
  expect(a.map(k => k.frame)).toEqual([0, 6, 8, 9, 10, 12]);
  expect(m.map(k => k.frame)).toEqual([0, 6, 8, 9, 10]);
  expect(a[2].shapes).toEqual([]);
  expect(m[2].shapes).toEqual([]);
  expect(a[4].shapes).toEqual(p.layers[2].keys[0].shapes);
  expect(a[1].shapes[0]).toMatchObject({ fill: '#0040d0', x: 100 });
  expect(a[1].shapes[0].id).not.toBe('object');
  expect(a[1].shapes[0].id).toBe(a[3].shapes[0].id);
  expect(a[1].shapes[0].groups).toEqual(a[3].shapes[0].groups);
  expect(a[1].shapes[0].groups).not.toEqual(['source-group']);
  expect(m[1].shapes[0].id).not.toBe('merge');
  expect(m[1].shapes[0].id).toBe(m[3].shapes[0].id);
  await timeline.press('Control+z');
  await expect.poll(read).toEqual(p);
  await timeline.press('Control+Shift+z');
  await expect.poll(read).toEqual(pasted);
  const lock = page.getByRole('button', { name: 'Toggle lock Merge destination', exact: true });
  await lock.click();
  const locked = await read();
  await action('Insert', 7, 2);
  await expect(page.getByRole('alert')).toContainText('unlocked timeline layers');
  expect(await read()).toEqual(locked);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await timeline.press('Control+z');
  await expect.poll(read).toEqual(pasted);

  await page.evaluate(() => {
    const read = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.readText = async () => {
      const text = await read();
      await new Promise<void>(resolve => {
        document.documentElement.dataset.framesPending = 'true';
        document.addEventListener('release-frame-clipboard', () => resolve(), { once: true });
      });
      return text;
    };
  });
  await action('Insert', 7, 2);
  await expect(page.locator('html')).toHaveAttribute('data-frames-pending', 'true');
  await page.mouse.click(x(8), y(2));
  await page.evaluate(() => document.dispatchEvent(new Event('release-frame-clipboard')));
  await expect(page.getByRole('alert')).toContainText('frame paste destination changed');
  expect(await read()).toEqual(pasted);
});

async function recoverProject(page: Page) {
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
}

async function setup(page: Page, mergeTrack?: number, frameLabels?: Project['frameLabels'], blankTail = false) {
  const p = newProject();
  p.duration = 24;
  if (frameLabels) p.frameLabels = frameLabels;
  p.layers = Array.from({ length: 4 }, (_, i) => {
    const l = newLayer('Track ' + i);
    l.id = 'track' + i;
    if (i === mergeTrack) l.drawingMode = 'merge';
    l.keys = [0, 2, 4, 6, 8, 12].map((frame) => ({
      frame,
      shapes: [
        {
          id: `art${i}-${frame}`,
          kind: 'rectangle' as const,
          x: i * 40 + frame,
          y: 20,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    }));
    if (blankTail && i === 3) l.keys.push({ frame: 20, shapes: [] });
    return l;
  });
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await recoverProject(page);
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const point = async (frame: number, row: number) => {
    const b = (await timeline.boundingBox())!;
    return { x: b.x + frame * 18 + 9, y: b.y + 25 + row * 28 + 14 };
  };
  const drag = async (a: number, r: number, b: number, s: number) => {
    const from = await point(a, r),
      to = await point(b, s);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (f: number, row: number) =>
    timeline.evaluate(
      (node, { f, row }) => {
        const c = node as HTMLCanvasElement,
          r = c.getBoundingClientRect();
        return [
          ...c
            .getContext('2d')!
            .getImageData(
              Math.floor(((f * 18 + 2) * c.width) / r.width),
              Math.floor(((25 + row * 28 + 3) * c.height) / r.height),
              1,
              1,
            ).data,
        ];
      },
      { f, row },
    );
  return { p, timeline, point, drag, read, pixel };
}

test('stage frame labels stay at their times across frame moves, copies and duration edits', async ({ page }) => {
  const labels = [{ frame: 2, name: 'Source' }, { frame: 8, name: 'Destination' }, { frame: 18, name: 'Tail' }];
  const f = await setup(page, undefined, labels);
  const selectBlock = () => f.drag(2, 0, 5, 1);
  await selectBlock();
  await f.drag(3, 0, 9, 1);
  const moved = await f.read();
  expect(moved.layers[2].keys.find(key => key.frame === 8)?.shapes[0].x).toBe(122);
  expect(moved.frameLabels).toEqual(labels);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  await selectBlock();
  await f.timeline.press('Control+c');
  const destination = await f.point(14, 2);
  await page.mouse.click(destination.x, destination.y);
  await f.timeline.press('Control+v');
  const copied = await f.read();
  expect(copied.layers[1].keys.find(key => key.frame === 14)?.shapes[0].x).toBe(122);
  expect(copied.frameLabels).toEqual(labels);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);

  const duration = page.getByRole('spinbutton', { name: 'Frames', exact: true });
  await duration.fill('18');
  await duration.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Remove frame labels beyond the new duration first.');
  await expect(duration).toHaveValue('24');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await duration.fill('19');
  await duration.press('Tab');
  await expect.poll(f.read).toEqual({ ...f.p, duration: 19 });
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('frame label and comment dialogs support keyboard editing and return to the timeline', async ({ page }) => {
  const f = await setup(page);
  const open = async (kind: 'label' | 'comment') => {
    await f.timeline.press('Shift+F10');
    const item = page.getByRole('menuitem', { name: `Edit frame ${kind}…`, exact: true });
    for (let i = 0; i < 30 && !await item.evaluate(element => element === document.activeElement); i++) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    return page.getByRole('dialog', { name: `Edit frame ${kind}`, exact: true });
  };
  const label = await open('label');
  await expect(label.getByRole('textbox', { name: 'Frame label name', exact: true })).toBeFocused();
  await page.keyboard.insertText('Cancelled label');
  await page.keyboard.press('Shift+Tab');
  await expect(label.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(label.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(label).toHaveCount(0);
  await expect(f.timeline).toBeFocused();
  expect(await f.read()).toEqual(f.p);

  await open('label');
  await expect(label.getByRole('textbox')).toBeFocused();
  await page.keyboard.insertText('Start');
  await page.keyboard.press('Enter');
  await expect(f.timeline).toBeFocused();
  const labeled = { ...f.p, frameLabels: [{ frame: 0, name: 'Start' }] };
  expect(await f.read()).toEqual(labeled);

  const comment = await open('comment');
  await expect(comment.getByRole('textbox', { name: 'Frame comment text', exact: true })).toBeFocused();
  await page.keyboard.insertText('Hold the pose');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Then move left');
  await page.keyboard.press('Tab');
  await expect(comment.getByRole('button', { name: 'Save frame comment', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(f.timeline).toBeFocused();
  expect(await f.read()).toEqual({ ...labeled, frameComments: [{ frame: 0, text: 'Hold the pose\nThen move left' }] });
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(labeled);
});

test('scene frame comments survive layer edits, Undo and recovery', async ({ page }) => {
  const f = await setup(page);
  const contextAt = async (frame: number, item: string) => {
    const { x, y } = await f.point(frame, 0);
    await page.mouse.click(x, y, { button: 'right' });
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  const open = async (frame: number) => {
    await contextAt(frame, 'Edit frame comment…');
    return page.getByRole('dialog', { name: 'Edit frame comment', exact: true });
  };
  const text = 'Hold the pose\nThen move left';
  const dialog = await open(2);
  const field = dialog.getByRole('textbox', { name: 'Frame comment text' });
  await field.fill('  ');
  await dialog.getByRole('button', { name: 'Save frame comment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a comment');
  expect(await f.read()).toEqual(f.p);
  await field.fill(text);
  await dialog.getByRole('button', { name: 'Save frame comment' }).click();
  const comments = [{ frame: 2, text }], saved = { ...f.p, frameComments: comments };
  await expect.poll(f.read).toEqual(saved);
  const current = page.getByLabel('Current frame comment');
  await expect(current).toHaveAttribute('title', text);
  await expect.poll(() => f.timeline.evaluate((node: HTMLCanvasElement) => {
    const d = node.width / node.getBoundingClientRect().width;
    return Array.from(node.getContext('2d')!.getImageData(Math.floor(42 * d), Math.floor(3 * d), 1, 1).data);
  })).toEqual([112, 217, 239, 255]);

  const reopened = await open(2);
  await reopened.getByRole('textbox').fill('Revised');
  await reopened.getByRole('button', { name: 'Save frame comment' }).click();
  await expect(current).toHaveText('Revised');
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(saved);
  await (await open(2)).getByRole('button', { name: 'Remove frame comment' }).click();
  await expect(current).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(saved);

  await contextAt(2, 'Insert frame');
  const inserted = await f.read();
  expect(inserted.duration).toBeGreaterThan(saved.duration);
  expect(inserted.frameComments).toEqual(comments);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(saved);
  await contextAt(2, 'Remove keyframes');
  const removed = await f.read();
  expect(removed.layers[3].keys.some(key => key.frame === 2)).toBe(false);
  expect(removed.frameComments).toEqual(comments);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(saved);

  await f.drag(2, 0, 5, 1);
  await f.drag(3, 0, 9, 1);
  expect((await f.read()).layers[2].keys.find(key => key.frame === 8)?.shapes[0].x).toBe(122);
  expect((await f.read()).frameComments).toEqual(comments);
  await f.timeline.press('Control+z');
  await f.drag(2, 0, 5, 1);
  await f.timeline.press('Control+c');
  const destination = await f.point(14, 2);
  await page.mouse.click(destination.x, destination.y);
  await f.timeline.press('Control+v');
  expect((await f.read()).layers[1].keys.find(key => key.frame === 14)?.shapes[0].x).toBe(122);
  expect((await f.read()).frameComments).toEqual(comments);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(saved);

  const tail = await open(18);
  await tail.getByRole('textbox').fill('Final cue');
  await tail.getByRole('button', { name: 'Save frame comment' }).click();
  const duration = page.getByRole('spinbutton', { name: 'Frames', exact: true });
  await duration.fill('18');
  await duration.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Remove frame comments beyond the new duration first.');
  await expect(duration).toHaveValue('24');
  expect((await f.read()).frameComments).toEqual([...comments, { frame: 18, text: 'Final cue' }]);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await duration.fill('19');
  await duration.press('Tab');
  expect((await f.read()).duration).toBe(19);
  expect((await f.read()).frameComments?.at(-1)).toEqual({ frame: 18, text: 'Final cue' });
  await f.timeline.press('Control+z');
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(saved);

  const recoveryPage = await page.context().newPage();
  await recoverProject(recoveryPage);
  const restored = recoveryPage.getByLabel('Timeline frames', { exact: true });
  await restored.click({ position: { x: 44, y: 40 } });
  await expect(recoveryPage.getByLabel('Current frame comment')).toHaveAttribute('title', text);
  await recoveryPage.close();
});

test('stage frame label text crosses holds and stops at the next artwork keyframe', async ({ page }) => {
  const f = await setup(page, undefined, [{ frame: 2, name: 'MMMMMMMMMMMMMMMMMMMM' }]);
  const goldPixels = (left: number, top: number, width: number, height: number) => f.timeline.evaluate(
    (canvas: HTMLCanvasElement, { left, top, width, height }) => {
      const data = canvas.getContext('2d')!.getImageData(left, top, width, height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 220 && data[i + 1] > 175 && data[i + 2] < 150) count++;
      }
      return count;
    },
    { left, top, width, height },
  );
  await expect.poll(() => goldPixels(54, 14, 18, 11)).toBeGreaterThan(0);
  expect(await goldPixels(72, 14, 18, 11)).toBe(0);
  expect(await goldPixels(37, 45, 1, 6)).toBe(6);
  expect(await goldPixels(55, 45, 1, 6)).toBe(0);
});

test('stage frame labels display, reject duplicate names, recover, rename and undo removal', async ({ page }) => {
  const f = await setup(page);
  const open = async (frame: number) => {
    const p = await f.point(frame, 0);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit frame label…', exact: true }).click();
    return page.getByRole('dialog', { name: 'Edit frame label', exact: true });
  };
  const save = async (frame: number, name: string) => {
    const dialog = await open(frame);
    await dialog.getByLabel('Frame label name').fill(name);
    await dialog.getByRole('button', { name: 'Save frame label' }).click();
    return dialog;
  };
  const current = page.getByLabel('Current frame label', { exact: true });
  const original = await save(2, 'Reveal');
  await expect(original).toHaveCount(0);
  await expect(current).toHaveText('Reveal');
  const added = { ...f.p, frameLabels: [{ frame: 2, name: 'Reveal' }] };
  expect(await f.read()).toEqual(added);
  expect(await f.timeline.evaluate((node: HTMLCanvasElement) =>
    Array.from(node.getContext('2d')!.getImageData(37, 47, 1, 1).data)))
    .toEqual([255, 210, 119, 255]);
  const duplicate = await save(4, 'Reveal');
  await expect(duplicate.getByRole('alert')).toContainText('unique');
  expect(await f.read()).toEqual(added);
  await duplicate.getByRole('button', { name: 'Cancel', exact: true }).click();
  await save(2, 'Reveal motion');
  const renamed = { ...f.p, frameLabels: [{ frame: 2, name: 'Reveal motion' }] };
  await expect(current).toHaveText('Reveal motion');
  expect(await f.read()).toEqual(renamed);
  const dialog = await open(2);
  await dialog.getByRole('button', { name: 'Remove frame label' }).click();
  await expect(current).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(renamed);
  // Use a fresh page in the same storage context to avoid a fixture reseed on reload.
  const recovered = await page.context().newPage();
  await recoverProject(recovered);
  await recovered.getByLabel('Timeline frames', { exact: true }).click({ position: { x: 45, y: 40 } });
  await expect(recovered.getByLabel('Current frame label', { exact: true })).toHaveText('Reveal motion');
  await recovered.close();
});

for (const mergeTrack of [2, 3]) {
  test(`frame drag crosses drawing modes with Merge Drawing on track ${mergeTrack}`, async ({ page }) => {
    const f = await setup(page, mergeTrack);
    await f.drag(2, 0, 2, 0);
    await f.drag(2, 0, 4, 1);
    const out = await f.read();
    const expected = structuredClone(f.p);
    const key = expected.layers[3].keys.splice(1, 1)[0];
    const received = out.layers[2].keys.find(key => key.frame === 4)!;
    expect(received.shapes[0].id).not.toBe(key.shapes[0].id);
    key.frame = 4;
    key.shapes[0].id = received.shapes[0].id;
    expected.layers[2].keys[2] = key;
    expect(out).toEqual(expected);
    await f.timeline.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.timeline.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out);
  });
}

test('first drag selects a rectangular block without edits, second drag moves it across overlapping layers with one Undo', async ({
  page,
}) => {
  const f = await setup(page);
  const unselected = await f.pixel(5, 1);
  await f.drag(2, 0, 5, 1);
  await expect(f.timeline).toHaveAccessibleDescription(/Frames 3 to 6 selected across 2 layers\./);
  await expect(f.timeline).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Frames 3 to 6 selected across 2 layers.' })).toHaveAttribute('aria-live', 'polite');
  expect(await f.read()).toEqual(f.p);
  await expect.poll(() => f.pixel(5, 1)).not.toEqual(unselected);
  const selected = await f.pixel(5, 1);
  for (const row of [0, 1])
    for (const frame of [2, 5]) expect(await f.pixel(frame, row)).toEqual(selected);
  await f.drag(3, 0, 9, 1);
  const out = await f.read();
  expect(out).not.toEqual(f.p);
  // Display rows are top-to-bottom: track3/track2 move to track2/track1.
  expect(out.layers[2].keys.find((k) => k.frame === 8)!.shapes[0].x).toBe(122);
  expect(out.layers[1].keys.find((k) => k.frame === 8)!.shapes[0].x).toBe(82);
  expect(out.layers[0]).toEqual(f.p.layers[0]);
  expect(out.duration).toBe(f.p.duration);
  expect(out.layers[3].keys).toEqual(
    f.p.layers[3].keys.filter((k) => k.frame !== 2 && k.frame !== 4),
  );
  expect(out.layers[2].keys.map((k) => k.frame)).toEqual([0, 6, 8, 10, 12]);
  expect(out.layers[1].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 8, 10, 12]);
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  await f.timeline.press('Home');
  await expect(f.timeline).not.toHaveAccessibleDescription(/selected across/);
});
test('keyboard layer navigation replaces the old block before a keyframe edit', async ({ page }) => {
  const f = await setup(page);
  await f.drag(2, 0, 6, 1);
  await expect(f.timeline).toHaveAccessibleDescription(/Frames 3 to 7 selected across 2 layers\./);
  await f.timeline.press('ArrowDown');
  await f.timeline.press('ArrowDown');
  await expect(f.timeline).toHaveAccessibleDescription(/Frame 7 of 24\. Layer Track 1\./);
  await expect(f.timeline).not.toHaveAccessibleDescription(/selected across/);
  expect(await f.read()).toEqual(f.p);

  await f.timeline.press('Shift+F6');
  const expected = structuredClone(f.p);
  expected.layers[1].keys = expected.layers[1].keys.filter(key => key.frame !== 6);
  await expect.poll(f.read).toEqual(expected);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('Escape dismisses a completed timeline range without moving the playhead or editing keys', async ({ page }) => {
  const f = await setup(page);
  await f.drag(2, 0, 6, 1);
  await expect(f.timeline).toHaveAccessibleDescription(/Frames 3 to 7 selected across 2 layers/);
  await f.timeline.press('Escape');
  await expect(f.timeline).toBeFocused();
  await expect(f.timeline).toHaveAccessibleDescription(/Frame 7 of 24\. Layer Track 3\./);
  await expect(f.timeline).not.toHaveAccessibleDescription(/ selected across /);
  expect(await f.read()).toEqual(f.p);
  await f.timeline.press('Shift+F6');
  const expected = structuredClone(f.p);
  expected.layers[3].keys = expected.layers[3].keys.filter(key => key.frame !== 6);
  await expect.poll(f.read).toEqual(expected);
  await f.timeline.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('multi-layer Copy and Paste route the whole block to the clicked destination rows', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 1);
  await f.timeline.focus();
  await page.keyboard.press('Control+c');
  expect(await f.read()).toEqual(f.p);
  const dest = await f.point(14, 2);
  await page.mouse.click(dest.x, dest.y);
  await page.keyboard.press('Control+v');
  const out = await f.read();
  expect(out.layers[1].keys.find((k) => k.frame === 14)!.shapes[0].x).toBe(122);
  expect(out.layers[0].keys.find((k) => k.frame === 14)!.shapes[0].x).toBe(82);
  expect(out.layers[3]).toEqual(f.p.layers[3]);
  expect(out.layers[2]).toEqual(f.p.layers[2]);
});
for (const command of ['Shift+F5', 'context menu'] as const) {
  test(`${command} shortens the timeline after deleting trailing blank frames`, async ({ page }) => {
    const f = await setup(page, undefined, undefined, true);
    await f.drag(20, 0, 23, 0);
    if (command === 'Shift+F5') await f.timeline.press(command);
    else {
      const point = await f.point(22, 0);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete frames', exact: true }).click();
    }

    const expected = structuredClone(f.p);
    expected.duration = 20;
    expected.layers[3].keys.pop();
    await expect.poll(f.read).toEqual(expected);
    await expect(page.getByText(/Frame 20\s*\/\s*20/)).toBeVisible();
    await f.timeline.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.timeline.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected);

    const last = await f.point(19, 0);
    await page.mouse.click(last.x, last.y);
    await f.timeline.press('F5');
    await expect.poll(async () => (await f.read()).duration).toBe(21);
    const added = await f.point(20, 0);
    await page.mouse.click(added.x, added.y);
    await f.timeline.press('Shift+F5');
    await expect.poll(f.read).toEqual(expected);
  });

  test(`${command} deletes the selected frame block and closes the gap on both tracks`, async ({ page }) => {
    const f = await setup(page);
    await f.drag(2, 0, 5, 1);
    if (command === 'Shift+F5') await f.timeline.press(command);
    else {
      const point = await f.point(3, 1);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete frames', exact: true }).click();
    }
    const expected = structuredClone(f.p);
    for (const track of expected.layers.slice(2)) {
      track.keys = track.keys.filter(key => key.frame < 2 || key.frame > 5)
        .map(key => ({ ...key, frame: key.frame > 5 ? key.frame - 4 : key.frame }));
      track.keys.push({ frame: expected.duration - 4, shapes: [] });
    }
    await expect.poll(f.read).toEqual(expected);
    await f.timeline.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.timeline.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected);
  });
}
test('multi-layer context Cut preserves the selected rectangle and can paste all its tracks', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 1);
  const point = await f.point(3, 1);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Cut frames', exact: true }).click();
  const cut = await f.read();
  expect(cut.layers[3].keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  expect(cut.layers[2].keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  const dest = await f.point(14, 2);
  await page.mouse.click(dest.x, dest.y);
  await f.timeline.focus();
  await page.keyboard.press('Control+v');
  const out = await f.read();
  expect(out.layers[1].keys.find((k) => k.frame === 14)!.shapes[0].x).toBe(122);
});
for (const command of ['Shift+F6', 'context menu'] as const) {
  test(`${command} removes keyframes across selected layers without moving later keys`, async ({ page }) => {
    const f = await setup(page);
    await f.drag(0, 0, 5, 1);
    if (command === 'Shift+F6') await f.timeline.press(command);
    else {
      const point = await f.point(3, 1);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByRole('menuitem', { name: 'Remove keyframes', exact: true }).click();
    }
    const expected = structuredClone(f.p);
    for (const track of expected.layers.slice(2))
      track.keys = track.keys.filter(key => key.frame === 0 || key.frame > 5);
    await expect.poll(f.read).toEqual(expected);
    await f.timeline.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await f.timeline.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected);
  });
}
test('modifier dragging copies a selected block; Escape cancels an initial marquee without writes', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 1);
  await page.keyboard.down('Alt');
  await f.drag(3, 0, 11, 2);
  await page.keyboard.up('Alt');
  const out = await f.read();
  expect(out.layers[3]).toEqual(f.p.layers[3]);
  expect(out.layers[2]).toEqual(f.p.layers[2]);
  expect(out.layers[1].keys.find((k) => k.frame === 10)!.shapes[0].x).toBe(122);
  const from = await f.point(18, 0),
    to = await f.point(20, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(out);
});

test('history changes during a block drag cannot move stale frames', async ({ page }) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 1);
  const from = await f.point(3, 0),
    to = await f.point(9, 1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.getByLabel('Layer name', { exact: true }).evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = 'User layer edit';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.mouse.up();
  const expected = structuredClone(f.p);
  expected.layers[3].name = 'User layer edit';
  expect(await f.read()).toEqual(expected);
});
test('Escape restores the previous frame rectangle and releases native pointer capture', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 1);
  const selected = await f.pixel(2, 0);
  const from = await f.point(14, 0),
    to = await f.point(18, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.pixel(2, 0)).toEqual(selected);
  expect(await f.pixel(5, 1)).toEqual(selected);
  expect(await f.read()).toEqual(f.p);
  expect(await f.timeline.evaluate((n) => n.hasPointerCapture(1))).toBe(false);
});

test('same-layer block movement retains artwork identities without source or destination boundary keys', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 0);
  await f.drag(3, 0, 9, 0);
  const out = await f.read();
  expect(out.layers[3].keys.find((k) => k.frame === 8)!.shapes[0].id).toBe('art3-2');
  expect(out.layers[3].keys.map((k) => k.frame)).toEqual([0, 6, 8, 10, 12]);
  expect(out.layers[2]).toEqual(f.p.layers[2]);
  expect(out.duration).toBe(f.p.duration);
});

test('moving a single keyframe adds no source blank or destination restoration key', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 2, 0);
  await f.drag(2, 0, 9, 0);
  const out = await f.read();
  expect(out.layers[3].keys).toEqual(
    [
      ...f.p.layers[3].keys.filter((k) => k.frame !== 2),
      { ...f.p.layers[3].keys.find((k) => k.frame === 2)!, frame: 9 },
    ].sort((a, b) => a.frame - b.frame),
  );
  expect(out.duration).toBe(f.p.duration);
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('dropping onto existing keyframes replaces them without inserting or shifting any outside keys', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 2, 0);
  await f.drag(2, 0, 8, 0);
  const out = await f.read();
  expect(out.layers[3].keys).toEqual(
    [
      ...f.p.layers[3].keys.filter((k) => k.frame !== 2 && k.frame !== 8),
      { ...f.p.layers[3].keys.find((k) => k.frame === 2)!, frame: 8 },
    ].sort((a, b) => a.frame - b.frame),
  );
  expect(out.duration).toBe(f.p.duration);
  expect(out.layers.slice(0, 3)).toEqual(f.p.layers.slice(0, 3));
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
});

test('moving the first frame adds only the required blank frame zero', async ({ page }) => {
  const f = await setup(page);
  await f.drag(0, 0, 0, 0);
  await f.drag(0, 0, 9, 0);
  const out = await f.read();
  expect(out.layers[3].keys).toEqual(
    [
      { frame: 0, shapes: [] },
      ...f.p.layers[3].keys.slice(1),
      { ...f.p.layers[3].keys[0], frame: 9 },
    ].sort((a, b) => a.frame - b.frame),
  );
  expect(out.duration).toBe(f.p.duration);
  await f.timeline.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('moving overlapping rows at the same time reads original keys and creates no padding', async ({
  page,
}) => {
  const f = await setup(page);
  await f.drag(2, 0, 5, 1);
  await f.drag(3, 0, 3, 1);
  const out = await f.read();
  expect(out.layers[3].keys.map((k) => k.frame)).toEqual([0, 6, 8, 12]);
  for (const row of [1, 2])
    expect(out.layers[row].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 8, 12]);
  expect(out.layers[2].keys[1].shapes[0].x).toBe(122);
  expect(out.layers[1].keys[1].shapes[0].x).toBe(82);
  expect(out.duration).toBe(f.p.duration);
});

test('dragging held cells does not manufacture keyframes', async ({ page }) => {
  const f = await setup(page);
  await f.drag(3, 0, 3, 0);
  await f.drag(3, 0, 9, 0);
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Escape releases frame selection and movement captures while preserving the previous block', async ({ page }) => {
  const f = await setup(page);
  const unselected = await f.pixel(2, 0);
  await f.drag(2, 0, 5, 1);
  await expect.poll(() => f.pixel(2, 0)).not.toEqual(unselected);
  const selected = await f.pixel(2, 0);
  async function cancel(from: [number, number], to: [number, number]) {
    const a = await f.point(...from), b = await f.point(...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    expect(await f.timeline.evaluate(node => node.hasPointerCapture(1))).toBe(true);
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.keyboard.press('Escape');
    expect(await f.timeline.evaluate(node => node.hasPointerCapture(1))).toBe(false);
    await page.mouse.up();
    await expect.poll(() => f.pixel(2, 0)).toEqual(selected);
    await expect.poll(() => f.pixel(5, 1)).toEqual(selected);
    expect(await f.read()).toEqual(f.p);
  }
  await cancel([6, 2], [8, 3]);
  await cancel([3, 0], [9, 1]);
  await f.drag(3, 0, 9, 1);
  await expect.poll(async () => (await f.read()).layers[2].keys.some(k => k.frame === 8 && k.shapes[0]?.x === 122)).toBe(true);
  await f.timeline.press('Control+z');
  expect(await f.read()).toEqual(f.p);
});
