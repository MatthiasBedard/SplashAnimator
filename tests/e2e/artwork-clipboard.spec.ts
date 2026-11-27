import { test, expect } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { hitPart } from '../../packages/geometry/src';

for (const [sameColor,inPlace] of [[false,false],[true,false],[true,true]] as const)
test(`canvas paste${inPlace?' in place':''} floats until deselection and ${sameColor ? 'joins matching paint' : 'cuts different paint'}`, async ({page,context}) => {
  const p = newProject();
  p.width = 400; p.height = 280;
  const target: Vector = {id:'target',kind:'rectangle',x:145,y:90,width:100,height:80,rotation:0,
    fill:'#0088ff',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge'};
  const source = {...target,id:'source',x:80,y:80,width:60,height:60,fill:sameColor?target.fill:'#ff4400'};
  p.layers[0].drawingMode = 'merge';
  p.layers[0].keys[0].shapes = [target,source];
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const stage=page.getByLabel('Drawing stage',{exact:true});
  const box=(await stage.boundingBox())!;
  const at=(x:number,y:number)=>[box.x+box.width/2-200+x,box.y+box.height/2-140+y] as const;
  const read=()=>page.evaluate(()=>(JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const overlap={x:inPlace?104:151,y:120};
  const owners=(art:Vector[])=>art.filter(s=>hitPart(s,overlap,0)==='fill');
  await page.mouse.click(...at(100,105));
  await stage.press('Control+c');
  await stage.press(inPlace?'Control+Shift+v':'Control+v');
  await expect.poll(async()=>owners(await read()).length).toBe(2);
  const floating=await read();
  expect(floating.slice(0,2)).toEqual([target,source]);
  expect(floating[2]).toMatchObject({x:inPlace?80:96,y:inPlace?80:96,fill:source.fill});
  expect(floating[2].id).not.toBe(source.id);
  await stage.press('Escape');
  await expect.poll(async()=>owners(await read()).map(s=>s.fill)).toEqual([source.fill]);
  const settled=await read();
  expect(settled).toHaveLength(sameColor&&!inPlace?1:2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await stage.press('Control+z');
  await expect.poll(read).toEqual([target,source]);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(settled);
});

test('canvas Ctrl+V pastes external plain text and images on a Merge layer', async ({ page, context }) => {
  const p = newProject();
  p.width = 600;
  p.height = 400;
  p.layers[0].drawingMode = 'merge';
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null })), p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const content = 'One line\nTwo & <strong>literal</strong>';
  await page.evaluate(text => navigator.clipboard.writeText(text), content);
  await stage.press('Control+v');
  await expect(page.getByText('Pasted clipboard text', { exact: true })).toBeVisible();
  const withText = await read();
  expect(withText.layers[0]).toEqual(p.layers[0]);
  expect(withText.layers[1]).toMatchObject({ name: 'Clipboard', drawingMode: 'object' });
  expect(withText.layers[1].keys[0].shapes).toMatchObject([{ kind: 'text', text: { content } }]);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1020c0';
    ctx.fillRect(0, 0, 12, 8);
    const image = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image, 'text/plain': new Blob(['fallback'], { type: 'text/plain' }) })]);
  });
  await stage.press('Control+v');
  await expect(page.getByText('Pasted clipboard image', { exact: true })).toBeVisible();
  const withImage = await read();
  expect(withImage.assets[0].bitmap).toMatchObject({ width: 12, height: 8 });
  expect(withImage.layers[1].keys[0].shapes).toMatchObject([
    withText.layers[1].keys[0].shapes[0], { x: 294, y: 196, bitmap: { assetId: withImage.assets[0].id } },
  ]);
  await stage.press('Control+c');
  await stage.press('Control+v');
  await expect.poll(async () => (await read()).layers[1].keys[0].shapes.length).toBe(3);
  const duplicate = await read();
  expect(duplicate.assets).toEqual(withImage.assets);
  expect(duplicate.layers[1].keys[0].shapes[2].bitmap).toEqual(withImage.layers[1].keys[0].shapes[1].bitmap);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(withImage);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(withText);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await page.evaluate(() => navigator.clipboard.writeText('a'.repeat(10001)));
  await stage.press('Control+v');
  await expect(page.getByRole('alert')).toContainText('10,000 characters');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('New clipboard content'));
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Paste image or text from clipboard', exact: true }).click();
  await expect(page.getByText('Pasted clipboard text', { exact: true })).toBeVisible();
  expect((await read()).layers[1].keys[0].shapes[0].text?.content).toBe('New clipboard content');
});

test('external clipboard paste reaches the stage from toolbar focus and leaves text inputs alone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const selection = page.getByRole('button', { name: 'Selection', exact: true });
  await selection.click();
  await expect(selection).toBeFocused();
  await page.evaluate(() => navigator.clipboard.writeText('Text from another application'));
  await page.keyboard.press('Control+v');
  await expect(page.getByText('Pasted clipboard text', { exact: true })).toBeVisible();
  const project = await read();
  expect(project.layers.flatMap(layer => layer.keys[0].shapes)).toMatchObject([
    { kind: 'text', text: { content: 'Text from another application' } },
  ]);
  await expect(stage).toBeFocused();

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Clipboard test input');
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('Control+v');
  await expect(page.getByRole('textbox', { name: 'Clipboard test input' })).toHaveValue('Text from another application');
  expect(await read()).toEqual(project);

  await stage.press('Control+c');
  await stage.evaluate(canvas => {
    const data = new DataTransfer();
    data.setData('text/html', '<b>Rich markup only</b>');
    canvas.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('alert')).toContainText('Copy a PNG, JPEG, WebP or plain text');
  expect(await read()).toEqual(project);

  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('Canvas context paste'));
  await stage.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste image or text from clipboard' }).click();
  await expect.poll(async () =>
    (await read()).layers.flatMap(layer => layer.keys[0].shapes.map(shape => shape.text?.content)),
  ).toEqual(['Text from another application', 'Canvas context paste']);
});

test('system artwork JSON roundtrips through external text with fresh IDs and one history edit', async ({ page, context }) => {
  const p = newProject();
  p.width = 600;
  p.height = 400;
  const first: Vector = {
    id: 'gradient', x: 100, y: 80, width: 48, height: 30, kind: 'rectangle', rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [], groups: ['original-group'],
    gradient: { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 48, y: 0 },
      stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] },
  };
  const second: Vector = {
    ...first, id: 'sibling', x: 160, kind: 'ellipse', gradient: undefined, opacity: 0.6,
  };
  const originals = JSON.parse(JSON.stringify([first, second])) as Vector[];
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = originals;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(project => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem('splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }));
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 - 300 + 120, box.y + box.height / 2 - 200 + 90);
  const command = async (action: 'Copy' | 'Paste') => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: action + ' editable Splash Artwork JSON', exact: true }).click();
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await command('Copy');
  await expect(page.getByText('Copied editable Splash Artwork JSON', { exact: true })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clipboard)).toEqual({ format: 'splash-artwork-1', artwork: originals });
  expect(await read()).toEqual(p);

  const external = originals.map(shape => ({ ...shape, y: shape.y + 70 }));
  await page.evaluate(text => navigator.clipboard.writeText(text),
    JSON.stringify({ format: 'splash-artwork-1', artwork: external }));
  await command('Paste');
  await expect(page.getByText('Pasted editable Splash Artwork JSON', { exact: true })).toBeVisible();
  const pasted = await read();
  const [a, b, c, d] = pasted.layers[0].keys[0].shapes;
  expect([a, b]).toEqual(originals);
  expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
  expect(c.groups).not.toEqual(a.groups);
  expect(c.groups).toEqual(d.groups);
  expect([c, d].map((shape, i) => ({ ...shape, id: originals[i].id, groups: originals[i].groups })))
    .toEqual(external);
  expect(pasted.assets).toEqual(p.assets);
  await stage.click({ position: { x: 30, y: 60 } });
  const colors = await stage.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const x = Math.round(canvas.width / 2 - 300), y = Math.round(canvas.height / 2 - 200);
    return [112, 136].map(at => Array.from(ctx.getImageData(x + at, y + 162, 1, 1).data));
  });
  expect(colors[0][0]).toBeGreaterThan(colors[0][2]);
  expect(colors[1][2]).toBeGreaterThan(colors[1][0]);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(p);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(pasted);

  await page.evaluate(() => navigator.clipboard.writeText('<svg/>'));
  await command('Paste');
  await expect(page.getByRole('alert')).toContainText('valid Splash Artwork JSON');
  expect(await read()).toEqual(pasted);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.evaluate(text => navigator.clipboard.writeText(text), clipboard);
  await page.getByRole('button', { name: 'Toggle lock ' + p.layers[0].name, exact: true }).click();
  const locked = await read();
  await command('Paste');
  await expect(page.getByRole('alert')).toContainText('Choose an unlocked');
  expect(await read()).toEqual(locked);
});
