import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { editSymbolBasicMotionSpan } from '../../packages/animation/src/motion-spans';
import { generateMotionFrames } from '../../packages/animation/src/motion-frames';
import { hit, worldPoint } from '../../packages/geometry/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { test, expect, type Page } from '@playwright/test';
import { newProject, symbolLayers, type SymbolDefinition, type Project } from '../../packages/document/src';
import { convertToSymbol, symbolInstance } from '../../packages/geometry/src/symbols';
import { exportHTML } from '../../packages/export-web/src';
async function closeStaticLibraryProperties(page:Page){const close=page.getByRole('button',{name:'Close library properties',exact:true});if(await close.isVisible())await close.click();}
async function openStaticLibraryProperties(page:Page,name:string){
  await closeStaticLibraryProperties(page);
  await page.getByRole('option',{name:'Library item '+name,exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Properties…',exact:true}).click();
}
async function openStaticLibraryArtwork(page:Page,name:string){
  await page.getByRole('option',{name:'Library item '+name,exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
}
async function openLibraryTimelineTools(page: Page, name: string) {
  await page.getByRole('dialog', { name: 'Symbol timeline', exact: true }).waitFor({ state: 'hidden' });
  const tools = page.getByRole('button', { name: 'Timeline tools…', exact: true });
  if (!(await tools.isVisible())) {
    await page.getByRole('option', { name: 'Library item ' + name, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  }
  await tools.click();
}
async function applyLibraryTimelineTools(page: Page) {
  await page.getByRole('dialog', { name: 'Symbol timeline', exact: true })
    .getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
}

test('movie clips advance with the root paused and export across root loops', async ({ page }) => {
  const p = newProject();
  p.duration = 2;
  p.fps = 10;
  p.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const instance = convertToSymbol(p, p.layers[0].id, 0, ['art'], 'Movie');
  instance.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  p.symbols![0].timeline = {
    duration: 3,
    keys: [{ frame: 2, shapes: [{ ...p.symbols![0].shapes[0], fill: '#0000ff' }] }],
  };
  await page.addInitScript((p) => {
    localStorage.setItem(
      'splash-recovery-v1',
      JSON.stringify({ project: p, folder: null, manifest: null }),
    );
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
  const pixel = async () => {
    const png = (await preview.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(
        ctx.getImageData((125 * image.width) / 960, (120 * image.height) / 540, 1, 1).data,
      );
    }, png);
  };
  await expect.poll(pixel, { intervals: [20] }).toEqual([0, 0, 255, 255]);
  await expect.poll(pixel, { intervals: [20] }).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  const rootTrack = page.getByLabel('Timeline frames');
  await rootTrack.focus();
  await rootTrack.press('Home');
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect
    .poll(() => page.locator('.frame-readout').textContent(), { intervals: [20] })
    .toContain('Frame 2');
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  const output = await page.context().newPage();
  await output.evaluate(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await output.setContent(exportHTML(p));
  await expect
    .poll(() =>
      output.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
    )
    .toBe('function');
  for (const [time, color] of [
    [0, [255, 0, 0, 255]],
    [100, [255, 0, 0, 255]],
    [200, [0, 0, 255, 255]],
    [300, [255, 0, 0, 255]],
  ] as const) {
    await output.evaluate(
      (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
      time,
    );
    expect(
      await output
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 120, 1, 1).data),
        ),
    ).toEqual(color);
  }
  await output.close();
  p.duration = 6;
  p.layers[0].keys = [
    p.layers[0].keys[0],
    { frame: 2, shapes: [] },
    { frame: 4, shapes: structuredClone(p.layers[0].keys[0].shapes) },
  ];
  const stalled = await page.context().newPage();
  await stalled.evaluate(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await stalled.setContent(exportHTML(p));
  await expect
    .poll(() =>
      stalled.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
    )
    .toBe('function');
  for (const [time, color] of [
    [0, [255, 0, 0, 255]],
    [500, [255, 0, 0, 255]],
    [1700, [255, 0, 0, 255]],
    [1800, [0, 0, 255, 255]],
  ] as const) {
    await stalled.evaluate(
      (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
      time,
    );
    expect(
      await stalled
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 120, 1, 1).data),
        ),
    ).toEqual(color);
  }
  await stalled.close();
});
test('symbol library converts, places, exports and breaks apart linked static instances with undo', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [
    {
      id: 'red',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (x: number, y: number) =>
    stage.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      { x: (box.width - 960) / 2 + x, y: (box.height - 540) / 2 + y },
    );
  await stage.focus();
  await page.keyboard.press('Control+a');
  await page.getByLabel('New library item',{exact:true}).click();
  await page.getByLabel('New symbol name').fill('Badge');
  await page.getByRole('button', { name: 'Convert selection to symbol', exact: true }).click();
  let current = await read();
  expect(current.symbols).toHaveLength(1);
  expect(current.layers[0].keys[0].shapes[0].kind).toBe('symbol');
  await expect.poll(() => pixel(130, 125)).toEqual([255, 0, 0, 255]);
  const converted = current;
  const library = page.getByRole('group', { name: 'Symbol Badge', exact: true });
  await openStaticLibraryProperties(page,'Badge');
  await expect(library.getByRole('button', { name: 'Remove symbol', exact: true })).toBeDisabled();
  await library.getByRole('button', { name: 'Place symbol', exact: true }).click();
  await closeStaticLibraryProperties(page);
  current = await read();
  expect(current.layers[0].keys[0].shapes).toHaveLength(2);
  expect(new Set(current.layers[0].keys[0].shapes.map((s) => s.symbolId)).size).toBe(1);
  await expect.poll(() => pixel(460, 255)).toEqual([255, 0, 0, 255]);
  const downloadPromise = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const download = await downloadPromise;
  const files = await readWebDownload(download),
    exported = await page.context().newPage();
  await openWebExport(exported, files);
  await expect
    .poll(() =>
      exported
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(480, 270, 1, 1).data),
        ),
    )
    .toEqual([255, 0, 0, 255]);
  await exported.close();
  const placed = await read();
  await page.getByRole('button', { name: 'Break apart symbol', exact: true }).click();
  expect((await read()).layers[0].keys[0].shapes.map((s) => s.kind)).toEqual([
    'symbol',
    'rectangle',
  ]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(placed);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(converted);
  await page.keyboard.press('Control+z');
  expect((await read()).layers[0].keys[0].shapes).toEqual(p.layers[0].keys[0].shapes);
  expect((await read()).symbols).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(converted);
  await openStaticLibraryArtwork(page,'Badge');
  let editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await editor.getByLabel('Symbol artwork x', { exact: true }).fill('10');
  await editor.getByLabel('Symbol artwork opacity', { exact: true }).fill('0.5');
  await editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await editor.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  expect(await read()).toEqual(converted);
  await expect
    .poll(() =>
      editor
        .getByLabel('Symbol artwork preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
        ),
    )
    .toEqual([127, 127, 255, 255]);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  expect(await read()).toEqual(converted);
  await openStaticLibraryArtwork(page,'Badge');
  editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const edited = await read();
  expect(edited.layers).toEqual(converted.layers);
  await expect.poll(() => pixel(130, 125)).toEqual([0, 0, 255, 255]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(converted);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(edited);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('symbol timeline edits keys, previews loops, scrubs stage and exports frame-exact graphic animation', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 20;
  p.duration = 8;
  p.layers[0].keys[0].shapes = [
    {
      id: 'red',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  convertToSymbol(p, p.layers[0].id, 0, ['red'], 'Loop');
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Loop', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await timeline.getByLabel('Symbol duration', { exact: true }).fill('4');
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('3');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Insert symbol keyframe', exact: true }).click();
  await timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await read()).toEqual(p);
  await expect
    .poll(() =>
      timeline
        .getByLabel('Symbol timeline preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
        ),
    )
    .toEqual([0, 0, 255, 255]);
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('4');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Insert blank symbol keyframe', exact: true }).click();
  await expect
    .poll(() =>
      timeline
        .getByLabel('Symbol timeline preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
        ),
    )
    .toEqual([255, 255, 255, 255]);
  await timeline.getByRole('button', { name: 'Remove symbol keyframe', exact: true }).click();
  await timeline.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect
    .poll(
      () =>
        timeline
          .getByLabel('Symbol timeline preview')
          .evaluate((c) =>
            Array.from(
              (c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data,
            ),
          ),
      { intervals: [30] },
    )
    .toEqual([255, 0, 0, 255]);
  await timeline.getByRole('button', { name: 'Stop symbol preview', exact: true }).click();
  await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const animated = await read();
  expect(animated.symbols![0].timeline?.keys[0].frame).toBe(2);
  await page
    .getByRole('group', { name: 'Symbol Loop', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await timeline.getByLabel('Symbol duration', { exact: true }).fill('8');
  await timeline.getByLabel('Symbol duration', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await read()).toEqual(animated);
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const pixel = () =>
    stage.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      { x: (box.width - 960) / 2 + 125, y: (box.height - 540) / 2 + 120 },
    );
  const track = page.getByLabel('Timeline frames');
  await track.focus();
  await track.press('ArrowRight');
  await track.press('ArrowRight');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await track.press('ArrowRight');
  await track.press('ArrowRight');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  const output = await page.context().newPage();
  await output.evaluate(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await output.setContent(exportHTML(animated));
  await expect
    .poll(() =>
      output.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
    )
    .toBe('function');
  for (const [time, color] of [
    [0, [255, 0, 0, 255]],
    [100, [0, 0, 255, 255]],
    [200, [255, 0, 0, 255]],
  ] as const) {
    await output.evaluate(
      (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
      time,
    );
    expect(
      await output
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 120, 1, 1).data),
        ),
    ).toEqual(color);
  }
  await output.close();
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(animated);
  await stage.click({
    position: { x: (box.width - 960) / 2 + 125, y: (box.height - 540) / 2 + 120 },
  });
  await page.getByLabel('Symbol playback', { exact: true }).selectOption('single');
  await page.getByLabel('Symbol first frame', { exact: true }).fill('3');
  await page.getByLabel('Symbol first frame', { exact: true }).press('Tab');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  const single = await read();
  expect(single.layers[0].keys[0].shapes[0].symbolPlayback).toEqual({
    mode: 'single',
    firstFrame: 2,
  });
  await stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(single);
  const frozen = await page.context().newPage();
  await frozen.setContent(exportHTML(single));
  await expect
    .poll(() =>
      frozen
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 120, 1, 1).data),
        ),
    )
    .toEqual([0, 0, 255, 255]);
  await frozen.close();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('shared artwork replacement respects unique instances and undoes without touching source art', async ({
  page,
}) => {
  const p = newProject(),
    layer = p.layers[0];
  layer.drawingMode = 'object';
  layer.keys[0].shapes = [
    {
      id: 'red',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const first = convertToSymbol(p, layer.id, 0, ['red'], 'Badge');
  layer.keys[0].shapes.push(symbolInstance(p.symbols![0], 300, 100), {
    id: 'blue',
    kind: 'rectangle',
    x: 600,
    y: 100,
    width: 100,
    height: 80,
    rotation: 0,
    fill: '#0000ff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const pos = (x: number, y: number) => ({
    x: (box.width - 960) / 2 + x,
    y: (box.height - 540) / 2 + y,
  });
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (x: number, y: number) =>
    stage.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      pos(x, y),
    );
  await stage.click({ position: pos(125, 120) });
  await page.getByRole('button', { name: 'Make instance unique', exact: true }).click();
  const unique = await read();
  expect(unique.symbols).toHaveLength(2);
  expect(unique.layers[0].keys[0].shapes[0].symbolId).not.toBe(first.symbolId);
  await stage.click({ position: pos(625, 120) });
  await openStaticLibraryProperties(page,'Badge');
  await page
    .getByRole('group', { name: 'Symbol Badge', exact: true })
    .getByRole('button', { name: 'Replace artwork from selection', exact: true })
    .click();
  await closeStaticLibraryProperties(page);
  const replaced = await read();
  expect(replaced.layers).toEqual(unique.layers);
  await expect.poll(() => pixel(325, 120)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(125, 120)).toEqual([255, 0, 0, 255]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(unique);
  await expect.poll(() => pixel(325, 120)).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(replaced);
  await openStaticLibraryProperties(page,'Badge');
  await page
    .getByRole('group', { name: 'Symbol Badge', exact: true })
    .getByRole('button', { name: 'Duplicate symbol', exact: true })
    .click();
  expect((await read()).symbols).toHaveLength(3);
  await closeStaticLibraryProperties(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('symbol frames author new artwork with stacking, duplication, deletion and isolated undo', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  convertToSymbol(p, p.layers[0].id, 0, ['art'], 'Author');
  p.symbols![0].timeline = { duration: 3, keys: [{ frame: 1, shapes: [] }] };
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const library = page.getByRole('group', { name: 'Symbol Author', exact: true });
  await library.getByRole('button', { name: 'Edit symbol timeline', exact: true }).click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('2');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const click = (name: string) => editor.getByRole('button', { name, exact: true }).click();
  const items = editor.getByLabel('Symbol artwork item').locator('option');
  const pixel = () =>
    editor
      .getByLabel('Symbol artwork preview')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
      );
  await expect(editor.getByText('This keyframe is blank. Add artwork to begin.')).toBeVisible();
  await click('Add symbol rectangle');
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#ff0000');
  await click('Add symbol ellipse');
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await click('Send symbol artwork to back');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await click('Bring symbol artwork to front');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await click('Duplicate symbol artwork');
  await expect(items).toHaveCount(3);
  const duplicateId = await editor.getByLabel('Symbol artwork item').inputValue();
  await expect(editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('10');
  await click('Undo artwork change');
  await expect(items).toHaveCount(2);
  await click('Redo artwork change');
  await expect(editor.getByLabel('Symbol artwork item')).toHaveValue(duplicateId);
  await click('Delete symbol artwork');
  await click('Delete symbol artwork');
  await click('Delete symbol artwork');
  await expect(items).toHaveCount(0);
  await click('Undo artwork change');
  await expect(items).toHaveCount(1);
  await click('Apply symbol changes');
  expect(await read()).toEqual(before);
  await timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await read()).toEqual(before);

  await library.getByRole('button', { name: 'Edit symbol artwork', exact: true }).click();
  await click('Delete symbol artwork');
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(items).toHaveCount(1);
  await click('Add symbol ellipse');
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await click('Apply symbol changes');
  const committed = await read();
  expect(committed.symbols![0].shapes).toHaveLength(2);
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  const output = await page.context().newPage();
  // Use a queued first callback, avoiding recursion in the exported playback loop.
  await output.evaluate(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await output.setContent(exportHTML(committed));
  await output.evaluate(() => (window as unknown as { next: FrameRequestCallback }).next(0));
  expect(
    await output
      .locator('canvas')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(120, 115, 1, 1).data),
      ),
  ).toEqual([0, 0, 255, 255]);
  await output.close();
});

test('nested graphic instances author, animate, reject cycles, protect references and export inside movies', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 8;
  p.fps = 10;
  const art = {
    id: 'paint',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Child',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
  };
  const parent = {
    id: 'parent',
    name: 'Container',
    width: 80,
    height: 60,
    shapes: [{ ...art, fill: '#00ff00' }],
    timeline: { duration: 4, keys: [] },
  };
  p.symbols = [
    parent,
    leaf,
    {
      id: 'alternate',
      name: 'Alternate',
      width: 20,
      height: 10,
      shapes: [{ ...art, width: 20, height: 10, fill: '#ffff00' }],
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(parent, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const parentRow = page.getByRole('group', { name: 'Symbol Container', exact: true });
  const childRow = page.getByRole('group', { name: 'Symbol Child', exact: true });
  await parentRow.getByRole('button', { name: 'Edit symbol artwork', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByLabel('Nested symbol definition').selectOption('leaf');
  await editor.getByRole('button', { name: 'Place nested symbol', exact: true }).click();
  await editor.getByLabel('Nested symbol playback').selectOption('single');
  await editor.getByLabel('Nested symbol first frame').fill('2');
  await editor.getByLabel('Nested symbol first frame').press('Tab');
  const preview = () =>
    editor
      .getByLabel('Symbol artwork preview')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
      );
  await expect.poll(preview).toEqual([0, 0, 255, 255]);
  await editor.getByLabel('Nested symbol definition').selectOption('alternate');
  await editor.getByRole('button', { name: 'Swap nested symbol', exact: true }).click();
  await expect.poll(preview).toEqual([255, 255, 0, 255]);
  await expect(editor.getByLabel('Symbol artwork width', { exact: true })).toHaveValue('80');
  await expect(editor.getByLabel('Nested symbol playback')).toHaveValue('single');
  await expect(editor.getByLabel('Nested symbol first frame')).toHaveValue('2');
  await editor.getByRole('button', { name: 'Use nested symbol native size', exact: true }).click();
  await expect(editor.getByLabel('Symbol artwork width', { exact: true })).toHaveValue('20');
  await expect(editor.getByLabel('Symbol artwork height', { exact: true })).toHaveValue('10');
  await editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(editor.getByLabel('Symbol artwork width', { exact: true })).toHaveValue('80');
  await editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect.poll(preview).toEqual([0, 0, 255, 255]);

  await editor.getByLabel('Nested symbol playback').selectOption('loop');
  await editor.getByLabel('Nested symbol first frame').fill('1');
  await editor.getByLabel('Nested symbol first frame').press('Tab');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const nested = await read();
  expect(nested.symbols![0].shapes[1].symbolId).toBe('leaf');
  await expect(childRow.getByRole('button', { name: 'Remove symbol', exact: true })).toBeDisabled();
  await childRow.getByRole('button', { name: 'Edit symbol artwork', exact: true }).click();
  await editor.getByLabel('Nested symbol definition').selectOption('parent');
  await editor.getByRole('button', { name: 'Place nested symbol', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('cycle');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
  await editor.getByLabel('Nested symbol definition').selectOption('alternate');
  await editor.getByRole('button', { name: 'Place nested symbol', exact: true }).click();
  await editor.getByLabel('Nested symbol definition').selectOption('parent');
  await editor.getByRole('button', { name: 'Swap nested symbol', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('cycle');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
  await expect(editor.getByLabel('Symbol artwork width', { exact: true })).toHaveValue('20');

  await editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await read()).toEqual(nested);
  const stage = page.getByLabel('Drawing stage'),
    box = (await stage.boundingBox())!;
  const pixel = () =>
    stage.evaluate(
      (c, p) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
      { x: (box.width - 960) / 2 + 125, y: (box.height - 540) / 2 + 120 },
    );
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.getByLabel('Timeline frames').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await parentRow.getByRole('button', { name: 'Edit symbol timeline', exact: true }).click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('2');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await expect
    .poll(() =>
      timeline
        .getByLabel('Symbol timeline preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
        ),
    )
    .toEqual([0, 0, 255, 255]);
  await timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect((await read()).symbols![0].shapes).toHaveLength(1);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(nested);
  for (const movie of [false, true]) {
    const project = structuredClone(nested);
    if (movie) {
      project.duration = 1;
      project.layers[0].keys[0].shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 0 };
    }
    const output = await page.context().newPage();
    await output.evaluate(() => {
      window.requestAnimationFrame = (cb) => {
        (window as unknown as { next: FrameRequestCallback }).next = cb;
        return 1;
      };
    });
    await output.setContent(exportHTML(project));
    await expect
      .poll(() =>
        output.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
      )
      .toBe('function');
    for (const [time, color] of [
      [0, [255, 0, 0, 255]],
      [100, [0, 0, 255, 255]],
      [200, [255, 0, 0, 255]],
      [300, [0, 0, 255, 255]],
      [400, [255, 0, 0, 255]],
    ] as const) {
      await output.evaluate(
        (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
        time,
      );
      expect(
        await output
          .locator('canvas')
          .evaluate((c) =>
            Array.from(
              (c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 120, 1, 1).data,
            ),
          ),
      ).toEqual(color);
    }
    await output.close();
  }
});

test('movie export retains transitive nested bitmap assets and rich text painting', async ({
  page,
}) => {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const x = c.getContext('2d')!;
    x.fillStyle = '#00ff00';
    x.fillRect(0, 0, 2, 2);
    return c.toDataURL();
  });
  const p = newProject();
  p.duration = 1;
  p.assets = [
    {
      id: 'image',
      path: 'assets/bitmaps/nested.json',
      bitmap: { name: 'Nested', width: 2, height: 2, dataUrl },
    },
  ];
  const base = {
    id: 'bitmap',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf: NonNullable<Project['symbols']>[number] = {
    id: 'paint-leaf',
    name: 'Paint',
    width: 160,
    height: 60,
    shapes: [
      { ...base, bitmap: { assetId: 'image', x: 0, y: 0, width: 40, height: 30 } },
      {
        ...base,
        id: 'text',
        kind: 'text',
        x: 60,
        y: 0,
        width: 100,
        height: 60,
        text: {
          content: 'AA',
          font: 'Arial',
          size: 40,
          bold: false,
          italic: false,
          align: 'left',
          runs: [{ start: 0, end: 2, style: { color: '#0000ff', bold: true } }],
        },
      },
    ],
  };
  const middle = {
    id: 'middle',
    name: 'Middle',
    width: 160,
    height: 60,
    shapes: [symbolInstance(leaf, 0, 0)],
  };
  const parent = {
    id: 'movie',
    name: 'Movie',
    width: 160,
    height: 60,
    shapes: [symbolInstance(middle, 0, 0)],
  };
  p.symbols = [parent, middle, leaf];
  parent.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 0 };
  middle.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const root = symbolInstance(parent, 100, 100);
  root.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  p.layers[0].keys[0].shapes = [root];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent(exportHTML(p));
  await expect
    .poll(() =>
      page
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(120, 115, 1, 1).data),
        ),
    )
    .toEqual([0, 255, 0, 255]);
  const blue = await page.locator('canvas').evaluate((c) => {
    const bytes = (c as HTMLCanvasElement).getContext('2d')!.getImageData(155, 60, 110, 130).data;
    let count = 0;
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i] < 30 && bytes[i + 1] < 30 && bytes[i + 2] > 200) count++;
    return count;
  });
  expect(blue).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('symbol key navigation, guarded copy/move and draft history preserve exposure artwork', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'edit-keys',
    name: 'Keys',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 6,
      keys: [
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 4, shapes: [] },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const open = () =>
    page
      .getByRole('group', { name: 'Symbol Keys', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
  await open();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => timeline.getByRole('button', { name, exact: true }).click();
  const pixel = () =>
    timeline
      .getByLabel('Symbol timeline preview')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
      );
  const target = timeline.getByLabel('Symbol key destination', { exact: true });
  await expect(
    timeline.getByRole('button', { name: 'Move symbol keyframe', exact: true }),
  ).toBeDisabled();
  await click('Next symbol keyframe');
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('3');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await target.fill('5');
  await click('Move symbol keyframe');
  await expect(timeline.getByRole('alert')).toContainText('already contains');
  await expect(
    timeline.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await target.fill('8');
  await click('Move symbol keyframe');
  await expect(timeline.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('8');
  await click('Undo symbol timeline change');
  await expect(timeline.getByLabel('Symbol duration', { exact: true })).toHaveValue('6');
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('3');
  await click('Redo symbol timeline change');
  await click('Previous symbol keyframe');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await target.fill('10');
  await click('Copy symbol exposure');
  await expect(timeline.getByLabel('Symbol duration', { exact: true })).toHaveValue('10');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await click('Undo symbol timeline change');
  await timeline.getByLabel('Symbol keyframes').selectOption('0');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await target.fill('2');
  await click('Copy symbol exposure');
  await expect(
    timeline.getByRole('button', { name: 'Redo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await click('Apply symbol timeline');
  const committed = await read();
  expect(committed.symbols![0].timeline?.keys.map((k) => k.frame)).toEqual([1, 4, 7]);
  expect(committed.symbols![0].timeline?.keys[2].shapes[0].fill).toBe('#0000ff');
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  await open();
  await target.fill('12');
  await click('Copy symbol exposure');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(committed);
});

test('symbol layers author independent keys with ordering visibility locks history and export', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 6;
  p.fps = 10;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'layers',
    name: 'Layers',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: { duration: 4, keys: [] },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const open = () =>
    page
      .getByRole('group', { name: 'Symbol Layers', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
  await open();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const click = (name: string) => timeline.getByRole('button', { name, exact: true }).click();
  const pixel = () =>
    timeline
      .getByLabel('Symbol timeline preview')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
      );
  async function add(name: string, color: string) {
    await click('Add symbol layer');
    await timeline.getByLabel('Symbol layer name').fill(name);
    await timeline.getByLabel('Symbol layer name').press('Tab');
    const id = await timeline.getByLabel('Symbol layer', { exact: true }).inputValue();
    await click('Edit symbol frame artwork');
    await editor.getByRole('button', { name: 'Add symbol rectangle', exact: true }).click();
    await editor.getByLabel('Symbol artwork fill', { exact: true }).fill(color);
    await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    return id;
  }
  const blue = await add('Blue', '#0000ff');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('3');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await click('Insert blank symbol keyframe');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('1');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  const green = await add('Green', '#00ff00');
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await timeline.getByLabel('Symbol layer', { exact: true }).selectOption(blue);
  await click('Bring symbol layer to front');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await timeline.getByLabel('Symbol layer visible').uncheck();
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await expect(
    timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }),
  ).toBeDisabled();
  await timeline.getByLabel('Symbol layer visible').check();
  await timeline.getByLabel('Symbol layer locked').check();
  await expect(
    timeline.getByRole('button', { name: 'Remove symbol layer', exact: true }),
  ).toBeDisabled();
  await expect(
    timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }),
  ).toBeDisabled();
  await timeline.getByLabel('Symbol layer locked').uncheck();
  await timeline.getByLabel('Symbol layer', { exact: true }).selectOption(green);
  await click('Remove symbol layer');
  await click('Undo symbol timeline change');
  await expect(timeline.getByLabel('Symbol layer', { exact: true })).toHaveValue(green);
  await timeline.getByLabel('Symbol layer', { exact: true }).selectOption(blue);
  await click('Apply symbol timeline');
  const committed = await read();
  expect(committed.symbols![0].timeline?.layers?.map((l) => l.id)).toEqual([green, blue]);
  expect(committed.symbols![0].timeline?.layers?.[1].keys.map((k) => k.frame)).toEqual([0, 2]);
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  await open();
  await click('Add symbol layer');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(committed);
  const output = await page.context().newPage();
  await output.evaluate(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await output.setContent(exportHTML(committed));
  await expect
    .poll(() =>
      output.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
    )
    .toBe('function');
  for (const [time, color] of [
    [0, [0, 0, 255, 255]],
    [200, [0, 255, 0, 255]],
    [400, [0, 0, 255, 255]],
  ] as const) {
    await output.evaluate(
      (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
      time,
    );
    expect(
      await output
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(120, 115, 1, 1).data),
        ),
    ).toEqual(color);
  }
  await output.close();
});

test('symbol track duplication and cross-layer transfers retain artwork and reject locked destinations', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  const d = {
    id: 'transfer',
    name: 'Transfer',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 6,
      keys: [{ frame: 2, shapes: [{ ...art, fill: '#0000ff' }] }],
      layers: [
        {
          id: 'empty',
          name: 'Empty',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Transfer', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await click('Duplicate symbol layer');
  const duplicate = await t.getByLabel('Symbol layer', { exact: true }).inputValue();
  expect(duplicate).not.toBe('@base');
  await expect(t.getByLabel('Symbol layer name')).toHaveValue('Artwork copy');
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue('@base');
  await click('Redo symbol timeline change');
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue(duplicate);
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('empty');
  await t.getByLabel('Symbol layer locked').check();
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('@base');
  await t.getByLabel('Symbol key destination layer').selectOption('empty');
  await t.getByLabel('Symbol key destination', { exact: true }).fill('2');
  await click('Copy symbol exposure');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue('@base');
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('empty');
  await t.getByLabel('Symbol layer locked').uncheck();
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('@base');
  await click('Next symbol keyframe');
  await t.getByLabel('Symbol key destination', { exact: true }).fill('3');
  await click('Move symbol keyframe');
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue('empty');
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue('@base');
  await click('Redo symbol timeline change');
  await t.getByLabel('Symbol key destination layer').selectOption(duplicate);
  await click('Copy symbol exposure');
  await expect(t.getByRole('alert')).toContainText('already contains');
  await t.getByLabel('Symbol key destination', { exact: true }).fill('8');
  await click('Copy symbol exposure');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Apply symbol timeline');
  const committed = await read();
  const timeline = committed.symbols![0].timeline!;
  expect(timeline.keys).toEqual([]);
  expect(timeline.layers!.find((l) => l.id === 'empty')!.keys[1].shapes[0].fill).toBe('#0000ff');
  const copied = timeline.layers!.find((l) => l.id === duplicate)!;
  expect(copied.keys.map((k) => k.frame)).toEqual([0, 2, 7]);
  expect(copied.keys[0].shapes[0].id).toBe(copied.keys[1].shapes[0].id);
  expect(copied.keys[0].shapes[0].id).not.toBe('art');
  expect(copied.keys[2].shapes[0].id).not.toBe(copied.keys[1].shapes[0].id);
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('symbol frame range clipboard preserves holds, rejects removing all artwork and supports undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'ranges',
    name: 'Ranges',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 6,
      keys: [
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 4, shapes: [] },
      ],
      layers: [
        {
          id: 'extra',
          name: 'Extra',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const open = () => openLibraryTimelineTools(page, 'Ranges');
  await open();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await click('Cut symbol frame range');
  await expect(t.getByText('3 copied frames', { exact: false })).toBeVisible();
  await t.getByLabel('Symbol range start', { exact: true }).fill('1');
  await click('Cut symbol frame range');
  await expect(t.getByRole('alert')).toContainText('Keep artwork on at least one frame of the symbol');
  await expect(t.getByText('3 copied frames', { exact: false })).toBeVisible();
  await click('Undo symbol timeline change');
  await click('Redo symbol timeline change');
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('extra');
  await t.getByLabel('Symbol frame range insertion', { exact: true }).fill('2');
  await click('Insert copied symbol frames');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('9');
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('6');
  await click('Redo symbol timeline change');
  await applyLibraryTimelineTools(page);
  const committed = await read(),
    timeline = committed.symbols![0].timeline!;
  expect(timeline.keys.map((k) => k.frame)).toEqual([1, 4]);
  expect(timeline.keys.every((k) => !k.shapes.length)).toBe(true);
  const keys = timeline.layers![0].keys;
  expect(keys.map((k) => k.frame)).toEqual([0, 1, 2, 4]);
  expect(keys[1].shapes[0].fill).toBe('#ff0000');
  expect(keys[2].shapes[0].fill).toBe('#0000ff');
  expect(keys[1].shapes[0].id).not.toBe('art');
  expect(keys[1].shapes[0].id).toBe(keys[2].shapes[0].id);
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  await open();
  await expect(
    t.getByRole('button', { name: 'Insert copied symbol frames', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('3');
  await click('Clear symbol frame range');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(committed);
});

test('symbol frame grid selects ranges, navigates tracks and bounds long timeline rendering', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'grid',
    name: 'Grid',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 10000,
      keys: [{ frame: 2, shapes: [] }],
      layers: [
        {
          id: 'extra',
          name: 'Overlay',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [] },
            { frame: 3, shapes: [{ ...art, fill: '#0000ff' }] },
          ],
        },
        {
          id: 'locked',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Grid', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const grid = t.getByRole('region', { name: 'Symbol frame grid' });
  const cell = (name: string) => grid.getByRole('button', { name, exact: true });
  await expect(grid.locator('td button')).toHaveCount(192);
  const scroll = grid.locator('.scroll');
  await cell('Artwork, frame 2, hold').scrollIntoViewIfNeeded();
  const initialCell = await cell('Artwork, frame 2, hold').boundingBox();
  const edge = await scroll.boundingBox();
  await page.mouse.move(initialCell!.x + 14, initialCell!.y + 14);
  await page.mouse.down();
  await page.mouse.move(edge!.x + edge!.width - 12, initialCell!.y + 14);
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  const scrolled = await scroll.evaluate((el) => el.scrollLeft);
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(scrolled);
  await page.keyboard.press('Escape');
  const stopped = await scroll.evaluate((el) => el.scrollLeft);
  await page.waitForTimeout(240);
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBe(stopped);
  await page.mouse.up();
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('1');
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
  });

  // Page changes must retain capture even when the originating cell is removed.
  const crossPage = async (move: boolean, cancel: boolean) => {
    await cell('Artwork, frame 2, hold').click();
    const source = await cell('Artwork, frame 2, hold').boundingBox();
    const viewport = await scroll.boundingBox();
    if (move) await page.keyboard.down('Alt');
    await page.mouse.move(source!.x + 14, source!.y + 14);
    await page.mouse.down();
    await scroll.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.mouse.move(viewport!.x + viewport!.width - 12, source!.y + 14);
    await expect(grid.getByText('Frames 65–128 of 10000', { exact: true })).toBeVisible();
    await cell('Artwork, frame 66, blank hold').scrollIntoViewIfNeeded();
    const target = await cell('Artwork, frame 66, blank hold').boundingBox();
    await page.mouse.move(target!.x + 14, target!.y + 14);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (move) await page.keyboard.up('Alt');
  };
  await crossPage(false, true);
  await expect(grid.getByText('Frames 1–64 of 10000', { exact: true })).toBeVisible();
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('2');
  await crossPage(false, false);
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('66');
  const backwards = await cell('Artwork, frame 66, blank hold').boundingBox();
  const viewport = await scroll.boundingBox();
  await page.mouse.move(backwards!.x + 14, backwards!.y + 14);
  await page.mouse.down();
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.mouse.move(viewport!.x + 150, backwards!.y + 14);
  await expect(grid.getByText('Frames 1–64 of 10000', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(grid.getByText('Frames 65–128 of 10000', { exact: true })).toBeVisible();
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('66');
  await grid.getByRole('button', { name: 'Earlier symbol frames', exact: true }).click();
  await crossPage(true, false);
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('66');
  await expect(cell('Artwork, frame 66, key')).toBeVisible();
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await cell('Artwork, frame 1, key').click();
  const point = async (name: string) => {
    const b = await cell(name).boundingBox();
    return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
  };
  await cell('Artwork, frame 2, hold').scrollIntoViewIfNeeded();
  const a = await point('Artwork, frame 2, hold');
  const b = await point('Artwork, frame 5, blank hold');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(4);
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('1');
  await page.mouse.up();
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(t).toBeVisible();
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const other = await point('Overlay, frame 4, key');
  await page.mouse.move(other.x, other.y);
  await page.mouse.up();
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue('@base');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');

  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y);
  await page.mouse.up();
  await expect(cell('Artwork, frame 2, hold')).toBeFocused();
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await cell('Artwork, frame 2, hold').dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const middle = await point('Artwork, frame 3, blank key');
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('3');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await cell('Artwork, frame 2, hold').click();
  await cell('Artwork, frame 5, blank hold').click({ modifiers: ['Shift'] });
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(4);
  await grid.screenshot({ path: 'test-results/symbol-frame-grid.png' });
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('4');
  await page.keyboard.press('ArrowUp');
  await expect(t.getByLabel('Symbol layer', { exact: true })).toHaveValue('extra');
  await expect(cell('Overlay, frame 4, key')).toBeFocused();
  const pixel = () =>
    t
      .getByLabel('Symbol timeline preview')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(100, 100, 1, 1).data),
      );
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.press('Home');
  await expect(cell('Overlay, frame 1, blank key')).toBeFocused();
  await page.keyboard.press('End');
  await expect(cell('Overlay, frame 10000, hold')).toBeFocused();
  expect(await grid.locator('td button').count()).toBeLessThanOrEqual(192);
  await page.keyboard.press('Home');
  await cell('Protected, frame 1, blank key').click();
  await expect(
    t.getByRole('button', { name: 'Clear symbol frame range', exact: true }),
  ).toBeDisabled();
  await cell('Overlay, frame 4, key').click();
  await cell('Overlay, frame 6, hold').click({ modifiers: ['Shift'] });
  await t.getByRole('button', { name: 'Clear symbol frame range', exact: true }).click();
  await expect(cell('Overlay, frame 4, blank key')).toBeVisible();
  await expect(cell('Overlay, frame 7, key')).toBeVisible();
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(cell('Overlay, frame 4, key')).toBeVisible();
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect(grid.locator('td button').first()).toBeDisabled();
  await t.getByRole('button', { name: 'Stop symbol preview', exact: true }).click();
  await cell('Overlay, frame 4, key').click();
  await cell('Overlay, frame 6, hold').click({ modifiers: ['Shift'] });
  const dragRange = async (destination: string, cancel = false) => {
    await cell('Overlay, frame 5, hold').scrollIntoViewIfNeeded();
    const from = await point('Overlay, frame 5, hold');
    const to = await point(destination);
    await page.keyboard.down('Alt');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Alt');
  };
  await dragRange('Artwork, frame 11, blank hold', true);
  await expect(cell('Overlay, frame 4, key')).toBeVisible();
  await expect(cell('Artwork, frame 10, blank hold')).toBeVisible();
  await dragRange('Artwork, frame 2, hold');
  await expect(t.getByRole('alert')).toContainText('artwork');
  await expect(cell('Overlay, frame 4, key')).toBeVisible();
  await dragRange('Artwork, frame 11, blank hold');
  await expect(cell('Overlay, frame 4, blank key')).toBeVisible();
  await expect(cell('Artwork, frame 10, key')).toBeFocused();
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('12');
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(cell('Overlay, frame 4, key')).toBeVisible();
  await t.getByLabel('Symbol range destination layer', { exact: true }).selectOption('@base');
  await t.getByLabel('Symbol range destination frame', { exact: true }).fill('10');
  await t.getByRole('button', { name: 'Copy symbol range to destination', exact: true }).click();
  await expect(cell('Artwork, frame 10, key')).toBeVisible();
  await expect(cell('Artwork, frame 13, blank key')).toBeVisible();
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('10');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('12');
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(cell('Artwork, frame 10, blank hold')).toBeVisible();
  await t.getByLabel('Symbol range destination layer', { exact: true }).selectOption('locked');
  await t.getByRole('button', { name: 'Move symbol range to destination', exact: true }).click();
  await expect(
    t.getByText('Error: Choose a visible unlocked symbol layer.', { exact: true }),
  ).toBeVisible();
  await expect(cell('Overlay, frame 4, key')).toBeVisible();
  await t.getByLabel('Symbol range destination layer', { exact: true }).selectOption('@base');
  await t.getByRole('button', { name: 'Move symbol range to destination', exact: true }).click();
  await expect(cell('Overlay, frame 4, blank key')).toBeVisible();
  await expect(cell('Overlay, frame 7, key')).toBeVisible();
  await expect(cell('Artwork, frame 10, key')).toBeVisible();
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(cell('Overlay, frame 4, key')).toBeVisible();
  await t.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await read()).toEqual(before);
});

test('symbol exposure selection duplicates and removes spans with guarded history', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'spans',
    name: 'Spans',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 5, shapes: [] },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openLibraryTimelineTools(page, 'Spans');
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByRole('button', { name: 'Artwork, frame 4, hold', exact: true }).dblclick();
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('3');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('5');
  await click('Duplicate symbol frame range');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('6');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('8');
  await click('Remove symbol frame range');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 6, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await expect(t.getByRole('button', { name: 'Artwork, frame 6, key', exact: true })).toBeVisible();
  await click('Redo symbol timeline change');
  await t.getByLabel('Symbol range start', { exact: true }).fill('1');
  await t.getByLabel('Symbol range end', { exact: true }).fill('11');
  await click('Remove symbol frame range');
  await expect(t.getByRole('alert')).toContainText('Keep artwork on at least one frame of the symbol');
  await applyLibraryTimelineTools(page);
  const committed = await read();
  expect(committed.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([2, 5, 8]);
  expect(committed.symbols![0].timeline!.keys.slice(1).every((k) => !k.shapes.length)).toBe(true);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('symbol grid shortcuts preserve range history and stay scoped to timeline cells', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'keys',
    name: 'Keys',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 5, shapes: [] },
      ],
      layers: [
        {
          id: 'locked',
          name: 'Locked',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openLibraryTimelineTools(page, 'Keys');
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const cell = (name: string) => t.getByRole('button', { name, exact: true });
  const range = async (a: string, b: string) => {
    await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue(a);
    await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue(b);
  };
  await cell('Artwork, frame 4, hold').dblclick();
  await range('3', '5');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+d');
  await range('6', '8');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await cell('Undo symbol timeline change').click();
  await range('3', '5');
  await cell('Redo symbol timeline change').click();
  await range('6', '8');
  await cell('Artwork, frame 6, key').focus();
  await page.keyboard.press('Shift+Delete');
  await range('6', '6');
  await expect(cell('Artwork, frame 6, blank key')).toBeVisible();
  await cell('Undo symbol timeline change').click();
  await range('6', '8');
  await cell('Artwork, frame 6, key').focus();
  await page.keyboard.press('Delete');
  await expect(cell('Artwork, frame 6, blank key')).toBeVisible();
  await cell('Undo symbol timeline change').click();
  await cell('Artwork, frame 6, key').focus();
  await page.keyboard.press('Control+x');
  await expect(cell('Artwork, frame 6, blank key')).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+v');
  await range('1', '3');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
  await cell('Locked, frame 1, blank key').click();
  await page.keyboard.press('Control+v');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
  await t.getByLabel('Symbol range end', { exact: true }).focus();
  await page.keyboard.press('Control+d');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
  expect(await read()).toEqual(before);
  await cell('Cancel symbol timeline').click();
  expect(await read()).toEqual(before);
});

test('symbol multi-track ranges commit atomically and extend shared duration once', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'bulk',
    name: 'Bulk',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [{ frame: 2, shapes: [] }],
      layers: [
        {
          id: 'other',
          name: 'Other',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [{ ...art, fill: '#0000ff' }] },
            { frame: 5, shapes: [] },
          ],
        },
        {
          id: 'locked',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openLibraryTimelineTools(page, 'Bulk');
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await click('Select all symbol tracks');
  await click('Duplicate range on selected symbol tracks');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Symbol range destination frame', { exact: true }).fill('10');
  await click('Move selected symbol spans to destination');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await t.getByLabel('Include symbol track Protected', { exact: true }).uncheck();
  const dragTracks = async (cancel: boolean, targetTrack = 'Other', targetFrame = 6) => {
    const grid = t.getByRole('region', { name: 'Symbol frame grid' });
    await grid
      .getByRole('button', { name: 'Other, frame 2, hold', exact: true })
      .scrollIntoViewIfNeeded();
    const source = await grid
      .getByRole('button', { name: 'Other, frame 2, hold', exact: true })
      .boundingBox();
    const target = await grid
      .locator(
        `button[data-symbol-track="${targetTrack === 'Other' ? 'other' : targetTrack === 'Protected' ? 'locked' : '@base'}"][data-symbol-frame="${targetFrame - 1}"]`,
      )
      .boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(source!.x + 14, source!.y + 14);
    await page.mouse.down();
    await page.mouse.move(target!.x + 14, target!.y + 14);
    if (targetTrack === 'Other') await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(6);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Alt');
  };
  await dragTracks(true);
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await dragTracks(false, 'Artwork'); // Would place the lower source outside the stack.
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await dragTracks(false, 'Protected');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('locked');
  await t.getByLabel('Symbol layer locked', { exact: true }).uncheck();
  await dragTracks(false, 'Protected');
  await expect(
    t.getByRole('button', { name: 'Protected, frame 6, key', exact: true }),
  ).toBeVisible();
  await expect(t.getByRole('button', { name: 'Other, frame 6, key', exact: true })).toBeVisible();
  await click('Undo symbol timeline change');
  await click('Undo symbol timeline change');
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('@base');
  await dragTracks(false, 'Other', 5); // One occupied destination rejects the whole batch.
  await expect(t.getByRole('alert')).toContainText('artwork');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await dragTracks(false);
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('6');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Other, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('2');
  await expect(t.getByRole('button', { name: 'Other, frame 2, hold', exact: true })).toBeVisible();
  const grid = t.getByRole('region', { name: 'Symbol frame grid' });
  const focusRange = async () => {
    await t.getByLabel('Symbol range start', { exact: true }).fill('2');
    await t.getByLabel('Symbol range end', { exact: true }).fill('4');
    await grid.getByRole('button', { name: 'Artwork, frame 2, hold', exact: true }).focus();
  };
  await focusRange();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Delete');
  await expect(
    t.getByRole('button', { name: 'Other, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await focusRange();
  await page.keyboard.press('Control+x');
  await expect(
    t.getByRole('button', { name: 'Other, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await grid.getByRole('button', { name: 'Artwork, frame 6, blank hold', exact: true }).click();
  await page.keyboard.press('Control+v');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await expect(t.getByRole('button', { name: 'Other, frame 6, key', exact: true })).toBeVisible();
  await click('Undo symbol timeline change');
  await focusRange();
  await page.keyboard.press('Control+d');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await expect(t.getByRole('button', { name: 'Other, frame 5, key', exact: true })).toBeVisible();
  await t.getByLabel('Symbol span destination other', { exact: true }).selectOption('@base');
  await t.getByLabel('Include symbol track Other', { exact: true }).uncheck();
  await grid.locator('button[aria-current="true"]').focus();
  await page.keyboard.press('Control+z');
  await expect(t.getByLabel('Include symbol track Other', { exact: true })).toBeChecked();
  await expect(t.getByLabel('Symbol span destination other', { exact: true })).toHaveValue('other');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await page.keyboard.press('Control+Shift+z');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await expect(t.getByLabel('Include symbol track Other', { exact: true })).not.toBeChecked();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await page.keyboard.press('Control+z');
  await focusRange();
  await page.keyboard.press('Shift+Delete');
  await expect(
    t.getByRole('button', { name: 'Other, frame 3, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await t.getByLabel('Include symbol track Protected', { exact: true }).check();
  await focusRange();
  await page.keyboard.press('Delete');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Include symbol track Protected', { exact: true }).uncheck();
  await t.getByLabel('Include symbol track Other', { exact: true }).uncheck();
  await focusRange();
  await page.keyboard.press('Control+c'); // Most recent copy is now single-track.
  await t.getByLabel('Include symbol track Other', { exact: true }).check();
  await grid.getByRole('button', { name: 'Artwork, frame 6, blank hold', exact: true }).click();
  await page.keyboard.press('Control+v');
  await expect(t.getByRole('button', { name: 'Artwork, frame 6, key', exact: true })).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Other, frame 6, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await focusRange();
  await t.getByLabel('Symbol range destination frame', { exact: true }).fill('5');
  await click('Move selected symbol spans to destination');
  await expect(t.getByRole('alert')).toContainText('artwork');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Symbol range destination frame', { exact: true }).fill('10');
  await click('Move selected symbol spans to destination');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('12');
  await expect(t.getByLabel('Symbol range start', { exact: true })).toHaveValue('10');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Other, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Copy selected symbol spans to destination');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('12');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 2, hold', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await t.getByLabel('Symbol span destination @base', { exact: true }).selectOption('other');
  await click('Move selected symbol spans to destination');
  await expect(t.getByRole('alert')).toContainText('distinct destination');
  await t.getByLabel('Symbol span destination other', { exact: true }).selectOption('@base');
  await click('Move selected symbol spans to destination');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('12');
  await expect(t.getByRole('button', { name: 'Other, frame 10, key', exact: true })).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 10, key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await t.getByLabel('Include symbol track Other', { exact: true }).uncheck();
  await click('Move selected symbol spans to destination');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('12');
  await expect(t.getByRole('button', { name: 'Other, frame 10, key', exact: true })).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await click('Reset symbol span destinations');
  await t.getByLabel('Include symbol track Other', { exact: true }).check();
  await click('Duplicate range on selected symbol tracks');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Redo symbol timeline change');
  await click('Remove range on selected symbol tracks');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await click('Undo symbol timeline change');
  await click('Clear range on selected symbol tracks');
  await applyLibraryTimelineTools(page);
  const after = await read(),
    timeline = after.symbols![0].timeline!;
  expect(timeline.duration).toBe(11);
  expect(timeline.keys.map((k) => k.frame)).toEqual([2, 4, 7]);
  expect(timeline.layers![0].keys.map((k) => k.frame)).toEqual([0, 4, 7, 8]);
  expect(timeline.layers![0].keys[1].shapes).toEqual([]);
  expect(timeline.layers![1]).toEqual(d.timeline.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol multi-track clipboard cuts and inserts immutable original-track spans', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'bulk',
    name: 'Bulk',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [{ frame: 2, shapes: [] }],
      layers: [
        {
          id: 'other',
          name: 'Other',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [{ ...art, fill: '#0000ff' }] },
            { frame: 5, shapes: [] },
          ],
        },
        {
          id: 'locked',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openLibraryTimelineTools(page, 'Bulk');
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Include symbol track Artwork', { exact: true }).check();
  await t.getByLabel('Include symbol track Other', { exact: true }).check();
  await click('Cut selected symbol tracks');
  await expect(t.getByText('2 copied tracks, 3 frames', { exact: false })).toBeVisible();
  await t.getByLabel('Symbol range start', { exact: true }).fill('1');
  await t.getByLabel('Symbol range end', { exact: true }).fill('8');
  await click('Cut selected symbol tracks');
  await expect(t.getByRole('alert')).toContainText('Keep artwork on at least one frame of the symbol');
  await expect(t.getByText('2 copied tracks, 3 frames', { exact: false })).toBeVisible();
  await click('Undo symbol timeline change');
  await click('Redo symbol timeline change');
  await click('Clear symbol track selection');
  await t.getByLabel('Symbol frame range insertion', { exact: true }).fill('6');
  await click('Insert copied symbol tracks');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Redo symbol timeline change');
  await applyLibraryTimelineTools(page);
  const after = await read(),
    timeline = after.symbols![0].timeline!;
  expect(timeline.keys.map((k) => k.frame)).toEqual([1, 4, 5, 6, 8]);
  expect(timeline.layers![0].keys.map((k) => k.frame)).toEqual([0, 1, 4, 5, 8]);
  expect(timeline.keys.find((k) => k.frame === 5)!.shapes[0].fill).toBe('#ff0000');
  expect(timeline.layers![0].keys.find((k) => k.frame === 5)!.shapes[0].fill).toBe('#0000ff');
  expect(timeline.layers![1]).toEqual(d.timeline.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol clipboard destination mapping rejects duplicates and locked routes before atomic swaps', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'bulk',
    name: 'Bulk',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [{ frame: 2, shapes: [] }],
      layers: [
        {
          id: 'other',
          name: 'Other',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [{ ...art, fill: '#0000ff' }] },
            { frame: 5, shapes: [] },
          ],
        },
        {
          id: 'locked',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Bulk', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Include symbol track Artwork', { exact: true }).check();
  await t.getByLabel('Include symbol track Other', { exact: true }).check();
  await click('Copy selected symbol tracks');
  await t.getByLabel('Symbol frame range insertion', { exact: true }).fill('2');
  await t.getByLabel('Copied symbol track 1 destination', { exact: true }).selectOption('other');
  await click('Insert copied symbol tracks');
  await expect(t.getByRole('alert')).toContainText('distinct');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Copied symbol track 2 destination', { exact: true }).selectOption('locked');
  await click('Insert copied symbol tracks');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Reset symbol track destinations');
  await expect(t.getByLabel('Copied symbol track 1 destination', { exact: true })).toHaveValue(
    '@base',
  );
  await t.getByLabel('Copied symbol track 1 destination', { exact: true }).selectOption('other');
  await t.getByLabel('Copied symbol track 2 destination', { exact: true }).selectOption('@base');
  await click('Insert copied symbol tracks');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('11');
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Redo symbol timeline change');
  await click('Apply symbol timeline');
  const after = await read(),
    timeline = after.symbols![0].timeline!;
  expect(timeline.keys.find((k) => k.frame === 1)!.shapes[0].fill).toBe('#0000ff');
  expect(timeline.layers![0].keys.find((k) => k.frame === 1)!.shapes[0].fill).toBe('#ff0000');
  expect(timeline.layers![1]).toEqual(d.timeline.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol artwork canvas moves complete groups with cancellation, nudging and one-step history', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 10,
    y: 10,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  const d = {
    id: 'canvas',
    name: 'Canvas',
    width: 100,
    height: 100,
    shapes: [art, { ...art, id: 'b', x: 60, fill: '#0000ff' }],
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openStaticLibraryArtwork(page,'Canvas');
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
    canvas = t.getByLabel('Symbol artwork preview');
  const items = t.getByLabel('Symbol artwork item').locator('option');
  await canvas.focus();
  await page.keyboard.press('Control+d');
  await expect(items).toHaveCount(4);
  await page.keyboard.press('Delete');
  await expect(items).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(items).toHaveCount(4);
  await page.keyboard.press('Control+Shift+z');
  await expect(items).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Backspace');
  await expect(items).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(items).toHaveCount(2);
  await page.keyboard.press('Control+y');
  await expect(items).toHaveCount(4);
  await page.keyboard.press('Control+z');
  await expect(items).toHaveCount(2);
  expect(await read()).toEqual(before);
  const point = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const from = await point(20, 20),
    to = await point(30, 25);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork x', { exact: true }).inputValue()))
    .toBeCloseTo(20);
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork y', { exact: true }).inputValue()))
    .toBeCloseTo(15);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('10');
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByLabel('Symbol artwork item').selectOption('b');
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork x', { exact: true }).inputValue()))
    .toBeCloseTo(70);
  const p1 = await point(80, 25),
    p2 = await point(90, 35);
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  await page.mouse.move(p2.x, p2.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(t).toBeVisible();
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork x', { exact: true }).inputValue()))
    .toBeCloseTo(70);
  const constrained = await point(90, 27);
  await page.mouse.move(p1.x, p1.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(constrained.x, constrained.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork y', { exact: true }).inputValue()))
    .toBeCloseTo(15);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  const cancelFrom = await point(80, 25),
    cancelTo = await point(90, 35);
  await page.mouse.move(cancelFrom.x, cancelFrom.y);
  await page.mouse.down();
  await page.mouse.move(cancelTo.x, cancelTo.y);
  await canvas.dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork x', { exact: true }).inputValue()))
    .toBeCloseTo(70);
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork x', { exact: true }).inputValue()))
    .toBeCloseTo(60);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].shapes.map((s) => Math.round(s.x))).toEqual([10, 60]);
  expect(after.symbols![0].shapes.map((s) => Math.round(s.y))).toEqual([15, 15]);
  expect(after.symbols![0].shapes.map((s) => s.groups)).toEqual([['group'], ['group']]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol canvas draws rectangles and constrained ellipses with cancellation and isolated undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 10,
    y: 10,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  const d = {
    id: 'canvas',
    name: 'Canvas',
    width: 100,
    height: 100,
    shapes: [art, { ...art, id: 'b', x: 60, fill: '#0000ff' }],
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Canvas', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
    canvas = t.getByLabel('Symbol artwork preview');
  const point = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const draw = async (x1: number, y1: number, x2: number, y2: number) => {
    const a = await point(x1, y1),
      b = await point(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
  };
  await t.getByLabel('Symbol canvas tool').selectOption('rectangle');
  await draw(50, 70, 20, 50);
  await expect
    .poll(async () =>
      Number(await t.getByLabel('Symbol artwork width', { exact: true }).inputValue()),
    )
    .toBeCloseTo(30);
  await expect
    .poll(async () =>
      Number(await t.getByLabel('Symbol artwork height', { exact: true }).inputValue()),
    )
    .toBeCloseTo(20);
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(3);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork item')).toHaveValue('a');
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByLabel('Symbol canvas tool').selectOption('ellipse');
  await page.keyboard.down('Shift');
  await draw(60, 60, 80, 70);
  await page.keyboard.up('Shift');
  await expect
    .poll(async () =>
      Number(await t.getByLabel('Symbol artwork width', { exact: true }).inputValue()),
    )
    .toBeCloseTo(20);
  await expect
    .poll(async () =>
      Number(await t.getByLabel('Symbol artwork height', { exact: true }).inputValue()),
    )
    .toBeCloseTo(20);
  await draw(90, 90, 90, 90);
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(4);
  const a = await point(10, 80),
    b = await point(30, 95);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(t).toBeVisible();
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(4);
  expect(await read()).toEqual(before);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].shapes.map((s) => s.kind)).toEqual([
    'rectangle',
    'rectangle',
    'rectangle',
    'ellipse',
  ]);
  expect(after.symbols![0].shapes.slice(0, 2)).toEqual(before.symbols![0].shapes);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol canvas draws colored lines and centered primitives without altering existing paint', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 10,
    y: 10,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  const d = {
    id: 'canvas',
    name: 'Canvas',
    width: 100,
    height: 100,
    shapes: [art, { ...art, id: 'b', x: 60, fill: '#0000ff' }],
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Canvas', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
    canvas = t.getByLabel('Symbol artwork preview');
  const point = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const draw = async (x1: number, y1: number, x2: number, y2: number) => {
    const a = await point(x1, y1),
      b = await point(x2, y2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
  };
  await t.getByLabel('New symbol drawing fill').fill('#00ff00');
  await t.getByLabel('New symbol line color').fill('#ff00ff');
  await t.getByLabel('New symbol line width').fill('4');
  await t.getByLabel('Symbol canvas tool').selectOption('line');
  await draw(80, 70, 20, 70);
  await expect(t.getByLabel('Symbol artwork strokeWidth', { exact: true })).toHaveValue('4');
  await expect(t.getByLabel('Symbol artwork stroke', { exact: true })).toHaveValue('#ff00ff');
  await expect
    .poll(async () =>
      Number(await t.getByLabel('Symbol artwork height', { exact: true }).inputValue()),
    )
    .toBeCloseTo(0);
  await t.getByLabel('Symbol canvas tool').selectOption('rectangle');
  await page.keyboard.down('Alt');
  await draw(40, 50, 50, 60);
  await page.keyboard.up('Alt');
  await expect
    .poll(async () => Number(await t.getByLabel('Symbol artwork x', { exact: true }).inputValue()))
    .toBeCloseTo(30);
  await expect
    .poll(async () =>
      Number(await t.getByLabel('Symbol artwork width', { exact: true }).inputValue()),
    )
    .toBeCloseTo(20);
  await expect(t.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#00ff00');
  await t.getByLabel('Symbol canvas tool').selectOption('line');
  await t.getByLabel('New symbol line width').fill('0');
  await draw(20, 80, 60, 80);
  await expect(t.getByRole('alert')).toContainText('greater than zero');
  await t.getByRole('button', { name: 'Add symbol ellipse', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#00ff00');
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(4);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].shapes.slice(0, 2)).toEqual(before.symbols![0].shapes);
  expect(after.symbols![0].shapes[2]).toMatchObject({
    kind: 'line',
    fillEnabled: false,
    stroke: '#ff00ff',
    strokeWidth: 4,
  });
  expect(after.symbols![0].shapes[3]).toMatchObject({ kind: 'rectangle', fill: '#00ff00' });
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol onion skins show bounded neighboring artwork without changing saved definitions', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 1;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'onion',
    name: 'Onion',
    width: 100,
    height: 100,
    shapes: [art],
    timeline: {
      duration: 3,
      layers: [
        {
          id: 'empty',
          name: 'Empty',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
      keys: [{ frame: 2, shapes: [{ ...art, x: 50, fill: '#0000ff' }] }],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Onion', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const pixel = () =>
    t
      .getByLabel('Symbol timeline preview')
      .evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(180, 40, 1, 1).data),
      );
  await t.getByLabel('Symbol frame', { exact: true }).fill('2');
  await t.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await t.getByLabel('Symbol onion skins', { exact: true }).check();
  await expect.poll(pixel).toEqual([191, 191, 255, 255]);
  await t.getByLabel('Symbol onion opacity', { exact: true }).fill('0.5');
  await expect.poll(pixel).toEqual([127, 127, 255, 255]);
  await t.getByLabel('Symbol onion outlines', { exact: true }).check();
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await expect
    .poll(() =>
      t
        .getByLabel('Symbol timeline preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(165, 40, 1, 1).data),
        ),
    )
    .toEqual([127, 127, 255, 255]);
  await t.getByLabel('Symbol onion tint', { exact: true }).check();
  await expect
    .poll(() =>
      t
        .getByLabel('Symbol timeline preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(165, 40, 1, 1).data),
        ),
    )
    .toEqual([127, 255, 127, 255]);
  await t.getByLabel('Symbol onion tint', { exact: true }).uncheck();
  await t.getByLabel('Symbol onion outlines', { exact: true }).uncheck();
  await expect.poll(pixel).toEqual([127, 127, 255, 255]);
  await t.getByLabel('Symbol onion after', { exact: true }).fill('0');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await t.getByLabel('Symbol onion after', { exact: true }).fill('1');
  await t.getByLabel('Symbol frame', { exact: true }).fill('1');
  await t.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await t.getByLabel('Symbol onion keyframes only', { exact: true }).check();
  await expect.poll(pixel).toEqual([127, 127, 255, 255]);
  await t.getByLabel('Symbol onion active layer only', { exact: true }).check();
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('empty');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await t.getByLabel('Symbol layer', { exact: true }).selectOption('@base');
  await expect.poll(pixel).toEqual([127, 127, 255, 255]);
  await t.getByLabel('Symbol onion keyframes only', { exact: true }).uncheck();
  await t.getByLabel('Symbol onion after', { exact: true }).fill('2');
  await expect.poll(pixel).toEqual([191, 191, 255, 255]);
  await t.getByLabel('Symbol onion fade', { exact: true }).uncheck();
  await expect.poll(pixel).toEqual([127, 127, 255, 255]);
  await t.getByLabel('Symbol onion tint', { exact: true }).check();
  await expect.poll(pixel).toEqual([127, 255, 127, 255]);
  await t.getByLabel('Symbol onion future color', { exact: true }).fill('#ff0000');
  await expect.poll(pixel).toEqual([255, 127, 127, 255]);
  await t.getByLabel('Symbol onion tint', { exact: true }).uncheck();
  await expect.poll(pixel).toEqual([127, 127, 255, 255]);
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await t.getByRole('button', { name: 'Stop symbol preview', exact: true }).click();
  await t.getByLabel('Symbol frame', { exact: true }).fill('3');
  await t.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await t.getByLabel('Symbol onion tint', { exact: true }).check();
  await t.getByLabel('Symbol onion past color', { exact: true }).fill('#0000ff');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await expect
    .poll(() =>
      t
        .getByLabel('Symbol timeline preview')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(40, 40, 1, 1).data),
        ),
    )
    .toEqual([127, 127, 255, 255]);

  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
  );
  expect(saved.symbols).toEqual(p.symbols);
});

test('symbol move edge scrolling follows hidden rows and cancels without changing artwork', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'scroll',
    name: 'Scroll',
    width: 20,
    height: 20,
    shapes: [art],
    timeline: {
      duration: 64,
      keys: [],
      layers: Array.from({ length: 15 }, (_, i) => ({
        id: `track-${i}`,
        name: `Track ${i}`,
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: [] }],
      })),
    },
  };
  p.symbols = [d];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Scroll', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const grid = t.getByRole('region', { name: 'Symbol frame grid' });
  const scroll = grid.locator('.scroll');
  const cell = grid.getByRole('button', { name: 'Track 14, frame 2, blank hold', exact: true });
  await cell.click();
  const b = await cell.boundingBox();
  const edge = await scroll.boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(b!.x + 14, b!.y + 14);
  await page.mouse.down();
  await page.mouse.move(b!.x + 14, edge!.y + edge!.height - 12);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(80);
  const top = await scroll.evaluate((el) => el.scrollTop);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(top);
  await page.keyboard.press('Escape');
  const stopped = await scroll.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(240);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBe(stopped);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});

test('symbol preview plays the selected range once or loops without changing artwork', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 10;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'preview',
      name: 'Preview',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: { duration: 8, keys: [] },
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Preview', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await t.getByLabel('Symbol range start', { exact: true }).fill('3');
  await t.getByLabel('Symbol range end', { exact: true }).fill('5');
  await t.getByLabel('Preview selected symbol range', { exact: true }).check();
  await t.getByLabel('Loop symbol preview', { exact: true }).uncheck();
  await t.getByLabel('Symbol range end', { exact: true }).fill('2');
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect(t.getByRole('alert')).toContainText('valid frame range');
  await t.getByLabel('Symbol range end', { exact: true }).fill('5');
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect(t.getByRole('button', { name: 'Play symbol preview', exact: true })).toBeVisible();
  await expect(t.getByLabel('Symbol frame', { exact: true })).toHaveValue('5');
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await expect(t.getByRole('button', { name: 'Stop symbol preview', exact: true })).toBeVisible();
  await expect(t.getByRole('button', { name: 'Play symbol preview', exact: true })).toBeVisible();
  await t.getByLabel('Loop symbol preview', { exact: true }).check();
  await t.getByRole('button', { name: 'Play symbol preview', exact: true }).click();
  await page.waitForTimeout(700);
  await expect(t.getByRole('button', { name: 'Stop symbol preview', exact: true })).toBeVisible();
  const f = Number(await t.getByLabel('Symbol frame', { exact: true }).inputValue());
  expect(f).toBeGreaterThanOrEqual(3);
  expect(f).toBeLessThanOrEqual(5);
  await t.getByRole('button', { name: 'Stop symbol preview', exact: true }).click();
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});

test('symbol-local multi-frame artwork edits stay in draft history and commit together', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await openLibraryTimelineTools(page, 'Range Symbol');
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByLabel('Symbol multi-frame X offset', { exact: true }).fill('5');
  await t.getByRole('button', { name: 'Move symbol range artwork', exact: true }).click();
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeEnabled();
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await t.getByLabel('Symbol multi-frame rotation', { exact: true }).fill('90');
  await t.getByRole('button', { name: 'Transform symbol range artwork', exact: true }).click();
  await expect(t.getByRole('alert')).toHaveCount(0);
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await t.getByRole('button', { name: 'Delete symbol range artwork', exact: true }).click();
  await expect(t.getByRole('alert')).toContainText('Keep artwork on at least one frame of the symbol');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Symbol range start', { exact: true }).fill('3');
  await t.getByRole('button', { name: 'Delete symbol range artwork', exact: true }).click();
  await expect(t.getByRole('alert')).toHaveCount(0);
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  const canvas = t.getByLabel('Symbol timeline preview');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const drag = async (cancel: boolean) => {
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.44);
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Shift');
  };
  await drag(true);
  await expect(t).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await drag(false);
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeEnabled();
  expect(await read()).toEqual(p);
  await applyLibraryTimelineTools(page);
  const result = await read(),
    d = result.symbols![0];
  const dx = d.shapes[0].x - 10;
  expect(dx).toBeGreaterThan(0);
  expect(d.timeline!.keys[0].shapes[0].x).toBeCloseTo(50 + dx);
  expect(d.shapes[0].y).toBe(20);
  expect(d.timeline!.duration).toBe(5);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol range picking and regions preserve groups and exposure identities', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [
        { ...art, groups: ['g'] },
        { ...art, id: 'sibling', x: 35, groups: ['g'] },
      ],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 70 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });

  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  const action = t.getByLabel('Symbol range canvas action');
  const canvas = t.getByLabel('Symbol timeline preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  await t.getByRole('button', { name: 'Clear symbol range selection', exact: true }).click();
  await action.selectOption('point');
  const pt = await at(75, 25);
  await page.mouse.click(pt.x, pt.y);
  await expect(t.getByText('1 objects selected.', { exact: false })).toBeVisible();
  await t.getByLabel('Symbol multi-frame X offset', { exact: true }).fill('5');
  await t.getByRole('button', { name: 'Move symbol range artwork', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  let d = (await read()).symbols![0];
  expect(d.shapes).toEqual(p.symbols![0].shapes);
  expect(d.timeline!.keys[0].shapes[0].x).toBe(75);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByRole('button', { name: 'Clear symbol range selection', exact: true }).click();
  await action.selectOption('box');
  const region = async (cancel: boolean) => {
    const a = await at(5, 15),
      b = await at(60, 45);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await region(true);
  await expect(t.getByText('0 objects selected.', { exact: false })).toBeVisible();
  await region(false);
  await expect(t.getByText('2 objects selected.', { exact: false })).toBeVisible();
  await page.keyboard.down('Alt');
  await region(false);
  await page.keyboard.up('Alt');
  await expect(t.getByText('0 objects selected.', { exact: false })).toBeVisible();
  await action.selectOption('lasso');
  await page.keyboard.down('Shift');
  const points = await Promise.all(
    [
      [5, 15],
      [60, 15],
      [60, 45],
      [5, 45],
      [5, 15],
    ].map(([x, y]) => at(x, y)),
  );
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(t.getByText('2 objects selected.', { exact: false })).toBeVisible();
  await t.getByLabel('Symbol multi-frame X offset', { exact: true }).fill('7');
  await t.getByRole('button', { name: 'Move symbol range artwork', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  d = (await read()).symbols![0];
  expect(d.shapes.map((s) => s.x)).toEqual([17, 42]);
  expect(d.timeline!.keys[0].shapes[0].x).toBe(75);
  expect(d.shapes.every((s) => s.groups?.[0] === 'g')).toBe(true);
});

test('symbol range handles preview cancel scale and rotate with draft undo', async ({ page }) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });

  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByLabel('Symbol multi-frame transform handles').check();
  const canvas = t.getByLabel('Symbol timeline preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const drag = async (x: number, y: number, dx: number, dy: number, cancel: boolean) => {
    const a = await at(x, y),
      b = await at(dx, dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await drag(70, 40, 100, 60, true);
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await drag(70, 40, 100, 60, false);
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeEnabled();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  let d = (await read()).symbols![0];
  expect(d.shapes[0].x).toBeCloseTo(10, 0);
  expect(d.shapes[0].y).toBeCloseTo(20, 0);
  expect(d.shapes[0].transform![0]).toBeCloseTo(1.5, 1);
  expect(d.shapes[0].transform![3]).toBeCloseTo(2, 1);
  expect(d.timeline!.keys[0].shapes[0].x).toBeCloseTo(70, 0);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByLabel('Symbol multi-frame transform handles').check();
  await page.keyboard.down('Shift');
  await drag(40, 20 - 24 / 2.9, 40 + 10 + 24 / 2.9, 30, false);
  await page.keyboard.up('Shift');
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  d = (await read()).symbols![0];
  expect(d.shapes[0].x).toBeCloseTo(50, 0);
  expect(d.shapes[0].y).toBeCloseTo(0, 0);
  expect(d.shapes[0].transform![1]).toBeCloseTo(1, 2);
  expect(d.shapes[0].transform![2]).toBeCloseTo(-1, 2);
});

test('symbol pencil draws smooth and constrained paths with cancellation and local history', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('pencil');
  await t.getByLabel('New symbol line color').fill('#00aa44');
  await t.getByLabel('New symbol line width').fill('3');
  const canvas = t.getByLabel('Symbol artwork preview');
  const draw = async (cancel: boolean, shift = false) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    const p = (x: number, y: number) => ({
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    });
    const a = p(10, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    for (const [x, y] of [
      [30, 80],
      [50, 60],
      [70, 70],
    ]) {
      const q = p(x, y);
      await page.mouse.move(q.x, q.y);
    }
    expect(await read()).toEqual(pOriginal);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  const pOriginal = p;
  await draw(true);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await draw(false);
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByLabel('Symbol pencil smoothing').selectOption('straight');
  await draw(false, true);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = (await read()).symbols![0].shapes;
  expect(shapes).toHaveLength(3);
  expect(shapes[1].kind).toBe('bezier');
  expect(shapes[1].fillEnabled).toBe(false);
  expect(shapes[1].stroke).toBe('#00aa44');
  expect(shapes[1].strokeWidth).toBe(3);
  expect(shapes[1].nodes!.length).toBeGreaterThan(2);
  expect(shapes[2].points).toHaveLength(2);
  expect(shapes[2].height).toBeCloseTo(0);
  expect((await read()).symbols![0].timeline).toEqual(p.symbols![0].timeline);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol Pen authors curves closes paths and keeps unfinished work out of history', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('pen');
  const canvas = t.getByLabel('Symbol artwork preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const click = async (x: number, y: number) => {
    const q = await at(x, y);
    await page.mouse.click(q.x, q.y);
  };
  await click(10, 60);
  await click(30, 80);
  await expect(t.getByRole('button', { name: 'Apply symbol changes', exact: true })).toBeDisabled();
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await expect(t).toBeVisible();
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await click(10, 60);
  const a = await at(40, 60),
    b = await at(50, 70);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await click(70, 60);
  await click(80, 80);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByLabel('Smooth symbol Pen anchors on finish').check();
  await click(10, 80);
  await click(30, 80);
  await click(30, 95);
  await click(10, 80);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const d = (await read()).symbols![0],
    curve = d.shapes[1],
    closed = d.shapes[2];
  expect(curve.kind).toBe('bezier');
  expect(curve.nodes).toHaveLength(3);
  expect(curve.closed).toBe(false);
  expect(curve.fillEnabled).toBe(false);
  const n = curve.nodes![1];
  expect(n.in).toBeDefined();
  expect(n.out).toBeDefined();
  expect(n.in!.x + n.out!.x).toBeCloseTo(2 * n.x);
  expect(n.in!.y + n.out!.y).toBeCloseTo(2 * n.y);
  expect(closed.closed).toBe(true);
  expect(closed.nodes!.every((n) => n.in && n.out)).toBe(true);
  expect(closed.fillEnabled).toBe(true);
  expect(closed.nodes).toHaveLength(3);
  expect(d.timeline).toEqual(p.symbols![0].timeline);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol Pen continues affine endpoints without changing identity paint or cancelled paths', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'bezier' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 3, y: 0 } },
      { x: 20, y: 10, in: { x: 17, y: 10 } },
    ],
    transform: [1, 0.25, 0.5, 1] as [number, number, number, number],
    closed: false,
    fillEnabled: false,
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('pen');
  const canvas = t.getByLabel('Symbol artwork preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const click = async (x: number, y: number) => {
    const q = await at(x, y);
    await page.mouse.click(q.x, q.y);
  };
  await click(35, 35); // affine final endpoint
  await page.keyboard.press('Enter'); // untouched pickup is a no-op
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await click(35, 35);
  await click(60, 50);
  await page.keyboard.press('Escape');
  expect(await read()).toEqual(p);
  await expect(t.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
  await click(10, 20); // reverse first endpoint, swapping existing handles
  const beforeHover = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const q = await at(5, 50);
  await page.mouse.move(q.x, q.y);
  await expect
    .poll(() => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()))
    .not.toBe(beforeHover);
  expect(await read()).toEqual(p);
  await page.mouse.click(q.x, q.y);
  await page.keyboard.press('Enter');
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const d = (await read()).symbols![0],
    result = d.shapes[0];
  expect(d.shapes).toHaveLength(1);
  expect(result.id).toBe('art');
  expect(result.nodes).toHaveLength(3);
  expect(result.fill).toBe(art.fill);
  expect(result.fillEnabled).toBe(false);
  expect(result.transform).toEqual(art.transform);
  const world = (n: { x: number; y: number }) => ({
    x: result.x + n.x + 0.5 * n.y,
    y: result.y + 0.25 * n.x + n.y,
  });
  expect(world(result.nodes![0]).x).toBeCloseTo(35);
  expect(world(result.nodes![0]).y).toBeCloseTo(35);
  expect(world(result.nodes![2]).x).toBeCloseTo(5, 0);
  expect(world(result.nodes![2]).y).toBeCloseTo(50, 0);
  expect(d.timeline).toEqual(p.symbols![0].timeline);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol anchors edit affine nodes and tangents with cancellation conversion and undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'bezier' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 3, y: 0 } },
      { x: 20, y: 10, in: { x: 17, y: 10 }, out: { x: 23, y: 10 } },
      { x: 40, y: 0 },
    ],
    transform: [1, 0.25, 0.5, 1] as [number, number, number, number],
    closed: false,
    fillEnabled: false,
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('option', { name: 'Library item Range Symbol', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('nodes');
  await t.getByLabel('Symbol anchor', { exact: true }).selectOption('1');
  const canvas = t.getByLabel('Symbol artwork preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const drag = async (x: number, y: number, dx: number, dy: number, cancel: boolean) => {
    const a = await at(x, y),
      b = await at(dx, dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await drag(35, 35, 45, 45, true);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await drag(35, 35, 45, 45, false);
  await page.keyboard.down('Alt');
  await drag(48, 45.75, 55, 55, false);
  await page.keyboard.up('Alt');
  await t.getByRole('button', { name: 'Corner symbol anchor', exact: true }).click();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Smooth symbol anchor', exact: true }).click();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Delete symbol anchor', exact: true }).click();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Delete');
  await expect(t.getByLabel('Symbol anchor', { exact: true }).locator('option')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(t.getByLabel('Symbol anchor', { exact: true }).locator('option')).toHaveCount(3);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const result = (await read()).symbols![0].shapes[0],
    n = result.nodes![1];
  expect(result.nodes).toHaveLength(3);
  expect(result.x + n.x + 0.5 * n.y).toBeCloseTo(45, 0);
  expect(result.y + 0.25 * n.x + n.y).toBeCloseTo(45, 0);
  expect(n.in).toBeDefined();
  expect(n.out).toBeDefined();
  expect(result.transform).toEqual(art.transform);
  expect(result.x + n.out!.x + 0.5 * n.out!.y).toBeCloseTo(55, 0);
  expect(result.y + 0.25 * n.out!.x + n.out!.y).toBeCloseTo(55, 0);
  expect(result.x + n.in!.x + 0.5 * n.in!.y).toBeCloseTo(42, 0);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol brush merges fill contours with isolated undo and cancellation', async ({ page }) => {
  await holdGeometry(page);
  const p = newProject();
  p.symbols = [
    {
      id: 'brush',
      name: 'Brush',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#6366f1',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Brush', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await t.getByLabel('Symbol canvas tool').selectOption('brush');
  await t.getByLabel('Symbol brush size').fill('12');
  const canvas = t.getByLabel('Symbol artwork preview');
  const draw = async (cancel = false) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    const q = (x: number, y: number) => ({
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    });
    let a = q(20, 20);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    // Actual live pixels before release: the sample buffer must stay visible to
    // every delivered batch, rather than a cached reactive array length.
    const pixel = (x: number) => canvas.evaluate((c, x) =>
      [...(c as HTMLCanvasElement).getContext('2d')!.getImageData(x, 78, 1, 1).data], x);
    a = q(45, 20);
    await page.mouse.move(a.x, a.y, { steps: 6 });
    await expect.poll(() => pixel(130)).toEqual([99, 102, 241, 255]);
    expect(await pixel(195)).toEqual([255, 255, 255, 255]);
    a = q(65, 20);
    await page.mouse.move(a.x, a.y, { steps: 6 });
    await expect.poll(() => pixel(195)).toEqual([99, 102, 241, 255]);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (!cancel) {
      await expect.poll(() => pendingGeometry(page)).toBe(1);
      const pixel = () =>
        canvas.evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(165, 78, 1, 1).data),
        );
      for (let i = 0; i < 5; i++) {
        await canvas.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
        expect(await pixel()).toEqual([99, 102, 241, 255]);
      }
      await releaseGeometry(page);
    }
    await expect(
      t.getByRole('button', { name: 'Apply symbol changes', exact: true }),
    ).toBeEnabled();
  };
  await draw(true);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await draw();
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes[0]
            .contours?.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes).toHaveLength(1);
  expect(shapes[0].kind).not.toBe('brush');
  // Smoothing belongs to the new stroke before the boolean merge. The original
  // rectangle's sharp corners must survive; refitting the merged result rounded them.
  const outline = shapes[0].contours.flat().map((n: { x: number; y: number }) => worldPoint(shapes[0], n));
  for (const corner of [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }])
    expect(outline.some((p: { x: number; y: number }) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-8)).toBe(true);
});

for (const mode of ['behind', 'fills', 'selection', 'inside', 'inside-empty']) {
  test(`symbol brush ${mode} clips paint and preserves linework with undo`, async ({ page }) => {
    const p = newProject();
    p.symbols = [
      {
        id: 'paint',
        name: 'Paint',
        width: 100,
        height: 100,
        shapes: [
          {
            id: 'base',
            kind: 'rectangle',
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            rotation: 0,
            fill: '#ff0000',
            stroke: '#000000',
            strokeWidth: 4,
            points: [],
          },
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page
      .getByRole('group', { name: 'Symbol Paint', exact: true })
      .getByRole('button', { name: 'Edit symbol artwork', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
    await t.getByLabel('Symbol canvas tool').selectOption('brush');
    await t
      .getByLabel('Symbol brush paint mode')
      .selectOption(mode === 'inside-empty' ? 'inside' : mode);
    await t.getByLabel('Symbol brush size').fill('12');
    await t.getByLabel('New symbol drawing fill').fill('#0000ff');
    const canvas = t.getByLabel('Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    const q = (x: number) => ({
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + 20 * 2.9) * b.height) / 330,
    });
    let a = q(mode === 'inside-empty' ? 65 : 20);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    a = q(mode === 'inside-empty' ? 20 : 65);
    await page.mouse.move(a.x, a.y, { steps: 12 });
    await page.mouse.up();
    await expect(
      t.getByRole('button', { name: 'Apply symbol changes', exact: true }),
    ).toBeEnabled();
    const pixel = async (x: number) =>
      canvas.evaluate(
        (c, x) =>
          Array.from(
            (c as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(Math.round(20 + x * 2.9), 78, 1, 1).data,
          ).slice(0, 3),
        x,
      );
    await expect
      .poll(() => pixel(20))
      .toEqual(mode === 'behind' || mode === 'inside-empty' ? [255, 0, 0] : [0, 0, 255]);
    expect(await pixel(30)).toEqual([0, 0, 0]);
    expect(await pixel(50)).toEqual(
      mode === 'selection' || mode === 'inside' ? [255, 255, 255] : [0, 0, 255],
    );
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    expect(await pixel(50)).toEqual([255, 255, 255]);
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes.some(
            (s: { fill: string }) => s.fill === '#0000ff',
          ),
        ),
      )
      .toBe(true);
  });
}

test('symbol ink changes only stroke with draft undo and no-op history', async ({ page }) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('ink');
  await t.getByLabel('New symbol line color').fill('#0000ff');
  await t.getByLabel('New symbol line width').fill('8');
  const canvas = t.getByLabel('Symbol artwork preview');
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  const click = () => page.mouse.click(b.x + (78 * b.width) / 540, b.y + (78 * b.height) / 330);
  await click();
  await expect(t.getByLabel('Symbol artwork stroke', { exact: true })).toHaveValue('#0000ff');
  await click();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol artwork stroke', { exact: true })).toHaveValue('#000000');
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes).toEqual([{ ...p.symbols[0].shapes[0], stroke: '#0000ff', strokeWidth: 8 }]);
});

async function openSymbolEyedropper(page: Page) {
  await page.getByRole('option', { name: 'Library item Paint', exact: true }).dblclick();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Symbol editing workspace', exact: true });
  await workspace.getByLabel('Symbol canvas tool').selectOption('eyedropper');
  const canvas = workspace.getByLabel('Symbol artwork preview', { exact: true });
  await expect(canvas).toHaveCSS('cursor', /data:image\/svg\+xml/);
  const points = await canvas.evaluate((node: HTMLCanvasElement) => {
    const { data } = node.getContext('2d')!.getImageData(0, 0, node.width, node.height);
    const bounds = node.getBoundingClientRect();
    let left = node.width, top = node.height, right = 0, bottom = 0;
    let sumX = 0, sumY = 0, targetPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % node.width, y = Math.floor(i / 4 / node.width);
      if (data[i] === 18 && data[i + 1] === 170 && data[i + 2] === 34 && data[i + 3] === 255) {
        sumX += x; sumY += y; targetPixels++;
      }
      if (data[i] < 245 || data[i + 1] > 140 || data[i + 2] > 140 || data[i + 3] !== 255) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (top >= bottom || left >= right) throw Error('Expected the symbol fill.');
    const y = bounds.y + (top + bottom) * bounds.height / (2 * node.height);
    return {
      fill: { x: bounds.x + (left + right) * bounds.width / (2 * node.width), y },
      stroke: { x: bounds.x + left * bounds.width / node.width - 2, y },
      blank: { x: bounds.right - 30, y },
      target: targetPixels ? {
        x: bounds.x + sumX * bounds.width / (targetPixels * node.width),
        y: bounds.y + sumY * bounds.height / (targetPixels * node.height),
      } : undefined,
    };
  });
  return { workspace, points };
}

test('symbol eyedropper samples stored paint without history and hands off the next paint click', async ({
  page,
}) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
      ],
    },
  ];
  const source = p.symbols[0].shapes[0];
  const target = { ...source, id: 'target', x: 55, fill: '#12aa22', stroke: '#ffaa00', strokeWidth: 2 };
  p.symbols[0].shapes.push(target);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const { workspace: t, points } = await openSymbolEyedropper(page);
  const keepSampling = t.getByRole('checkbox', { name: 'Keep sampling', exact: true });
  await keepSampling.check();
  await t.getByLabel('New symbol drawing fill').fill('#0000ff');
  await t.getByLabel('New symbol line color').fill('#00ff00');
  await t.getByLabel('New symbol line width').fill('8');
  await page.mouse.click(points.fill.x, points.fill.y);
  await expect(t.getByLabel('New symbol drawing fill')).toHaveValue('#ff0000');
  await expect(t.getByLabel('New symbol line color')).toHaveValue('#00ff00');
  await expect(t.getByLabel('New symbol line width')).toHaveValue('8');
  await t.getByLabel('New symbol drawing fill').fill('#0000ff');
  await page.mouse.click(points.stroke.x, points.stroke.y);
  await expect(t.getByLabel('New symbol drawing fill')).toHaveValue('#0000ff');
  await expect(t.getByLabel('New symbol line color')).toHaveValue('#000000');
  await expect(t.getByLabel('New symbol line width')).toHaveValue('4');
  await t.getByLabel('New symbol line color').fill('#00ff00');
  await t.getByLabel('New symbol line width').fill('8');
  await t.getByLabel('Symbol eyedropper source').selectOption('object');
  await page.mouse.click(points.fill.x, points.fill.y);
  await expect(t.getByLabel('New symbol drawing fill')).toHaveValue('#ff0000');
  await expect(t.getByLabel('New symbol line color')).toHaveValue('#000000');
  await expect(t.getByLabel('New symbol line width')).toHaveValue('4');
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await page.mouse.click(points.blank.x, points.blank.y);
  await expect(t.getByLabel('New symbol drawing fill')).toHaveValue('#ff0000');
  const canvasTool = t.getByLabel('Symbol canvas tool');
  const undo = t.getByRole('button', { name: 'Undo artwork change', exact: true });
  await t.getByLabel('Symbol eyedropper source').selectOption('stored');
  await keepSampling.uncheck();
  await page.mouse.click(points.fill.x, points.fill.y);
  await expect(canvasTool).toHaveValue('bucket');
  await expect(undo).toBeDisabled();
  expect(points.target).toBeDefined();
  await page.mouse.click(points.target!.x, points.target!.y);
  await expect(undo).toBeEnabled();
  await undo.click();
  await canvasTool.selectOption('eyedropper');
  await page.mouse.click(points.stroke.x, points.stroke.y);
  await expect(canvasTool).toHaveValue('ink');
  await expect(undo).toBeDisabled();
  await page.mouse.click(points.target!.x, points.target!.y);
  await expect(undo).toBeEnabled();
  await t.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect.poll(async () => (await read()).symbols![0].shapes).toEqual([
    source, { ...target, stroke: source.stroke, strokeWidth: source.strokeWidth },
  ]);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(read).toEqual(p);
});

test('symbol bucket fills closed outlines with isolated history', async ({ page }) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          fillEnabled: false,
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('bucket');
  await t.getByLabel('New symbol drawing fill').fill('#0000ff');
  const canvas = t.getByLabel('Symbol artwork preview');
  await canvas.scrollIntoViewIfNeeded();
  const click = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + (78 * b.width) / 540, b.y + (78 * b.height) / 330);
  };
  const pixel = () =>
    canvas.evaluate((c) =>
      Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(78, 78, 1, 1).data).slice(
        0,
        3,
      ),
    );
  await click();
  await expect.poll(pixel).toEqual([0, 0, 255]);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect.poll(pixel).toEqual([255, 255, 255]);
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByLabel('New symbol drawing fill').fill('#00ff00');
  await click();
  await expect.poll(pixel).toEqual([0, 255, 0]);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes.some((s: { fill: string }) => s.fill === '#00ff00')).toBe(true);
});

test('symbol bucket gap tolerance closes bounded gaps without changing source outlines', async ({
  page,
}) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'path',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          fillEnabled: false,
          stroke: '#000000',
          strokeWidth: 4,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
            { x: 0, y: 4 },
          ],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('bucket');
  await t.getByLabel('New symbol drawing fill').fill('#0000ff');
  const canvas = t.getByLabel('Symbol artwork preview');
  const click = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + (78 * b.width) / 540, b.y + (78 * b.height) / 330);
  };
  await click();
  await expect(t.getByRole('alert')).toContainText('No enclosed region');
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await t.getByLabel('Symbol bucket gap tolerance').fill('41');
  await click();
  await expect(t.getByRole('alert')).toContainText('between 0 and 40');
  await t.getByLabel('Symbol bucket gap tolerance').fill('4');
  await click();
  await expect
    .poll(() =>
      canvas.evaluate((c) =>
        Array.from(
          (c as HTMLCanvasElement).getContext('2d')!.getImageData(78, 78, 1, 1).data,
        ).slice(0, 3),
      ),
    )
    .toEqual([0, 0, 255]);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes).toEqual(p.symbols[0].shapes);
});

test('symbol rendered eyedropper samples opacity over white without changing line settings or artwork', async ({
  page,
}) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          opacity: 0.5,
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const { workspace: t, points } = await openSymbolEyedropper(page);
  await t.getByLabel('Symbol eyedropper source').selectOption('rendered');
  await t.getByLabel('New symbol line color').fill('#00ff00');
  await t.getByLabel('New symbol line width').fill('8');
  await page.mouse.click(points.fill.x, points.fill.y);
  const sampled = await t.getByLabel('New symbol drawing fill').inputValue();
  expect(['#ff7f7f', '#ff8080']).toContain(sampled);
  await expect(t.getByLabel('New symbol line color')).toHaveValue('#00ff00');
  await expect(t.getByLabel('New symbol line width')).toHaveValue('8');
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await t.getByLabel('Symbol eyedropper source').selectOption('stored');
  await page.keyboard.down('Alt');
  await page.mouse.click(points.blank.x, points.blank.y);
  await page.keyboard.up('Alt');
  await expect(t.getByLabel('New symbol drawing fill')).toHaveValue('#ffffff');
  await t.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes).toEqual(p.symbols[0].shapes);
});

test('symbol gradient authors stops and mapping with isolated undo', async ({ page }) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol fill paint').selectOption('linear');
  await t.getByLabel('Symbol gradient stop 2 color').fill('#0000ff');
  await t.getByRole('button', { name: 'Add symbol gradient stop', exact: true }).click();
  await t.getByLabel('Symbol gradient stop 2 opacity', { exact: true }).fill('50');
  await t.getByLabel('Symbol gradient stop 2 opacity', { exact: true }).press('Tab');
  await t.getByLabel('Symbol gradient to x').fill('40');
  await t.getByLabel('Symbol gradient to x').press('Tab');
  await t.getByLabel('Symbol fill paint').selectOption('solid');
  await expect(t.getByLabel('Symbol gradient to x')).toHaveCount(0);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol gradient to x')).toHaveValue('40');
  await expect(t.getByLabel('Symbol gradient stop 2 opacity', { exact: true })).toHaveValue('50');
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes[0].gradient).toEqual({
    kind: 'linear',
    from: { x: 0, y: 10 },
    to: { x: 40, y: 10 },
    stops: [
      { offset: 0, color: '#ff0000' },
      { offset: 0.5, color: '#800080', opacity: 0.5 },
      { offset: 1, color: '#0000ff' },
    ],
  });
  expect(shapes[0].strokeWidth).toBe(4);
  expect(shapes[0].width).toBe(20);
});

test('symbol gradient transforms paint independently and rejects invalid scale', async ({
  page,
}) => {
  const p = newProject();
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol fill paint').selectOption('radial');
  await t.getByLabel('Symbol gradient aspect').fill('50');
  await t.getByLabel('Symbol gradient skew').fill('20');
  await t.getByRole('button', { name: 'Set symbol gradient shape', exact: true }).click();
  await t.getByLabel('Symbol gradient transform x').fill('5');
  await t.getByLabel('Symbol gradient transform y').fill('7');
  await t.getByLabel('Symbol gradient transform rotation').fill('90');
  await t.getByLabel('Symbol gradient transform scale').fill('0');
  await t.getByRole('button', { name: 'Transform symbol gradient', exact: true }).click();
  await expect(t.getByRole('alert')).toContainText('Invalid gradient transform');
  await expect(t.getByLabel('Symbol gradient from x')).toHaveValue('10');
  await t.getByLabel('Symbol gradient transform scale').fill('200');
  await t.getByRole('button', { name: 'Transform symbol gradient', exact: true }).click();
  await expect(t.getByLabel('Symbol gradient from x')).toHaveValue('15');
  await expect(t.getByLabel('Symbol gradient to y')).toHaveValue('37');
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol gradient from x')).toHaveValue('10');
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes,
  );
  expect(shapes[0].gradient.from).toEqual({ x: 15, y: 17 });
  expect(shapes[0].gradient.transform[0]).toBeCloseTo(0.5);
  expect(shapes[0].gradient.transform[1]).toBeCloseTo(-Math.tan((20 * Math.PI) / 180));
  expect(shapes[0].width).toBe(20);
  expect(shapes[0].x).toBe(10);
  expect(shapes[0].rotation).toBe(0);
});

test('symbol bitmap fill authors mapping and restores paint with undo', async ({ page }) => {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 2, 2);
    return c.toDataURL();
  });
  const p = newProject();
  p.assets = [
    {
      id: 'image',
      path: 'assets/bitmaps/test.json',
      bitmap: { name: 'Green', width: 2, height: 2, dataUrl },
    },
  ];
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol bitmap asset').selectOption('image');
  const canvas = t.getByLabel('Symbol artwork preview');
  await expect
    .poll(() =>
      canvas.evaluate((c) =>
        Array.from(
          (c as HTMLCanvasElement).getContext('2d')!.getImageData(78, 78, 1, 1).data,
        ).slice(0, 3),
      ),
    )
    .toEqual([0, 255, 0]);
  await t.getByRole('button', { name: 'Native symbol bitmap size', exact: true }).click();
  await expect(t.getByLabel('Symbol bitmap width', { exact: true })).toHaveValue('2');
  await t.getByLabel('Repeat symbol bitmap').check();
  await t.getByLabel('Symbol bitmap width', { exact: true }).fill('0');
  await t.getByLabel('Symbol bitmap width', { exact: true }).press('Tab');
  await expect(t.getByRole('alert')).toContainText('dimensions must be positive');
  await t.getByRole('button', { name: 'Fit symbol bitmap', exact: true }).click();
  await expect(t.getByLabel('Symbol bitmap width', { exact: true })).toHaveValue('20');
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol bitmap width', { exact: true })).toHaveValue('2');
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const project = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project,
  );
  expect(project.symbols[0].shapes[0].bitmap).toEqual({
    assetId: 'image',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    repeat: true,
  });
  expect(project.assets).toEqual(p.assets);
});

test('symbol bitmap transforms independently with invalid basis rejection and undo', async ({
  page,
}) => {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 2, 2);
    return c.toDataURL();
  });
  const p = newProject();
  p.assets = [
    {
      id: 'image',
      path: 'assets/bitmaps/test.json',
      bitmap: { name: 'Green', width: 2, height: 2, dataUrl },
    },
  ];
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol bitmap asset').selectOption('image');
  await t.getByLabel('Symbol bitmap transform dx').fill('5');
  await t.getByLabel('Symbol bitmap transform dy').fill('7');
  await t.getByLabel('Symbol bitmap transform rotation').fill('90');
  await t.getByLabel('Symbol bitmap transform scaleX').fill('0');
  await t.getByRole('button', { name: 'Transform symbol bitmap', exact: true }).click();
  await expect(t.getByRole('alert')).toContainText('invertibility limits');
  await expect(t.getByLabel('Symbol bitmap x', { exact: true })).toHaveValue('0');
  await t.getByLabel('Symbol bitmap transform scaleX').fill('-200');
  await t.getByRole('button', { name: 'Transform symbol bitmap', exact: true }).click();
  await expect(t.getByLabel('Symbol bitmap x', { exact: true })).toHaveValue('5');
  await t.getByRole('button', { name: 'Reset symbol bitmap basis', exact: true }).click();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const project = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project,
  );
  const shape = project.symbols[0].shapes[0];
  expect(shape.bitmap.x).toBe(5);
  expect(shape.bitmap.y).toBe(7);
  expect(shape.bitmap.transform[0]).toBeCloseTo(0);
  expect(shape.bitmap.transform[1]).toBeCloseTo(-2);
  expect(shape.bitmap.transform[2]).toBeCloseTo(-1);
  expect(shape.bitmap.transform[3]).toBeCloseTo(0);
  expect(shape.x).toBe(10);
  expect(shape.width).toBe(20);
  expect(shape.rotation).toBe(0);
  expect(project.assets).toEqual(p.assets);
});

test('symbol bitmap handles preview cancel and commit paint-only changes', async ({ page }) => {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 2, 2);
    return c.toDataURL();
  });
  const p = newProject();
  p.assets = [
    {
      id: 'image',
      path: 'assets/bitmaps/test.json',
      bitmap: { name: 'Green', width: 2, height: 2, dataUrl },
    },
  ];
  p.symbols = [
    {
      id: 'paint',
      name: 'Paint',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'base',
          kind: 'rectangle',
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 4,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol bitmap asset').selectOption('image');
  await t.getByLabel('Symbol canvas tool').selectOption('bitmap');
  const canvas = t.getByLabel('Symbol artwork preview');
  const point = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  let a = await point(10, 10),
    b = await point(15, 15);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(t.getByLabel('Symbol bitmap x', { exact: true })).toHaveValue('0');
  a = await point(30, 10);
  b = await point(40, 10);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.mouse.up();
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shape = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes[0],
  );
  expect(shape.bitmap.transform[0]).toBeCloseTo(1.5);
  expect(shape.bitmap.transform.slice(1)).toEqual([0, 0, 1]);
  expect(shape.bitmap.x).toBe(0);
  expect(shape.x).toBe(10);
  expect(shape.width).toBe(20);
});

test('button state preview uses invisible hit artwork and cancels outside releases without edits', async ({
  page,
}) => {
  const p = newProject();
  const shape = {
    id: 'up',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'button',
      name: 'Button',
      width: 100,
      height: 100,
      shapes: [shape],
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...shape, id: 'over', fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...shape, id: 'down', fill: '#0000ff' }] },
          {
            frame: 3,
            shapes: [{ ...shape, id: 'hit', x: 25, y: 25, width: 50, height: 50, fill: '#000000' }],
          },
        ],
      },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await openLibraryTimelineTools(page, 'Button');
  const launch = page.getByRole('button', { name: 'Test button states', exact: true });
  await launch.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Button state test', exact: true });
  const canvas = dialog.getByRole('button', { name: 'Test symbol button', exact: true });
  const remembered = dialog.getByRole('checkbox', { name: 'Use remembered button states' });
  const close = dialog.getByRole('button', { name: 'Close button test', exact: true });
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(remembered).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(remembered).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  const b = (await canvas.boundingBox())!;
  const move = (n: number) =>
    page.mouse.move(
      b.x + ((20 + n * 2.9) * b.width) / 540,
      b.y + ((20 + n * 2.9) * b.height) / 330,
    );
  const pixel = () =>
    canvas.evaluate((el) =>
      Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(165, 165, 1, 1).data),
    );
  await move(10);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.mouse.click(b.x + 25, b.y + 25);
  await expect(dialog.getByText('State: Up · Activations: 0', { exact: true })).toBeVisible();
  await move(50);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await move(10);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect(dialog.getByText('State: Up · Activations: 0', { exact: true })).toBeVisible();
  await move(50);
  await page.mouse.down();
  await move(10);
  await move(50);
  await page.mouse.up();
  await expect(dialog.getByText('State: Over · Activations: 1', { exact: true })).toBeVisible();
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText('State: Over · Activations: 2', { exact: true })).toBeVisible();
  await canvas.press('Enter');
  await expect(dialog.getByText('State: Over · Activations: 3', { exact: true })).toBeVisible();
  await page.keyboard.down('Space');
  await dialog.getByRole('button', { name: 'Close button test', exact: true }).focus();
  await page.keyboard.up('Space');
  await expect(dialog.getByText('State: Up · Activations: 3', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

test('button frame mappings validate preview undo and persist through symbol apply', async ({
  page,
}) => {
  const p = newProject();
  const shape = {
    id: 'up',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'button',
      name: 'Mapped button',
      width: 100,
      height: 100,
      shapes: [shape],
      timeline: {
        duration: 4,
        keys: [{ frame: 2, shapes: [{ ...shape, id: 'blue', fill: '#0000ff' }] }],
      },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const open = () =>
    page
      .getByRole('group', { name: 'Symbol Mapped button', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
  await open();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await timeline.getByLabel('Save button state mapping', { exact: true }).check();
  const up = timeline.getByLabel('Button up frame', { exact: true });
  await up.fill('3');
  await up.press('Tab');
  await timeline.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(up).toHaveValue('1');
  await timeline.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await expect(up).toHaveValue('3');
  await up.fill('5');
  await up.press('Tab');
  await expect(timeline.getByText(/button state frame/)).toBeVisible();
  await timeline.getByLabel('Symbol duration', { exact: true }).fill('2');
  await timeline.getByLabel('Symbol duration', { exact: true }).press('Tab');
  await expect(timeline.getByText(/button state frame/)).toBeVisible();
  await timeline.getByRole('button', { name: 'Test button states', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Button state test', exact: true });
  await expect
    .poll(() =>
      preview
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(165, 165, 1, 1).data),
        ),
    )
    .toEqual([0, 0, 255, 255]);
  await preview.getByRole('button', { name: 'Close button test', exact: true }).click();
  await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await expect
    .poll(async () => (await read()).symbols![0].buttonStates)
    .toEqual({ up: 2, over: 1, down: 2, hit: 3 });
  await open();
  await expect(up).toHaveValue('3');
  await timeline.getByLabel('Save button state mapping', { exact: true }).uncheck();
  await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await expect.poll(async () => (await read()).symbols![0].buttonStates).toBeUndefined();
});

test('root button Test movie switches poses and cancels outside release without edits', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 1;
  const shape = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'b',
      name: 'Button',
      width: 100,
      height: 100,
      shapes: [shape],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...shape, width: 50 }] },
        ],
      },
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  const canvas = dialog.locator('canvas');
  const b = (await canvas.boundingBox())!;
  const move = (x: number) =>
    page.mouse.move(b.x + (x * b.width) / p.width, b.y + (125 * b.height) / p.height);
  const pixel = async () => {
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData((125 * c.width) / 960, (125 * c.height) / 540, 1, 1).data);
    }, png);
  };
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await move(125);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*0/)).toBeVisible();
  await move(125);
  await page.mouse.down();
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*1/)).toBeVisible();
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

for (const nested of [
  false,
  true,
  'one-frame',
  'single-frame',
  'advancing',
  'movie',
  'nested-movie',
  'reentry-movie',
])
  test(`exported buttons use affine Hit, lifetimes and activation details (static parent: ${nested})`, async ({
    page,
  }) => {
    const p = newProject();
    p.width = 400;
    p.height = 240;
    p.duration = 2;
    p.fps = 10;
    const shape = {
      id: 'art',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    p.symbols = [
      {
        id: 'button',
        name: 'Export button',
        width: 100,
        height: 100,
        shapes: [shape],
        buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
        timeline: {
          duration: 4,
          keys: [
            { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
            { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
            { frame: 3, shapes: [{ ...shape, width: 50 }] },
          ],
        },
      },
    ];
    const instance = symbolInstance(p.symbols[0], 100, 100);
    instance.transform = [2, 0, 0, 1];
    p.layers[0].keys = [
      { frame: 0, shapes: [instance] },
      { frame: 1, shapes: [] },
    ];
    let identity = instance.id;
    if (nested) {
      const wrapper = {
        id: 'wrapper',
        name: 'Static wrapper',
        ...(nested === 'one-frame'
          ? { timeline: { duration: 1, keys: [] } }
          : ['advancing', 'movie', 'nested-movie'].includes(String(nested))
            ? { timeline: { duration: 2, keys: [{ frame: 1, shapes: [] }] } }
            : nested === 'single-frame'
              ? { timeline: { duration: 4, keys: [] } }
              : {}),
        width: 400,
        height: 240,
        shapes: [instance],
      };
      p.symbols.push(wrapper);
      const container = symbolInstance(wrapper, 0, 0);
      if (nested === 'single-frame') container.symbolPlayback = { mode: 'single', firstFrame: 3 };
      if (['movie', 'nested-movie', 'reentry-movie'].includes(String(nested)))
        container.symbolPlayback = { mode: 'movie', firstFrame: 0 };
      container.transform = [1, 0.1, 0, 1];
      p.layers[0].keys[0].shapes = [container];
      identity = container.id + '/' + instance.id;
      if (['advancing', 'movie', 'nested-movie'].includes(String(nested)))
        p.layers[0].keys = [p.layers[0].keys[0]];
      if (nested === 'nested-movie') {
        const outer = {
          id: 'outer-movie',
          name: 'Outer movie',
          width: 400,
          height: 240,
          shapes: [container],
        };
        p.symbols.push(outer);
        const root = symbolInstance(outer, 0, 0);
        root.symbolPlayback = { mode: 'movie', firstFrame: 0 };
        p.layers[0].keys[0].shapes = [root];
        identity = root.id + '/' + identity;
      }
    }
    const original = JSON.stringify(p);
    const html = exportHTML(p);
    expect(JSON.stringify(p)).toBe(original);
    await page.evaluate(() => {
      window.requestAnimationFrame = (cb) => {
        (window as unknown as { next: FrameRequestCallback }).next = cb;
        return 1;
      };
    });
    await page.setContent(html);
    await page.evaluate(() => {
      (window as unknown as { events: unknown[] }).events = [];
      document.addEventListener('splash-button-activate', (e) =>
        (window as unknown as { events: unknown[] }).events.push((e as CustomEvent).detail),
      );
    });
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
      )
      .toBe('function');
    const step = (time = 0) =>
      page.evaluate((t) => (window as unknown as { next: FrameRequestCallback }).next(t), time);
    await step();
    const canvas = page.locator('canvas');
    const b = (await canvas.boundingBox())!;
    const move = (x: number) =>
      page.mouse.move(b.x + (x * b.width) / 400, b.y + (125 * b.height) / 240);
    const pixel = () =>
      canvas.evaluate((c) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(150, 125, 1, 1).data),
      );
    await move(250);
    await step();
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await move(150);
    await step();
    await expect.poll(pixel).toEqual([0, 255, 0, 255]);
    await page.mouse.down();
    await step();
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await move(250);
    await step();
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-activations', '0');
    await move(150);
    await page.mouse.down();
    await step(100);
    await step(200);
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-activations', '0');
    await page.mouse.down();
    await page.mouse.up();
    await step(200);
    await expect(canvas).toHaveAttribute('data-activations', '1');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { events: unknown[] }).events))
      .toEqual([
        {
          token: ['advancing', 'movie', 'nested-movie', 'reentry-movie'].includes(String(nested))
            ? expect.any(String)
            : JSON.stringify([p.layers[0].id + '/0', identity, 'button']),
          instanceId: identity,
          symbolId: 'button',
        },
      ]);
    await canvas.focus();
    for (const key of ['Space', 'Enter']) {
      await page.keyboard.down(key);
      await step(200);
      await expect.poll(pixel).toEqual([0, 0, 255, 255]);
      await page.keyboard.press('Escape');
      await step(200);
      await expect.poll(pixel).toEqual([255, 0, 0, 255]);
      await page.keyboard.up(key);
      await expect(canvas).toHaveAttribute('data-activations', '1');
    }
    await move(150);
    await page.mouse.down();
    await step(200);
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await page.keyboard.press('Escape');
    await step(200);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-activations', '1');
    await canvas.focus();
    await page.keyboard.down('Space');
    await step(200);
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await page.keyboard.up('Space');
    await expect(canvas).toHaveAttribute('data-activations', '2');
    await page.keyboard.down('Enter');
    await canvas.evaluate((c) => (c as HTMLCanvasElement).blur());
    await page.keyboard.up('Enter');
    await expect(canvas).toHaveAttribute('data-activations', '2');
    if (['advancing', 'movie', 'nested-movie', 'reentry-movie'].includes(String(nested))) {
      await move(151);
      await page.mouse.down();
      await step(200);
      await expect.poll(pixel).toEqual([0, 0, 255, 255]);
      await step(600);
      await expect.poll(pixel).toEqual([255, 0, 0, 255]);
      await page.mouse.up();
      await expect(canvas).toHaveAttribute('data-activations', '2');
      await canvas.focus();
      await page.keyboard.down('Space');
      await step(600);
      await expect.poll(pixel).toEqual([0, 0, 255, 255]);
      await step(1000);
      await expect.poll(pixel).toEqual([255, 0, 0, 255]);
      await page.keyboard.up('Space');
      await expect(canvas).toHaveAttribute('data-activations', '2');
    }
  });

test('button authoring preview animates nested movies and restarts changed state frames', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 2;
  const shape = {
    id: 'red',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 100,
    height: 100,
    shapes: [shape],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...shape, fill: '#0000ff' }] }] },
  };
  const child = symbolInstance(leaf, 0, 0);
  child.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const graphic = { id: 'graphic', name: 'Graphic', width: 100, height: 100, shapes: [child] };
  const g = symbolInstance(graphic, 0, 0);
  p.symbols = [
    leaf,
    graphic,
    {
      id: 'button',
      name: 'Animated button',
      width: 100,
      height: 100,
      shapes: [g],
      buttonStates: { up: 0, over: 0, down: 1, hit: 2 },
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [structuredClone(g)] },
          { frame: 2, shapes: [{ ...shape, id: 'hit' }] },
        ],
      },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page
    .getByRole('group', { name: 'Symbol Animated button', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await page.getByRole('button', { name: 'Test button states', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Button state test', exact: true });
  const canvas = dialog.locator('canvas');
  const pixel = () =>
    canvas.evaluate((c) =>
      Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(165, 165, 1, 1).data),
    );
  await expect.poll(pixel, { intervals: [20] }).toEqual([0, 0, 255, 255]);
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + (b.width * 165) / 540, b.y + (b.height * 165) / 330);
  await page.mouse.down();
  await expect.poll(pixel, { intervals: [20], timeout: 300 }).toEqual([255, 0, 0, 255]);
  await expect.poll(pixel, { intervals: [20] }).toEqual([0, 0, 255, 255]);
  await page.mouse.up();
  await expect.poll(pixel, { intervals: [20], timeout: 300 }).toEqual([255, 0, 0, 255]);
  await dialog.getByRole('button', { name: 'Close button test', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

test('stage button poses run nested movies independently and restart changed states', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 2;
  p.duration = 1;
  const shape = {
    id: 'red',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 100,
    height: 100,
    shapes: [shape],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...shape, fill: '#0000ff' }] }] },
  };
  const child = symbolInstance(leaf, 0, 0);
  child.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const graphic = { id: 'graphic', name: 'Graphic', width: 100, height: 100, shapes: [child] };
  const g = symbolInstance(graphic, 0, 0);
  p.symbols = [
    leaf,
    graphic,
    {
      id: 'button',
      name: 'Animated button',
      width: 100,
      height: 100,
      shapes: [g],
      buttonStates: { up: 0, over: 0, down: 1, hit: 2 },
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [structuredClone(g)] },
          { frame: 2, shapes: [{ ...shape, id: 'hit' }] },
        ],
      },
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[2], 0, 0)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
  const canvas = dialog.locator('canvas');
  const pixel = async () => {
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData((50 * c.width) / 960, (50 * c.height) / 540, 1, 1).data);
    }, png);
  };
  await expect.poll(pixel, { intervals: [20] }).toEqual([0, 0, 255, 255]);
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + (b.width * 50) / 960, b.y + (b.height * 50) / 540);
  await page.mouse.down();
  await expect.poll(pixel, { intervals: [20], timeout: 300 }).toEqual([255, 0, 0, 255]);
  await expect.poll(pixel, { intervals: [20] }).toEqual([0, 0, 255, 255]);
  await page.mouse.up();
  await expect.poll(pixel, { intervals: [20], timeout: 300 }).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

for (const nested of [false, true, 'one-frame', 'single-frame', 'advancing', 'movie', 'button'])
  test(`exported button movies preserve states and reentry (static parent: ${nested})`, async ({
    page,
  }) => {
    const p = newProject();
    p.fps = 2;
    p.duration = 4;
    p.width = 400;
    p.height = 240;
    const shape = {
      id: 'red',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const leaf = {
      id: 'leaf',
      name: 'Leaf',
      width: 100,
      height: 100,
      shapes: [shape],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...shape, fill: '#0000ff' }] }] },
    };
    const child = symbolInstance(leaf, 0, 0);
    child.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    const graphic = { id: 'graphic', name: 'Graphic', width: 100, height: 100, shapes: [child] };
    const g = symbolInstance(graphic, 0, 0);
    p.symbols = [
      leaf,
      graphic,
      {
        id: 'button',
        name: 'Animated button',
        width: 100,
        height: 100,
        shapes: [g],
        buttonStates: { up: 0, over: 0, down: 1, hit: 2 },
        timeline: {
          duration: 3,
          keys: [
            { frame: 1, shapes: [structuredClone(g)] },
            { frame: 2, shapes: [{ ...shape, id: 'hit' }] },
          ],
        },
      },
    ];
    const first = symbolInstance(p.symbols[2], 0, 0);
    const second = symbolInstance(p.symbols[2], 200, 0);
    first.transform = [1.5, 0, 0, 1];
    p.layers[0].keys = [
      { frame: 0, shapes: [first, second] },
      { frame: 2, shapes: [second] },
    ];
    if (nested) {
      const wrapper = {
        id: 'static',
        name: 'Static graphic',
        ...(nested === 'button' ? { buttonStates: { up: 0, over: 0, down: 0, hit: 0 } } : {}),
        ...(nested === 'one-frame'
          ? { timeline: { duration: 1, keys: [] } }
          : nested === 'single-frame' || nested === 'advancing' || nested === 'movie'
            ? { timeline: { duration: 4, keys: [] } }
            : {}),
        width: 100,
        height: 100,
        shapes: [
          symbolInstance(p.symbols[2], 0, 0),
          ...(nested === 'button'
            ? [
                {
                  ...symbolInstance(leaf, 0, 120),
                  id: 'sibling-movie',
                  symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
                },
              ]
            : []),
        ],
      };
      p.symbols.push(wrapper);
      for (const key of p.layers[0].keys)
        key.shapes = key.shapes.map((source) => ({
          ...symbolInstance(wrapper, source.x, source.y),
          ...(nested === 'single-frame'
            ? { symbolPlayback: { mode: 'single' as const, firstFrame: 3 } }
            : {}),
          ...(nested === 'movie'
            ? { symbolPlayback: { mode: 'movie' as const, firstFrame: 1 } }
            : {}),
          transform: source.transform,
        }));
    }
    const before = JSON.stringify(p);
    const html = exportHTML(p);
    expect(JSON.stringify(p)).toBe(before);
    await page.evaluate(() => {
      window.requestAnimationFrame = (cb) => {
        (window as unknown as { next: FrameRequestCallback }).next = cb;
        return 1;
      };
    });
    await page.setContent(html);
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
      )
      .toBe('function');
    const step = (time: number) =>
      page.evaluate((t) => (window as unknown as { next: FrameRequestCallback }).next(t), time);
    const canvas = page.locator('canvas');
    const pixel = (x: number) =>
      canvas.evaluate(
        (c, x) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, 50, 1, 1).data),
        x,
      );
    const red = [255, 0, 0, 255],
      blue = [0, 0, 255, 255];
    await step(0);
    expect(await pixel(125)).toEqual(red);
    expect(await pixel(250)).toEqual(red);
    await step(500);
    expect(await pixel(125)).toEqual(blue);
    const b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + (125 * b.width) / 400, b.y + (50 * b.height) / 240);
    await step(500); // Up and Over share their display frame.
    expect(await pixel(125)).toEqual(blue);
    await page.mouse.down();
    await step(500);
    expect(await pixel(125)).toEqual(red);
    expect(await pixel(250)).toEqual(blue); // Other instance's clock is untouched.
    if (nested === 'button')
      expect(
        await canvas.evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 170, 1, 1).data),
        ),
      ).toEqual(blue);

    await step(999);
    expect(await pixel(125)).toEqual(red);
    await step(1000); // First exposure disappears and cancels the press.
    await step(2000); // Root loops and the first exposure starts fresh.
    expect(await pixel(125)).toEqual(red);
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-activations', '0');
    await step(2500);
    expect(await pixel(125)).toEqual(blue);
    await page.mouse.down();
    await step(2500);
    expect(await pixel(125)).toEqual(red);
    await page.mouse.up();
    await step(2500); // Return to the shared Up/Over frame starts fresh.
    expect(await pixel(125)).toEqual(red);
    await expect(canvas).toHaveAttribute('data-activations', '1');
  });

test('exported buttons cancel skipped reentry while whole-timeline holds keep movie continuity', async ({
  page,
}) => {
  const p = newProject();
  p.fps = 2;
  p.duration = 4;
  p.width = 400;
  p.height = 240;
  const shape = {
    id: 'red',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 100,
    height: 100,
    shapes: [shape],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...shape, fill: '#0000ff' }] }] },
  };
  const child = symbolInstance(leaf, 0, 0);
  child.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const graphic = { id: 'graphic', name: 'Graphic', width: 100, height: 100, shapes: [child] };
  const g = symbolInstance(graphic, 0, 0);
  p.symbols = [
    leaf,
    graphic,
    {
      id: 'button',
      name: 'Animated button',
      width: 100,
      height: 100,
      shapes: [g],
      buttonStates: { up: 0, over: 0, down: 1, hit: 2 },
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [structuredClone(g)] },
          { frame: 2, shapes: [{ ...shape, id: 'hit' }] },
        ],
      },
    },
  ];
  const first = symbolInstance(p.symbols[2], 0, 0);
  const second = symbolInstance(p.symbols[2], 200, 0);
  first.transform = [1.5, 0, 0, 1];
  p.layers[0].keys = [
    { frame: 0, shapes: [first] },
    { frame: 2, shapes: [] },
  ];
  p.layers.push({
    ...structuredClone(p.layers[0]),
    id: 'continuous',
    keys: [{ frame: 0, shapes: [second] }],
  });
  const before = JSON.stringify(p);
  const html = exportHTML(p);
  expect(JSON.stringify(p)).toBe(before);
  await page.evaluate(() => {
    window.requestAnimationFrame = (cb) => {
      (window as unknown as { next: FrameRequestCallback }).next = cb;
      return 1;
    };
  });
  await page.setContent(html);
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
    )
    .toBe('function');
  const step = (time: number) =>
    page.evaluate((t) => (window as unknown as { next: FrameRequestCallback }).next(t), time);
  const canvas = page.locator('canvas');
  const pixel = (x: number) =>
    canvas.evaluate(
      (c, x) =>
        Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(x, 50, 1, 1).data),
      x,
    );
  const red = [255, 0, 0, 255],
    blue = [0, 0, 255, 255];
  await step(0);
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + (125 * b.width) / 400, b.y + (50 * b.height) / 240);
  await page.mouse.down();
  await step(0);
  await step(500);
  expect(await pixel(125)).toEqual(blue);
  expect(await pixel(250)).toEqual(blue);
  await step(3000000500); // Six million frames skipped; current root frame is unchanged.
  expect(await pixel(125)).toEqual(red);
  expect(await pixel(250)).toEqual(blue); // Continuous full-timeline exposure stays alive.
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '0');
  await canvas.focus();
  await page.keyboard.down('Space');
  await step(3000000500);
  await step(3000002500); // Keyboard activation must also expire across an unseen gap.
  await page.keyboard.up('Space');
  await expect(canvas).toHaveAttribute('data-activations', '0');
});

test('symbol range edge skew preserves draft isolation, cancellation and project undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });

  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByLabel('Symbol multi-frame transform handles').check();
  const canvas = t.getByLabel('Symbol timeline preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const drag = async (x: number, y: number, dx: number, dy: number, cancel: boolean) => {
    const a = await at(x, y),
      b = await at(dx, dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  const undo = t.getByRole('button', { name: 'Undo symbol timeline change', exact: true });
  await drag(40, 20, 50, 24, true);
  await expect(undo).toBeDisabled();
  await drag(40, 20, 50, 24, false);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await t.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const skewed = await read();
  const d = skewed.symbols![0];
  expect(d.shapes[0].x).toBeCloseTo(20, 0);
  expect(d.timeline!.keys[0].shapes[0].x).toBeCloseTo(60, 0);
  expect(d.shapes[0].y).toBe(20);
  expect(d.shapes[0].transform![2]).toBeCloseTo(-0.5, 1);
  expect(d.timeline!.keys.map((k) => k.frame)).toEqual([2]);
  expect(d.timeline!.duration).toBe(5);
  expect(d.shapes[0].fill).toBe(art.fill);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(skewed);
  await page.keyboard.press('Control+z');
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByLabel('Symbol multi-frame transform handles').check();
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await drag(70, 30, 70, 40, false);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const pivoted = (await read()).symbols![0];
  const shear = Math.tan(Math.PI / 12);
  expect(pivoted.shapes[0].transform![1]).toBeCloseTo(shear, 5);
  expect(pivoted.shapes[0].y).toBeCloseTo(20 + shear * (10 - 40), 4);
  expect(pivoted.timeline!.keys[0].shapes[0].y).toBeCloseTo(20 + shear * (50 - 40), 4);
});

test('symbol range pivot dragging cancels without history and drives shared-pivot transforms', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });

  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  await t.getByLabel('Symbol multi-frame transform handles').check();
  const canvas = t.getByLabel('Symbol timeline preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const drag = async (x: number, y: number, dx: number, dy: number, cancel: boolean) => {
    const a = await at(x, y),
      b = await at(dx, dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  const x = t.getByLabel('Symbol multi-frame pivot X', { exact: true });
  const y = t.getByLabel('Symbol multi-frame pivot Y', { exact: true });
  await drag(40, 30, 55, 40, true);
  await expect(x).toHaveValue('40');
  await expect(y).toHaveValue('30');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await page.keyboard.down('Shift');
  await drag(40, 30, 55, 40, false);
  await page.keyboard.up('Shift');
  expect(Number(await x.inputValue())).toBeCloseTo(55, 0);
  await expect(y).toHaveValue('30');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Symbol multi-frame rotation', { exact: true }).fill('180');
  await t.getByRole('button', { name: 'Transform symbol range artwork', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const d = (await read()).symbols![0];
  expect(d.shapes[0].x).toBeCloseTo(100, 0);
  expect(d.shapes[0].y).toBeCloseTo(40, 0);
  expect(d.timeline!.keys[0].shapes[0].x).toBeCloseTo(60, 0);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('buttons nested below static graphics route affine Hit and keyboard interactions without edits', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 1;
  const shape = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'b',
      name: 'Button',
      width: 100,
      height: 100,
      shapes: [shape],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...shape, width: 50 }] },
        ],
      },
    },
  ];
  const inner = {
    id: 'inner',
    name: 'Inner static graphic',
    width: 100,
    height: 100,
    shapes: [symbolInstance(p.symbols[0], 0, 0)],
  };
  const outer = {
    id: 'outer',
    name: 'Outer static graphic',
    width: 100,
    height: 100,
    shapes: [symbolInstance(inner, 0, 0)],
  };
  p.symbols.push(inner, outer);
  const container = symbolInstance(outer, 100, 100);
  container.transform = [1, 0.2, 0.3, 1];
  p.layers[0].keys[0].shapes = [container];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  const canvas = dialog.locator('canvas');
  const b = (await canvas.boundingBox())!;
  const move = (x: number) =>
    page.mouse.move(b.x + (x * b.width) / p.width, b.y + (125 * b.height) / p.height);
  const pixel = async () => {
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData((125 * c.width) / 960, (125 * c.height) / 540, 1, 1).data);
    }, png);
  };
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await move(125);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*0/)).toBeVisible();
  await move(125);
  await page.mouse.down();
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*1/)).toBeVisible();
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

test('symbol range reversal preserves outside holds and isolated draft and project undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'spans',
    name: 'Spans',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 5, shapes: [] },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openLibraryTimelineTools(page, 'Spans');
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('7');
  await click('Reverse symbol frame range');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await expect(t.getByRole('button', { name: 'Artwork, frame 4, key', exact: true })).toBeVisible();
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  expect(await read()).toEqual(before);
  await click('Undo symbol timeline change');
  await expect(t.getByRole('button', { name: 'Artwork, frame 3, key', exact: true })).toBeVisible();
  await click('Redo symbol timeline change');
  await t.getByLabel('Symbol range start', { exact: true }).fill('1');
  await t.getByLabel('Symbol range end', { exact: true }).fill('8');
  await click('Reverse symbol frame range');
  await expect(t.getByRole('button', { name: 'Artwork, frame 1, blank key', exact: true })).toBeVisible();
  await click('Undo symbol timeline change');
  await applyLibraryTimelineTools(page);
  const committed = await read();
  expect(committed.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([1, 3, 6, 7]);
  expect(committed.symbols![0].timeline!.keys.map((k) => k.shapes[0]?.fill ?? null)).toEqual([
    null,
    '#0000ff',
    '#ff0000',
    null,
  ]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('symbol checked-track reversal rejects protected tracks and commits one isolated history step', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'bulk',
    name: 'Bulk',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [{ frame: 2, shapes: [] }],
      layers: [
        {
          id: 'other',
          name: 'Other',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [{ ...art, fill: '#0000ff' }] },
            { frame: 5, shapes: [] },
          ],
        },
        {
          id: 'locked',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Bulk', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('7');
  await click('Select all symbol tracks');
  await click('Reverse range on selected symbol tracks');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Include symbol track Protected', { exact: true }).uncheck();
  await click('Reverse range on selected symbol tracks');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 2, blank key', exact: true }),
  ).toBeVisible();
  await expect(t.getByRole('button', { name: 'Other, frame 4, key', exact: true })).toBeVisible();
  expect(await read()).toEqual(before);
  await click('Undo symbol timeline change');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 3, blank key', exact: true }),
  ).toBeVisible();
  await click('Redo symbol timeline change');
  await click('Apply symbol timeline');
  const committed = await read();
  expect(committed.symbols![0].timeline!.duration).toBe(8);
  expect(committed.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([1, 6, 7]);
  expect(committed.symbols![0].timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 1, 3, 7]);
  expect(committed.symbols![0].timeline!.layers![1]).toEqual(
    before.symbols![0].timeline!.layers![1],
  );
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('buttons nested below one-frame graphic timelines retain affine interaction without edits', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 1;
  const shape = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'b',
      name: 'Button',
      width: 100,
      height: 100,
      shapes: [shape],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...shape, width: 50 }] },
        ],
      },
    },
  ];
  const inner = {
    id: 'inner',
    name: 'Inner static graphic',
    timeline: { duration: 1, keys: [] },
    width: 100,
    height: 100,
    shapes: [symbolInstance(p.symbols[0], 0, 0)],
  };
  const outer = {
    id: 'outer',
    name: 'Outer static graphic',
    timeline: { duration: 1, keys: [] },
    width: 100,
    height: 100,
    shapes: [symbolInstance(inner, 0, 0)],
  };
  p.symbols.push(inner, outer);
  const container = symbolInstance(outer, 100, 100);
  container.transform = [1, 0.2, 0.3, 1];
  p.layers[0].keys[0].shapes = [container];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  const canvas = dialog.locator('canvas');
  const b = (await canvas.boundingBox())!;
  const move = (x: number) =>
    page.mouse.move(b.x + (x * b.width) / p.width, b.y + (125 * b.height) / p.height);
  const pixel = async () => {
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData((125 * c.width) / 960, (125 * c.height) / 540, 1, 1).data);
    }, png);
  };
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await move(125);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*0/)).toBeVisible();
  await move(125);
  await page.mouse.down();
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*1/)).toBeVisible();
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

for (const parentMode of ['graphic', 'movie', 'nested-movie', 'reentry-movie'])
  test(`advancing ${parentMode} parents route affine buttons and cancel observed and skipped reentry`, async ({
    page,
  }) => {
    const p = newProject();
    p.duration = 4;
    p.fps = 1;
    const shape = {
      id: 'a',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    p.symbols = [
      {
        id: 'b',
        name: 'Button',
        width: 100,
        height: 100,
        shapes: [shape],
        buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
        timeline: {
          duration: 4,
          keys: [
            { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
            { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
            { frame: 3, shapes: [{ ...shape, width: 50 }] },
          ],
        },
      },
    ];
    const inner = {
      id: 'inner',
      name: 'Inner static graphic',
      timeline: {
        duration: 4,
        keys: [
          { frame: 2, shapes: [] },
          { frame: 3, shapes: [symbolInstance(p.symbols[0], 0, 0)] },
        ],
      },
      width: 100,
      height: 100,
      shapes: [symbolInstance(p.symbols[0], 0, 0)],
    };
    const outer = {
      id: 'outer',
      name: 'Outer static graphic',
      timeline: { duration: 4, keys: [] },
      width: 100,
      height: 100,
      shapes: [symbolInstance(inner, 0, 0)],
    };
    if (parentMode === 'nested-movie')
      outer.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 0 };
    p.symbols.push(inner, outer);
    const container = symbolInstance(outer, 100, 100);
    if (parentMode !== 'graphic') container.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    container.transform = [1, 0.2, 0.3, 1];
    p.layers[0].keys[0].shapes = [container];
    if (parentMode === 'reentry-movie') p.layers[0].keys.push({ frame: 2, shapes: [] });
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      p,
    );
    await page.addInitScript(() => {
      const actual = window.requestAnimationFrame.bind(window);
      (window as unknown as { testTime: number }).testTime = 0;
      window.requestAnimationFrame = (cb) =>
        actual(() => cb((window as unknown as { testTime: number }).testTime));
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+Enter');
    const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
    await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
    const canvas = dialog.locator('canvas');
    if (parentMode === 'movie' || parentMode === 'nested-movie')
      await dialog.dispatchEvent('keydown', { key: 'Enter', bubbles: true });
    const b = (await canvas.boundingBox())!;
    const move = (x: number) =>
      page.mouse.move(b.x + (x * b.width) / p.width, b.y + (125 * b.height) / p.height);
    const pixel = async () => {
      const png = (await canvas.screenshot()).toString('base64');
      return page.evaluate(async (encoded) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + encoded;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return Array.from(
          ctx.getImageData((125 * c.width) / 960, (125 * c.height) / 540, 1, 1).data,
        );
      }, png);
    };
    await move(175);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await move(125);
    await expect.poll(pixel).toEqual([0, 255, 0, 255]);
    await page.mouse.down();
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await move(175);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await page.mouse.up();
    await expect(dialog.getByText(/Activations:\s*0/)).toBeVisible();
    await move(125);
    await page.mouse.down();
    await page.mouse.up();
    await expect(dialog.getByText(/Activations:\s*1/)).toBeVisible();
    await canvas.focus();
    await page.keyboard.down('Space');
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await page.keyboard.up('Space');
    await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
    await move(125);
    await page.mouse.down();
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await page.evaluate(() => {
      (window as unknown as { testTime: number }).testTime = 2000;
    });
    await expect(dialog.getByText(/Button test:/)).toHaveCount(0);
    await page.mouse.up();
    await page.evaluate(() => {
      (window as unknown as { testTime: number }).testTime = 4000;
    });
    await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
    await move(126);
    await page.mouse.down();
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await page.evaluate(() => {
      (window as unknown as { testTime: number }).testTime = 8000;
    });
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await page.mouse.up();
    await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
    await canvas.focus();
    await page.keyboard.down('Space');
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await page.evaluate(() => {
      (window as unknown as { testTime: number }).testTime = 12000;
    });
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await page.keyboard.up('Space');
    await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
      .toBe(before);
  });

for (const kind of ['linear', 'radial'] as const)
  test(`symbol ${kind} gradient handles preview cancel and commit paint-only changes`, async ({
    page,
  }) => {
    const p = newProject();
    p.symbols = [
      {
        id: 'paint',
        name: 'Paint',
        width: 100,
        height: 100,
        shapes: [
          {
            id: 'base',
            kind: 'rectangle',
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            rotation: 0,
            ...(kind === 'radial'
              ? { transform: [1, 0.2, 0.3, 1] as [number, number, number, number] }
              : {}),
            fill: '#ff0000',
            gradient: {
              kind,
              ...(kind === 'radial'
                ? { transform: [1, 0, 0.5, 1] as [number, number, number, number] }
                : {}),
              from: { x: 0, y: 0 },
              to: { x: 20, y: 0 },
              stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
              ],
            },
            stroke: '#000000',
            strokeWidth: 4,
            points: [],
          },
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page
      .getByRole('group', { name: 'Symbol Paint', exact: true })
      .getByRole('button', { name: 'Edit symbol artwork', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

    await t.getByLabel('Symbol canvas tool').selectOption('gradient');
    const canvas = t.getByLabel('Symbol artwork preview');
    const point = async (x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const b = (await canvas.boundingBox())!;
      if (kind === 'radial') {
        const u = x - 10,
          v = y - 10;
        x = 10 + u + 0.3 * v;
        y = 10 + 0.2 * u + v;
      }
      return {
        x: b.x + ((20 + x * 2.9) * b.width) / 540,
        y: b.y + ((20 + y * 2.9) * b.height) / 330,
      };
    };
    let a = await point(10, 10),
      b = await point(15, 15);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(t.getByLabel('Symbol gradient from x', { exact: true })).toHaveValue('0');
    a = await point(30, 10);
    b = await point(40, 10);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    a = await point(kind === 'radial' ? 25 : 10, 40);
    b = await point(kind === 'radial' ? 35 : 20, 40);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const shape = await page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols[0].shapes[0],
    );
    expect(shape.gradient.to.x).toBeCloseTo(30);
    expect(shape.gradient.to.y).toBeCloseTo(0);
    expect(shape.gradient.from).toEqual({ x: 0, y: 0 });
    expect(shape.gradient.transform[2]).toBeCloseTo(kind === 'radial' ? 5 / 6 : 1 / 3);
    expect(shape.gradient.transform[3]).toBeCloseTo(1);
    expect(shape.x).toBe(10);
    expect(shape.width).toBe(20);
  });

test('symbol initial Artwork span swaps validate atomically and preserve draft and project undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'bulk',
    name: 'Bulk',
    width: 80,
    height: 60,
    shapes: [art],
    timeline: {
      duration: 8,
      keys: [{ frame: 2, shapes: [] }],
      layers: [
        {
          id: 'other',
          name: 'Other',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [{ ...art, fill: '#0000ff' }] },
            { frame: 5, shapes: [] },
          ],
        },
        {
          id: 'locked',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Bulk', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('1');
  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Include symbol track Artwork', { exact: true }).check();
  await t.getByLabel('Include symbol track Other', { exact: true }).check();
  await t.getByLabel('Symbol range destination frame', { exact: true }).fill('1');
  await t.getByLabel('Symbol span destination @base', { exact: true }).selectOption('other');
  await click('Move selected symbol spans to destination');
  await expect(t.getByRole('alert')).toContainText('distinct');
  await t.getByLabel('Symbol span destination other', { exact: true }).selectOption('locked');
  await click('Move selected symbol spans to destination');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await t.getByLabel('Symbol span destination other', { exact: true }).selectOption('@base');
  await click('Move selected symbol spans to destination');
  await expect(t.getByRole('alert')).toHaveCount(0);
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await click('Undo symbol timeline change');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await click('Redo symbol timeline change');
  await click('Apply symbol timeline');
  const after = await read(),
    timeline = after.symbols![0].timeline!;
  expect(after.symbols![0].shapes[0].fill).toBe('#0000ff');
  expect(timeline.keys.find((k) => k.frame === 4)!.shapes).toEqual([]);
  expect(timeline.layers![0].keys[0].shapes[0].fill).toBe('#ff0000');
  expect(timeline.layers![0].keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  expect(timeline.layers![0].keys.find((k) => k.frame === 4)!.shapes[0].fill).toBe('#0000ff');
  expect(timeline.layers![1]).toEqual(d.timeline.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol Alt-click inserts an affine curve anchor without changing paint and undoes locally', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'bezier' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 3, y: 0 } },
      { x: 20, y: 10, in: { x: 17, y: 10 }, out: { x: 23, y: 10 } },
      { x: 40, y: 0 },
    ],
    transform: [1, 0.25, 0.5, 1] as [number, number, number, number],
    closed: false,
    fillEnabled: false,
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('option', { name: 'Library item Range Symbol', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('nodes');
  await t.getByLabel('Symbol anchor', { exact: true }).selectOption('1');
  const canvas = t.getByLabel('Symbol artwork preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const options = t.getByLabel('Symbol anchor', { exact: true }).locator('option');
  const midpoint = await at(22.5, 27.5);
  await page.mouse.click(midpoint.x, midpoint.y);
  await expect(options).toHaveCount(3);
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.keyboard.up('Shift');
  await expect(options).toHaveCount(3);
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.keyboard.up('Alt');
  await expect(options).toHaveCount(4);
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(options).toHaveCount(3);
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await expect(options).toHaveCount(4);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const result = (await read()).symbols![0].shapes[0];
  expect(result.nodes).toHaveLength(4);
  expect(result.nodes![1].x).toBeCloseTo(10, 0);
  expect(result.nodes![1].y).toBeCloseTo(5, 0);
  expect(result.nodes![1].in).toBeDefined();
  expect(result.nodes![1].out).toBeDefined();
  expect({ ...result, nodes: art.nodes }).toEqual(art);
  expect((await read()).symbols![0].timeline).toEqual(p.symbols![0].timeline);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

for (const ring of [0, 1])
  test(`symbol compound closing-seam insertion preserves the other ring (${ring})`, async ({
    page,
  }) => {
    const p = newProject();
    const art: Project['layers'][number]['keys'][number]['shapes'][number] = {
      id: 'art',
      kind: 'polygon',
      fillRule: 'evenodd',
      x: 60,
      y: 20,
      width: 40,
      height: 40,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      transform: [-1, 0.25, 0.5, 1],
      contours: [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 40 },
          { x: 0, y: 40 },
        ],
        [
          { x: 10, y: 10 },
          { x: 10, y: 30 },
          { x: 30, y: 30 },
          { x: 30, y: 10 },
        ],
      ],
    };
    p.symbols = [
      {
        id: 'range-symbol',
        name: 'Range Symbol',
        width: 100,
        height: 100,
        shapes: [art],
        timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    await page
      .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
      .getByRole('button', { name: 'Edit symbol artwork', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

    await t.getByLabel('Symbol canvas tool').selectOption('nodes');
    await t.getByLabel('Symbol anchor', { exact: true }).selectOption('1');
    const canvas = t.getByLabel('Symbol artwork preview');
    const at = async (x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const b = (await canvas.boundingBox())!;
      return {
        x: b.x + ((20 + x * 2.9) * b.width) / 540,
        y: b.y + ((20 + y * 2.9) * b.height) / 330,
      };
    };
    const options = t.getByLabel('Symbol anchor', { exact: true }).locator('option');
    const midpoint = ring === 0 ? await at(70, 40) : await at(45, 35);
    await page.mouse.click(midpoint.x, midpoint.y);
    await expect(options).toHaveCount(8);
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.mouse.click(midpoint.x, midpoint.y);
    await page.keyboard.up('Shift');
    await expect(options).toHaveCount(8);
    await page.mouse.click(midpoint.x, midpoint.y);
    await page.keyboard.up('Alt');
    await expect(options).toHaveCount(9);
    expect(await read()).toEqual(p);
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(options).toHaveCount(8);
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await expect(options).toHaveCount(9);
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const result = (await read()).symbols![0].shapes[0];
    expect(result.contours![ring]).toHaveLength(5);
    expect(result.contours![1 - ring]).toEqual(art.contours![1 - ring]);
    const inserted = result.contours![ring][4];
    expect(inserted.x).toBeCloseTo(ring === 0 ? 0 : 20, 0);
    expect(inserted.y).toBeCloseTo(ring === 0 ? 20 : 10, 0);
    expect(inserted.in).toBeDefined();
    expect(inserted.out).toBeDefined();
    expect({ ...result, contours: art.contours }).toEqual(art);
    expect((await read()).symbols![0].timeline).toEqual(p.symbols![0].timeline);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  });

test('symbol multi-anchor selection moves and nudges together with guarded deletion and undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'bezier' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 3, y: 0 } },
      { x: 20, y: 10, in: { x: 17, y: 10 }, out: { x: 23, y: 10 } },
      { x: 40, y: 0 },
      { x: 60, y: 0 },
    ],
    transform: [1, 0.25, 0.5, 1] as [number, number, number, number],
    closed: false,
    fillEnabled: false,
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('option', { name: 'Library item Range Symbol', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

  await t.getByLabel('Symbol canvas tool').selectOption('nodes');
  await t.getByLabel('Symbol anchor', { exact: true }).selectOption('0');
  const canvas = t.getByLabel('Symbol artwork preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  const drag = async (x: number, y: number, dx: number, dy: number, cancel: boolean) => {
    const a = await at(x, y),
      b = await at(dx, dy);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  const second = await at(35, 35);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(t.getByLabel('Selected symbol anchors')).toHaveText('2 anchors selected');
  await drag(10, 20, 20, 30, true);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await drag(10, 20, 20, 30, false);
  await page.keyboard.press('ArrowRight');
  await t.getByRole('button', { name: 'Select all symbol anchors', exact: true }).click();
  await expect(t.getByLabel('Selected symbol anchors')).toHaveText('4 anchors selected');
  await t.getByRole('button', { name: 'Delete symbol anchor', exact: true }).click();
  await expect(t.getByRole('alert')).toContainText('Keep at least');
  await expect(t.getByLabel('Symbol anchor', { exact: true }).locator('option')).toHaveCount(4);
  await t.getByRole('button', { name: 'Clear symbol anchor selection', exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await expect(t.getByLabel('Selected symbol anchors')).toHaveText('0 anchors selected');
  await page.keyboard.press('Control+a');
  await expect(t.getByLabel('Selected symbol anchors')).toHaveText('4 anchors selected');
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByLabel('Symbol anchor', { exact: true }).selectOption('0');
  const movedSecond = await at(46, 45);
  await page.keyboard.down('Shift');
  await page.mouse.click(movedSecond.x, movedSecond.y);
  await page.keyboard.up('Shift');
  await expect(t.getByLabel('Selected symbol anchors')).toHaveText('2 anchors selected');
  await t.getByRole('button', { name: 'Delete symbol anchor', exact: true }).click();
  await expect(t.getByLabel('Symbol anchor', { exact: true }).locator('option')).toHaveCount(2);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByLabel('Symbol anchor', { exact: true }).locator('option')).toHaveCount(4);
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const result = (await read()).symbols![0].shapes[0];
  for (const i of [0, 1, 2, 3]) {
    const n = result.nodes![i],
      old = art.nodes[i];
    expect(result.x + n.x + 0.5 * n.y).toBeCloseTo(
      art.x + old.x + 0.5 * old.y + (i < 2 ? 11 : 0),
      0,
    );
    expect(result.y + 0.25 * n.x + n.y).toBeCloseTo(
      art.y + 0.25 * old.x + old.y + (i < 2 ? 10 : 0),
      0,
    );
  }
  expect(result.transform).toEqual(art.transform);
  expect(result.fill).toEqual(art.fill);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol range Alt-click cycles overlapping exposure groups with isolated undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'range-symbol',
      name: 'Range Symbol',
      width: 100,
      height: 100,
      shapes: [
        { ...art, groups: ['g'] },
        { ...art, id: 'sibling', x: 35, groups: ['g'] },
      ],
      timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 10 }] }] },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });

  await t.getByLabel('Symbol range end', { exact: true }).fill('4');
  await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  const action = t.getByLabel('Symbol range canvas action');
  const canvas = t.getByLabel('Symbol timeline preview');
  const at = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    return {
      x: b.x + ((20 + x * 2.9) * b.width) / 540,
      y: b.y + ((20 + y * 2.9) * b.height) / 330,
    };
  };
  await t.getByRole('button', { name: 'Clear symbol range selection', exact: true }).click();
  await action.selectOption('point');
  const pt = await at(15, 25);
  await page.mouse.click(pt.x, pt.y);
  await expect(t.getByText('1 objects selected.', { exact: false })).toBeVisible();
  await page.keyboard.down('Alt');
  await page.mouse.click(pt.x, pt.y);
  await expect(t.getByText('2 objects selected.', { exact: false })).toBeVisible();
  await page.mouse.click(pt.x, pt.y);
  await expect(t.getByText('1 objects selected.', { exact: false })).toBeVisible();
  await page.mouse.click(pt.x, pt.y);
  await page.keyboard.up('Alt');
  expect(await read()).toEqual(p);
  await t.getByLabel('Symbol multi-frame X offset', { exact: true }).fill('5');
  await t.getByRole('button', { name: 'Move symbol range artwork', exact: true }).click();
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const result = await read();
  expect(result.symbols![0].shapes.map((s) => s.x)).toEqual([15, 40]);
  expect(result.symbols![0].timeline).toEqual(p.symbols![0].timeline);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

for (const cycle of [false, true])
  test(`symbol reversed checked-track order selects stack order (cycle: ${cycle})`, async ({
    page,
  }) => {
    const p = newProject();
    const art = {
      id: 'art',
      kind: 'rectangle' as const,
      x: 10,
      y: 20,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    p.symbols = [
      {
        id: 'range-symbol',
        name: 'Range Symbol',
        width: 100,
        height: 100,
        shapes: [
          { ...art, groups: ['g'] },
          { ...art, id: 'sibling', x: 35, groups: ['g'] },
        ],
        timeline: {
          duration: 5,
          keys: [],
          layers: [
            {
              id: 'top',
              name: 'Top',
              visible: true,
              locked: false,
              keys: [{ frame: 0, shapes: [{ ...art, id: 'top-art' }] }],
            },
          ],
        },
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    await page
      .getByRole('group', { name: 'Symbol Range Symbol', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });

    await t.getByLabel('Symbol range end', { exact: true }).fill('4');
    await t.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
    const action = t.getByLabel('Symbol range canvas action');
    const canvas = t.getByLabel('Symbol timeline preview');
    const at = async (x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const b = (await canvas.boundingBox())!;
      return {
        x: b.x + ((20 + x * 2.9) * b.width) / 540,
        y: b.y + ((20 + y * 2.9) * b.height) / 330,
      };
    };
    await t.getByRole('button', { name: 'Clear symbol range selection', exact: true }).click();
    await action.selectOption('point');
    await t.getByLabel('Include symbol track Top', { exact: true }).check();
    await t.getByLabel('Include symbol track Artwork', { exact: true }).check();
    const pt = await at(15, 25);
    await page.mouse.click(pt.x, pt.y);
    await expect(t.getByText('1 objects selected.', { exact: false })).toBeVisible();
    if (cycle) {
      await page.keyboard.down('Alt');
      await page.mouse.click(pt.x, pt.y);
      await page.keyboard.up('Alt');
      await expect(t.getByText('2 objects selected.', { exact: false })).toBeVisible();
    }
    await t.getByLabel('Symbol multi-frame X offset', { exact: true }).fill('5');
    await t.getByRole('button', { name: 'Move symbol range artwork', exact: true }).click();
    expect(await read()).toEqual(p);
    await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
    await t.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
    expect(await read()).toEqual(p);
    await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const d = (await read()).symbols![0];
    if (cycle) {
      expect(d.shapes.map((s) => s.x)).toEqual([15, 40]);
      expect(d.timeline).toEqual(p.symbols![0].timeline);
    } else {
      expect(d.shapes).toEqual(p.symbols![0].shapes);
      expect(d.timeline!.layers![0].keys[0].shapes[0].x).toBe(15);
    }
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  });

for (const regionForm of ['box', 'lasso'])
  test(`symbol anchor region combines affine node sets and cancels without history (${regionForm})`, async ({
    page,
  }) => {
    const p = newProject();
    const art = {
      id: 'art',
      kind: 'bezier' as const,
      x: 10,
      y: 20,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      nodes: [
        { x: 0, y: 0, out: { x: 3, y: 0 } },
        { x: 20, y: 10, in: { x: 17, y: 10 }, out: { x: 23, y: 10 } },
        { x: 40, y: 0 },
        { x: 60, y: 0 },
      ],
      transform: [1, 0.25, 0.5, 1] as [number, number, number, number],
      closed: false,
      fillEnabled: false,
    };
    p.symbols = [
      {
        id: 'range-symbol',
        name: 'Range Symbol',
        width: 100,
        height: 100,
        shapes: [art, { ...art, id: 'other-art', x: 20 }],
        timeline: { duration: 5, keys: [{ frame: 2, shapes: [{ ...art, x: 50 }] }] },
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    await page.getByRole('option', { name: 'Library item Range Symbol', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });

    await t.getByLabel('Symbol canvas tool').selectOption('nodes');
    await t.getByLabel('Symbol anchor', { exact: true }).selectOption('0');
    const canvas = t.getByLabel('Symbol artwork preview');
    const at = async (x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const b = (await canvas.boundingBox())!;
      return {
        x: b.x + ((20 + x * 2.9) * b.width) / 540,
        y: b.y + ((20 + y * 2.9) * b.height) / 330,
      };
    };
    await t.getByLabel('Symbol anchor selection region').selectOption(regionForm);
    const region = async (
      a: number[],
      b: number[],
      modifiers: string[] = [],
      cancel: false | 'escape' | 'blur' | 'capture' | 'pointercancel' = false,
    ) => {
      const from = await at(a[0], a[1]),
        to = await at(b[0], b[1]);
      for (const key of modifiers) await page.keyboard.down(key);
      await page.mouse.move(from.x, from.y);
      await canvas.evaluate((el) => {
        el.addEventListener(
          'pointerdown',
          (event) => {
            (el as HTMLElement).dataset.testPointer = String((event as PointerEvent).pointerId);
          },
          { once: true },
        );
      });
      await page.mouse.down();
      if (regionForm === 'lasso') {
        await page.mouse.move(to.x, from.y, { steps: 3 });
        await page.mouse.move(to.x, to.y, { steps: 3 });
        await page.mouse.move(from.x, to.y, { steps: 3 });
        await page.mouse.move(from.x, from.y, { steps: 3 });
      } else await page.mouse.move(to.x, to.y, { steps: 3 });
      if (cancel === 'escape') await page.keyboard.press('Escape');
      else if (cancel === 'blur')
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (cancel === 'capture')
        await canvas.evaluate((el) => {
          el.releasePointerCapture(Number((el as HTMLElement).dataset.testPointer));
        });
      else if (cancel === 'pointercancel')
        await canvas.dispatchEvent('pointercancel', {
          pointerId: Number(await canvas.getAttribute('data-test-pointer')),
        });
      await page.mouse.up();
      for (const key of modifiers.reverse()) await page.keyboard.up(key);
      expect(await read()).toEqual(p);
    };
    const count = t.getByLabel('Selected symbol anchors');
    if (regionForm === 'lasso') {
      const points = [
        [4, 14],
        [58, 14],
        [58, 41],
        [44, 41],
        [44, 26],
        [26, 26],
        [26, 41],
        [4, 41],
        [4, 14],
      ];
      const start = await at(...(points[0] as [number, number]));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (const [x, y] of points.slice(1)) {
        const next = await at(x, y);
        await page.mouse.move(next.x, next.y);
      }
      await page.mouse.up();
      await expect(count).toHaveText('2 anchors selected');
    }

    await region([4, 14], [41, 41]);
    await expect(count).toHaveText('2 anchors selected');
    await region([44, 14], [76, 41], ['Shift']);
    await expect(count).toHaveText('4 anchors selected');
    await region([4, 14], [41, 41], ['Alt']);
    await expect(count).toHaveText('2 anchors selected');
    await region([44, 25], [56, 36], ['Shift', 'Alt']);
    await expect(count).toHaveText('1 anchors selected');
    await region([4, 14], [41, 41]);
    await expect(count).toHaveText('2 anchors selected');
    for (const cancellation of ['escape', 'blur', 'capture', 'pointercancel'] as const) {
      await region([1, 1], [90, 90], [], cancellation);
      await expect(count).toHaveText('2 anchors selected');
    }
    const staleStart = await at(1, 1),
      staleEnd = await at(90, 90);
    await page.mouse.move(staleStart.x, staleStart.y);
    await page.mouse.down();
    await page.mouse.move(staleEnd.x, staleEnd.y);
    await t.getByLabel('Symbol artwork item', { exact: true }).selectOption('other-art');
    await t.getByLabel('Symbol artwork item', { exact: true }).selectOption('art');
    await page.mouse.up();
    await expect(count).toHaveText('1 anchors selected');
    expect(await read()).toEqual(p);
    await region([4, 14], [41, 41]);
    await expect(count).toHaveText('2 anchors selected');
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    if (regionForm === 'lasso') {
      const start = await at(1, 1);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await canvas.evaluate((el) => {
        const box = el.getBoundingClientRect();
        for (let i = 0; i < 1025; i++)
          el.dispatchEvent(
            new PointerEvent('pointermove', {
              pointerId: Number((el as HTMLElement).dataset.testPointer),
              clientX: box.x + 30 + (i % 2) * 10,
              clientY: box.y + 30,
              bubbles: true,
            }),
          );
      });
      await page.mouse.up();
      await expect(t.getByRole('alert')).toContainText('1,024 sampled points');
      await expect(count).toHaveText('2 anchors selected');
      await expect(
        t.getByRole('button', { name: 'Undo artwork change', exact: true }),
      ).toBeDisabled();
      expect(await read()).toEqual(p);
    }
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const result = (await read()).symbols![0];
    expect(result.timeline).toEqual(p.symbols![0].timeline);
    expect(result.shapes[1]).toEqual(p.symbols![0].shapes[1]);
    for (const i of [0, 1, 2, 3]) {
      const n = result.shapes[0].nodes![i],
        old = art.nodes[i];
      expect(result.shapes[0].x + n.x + 0.5 * n.y).toBeCloseTo(
        art.x + old.x + 0.5 * old.y + (i < 2 ? 1 : 0),
      );
      expect(result.shapes[0].y + 0.25 * n.x + n.y).toBeCloseTo(art.y + 0.25 * old.x + old.y);
    }
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  });

for (const backend of ['stage', 'export', 'stage-movie', 'export-movie'])
  test(`advancing ${backend} offsets and once poses preserve sibling movie clocks and moving Hit`, async ({
    page,
  }) => {
    const p = newProject();
    p.width = 400;
    p.height = 160;
    p.duration = 8;
    p.fps = 2;
    const art = {
      id: 'paint',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const button = {
      id: 'button',
      name: 'Moving button',
      width: 20,
      height: 20,
      shapes: [art],
      buttonStates: { up: 0, over: 1, down: 2, hit: 0 },
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        ],
      },
    };
    const movie = {
      id: 'movie',
      name: 'Sibling movie',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [{ ...art, fill: '#0000ff' }] },
          { frame: 2, shapes: [{ ...art, fill: '#ffff00' }] },
        ],
      },
    };
    const child = { ...symbolInstance(button, 0, 0), id: 'button-child' };
    const sibling = {
      ...symbolInstance(movie, 0, 40),
      id: 'sibling',
      symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    };
    const parent = {
      id: 'parent',
      name: 'Advancing parent',
      width: 100,
      height: 80,
      shapes: [child, sibling],
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...child, x: 60 }, sibling] },
          { frame: 2, shapes: [sibling] },
          { frame: 3, shapes: [child, sibling] },
        ],
      },
    };
    p.symbols = [button, movie, parent];
    p.layers[0].keys[0].shapes = [
      {
        ...symbolInstance(parent, 0, 0),
        id: 'loop',
        symbolPlayback: { mode: backend.endsWith('-movie') ? 'movie' : 'loop', firstFrame: 0 },
      },
      {
        ...symbolInstance(parent, 200, 0),
        id: 'once',
        symbolPlayback: { mode: 'once', firstFrame: 1 },
      },
    ];
    const before = JSON.stringify(p);
    const html = exportHTML(p);
    expect(JSON.stringify(p)).toBe(before);
    let saved: string | null = null;
    if (backend.startsWith('export')) {
      await page.evaluate(() => {
        window.requestAnimationFrame = (cb) => {
          (window as unknown as { next: FrameRequestCallback }).next = cb;
          return 1;
        };
      });
      await page.setContent(html);
      await expect
        .poll(() =>
          page.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
        )
        .toBe('function');
    } else {
      await page.addInitScript((p) => {
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        );
        const actual = window.requestAnimationFrame.bind(window);
        (window as unknown as { testTime: number }).testTime = 0;
        window.requestAnimationFrame = (cb) =>
          actual(() => cb((window as unknown as { testTime: number }).testTime));
      }, p);
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      saved = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+Enter');
      await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
    }
    const step = async (time: number) => {
      if (backend.startsWith('export'))
        await page.evaluate(
          (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
          time,
        );
      else
        await page.evaluate(async (t) => {
          (window as unknown as { testTime: number }).testTime = t;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, time);
    };
    const canvas = backend.startsWith('export')
      ? page.locator('canvas')
      : page.getByRole('dialog', { name: 'Test movie', exact: true }).locator('canvas');
    const pixel = async (x: number, y = 10) => {
      const png = (await canvas.screenshot()).toString('base64');
      return page.evaluate(
        async ({ png, x, y }) => {
          const image = new Image();
          image.src = 'data:image/png;base64,' + png;
          await image.decode();
          const c = document.createElement('canvas');
          c.width = image.width;
          c.height = image.height;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData((x * c.width) / 400, (y * c.height) / 160, 1, 1).data);
        },
        { png, x, y },
      );
    };
    const activations = async (count: number) => {
      if (backend.startsWith('export'))
        await expect(canvas).toHaveAttribute('data-activations', String(count));
      else
        await expect(
          page
            .getByRole('dialog', { name: 'Test movie', exact: true })
            .getByText(new RegExp(`Activations:\\s*${count}\\.`)),
        ).toBeVisible();
    };
    const red = [255, 0, 0, 255],
      blue = [0, 0, 255, 255],
      yellow = [255, 255, 0, 255],
      white = [255, 255, 255, 255];
    await step(0);
    expect(await pixel(10)).toEqual(red);
    expect(await pixel(270)).toEqual(red);
    const b = (await canvas.boundingBox())!;
    const move = (x: number) =>
      page.mouse.move(b.x + (x * b.width) / 400, b.y + (10 * b.height) / 160);
    await move(10);
    await page.mouse.down();
    await step(0);
    expect(await pixel(10)).toEqual(blue);
    await step(500);
    await page.mouse.up();
    await activations(0);
    expect(await pixel(10)).toEqual(white);
    expect(await pixel(70)).toEqual(red);
    expect(await pixel(270)).toEqual(white);
    for (const x of [10, 210]) expect(await pixel(x, 50)).toEqual(blue);
    await move(70);
    await page.mouse.down();
    await page.mouse.up();
    await step(500);
    await activations(1);
    await step(1000);
    expect(await pixel(70)).toEqual(white);
    expect(await pixel(210)).toEqual(red);
    for (const x of [10, 210]) expect(await pixel(x, 50)).toEqual(yellow);
    await step(1500);
    expect(await pixel(10)).toEqual(red);
    expect(await pixel(210)).toEqual(red);
    for (const x of [10, 210]) expect(await pixel(x, 50)).toEqual(red);
    await step(2500);
    expect(await pixel(70)).toEqual(red);
    expect(await pixel(210)).toEqual(red);
    for (const x of [10, 210]) expect(await pixel(x, 50)).toEqual(yellow);
    if (!backend.startsWith('export')) {
      await page.keyboard.press('Escape');
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
        .toBe(saved);
    }
  });

for (const backend of ['export', 'stage'])
  for (const generated of [false, true, 'graphic'] as const)
    test(`${backend} moving movie-parent poses retain button movie time while cancelling stale presses (generated ${generated})`, async ({
      page,
    }) => {
      const p = newProject();
      p.width = 320;
      p.height = 120;
      p.duration = 4;
      p.fps = 2;
      const art = {
        id: 'art',
        kind: 'rectangle' as const,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      };
      const leaf = {
        id: 'leaf',
        name: 'Leaf',
        width: 40,
        height: 40,
        shapes: [art],
        timeline: {
          duration: 3,
          keys: [
            { frame: 1, shapes: [{ ...art, fill: '#0000ff' }] },
            { frame: 2, shapes: [{ ...art, fill: '#ffff00' }] },
          ],
        },
      };
      const animation = {
        ...symbolInstance(leaf, 0, 0),
        id: 'animation',
        symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
      };
      const button = {
        id: 'button',
        name: 'Button',
        width: 40,
        height: 40,
        shapes: [animation],
        buttonStates: { up: 0, over: 0, down: 0, hit: 1 },
        timeline: { duration: 2, keys: [{ frame: 1, shapes: [art] }] },
      };
      const parent = {
        id: 'parent',
        name: 'Parent',
        width: 40,
        height: 40,
        shapes: [{ ...symbolInstance(button, 0, 0), id: 'button-child' }],
      };
      const instance = {
        ...symbolInstance(parent, 20, 20),
        id: 'parent-instance',
        symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
      };
      p.symbols = [leaf, button, parent];
      p.layers[0].keys = [
        { frame: 0, shapes: [instance] },
        { frame: 1, shapes: [{ ...instance, x: 120 }] },
        { frame: 3, shapes: [instance] },
      ];
      if (generated === 'graphic') {
        const wrapper = {
          id: 'graphic-wrapper',
          name: 'Graphic wrapper',
          width: 40,
          height: 40,
          shapes: [{ ...instance, x: 0, y: 0 }],
        };
        p.symbols.push(wrapper);
        for (const key of p.layers[0].keys) {
          key.shapes[0].symbolId = wrapper.id;
          key.shapes[0].symbolPlayback = { mode: 'loop', firstFrame: 0 };
        }
      }
      if (generated) {
        p.layers[0].keys[1] = { frame: 2, shapes: [{ ...p.layers[0].keys[0].shapes[0], x: 220 }] };
        const endpoints = structuredClone(p.layers[0].keys);
        generateMotionFrames(p, [p.layers[0].id], 0, 2, 'linear');
        expect(p.layers[0].keys.filter((k) => k.frame !== 1)).toEqual(endpoints);
        expect(p.layers[0].keys[1].shapes[0].x).toBe(120);
      }
      const before = JSON.stringify(p),
        html = exportHTML(p);
      expect(JSON.stringify(p)).toBe(before);
      let saved: string | null = null;
      if (backend === 'export') {
        await page.evaluate(() => {
          window.requestAnimationFrame = (cb) => {
            (window as unknown as { next: FrameRequestCallback }).next = cb;
            return 1;
          };
        });
        await page.setContent(html);
        await expect
          .poll(() =>
            page.evaluate(() => typeof (window as unknown as { next: FrameRequestCallback }).next),
          )
          .toBe('function');
      } else {
        await page.addInitScript((p) => {
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project: p, folder: null, manifest: null }),
          );
          const actual = window.requestAnimationFrame.bind(window);
          (window as unknown as { testTime: number }).testTime = 0;
          window.requestAnimationFrame = (cb) =>
            actual(() => cb((window as unknown as { testTime: number }).testTime));
        }, p);
        await page.goto('/');
        await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
        saved = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
        await page.getByLabel('Drawing stage').focus();
        await page.keyboard.press('Control+Enter');
        await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
      }
      const step = async (time: number) => {
        if (backend === 'export')
          await page.evaluate(
            (t) => (window as unknown as { next: FrameRequestCallback }).next(t),
            time,
          );
        else
          await page.evaluate(async (t) => {
            (window as unknown as { testTime: number }).testTime = t;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
          }, time);
      };
      const canvas =
        backend === 'export'
          ? page.locator('canvas')
          : page.getByRole('dialog', { name: 'Test movie', exact: true }).locator('canvas');
      const noActivation = async () => {
        if (backend === 'export') await expect(canvas).toHaveAttribute('data-activations', '0');
        else
          await expect(
            page
              .getByRole('dialog', { name: 'Test movie', exact: true })
              .getByText(/Activations:\s*0\./),
          ).toBeVisible();
      };
      const pixel = async (x: number) => {
        const png = (await canvas.screenshot()).toString('base64');
        return page.evaluate(
          async ({ png, x }) => {
            const image = new Image();
            image.src = 'data:image/png;base64,' + png;
            await image.decode();
            const c = document.createElement('canvas');
            c.width = image.width;
            c.height = image.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            return Array.from(
              ctx.getImageData((x * c.width) / 320, (30 * c.height) / 120, 1, 1).data,
            );
          },
          { png, x },
        );
      };
      await step(0);
      expect(await pixel(30)).toEqual([255, 0, 0, 255]);
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + (30 * box.width) / 320, box.y + (30 * box.height) / 120);
      await page.mouse.down();
      await step(0);
      await step(500);
      expect(await pixel(30)).toEqual([255, 255, 255, 255]);
      expect(await pixel(130)).toEqual([0, 0, 255, 255]);
      await page.mouse.up();
      await noActivation();
      await canvas.focus();
      await page.keyboard.down('Space');
      await step(500);
      await step(1500); // Returns to the original compiled pose without restarting its clock.
      expect(await pixel(30)).toEqual([255, 0, 0, 255]);
      await page.keyboard.up('Space');
      await noActivation();
      await step(2000);
      expect(await pixel(30)).toEqual([0, 0, 255, 255]);
      await step(2500);
      expect(await pixel(130)).toEqual([255, 255, 0, 255]);
      if (backend === 'stage') {
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(saved);
      }
    });

test('symbol range retiming preserves state mappings and isolates batch, draft and project undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d = {
    id: 'retimed',
    name: 'Retimed',
    width: 80,
    height: 60,
    shapes: [art],
    buttonStates: { up: 0, over: 2, down: 4, hit: 7 },
    timeline: {
      duration: 8,
      keys: [
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 5, shapes: [] },
      ],
      layers: [
        {
          id: 'other',
          name: 'Other',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [{ ...art, id: 'other' }] },
            { frame: 4, shapes: [] },
          ],
        },
        {
          id: 'protected',
          name: 'Protected',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  p.symbols = [d];
  p.layers[0].keys[0].shapes = [symbolInstance(d, 100, 100)];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Retimed', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const click = (name: string) => t.getByRole('button', { name, exact: true }).click();
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('7');
  await t.getByLabel('Retimed symbol range length', { exact: true }).fill('12');
  await click('Select all symbol tracks');
  await click('Retime range on selected symbol tracks');
  await expect(t.getByRole('alert')).toContainText('unlocked');
  await expect(
    t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await click('Retime symbol frame range');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('13');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 10, blank key', exact: true }),
  ).toBeVisible();
  await expect(
    t.getByRole('button', { name: 'Other, frame 5, blank key', exact: true }),
  ).toBeVisible();
  expect(await read()).toEqual(before);
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('8');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('7');
  await t.getByLabel('Include symbol track Protected', { exact: true }).uncheck();
  await click('Retime range on selected symbol tracks');
  await expect(
    t.getByRole('button', { name: 'Other, frame 8, blank key', exact: true }),
  ).toBeVisible();
  await t.getByLabel('Retimed symbol range length', { exact: true }).fill('6');
  await click('Retime range on selected symbol tracks');
  await expect(t.getByLabel('Symbol duration', { exact: true })).toHaveValue('14');
  await expect(
    t.getByRole('button', { name: 'Artwork, frame 9, blank key', exact: true }),
  ).toBeVisible();
  await click('Undo symbol timeline change');
  await expect(t.getByLabel('Symbol range end', { exact: true })).toHaveValue('13');
  await click('Redo symbol timeline change');
  await t.getByLabel('Retimed symbol range length', { exact: true }).fill('1');
  await click('Retime range on selected symbol tracks');
  await expect(t.getByRole('alert')).toContainText('collapse keyframes');
  expect(await read()).toEqual(before);
  await click('Apply symbol timeline');
  const after = await read(),
    result = after.symbols![0];
  expect(result.shapes).toEqual(d.shapes);
  expect(result.buttonStates).toEqual(d.buttonStates);
  expect(result.timeline!.duration).toBe(14);
  expect(result.timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 5, 7, 8]);
  expect(result.timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 1, 4, 7, 8]);
  expect(result.timeline!.layers![1]).toEqual(d.timeline.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('buttons nested inside two button parents route affine Hit and keyboard interactions without edits', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 1;
  const shape = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'b',
      name: 'Button',
      width: 100,
      height: 100,
      shapes: [shape],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...shape, width: 50 }] },
        ],
      },
    },
  ];
  const inner = {
    id: 'inner',
    name: 'Inner button',
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
    width: 100,
    height: 100,
    shapes: [symbolInstance(p.symbols[0], 0, 0)],
  };
  const outer = {
    id: 'outer',
    name: 'Outer button',
    buttonStates: { up: 0, over: 0, down: 1, hit: 0 },
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [] }] },
    width: 100,
    height: 100,
    shapes: [symbolInstance(inner, 0, 0)],
  };
  p.symbols.push(inner, outer);
  const container = symbolInstance(outer, 100, 100);
  container.transform = [1, 0.2, 0.3, 1];
  p.layers[0].keys[0].shapes = [container];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+Enter');
  const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
  await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
  const canvas = dialog.locator('canvas');
  const b = (await canvas.boundingBox())!;
  const move = (x: number) =>
    page.mouse.move(b.x + (x * b.width) / p.width, b.y + (125 * b.height) / p.height);
  const pixel = async () => {
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData((125 * c.width) / 960, (125 * c.height) / 540, 1, 1).data);
    }, png);
  };
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await move(125);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await move(175);
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*0/)).toBeVisible();
  await move(125);
  await page.mouse.down();
  await page.mouse.up();
  await expect(dialog.getByText(/Activations:\s*1/)).toBeVisible();
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText(/Activations:\s*2/)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByText(/Button test: Outer button/)).toBeVisible();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText(/Activations:\s*3/)).toBeVisible();
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByText(/Button test: Button/)).toBeVisible();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(dialog.getByText(/Activations:\s*4/)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
    .toBe(before);
});

test('exported nested buttons route child Hit, shared states and parent disappearance', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 1;
  const shape = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'b',
      name: 'Button',
      width: 100,
      height: 100,
      shapes: [shape],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...shape, width: 50 }] },
        ],
      },
    },
  ];
  const inner = {
    id: 'inner',
    name: 'Inner button',
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
    width: 100,
    height: 100,
    shapes: [symbolInstance(p.symbols[0], 0, 0)],
  };
  const outer = {
    id: 'outer',
    name: 'Outer button',
    buttonStates: { up: 0, over: 0, down: 1, hit: 0 },
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [] }] },
    width: 100,
    height: 100,
    shapes: [symbolInstance(inner, 0, 0)],
  };
  p.symbols.push(inner, outer);
  const container = symbolInstance(outer, 100, 100);
  container.transform = [1, 0.2, 0.3, 1];
  p.layers[0].keys[0].shapes = [container];
  const before = JSON.stringify(p);
  await page.setContent(exportHTML(p));
  expect(JSON.stringify(p)).toBe(before);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-activations', '0');
  const b = (await canvas.boundingBox())!;
  const move = (x: number) =>
    page.mouse.move(b.x + (x * b.width) / p.width, b.y + (125 * b.height) / p.height);
  const pixel = () =>
    canvas.evaluate((c) =>
      Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(125, 125, 1, 1).data),
    );
  await move(125);
  await expect.poll(pixel).toEqual([0, 255, 0, 255]);
  await page.mouse.down();
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await move(175);
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '0');
  await move(125);
  await page.mouse.down();
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-activations', '1');
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.up('Space');
  await expect(canvas).toHaveAttribute('data-activations', '2');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([255, 255, 255, 255]);
  await page.keyboard.up('Space');
  await expect(canvas).toHaveAttribute('data-activations', '3');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Space');
  await expect.poll(pixel).toEqual([0, 0, 255, 255]);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Space');
  await expect(canvas).toHaveAttribute('data-activations', '3');
  await expect.poll(pixel).toEqual([255, 0, 0, 255]);
});

for (const target of ['stage', 'export'])
  test(`${target} routes buttons through two movies inside a button state with paused-root reentry cancellation`, async ({
    page,
  }) => {
    const p = newProject();
    p.duration = 1;
    const shape = {
      id: 'a',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    p.symbols = [
      {
        id: 'b',
        name: 'Button',
        width: 100,
        height: 100,
        shapes: [shape],
        buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
        timeline: {
          duration: 4,
          keys: [
            { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
            { frame: 2, shapes: [{ ...shape, fill: '#0000ff' }] },
            { frame: 3, shapes: [{ ...shape, width: 50 }] },
          ],
        },
      },
    ];
    const inner = {
      id: 'inner',
      name: 'Inner button',
      buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
      width: 100,
      height: 100,
      shapes: [symbolInstance(p.symbols[0], 0, 0)],
    };
    const outer = {
      id: 'outer',
      name: 'Outer button',
      buttonStates: { up: 0, over: 0, down: 1, hit: 0 },
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [] }] },
      width: 100,
      height: 100,
      shapes: [symbolInstance(inner, 0, 0)],
    };
    p.symbols.push(inner, outer);
    const container = symbolInstance(outer, 100, 100);
    container.transform = [1, 0.2, 0.3, 1];
    p.layers[0].keys[0].shapes = [container];
    const innerDefinition = p.symbols.find((d) => d.id === 'inner')!;
    innerDefinition.buttonStates = undefined;
    const middle = {
      id: 'middle',
      name: 'Middle movie',
      width: 100,
      height: 100,
      shapes: innerDefinition.shapes,
      timeline: { duration: 4, keys: [{ frame: 2, shapes: [] }] },
    };
    p.symbols.push(middle);
    innerDefinition.shapes = [
      { ...symbolInstance(middle, 0, 0), symbolPlayback: { mode: 'movie', firstFrame: 0 } },
    ];
    outer.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 0 };
    p.fps = 2;
    await page.addInitScript((p) => {
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
      const actual = window.requestAnimationFrame.bind(window);
      (window as unknown as { testTime: number }).testTime = 0;
      window.requestAnimationFrame = (cb) =>
        actual(() => cb((window as unknown as { testTime: number }).testTime));
    }, p);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const dialog = page.getByRole('dialog', { name: 'Test movie', exact: true });
    if (target === 'stage') {
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+Enter');
      await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
    } else await page.setContent(exportHTML(p));
    const canvas = target === 'stage' ? dialog.locator('canvas') : page.locator('canvas'),
      bounds = (await canvas.boundingBox())!;
    const activations = async (count: number) => {
      if (target === 'stage')
        await expect(dialog.getByText(new RegExp('Activations:\\s*' + count))).toBeVisible();
      else await expect(canvas).toHaveAttribute('data-activations', String(count));
    };
    const step = async (time: number) =>
      page.evaluate(async (t) => {
        (window as unknown as { testTime: number }).testTime = t;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }, time);
    const move = () =>
      page.mouse.move(
        bounds.x + (125 * bounds.width) / p.width,
        bounds.y + (125 * bounds.height) / p.height,
      );
    const pixel = async () => {
      const png = (await canvas.screenshot()).toString('base64');
      return page.evaluate(async (png) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + png;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return Array.from(
          ctx.getImageData((125 * c.width) / 960, (125 * c.height) / 540, 1, 1).data,
        );
      }, png);
    };
    await move();
    await expect.poll(pixel).toEqual([0, 255, 0, 255]);
    await page.mouse.down();
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await step(1000);
    await expect.poll(pixel).toEqual([255, 255, 255, 255]);
    await step(2000);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await page.mouse.up();
    await activations(0);
    await move();
    await page.mouse.down();
    await page.mouse.up();
    await activations(1);
    await canvas.focus();
    await page.keyboard.down('Space');
    await expect.poll(pixel).toEqual([0, 0, 255, 255]);
    await step(4000);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await page.keyboard.up('Space');
    await activations(1);
    await move();
    await page.mouse.down();
    await page.mouse.up();
    await activations(2);
    // Outside the child Hit but inside the parent's Hit: changing the parent
    // mapping removes its state movies, then Up starts a fresh descendant session.
    await page.mouse.move(
      bounds.x + (180 * bounds.width) / p.width,
      bounds.y + (125 * bounds.height) / p.height,
    );
    await page.mouse.down();
    await expect.poll(pixel).toEqual([255, 255, 255, 255]);
    await page.mouse.up();
    await activations(3);
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await step(5000);
    await expect.poll(pixel).toEqual([255, 255, 255, 255]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  });

test('remembered symbol pivot uses isolated draft undo and survives reopen', async ({ page }) => {
  const p = newProject();
  p.symbols = [
    {
      id: 's',
      name: 'Saved pivot',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'a',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const open = async () => {
    await page
      .getByRole('group', { name: 'Symbol Saved pivot', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
    await page.getByLabel('Edit symbol frame-range artwork', { exact: true }).check();
  };
  await open();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const x = t.getByLabel('Symbol multi-frame pivot X', { exact: true });
  const y = t.getByLabel('Symbol multi-frame pivot Y', { exact: true });
  await x.fill('31.5');
  await y.fill('-9');
  await t.getByRole('button', { name: 'Remember symbol pivot', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(x).toHaveValue('0');
  await t.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await expect(x).toHaveValue('31.5');
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  expect((await read()).symbols![0].multiFramePivot).toEqual({ x: 31.5, y: -9 });
  await open();
  await t.getByLabel('Symbol multi-frame transform handles').check();
  await expect(x).toHaveValue('31.5');
  await expect(y).toHaveValue('-9');
  await t.getByRole('button', { name: 'Forget saved symbol pivot', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  expect(await read()).toEqual(p);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect((await read()).symbols![0].multiFramePivot).toEqual({ x: 31.5, y: -9 });
});

for (const kind of ['linear', 'radial'] as const)
  test(`symbol ${kind} gradient stop handles cross, clamp and undo in affine artwork`, async ({
    page,
  }) => {
    const p = newProject();
    p.symbols = [
      {
        id: 'paint',
        name: 'Paint',
        width: 100,
        height: 100,
        shapes: [
          {
            id: 'base',
            kind: 'rectangle',
            x: 10,
            y: 10,
            width: 60,
            height: 60,
            rotation: 0,
            transform: [1, 0.1, 0.2, 1],
            fill: '#ff0000',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
            gradient: {
              kind,
              from: { x: 0, y: 0 },
              to: { x: 50, y: 0 },
              transform: [1, 0.2, 0.4, 1],
              stops: [
                { offset: 0, color: '#000000' },
                { offset: 0.25, color: '#ff0000', opacity: 0.4 },
                { offset: 0.6, color: '#00ff00' },
                { offset: 1, color: '#0000ff' },
              ],
            },
          },
        ],
      },
    ];
    p.symbols[0].shapes.push({
      ...p.symbols[0].shapes[0],
      id: 'sibling',
      x: 75,
      y: 75,
      width: 10,
      height: 10,
      gradient: undefined,
    });
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page
      .getByRole('group', { name: 'Symbol Paint', exact: true })
      .getByRole('button', { name: 'Edit symbol artwork', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
    await t.getByLabel('Symbol canvas tool').selectOption('gradient');
    const canvas = t.getByLabel('Symbol artwork preview');
    const at = async (offset: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const b = (await canvas.boundingBox())!;
      return {
        x: b.x + ((20 + (10 + 52 * offset) * 2.9) * b.width) / 540,
        y: b.y + ((20 + (10 + 15 * offset) * 2.9 + 14) * b.height) / 330,
      };
    };
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const start = async (from: number, to: number) => {
      const a = await at(from),
        b = await at(to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y);
    };
    await start(0.25, 0.8);
    expect(await read()).toEqual(p);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(t.getByLabel('Symbol gradient stop 2 position', { exact: true })).toHaveValue(
      '25',
    );
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    for (const cancellation of ['blur', 'pointercancel', 'lostpointercapture', 'artwork']) {
      await start(0.25, 0.8);
      if (cancellation === 'blur')
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else if (cancellation === 'artwork') {
        await t.getByLabel('Symbol artwork item', { exact: true }).selectOption('sibling');
        await t.getByLabel('Symbol artwork item', { exact: true }).selectOption('base');
      } else await canvas.dispatchEvent(cancellation, { pointerId: 1 });
      await page.mouse.up();
      await expect(t.getByLabel('Symbol gradient stop 2 position', { exact: true })).toHaveValue(
        '25',
      );
      await expect(
        t.getByRole('button', { name: 'Undo artwork change', exact: true }),
      ).toBeDisabled();
    }
    await start(0.25, 0.8);
    // Crossing and then moving back must keep the original red stop, not the newly sorted index.
    let point = await at(0.4);
    await page.mouse.move(point.x, point.y);
    point = await at(0.8);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    expect(
      Number(await t.getByLabel('Symbol gradient stop 3 position', { exact: true }).inputValue()),
    ).toBeCloseTo(80, 4);
    await expect(t.getByLabel('Symbol gradient stop 3 color', { exact: true })).toHaveValue(
      '#ff0000',
    );
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(t.getByLabel('Symbol gradient stop 2 position', { exact: true })).toHaveValue(
      '25',
    );
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await start(0.8, 1.2);
    await page.mouse.up();
    // Stable sorting keeps the moved red stop before the existing blue stop at the same endpoint.
    await expect(t.getByLabel('Symbol gradient stop 3 position', { exact: true })).toHaveValue(
      '100',
    );
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const result = await read();
    const expected = structuredClone(p);
    expected.symbols![0].shapes[0].gradient!.stops = [
      { offset: 0, color: '#000000' },
      { offset: 0.6, color: '#00ff00' },
      { offset: 1, color: '#ff0000', opacity: 0.4 },
      { offset: 1, color: '#0000ff' },
    ];
    expect(result).toEqual(expected);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  });

for (const objects of [false, true])
  test(`symbol Brush captures pen dynamics and release metadata (${objects ? 'objects' : 'merged'})`, async ({
    page,
  }) => {
    const p = newProject();
    p.symbols = [
      {
        id: 's',
        name: 'Pen brush',
        width: 100,
        height: 100,
        shapes: [
          {
            id: 'base',
            kind: 'rectangle',
            x: 0,
            y: 0,
            width: 5,
            height: 5,
            rotation: 0,
            fill: '#ff0000',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          },
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page
      .getByRole('group', { name: 'Symbol Pen brush', exact: true })
      .getByRole('button', { name: 'Edit symbol artwork', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
    await t.getByLabel('Symbol canvas tool').selectOption('brush');
    await t.getByLabel('Symbol brush pressure', { exact: true }).check();
    await t.getByLabel('Symbol brush size', { exact: true }).fill('20');
    await t.getByLabel('Smooth symbol brush', { exact: true }).uncheck();
    if (objects) {
      await t.getByLabel('Separate symbol brush objects', { exact: true }).check();
      await t.getByLabel('Symbol brush tilt', { exact: true }).check();
      await t.getByLabel('Symbol brush twist', { exact: true }).check();
      await t.getByLabel('Symbol brush nib aspect', { exact: true }).fill('50');
      await t.getByLabel('Symbol brush stabilization', { exact: true }).fill('5');
    }
    const canvas = t.getByLabel('Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await canvas.evaluate((c) =>
      c.addEventListener(
        'pointerdown',
        (event) => {
          (window as unknown as { penId: number }).penId = (event as PointerEvent).pointerId;
        },
        { once: true },
      ),
    );
    await page.mouse.move(
      b.x + ((20 + 20 * 2.9) * b.width) / 540,
      b.y + ((20 + 50 * 2.9) * b.height) / 330,
    );
    await page.mouse.down();
    await canvas.evaluate((c) => {
      const b = c.getBoundingClientRect();
      const send = (type: string, x: number, pressure: number, tilt: number, twist: number) =>
        c.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: (window as unknown as { penId: number }).penId,
            pointerType: 'pen',
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: b.x + ((20 + x * 2.9) * b.width) / 540,
            clientY: b.y + ((20 + 50 * 2.9) * b.height) / 330,
            pressure,
            tiltX: tilt,
            tiltY: -tilt,
            twist,
          }),
        );
      send('pointermove', 40, 0.2, 20, 90);
      // Same-position dynamics must survive movement filtering.
      send('pointermove', 40, 0.3, 25, 120);
      send('pointermove', 80, 0.8, 30, 270);
      send('pointerup', 85, 0, 0, 0);
    });
    await page.mouse.up();
    await expect(
      t.getByRole('button', { name: 'Apply symbol changes', exact: true }),
    ).toBeEnabled();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    expect(await read()).toEqual(p);
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const result = (await read()).symbols![0].shapes;
    if (objects) {
      const stroke = result.find((s) => s.kind === 'brush')!;
      expect(stroke.brush).toMatchObject({
        pressure: true,
        tilt: true,
        twist: true,
        aspect: 0.5,
        minimum: 0.1,
      });
      expect(stroke.points.map((p) => p.pressure)).toEqual(
        [1, 0.2, 0.3, 0.8, 0.8].map(Math.fround),
      );
      expect(stroke.points.at(-1)).toMatchObject({ tiltX: 30, tiltY: -30, twist: 270 });
      expect(stroke.x + stroke.points[1].x).toBeCloseTo(35);
      expect(stroke.x + stroke.points.at(-1)!.x).toBeCloseTo(85);
    } else {
      expect(result.every((s) => s.kind !== 'brush')).toBe(true);
      expect(result.some((s) => hit(s, { x: 80, y: 57 }))).toBe(true);
      expect(result.some((s) => hit(s, { x: 40, y: 57 }))).toBe(false);
    }
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  });

for (const tool of ['pencil', 'brush'] as const)
  for (const count of [5000, 100000])
    test(`long symbol ${tool} strokes preserve samples or reject document overflow atomically (${count})`, async ({
      page,
    }) => {
      const p = newProject();
      p.symbols = [
        {
          id: 'long',
          name: 'Long stroke',
          width: 100,
          height: 100,
          shapes: [
            {
              id: 'base',
              kind: 'rectangle',
              x: 0,
              y: 0,
              width: 5,
              height: 5,
              rotation: 0,
              fill: '#ff0000',
              stroke: '#000000',
              strokeWidth: 0,
              points: [],
            },
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
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page
        .getByRole('group', { name: 'Symbol Long stroke', exact: true })
        .getByRole('button', { name: 'Edit symbol artwork', exact: true })
        .click();
      const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
      await t.getByLabel('Symbol canvas tool').selectOption(tool);
      if (tool === 'brush') {
        await t.getByLabel('Smooth symbol brush', { exact: true }).uncheck();
        await t.getByLabel('Separate symbol brush objects', { exact: true }).check();
        await t.getByLabel('Symbol brush size', { exact: true }).fill('2');
      } else await t.getByLabel('Symbol pencil smoothing', { exact: true }).selectOption('raw');
      const canvas = t.getByLabel('Symbol artwork preview');
      await canvas.scrollIntoViewIfNeeded();
      const b = (await canvas.boundingBox())!;
      await canvas.evaluate((c) =>
        c.addEventListener(
          'pointerdown',
          (e) => {
            (window as unknown as { longId: number }).longId = (e as PointerEvent).pointerId;
          },
          { once: true },
        ),
      );
      await page.mouse.move(
        b.x + ((20 + 20 * 2.9) * b.width) / 540,
        b.y + ((20 + 50 * 2.9) * b.height) / 330,
      );
      await page.mouse.down();
      await canvas.evaluate((c, count) => {
        const b = c.getBoundingClientRect();
        const sample = (i: number, type = 'pointermove') =>
          new PointerEvent(type, {
            bubbles: true,
            pointerId: (window as unknown as { longId: number }).longId,
            pointerType: 'mouse',
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: b.x + ((20 + (20 + i / 100) * 2.9) * b.width) / 540,
            clientY: b.y + ((20 + (50 + (i % 2 ? 0.25 : -0.25)) * 2.9) * b.height) / 330,
          });
        const release = sample(count + 1, 'pointerup');
        Object.defineProperty(release, 'getCoalescedEvents', {
          value: () => Array.from({ length: count }, (_, i) => sample(i + 1)),
        });
        c.dispatchEvent(release);
      }, count);
      await page.mouse.up();
      if (count === 100000) {
        await expect(t.getByRole('alert')).toContainText('no partial stroke was committed');
        await expect(
          t.getByRole('button', { name: 'Undo artwork change', exact: true }),
        ).toBeDisabled();
        await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
        expect(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project,
          ),
        ).toEqual(p);
        return;
      }

      await expect(
        t.getByRole('button', { name: 'Apply symbol changes', exact: true }),
      ).toBeEnabled();
      await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
      const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        );
      const stroke = (await read()).symbols![0].shapes[1];
      expect(stroke.points).toHaveLength(5002);
      for (const i of [4095, 4096, 4500, 4999, 5001]) {
        expect(stroke.x + stroke.points[i].x).toBeCloseTo(20 + i / 100, 6);
        expect(stroke.y + stroke.points[i].y).toBeCloseTo(50 + (i % 2 ? 0.25 : -0.25), 6);
      }
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(p);
      await page.keyboard.press('Control+Shift+z');
      expect((await read()).symbols![0].shapes[1]).toEqual(stroke);
    });

test('symbol connected Ink repaints stroke networks atomically and cancels stale worker results', async ({
  page,
}) => {
  await holdGeometry(page);
  const p = newProject();
  const line = (id: string, x: number, width: number) => ({
    id,
    kind: 'line' as const,
    x,
    y: 20,
    width,
    height: 0,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
    ],
  });
  const fill = { ...line('fill', 5, 85), kind: 'rectangle' as const, y: 5, height: 85, points: [] };
  p.symbols = [
    {
      id: 's',
      name: 'Connected',
      width: 100,
      height: 100,
      shapes: [
        fill,
        line('a', 20, 20),
        line('b', 40, 20),
        line('apart', 75, 10),
        { ...fill, id: 'protected', x: 0, y: 0, width: 3, height: 3, groups: ['g'] },
        line('beyond', 60, 10),
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Connected', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await t.getByLabel('Symbol canvas tool').selectOption('ink');
  await t.getByLabel('Connected symbol strokes', { exact: true }).check();
  await t.getByLabel('New symbol line color').fill('#0000ff');
  await t.getByLabel('New symbol line width').fill('8');
  const canvas = t.getByLabel('Symbol artwork preview');
  const click = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(
      b.x + ((20 + 30 * 2.9) * b.width) / 540,
      b.y + ((20 + 20 * 2.9) * b.height) / 330,
    );
    await expect.poll(() => pendingGeometry(page)).toBe(1);
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await click();
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await releaseGeometry(page);
  await expect(t.getByRole('button', { name: 'Apply symbol changes', exact: true })).toBeEnabled();
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await click();
  await releaseGeometry(page, true);
  await expect(t.getByRole('alert')).toContainText('Simulated merge failure');
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await click();
  await releaseGeometry(page);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const expected = structuredClone(p);
  for (const s of expected.symbols![0].shapes)
    if (['a', 'b'].includes(s.id)) {
      s.stroke = '#0000ff';
      s.strokeWidth = 8;
    }
  expect(await read()).toEqual(expected);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

for (const mode of ['artwork', 'timeline'] as const) {
  for (const failed of [false, true]) {
    test(`symbol ${mode} loads on demand and ${failed ? 'reports load failure safely' : 'cancels delayed loading without reopening'}`, async ({
      page,
    }) => {
      const p = newProject();
      p.layers[0].keys[0].shapes = [
        {
          id: 'red',
          kind: 'rectangle',
          x: 100,
          y: 100,
          width: 80,
          height: 60,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ];
      convertToSymbol(p, p.layers[0].id, 0, ['red'], 'Lazy');
      await page.addInitScript(
        (p) =>
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project: p, folder: null, manifest: null }),
          ),
        p,
      );
      const chunk = mode === 'artwork' ? 'SymbolEditor' : 'SymbolTimeline';
      let requests = 0;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**/assets/${chunk}-*.js`, async (route) => {
        requests++;
        await held;
        if (failed) await route.abort();
        else await route.continue();
      });
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        );
      const before = await read();
      expect(requests).toBe(0);
      const open = page
        .getByRole('group', { name: 'Symbol Lazy', exact: true })
        .getByRole('button', { name: `Edit symbol ${mode}`, exact: true });
      await open.click();
      const loading = page.getByRole('dialog', { name: 'Loading symbol tools', exact: true });
      await expect(loading.getByRole('status')).toHaveText('Loading symbol tools…');
      await expect.poll(() => requests).toBe(1);
      expect(await loading.evaluate((dialog) => dialog.matches(':modal'))).toBe(true);
      expect(await read()).toEqual(before);
      if (failed) {
        release();
        await expect(loading.getByRole('alert')).toContainText('Could not load symbol tools');
        expect(await read()).toEqual(before);
        await loading.getByRole('button', { name: 'Cancel symbol loading', exact: true }).click();
        await expect(loading).toHaveCount(0);
        await page.getByLabel('Drawing stage').focus();
        await expect(page.getByLabel('Drawing stage')).toBeFocused();
        return;
      }
      if (mode === 'artwork') await page.keyboard.press('Escape');
      else
        await loading.getByRole('button', { name: 'Cancel symbol loading', exact: true }).click();
      await expect(loading).toHaveCount(0);
      const response = page.waitForResponse(
        (response) =>
          response.url().includes(`/assets/${chunk}-`) && response.url().endsWith('.js'),
      );
      release();
      await (await response).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const editor = page.getByRole('dialog', {
        name: mode === 'artwork' ? 'Edit symbol artwork' : 'Symbol timeline',
        exact: true,
      });
      await expect(editor).toHaveCount(0);
      expect(await read()).toEqual(before);
      await open.click();
      await expect(editor).toBeVisible();
      expect(requests).toBe(1);
      if (mode === 'artwork') {
        await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
        await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
        expect((await read()).symbols![0].shapes[0].fill).toBe('#0000ff');
      } else {
        await editor.getByLabel('Symbol duration', { exact: true }).fill('4');
        await editor.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
        expect((await read()).symbols![0].timeline!.duration).toBe(4);
      }
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
    });
  }
}

for (const form of ['box', 'lasso'] as const) {
  test(`symbol anchors select and edit across affine artwork with atomic history (${form})`, async ({
    page,
  }) => {
    const p = newProject();
    const a: Project['layers'][number]['keys'][number]['shapes'][number] = {
      id: 'a',
      kind: 'bezier',
      x: 10,
      y: 10,
      width: 45,
      height: 10,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 1,
      points: [],
      fillEnabled: false,
      closed: false,
      nodes: [
        { x: 0, y: 0 },
        { x: 15, y: 10 },
        { x: 30, y: 0 },
        { x: 45, y: 10 },
      ],
    };
    const b = {
      ...structuredClone(a),
      id: 'b',
      x: 80,
      y: 40,
      transform: [-1, 0.25, 0.5, 1] as [number, number, number, number],
    };
    const compound = {
      ...structuredClone(a),
      id: 'compound',
      kind: 'polygon' as const,
      x: 10,
      y: 60,
      width: 20,
      height: 20,
      nodes: undefined,
      fillEnabled: true,
      fillRule: 'evenodd' as const,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        [
          { x: 5, y: 5 },
          { x: 5, y: 15 },
          { x: 15, y: 15 },
          { x: 15, y: 5 },
        ],
      ],
    };
    const protectedArt = { ...structuredClone(a), id: 'protected', groups: ['protected-group'] };
    p.symbols = [
      {
        id: 'cross',
        name: 'Cross',
        width: 100,
        height: 100,
        shapes: [a, b, compound, protectedArt],
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
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    await page.getByRole('option', { name: 'Library item Cross', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
      canvas = t.getByLabel('Symbol artwork preview');
    await t.getByLabel('Symbol canvas tool').selectOption('nodes');
    await t.getByLabel('Select anchors across symbol artwork').check();
    await t.getByLabel('Symbol anchor selection region').selectOption(form);
    const count = t.getByLabel('Selected symbol anchors');
    const at = async (x: number, y: number) => {
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      return {
        x: box.x + ((20 + x * 2.9) * box.width) / 540,
        y: box.y + ((20 + y * 2.9) * box.height) / 330,
      };
    };
    const click = async (x: number, y: number, shift = false) => {
      const p = await at(x, y);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      if (shift) await page.keyboard.up('Shift');
    };
    const region = async (modifiers: string[] = [], cancel = false) => {
      const a = await at(5, 5),
        b = await at(28, 23);
      for (const k of modifiers) await page.keyboard.down(k);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      if (form === 'lasso') {
        await page.mouse.move(b.x, a.y);
        await page.mouse.move(b.x, b.y);
        await page.mouse.move(a.x, b.y);
        await page.mouse.move(a.x, a.y);
      } else await page.mouse.move(b.x, b.y);
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      for (const k of modifiers) await page.keyboard.up(k);
    };
    await t.getByRole('button', { name: 'Select all symbol anchors', exact: true }).click();
    await expect(count).toHaveText('16 anchors selected');
    await t.getByRole('button', { name: 'Delete symbol anchor', exact: true }).click();
    await expect(t.getByRole('alert')).toContainText('Keep at least');
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    await t.getByRole('button', { name: 'Clear symbol anchor selection', exact: true }).click();
    await region([], true);
    await expect(count).toHaveText('0 anchors selected');
    await region();
    await expect(count).toHaveText('2 anchors selected');
    // Earlier artwork can be valid for deletion while a later member rejects the batch.
    for (const node of b.nodes!) {
      const point = worldPoint(b, node);
      await click(point.x, point.y, true);
    }
    await expect(count).toHaveText('6 anchors selected');
    await t.getByRole('button', { name: 'Delete symbol anchor', exact: true }).click();
    await expect(t.getByRole('alert')).toContainText('Keep at least');
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    await region();
    await click(80, 40, true);
    await expect(count).toHaveText('3 anchors selected');
    await region(['Shift', 'Alt']);
    await expect(count).toHaveText('2 anchors selected');
    await region(['Alt']);
    await expect(count).toHaveText('0 anchors selected');
    await region(['Shift']);
    await click(80, 40, true);
    await expect(count).toHaveText('3 anchors selected');
    expect(await read()).toEqual(before);
    const drag = async (cancel = false) => {
      const a = await at(10, 10),
        b = await at(15, 14);
      const box = (await canvas.boundingBox())!;
      await canvas.evaluate((el) => {
        el.addEventListener(
          'pointerdown',
          (e) => {
            const p = e as PointerEvent;
            (el as HTMLElement).dataset.nodeStart = JSON.stringify([p.clientX, p.clientY]);
          },
          { once: true },
        );
        el.addEventListener(
          'pointerup',
          (e) => {
            const p = e as PointerEvent;
            (el as HTMLElement).dataset.nodeEnd = JSON.stringify([p.clientX, p.clientY]);
          },
          { once: true },
        );
      });
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y);
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      const [start, end] = await canvas.evaluate(
        (el) =>
          [
            JSON.parse((el as HTMLElement).dataset.nodeStart!),
            JSON.parse((el as HTMLElement).dataset.nodeEnd!),
          ] as number[][],
      );
      return {
        x: ((end[0] - start[0]) * 540) / box.width / 2.9,
        y: ((end[1] - start[1]) * 330) / box.height / 2.9,
      };
    };
    await drag(true);
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    const delta = await drag();
    await canvas.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await t.getByRole('button', { name: 'Smooth symbol anchor', exact: true }).click();
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    for (let i = 0; i < 3; i++)
      await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    expect(await read()).toEqual(before);
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const edited = await read(),
      shapes = edited.symbols![0].shapes;
    for (const [index, source] of [a, b].entries()) {
      const target = shapes[index];
      for (let i = 0; i < source.nodes!.length; i++) {
        const expected = worldPoint(source, source.nodes![i]);
        if (index === 0 ? i < 2 : i === 0) {
          expected.x += delta.x + 10;
          expected.y += delta.y;
        }
        const actual = worldPoint(target, target.nodes![i]);
        expect(actual.x).toBeCloseTo(expected.x, 5);
        expect(actual.y).toBeCloseTo(expected.y, 5);
      }
      expect(target.id).toBe(source.id);
      expect(target.stroke).toBe(source.stroke);
      expect(target.fill).toBe(source.fill);
    }
    expect(shapes.slice(2)).toEqual(before.symbols![0].shapes.slice(2));
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(edited);
    await page.getByRole('option', { name: 'Library item Cross', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await t.getByLabel('Symbol canvas tool').selectOption('nodes');
    await t.getByLabel('Select anchors across symbol artwork').check();
    const first = worldPoint(shapes[0], shapes[0].nodes![0]);
    const second = worldPoint(shapes[1], shapes[1].nodes![0]);
    await click(first.x, first.y);
    await click(second.x, second.y, true);
    await click(15, 65, true);
    await expect(count).toHaveText('3 anchors selected');
    await t.getByRole('button', { name: 'Delete symbol anchor', exact: true }).click();
    await expect(count).toHaveText('0 anchors selected');
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(
      t.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    expect(await read()).toEqual(edited);
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const deleted = (await read()).symbols![0].shapes;
    expect(deleted[0].nodes).toHaveLength(3);
    expect(deleted[1].nodes).toHaveLength(3);
    expect(deleted[2].contours![0]).toEqual(shapes[2].contours![0]);
    expect(deleted[2].contours![1]).toEqual(shapes[2].contours![1].slice(1));
    expect(deleted[3]).toEqual(shapes[3]);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(edited);
  });
}

test('symbol text edits preserve rich content, isolated history and invalid-edit rollback', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [
    {
      id: 'text-source',
      kind: 'text',
      x: 100,
      y: 100,
      width: 180,
      height: 80,
      rotation: 12,
      transform: [1, 0.1, 0.2, 1],
      fill: '#123456',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      text: {
        content: 'Hello world',
        font: 'sans-serif',
        size: 24,
        bold: false,
        italic: false,
        align: 'left',
        runs: [{ start: 0, end: 5, style: { bold: true, color: '#ff0000' } }],
      },
    },
  ];
  convertToSymbol(p, p.layers[0].id, 0, ['text-source'], 'Text author');
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const open = () =>
    openStaticLibraryArtwork(page,'Text author');
  await open();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const click = (name: string) => editor.getByRole('button', { name, exact: true }).click();
  const edit = async (name: string, value: string) => {
    await editor.getByLabel(name, { exact: true }).fill(value);
    await editor.getByLabel(name, { exact: true }).press('Tab');
  };
  await edit('Symbol text content', 'Hello beautiful world');
  await edit('Symbol text size', '36');
  await edit('Symbol text wrap width', '150');
  await edit('Symbol text line height', '1.5');
  await editor.getByLabel('Symbol text italic', { exact: true }).check();
  await editor.getByLabel('Symbol text alignment', { exact: true }).selectOption('center');
  await edit('Symbol text size', '0');
  await expect(editor.getByRole('alert')).toBeVisible();
  await click('Undo artwork change');
  await expect(editor.getByLabel('Symbol text alignment', { exact: true })).toHaveValue('left');
  await click('Redo artwork change');
  expect(await read()).toEqual(before);
  await click('Apply symbol changes');
  const committed = await read();
  const text = committed.symbols![0].shapes[0];
  expect(text.text).toMatchObject({
    content: 'Hello beautiful world',
    size: 36,
    italic: true,
    align: 'center',
    wrapWidth: 150,
    lineHeight: 1.5,
    runs: [{ start: 0, end: 5, style: { bold: true, color: '#ff0000' } }],
  });
  expect(text.width).toBe(150);
  expect(text.height).toBeGreaterThan(36);
  expect(text.rotation).toBe(before.symbols![0].shapes[0].rotation);
  expect(text.transform).toEqual(before.symbols![0].shapes[0].transform);
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  await open();
  await click('Add symbol text');
  await edit('Symbol text content', 'New symbol text');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
  await click('Undo artwork change');
  await expect(editor.getByLabel('Symbol text content', { exact: true })).toHaveValue('Text');
  await click('Undo artwork change');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
  await click('Redo artwork change');
  await click('Apply symbol changes');
  expect((await read()).symbols![0].shapes[1].text?.content).toBe('Text');
  await open();
  await edit('Symbol text content', 'Cancelled edit');
  await click('Cancel symbol editing');
  expect((await read()).symbols![0].shapes[1].text?.content).toBe('Text');
});

test('symbol blank-frame text creation stays in timeline draft until Apply', async ({ page }) => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 20,
      y: 20,
      width: 100,
      height: 80,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  convertToSymbol(p, p.layers[0].id, 0, ['art'], 'Text frame');
  p.symbols![0].timeline = { duration: 3, keys: [{ frame: 1, shapes: [] }] };
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Text frame', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('2');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await editor.getByRole('button', { name: 'Add symbol text', exact: true }).click();
  await editor.getByLabel('Symbol text content', { exact: true }).fill('Frame two\nSecond line');
  await editor.getByLabel('Symbol text content', { exact: true }).press('Tab');
  await editor.getByLabel('Symbol text font', { exact: true }).fill('serif');
  await editor.getByLabel('Symbol text font', { exact: true }).press('Tab');
  await editor.getByLabel('Symbol text bold', { exact: true }).check();
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await read()).toEqual(before);
  await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const committed = await read();
  expect(committed.symbols![0].timeline!.keys[0].shapes[0].text).toMatchObject({
    content: 'Frame two\nSecond line',
    font: 'serif',
    bold: true,
  });
  expect(committed.symbols![0].shapes).toEqual(before.symbols![0].shapes);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('symbol selected-character styles preserve graphemes, surrounding runs and isolated undo', async ({
  page,
}) => {
  const p = newProject();
  const content = 'A\u{1f469}\u200d\u{1f680}B tail';
  p.layers[0].keys[0].shapes = [
    {
      id: 'text',
      kind: 'text',
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      text: {
        content,
        font: 'sans-serif',
        size: 24,
        bold: false,
        italic: false,
        align: 'left',
        runs: [{ start: 7, end: 12, style: { italic: true } }],
      },
    },
  ];
  convertToSymbol(p, p.layers[0].id, 0, ['text'], 'Range text');
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Range text', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const click = (name: string) => editor.getByRole('button', { name, exact: true }).click();
  const select = async (start: number, end: number) => {
    await editor.getByLabel('Symbol text content', { exact: true }).evaluate(
      (element, range) => {
        const t = element as HTMLTextAreaElement;
        t.focus();
        t.setSelectionRange(range[0], range[1]);
        t.dispatchEvent(new Event('select', { bubbles: true }));
      },
      [start, end],
    );
  };
  await expect(
    editor.getByRole('button', { name: 'Bold selected symbol text', exact: true }),
  ).toBeDisabled();
  await select(2, 3);
  await click('Bold selected symbol text');
  await editor.getByLabel('Selected symbol text color', { exact: true }).fill('#ff0000');
  await click('Apply selected symbol text color');
  await editor.getByLabel('Selected symbol text size', { exact: true }).fill('0');
  await click('Apply selected symbol text size');
  await expect(editor.getByRole('alert')).toBeVisible();
  await click('Undo artwork change');
  await expect(
    editor.getByRole('button', { name: 'Bold selected symbol text', exact: true }),
  ).toBeDisabled();
  await click('Redo artwork change');
  await select(7, 12);
  await editor.getByLabel('Selected symbol text font', { exact: true }).fill('serif');
  await click('Apply selected symbol text font');
  await editor.getByLabel('Selected symbol text size', { exact: true }).fill('40');
  await click('Apply selected symbol text size');
  await click('Clear selected symbol text styles');
  const originalId = await editor.getByLabel('Symbol artwork item').inputValue();
  await click('Duplicate symbol artwork');
  await select(1, 6);
  await editor.getByLabel('Symbol artwork item').selectOption(originalId);
  await expect(
    editor.getByRole('button', { name: 'Bold selected symbol text', exact: true }),
  ).toBeDisabled();
  await click('Undo artwork change');

  expect(await read()).toEqual(before);
  await click('Apply symbol changes');
  const committed = await read();
  expect(committed.symbols![0].shapes[0].text?.runs).toEqual([
    { start: 1, end: 6, style: { bold: true, color: '#ff0000' } },
  ]);
  expect(committed.symbols![0].shapes[0].text?.content).toBe(content);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('symbol artwork clipboard crosses editors with fresh group identities, isolated undo and cycle rejection', async ({
  page,
}) => {
  const p = newProject();
  const rect = (id: string, groups?: string[]) => ({
    id,
    groups,
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    rotation: 15,
    transform: [1, 0.2, 0.3, 1] as [number, number, number, number],
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  const target = {
    id: 'target',
    name: 'Clipboard target',
    width: 160,
    height: 120,
    shapes: [rect('target-art')],
  };
  const instance = symbolInstance(target, 80, 20);
  p.symbols = [
    {
      id: 'source',
      name: 'Clipboard source',
      width: 200,
      height: 120,
      shapes: [rect('a', ['outer', 'inner']), rect('b', ['outer']), instance],
    },
    target,
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 40, 40)];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const open = (name: string) =>
    openStaticLibraryArtwork(page,'Clipboard ' + name);
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const click = (name: string) => editor.getByRole('button', { name, exact: true }).click();
  await open('source');
  await editor.getByLabel('Symbol artwork preview').focus();
  await page.keyboard.press('Control+c');
  await click('Cancel symbol editing');
  await open('target');
  await click('Cut symbol artwork');
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await click('Paste symbol artwork');
  await click('Paste symbol artwork');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(5);
  await click('Cut symbol artwork');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(3);
  await click('Undo artwork change');
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(5);
  expect(await read()).toEqual(before);
  await click('Apply symbol changes');
  const committed = await read();
  const pasted = committed.symbols![1].shapes;
  expect(new Set(pasted.map((s) => s.id)).size).toBe(5);
  expect(pasted[1].groups![0]).toBe(pasted[2].groups![0]);
  expect(pasted[1].groups![0]).not.toBe(pasted[3].groups![0]);
  expect(pasted[1]).toMatchObject({ x: 20, y: 30, rotation: 15, transform: [1, 0.2, 0.3, 1] });
  expect(committed.symbols![0]).toEqual(before.symbols![0]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  await open('source');
  await editor.getByLabel('Symbol artwork item').selectOption(instance.id);
  await click('Copy symbol artwork');
  await click('Cancel symbol editing');
  await open('target');
  await click('Paste symbol artwork');
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(editor.getByLabel('Symbol artwork item').locator('option')).toHaveCount(5);
  await expect(
    editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await click('Cancel symbol editing');
  expect(await read()).toEqual(committed);
});

test('symbol group transforms preserve geometry and isolate rejection, draft and project undo', async ({
  page,
}) => {
  const p = newProject();
  const rect = (id: string, x: number, groups?: string[]) => ({
    id,
    groups,
    kind: 'rectangle' as const,
    x,
    y: 20,
    width: 40,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  p.symbols = [
    {
      id: 'transform',
      name: 'Transform group',
      width: 200,
      height: 100,
      shapes: [rect('a', 10, ['g']), rect('b', 90, ['g', 'inner']), rect('other', 150)],
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 40, 40)];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  const open = () =>
    openStaticLibraryArtwork(page,'Transform group');
  await open();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const click = (name: string) => editor.getByRole('button', { name, exact: true }).click();
  await editor.getByLabel('Symbol group transform dx', { exact: true }).fill('10');
  await editor.getByLabel('Symbol group transform scaleX', { exact: true }).fill('-100');
  await click('Transform symbol artwork group');
  await expect(editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('140');
  await editor.getByLabel('Symbol artwork item').selectOption('b');
  await expect(editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('60');
  await click('Undo artwork change');
  await expect(editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('10');
  await click('Redo artwork change');
  await editor.getByLabel('Symbol group transform scaleX', { exact: true }).fill('0');
  await click('Transform symbol artwork group');
  await expect(editor.getByRole('alert')).toBeVisible();
  expect(await read()).toEqual(before);
  await click('Reset symbol transform values');
  await click('Transform symbol artwork group');
  await click('Undo artwork change');
  await expect(editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('10');
  await click('Redo artwork change');
  await click('Apply symbol changes');
  const committed = await read();
  expect(committed.symbols![0].shapes[0]).toMatchObject({
    x: 140,
    y: 20,
    transform: [-1, 0, 0, 1],
    groups: ['g'],
    width: 40,
    height: 30,
  });
  expect(committed.symbols![0].shapes[1]).toMatchObject({
    x: 60,
    y: 20,
    transform: [-1, 0, 0, 1],
    groups: ['g', 'inner'],
  });
  expect(committed.symbols![0].shapes[2]).toEqual(before.symbols![0].shapes[2]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
  await open();
  await editor.getByLabel('Symbol group transform rotation', { exact: true }).fill('90');
  await click('Transform symbol artwork group');
  await click('Cancel symbol editing');
  expect(await read()).toEqual(committed);
});

test('nested symbol group isolation confines edits and preserves enclosing draft and project history', async ({
  page,
}) => {
  const p = newProject();
  const rect = (id: string, x: number, groups?: string[]) => ({
    id,
    groups,
    kind: 'rectangle' as const,
    x,
    y: 20,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  p.symbols = [
    {
      id: 'isolated',
      name: 'Isolation',
      width: 200,
      height: 100,
      shapes: [
        rect('outside', 0),
        rect('a', 40, ['outer', 'inner']),
        rect('b', 80, ['outer', 'inner']),
        rect('c', 120, ['outer']),
      ],
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 50, 50)];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await openStaticLibraryArtwork(page,'Isolation');
  const parent = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await parent.getByLabel('Symbol artwork item').selectOption('a');
  await parent.getByRole('button', { name: 'Edit symbol group in isolation', exact: true }).click();
  const isolated = page.getByRole('dialog', { name: 'Edit isolated symbol group', exact: true });
  await expect(isolated.getByLabel('Symbol artwork item').locator('option')).toHaveCount(3);
  await isolated
    .getByRole('button', { name: 'Edit symbol group in isolation', exact: true })
    .click();
  const inner = isolated.last(),
    outer = isolated.first();
  await expect(inner.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
  await inner.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await inner.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect(outer.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#0000ff');
  await outer.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(outer.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#ff0000');
  await outer.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await outer.getByRole('button', { name: 'Add symbol rectangle', exact: true }).click();
  await outer.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await read()).toEqual(before);
  await parent.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(parent.getByLabel('Symbol artwork item').locator('option')).toHaveCount(4);
  await parent.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await parent.getByRole('button', { name: 'Edit symbol group in isolation', exact: true }).click();
  await isolated.getByLabel('Symbol artwork fill', { exact: true }).fill('#00ff00');
  await page.keyboard.press('Escape');
  await expect(isolated).toHaveCount(0);
  await parent.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const committed = await read(),
    art = committed.symbols![0].shapes;
  expect(art.map((s) => s.id).slice(0, 4)).toEqual(['outside', 'a', 'b', 'c']);
  expect(art[0]).toEqual(before.symbols![0].shapes[0]);
  expect(art[1]).toMatchObject({ fill: '#0000ff', groups: ['outer', 'inner'] });
  expect(art[2]).toEqual(before.symbols![0].shapes[2]);
  expect(art[4].groups).toEqual(['outer']);
  expect(committed.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(committed);
});

test('static symbol stage-context editing maps reflected affine input and isolates recovery', async ({
  page,
}) => {
  const p = newProject();
  p.width = 500;
  p.height = 290;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 60,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const def = { id: 'def', name: 'Context', width: 100, height: 50, shapes: [art] };
  p.symbols = [def];
  const instance = symbolInstance(def, 250, 60);
  instance.width = 200;
  instance.height = 100;
  instance.transform = [-1, 0.2, 0.3, 1];
  p.layers[0].keys[0].shapes = [instance];
  p.layers.push({
    id: 'reference',
    name: 'Reference',
    visible: true,
    locked: true,
    keys: [{ frame: 0, shapes: [{ ...art, id: 'reference-art', x: 10, y: 10, fill: '#0000ff' }] }],
  });
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await expect(editor.getByText('Editing in stage context.', { exact: false })).toBeVisible();
  const canvas = editor.getByLabel('Symbol artwork preview');
  const box = (await canvas.boundingBox())!;
  const referencePixel = await canvas.evaluate((c) =>
    Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(40, 40, 1, 1).data),
  );
  expect(referencePixel[2]).toBe(255);
  expect(referencePixel[0]).toBeGreaterThan(170);
  expect(referencePixel[0]).toBeLessThan(190);

  const pos = (x: number, y: number) => ({
    x: box.x + ((20 + 250 - 2 * x + 0.6 * y) * box.width) / 540,
    y: box.y + ((20 + 60 + 0.4 * x + 2 * y) * box.height) / 330,
  });
  const a = pos(20, 20),
    b = pos(30, 25);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await editor.getByLabel('Symbol artwork x', { exact: true }).inputValue()),
    )
    .toBeCloseTo(10, 4);
  await expect
    .poll(async () =>
      Number(await editor.getByLabel('Symbol artwork y', { exact: true }).inputValue()),
    )
    .toBeCloseTo(5, 4);
  expect(await read()).toEqual(before);
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const after = await read();
  expect(after.layers).toEqual(before.layers);
  expect(after.symbols![0].shapes[0].x).toBeCloseTo(10, 4);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#00ff00');
  await editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await read()).toEqual(after);
});

test('animated symbol context opens at offset and edits one local track with isolated timeline history', async ({
  page,
}) => {
  const p = newProject();
  p.width = 500;
  p.height = 290;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const def = {
    id: 'def',
    name: 'Animated context',
    width: 100,
    height: 100,
    shapes: [art],
    timeline: {
      duration: 4,
      keys: [{ frame: 1, shapes: [{ ...art, fill: '#00ff00' }] }],
      layers: [
        {
          id: 'top',
          name: 'Reference track',
          visible: true,
          locked: true,
          keys: [
            { frame: 0, shapes: [] },
            { frame: 2, shapes: [{ ...art, id: 'ref', x: 80, fill: '#0000ff' }] },
          ],
        },
      ],
    },
  };
  p.symbols = [def];
  const instance = symbolInstance(def, 100, 50);
  instance.symbolPlayback = { mode: 'single', firstFrame: 1 };
  p.layers[0].keys[0].shapes = [instance];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced symbol timeline tools…', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('2');
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('3');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await expect(editor.getByLabel('Symbol artwork fill', { exact: true })).toHaveValue('#00ff00');
  const pixel = await editor
    .getByLabel('Symbol artwork preview')
    .evaluate((c) =>
      Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(210, 80, 1, 1).data),
    );
  expect(pixel[2]).toBe(255);
  expect(pixel[0]).toBeGreaterThan(170);
  expect(pixel[0]).toBeLessThan(190);
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#ffff00');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await read()).toEqual(before);
  await timeline.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await timeline.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await expect(timeline).toHaveCount(0);
  expect(await read()).toEqual(before);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].timeline!.keys.find((k) => k.frame === 2)!.shapes[0].fill).toBe(
    '#ffff00',
  );
  expect(after.symbols![0].timeline!.layers).toEqual(before.symbols![0].timeline!.layers);
  expect(after.symbols![0].shapes).toEqual(before.symbols![0].shapes);
  expect(after.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

for (const animated of [false, true]) {
  test(`nested static context navigation protects dirty drafts and commits only the nested definition (${animated ? 'animated' : 'static'} leaf)`, async ({
    page,
  }) => {
    const p = newProject();
    p.width = 500;
    p.height = 290;
    const art = {
      id: 'leaf-art',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 30,
      height: 30,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const leaf = {
      id: 'leaf',
      name: 'Context leaf',
      width: 50,
      height: 50,
      shapes: [art],
      ...(animated ? { timeline: { duration: 3, keys: [] } } : {}),
    };
    const mid = {
      id: 'mid',
      name: 'Context middle',
      width: 100,
      height: 100,
      shapes: [symbolInstance(leaf, 20, 10)],
    };
    mid.shapes[0].rotation = 30;
    mid.shapes[0].symbolPlayback = { mode: 'single', firstFrame: 1 };
    const root = {
      id: 'root',
      name: 'Context root',
      width: 150,
      height: 150,
      shapes: [symbolInstance(mid, 10, 10)],
    };
    root.shapes[0].transform = [-1, 0.2, 0.3, 1];
    p.symbols = [root, mid, leaf];
    p.layers[0].keys[0].shapes = [symbolInstance(root, 200, 50)];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+a');
    await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
    const navigate = () =>
      editor.getByRole('button', { name: 'Open nested symbol in stage context', exact: true });
    await editor.getByLabel('Symbol artwork x', { exact: true }).fill('15');
    await editor.getByLabel('Symbol artwork x', { exact: true }).press('Tab');
    await expect(navigate()).toBeDisabled();
    await editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await navigate().click();
    await expect(editor.getByRole('heading')).toHaveText('Edit symbol: Context middle');
    await expect(
      editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    await navigate().click();
    const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
    const returnButton = () =>
      (animated ? timeline : editor).getByRole('button', {
        name: 'Return to Context middle',
        exact: true,
      });
    await returnButton().click();
    await expect(editor.getByRole('heading')).toHaveText('Edit symbol: Context middle');
    await editor.getByRole('button', { name: 'Return to Context root', exact: true }).click();
    await expect(editor.getByRole('heading')).toHaveText('Edit symbol: Context root');
    await expect(editor.getByRole('button', { name: /^Return to / })).toHaveCount(0);
    expect(await read()).toEqual(before);
    await navigate().click();
    await navigate().click();
    if (animated) {
      await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('2');
      await timeline
        .getByRole('button', { name: 'Edit symbol frame artwork', exact: true })
        .click();
    } else {
      await expect(editor.getByRole('heading')).toHaveText('Edit symbol: Context leaf');
    }
    await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
    expect(await read()).toEqual(before);
    if (!animated) await expect(returnButton()).toBeDisabled();
    await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    if (animated) {
      await expect(returnButton()).toBeDisabled();
      expect(await read()).toEqual(before);
      await timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    }
    const after = await read();
    expect(
      animated
        ? after.symbols![2].timeline!.keys.find((k) => k.frame === 1)!.shapes[0].fill
        : after.symbols![2].shapes[0].fill,
    ).toBe('#0000ff');
    expect(after.symbols!.slice(0, 2)).toEqual(before.symbols!.slice(0, 2));
    expect(after.layers).toEqual(before.layers);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(after);
  });
}

test('animated track context navigation retains exposure offsets and returns to the selected frame', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'leaf-art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = { id: 'leaf', name: 'Track leaf', width: 50, height: 50, shapes: [art] };
  const mid = {
    id: 'mid',
    name: 'Track middle',
    width: 100,
    height: 100,
    shapes: [symbolInstance(leaf, 20, 10)],
    timeline: { duration: 5, keys: [] },
  };
  const nested = symbolInstance(mid, 10, 10);
  nested.symbolPlayback = { mode: 'loop' as const, firstFrame: 1 };
  nested.transform = [-1, 0.2, 0.3, 1];
  const root = {
    id: 'root',
    name: 'Track root',
    width: 150,
    height: 150,
    shapes: [nested],
    timeline: { duration: 6, keys: [] },
  };
  p.symbols = [root, mid, leaf];
  p.layers[0].keys[0].shapes = [symbolInstance(root, 200, 50)];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const openArtwork = () =>
    timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  const navigate = () =>
    editor
      .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
      .click();
  await timeline.getByLabel('Symbol frame', { exact: true }).fill('3');
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await openArtwork();
  await editor.getByLabel('Symbol artwork x', { exact: true }).fill('15');
  await editor.getByLabel('Symbol artwork x', { exact: true }).press('Tab');
  await expect(
    editor.getByRole('button', { name: 'Open nested symbol in stage context', exact: true }),
  ).toBeDisabled();
  await editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await navigate();
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('4');
  await openArtwork();
  await navigate();
  await expect(editor.getByRole('heading')).toHaveText('Edit symbol: Track leaf');
  await editor.getByRole('button', { name: 'Return to Track middle', exact: true }).click();
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('4');
  await timeline.getByRole('button', { name: 'Return to Track root', exact: true }).click();
  await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('3');
  expect(await read()).toEqual(before);
  await openArtwork();
  await editor.getByLabel('Symbol artwork x', { exact: true }).fill('18');
  await editor.getByLabel('Symbol artwork x', { exact: true }).press('Tab');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await openArtwork();
  await expect(
    editor.getByRole('button', { name: 'Open nested symbol in stage context', exact: true }),
  ).toHaveCount(0);
  await editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await timeline.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  expect(await read()).toEqual(before);
  await openArtwork();
  await navigate();
  await openArtwork();
  await navigate();
  await editor.getByLabel('Symbol artwork fill', { exact: true }).fill('#0000ff');
  await editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const after = await read();
  expect(after.symbols![2].shapes[0].fill).toBe('#0000ff');
  expect(after.symbols!.slice(0, 2)).toEqual(before.symbols!.slice(0, 2));
  expect(after.layers).toEqual(before.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

for (const edge of [false, true]) {
  test(`symbol contour Ink preserves compound fill and repaints only the clicked hole with isolated undo (${edge ? 'edge' : 'contour'})`, async ({
    page,
  }) => {
    const p = newProject();
    const art = {
      id: 'compound',
      kind: 'polygon' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
      points: [],
      fillRule: 'evenodd' as const,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        [
          { x: 20, y: 20 },
          { x: 80, y: 20 },
          { x: 80, y: 80 },
          { x: 20, y: 80 },
        ],
      ],
    };
    p.symbols = [{ id: 's', name: 'Contours', width: 100, height: 100, shapes: [art] }];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page
      .getByRole('group', { name: 'Symbol Contours', exact: true })
      .getByRole('button', { name: 'Edit symbol artwork', exact: true })
      .click();
    const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
    await t.getByLabel('Symbol canvas tool').selectOption('ink');
    await t
      .getByLabel(edge ? 'Ink one symbol edge' : 'Ink one symbol contour', { exact: true })
      .check();
    await t.getByLabel('New symbol line color').fill('#0000ff');
    await t.getByLabel('New symbol line width').fill('6');
    const canvas = t.getByLabel('Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(
      b.x + ((20 + 20 * 2.9) * b.width) / 540,
      b.y + ((20 + 50 * 2.9) * b.height) / 330,
    );
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    expect(await read()).toEqual(p);
    await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
    const pixels = await canvas.evaluate((c) => {
      const ctx = (c as HTMLCanvasElement).getContext('2d')!;
      return [
        ctx.getImageData(165, 165, 1, 1).data,
        ctx.getImageData(49, 165, 1, 1).data,
        ctx.getImageData(78, 165, 1, 1).data,
      ].map((d) => Array.from(d));
    });
    expect(pixels[0]).toEqual([255, 255, 255, 255]);
    expect(pixels[1]).toEqual([255, 0, 0, 255]);
    expect(pixels[2]).toEqual([0, 0, 255, 255]);
    await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    const shapes = (await read()).symbols![0].shapes;
    expect(shapes).toHaveLength(edge ? 4 : 3);
    expect(shapes[0]).toEqual({ ...art, strokeWidth: 0 });
    expect(shapes[1]).toMatchObject({
      stroke: '#000000',
      contours: [art.contours[0]],
      fillEnabled: false,
    });
    if (edge) {
      expect(shapes[2]).toMatchObject({
        kind: 'bezier',
        nodes: art.contours[1],
        stroke: '#000000',
        fillEnabled: false,
      });
      expect(shapes[3]).toMatchObject({
        kind: 'bezier',
        nodes: [art.contours[1][3], art.contours[1][0]],
        stroke: '#0000ff',
        strokeWidth: 6,
        fillEnabled: false,
      });
    } else
      expect(shapes[2]).toMatchObject({
        stroke: '#0000ff',
        strokeWidth: 6,
        contours: [art.contours[1]],
        fillEnabled: false,
      });
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  });
}

test('connected symbol contours exclude disconnected boundaries and cancel stale work', async ({
  page,
}) => {
  await holdGeometry(page);
  const p = newProject();
  const art = {
    id: 'compound',
    kind: 'polygon' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 2,
    points: [],
    fillRule: 'evenodd' as const,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ],
    ],
  };
  const line = {
    id: 'line',
    kind: 'line' as const,
    x: 20,
    y: 50,
    width: 30,
    height: 0,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
  };
  p.symbols = [{ id: 's', name: 'Network', width: 100, height: 100, shapes: [art, line] }];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Symbol Network', exact: true })
    .getByRole('button', { name: 'Edit symbol artwork', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await t.getByLabel('Symbol canvas tool').selectOption('ink');
  await t.getByLabel('Connected symbol strokes', { exact: true }).check();
  await t.getByLabel('Connected symbol contours', { exact: true }).check();
  await t.getByLabel('New symbol line color').fill('#0000ff');
  await t.getByLabel('New symbol line width').fill('6');
  const canvas = t.getByLabel('Symbol artwork preview');
  const click = async () => {
    await canvas.scrollIntoViewIfNeeded();
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(
      b.x + ((20 + 20 * 2.9) * b.width) / 540,
      b.y + ((20 + 35 * 2.9) * b.height) / 330,
    );
    await expect.poll(() => pendingGeometry(page)).toBe(1);
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await click();
  await page.keyboard.press('Escape');
  await releaseGeometry(page);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeDisabled();
  expect(await read()).toEqual(p);
  await click();
  await releaseGeometry(page);
  await expect(t.getByRole('button', { name: 'Undo artwork change', exact: true })).toBeEnabled();
  expect(await read()).toEqual(p);
  await t.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  const shapes = (await read()).symbols![0].shapes;
  expect(shapes).toHaveLength(4);
  expect(shapes[0]).toEqual({ ...art, strokeWidth: 0 });
  expect(shapes[1]).toMatchObject({ contours: [art.contours[0]], stroke: '#000000' });
  expect(shapes[2]).toMatchObject({
    contours: [art.contours[1]],
    stroke: '#0000ff',
    strokeWidth: 6,
  });
  expect(shapes[3]).toEqual({ ...line, stroke: '#0000ff', strokeWidth: 6 });
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('symbol key every frame preserves blank holds with isolated timeline and project undo', async ({
  page,
}) => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 's',
      name: 'Keys',
      width: 100,
      height: 100,
      shapes: [art],
      timeline: {
        duration: 8,
        keys: [
          { frame: 3, shapes: [] },
          { frame: 6, shapes: [{ ...art, id: 'later' }] },
        ],
      },
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    before = await read();
  await page
    .getByRole('group', { name: 'Symbol Keys', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const t = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await t.getByLabel('Symbol range start', { exact: true }).fill('2');
  await t.getByLabel('Symbol range end', { exact: true }).fill('5');
  await t.getByRole('button', { name: 'Key every symbol frame in range', exact: true }).click();
  expect(await read()).toEqual(before);
  await t.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await t.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await t.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 3, 4, 6]);
  expect(after.symbols![0].timeline!.keys[3].shapes).toEqual([]);
  expect(after.symbols![0].shapes).toEqual(before.symbols![0].shapes);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
});

for (const track of ['@base', 'overlay']) {
  test(`symbol distribution preserves ${track} histories with isolated undo and cancel`, async ({
    page,
  }) => {
    const p = newProject();
    const a = {
      id: 'a',
      kind: 'rectangle' as const,
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      rotation: 15,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      transform: [1, 0.2, 0.3, 1] as [number, number, number, number],
    };
    const b = { ...a, id: 'b', x: 35, fill: '#0000ff', groups: ['outer', 'inner'] };
    const c = { ...a, id: 'c', x: 75, fill: '#00ff00', groups: ['outer'] };
    const keys = [
      { frame: 0, shapes: [a, b, c] },
      { frame: 2, shapes: [] },
      { frame: 4, shapes: [{ ...a, x: 20 }, b, c] },
    ];
    p.symbols = [
      {
        id: 'distribution',
        name: 'Distribution',
        width: 150,
        height: 100,
        shapes: track === '@base' ? keys[0].shapes : [{ ...a, id: 'base' }],
        buttonStates: { up: 0, over: 1, down: 4, hit: 5 },
        timeline: {
          duration: 6,
          keys: track === '@base' ? keys.slice(1) : [],
          layers:
            track === 'overlay'
              ? [{ id: 'overlay', name: 'Overlay', visible: true, locked: false, keys }]
              : [],
        },
      },
    ];
    p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 100, 100)];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const before = await read();
    const open = () =>
      page
        .getByRole('group', { name: 'Symbol Distribution', exact: true })
        .getByRole('button', { name: 'Edit symbol timeline', exact: true })
        .click();
    await open();
    const dialog = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
    await dialog.getByLabel('Symbol layer', { exact: true }).selectOption(track);
    const distribute = () =>
      dialog
        .getByRole('button', { name: 'Distribute symbol artwork to layers', exact: true })
        .click();
    const canvas = dialog.getByLabel('Symbol timeline preview', { exact: true });
    // Compare intrinsic paint; scrolling the dialog can change screenshot edge compositing.
    const pixels = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
    await distribute();
    expect(await read()).toEqual(before);
    await expect
      .poll(
        async () => (await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL())) === pixels,
      )
      .toBe(true);
    await dialog.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
    await expect(dialog.getByLabel('Symbol layer', { exact: true }).locator('option')).toHaveCount(
      track === '@base' ? 1 : 2,
    );
    await dialog.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
    expect(await read()).toEqual(before);
    await open();
    await dialog.getByLabel('Symbol layer', { exact: true }).selectOption(track);
    await distribute();
    await dialog.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const after = await read(),
      result = after.symbols![0];
    expect(result.timeline!.duration).toBe(6);
    expect(result.buttonStates).toEqual(before.symbols![0].buttonStates);
    expect(after.layers).toEqual(before.layers);
    const tracks =
      track === '@base'
        ? [
            { keys: [{ frame: 0, shapes: result.shapes }, ...result.timeline!.keys] },
            result.timeline!.layers![0],
          ]
        : result.timeline!.layers!;
    expect(tracks).toHaveLength(2);
    for (let i = 0; i < keys.length; i++)
      expect(tracks.flatMap((l) => l.keys[i].shapes)).toEqual(keys[i].shapes);
    if (track === 'overlay') expect(result.shapes).toEqual(before.symbols![0].shapes);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(after);
  });
}

test('symbol motion in-betweens preserve state mappings and isolate draft and project history', async ({
  page,
}) => {
  const p = newProject();
  const a = {
    id: 'motion',
    kind: 'polygon' as const,
    fillRule: 'evenodd' as const,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 10, y: 20 },
      ],
    ],
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    gradient: {
      kind: 'linear' as const,
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
      stops: [
        { offset: 0, color: '#ff0000', opacity: 0.2 },
        { offset: 1, color: '#000000' },
      ],
    },
  };
  p.symbols = [
    {
      id: 'motion',
      name: 'Motion',
      width: 100,
      height: 100,
      shapes: [a],
      buttonStates: { up: 0, over: 1, down: 4, hit: 5 },
      timeline: {
        duration: 6,
        keys: [
          {
            frame: 4,
            shapes: [
              {
                ...a,
                x: 90,
                rotation: 90,
                opacity: 0,
                transform: [3, 0, 2, 5],
                contours: [
                  [
                    { x: 0, y: 20 },
                    { x: 20, y: 0 },
                    { x: 10, y: 20 },
                  ],
                ],
                gradient: {
                  ...a.gradient,
                  transform: [2, 0, 0.5, 3],
                  from: { x: 20, y: 0 },
                  to: { x: 60, y: 20 },
                  stops: [
                    { offset: 0.2, color: '#0000ff', opacity: 0.6 },
                    { offset: 0.8, color: '#00ff00' },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Motion', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const d = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await d.getByLabel('Symbol range start', { exact: true }).fill('1');
  await d.getByLabel('Symbol range end', { exact: true }).fill('5');
  await d.getByLabel('Symbol motion easing', { exact: true }).selectOption('custom');
  for (const [key, value] of [
    ['X1', String(1 / 3)],
    ['X2', String(2 / 3)],
    ['Y1', '0'],
    ['Y2', '0'],
  ])
    await d.getByLabel(`Symbol motion easing ${key}`, { exact: true }).fill(value);
  await d.getByRole('button', { name: 'Generate symbol motion in-betweens', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('enabled motion properties');
  expect(await read()).toEqual(p);
  await d.getByLabel('Symbol motion interpolate scale and skew', { exact: true }).check();
  await d.getByRole('button', { name: 'Generate symbol motion in-betweens', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('enabled motion properties');
  expect(await read()).toEqual(p);
  await d.getByLabel('Symbol motion interpolate paint colors', { exact: true }).check();
  await d.getByRole('button', { name: 'Generate symbol motion in-betweens', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('enabled motion properties');
  expect(await read()).toEqual(p);
  await d.getByLabel('Symbol motion interpolate gradient geometry', { exact: true }).check();
  await d.getByLabel('Symbol motion interpolate gradient basis', { exact: true }).check();
  await d.getByLabel('Symbol motion interpolate curve nodes', { exact: true }).check();
  await d.getByLabel('Symbol motion path', { exact: true }).check();
  await d.getByLabel('Symbol motion path even distance', { exact: true }).check();
  await d.getByLabel('Symbol motion path tangent rotation', { exact: true }).check();
  await d.getByLabel('Symbol motion path Start Y', { exact: true }).fill('0');
  await d.getByLabel('Symbol motion path End Y', { exact: true }).fill('0');
  await d.getByRole('button', { name: 'Generate symbol motion in-betweens', exact: true }).click();
  expect(await read()).toEqual(p);
  await d.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await d.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 3, 4]);
  expect(after.symbols![0].timeline!.keys[1].shapes[0]).toEqual({
    ...a,
    x: expect.closeTo(20, 2),
    y: 10,
    contours: [
      [
        { x: 0, y: expect.closeTo(2.5, 10) },
        { x: 20, y: 0 },
        { x: 10, y: 20 },
      ],
    ],
    rotation: expect.closeTo(11.25, 10),
    opacity: expect.closeTo(0.875, 10),
    gradient: {
      ...a.gradient,
      transform: [
        expect.closeTo(1.125, 10),
        0,
        expect.closeTo(0.0625, 10),
        expect.closeTo(1.25, 10),
      ],
      from: { x: expect.closeTo(2.5, 10), y: 0 },
      to: { x: expect.closeTo(25, 10), y: expect.closeTo(2.5, 10) },
      stops: [
        { offset: expect.closeTo(0.025, 10), color: '#df0020', opacity: expect.closeTo(0.25, 10) },
        { offset: expect.closeTo(0.975, 10), color: '#002000' },
      ],
    },
    transform: [expect.closeTo(1.25, 10), 0, expect.closeTo(0.25, 10), expect.closeTo(1.5, 10)],
  });
  expect(after.symbols![0].buttonStates).toEqual(p.symbols[0].buttonStates);
  expect(after.symbols![0].shapes).toEqual([a]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol primitive motion blends dimensions with isolated undo and exact endpoints', async ({
  page,
}) => {
  const p = newProject();
  const a = {
    id: 'primitive',
    kind: 'ellipse' as const,
    x: 10,
    y: 10,
    width: 20,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'primitive',
      name: 'Primitive',
      width: 120,
      height: 120,
      shapes: [a],
      buttonStates: { up: 0, over: 1, down: 4, hit: 5 },
      timeline: {
        duration: 6,
        keys: [{ frame: 4, shapes: [{ ...a, width: 100, height: 20, strokeWidth: 20 }] }],
      },
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Symbol Primitive', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const d = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await d.getByLabel('Symbol range start', { exact: true }).fill('1');
  await d.getByLabel('Symbol range end', { exact: true }).fill('5');
  const generate = d.getByRole('button', {
    name: 'Generate symbol motion in-betweens',
    exact: true,
  });
  await generate.click();
  await expect(d.getByRole('alert')).toContainText('enabled motion properties');
  expect(await read()).toEqual(p);
  await d.getByLabel('Symbol motion interpolate primitive geometry', { exact: true }).check();
  await d.getByLabel('Symbol motion interpolate stroke width', { exact: true }).check();
  await d.getByLabel('Symbol motion easing', { exact: true }).selectOption('in');
  await d.getByLabel('Symbol motion rotation', { exact: true }).selectOption('counterclockwise');
  await d.getByLabel('Symbol motion rotation extra turns', { exact: true }).fill('1');
  await generate.click();
  expect(await read()).toEqual(p);
  await d.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await d.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await d.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  const after = await read();
  expect(after.symbols![0].timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 3, 4]);
  expect(after.symbols![0].timeline!.keys[1].shapes[0]).toEqual({
    ...a,
    width: 40,
    height: 35,
    rotation: -90,
    strokeWidth: 5,
  });
  expect(after.symbols![0].timeline!.keys[3]).toEqual(p.symbols[0].timeline!.keys[0]);
  expect(after.symbols![0].shapes).toEqual([a]);
  expect(after.symbols![0].buttonStates).toEqual(p.symbols[0].buttonStates);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

test('symbol motion rejects existing capacity overflow before draft history or recovery changes', async ({
  page,
}) => {
  const p = newProject();
  const shapes = Array.from({ length: 11 }, (_, i) => ({
    id: 'budget-' + i,
    kind: 'rectangle' as const,
    x: i * 25,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  }));
  p.symbols = [
    {
      id: 'budget',
      name: 'Budget',
      width: 300,
      height: 30,
      shapes,
      timeline: { duration: 10000, keys: [{ frame: 9999, shapes: structuredClone(shapes) }] },
    },
  ];
  await page.addInitScript(
    (project) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await read();
  await page
    .getByRole('group', { name: 'Symbol Budget', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  const d = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await d.getByLabel('Symbol range start', { exact: true }).fill('1');
  await d.getByLabel('Symbol range end', { exact: true }).fill('10000');
  await d.getByRole('button', { name: 'Generate symbol motion in-betweens', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('existing project symbol artwork budget');
  await expect(
    d.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(await read()).toBe(before);
  await d.getByLabel('Symbol range end', { exact: true }).fill('5');
  await d.getByRole('button', { name: 'Generate symbol motion in-betweens', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('nonblank keys');
  expect(await read()).toBe(before);
});


for (const operation of ['distribute','duplicate'])
for (const track of operation === 'duplicate' ? ['@base','overlay'] : ['@base','overlay','stale']) test(`${operation} remembered symbol motion with isolated history: ${track}`, async ({page}) => {
  const p = newProject(), sourceId = track === 'stale' ? '@base' : track;
  const art = {id:'single',kind:'rectangle' as const,x:10,y:15,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  const child: SymbolDefinition = {id:'child',name:'Child',width:20,height:20,shapes:[art],
    timeline:{duration:2,keys:[{frame:1,shapes:[{...art,fill:'#00ff00'}]}]}};
  const linked = {...symbolInstance(child,40,20),id:'linked',groups:['group']};
  const keys = [0,4].map(frame=>({frame,shapes:[{...art,x:10+frame*5},{...linked,y:20+frame*4}]}));
  const owner: SymbolDefinition = {id:'parent',name:'Distribution',width:160,height:110,
    shapes:sourceId==='@base'?keys[0].shapes:[art],
    buttonStates:{up:0,over:1,down:3,hit:4},
    timeline:{duration:6,keys:sourceId==='@base'?keys.slice(1):[],
      layers:sourceId==='overlay'?[{id:'overlay',name:'Overlay',visible:true,locked:false,keys}]:[]}};
  const source = editSymbolBasicMotionSpan(owner,[sourceId],0,4,'create','linear',[owner,child]);
  if (track==='stale') source.timeline!.keys[1].shapes[0].x++;
  p.symbols = [source,child];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const dialog = page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  const layers = dialog.getByLabel('Symbol layer',{exact:true});
  const click = (name:string) => dialog.getByRole('button',{name,exact:true}).click();
  const open = async () => {
    await page.getByRole('group',{name:'Symbol Distribution',exact:true})
      .getByRole('button',{name:'Edit symbol timeline',exact:true}).click();
    await layers.selectOption(sourceId);
  };
  const command = operation === 'duplicate' ? 'Duplicate symbol layer' : 'Distribute symbol artwork to layers';
  const count = symbolLayers(source).length;
  await open();
  await click(command);
  if (track==='stale') {
    await expect(dialog.getByRole('alert')).toContainText('Generated keys changed');
    await expect(layers.locator('option')).toHaveCount(count);
    await expect(dialog.getByRole('button',{name:'Undo symbol timeline change'})).toBeDisabled();
    await click('Cancel symbol timeline');
    expect(await read()).toEqual(p);
    return;
  }
  await expect(layers.locator('option')).toHaveCount(count+1);
  await click('Undo symbol timeline change');
  await expect(layers.locator('option')).toHaveCount(count);
  await click('Redo symbol timeline change');
  await expect(layers.locator('option')).toHaveCount(count+1);
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await click(command);
  await layers.selectOption({index:count});
  await dialog.getByLabel('Symbol range start',{exact:true}).fill('1');
  await dialog.getByLabel('Symbol range end',{exact:true}).fill('5');
  await dialog.getByLabel('Remembered symbol motion easing',{exact:true}).selectOption('in');
  await click('Apply easing to remembered symbol motion');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const applied = await read(), tracks = symbolLayers(applied.symbols![0]);
  const [single,group] = tracks.slice(count-1);
  expect(single.motionSpans![0].ease).toBe('linear');
  expect(group.motionSpans![0].ease).toBe('in');
  const linkedIndex = operation === 'duplicate' ? 1 : 0;
  if (operation === 'duplicate') {
    expect(single).toEqual(symbolLayers(source).find(l=>l.id===sourceId));
    expect(group.keys[0].shapes[1].id).not.toBe(linked.id);
    expect(group.keys[0].shapes[1].groups).not.toEqual(linked.groups);
  }
  expect(group.keys[2].shapes[linkedIndex].y).toBeLessThan(keys[0].shapes[1].y+8);
  expect(group.keys[1].shapes[linkedIndex].symbolPlayback?.firstFrame).toBe(1);
  expect(applied.symbols![0].buttonStates).toEqual(owner.buttonStates);
  expect(applied.symbols![1]).toEqual(child);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(applied);
});

for (const batch of [false,true]) test(`symbol clipboard pastes independently editable remembered motion (routed ${batch})`, async ({page}) => {
  const p=newProject();
  const art={id:'ink',kind:'rectangle' as const,x:10,y:10,width:30,height:30,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  const child:SymbolDefinition={id:'child',name:'Child',width:30,height:30,shapes:[art],
    timeline:{duration:2,keys:[{frame:1,shapes:[{...art,fill:'#00ff00'}]}]}};
  const linked={...symbolInstance(child,10,10),id:'linked',groups:['group']};
  const poses=(s:typeof art|typeof linked)=>[0,4,7,11].map(frame=>({frame,shapes:[{...s,x:10+frame*5}]}));
  const keys=poses(linked);
  let owner:SymbolDefinition={id:'owner',name:'Owner',width:120,height:80,shapes:keys[0].shapes,
    buttonStates:{up:0,over:1,down:3,hit:4},
    timeline:{duration:12,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys:poses(art)}]}};
  for (const [a,b] of [[0,4],[7,11]]) owner=editSymbolBasicMotionSpan(owner,['@base','extra'],a,b,'create','linear',[owner,child]);
  p.symbols=[owner,child];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const dialog=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  const click=(name:string)=>dialog.getByRole('button',{name,exact:true}).click();
  const input=(label:string)=>dialog.getByLabel(label,{exact:true});
  const open=async()=>{
    await page.getByRole('group',{name:'Symbol Owner',exact:true}).getByRole('button',{name:'Edit symbol timeline',exact:true}).click();
    await input('Symbol range start').fill('1');await input('Symbol range end').fill('5');
    if(batch){
      await click('Select all symbol tracks');await click('Copy selected symbol tracks');
      await input('Copied symbol track 1 destination').selectOption('extra');
      await input('Copied symbol track 2 destination').selectOption('@base');
    }else{await click('Copy symbol frame range');await input('Symbol layer').selectOption('extra');}
  };
  const paste=async(at:number)=>{
    await input('Symbol frame range insertion').fill(String(at+1));
    await click(batch?'Insert copied symbol tracks':'Insert copied symbol frames');
  };
  await open();
  await paste(2);
  await expect(dialog.getByRole('alert')).toContainText('inside a remembered');
  await expect(input('Symbol duration')).toHaveValue('12');
  await paste(6);
  await expect(input('Symbol duration')).toHaveValue('17');
  await click('Undo symbol timeline change');await expect(input('Symbol duration')).toHaveValue('12');
  await click('Redo symbol timeline change');await expect(input('Symbol duration')).toHaveValue('17');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await paste(6);
  await input('Symbol layer').selectOption('extra');
  await input('Symbol range start').fill('7');await input('Symbol range end').fill('11');
  await input('Remembered symbol motion easing').selectOption('in');
  await click('Apply easing to remembered symbol motion');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const saved=await read(), result=saved.symbols![0], [base,extra]=symbolLayers(result);
  expect(result.buttonStates).toEqual(owner.buttonStates);
  expect(extra.motionSpans!.map(s=>[s.start,s.end,s.ease])).toEqual([[0,4,'linear'],[6,10,'in'],[12,16,'linear']]);
  const inserted=extra.keys.find(k=>k.frame===7)!.shapes[0];
  expect(inserted.symbolPlayback?.firstFrame).toBe(1);
  expect(inserted.id).not.toBe('linked');
  expect(inserted.groups).not.toEqual(['group']);
  if(batch) expect(base.motionSpans!.map(s=>s.start)).toEqual([0,6,12]);
  else expect(base).toEqual(symbolLayers(owner)[0]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});

for (const batch of [false,true]) test(`cut complete symbol motion with isolated clipboard and history (batch ${batch})`, async ({page}) => {
  const p=newProject(), art={id:'ink',kind:'rectangle' as const,x:0,y:0,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],groups:['group']};
  const keys=[0,2,6,10].map(frame=>({frame,shapes:[{...art,x:frame*4}]}));
  let owner: SymbolDefinition={id:'owner',name:'Owner',width:90,height:40,shapes:keys[0].shapes,
    timeline:{duration:12,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys:structuredClone(keys)}]},
    buttonStates:{up:0,over:3,down:8,hit:10}};
  for (const [a,b] of [[2,6],[6,10]]) owner=editSymbolBasicMotionSpan(owner,['@base','extra'],a,b,'create','linear');
  p.symbols=[owner];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const dialog=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  const click=(name:string)=>dialog.getByRole('button',{name,exact:true}).click();
  const input=(name:string)=>dialog.getByLabel(name,{exact:true});
  const range=async(first:number,last:number)=>{
    await input('Symbol range start').fill(String(first+1));await input('Symbol range end').fill(String(last+1));
  };
  const cut=()=>click(batch?'Cut selected symbol tracks':'Cut symbol frame range');
  const open=async()=>{
    await openLibraryTimelineTools(page, 'Owner');
    if(batch) await click('Select all symbol tracks');
  };
  await open();
  await range(2,6);await cut();
  await click('Undo symbol timeline change');await click('Redo symbol timeline change');
  await click('Cancel symbol timeline');expect(await read()).toEqual(p);
  await open();await range(2,6);await cut();
  await range(7,8);await cut();
  await expect(dialog.getByRole('alert')).toContainText('complete remembered');
  await input('Symbol frame range insertion').fill('13');
  await click(batch?'Insert copied symbol tracks':'Insert copied symbol frames');
  await expect(input('Symbol duration')).toHaveValue('17');
  expect(await read()).toEqual(p);
  await applyLibraryTimelineTools(page);
  const saved=await read(), result=saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  for(const [i,track] of symbolLayers(result).entries()){
    const source=symbolLayers(owner)[i];
    if(i===1&&!batch){expect(track).toEqual(source);continue;}
    expect(track.keys.filter(k=>k.frame<12)).toEqual([source.keys[0],{frame:2,shapes:[]},...source.keys.filter(k=>k.frame>=6)]);
    expect(track.motionSpans![0]).toEqual(source.motionSpans![1]);
    expect(track.motionSpans![1]).toMatchObject({start:12,end:16,ease:'linear'});
    expect(JSON.parse(track.motionSpans![1].baseline)).toEqual(track.keys.filter(k=>k.frame>12&&k.frame<16));
    expect(track.keys.at(-1)!.shapes[0].id).not.toBe(art.id);
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});

function symbolRangeMotionFixture() {
  const p=newProject(), seed={id:'seed',kind:'rectangle' as const,x:4,y:5,width:20,height:20,rotation:0,
    fill:'#cc0000',stroke:'#000000',strokeWidth:0,points:[]};
  const child:SymbolDefinition={id:'child',name:'Child',width:20,height:20,shapes:[seed],
    timeline:{duration:2,keys:[{frame:1,shapes:[{...seed,fill:'#00cc00'}]}]}};
  const linked={...symbolInstance(child,20,10),id:'linked',groups:['outer']};
  const keys=[0,2,6,9,13].map(frame=>({frame,shapes:frame===0?[seed]:[{...linked,x:20+frame*4}]}));
  let owner:SymbolDefinition={id:'owner',name:'Owner',width:100,height:40,shapes:keys[0].shapes,
    timeline:{duration:15,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys:structuredClone(keys)}]},
    buttonStates:{up:0,over:2,down:6,hit:13}};
  for(const [a,b] of [[2,6],[9,13]]) owner=editSymbolBasicMotionSpan(owner,['@base','extra'],a,b,'create','linear',[owner,child]);
  p.symbols=[owner,child];
  return { p, seed, owner, linked };
}

for (const batch of [false,true]) test(`symbol Duplicate range retains motion and its prior clipboard (batch ${batch})`, async ({page}) => {
  const { p, seed, owner, linked } = symbolRangeMotionFixture();
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const dialog=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  const click=(name:string)=>dialog.getByRole('button',{name,exact:true}).click();
  const input=(name:string)=>dialog.getByLabel(name,{exact:true});
  const range=async(first:number,last:number)=>{
    await input('Symbol range start').fill(String(first+1));
    await input('Symbol range end').fill(String(last+1));
  };
  const open=async()=>{
    await page.getByRole('group',{name:'Symbol Owner',exact:true}).getByRole('button',{name:'Edit symbol timeline',exact:true}).click();
    await range(0,0);
    if(batch) await click('Select all symbol tracks');
    await click(batch?'Copy selected symbol tracks':'Copy symbol frame range');
  };
  const duplicate=()=>click(batch?'Duplicate range on selected symbol tracks':'Duplicate symbol frame range');
  await open();
  await range(3,4);await duplicate();
  await expect(dialog.getByRole('alert')).toContainText('inside a remembered');
  await expect(dialog.getByRole('button',{name:'Undo symbol timeline change'})).toBeDisabled();
  await range(2,6);await duplicate();
  await expect(input('Symbol duration')).toHaveValue('20');
  await click('Undo symbol timeline change');await expect(input('Symbol duration')).toHaveValue('15');
  await click('Redo symbol timeline change');await expect(input('Symbol duration')).toHaveValue('20');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();await range(2,6);await duplicate();
  await input('Remembered symbol motion easing').selectOption('in');
  await click('Apply easing to remembered symbol motion');
  await input('Symbol frame range insertion').fill('21');
  await click(batch?'Insert copied symbol tracks':'Insert copied symbol frames');
  await expect(input('Symbol duration')).toHaveValue('21');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const saved=await read(), result=saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  expect(result.shapes).toEqual(owner.shapes);
  for(const [i,l] of symbolLayers(result).entries()){
    const original=symbolLayers(owner)[i];
    if(i===1&&!batch){expect(l).toEqual(original);continue;}
    expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[2,6],[7,11],[14,18]]);
    expect(l.motionSpans![0]).toEqual(original.motionSpans![0]);
    expect(l.motionSpans![2].id).toBe(original.motionSpans![1].id);
    const copy=l.keys.find(k=>k.frame===8)!.shapes[0];
    expect(copy.id).not.toBe(linked.id);
    expect(copy.groups).not.toEqual(linked.groups);
    expect(copy.symbolPlayback?.firstFrame).toBe(1);
    expect(l.keys.at(-1)!.shapes[0]).toMatchObject({kind:'rectangle',fill:seed.fill});
  }
  expect(result.timeline!.motionSpans![1].ease).toBe('in');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});

async function symbolMotionRangeEditor(page: Page, batch: boolean) {
  const { p, owner } = symbolRangeMotionFixture();
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({project, folder:null, manifest:null})), p);
  await page.goto('/');
  await page.getByRole('button', {name:'Recover changes', exact:true}).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const dialog = page.getByRole('dialog', {name:'Symbol timeline', exact:true});
  const click = (name:string) => dialog.getByRole('button', {name, exact:true}).click();
  const range = async (first:number, last:number) => {
    await dialog.getByLabel('Symbol range start', {exact:true}).fill(String(first));
    await dialog.getByLabel('Symbol range end', {exact:true}).fill(String(last));
  };
  const open = async () => {
    await openLibraryTimelineTools(page, 'Owner');
    if (batch) await click('Select all symbol tracks');
  };
  return { p, owner, read, dialog, click, range, open };
}

for (const batch of [false, true]) test(`symbol Remove range keeps surviving motion editable (batch ${batch})`, async ({page}) => {
  const { p, owner, read, dialog, click, range, open } = await symbolMotionRangeEditor(page, batch);
  const remove = () => click(batch ? 'Remove range on selected symbol tracks' : 'Remove symbol frame range');
  await open();
  await range(4,5);
  await remove();
  await expect(dialog.getByRole('alert')).toContainText('part of a remembered');
  await expect(dialog.getByRole('button', {name:'Undo symbol timeline change'})).toBeDisabled();
  await range(3,7);
  await remove();
  await click('Undo symbol timeline change');
  await click('Redo symbol timeline change');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await range(3,7);
  await remove();
  await range(5,9);
  await dialog.getByLabel('Remembered symbol motion easing', {exact:true}).selectOption('in');
  await click('Apply easing to remembered symbol motion');
  expect(await read()).toEqual(p);
  await applyLibraryTimelineTools(page);
  const saved = await read(), result = saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  expect(result.timeline!.duration).toBe(15);
  for (const [i, track] of symbolLayers(result).entries()) {
    const original = symbolLayers(owner)[i];
    if (i === 1 && !batch) { expect(track).toEqual(original); continue; }
    expect(track.motionSpans).toHaveLength(1);
    expect(track.motionSpans![0]).toMatchObject({id:original.motionSpans![1].id, start:4, end:8});
    expect(track.keys.at(-1)).toEqual({frame:10, shapes:[]});
  }
  expect(result.timeline!.motionSpans![0].ease).toBe('in');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
});

test('symbol range retiming regenerates nested graphic motion before Apply', async ({page}) => {
  const {p, owner} = symbolRangeMotionFixture();
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({project,folder:null,manifest:null})), p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('group',{name:'Symbol Owner',exact:true}).getByRole('button',{name:'Edit symbol timeline'}).click();
  const dialog = page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  const click = (name:string) => dialog.getByRole('button',{name,exact:true}).click();
  await click('Select all symbol tracks');
  await dialog.getByLabel('Symbol range start',{exact:true}).fill('3');
  await dialog.getByLabel('Symbol range end',{exact:true}).fill('7');
  await dialog.getByLabel('Retimed symbol range length',{exact:true}).fill('9');
  await click('Retime range on selected symbol tracks');
  await expect(dialog.getByLabel('Symbol duration',{exact:true})).toHaveValue('19');
  await click('Undo symbol timeline change');
  await expect(dialog.getByLabel('Symbol duration',{exact:true})).toHaveValue('15');
  await click('Redo symbol timeline change');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const saved = await read(), result = saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  for (const [i, layer] of symbolLayers(result).entries()) {
    expect(layer.motionSpans!.map(s => [s.start,s.end])).toEqual([[2,10],[13,17]]);
    expect(layer.motionSpans!.map(s => s.id)).toEqual(symbolLayers(owner)[i].motionSpans!.map(s => s.id));
    expect(layer.keys.some(key => key.frame === 11)).toBe(false);
    expect(layer.keys.find(key => key.frame === 7)!.shapes[0].symbolPlayback?.firstFrame).toBe(1);
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

for (const batch of [false, true]) test(`symbol Reverse range keeps nested graphic motion editable (batch ${batch})`, async ({page}) => {
  const {p, owner, read, click, range, open, dialog} = await symbolMotionRangeEditor(page, batch);
  const reverse = () => click(batch ? 'Reverse range on selected symbol tracks' : 'Reverse symbol frame range');
  await open();
  await range(4,5);
  await reverse();
  await expect(dialog.getByRole('alert')).toContainText('part of a remembered');
  await expect(dialog.getByRole('button',{name:'Undo symbol timeline change'})).toBeDisabled();
  await range(3,14);
  await reverse();
  await click('Undo symbol timeline change');
  await click('Redo symbol timeline change');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await range(3,14);
  await reverse();
  await range(3,7);
  await dialog.getByLabel('Remembered symbol motion easing',{exact:true}).selectOption('in');
  await click('Apply easing to remembered symbol motion');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const saved = await read(), result = saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  expect(result.timeline!.duration).toBe(15);
  for (const [i,layer] of symbolLayers(result).entries()) {
    const original = symbolLayers(owner)[i];
    if (i === 1 && !batch) { expect(layer).toEqual(original); continue; }
    expect(layer.motionSpans!.map(span => [span.start,span.end,span.id])).toEqual([
      [2,6,original.motionSpans![1].id],[9,13,original.motionSpans![0].id],
    ]);
    expect(layer.keys.find(key => key.frame === 14)!.shapes[0].symbolPlayback?.firstFrame).toBe(1);
  }
  expect(result.timeline!.motionSpans![0].ease).toBe('in');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
});

for (const batch of [false,true]) test(`symbol Clear preserves motion clipboard and isolated history (batch ${batch})`, async ({page}) => {
  const {p,owner,read,click,range,open,dialog} = await symbolMotionRangeEditor(page,batch);
  const copy = () => click(batch ? 'Copy selected symbol tracks' : 'Copy symbol frame range');
  const clear = () => click(batch ? 'Clear range on selected symbol tracks' : 'Clear symbol frame range');
  await open();
  await range(1,3);
  await clear();
  await expect(dialog.getByRole('alert')).toContainText('complete remembered');
  await range(4,5);
  await clear();
  await expect(dialog.getByRole('alert')).toContainText('complete remembered');
  await expect(dialog.getByRole('button',{name:'Undo symbol timeline change'})).toBeDisabled();
  await range(3,7);
  await clear();
  await click('Undo symbol timeline change');
  await click('Redo symbol timeline change');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await range(10,14);
  await copy();
  await range(3,7);
  await dialog.getByRole('button',{name:'Artwork, frame 3, key',exact:true}).focus();
  await page.keyboard.press('Delete');
  await expect(dialog.getByRole('button',{name:'Artwork, frame 3, blank key',exact:true})).toBeVisible();
  await dialog.getByLabel('Symbol frame range insertion',{exact:true}).fill('16');
  await click(batch ? 'Insert copied symbol tracks' : 'Insert copied symbol frames');
  expect(await read()).toEqual(p);
  await applyLibraryTimelineTools(page);
  const saved = await read(), result = saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  expect(result.shapes).toEqual(owner.shapes);
  expect(result.timeline!.duration).toBe(20);
  for (const [i,track] of symbolLayers(result).entries()) {
    const prior = symbolLayers(owner)[i];
    if (!batch && i===1) {expect(track).toEqual(prior); continue;}
    expect(track.motionSpans!.map(s => [s.start,s.end])).toEqual([[9,13],[15,19]]);
    expect(track.motionSpans![0]).toEqual(prior.motionSpans![1]);
    expect(track.motionSpans![1].id).not.toBe(prior.motionSpans![1].id);
    expect(track.keys.find(k => k.frame===7)!.shapes[0].symbolPlayback?.firstFrame).toBe(1);
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
});

for (const batch of [false,true]) test(`moving remembered symbol ranges retains recipe IDs and isolated history (batch ${batch})`, async ({page}) => {
  const {p,owner,read,click,range,open,dialog} = await symbolMotionRangeEditor(page,batch);
  const destination = dialog.getByLabel('Symbol range destination frame',{exact:true});
  const move = () => click(batch ? 'Move selected symbol spans to destination' : 'Move symbol range to destination');
  await open();
  await range(3,7);
  await destination.fill('10');
  await move();
  await expect(dialog.getByRole('alert')).toContainText('Destination range contains');
  await expect(dialog.getByRole('button',{name:'Undo symbol timeline change'})).toBeDisabled();
  await destination.fill('17');
  await move();
  await expect(dialog.getByLabel('Symbol duration',{exact:true})).toHaveValue('21');
  await click('Undo symbol timeline change');
  await expect(dialog.getByLabel('Symbol duration',{exact:true})).toHaveValue('15');
  await click('Redo symbol timeline change');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await range(3,7);
  await destination.fill('17');
  await move();
  await dialog.getByLabel('Remembered symbol motion easing',{exact:true}).selectOption('in');
  await click('Apply easing to remembered symbol motion');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const saved = await read(), result = saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  expect(result.shapes).toEqual(owner.shapes);
  for (const [i,track] of symbolLayers(result).entries()) {
    const original = symbolLayers(owner)[i];
    if (i===1 && !batch) {expect(track).toEqual(original);continue;}
    expect(track.motionSpans!.map(s => [s.start,s.end,s.id])).toEqual([
      [9,13,original.motionSpans![1].id],[16,20,original.motionSpans![0].id],
    ]);
    expect(track.keys.find(k => k.frame===2)!.shapes).toEqual([]);
    expect(track.keys.find(k => k.frame===7)!.shapes[0].symbolPlayback?.firstFrame).toBe(1);
    expect(track.keys.find(k => k.frame===16)!.shapes).toEqual(original.keys.find(k => k.frame===2)!.shapes);
  }
  expect(result.timeline!.motionSpans!.at(-1)!.ease).toBe('in');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
});

for (const move of [true,false]) test(`route complete remembered symbol ranges with isolated history (move ${move})`, async ({page}) => {
  const {p,owner,read,click,range,open,dialog} = await symbolMotionRangeEditor(page,true);
  const route = async (destination:number) => {
    await range(3,7);
    await dialog.getByLabel('Symbol span destination @base',{exact:true}).selectOption('extra');
    await dialog.getByLabel('Symbol span destination extra',{exact:true}).selectOption('@base');
    await dialog.getByLabel('Symbol range destination frame',{exact:true}).fill(String(destination));
    await click(move ? 'Move selected symbol spans to destination' : 'Copy selected symbol spans to destination');
  };
  await open();
  await route(10);
  await expect(dialog.getByRole('alert')).toContainText('Destination range contains');
  await expect(dialog.getByRole('button',{name:'Undo symbol timeline change'})).toBeDisabled();
  const destination = move ? 3 : 16;
  await route(destination);
  await click('Undo symbol timeline change');
  await click('Redo symbol timeline change');
  await click('Cancel symbol timeline');
  expect(await read()).toEqual(p);
  await open();
  await route(destination);
  await dialog.getByLabel('Remembered symbol motion easing',{exact:true}).selectOption('in');
  await click('Apply easing to remembered symbol motion');
  expect(await read()).toEqual(p);
  await click('Apply symbol timeline');
  const saved = await read(), result = saved.symbols![0];
  expect(result.buttonStates).toEqual(owner.buttonStates);
  for (const [i,layer] of symbolLayers(result).entries()) {
    const from = symbolLayers(owner)[1-i], prior = symbolLayers(owner)[i];
    const recipe = layer.motionSpans!.find(s => s.start===destination-1)!;
    if (move) expect(recipe.id).toBe(from.motionSpans![0].id);
    else {
      expect(recipe.id).not.toBe(from.motionSpans![0].id);
      expect(layer.motionSpans![0]).toEqual(prior.motionSpans![0]);
    }
    expect(layer.motionSpans![1]).toEqual(prior.motionSpans![1]);
    const first = layer.keys.find(k => k.frame===recipe.start)!.shapes[0];
    const old = from.keys.find(k => k.frame===2)!.shapes[0];
    expect(first.id).not.toBe(old.id);
    expect(first.groups).not.toEqual(old.groups);
    expect(first.symbolId).toBe(old.symbolId);
    expect(layer.keys.find(k => k.frame===recipe.start+1)!.shapes[0].symbolPlayback?.firstFrame).toBe(1);
  }
  expect(result.timeline!.motionSpans!.find(s => s.start===destination-1)!.ease).toBe('in');
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
});
