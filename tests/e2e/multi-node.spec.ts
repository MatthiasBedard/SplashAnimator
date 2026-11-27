import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';
test('multiple anchors nudge together and undo restores the path', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  for (const [x, y] of [
    [300, 200],
    [430, 160],
    [550, 250],
    [600, 320],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Enter');
  await expect(page.locator('button.publish')).toBeEnabled();
  const before = await read();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await page.mouse.click(b.x + 300, b.y + 200);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 430, b.y + 160);
  await page.keyboard.up('Shift');
  await expect(page.getByText('2 anchors selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Smooth selected anchors', exact: true }).click();
  const smooth = await read();
  expect(smooth.nodes![0].out).toBeDefined();
  expect(smooth.nodes![1].in).toBeDefined();
  expect(smooth.nodes![2].in).toBeUndefined();
  for (let i = 0; i < 4; i++)
    expect(worldPoint(smooth, smooth.nodes![i])).toEqual(worldPoint(before, before.nodes![i]));
  await page.getByRole('button', { name: 'Corner selected anchors', exact: true }).click();
  expect((await read()).nodes![1].in).toBeUndefined();
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(smooth);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+a');
  await page.mouse.click(b.x + 300, b.y + 200);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 430, b.y + 160);
  await page.keyboard.up('Shift');
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('button.publish')).toBeEnabled();
  const after = await read();
  for (let i = 0; i < 4; i++)
    expect(
      worldPoint(after, after.nodes![i]).x - worldPoint(before, before.nodes![i]).x,
    ).toBeCloseTo(i < 2 ? 1 : 0);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

test('anchor marquee selects a subset and cancellation preserves it', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  for (const [x, y] of [
    [300, 200],
    [430, 160],
    [550, 250],
    [600, 320],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Enter');
  await expect(page.locator('button.publish')).toBeEnabled();
  const before = await read();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await page.mouse.move(b.x + 270, b.y + 130);
  await page.mouse.down();
  await page.mouse.move(b.x + 460, b.y + 220);
  await page.mouse.up();
  await expect(page.getByText('2 anchors selected', { exact: true })).toBeVisible();
  await page.mouse.move(b.x + 500, b.y + 220);
  await page.mouse.down();
  await page.mouse.move(b.x + 630, b.y + 350);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByText('2 anchors selected', { exact: true })).toBeVisible();
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('button.publish')).toBeEnabled();
  const after = await read();
  for (let i = 0; i < 4; i++)
    expect(
      worldPoint(after, after.nodes![i]).x - worldPoint(before, before.nodes![i]).x,
    ).toBeCloseTo(i < 2 ? 1 : 0);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

test('inserting an anchor selects the new node and undoes exactly', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes[0],
    );
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.move(b.x + 300, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 340, b.y + 150);
  await page.mouse.up();
  await page.mouse.click(b.x + 500, b.y + 300);
  await page.keyboard.press('Enter');
  await expect(page.locator('button.publish')).toBeEnabled();
  const before = await read();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await page.mouse.click(b.x + 300, b.y + 200);
  expect(await read()).toEqual(before);
  await page.getByLabel('Anchor insertion position').fill('30');
  await page.getByRole('button', { name: 'Insert anchor after selection', exact: true }).click();
  await expect(page.locator('button.publish')).toBeEnabled();
  const after = await read();
  expect(after.nodes).toHaveLength(3);
  expect(worldPoint(after, after.nodes![0])).toEqual(worldPoint(before, before.nodes![0]));
  expect(worldPoint(after, after.nodes![2])).toEqual(worldPoint(before, before.nodes![1]));
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('button.publish')).toBeEnabled();
  const moved = await read();
  expect(worldPoint(moved, moved.nodes![1]).x - worldPoint(after, after.nodes![1]).x).toBeCloseTo(
    1,
  );
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(after);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

test('Bezier path close, open and split are reversible', async ({ page }) => {
  await page.goto('/');
  const stage = page.getByLabel('Drawing stage'),
    b = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  for (const [x, y] of [
    [300, 200],
    [430, 160],
    [550, 250],
  ])
    await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.press('Enter');
  await expect(page.locator('button.publish')).toBeEnabled();
  const before = await read();
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  await page.mouse.click(b.x + 430, b.y + 160);
  await page.getByRole('button', { name: 'Close Bezier path', exact: true }).click();
  expect((await read())[0].closed).toBe(true);
  await page.getByRole('button', { name: 'Open Bezier path', exact: true }).click();
  expect((await read())[0].closed).toBe(false);
  await page.getByRole('button', { name: 'Split path at anchor', exact: true }).click();
  const pieces = await read();
  expect(pieces).toHaveLength(2);
  expect(pieces.map((s) => s.nodes!.length)).toEqual([2, 2]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Join Bezier endpoints', exact: true }).click();
  expect(await read()).toHaveLength(1);
  expect((await read())[0].nodes).toHaveLength(3);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(pieces);

  expect(worldPoint(pieces[0], pieces[0].nodes![1])).toEqual(
    worldPoint(pieces[1], pieces[1].nodes![0]),
  );
  await stage.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

for (const mode of ['object', 'merge'] as const)
  test(`compound ring insertion preserves curves, selection and undo in ${mode} mode`, async ({
    page,
  }) => {
    const p = newProject();
    p.layers[0].drawingMode = mode;
    p.layers[0].keys[0].shapes = [
      {
        id: 'compound',
        kind: 'polygon',
        x: 200,
        y: 120,
        width: 300,
        height: 280,
        rotation: 0,
        fill: '#cc2211',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
        fillRule: 'evenodd',
        contours: [
          [
            { x: 0, y: 0, out: { x: 100, y: -20 } },
            { x: 300, y: 0 },
            { x: 300, y: 280 },
            { x: 0, y: 280 },
          ],
          [
            { x: 80, y: 80, out: { x: 120, y: 60 } },
            { x: 220, y: 80 },
            { x: 220, y: 200 },
            { x: 80, y: 200, out: { x: 50, y: 150 } },
          ],
        ],
      },
    ];
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes' }).click();
    const stage = page.getByLabel('Drawing stage'),
      box = (await stage.boundingBox())!;
    const read = () =>
      page.evaluate(
        () =>
          (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
            .keys[0].shapes[0],
      );
    await stage.focus();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Subselection', exact: true }).click();
    const zoom = Number(
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue(),
    );
    await page.mouse.click(
      box.x + (box.width - p.width * zoom) / 2 + 280 * zoom,
      box.y + (box.height - p.height * zoom) / 2 + 320 * zoom,
    );
    await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
    await expect(page.locator('button.publish')).toBeEnabled();
    const before = await read();
    expect(before).toEqual(p.layers[0].keys[0].shapes[0]);
    await page.getByRole('button', { name: 'Insert anchor after selection', exact: true }).click();
    await expect.poll(async () => (await read()).contours![1].length).toBe(5);
    const inserted = await read();
    expect(inserted.contours![0]).toEqual(before.contours![0]);
    expect(inserted.contours![1][4].in).toBeDefined();
    await expect(page.getByText('1 anchors selected', { exact: true })).toBeVisible();
    if (mode === 'object') {
      await page.getByRole('button', { name: 'Corner selected anchors', exact: true }).click();
      expect((await read()).contours![1][4].in).toBeUndefined();
      await page.getByRole('button', { name: 'Smooth selected anchors', exact: true }).click();
      expect((await read()).contours![1][4].in).toBeDefined();
      await stage.focus();
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(inserted);
    }
    await stage.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(inserted);
  });

for (const paint of ['gradient', 'bitmap'] as const)
  for (const mode of ['object', 'merge'] as const)
    test(`affine ${paint} compound tangent drag preserves opposite length, paint and cancellation in ${mode}`, async ({
      page,
    }) => {
      const p = newProject();
      p.layers[0].drawingMode = mode;
      p.layers[0].keys[0].shapes = [
        {
          id: 'tangents',
          kind: 'polygon',
          x: 440,
          y: 170,
          width: 200,
          height: 200,
          rotation: 13,
          transform: [-1, 0.2, 0.3, 1.1],
          fill: '#ee2200',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
          fillRule: 'evenodd',
          contours: [
            [
              { x: 0, y: 0, in: { x: -20, y: 0 }, out: { x: 70, y: 0 } },
              { x: 200, y: 20 },
              { x: 180, y: 200 },
              { x: -30, y: 160 },
            ],
          ],
          gradient: {
            kind: 'linear',
            from: { x: 0, y: 10 },
            to: { x: 140, y: 150 },
            stops: [
              { offset: 0, color: '#ff0000' },
              { offset: 1, color: '#0000ff' },
            ],
          },
        },
      ];
      if (paint === 'bitmap') {
        const dataUrl = await page.evaluate(() => {
          const c = document.createElement('canvas');
          c.width = c.height = 2;
          const x = c.getContext('2d')!;
          x.fillStyle = '#ffaa00';
          x.fillRect(0, 0, 2, 2);
          return c.toDataURL();
        });
        p.assets = [
          {
            id: 'tile',
            path: 'assets/bitmaps/tile.json',
            bitmap: { name: 'tile', width: 2, height: 2, dataUrl },
          },
        ];
        const shape = p.layers[0].keys[0].shapes[0];
        delete shape.gradient;
        shape.bitmap = {
          assetId: 'tile',
          x: 7,
          y: 9,
          width: 30,
          height: 25,
          repeat: true,
          transform: [1, 0.2, 0.3, 0.8],
        };
      }
      await page.addInitScript(
        (p) =>
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project: p, folder: null, manifest: null }),
          ),
        p,
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes' }).click();
      const stage = page.getByLabel('Drawing stage'),
        box = (await stage.boundingBox())!;
      const read = () =>
        page.evaluate(
          () =>
            (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
              .keys[0].shapes[0],
        );
      const zoom = Number(
        await page.getByRole('combobox', { name: 'Zoom', exact: true }).inputValue(),
      );
      const screen = (q: { x: number; y: number }) => ({
        x: box.x + (box.width - p.width * zoom) / 2 + q.x * zoom,
        y: box.y + (box.height - p.height * zoom) / 2 + q.y * zoom,
      });
      await stage.focus();
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'Subselection', exact: true }).click();
      const before = await read(),
        base = before.contours![0][0],
        start = screen(worldPoint(before, base.out!)),
        anchor = worldPoint(before, base),
        old = worldPoint(before, base.in!);
      const drag = async () => {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 35, start.y + 30, { steps: 3 });
      };
      await drag();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect(await read()).toEqual(before);
      await stage.focus();
      await page.keyboard.press('Control+a');
      await drag();
      await page.mouse.up();
      await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(before));
      const after = await read(),
        node = after.contours![0][0],
        a = worldPoint(after, node.in!),
        b = worldPoint(after, node.out!);
      expect(Math.hypot(a.x - anchor.x, a.y - anchor.y)).toBeCloseTo(
        Math.hypot(old.x - anchor.x, old.y - anchor.y),
        6,
      );
      expect((a.x - anchor.x) * (b.y - anchor.y) - (a.y - anchor.y) * (b.x - anchor.x)).toBeCloseTo(
        0,
        6,
      );
      if (paint === 'gradient')
        for (const part of ['from', 'to'] as const) {
          const expected = worldPoint(before, before.gradient![part]),
            actual = worldPoint(after, after.gradient![part]);
          expect(actual.x).toBeCloseTo(expected.x, 7);
          expect(actual.y).toBeCloseTo(expected.y, 7);
        }
      if (paint === 'bitmap') {
        const expected = worldPoint(before, before.bitmap!),
          actual = worldPoint(after, after.bitmap!);
        expect(actual.x).toBeCloseTo(expected.x, 7);
        expect(actual.y).toBeCloseTo(expected.y, 7);
        expect({ ...after.bitmap, x: 0, y: 0 }).toEqual({ ...before.bitmap, x: 0, y: 0 });
      }
      await stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(before);
      await page.keyboard.press('Control+a');
      await page.keyboard.down('Alt');
      await drag();
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(before));
      const independent = await read(),
        kept = worldPoint(independent, independent.contours![0][0].in!);
      expect(kept.x).toBeCloseTo(old.x, 7);
      expect(kept.y).toBeCloseTo(old.y, 7);
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(before);
    });

for (const compatible of [true, false])
  test(`Bezier bitmap join preserves paint and history with compatible=${compatible}`, async ({
    page,
  }) => {
    await page.goto('/');
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      c.getContext('2d')!.fillRect(0, 0, 2, 2);
      return c.toDataURL();
    });
    const p = newProject();
    p.assets = [
      {
        id: 'tile',
        path: 'assets/bitmaps/tile.json',
        bitmap: { name: 'Tile', width: 2, height: 2, dataUrl },
      },
    ];
    p.layers[0].drawingMode = 'object';
    p.layers[0].keys[0].shapes = [0, 1].map((i) => ({
      id: `piece-${i}`,
      kind: 'bezier',
      x: 200 + 100 * i,
      y: 200,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 2,
      points: [],
      nodes: [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 0 },
      ],
      bitmap: {
        assetId: 'tile',
        x: -100 * i + (!compatible && i ? 10 : 0),
        y: 0,
        width: 20,
        height: 20,
        repeat: true,
      },
    }));
    await page.evaluate(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      p,
    );
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes' }).click();
    const recovery = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const before = await recovery();
    const stage = page.getByLabel('Drawing stage');
    await stage.focus();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Join Bezier endpoints', exact: true }).click();
    if (compatible) {
      await expect
        .poll(async () => JSON.parse((await recovery())!).project.layers[0].keys[0].shapes.length)
        .toBe(1);
      const joined = JSON.parse((await recovery())!).project.layers[0].keys[0].shapes[0];
      expect(joined.bitmap).toEqual(p.layers[0].keys[0].shapes[0].bitmap);
      expect(joined.nodes).toHaveLength(5);
      await stage.focus();
      await page.keyboard.press('Control+z');
      expect(JSON.parse((await recovery())!).project).toEqual(p);
    } else {
      await expect(
        page.getByText('Join requires matching paint and affine bases with coincident endpoints.', {
          exact: true,
        }),
      ).toBeVisible();
      expect(await recovery()).toBe(before);
    }
  });
