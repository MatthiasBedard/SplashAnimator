import { expect, test } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { mapPoint, matrix } from '../../packages/geometry/src/affine';
import { exportHTML } from '../../packages/export-web/src';

function line(id: string, x: number, length: number): Vector {
  return { id, kind: 'line', x, y: 30, width: length, height: 0, rotation: 0,
    fill: '#ffffff', fillEnabled: false, stroke: '#ff0000', strokeWidth: 6,
    drawingMode: 'object', points: [{ x: 0, y: 0 }, { x: length, y: 0 }] };
}

test('attaches editable artwork to a rig through posing, in-betweens, reopen and HTML playback', async ({ page, context }) => {
  const p = newProject();
  p.width = 160;
  p.height = 100;
  p.duration = 5;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [line('upper', 30, 40), line('lower', 70, 30), {
    id: 'art', kind: 'rectangle', x: 78, y: 18, width: 10, height: 10, rotation: 0,
    fill: '#008000', stroke: '#000000', strokeWidth: 0, drawingMode: 'object', points: [],
  }];
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  const open = async () => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const splash = page.getByRole('button', { name: 'Open editor', exact: true });
    const recover = page.getByRole('button', { name: 'Recover changes', exact: true });
    await expect(splash.or(recover)).toBeVisible();
    if (await splash.isVisible()) await splash.click();
    await recover.click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  };
  await open();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  const clickStage = async ([x, y]: [number, number]) => {
    const rect = (await stage.boundingBox())!;
    await page.mouse.click(rect.x + rect.width / 2 + x - 80, rect.y + rect.height / 2 + y - 50);
  };
  const select = async (a: [number, number], b: [number, number]) => {
    await clickStage([140, 80]);
    await clickStage(a);
    await page.keyboard.down('Shift');
    await clickStage(b);
    await page.keyboard.up('Shift');
  };
  await select([50, 30], [85, 30]);
  const controls = page.getByRole('group', { name: 'Two-bone rig', exact: true });
  await controls.getByRole('button', { name: 'Bind selected lines' }).click();
  const bound = await read();
  expect(bound.layers[0].keys[0].shapes.map(shape => shape.bone?.role)).toEqual(['upper', 'lower', undefined]);
  await select([92, 30], [83, 23]);
  await controls.getByRole('button', { name: 'Attach artwork to bone', exact: true }).click();
  const attached = await read();
  expect(attached.layers[0].keys[0].shapes[2].boneAttachment).toMatchObject({ boneId: 'lower', local: [1, 0, 0, 1, 8, -12] });
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(bound);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(attached);
  await timeline.click({ position: { x: 45, y: 40 } });
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('3');
  await select([50, 30], [92, 30]);
  await controls.getByLabel('Bone tip X').fill('70');
  await controls.getByLabel('Bone tip Y').fill('60');
  await controls.getByRole('button', { name: 'Set bone pose' }).click();
  const posed = await read();
  expect(posed.layers[0].keys.map(key => key.frame)).toEqual([0, 2]);
  expect(posed.layers[0].keys[0]).toEqual(attached.layers[0].keys[0]);
  const [upper, lower, art] = posed.layers[0].keys[1].shapes;
  const elbow = mapPoint(matrix(upper), upper.points[1]);
  expect(elbow.x).toBeCloseTo(41.2);
  expect(elbow.y).toBeCloseTo(68.4);
  const tip = mapPoint(matrix(lower), lower.points[1]);
  expect(tip.x).toBeCloseTo(70);
  expect(tip.y).toBeCloseTo(60);
  expect(art.x).toBeCloseTo(45.52, 8);
  expect(art.y).toBeCloseTo(54.64, 8);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(attached);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(posed);
  if (!(await controls.getByRole('button', { name: 'Remove bone bindings' }).isVisible()))
    await select([35.6, 49.2], [63, 62]);
  await controls.getByText('In-between poses', { exact: true }).click();
  await controls.getByLabel('First pose frame', { exact: true }).fill('1');
  await controls.getByLabel('Last pose frame', { exact: true }).fill('3');
  const generate = controls.getByRole('button', { name: 'Generate in-between poses', exact: true });
  await generate.click();
  const generated = await read();
  const keys = generated.layers[0].keys;
  expect(keys.map(key => key.frame)).toEqual([0, 1, 2]);
  expect([keys[0], keys[2]]).toEqual(posed.layers[0].keys);
  const [midUpper, midLower, midArt] = keys[1].shapes;
  const [root, joint, lowerRoot, midTip] = [mapPoint(matrix(midUpper), midUpper.points[0]),
    mapPoint(matrix(midUpper), midUpper.points[1]), mapPoint(matrix(midLower), midLower.points[0]),
    mapPoint(matrix(midLower), midLower.points[1])];
  expect(joint.x).toBeCloseTo(lowerRoot.x, 10);
  expect(joint.y).toBeCloseTo(lowerRoot.y, 10);
  expect(Math.hypot(joint.x - root.x, joint.y - root.y)).toBeCloseTo(40, 10);
  expect(Math.hypot(midTip.x - joint.x, midTip.y - joint.y)).toBeCloseTo(30, 10);
  expect(midTip.x).toBeCloseTo(85, 10);
  expect(midTip.y).toBeCloseTo(45, 10);
  expect(midArt.boneAttachment).toEqual(art.boneAttachment);
  await generate.click();
  await expect(page.getByText(/Remove intermediate keys before generating bone poses/)).toBeVisible();
  expect(await read()).toEqual(generated);

  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(posed);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(generated);
  await open();
  expect(await read()).toEqual(generated);
  await timeline.click({ position: { x: 27, y: 40 } });
  await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('2');
  const shot = await stage.screenshot({ scale: 'css' });
  const stagePixel = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const pixel = Array.from(ctx.getImageData(Math.floor(bitmap.width / 2 - 13), Math.floor(bitmap.height / 2 - 4), 1, 1).data);
    bitmap.close();
    return pixel;
  }, [...shot]);
  expect(stagePixel).toEqual([0, 128, 0, 255]);
  await clickStage([67, 46]);
  await controls.getByRole('button', { name: 'Detach artwork', exact: true }).click();
  const detached = (await read()).layers[0].keys[1].shapes[2];
  expect(detached.boneAttachment).toBeUndefined();
  expect(matrix(detached)).toEqual(matrix(midArt));
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(generated);

  const player = await context.newPage();
  try {
    await player.evaluate(() => {
      const queue: FrameRequestCallback[] = [];
      window.requestAnimationFrame = draw => queue.push(draw);
      Reflect.set(window, 'boneFrames', queue);
    });
    await player.setContent(exportHTML(await read()));
    await player.waitForFunction(() => Reflect.get(window, 'boneFrames').length > 0);
    const pixels = await player.evaluate(() => {
      const queue = Reflect.get(window, 'boneFrames') as FrameRequestCallback[];
      const ctx = document.querySelector('canvas')!.getContext('2d')!;
      return [0, 44, 88].map(at => {
        for (const draw of queue.splice(0)) draw(at);
        return [[83, 23], [67, 46], [52, 58]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      });
    });
    expect(pixels).toEqual([
      [[0, 128, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255]],
      [[255, 255, 255, 255], [0, 128, 0, 255], [255, 255, 255, 255]],
      [[255, 255, 255, 255], [255, 255, 255, 255], [0, 128, 0, 255]],
    ]);
  } finally {
    await player.close();
  }
});
