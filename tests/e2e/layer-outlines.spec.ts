import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newProject, newLayer, validateProject, type Project } from '../../packages/document/src';
import { liveRotationFixture } from '../live-motion-rotation-fixture';

function fixture() {
  const p = newProject();
  p.width = 300;
  p.height = 240;
  p.layers[0].name = 'Ink';
  p.layers[0].keys[0].shapes = [
    {
      id: 'red',
      kind: 'rectangle',
      x: 40,
      y: 40,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const other = newLayer('Other');
  other.keys[0].shapes = [
    {
      id: 'blue',
      kind: 'ellipse',
      x: 180,
      y: 40,
      width: 70,
      height: 70,
      rotation: 0,
      fill: '#0000ff',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  p.layers.push(other);
  return p;
}
async function setup(page: Page, p = fixture()) {
  validateProject(p);
  await page.addInitScript(
    (p) =>
      !localStorage.getItem('splash-recovery-v1') &&
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  const splash = page.getByRole('button', { name: 'Open editor', exact: true });
  const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
  await expect(splash.or(recover)).toBeVisible();
  if (await splash.isVisible()) await splash.click();
  await recover.click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixels = () =>
    canvas.evaluate((n, p) => {
      const c = n as HTMLCanvasElement,
        ctx = c.getContext('2d')!,
        d = devicePixelRatio;
      return [
        [80, 80],
        [40, 80],
        [210, 70],
      ].map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.round(c.width / 2 + (x - p.width / 2) * d),
            Math.round(c.height / 2 + (y - p.height / 2) * d),
            1,
            1,
          ).data,
        ),
      );
    }, p);
  return { canvas, read, pixels };
}
async function properties(page: Page, name = 'Ink') {
  await page
    .getByRole('group', { name: 'Layer row ' + name, exact: true })
    .locator('button.layer-name')
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Layer properties…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Layer properties', exact: true });
}

test('layer icons align in Outline, Hide, Lock order and preserve toggle behavior', async ({page}) => {
  const f = await setup(page);
  const headers = page.locator('.layer-option-headings > span');
  expect(await headers.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')))).toEqual(['Outline','Hide','Lock']);
  const row = page.getByRole('group',{name:'Layer row Ink',exact:true});
  const buttons = row.locator('button.layer-option');
  expect(await buttons.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')))).toEqual(['Toggle outline Ink','Toggle visibility Ink','Toggle lock Ink']);
  for (let i=0;i<3;i++) {
    const heading=(await headers.nth(i).boundingBox())!, button=(await buttons.nth(i).boundingBox())!;
    expect(Math.abs(heading.x+heading.width/2-button.x-button.width/2)).toBeLessThan(1);
    await expect(buttons.nth(i).locator('svg')).toHaveCount(1);
  }
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('aria-pressed','true');
  await buttons.nth(1).click();
  await buttons.nth(2).click();
  const ink=(await f.read()).layers.find(l=>l.name==='Ink')!;
  expect([ink.outline,ink.visible,ink.locked]).toEqual([true,false,true]);
});

test('outline column shows only that layer contours and supports Undo, Redo and reopen', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p);
  await expect.poll(f.pixels).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  await page.getByRole('button', { name: 'Toggle outline Ink', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Toggle outline Ink', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => {
      const v = await f.pixels();
      return [v[0], v[2]];
    })
    .toEqual([
      [255, 255, 255, 255],
      [0, 0, 255, 255],
    ]);
  const out = await f.read();
  expect(out.layers[0].keys).toEqual(p.layers[0].keys);
  expect(out.layers[0].outline).toBe(true);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(out);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Toggle outline Ink', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('layer properties contain keyboard focus and return to the edited layer', async ({ page }) => {
  const original = fixture();
  const f = await setup(page, original);
  const layer = (name: string) => page.getByRole('group', { name: `Layer row ${name}`, exact: true }).locator('button.layer-name');
  await page.getByRole('group', { name: 'Layer row Other', exact: true }).locator('button.layer-name').click();
  const dialog = page.getByRole('dialog', { name: 'Layer properties', exact: true });
  const open = async () => {
    await layer('Ink').press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Layer properties…', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog.getByLabel('Layer properties name', { exact: true })).toBeFocused();
  };
  await open();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('Discarded name');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('combobox', { name: 'Layer properties type' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(layer('Ink')).toBeFocused();
  expect(await f.read()).toEqual(original);

  await open();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('Keyboard Ink');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  await expect(dialog.getByRole('checkbox', { name: 'Layer properties outline' })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Apply layer properties' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(layer('Keyboard Ink')).toBeFocused();
  const edited = structuredClone(original);
  Object.assign(edited.layers[0], { name: 'Keyboard Ink', outline: true });
  expect(await f.read()).toEqual(edited);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(original);
});

test('right-click properties apply name, visibility, lock, outline and color as one reversible edit', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p),
    dialog = await properties(page);
  await dialog.getByLabel('Layer properties name', { exact: true }).fill('Contours');
  await dialog.getByLabel('Layer properties outline', { exact: true }).check();
  await dialog.getByLabel('Layer properties locked', { exact: true }).check();
  await dialog.getByLabel('Layer outline color', { exact: true }).fill('#00ff00');
  await dialog.getByRole('button', { name: 'Apply layer properties', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const expected = structuredClone(p);
  Object.assign(expected.layers[0], {
    name: 'Contours',
    locked: true,
    outline: true,
    outlineColor: '#00ff00',
  });
  await expect.poll(f.read).toEqual(expected);
  await expect
    .poll(() =>
      f.canvas.evaluate((n) => {
        const c = n as HTMLCanvasElement,
          d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let green = 0,
          red = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 1] > 200 && d[i + 1] > d[i] + 20 && d[i + 1] > d[i + 2] + 20) green++;
          if (d[i] > 200 && d[i + 1] === 0 && d[i + 2] === 0) red++;
        }
        return { green: green > 100, red };
      }),
    )
    .toEqual({ green: true, red: 0 });
  await f.canvas.screenshot({ path: 'test-results/layer-outlines-stage.png' });
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  const second = await properties(page, 'Contours');
  await second.getByLabel('Layer properties visible', { exact: true }).uncheck();
  await second.getByRole('button', { name: 'Apply layer properties', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Toggle visibility Contours', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('properties Cancel and unchanged Apply preserve omitted defaults and source', async ({
  page,
}) => {
  const p = fixture(),
    f = await setup(page, p),
    dialog = await properties(page);
  await dialog.getByLabel('Layer outline color', { exact: true }).fill('#ff00ff');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await f.read()).toEqual(p);
  const second = await properties(page);
  await second.getByRole('button', { name: 'Apply layer properties', exact: true }).click();
  expect(await f.read()).toEqual(p);
});

test('outline authoring view does not replace exported PNG artwork', async ({ page }) => {
  const p = fixture();
  p.layers[0].outline = true;
  p.layers[0].outlineColor = '#00ff00';
  const f = await setup(page, p);
  await expect.poll(async () => (await f.pixels())[0]).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await downloading).path())!);
  const pixel = await page.evaluate(async (encoded) => {
    const image = await createImageBitmap(
      new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: 'image/png' }),
    );
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    image.close();
    return Array.from(ctx.getImageData(80, 80, 1, 1).data);
  }, bytes.toString('base64'));
  expect(pixel).toEqual([255, 0, 0, 255]);
  expect(await f.read()).toEqual(p);
});

test('live tween authoring respects outline mode without changing saved motion', async ({
  page,
}) => {
  const { p } = liveRotationFixture();
  p.layers[0].name = 'Tween';
  const f = await setup(page, p);
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Toggle outline Tween', exact: true }).click();
  await expect
    .poll(() =>
      f.canvas.evaluate((n) => {
        const c = n as HTMLCanvasElement,
          d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let cyan = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] === 0 && d[i + 1] > 80 && d[i + 2] > 80) cyan++;
        return cyan;
      }),
    )
    .toBeGreaterThan(10);
  const expected = structuredClone(p);
  expected.layers[0].outline = true;
  await expect.poll(f.read).toEqual(expected);
});

for (const kind of ['brush', 'bezier', 'polygon', 'text', 'bitmap', 'reflected'] as const)
  test(`outline display preserves ${kind} geometry and original paint`, async ({ page }) => {
    const p = fixture(),
      s = p.layers[0].keys[0].shapes[0];
    p.layers[0].outline = true;
    p.layers[0].outlineColor = '#ff00ff';
    if (kind === 'brush') {
      s.kind = 'brush';
      s.points = [
        { x: 0, y: 50, pressure: 0.5 },
        { x: 100, y: 50, pressure: 1 },
      ];
      s.strokeWidth = 20;
      s.brush = { pressure: true, tilt: false, minimum: 0.35, aspect: 1, angle: 0 };
    }
    if (kind === 'bezier') {
      s.kind = 'bezier';
      s.closed = true;
      s.nodes = [
        { x: 0, y: 0, out: { x: 50, y: -20 } },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
    }
    if (kind === 'polygon') {
      s.kind = 'polygon';
      s.fillRule = 'evenodd';
      s.points = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ];
      s.contours = [
        [
          { x: 20, y: 20 },
          { x: 20, y: 60 },
          { x: 60, y: 60 },
          { x: 60, y: 20 },
        ],
      ];
    }
    if (kind === 'text') {
      s.kind = 'text';
      s.text = {
        content: 'Outline',
        font: 'Arial',
        size: 30,
        bold: false,
        italic: false,
        align: 'left',
      };
    }
    if (kind === 'reflected') s.transform = [-1, 0.25, 0.5, 1];
    if (kind === 'bitmap') {
      const dataUrl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 4;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 4, 4);
        return c.toDataURL('image/png');
      });
      p.assets.push({
        id: 'image',
        path: 'assets/bitmaps/image.json',
        bitmap: { name: 'Image', width: 4, height: 4, dataUrl },
      });
      s.bitmap = { assetId: 'image', x: 0, y: 0, width: 100, height: 100 };
    }
    const f = await setup(page, p);
    await expect
      .poll(() =>
        f.canvas.evaluate((n) => {
          const c = n as HTMLCanvasElement,
            d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let magenta = 0,
            red = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 200 && d[i + 1] < 230 && d[i + 2] > 200) magenta++;
            if (d[i] > 200 && d[i + 1] === 0 && d[i + 2] === 0) red++;
          }
          return { magenta: magenta > 20, red };
        }),
      )
      .toEqual({ magenta: true, red: 0 });
    if (kind === 'brush') {
      const interior = await f.canvas.evaluate((n, p) => {
        const c = n as HTMLCanvasElement;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(c.width / 2 + (80 - p.width / 2) * devicePixelRatio),
              Math.round(c.height / 2 + (90 - p.height / 2) * devicePixelRatio),
              1,
              1,
            ).data,
        );
      }, p);
      expect(interior).toEqual([255, 255, 255, 255]);
    }
    expect((await f.read()).layers[0].keys).toEqual(p.layers[0].keys);
    await page.getByRole('button', { name: 'Toggle outline Ink', exact: true }).click();
    const expected = structuredClone(p);
    expected.layers[0].outline = false;
    await expect.poll(f.read).toEqual(expected);
  });
