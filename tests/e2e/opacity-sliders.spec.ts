import { test, expect, type Page, type Locator } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { exportHTML } from '../../packages/export-web/src';
import { blendModes } from '../../packages/document/src/blend-modes';

async function setup(page: Page, mode: 'object' | 'merge' = 'object', symbols = false, blendBackdrop = false, graphic: boolean | 'movie' | 'group' | 'saved-effects' | 'blend-group' | 'tint-group' = false, keyedBlend: boolean | 'tint' = false) {
  const p = newProject();
  p.width = 400;
  p.height = 260;
  p.layers[0].drawingMode = mode;
  p.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 40,
      y: 60,
      width: 100,
      height: 80,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  if (blendBackdrop) {
    const art=p.layers[0].keys[0].shapes[0];
    art.stroke='#ff0000'; art.strokeWidth=12; art.opacity=.5;
    p.layers[0].keys[0].shapes.unshift({...art,id:'back',x:20,y:40,width:80,height:120,
      fill:'#00ffff',strokeWidth:0,opacity:1});
  }
  if (symbols)
    p.symbols = [
      {
        id: 'symbol',
        name: 'Sliders',
        width: 100,
        height: 80,
        shapes: [
          {
            ...p.layers[0].keys[0].shapes[0],
            x: 0,
            y: 0,
            gradient: {
              kind: 'linear',
              from: { x: 0, y: 0 },
              to: { x: 100, y: 0 },
              stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
              ],
            },
          },
        ],
      },
    ];
  if(graphic===true || graphic==='movie'){
    const original=p.layers[0].keys[0].shapes[0];
    p.symbols=[{id:'pair',name:'Overlapping paints',width:100,height:80,shapes:[
      {...original,x:0,y:0},{...original,id:'front',x:50,y:0,width:60,fill:'#0000ff'}]}];
    p.layers[0].keys[0].shapes=[{...original,kind:'symbol',symbolId:'pair',opacity:.5}];
  }
  if(graphic==='group'||graphic==='saved-effects'||graphic==='blend-group'||graphic==='tint-group'){
    const art={...p.layers[0].keys[0].shapes[0],groups:['pair'],width:50};
    p.layers[0].keys[0].shapes=[art,{...art,id:'blue',x:90,fill:'#0000ff'},
      {...art,id:'cover',groups:[],x:120,width:10,fill:'#00ff00'}];
  }
  if(graphic==='blend-group'||graphic==='tint-group'){
    const layer=p.layers[0], [red,blue,cover]=layer.keys[0].shapes;
    p.duration=4;p.fps=4;
    red.width=80;blue.width=70;blue.opacity=.5;
    layer.keys[0].shapes.unshift({...cover,id:'back',x:20,width:120,fill:'#00ffff'});
    const later=structuredClone(layer.keys[0]);
    later.frame=2;
    for(const item of later.shapes)if(item.groups?.includes('pair'))item.groupBlur={group:'pair',radius:4,blendMode:'screen'};
    layer.keys.push(later);
    if(graphic==='tint-group')blue.tint={color:'#ff0000',amount:1};
  }
  if(graphic==='saved-effects'){
    const art=p.layers[0].keys[0].shapes[2];
    p.symbols=[{id:'paint',name:'Filtered paint',width:10,height:80,shapes:[{...art,x:0,y:0,blurRadius:3,paintBrightness:-.25}]}];
    p.layers[0].keys[0].shapes.push({...art,id:'object',x:160,blurRadius:2,blendMode:'multiply',paintBrightness:.25,tint:{color:'#ffa080',amount:.5}});
    for(const [index,mode] of (['loop','movie'] as const).entries())
      p.layers[0].keys[0].shapes.push({...art,id:mode,kind:'symbol',symbolId:'paint',x:200+index*40,
        symbolPlayback:{mode,firstFrame:0},instanceBlend:index?'multiply':'screen',instanceBlur:3+index,instanceTint:{color:'#1050a0',amount:.25}});
  }
  if(graphic==='movie'){
    p.duration=5;p.fps=4;
    const pair=p.symbols![0], front=pair.shapes[1];
    const playback={mode:'movie' as const,firstFrame:0};
    p.symbols!.push({id:'colors',name:'Color cycle',width:60,height:80,
      shapes:[{...front,x:0}],timeline:{duration:3,keys:[{frame:1,shapes:[{...front,x:0,fill:'#00ff00'}]}]}});
    pair.shapes[1]={...front,kind:'symbol',symbolId:'colors',symbolPlayback:playback};
    const instance=p.layers[0].keys[0].shapes[0];
    instance.symbolPlayback=playback;
    p.layers.push({...p.layers[0],id:'later',name:'Later placement',keys:[
      {frame:0,shapes:[]},{frame:1,shapes:[{...instance,id:'second',x:220,instanceBlur:4}]}]});
  }
  if(keyedBlend==='tint'){
    p.duration=4;p.fps=4;
    p.symbols![0].shapes[1].opacity=.5;
    const layer=p.layers[0],instance=layer.keys[0].shapes[0];
    layer.keys.push({frame:2,shapes:[{...instance,instanceTint:{color:'#ff0000',amount:1},instanceBlur:3}]});
  }else if(keyedBlend){
    p.duration=4;p.fps=4;
    const layer=p.layers[0],instance=layer.keys[0].shapes[0];
    const back={...p.symbols![0].shapes[0],id:'cyan',x:10,y:40,width:125,height:120,fill:'#00ffff'};
    if(graphic==='movie')instance.instanceBlur=4;
    layer.keys[0].shapes.unshift(back);
    layer.keys.push({frame:2,shapes:[{...back},{...instance,instanceBlend:graphic==='movie'?'multiply':'screen'}]});
  }
  await page.addInitScript(
    (p) => {
      if (!localStorage.getItem('splash-recovery-v1')) localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    },
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
  async function select() {
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2 - 120, b.y + b.height / 2 - 30);
  }
  return {
    p,
    read,
    select,
    canvas,
    settle: () => expect(page.locator('main.editor')).not.toHaveAttribute('inert', ''),
  };
}
async function startDrag(page: Page, slider: Locator, to = 0.4) {
  await slider.scrollIntoViewIfNeeded();
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + b.width - 8, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 8 + (b.width - 16) * to, b.y + b.height / 2, { steps: 12 });
}
for (const mode of ['object', 'merge'] as const)
  test(`${mode} opacity slider links the number during drag, then commits one selected edit on release`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.select();
    const slider = page.getByRole('slider', { name: 'Object opacity slider', exact: true }),
      number = page.getByLabel('Object opacity', { exact: true });
    await startDrag(page, slider);
    const amount = Number(await slider.inputValue());
    expect(amount).toBeGreaterThan(20);
    expect(amount).toBeLessThan(60);
    await expect(number).toHaveValue(String(amount));
    expect(await f.read()).toEqual(f.p);
    await page.mouse.up();
    await f.settle();
    await expect(number).toHaveValue(String(amount));
    const saved = await f.read();
    expect(saved.layers[0].keys[0].shapes[0].opacity).toBe(amount / 100);
    await number.fill('75');
    await number.press('Tab');
    await f.settle();
    await expect(slider).toHaveValue('75');
    if (mode === 'object')
      await page
        .locator('#dock-body-paint')
        .screenshot({ path: 'test-results/opacity-controls.png' });
    await f.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(saved);
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(saved);
  });

test('Escape cancels slider adjustment without clearing selection or adding history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  const slider = page.getByRole('slider', { name: 'Object opacity slider', exact: true });
  await startDrag(page, slider);
  await slider.press('Escape');
  await page.mouse.up();
  await expect(slider).toHaveValue('100');
  await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('100');
  expect(await f.read()).toEqual(f.p);
  await slider.focus();
  await slider.press('Home');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].opacity).toBe(0);
  await slider.press('End');
  await expect.poll(async () => (await f.read()).layers[0].keys[0].shapes[0].opacity).toBe(1);
});

test('source changes during a slider drag cannot apply the stale value', async ({ page }) => {
  const f = await setup(page);
  await f.select();
  const slider = page.getByRole('slider', { name: 'Object opacity slider', exact: true });
  await startDrag(page, slider);
  // A real document source edit while the original pointer remains down.
  await page.evaluate(() => {
    const name = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
    name.value = 'Changed source';
    name.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.mouse.up();
  await f.settle();
  const expected = structuredClone(f.p);
  expected.layers[0].name = 'Changed source';
  expect(await f.read()).toEqual(expected);
  await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('100');
  await startDrag(page, slider, 0.6);
  await page.mouse.up();
  await f.settle();
  expect((await f.read()).layers[0].keys[0].shapes[0].opacity).toBeLessThan(1);
});

test('gradient opacity slider remains linked and preserves selection and the other stop', async ({
  page,
}) => {
  const f = await setup(page, 'merge');
  await f.select();
  await page.getByLabel('Fill type', { exact: true }).selectOption('linear');
  await f.settle();
  const before = await f.read();
  const slider = page.getByRole('slider', { name: 'Gradient opacity 1 slider', exact: true });
  await startDrag(page, slider, 0.3);
  const amount = Number(await slider.inputValue());
  await expect(page.getByLabel('Gradient opacity 1', { exact: true })).toHaveValue(String(amount));
  expect(await f.read()).toEqual(before);
  await page.mouse.up();
  await f.settle();
  await expect(slider).toHaveValue(String(amount));
  const after = await f.read();
  expect(after.layers[0].keys[0].shapes[0].gradient!.stops[0].opacity).toBe(amount / 100);
  expect(after.layers[0].keys[0].shapes[0].gradient!.stops[1]).toEqual(
    before.layers[0].keys[0].shapes[0].gradient!.stops[1],
  );
});

test('opacity channel sliders edit local drafts until Apply and retain exact fractional number input', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  await page.getByRole('button', { name: 'Add opacity channel', exact: true }).click();
  const group = page.getByRole('group', { name: 'Opacity key 1', exact: true }),
    slider = group.getByRole('slider', { name: 'Opacity (%) slider', exact: true }),
    number = group.getByLabel('Opacity (%)', { exact: true });
  await startDrag(page, slider, 0.2);
  await page.mouse.up();
  await expect(number).toHaveValue(await slider.inputValue());
  expect(await f.read()).toEqual(f.p);
  await number.fill('33.125');
  await number.press('Tab');
  await expect(slider).toHaveValue('33.125');
  await page.getByRole('button', { name: 'Apply opacity channel', exact: true }).click();
  expect((await f.read()).opacityBindings![0].keys[0].opacity).toBe(0.33125);
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('onion opacity keeps its original bounds and changes only view settings', async ({ page }) => {
  const f = await setup(page);
  const timeline = page.getByLabel('Timeline frames', { exact: true }),
    b = (await timeline.boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.getByText('Onion skin settings', { exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Onion opacity slider', exact: true });
  await expect(slider).toHaveAttribute('max', '80');
  await slider.focus();
  await slider.press('End');
  await expect(page.getByLabel('Onion opacity', { exact: true })).toHaveValue('80');
  await page.getByLabel('Onion opacity', { exact: true }).fill('35');
  await page.getByLabel('Onion opacity', { exact: true }).press('Tab');
  await expect(slider).toHaveValue('35');
  expect(await f.read()).toEqual(f.p);
});

test('symbol gradient opacity slider preserves local Cancel and Apply history', async ({
  page,
}) => {
  const f = await setup(page, 'object', true);
  async function openArtwork() {
    await page.getByRole('option', { name: 'Library item Sliders', exact: true }).dblclick();
    await expect(page.getByRole('main', { name: 'Symbol editing workspace', exact: true })).toBeVisible();
    await f.canvas.press('Control+a');
  }
  await openArtwork();
  const slider = page.getByRole('slider', {
    name: 'Gradient opacity 1 slider',
    exact: true,
  });
  await startDrag(page, slider, 0.5);
  const amount = Number(await slider.inputValue());
  await page.mouse.up();
  await expect(page.getByLabel('Gradient opacity 1', { exact: true })).toHaveValue(
    String(amount),
  );
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  await openArtwork();
  await startDrag(page, slider, 0.65);
  const appliedAmount = Number(await slider.inputValue());
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  expect((await f.read()).symbols![0].shapes[0].gradient!.stops[0].opacity).toBe(
    appliedAmount / 100,
  );
  await f.canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
});

test('returning the slider to its original value does not materialize opacity or history', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  const slider = page.getByRole('slider', { name: 'Object opacity slider', exact: true });
  await startDrag(page, slider, 0.2);
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2);
  await page.mouse.up();
  await expect(slider).toHaveValue('100');
  expect(await f.read()).toEqual(f.p);
  await startDrag(page, slider, 0.3);
  await slider.dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(slider).toHaveValue('100');
  expect(await f.read()).toEqual(f.p);
});

test('blank opacity-channel number remains invalid until corrected', async ({ page }) => {
  const f = await setup(page);
  await f.select();
  await page.getByRole('button', { name: 'Add opacity channel', exact: true }).click();
  const number = page.getByLabel('Opacity (%)', { exact: true });
  await number.fill('');
  await page.getByRole('button', { name: 'Apply opacity channel', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await number.fill('50');
  await page.getByRole('button', { name: 'Apply opacity channel', exact: true }).click();
  expect((await f.read()).opacityBindings![0].keys[0].opacity).toBe(0.5);
});

test('symbol onion opacity slider and number retain original view-only units', async ({ page }) => {
  const f = await setup(page, 'object', true);
  await page.getByRole('option', { name: 'Library item Sliders', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Symbol onion opacity slider', exact: true }),
    number = page.getByLabel('Symbol onion opacity', { exact: true });
  await expect(slider).toHaveAttribute('max', '1');
  await number.fill('0.5');
  await expect(slider).toHaveValue('0.5');
  await slider.focus();
  await slider.press('Home');
  await expect(number).toHaveValue('0');
  await slider.press('End');
  await expect(number).toHaveValue('1');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
});

test('blank gradient opacity remains a rejected numeric edit and allows correction', async ({
  page,
}) => {
  const f = await setup(page);
  await f.select();
  await page.getByLabel('Fill type', { exact: true }).selectOption('linear');
  const before = await f.read();
  const number = page.getByLabel('Gradient opacity 1', { exact: true });
  await number.fill('');
  await number.press('Tab');
  expect(await f.read()).toEqual(before);
  await expect(
    page.getByRole('slider', { name: 'Gradient opacity 1 slider', exact: true }),
  ).toHaveValue('100');
  await number.fill('50');
  await number.press('Tab');
  expect((await f.read()).layers[0].keys[0].shapes[0].gradient!.stops[0].opacity).toBe(0.5);
});

test('paint brightness keeps authored paint through history, recovery and standalone playback',async({page})=>{
  const f=await setup(page);
  await f.select();
  const field=page.getByLabel('Paint brightness',{exact:true});
  await field.fill('50'); await field.press('Tab');
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[0].paintBrightness=.5;
  await expect.poll(f.read).toEqual(expected);
  const stage=()=>f.canvas.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(
    Math.round(c.width/2-120*devicePixelRatio),Math.round(c.height/2-30*devicePixelRatio),1,1).data));
  await expect.poll(stage).toEqual([255,128,128,255]);
  await field.fill('0'); await field.press('Tab');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await expect.poll(stage).toEqual([255,128,128,255]);
  const output=await page.context().newPage();
  try {
    await output.setContent(exportHTML(await f.read()));
    await expect.poll(()=>output.locator('canvas').first().evaluate((c:HTMLCanvasElement)=>
      Array.from(c.getContext('2d')!.getImageData(80,90,1,1).data))).toEqual([255,128,128,255]);
  } finally { await output.close(); }
});

test('blur on an isolated drawing retains its halo, source paint and opacity through recovery and export', async ({page})=>{
  const f=await setup(page);
  await f.select();
  const field=page.getByLabel('Blur radius',{exact:true});
  await field.fill('4'); await field.press('Tab');
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[0].blurRadius=4;
  await expect.poll(f.read).toEqual(expected);
  await field.fill('0'); await field.press('Tab');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const stage=()=>f.canvas.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(
    Math.round(c.width/2-163*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data));
  await expect.poll(stage).toEqual([255,198,198,255]);
  expected.layers[0].keys[0].shapes[0].opacity=.5;
  const output=await page.context().newPage();
  try {
    await output.setContent(exportHTML(expected,0,true));
    await expect.poll(()=>output.locator('canvas').first().evaluate((c:HTMLCanvasElement)=>
      [35,37,40,80].map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data)))).toEqual([
      [0,0,0,0],[255,0,0,28],[255,0,0,71],[255,0,0,128]]);
  } finally { await output.close(); }
});

for(const blend of [undefined,'multiply','screen','subtract'] as const) test(`minified PNG export preserves blurred alpha across tile seams (${blend??'normal'})`,async({page})=>{
  const chunk=await pngFixture();
  const p=newProject();p.width=700;p.height=80;
  p.layers[0].keys[0].shapes=[{id:'wide',kind:'rectangle',x:-8,y:20,width:680,height:40,
    rotation:0,fill:'#ff0000',stroke:'#ff0000',strokeWidth:2,points:[],opacity:.5,blurRadius:4}];
  await page.goto('/');
  if(blend){
    const art=p.layers[0].keys[0].shapes[0];
    art.blendMode=blend;
    p.layers[0].keys[0].shapes.unshift({...art,id:'back',x:0,width:513,fill:'#00ffff',
      strokeWidth:0,blurRadius:undefined,blendMode:undefined,opacity:1});
  }
  await page.addScriptTag({content:chunk.code});
  const pixels=await page.evaluate(async project=>{
    const api=(window as unknown as {BlurPNG:typeof import('../../apps/editor/src/export-png')}).BlurPNG;
    const image=await createImageBitmap(await api.exportPNGFrame(project,0,undefined,true));
    try{
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
      return [0,511,512,513,670].map(x=>Array.from(ctx.getImageData(x,40,1,1).data));
    }finally{image.close();}
  },p);
  const backdrop=blend==='screen'?[128,255,255,255]:blend==='subtract'?[0,255,255,255]:[0,127,127,255];
  expect(pixels.slice(0,4)).toEqual(blend?[backdrop,backdrop,backdrop,[255,0,0,128]]:Array(4).fill([255,0,0,128]));
  expect(pixels[4][3]).toBeLessThan(128);
  expect(pixels[4][3]).toBeGreaterThan(64);
});

for(const blend of ['multiply','screen','subtract'] as const) test(`${blend} blends isolated fill and stroke once with the backdrop through undo, recovery and export`,async({page})=>{
  const f=await setup(page,'object',false,true);
  await f.select();
  const field=page.getByLabel('Drawing blend mode',{exact:true});
  await expect(field.locator('option')).toHaveText(['Normal', ...blendModes.map(([, label]) => label)]);
  await field.selectOption(blend);
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[1].blendMode=blend;
  await expect.poll(f.read).toEqual(expected);
  await field.selectOption('normal');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  // x=42 is covered by both the red fill and its stroke, x=80 by fill alone.
  const onCyan=blend==='multiply'?[0,127,127,255]:blend==='subtract'?[0,255,255,255]:[128,255,255,255];
  const onWhite=blend==='multiply'?[255,127,127,255]:blend==='subtract'?[127,255,255,255]:[255,255,255,255];
  async function expectPixels(read: () => Promise<number[][]>, expected: number[][]) {
    if (blend === 'subtract') {
      // The software path round-trips through an 8-bit scratch canvas before source-over.
      await expect.poll(async () => Math.max(...(await read()).flatMap((pixel, row) =>
        pixel.map((value, channel) => Math.abs(value - expected[row][channel]))))).toBeLessThanOrEqual(1);
    } else {
      await expect.poll(read).toEqual(expected);
    }
  }
  await expectPixels(()=>f.canvas.evaluate((c:HTMLCanvasElement)=>[42,80,120].map(x=>
    Array.from(c.getContext('2d')!.getImageData(Math.round(c.width/2+(x-200)*devicePixelRatio),
      Math.round(c.height/2-40*devicePixelRatio),1,1).data))),[onCyan,onCyan,onWhite]);
  const bounds=(await f.canvas.boundingBox())!;
  const origin={x:bounds.x+bounds.width/2-200,y:bounds.y+bounds.height/2-130};
  await page.mouse.move(origin.x+30,origin.y+90);
  await page.mouse.down();
  await page.mouse.move(origin.x+50,origin.y+90,{steps:3});
  await expect.poll(()=>f.canvas.evaluate((c:HTMLCanvasElement)=>
    Array.from(c.getContext('2d')!.getImageData(Math.round(c.width/2-120*devicePixelRatio),
      Math.round(c.height/2-40*devicePixelRatio),1,1).data))).toEqual(onCyan);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.read()).toEqual(expected);
  for(const transparent of [true,false]){
    const output=await page.context().newPage();
    try{
      await output.setContent(exportHTML(expected,0,transparent));
      await expectPixels(()=>output.locator('canvas').first().evaluate((c:HTMLCanvasElement)=>
        [42,80,120].map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data))),
        [onCyan,onCyan,transparent?[255,0,0,128]:onWhite]);
    }finally{await output.close();}
  }
});

async function pngFixture(){
  const {build}=await import('vite');
  const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,minify:'esbuild',
    lib:{entry:'apps/editor/src/export-png.ts',formats:['iife'],name:'BlurPNG'}}});
  const chunk=(Array.isArray(bundle)?bundle:[bundle]).flatMap(b=>'output' in b?b.output:[]).find(o=>o.type==='chunk');
  if(!chunk||chunk.type!=='chunk')throw Error('Missing PNG fixture');
  return chunk;
}

for (const scope of ['Group', 'Instance'] as const) {
  test(`${scope} offers the full blend list and exports Linear Dodge once per composite`, async ({ page }) => {
    const group = scope === 'Group';
    const f = await setup(page, 'object', false, false, group ? 'blend-group' : true, !group);
    await f.select();
    if (!group) await page.getByLabel('Add effect', { exact: true }).selectOption('blend');
    const select = page.getByLabel(`${scope} blend mode`, { exact: true });
    await expect(select.locator('option')).toHaveText(['Normal', ...blendModes.map(([, label]) => label)]);
    await select.selectOption('linear-dodge');
    const expected = structuredClone(f.p);
    const shapes = expected.layers[0].keys[0].shapes;
    if (group) {
      for (const shape of shapes.filter(member => member.groups?.includes('pair')))
        shape.groupBlur = { group: 'pair', radius: 0, blendMode: 'linear-dodge' };
    } else {
      shapes[1].instanceBlend = 'linear-dodge';
    }
    await expect.poll(f.read).toEqual(expected);
    const x = group ? 105 : 80;
    const pixel = group ? [127, 255, 255, 255] : [128, 255, 255, 255];
    await expect.poll(() => f.canvas.evaluate((c: HTMLCanvasElement, x) => Array.from(c.getContext('2d')!.getImageData(
      Math.round(c.width / 2 + (x - 200) * devicePixelRatio),
      Math.round(c.height / 2 - 40 * devicePixelRatio), 1, 1).data), x)).toEqual(pixel);
    const output = await page.context().newPage();
    try {
      await output.setContent(exportHTML(expected, 0, true));
      await expect.poll(() => output.locator('canvas').evaluate((c: HTMLCanvasElement, x) =>
        Array.from(c.getContext('2d')!.getImageData(x, 90, 1, 1).data), x)).toEqual(pixel);
    } finally {
      await output.close();
    }
  });
}

test('graphic instance blur isolates overlapping children through reset, Undo, recovery and transparent PNG',async({page})=>{
  const f=await setup(page,'object',false,false,true);
  await f.select();
  await page.getByLabel('Add effect',{exact:true}).selectOption('blur');
  const field=page.getByLabel('Graphic blur radius',{exact:true});
  await field.fill('4');await field.press('Tab');
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[0].instanceBlur=4;
  await expect.poll(f.read).toEqual(expected);
  await field.fill('0');await field.press('Tab');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const xs=[37,80,110,145];
  await expect.poll(()=>f.canvas.evaluate((c:HTMLCanvasElement,points)=>points.map(x=>Array.from(c.getContext('2d')!
    .getImageData(Math.round(c.width/2+(x-200)*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data)),xs))
    .toEqual([[255,227,227,255],[255,127,127,255],[127,127,255,255],[127,127,255,255]]);
  await f.canvas.focus();await page.keyboard.press('Control+Enter');
  const preview=page.getByLabel('Test movie interaction',{exact:true});
  await expect.poll(()=>preview.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(110,90,1,1).data)))
    .toEqual([127,127,255,255]);
  await page.keyboard.press('Escape');
  await page.addScriptTag({content:(await pngFixture()).code});
  const pixels=await page.evaluate(async({project,points})=>{
    const api=(window as unknown as {BlurPNG:typeof import('../../apps/editor/src/export-png')}).BlurPNG;
    const image=await createImageBitmap(await api.exportPNGFrame(project,0,undefined,true));
    try {
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
      return points.map(x=>Array.from(ctx.getImageData(x,90,1,1).data));
    } finally {image.close();}
  },{project:expected,points:xs});
  expect(pixels).toEqual([[255,0,0,28],[255,0,0,128],[0,0,255,128],[0,0,255,128]]);
});

test('movie clip blur preserves nested clocks in the stage, Test Movie and exported animation',async({page})=>{
  const f=await setup(page,'object',false,false,'movie');
  await f.select();
  await page.getByLabel('Add effect',{exact:true}).selectOption('blur');
  const field=page.getByLabel('Movie clip blur radius',{exact:true});
  await field.fill('4');await field.press('Tab');
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[0].instanceBlur=4;
  await expect.poll(f.read).toEqual(expected);
  await f.canvas.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const blue=[127,127,255,255],green=[127,255,127,255],halo=[255,227,227,255];
  const stagePixels=()=>f.canvas.evaluate((c:HTMLCanvasElement)=>[37,110,290].map(x=>Array.from(c.getContext('2d')!
    .getImageData(Math.round(c.width/2+(x-200)*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data)));
  await expect.poll(stagePixels).toEqual([halo,blue,[255,255,255,255]]);
  await page.getByRole('button',{name:'Play animation',exact:true}).click();
  await expect.poll(stagePixels,{intervals:[30,50,80]}).toEqual([halo,green,blue]);
  await page.getByRole('button',{name:'Stop playback',exact:true}).click();
  await f.canvas.focus();await page.keyboard.press('Control+Enter');
  const preview=page.getByLabel('Test movie interaction',{exact:true});
  const pixels=(canvas:Locator)=>canvas.evaluate((c:HTMLCanvasElement)=>[37,110,290].map(x=>
    Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data)));
  await expect.poll(()=>pixels(preview),{intervals:[30,50,80]}).toEqual([halo,green,blue]);
  await page.keyboard.press('Escape');
  const output=await page.context().newPage();
  try{
    await output.setContent(exportHTML(expected,'sequence',true));
    const canvas=output.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-capture','waiting');
    for(const [first,second] of [
      [[0,0,255,128],[0,0,0,0]],[[0,255,0,128],[0,0,255,128]],
      [[0,255,0,128],[0,255,0,128]],[[0,0,255,128],[0,255,0,128]]
    ]){
      await canvas.dispatchEvent('capture-next');
      expect(await pixels(canvas)).toEqual([[255,0,0,28],first,second]);
    }
  }finally{await output.close();}
});

test('drawing group blur paints the shared edge once and retains selection and stacking',async({page})=>{
  const f=await setup(page,'object',false,false,'group');
  await f.select();
  const field=page.getByLabel('Group blur radius',{exact:true});
  await field.fill('4');await field.press('Tab');
  const expected=structuredClone(f.p);
  for(const s of expected.layers[0].keys[0].shapes.slice(0,2))s.groupBlur={group:'pair',radius:4};
  await expect.poll(f.read).toEqual(expected);
  await expect(field).toHaveValue('4');
  await f.canvas.press('Control+z');await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+Shift+z');await expect.poll(f.read).toEqual(expected);
  await f.select();
  await field.fill('0');await field.press('Tab');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');await expect.poll(f.read).toEqual(expected);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const colors=[[255,198,198,255],[113,0,142,255],[0,255,0,255]];
  await expect.poll(()=>f.canvas.evaluate((c:HTMLCanvasElement)=>[37,90,125].map(x=>Array.from(c.getContext('2d')!
    .getImageData(Math.round(c.width/2+(x-200)*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data))))
    .toEqual(colors);
  await f.canvas.focus();await page.keyboard.press('Control+Enter');
  const pixels=(canvas:Locator)=>canvas.evaluate((c:HTMLCanvasElement)=>[37,90,125].map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data)));
  await expect.poll(()=>pixels(page.getByLabel('Test movie interaction',{exact:true}))).toEqual(colors);
  const output=await page.context().newPage();
  try{
    await output.setContent(exportHTML(expected,0,true));
    const canvas=output.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-capture','ready');
    expect(await pixels(canvas)).toEqual([[255,0,0,57],colors[1],colors[2]]);
  }finally{await output.close();}
  await page.addScriptTag({content:(await pngFixture()).code});
  const captured=await page.evaluate(async(project)=>{
    const api=(window as unknown as {BlurPNG:typeof import('../../apps/editor/src/export-png')}).BlurPNG;
    const image=await createImageBitmap(await api.exportPNGFrame(project,0,undefined,true));
    try{
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
      return [37,90,125].map(x=>Array.from(ctx.getImageData(x,90,1,1).data));
    }finally{image.close();}
  },expected);
  expect(captured).toEqual([[255,0,0,57],colors[1],colors[2]]);
});

test('project folder reopens editable blur on a complete drawing group',async({page,baseURL})=>{
  test.skip(new URL(baseURL!).port!=='1420' || !process.env.SPLASH_TEST_LICENSE,'Requires the licensed local folder bridge');
  const f=await setup(page,'object',false,false,'saved-effects');
  await f.select();
  const field=page.getByLabel('Group blur radius',{exact:true});
  await field.fill('4');await field.press('Tab');
  await page.getByLabel('Group blend mode').selectOption('multiply');
  await page.getByLabel('Group tint color').fill('#ff0000');
  await page.getByLabel('Group tint amount',{exact:true}).fill('100');await page.getByLabel('Group tint amount',{exact:true}).press('Tab');
  const name='Filter-roundtrip-'+Date.now();
  await f.canvas.press('Control+s');
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button',{name:'Save project folder',exact:true}).click();
  await expect(page.getByText('Saved to folder',{exact:true})).toBeVisible();
  const opened=await page.context().newPage();
  try{
    await opened.goto('/');
    await opened.getByRole('button',{name:'File',exact:true}).click();
    await opened.getByRole('button',{name:/Open .spl folder/}).click();
    await opened.getByRole('button',{name:new RegExp(name)}).click();
    await expect(opened.getByText('Opened '+name,{exact:true})).toBeVisible();
    await opened.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
    const canvas=opened.getByLabel('Drawing stage',{exact:true});
    await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(
      Math.round(c.width/2-110*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data))).toEqual([255,0,0,255]);
    const box=(await canvas.boundingBox())!;
    await opened.mouse.click(box.x+box.width/2-120,box.y+box.height/2-30);
    const reopened=opened.getByLabel('Group blur radius',{exact:true});
    await expect(reopened).toHaveValue('4');
    const blend=opened.getByLabel('Group blend mode');
    await expect(blend).toHaveValue('multiply');
    await blend.selectOption('normal');
    await expect(opened.getByLabel('Group tint amount',{exact:true})).toHaveValue('100');
    await opened.getByRole('button',{name:'Reset tint',exact:true}).click();
    await reopened.fill('0');await reopened.press('Tab');
    await expect.poll(()=>opened.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.layers[0].keys[0].shapes))
      .toEqual(f.p.layers[0].keys[0].shapes);
    expect(await opened.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project.symbols)).toEqual(f.p.symbols);
  }finally{await opened.close();}
});

for(const movie of [false,true])test('instance blend respects child overlap, opacity and keyed playback (movie='+movie+')',async({page})=>{
  const f=await setup(page,'object',false,false,movie?'movie':true,true);
  await f.select();
  await page.getByLabel('Add effect',{exact:true}).selectOption('blend');
  const field=page.getByLabel('Instance blend mode',{exact:true});
  const blend=movie?'screen':'multiply';
  await field.selectOption(blend);
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[1].instanceBlend=blend;
  await expect.poll(f.read).toEqual(expected);
  await field.selectOption('normal');
  await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');await expect.poll(f.read).toEqual(expected);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const redMultiply=[0,127,127,255],redScreen=[128,255,255,255],
    blueMultiply=[0,127,255,255],cyan=[0,255,255,255],greenMultiply=[0,255,127,255];
  const first=movie?[redScreen,cyan]:[redMultiply,blueMultiply];
  await expect.poll(()=>f.canvas.evaluate((c:HTMLCanvasElement)=>[80,110].map(x=>Array.from(c.getContext('2d')!
    .getImageData(Math.round(c.width/2+(x-200)*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data))))
    .toEqual(first);
  if(!movie){
    const box=(await f.canvas.boundingBox())!;
    const x=box.x+box.width/2-200,y=box.y+box.height/2-40;
    await page.mouse.move(x+25,y);await page.mouse.down();await page.mouse.move(x-65,y,{steps:4});
    await expect.poll(()=>f.canvas.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(
      Math.round(c.width/2-120*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data))).toEqual([255,127,127,255]);
    await page.keyboard.press('Escape');await page.mouse.up();
    expect(await f.read()).toEqual(expected);
  }
  const pixels=(canvas:Locator)=>canvas.evaluate((c:HTMLCanvasElement)=>[80,110,145].map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data)));
  await f.canvas.focus();await page.keyboard.press('Control+Enter');
  const preview=page.getByLabel('Test movie interaction',{exact:true});
  const later=movie?[redMultiply,greenMultiply]:[redScreen,cyan];
  await expect.poll(async()=>(await pixels(preview)).slice(0,2),{intervals:[30,50,80]}).toEqual(later);
  await page.keyboard.press('Escape');
  const output=await page.context().newPage();
  try{
    await output.setContent(exportHTML(expected,'sequence',true));
    const canvas=output.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-capture','waiting');
    for(const frame of [0,1,2]){
      await canvas.dispatchEvent('capture-next');
      expect(await pixels(canvas)).toEqual([...(frame===2?later:first),movie && frame>0?[0,255,0,128]:[0,0,255,128]]);
    }
  }finally{await output.close();}
});

test('drawing group blends its composed children once, with independent blur and keyed playback',async({page})=>{
  const f=await setup(page,'object',false,false,'blend-group');
  await f.select();
  const mode=page.getByLabel('Group blend mode'),radius=page.getByLabel('Group blur radius',{exact:true});
  await mode.selectOption('multiply');await radius.fill('4');await radius.press('Tab');
  await mode.selectOption('normal');await expect(radius).toHaveValue('4');
  await mode.selectOption('multiply');await radius.fill('0');await radius.press('Tab');
  await expect(mode).toHaveValue('multiply');
  const expected=structuredClone(f.p);
  for(const member of expected.layers[0].keys[0].shapes)if(member.groups?.includes('pair'))
    member.groupBlur={group:'pair',radius:0,blendMode:'multiply'};
  await expect.poll(f.read).toEqual(expected);
  await mode.selectOption('normal');await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');await expect.poll(f.read).toEqual(expected);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const stagePixel=()=>f.canvas.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(
    Math.round(c.width/2-95*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data));
  await expect.poll(stagePixel).toEqual([0,0,128,255]);
  const box=(await f.canvas.boundingBox())!, x=box.x+box.width/2-200,y=box.y+box.height/2-40;
  await page.mouse.move(x+28,y);await page.mouse.down();await page.mouse.move(x-52,y,{steps:4});
  await expect.poll(stagePixel).toEqual([127,0,128,255]);await page.keyboard.press('Escape');await page.mouse.up();
  await f.canvas.focus();await page.keyboard.press('Control+Enter');
  const preview=page.getByLabel('Test movie interaction',{exact:true});
  await expect.poll(()=>preview.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(105,90,1,1).data)),{intervals:[30,50]}).toEqual([127,255,255,255]);
  await page.keyboard.press('Escape');
  const output=await page.context().newPage();
  try{
    await output.setContent(exportHTML(expected,'sequence',true));
    const canvas=output.locator('canvas').first();await expect(canvas).toHaveAttribute('data-capture','waiting');
    for(const frame of [0,1,2]){
      await canvas.dispatchEvent('capture-next');
      expect(await canvas.evaluate((c:HTMLCanvasElement)=>[105,125,150].map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data))))
        .toEqual([frame===2?[127,255,255,255]:[0,0,128,255],[0,255,0,255],[0,0,255,128]]);
    }
  }finally{await output.close();}
  await page.addScriptTag({content:(await pngFixture()).code});
  const png=await page.evaluate(async project=>{
    const api=(window as unknown as {BlurPNG:typeof import('../../apps/editor/src/export-png')}).BlurPNG;
    const image=await createImageBitmap(await api.exportPNGFrame(project,2,undefined,true));
    try{
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
      return [105,125,150].map(x=>Array.from(ctx.getImageData(x,90,1,1).data));
    }finally{image.close();}
  },expected);
  expect(png).toEqual([[127,255,255,255],[0,255,0,255],[0,0,255,128]]);
});

for(const movie of [false,true]) test('placement tint preserves overlapping and translucent child pixels (movie='+movie+')',async({page})=>{
  const f=await setup(page,'object',false,false,movie?'movie':true,'tint');
  await f.select();
  await page.getByLabel('Add effect',{exact:true}).selectOption('tint');
  const color=page.getByLabel('Instance tint color'),amount=page.getByLabel('Instance tint amount',{exact:true});
  await color.fill('#00ff00');await amount.fill('50');await amount.press('Tab');
  const expected=structuredClone(f.p);
  expected.layers[0].keys[0].shapes[0].instanceTint={color:'#00ff00',amount:.5};
  await expect.poll(f.read).toEqual(expected);
  await page.getByRole('button',{name:'Remove tint effect',exact:true}).click();await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');await expect.poll(f.read).toEqual(expected);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await expect.poll(()=>f.canvas.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(
    Math.round(c.width/2-120*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data))).toEqual([191,191,126,255]);
  await f.canvas.focus();await page.keyboard.press('Control+Enter');
  const preview=page.getByLabel('Test movie interaction',{exact:true});
  await expect.poll(()=>preview.evaluate((c:HTMLCanvasElement)=>Array.from(c.getContext('2d')!.getImageData(110,90,1,1).data)),{intervals:[30,50]})
    .toEqual([255,127,127,255]);
  await page.keyboard.press('Escape');
  const output=await page.context().newPage();
  try{
    await output.setContent(exportHTML(expected,'sequence',true));
    const canvas=output.locator('canvas').first();await expect(canvas).toHaveAttribute('data-capture','waiting');
    for(const frame of [0,1,2]){
      await canvas.dispatchEvent('capture-next');
      const pixels=await canvas.evaluate((c:HTMLCanvasElement)=>[80,110,145,180].map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data)));
      const green=movie && frame===1;
      const oracle=frame===2?[[255,0,0,128],[255,0,0,128],[255,0,0,64],[0,0,0,0]]:
        [[127,128,0,128],green?[64,192,0,128]:[64,128,64,128],green?[0,255,0,64]:[0,128,127,64],[0,0,0,0]];
      pixels.forEach((p,i)=>{expect(p[3]).toBe(oracle[i][3]);for(let k=0;k<3;k++)expect(Math.abs(p[k]-oracle[i][k])).toBeLessThanOrEqual(2);});
    }
  }finally{await output.close();}
  if(movie){
    await page.addScriptTag({content:(await pngFixture()).code});
    const pixel=await page.evaluate(async project=>{
      const api=(window as unknown as {BlurPNG:typeof import('../../apps/editor/src/export-png')}).BlurPNG;
      const image=await createImageBitmap(await api.exportPNGFrame(project,1,undefined,true));
      try{
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
        return Array.from(ctx.getImageData(145,90,1,1).data);
      }finally{image.close();}
    },expected);
    expect(pixel).toEqual([0,255,0,64]);
  }
});

for(const group of [false,true])test('drawing tint can be edited, undone and exported (group='+group+')',async({page})=>{
  const f=await setup(page,'object',false,!group,group?'tint-group':false);
  await f.select();
  const label=group?'Group':'Drawing',color=page.getByLabel(label+' tint color'),amount=page.getByLabel(label+' tint amount',{exact:true});
  await color.fill('#00ff00');await amount.fill('50');await amount.press('Tab');
  const expected=structuredClone(f.p),tint={color:'#00ff00',amount:.5};
  for(const s of expected.layers[0].keys[0].shapes){
    if(group && s.groups?.includes('pair'))s.groupBlur={group:'pair',radius:0,tint};
    else if(!group && s.id==='art')s.tint=tint;
  }
  await expect.poll(f.read).toEqual(expected);
  await page.getByRole('button',{name:'Reset tint',exact:true}).click();await expect.poll(f.read).toEqual(f.p);
  await f.canvas.press('Control+z');await expect.poll(f.read).toEqual(expected);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const points=group?[80,105,125,150]:[42,80,120];
  const opaque=group?[[128,128,0,255],[128,128,0,255],[0,255,0,255],[191,191,127,255]]:
    [[64,191,127,255],[64,191,127,255],[191,191,127,255]];
  const close=(pixels:number[][],wanted:number[][])=>pixels.every((pixel,i)=>pixel.every((v,k)=>Math.abs(v-wanted[i][k])<=(k===3?0:2)));
  const stage=()=>f.canvas.evaluate((c:HTMLCanvasElement,xs)=>xs.map(x=>Array.from(c.getContext('2d')!.getImageData(
    Math.round(c.width/2+(x-200)*devicePixelRatio),Math.round(c.height/2-40*devicePixelRatio),1,1).data)),points);
  await expect.poll(async()=>close(await stage(),opaque)).toBe(true);
  const transparent=opaque.map((p,i)=>i===points.length-1?[128,128,0,128]:p);
  const output=await page.context().newPage();
  try{
    await output.setContent(exportHTML(expected,0,true));const c=output.locator('canvas').first();
    await expect(c).toHaveAttribute('data-capture','ready');
    const pixels=await c.evaluate((c:HTMLCanvasElement,xs)=>xs.map(x=>Array.from(c.getContext('2d')!.getImageData(x,90,1,1).data)),points);
    expect(close(pixels,transparent),JSON.stringify(pixels)).toBe(true);
    if(group){
      await output.goto('about:blank');
      await output.setContent(exportHTML(expected,2,true));
      await expect(c).toHaveAttribute('data-capture','ready');
      const later=await c.evaluate((canvas:HTMLCanvasElement,xs)=>xs.map(x=>Array.from(canvas.getContext('2d')!.getImageData(x,90,1,1).data)),points);
      expect(close(later,[[255,255,255,255],[127,255,255,255],[0,255,0,255],[0,0,255,128]]),JSON.stringify(later)).toBe(true);
    }
  }finally{await output.close();}
  await page.addScriptTag({content:(await pngFixture()).code});
  const png=await page.evaluate(async({project,xs})=>{
    const api=(window as unknown as {BlurPNG:typeof import('../../apps/editor/src/export-png')}).BlurPNG;
    const image=await createImageBitmap(await api.exportPNGFrame(project,0,undefined,true));
    try{
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);
      return xs.map(x=>Array.from(ctx.getImageData(x,90,1,1).data));
    }finally{image.close();}
  },{project:expected,xs:points});
  expect(close(png,transparent),JSON.stringify(png)).toBe(true);
});
