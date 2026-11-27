import {rememberedAuthoringPivot} from '../../packages/animation/src/motion-junction';
import {captureRememberedGroupPivotAuthoringFrame} from '../../packages/animation/src/group-pivot-motion-owner';
import {captureRememberedPivotAuthoringFrame} from '../../packages/animation/src/pivot-motion-owner';
import {captureRememberedNodeAuthoringFrame} from '../../packages/animation/src/node-motion-owner';
import {worldPoint} from '../../packages/geometry/src';
import {captureRememberedGroupAuthoringFrame} from '../../packages/animation/src/group-motion-owner';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';
import { test, expect, type Page } from '@playwright/test';
import { newProject, newLayer, type Project, type Vector, type Point } from '../../packages/document/src';
test('move range anchors keeps attached fill and stroke junctions together across held exposures', async ({page}) => {
  const p = newProject(), merge = p.layers[0], objects = newLayer('Objects');
  p.duration = 32;
  merge.drawingMode = 'merge'; objects.drawingMode = 'object'; p.layers.push(objects);
  const edge: Vector = {id:'path',kind:'bezier',x:400,y:240,width:80,height:10,rotation:0,
    points:[],nodes:[{x:0,y:0,out:{x:12,y:8}},{x:40,y:10,in:{x:25,y:14}},{x:80,y:0}],
    drawingMode:'merge',fill:'#000000',fillEnabled:false,stroke:'#000000',strokeWidth:2};
  const boundary=[...structuredClone(edge.nodes!),{x:80,y:80},{x:0,y:80}];
  const fill:Vector={...edge,id:'fill',kind:'polygon',closed:true,fillRule:'evenodd',fill:'#ff0000',fillEnabled:true,
    strokeWidth:0,height:80,contours:[boundary]};
  delete fill.nodes;
  const branch:Vector={...edge,id:'branch',height:60,width:0,nodes:[{x:0,y:0},{x:0,y:60}]};
  const object:Vector={...edge,drawingMode:'object',x:510,transform:[0.5,0,0,1]};
  merge.keys=Array.from({length:16},(_,i)=>({frame:i*2,shapes:structuredClone([fill,branch,edge])}));
  objects.keys=Array.from({length:32},(_,frame)=>({frame,shapes:structuredClone([object])}));
  objects.keys[23].shapes[0].nodes!.pop();
  await page.addInitScript(project=>{if(!localStorage.getItem('splash-recovery-v1'))localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));},p);
  await page.goto('/');
  const recover=()=>page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await recover();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const grid=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(grid.x+18+9,grid.y+40);
  await page.keyboard.down('Shift'); await page.mouse.click(grid.x+23*18+9,grid.y+40); await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits',{exact:true}).click();
  await page.getByRole('button',{name:'Select all timeline layers'}).click();
  await page.getByLabel('Move multiple frames',{exact:true}).check();
  await page.getByLabel('Pick multi-frame objects',{exact:true}).check();
  await page.getByLabel('Multi-frame selection gesture',{exact:true}).selectOption('box');
  const stage=page.getByLabel('Drawing stage',{exact:true}), box=(await stage.boundingBox())!;
  const pointer=(x:number,y:number,steps=1)=>page.mouse.move(box.x+box.width/2+x-p.width/2,box.y+box.height/2+y-p.height/2,{steps});
  await pointer(390,225); await page.mouse.down(); await pointer(565,255,20); await page.mouse.up();
  const picks=page.getByText('35 picked members',{exact:true});
  await expect(picks).toBeVisible();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const number=page.getByLabel('Multi-frame anchor number'), move=page.getByRole('button',{name:'Move multi-frame anchors',exact:true});
  await page.getByLabel('Multi-frame X offset',{exact:true}).fill('8'); await page.getByLabel('Multi-frame Y offset',{exact:true}).fill('-6');
  await number.fill('3'); await move.click();
  await expect(page.getByText(/Anchor 3 is missing on Objects, frame 24/)).toBeVisible();
  expect(await read()).toEqual(p);
  await number.fill('1');
  await page.evaluate(() => {
    const original = JSON.stringify;
    JSON.stringify = new Proxy(original,{apply(target,receiver,args) {
      const value = args[0];
      if (value?.project?.layers?.[0]?.keys[0]?.shapes[0]?.contours?.[0]?.[0]?.x === 8) {
        JSON.stringify = original;
        const field = document.querySelector<HTMLInputElement>('[aria-label="Multi-frame X offset"]')!;
        field.value = '12'; field.dispatchEvent(new Event('input',{bubbles:true}));
      }
      return Reflect.apply(target,receiver,args);
    }});
  });
  await move.click();
  await expect(page.getByText(/multi-frame artwork or anchor inputs changed/)).toBeVisible();
  expect(await read()).toEqual(p);
  await page.getByLabel('Multi-frame X offset',{exact:true}).fill('8');
  await move.click(); await expect(picks).toBeVisible();
  const expected=structuredClone(p);
  for(const key of expected.layers[0].keys.filter(k=>k.frame<24)) {
    for(const node of [key.shapes[0].contours![0][0],key.shapes[1].nodes![0],key.shapes[2].nodes![0]]) {
      node.x+=8; node.y-=6;
      if(node.out){node.out.x+=8;node.out.y-=6;}
    }
  }
  for(const key of expected.layers[1].keys.filter(k=>k.frame>=1&&k.frame<24)) {
    const n=key.shapes[0].nodes![0]; n.x+=16;n.y-=6;n.out!.x+=16;n.out!.y-=6;
  }
  expect(await read()).toEqual(expected);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(expected);
  await page.reload();await recover();expect(await read()).toEqual(expected);
});
for (const operation of ['skew','pivot'] as const)
test('broad multi-frame '+operation+' retains merged curves and object artwork through a sustained drag', async ({page}) => {
  const p = newProject();
  p.duration = 32;
  const merge = p.layers[0], objects = newLayer('Objects');
  merge.drawingMode = 'merge';
  objects.drawingMode = 'object';
  p.layers.push(objects);
  const fill: Vector = {id:'ink',kind:'polygon',closed:true,x:400,y:220,width:100,height:100,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]};
  const curve: Vector = {...fill,id:'edge',kind:'bezier',closed:false,fillEnabled:false,strokeWidth:2,
    x:410,y:230,width:60,height:30,points:[],nodes:[{x:0,y:0,out:{x:18,y:25}},{x:60,y:30,in:{x:40,y:10}}]};
  const object: Vector = {...fill,id:'box',kind:'rectangle',x:520,y:240,width:40,height:40,points:[]};
  for (const layer of p.layers) layer.keys = Array.from({length:32},(_,frame)=>({frame,
    shapes:structuredClone(layer===merge?[fill,curve]:[object])}));
  if (operation === 'pivot') for (const key of objects.keys) key.shapes.push({...object,id:'outside',x:650});
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const grid = await page.getByLabel('Timeline frames').boundingBox();
  await page.mouse.click(grid!.x+9,grid!.y+40);
  await page.keyboard.down('Shift');
  await page.mouse.click(grid!.x+23*18+9,grid!.y+40);
  await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits',{exact:true}).click();
  await page.getByRole('button',{name:'Select all timeline layers'}).click();
  await page.getByLabel('Move multiple frames',{exact:true}).check();
  const stage=page.getByLabel('Drawing stage',{exact:true});
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  if (operation === 'pivot') {
    await page.getByLabel('Pick multi-frame objects',{exact:true}).check();
    await page.getByLabel('Multi-frame selection gesture',{exact:true}).selectOption('box');
    const pointer = async (x:number,y:number,steps=1) => {
      const box=(await stage.boundingBox())!;
      await page.mouse.move(box.x+box.width/2+x-p.width/2,box.y+box.height/2+y-p.height/2,{steps});
    };
    await pointer(390,210); await page.mouse.down(); await pointer(570,330,8); await page.mouse.up();
    const picks=page.getByText('72 picked members',{exact:true});
    await expect(picks).toBeVisible();
    await page.getByLabel('Multi-frame transform handles',{exact:true}).check();
    const pivotX=page.getByLabel('Multi-frame pivot X',{exact:true}),pivotY=page.getByLabel('Multi-frame pivot Y',{exact:true});
    const start={x:Number(await pivotX.inputValue()),y:Number(await pivotY.inputValue())};
    const dragPivot=async()=>{
      await pointer(start.x,start.y); await page.mouse.down(); await pointer(start.x+30,start.y+20,20);
    };
    await dragPivot(); await page.keyboard.press('Escape'); await page.mouse.up();
    expect(Number(await pivotX.inputValue())).toBe(start.x);
    expect(await read()).toEqual(p);
    await dragPivot(); await page.mouse.up();
    const pivot={x:Number(await pivotX.inputValue()),y:Number(await pivotY.inputValue())};
    expect(pivot.x).toBeCloseTo(start.x+30,0); expect(pivot.y).toBeCloseTo(start.y+20,0);
    await page.getByRole('button',{name:'Remember pivot',exact:true}).click();
    const remembered={...p,multiFramePivot:pivot};
    expect(await read()).toEqual(remembered); await expect(picks).toBeVisible();
    await page.getByRole('button',{name:'Forget saved pivot',exact:true}).click();
    expect(await read()).toEqual(p); await expect(picks).toBeVisible();
    await pivotX.fill(String(pivot.x)); await pivotY.fill(String(pivot.y));
    await page.getByRole('button',{name:'Remember pivot',exact:true}).click();
    await page.getByLabel('Multi-frame rotation',{exact:true}).fill('180');
    await page.getByRole('button',{name:'Transform multi-frame artwork',exact:true}).click();
    const rotated=await read();
    expect(rotated.multiFramePivot).toEqual(pivot);
    for (const [i,layer] of p.layers.entries()) for (const key of layer.keys) {
      const result=rotated.layers[i].keys[key.frame];
      expect(result.frame).toBe(key.frame);
      for (const [j,original] of key.shapes.entries()) {
        const moved=result.shapes[j];
        if(key.frame>=24 || original.id==='outside') expect(moved).toEqual(original);
        else {
          expect(moved.x).toBeCloseTo(2*pivot.x-original.x,8);
          expect(moved.y).toBeCloseTo(2*pivot.y-original.y,8);
          expect({...moved,x:original.x,y:original.y,transform:undefined}).toEqual({...original,transform:undefined});
        }
      }
    }
    await stage.focus(); await page.keyboard.press('Control+z'); expect(await read()).toEqual(remembered);
    await page.keyboard.press('Control+Shift+z'); expect(await read()).toEqual(rotated);
    return;
  }
  await page.getByLabel('Multi-frame transform handles',{exact:true}).check();
  const previewEdge=()=>stage.evaluate((c:HTMLCanvasElement) => {
    const scale=c.width/c.getBoundingClientRect().width;
    // Probe the shifted right edge outside opaque current-frame artwork.
    const data=c.getContext('2d')!.getImageData(c.width/2+(577-480)*scale,c.height/2+(248-270)*scale,9*scale,5*scale).data;
    for(let i=0;i<data.length;i+=4) if(data[i+2]>data[i]+40 && data[i+1]>data[i]+40) return true;
    return false;
  });
  const drag=async()=>{
    const box=(await stage.boundingBox())!;
    const x=box.x+box.width/2+480-p.width/2,y=box.y+box.height/2+220-p.height/2;
    await page.mouse.move(x,y); await page.mouse.down();
    await page.mouse.move(x+30,y+12,{steps:20});
  };
  expect(await previewEdge()).toBe(false);
  await drag();
  await expect.poll(previewEdge).toBe(true);
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await read()).toEqual(p);
  await drag(); await page.mouse.up();
  const edited=await read();
  for (const [i,layer] of p.layers.entries()) {
    expect(edited.layers[i].keys.slice(24)).toEqual(layer.keys.slice(24));
    for (const key of layer.keys.slice(0,24)) {
      const after=edited.layers[i].keys[key.frame];
      expect(after.frame).toBe(key.frame);
      for (const [j,s] of key.shapes.entries()) {
        const moved=after.shapes[j];
        expect(moved.transform![2]).toBeCloseTo(-0.3,2);
        expect(moved.x).toBeCloseTo(s.x + (320-s.y)*0.3,1);
        expect({...moved,x:s.x,transform:undefined}).toEqual({...s,transform:undefined});
      }
    }
  }
  await stage.focus(); await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(edited);
  // The translated merge roots fit the document limit; the later object track exceeds it.
  await page.getByLabel('Multi-frame X offset',{exact:true}).fill('9999520');
  await page.getByRole('button',{name:'Move multi-frame artwork',exact:true}).click();
  expect(await read()).toEqual(edited);
  await stage.focus(); await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});
test('timeline Shift ranges duplicate and remove exposures with undo and key navigation', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  p.layers[0].keys = [
    { frame: 0, shapes: [] },
    { frame: 3, shapes: [] },
    { frame: 7, shapes: [] },
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
  const timeline = page.getByLabel('Timeline frames'),
    b = (await timeline.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.click(b.x + 18 + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 4 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await expect(page.getByText('Frames 2–5 · 4 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate frame range', exact: true }).click();
  const dup = await read();
  expect(dup.duration).toBe(16);
  expect(dup.layers[0].keys.map((k) => k.frame)).toEqual([0, 3, 5, 7, 9, 11]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(dup);
  await page.mouse.click(b.x + 18 + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 4 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Remove layer frames', exact: true }).click();
  expect((await read()).duration).toBe(16);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(dup);
  await page.mouse.click(b.x + 4 * 18 + 9, b.y + 40);
  await timeline.press('Control+ArrowLeft');
  await expect(page.locator('.frame-readout')).toContainText('Frame 4');
  await timeline.press('Control+ArrowRight');
  await expect(page.locator('.frame-readout')).toContainText('Frame 6');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('frame copy cut paste and dragging preserve recovery until commit and cancel with Escape', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 15;
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          id: 'a',
          kind: 'rectangle',
          x: 20,
          y: 20,
          width: 50,
          height: 50,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
    { frame: 2, shapes: [] },
    { frame: 10, shapes: [] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  const cell = (n: number) => ({ x: b.x + n * 18 + 9, y: b.y + 40 });
  const click = async (n: number) => {
    const c = cell(n);
    await page.mouse.click(c.x, c.y);
  };
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await click(0);
  await page.keyboard.down('Shift');
  await click(1);
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Copy frames', exact: true }).click();
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Cut frames', exact: true }).click();
  expect((await read()).layers[0].keys[0].shapes).toEqual([]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await click(4);
  await page.getByRole('button', { name: 'Insert copied frames', exact: true }).click();
  const pasted = await read();
  expect(pasted.duration).toBe(17);
  expect(pasted.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual(
    p.layers[0].keys[0].shapes,
  );
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await click(0);
  await page.keyboard.down('Shift');
  await click(1);
  await page.keyboard.up('Shift');
  await page.getByLabel('Drag selected frames', { exact: true }).check();
  const a = cell(0),
    d = cell(5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y);
  await expect(page.getByText('Move to frames 6–7', { exact: true })).toBeVisible();
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(p);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y);
  await page.mouse.up();
  const moved = await read();
  expect(moved.layers[0].keys[0].shapes).toEqual([]);
  expect(moved.layers[0].keys.find((k) => k.frame === 5)!.shapes).toEqual(
    p.layers[0].keys[0].shapes,
  );
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(moved);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('edge dragging scrolls without pointer motion and stops on Escape', async ({ page }) => {
  const p = newProject();
  p.duration = 300;
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.getByLabel('Drag selected frames', { exact: true }).check();
  await page.mouse.move(b.x + 9, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 4, b.y + 40);
  const scroll = page.getByLabel('Timeline scroll');
  await expect.poll(async () => await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const first = await scroll.evaluate(el => el.scrollLeft);
  await expect.poll(async () => await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(first);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const stopped = await scroll.evaluate(el => el.scrollLeft);
  await page.waitForTimeout(250);
  expect(await scroll.evaluate(el => el.scrollLeft)).toBe(stopped);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});
test('layer organization duplicates, reorders, scopes visibility and locking with undo', async ({
  page,
}) => {
  await page.goto('/');
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.getByText('Layer organization', { exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Duplicate layer', exact: true }).click();
  const duplicated = await read(),
    copy = duplicated.layers[1].id;
  expect(duplicated.layers).toHaveLength(2);
  expect(duplicated.layers[1].name).toContain('copy');
  await page.getByRole('button', { name: 'Move layer to bottom', exact: true }).click();
  expect((await read()).layers[0].id).toBe(copy);
  await page.getByRole('button', { name: 'Show only this layer', exact: true }).click();
  expect((await read()).layers.filter((l) => l.visible).map((l) => l.id)).toEqual([copy]);
  await page.getByRole('button', { name: 'Lock other layers', exact: true }).click();
  expect((await read()).layers.filter((l) => l.locked)).toHaveLength(1);
  await page.getByRole('button', { name: 'Show all layers', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock all layers', exact: true }).click();
  expect((await read()).layers.every((l) => l.visible && !l.locked)).toBe(true);
  await page.getByLabel('Drawing stage').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
  expect(await read()).toEqual(duplicated);
  await page.keyboard.press('Control+z');
  expect((await read()).layers).toHaveLength(1);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(duplicated);
});

test('layer folders nest, collapse rows, retain artwork and remove with undo', async ({ page }) => {
  await page.goto('/');
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.getByText('Layer folders', { exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByLabel('Folder name', { exact: true }).fill('Characters');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  const root = (await read()).folders![0].id;
  await page.getByLabel('Folder parent', { exact: true }).selectOption(root);
  await page.getByLabel('Folder name', { exact: true }).fill('Hero');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  const child = (await read()).folders![1].id;
  await page.getByLabel('Active layer folder', { exact: true }).selectOption(child);
  const assigned = await read();
  expect(assigned.layers[0].folderId).toBe(child);
  await expect(page.locator('.layer-name')).toContainText('Characters / Hero');
  await page.getByRole('button', { name: 'Collapse folder rows', exact: true }).click();
  await expect(page.locator('.layer-name')).toHaveCount(0);
  expect(await read()).toEqual(assigned);
  await page.getByRole('button', { name: 'Expand folder rows', exact: true }).click();
  await expect(page.locator('.layer-name')).toHaveCount(1);
  await page.getByRole('button', { name: 'Lock folder layers', exact: true }).click();
  expect((await read()).layers[0].locked).toBe(true);
  await page.getByRole('button', { name: 'Unlock folder layers', exact: true }).click();
  expect(await read()).toEqual(assigned);
  await page.getByLabel('Selected folder', { exact: true }).selectOption(root);
  await page.getByLabel('Folder name', { exact: true }).fill('Cast');
  await page.getByRole('button', { name: 'Update folder', exact: true }).click();
  await expect(page.locator('.layer-name')).toContainText('Cast / Hero');
  const renamed = await read();
  await page.getByRole('button', { name: 'Remove folder, keep layers', exact: true }).click();
  expect((await read()).folders).toEqual([{ id: child, name: 'Hero' }]);
  expect((await read()).layers).toEqual(assigned.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(renamed);
  await page.keyboard.press('Control+Shift+z');
  expect((await read()).folders).toHaveLength(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('folder tree drag reparenting preserves paint order and supports root drops and undo', async ({
  page,
}) => {
  const p = newProject();
  p.folders = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const originalOrder = p.layers.map((l) => l.id);
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
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page
    .getByRole('group', { name: 'Layer row Layer 1', exact: true })
    .dragTo(page.getByRole('group', { name: 'Folder row A', exact: true }));
  expect((await read()).layers[0].folderId).toBe('a');
  expect((await read()).layers.map((l) => l.id)).toEqual(originalOrder);
  await page.getByRole('button', { name: 'Toggle folder A', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Layer row Layer 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle folder A', exact: true }).click();
  await page
    .getByRole('group', { name: 'Folder row A', exact: true })
    .dragTo(page.getByRole('group', { name: 'Folder row B', exact: true }));
  const nested = await read();
  expect(nested.folders!.find((f) => f.id === 'a')!.parentId).toBe('b');
  expect(nested.layers.map((l) => l.id)).toEqual(originalOrder);
  await page
    .getByRole('group', { name: 'Folder row B', exact: true })
    .dragTo(page.getByRole('group', { name: 'Folder row A', exact: true }));
  expect(await read()).toEqual(nested);
  await expect(page.getByRole('alert')).toContainText('cycle');
  // A valid drag remains possible after a rejected cycle.
  await page
    .getByRole('group', { name: 'Folder row A', exact: true })
    .dragTo(page.getByRole('group', { name: 'Root layer organization', exact: true }));
  expect((await read()).folders!.find((f) => f.id === 'a')!.parentId).toBeUndefined();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(nested);
});

test('adding a layer reveals it beyond a paginated folder tree', async ({ page }) => {
  const p = newProject();
  p.folders = Array.from({ length: 8 }, (_, i) => ({ id: 'folder' + i, name: 'Folder ' + i }));
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
  await expect(page.getByRole('group', { name: 'Layer row Layer 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Layer row Layer 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Layer row Layer 1', exact: true })).toBeVisible();
});

test('multi-layer range batches share duration, undo together and reject locked members', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  p.layers.push(newLayer('Second'));
  for (const layer of p.layers)
    layer.keys = [
      { frame: 0, shapes: [] },
      { frame: 3, shapes: [] },
      { frame: 7, shapes: [] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.mouse.click(b.x + 27, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 81, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page
    .getByRole('button', { name: 'Duplicate frames on selected layers', exact: true })
    .click();
  const duplicated = await read();
  expect(duplicated.duration).toBe(16);
  for (const layer of duplicated.layers)
    expect(layer.keys.map((k) => k.frame)).toEqual([0, 3, 5, 7, 9, 11]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Clear frames on selected layers', exact: true }).click();
  const cleared = await read();
  expect(cleared.duration).toBe(12);
  for (const layer of cleared.layers) expect(layer.keys.map((k) => k.frame)).toEqual([0, 1, 5, 7]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Remove frames on selected layers', exact: true }).click();
  const removed = await read();
  expect(removed.duration).toBe(12);
  for (const layer of removed.layers) expect(layer.keys.map((k) => k.frame)).toEqual([0, 1, 3, 8]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Copy selected layer frames', exact: true }).click();
  await page.getByLabel('Batch destination frame', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Insert multi-layer clipboard', exact: true }).click();
  expect((await read()).duration).toBe(16);
  for (const layer of (await read()).layers)
    expect(layer.keys.map((k) => k.frame)).toEqual([0, 3, 5, 7, 9, 11]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Cut selected layer frames', exact: true }).click();
  expect(await read()).toEqual(cleared);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByLabel('Batch destination frame', { exact: true }).fill('13');
  await page.getByRole('button', { name: 'Move selected layer frames', exact: true }).click();
  expect((await read()).duration).toBe(16);
  for (const layer of (await read()).layers)
    expect(layer.keys.map((k) => k.frame)).toEqual([0, 1, 5, 7, 12, 14]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page
    .getByRole('group', { name: 'Layer row Second', exact: true })
    .getByRole('button', { name: /Toggle lock/ })
    .click();
  const locked = await read();
  await page
    .getByRole('button', { name: 'Duplicate frames on selected layers', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('unlocked timeline layers');
  expect(await read()).toEqual(locked);
});

test('multi-layer dragging previews every track, cancels, commits atomically and autoscrolls', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 300;
  p.layers.push(newLayer('Second'));
  const shape = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 20,
    y: 20,
    width: 40,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  for (const layer of p.layers)
    layer.keys = [
      { frame: 0, shapes: [{ ...shape, id: layer.id + 'art' }] },
      { frame: 2, shapes: [] },
    ];
  p.layers[0].keys.push(
    { frame: 8, shapes: [{ ...shape, id: 'occupied' }] },
    { frame: 10, shapes: [] },
  );
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
  const timeline = page.getByLabel('Timeline frames'),
    b = (await timeline.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const x = (f: number) => b.x + f * 18 + 9;
  await page.mouse.click(x(0), b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(x(1), b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page.getByLabel('Drag selected layer ranges together', { exact: true }).check();
  const drag = async (f: number) => {
    // Start on the other selected row, keeping the active-layer anchor intact.
    await page.mouse.move(x(0), b.y + 68);
    await page.mouse.down();
    await page.mouse.move(x(f), b.y + 68);
  };
  await drag(5);
  await expect(page.getByText('2 layers in drag', { exact: true })).toBeVisible();
  const colors = await timeline.evaluate((el) => {
    const c = el as HTMLCanvasElement,
      ctx = c.getContext('2d')!,
      scale = c.width / c.getBoundingClientRect().width;
    return [29, 57].map((y) =>
      Array.from(ctx.getImageData(Math.round(92 * scale), Math.round(y * scale), 1, 1).data),
    );
  });
  expect(colors).toEqual([
    [145, 99, 47, 255],
    [145, 99, 47, 255],
  ]);
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(p);
  await drag(5);
  await page.mouse.up();
  const moved = await read();
  for (const layer of moved.layers) {
    expect(layer.keys[0].shapes).toEqual([]);
    expect(layer.keys.find((k) => k.frame === 5)!.shapes[0].id).toBe(layer.id + 'art');
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  // Reselect original range after the committed drag updated the anchor.
  await page.getByLabel('Drag selected layer ranges together', { exact: true }).uncheck();
  await page.mouse.click(x(0), b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(x(1), b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page.getByLabel('Drag selected layer ranges together', { exact: true }).check();
  await drag(8);
  await expect(page.getByText('2 layers in drag', { exact: true })).toBeVisible();
  await page.mouse.up();
  const replaced=await read();
  expect(replaced.duration).toBe(p.duration);
  for(const layer of replaced.layers){
    expect(layer.keys.find(k=>k.frame===8)!.shapes[0].id).toBe(layer.id+'art');
    expect(layer.keys.map(k=>k.frame)).toEqual(layer.id===p.layers[0].id?[0,2,8,10]:[0,2,8]);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByLabel('Drag selected layer ranges together', { exact: true }).uncheck();
  await page.mouse.click(x(0), b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(x(1), b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page.getByLabel('Drag selected layer ranges together', { exact: true }).check();
  await drag(5);
  await page.mouse.move(b.x + b.width - 4, b.y + 68);
  const scroll = page.getByLabel('Timeline scroll');
  await expect.poll(async () => await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const stopped = await scroll.evaluate(el => el.scrollLeft);
  await page.waitForTimeout(200);
  expect(await scroll.evaluate(el => el.scrollLeft)).toBe(stopped);
  expect(await read()).toEqual(p);
});

test('cross-layer range copy and move protect destinations and undo both tracks', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  p.layers.push(newLayer('Target'));
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          id: 'source-art',
          kind: 'rectangle',
          x: 20,
          y: 20,
          width: 30,
          height: 30,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
    { frame: 2, shapes: [] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 68);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 27, b.y + 68);
  await page.keyboard.up('Shift');
  await page.getByText('Transfer frames between layers', { exact: true }).click();
  await page
    .getByLabel('Frame transfer destination layer', { exact: true })
    .selectOption(p.layers[1].id);
  await page.getByLabel('Frame transfer destination frame', { exact: true }).fill('5');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Copy range to layer', exact: true }).click();
  const copied = await read();
  expect(copied.layers[0]).toEqual(p.layers[0]);
  expect(copied.layers[1].keys.find((k) => k.frame === 4)!.shapes).toHaveLength(1);
  await page.getByRole('button', { name: 'Move range to layer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Destination contains artwork');
  expect(await read()).toEqual(copied);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Move range to layer', exact: true }).click();
  const moved = await read();
  expect(moved.layers[0].keys[0].shapes).toEqual([]);
  expect(moved.layers[1].keys.find((k) => k.frame === 4)!.shapes).toHaveLength(1);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('explicit multi-track mapping copies and moves together with undo and duplicate-target rejection', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  p.layers.push(newLayer('Second'), newLayer('Dest A'), newLayer('Dest B'));
  for (const layer of p.layers.slice(0, 2))
    layer.keys = [
      {
        frame: 0,
        shapes: [
          {
            id: layer.id + 'art',
            kind: 'rectangle',
            x: 20,
            y: 20,
            width: 30,
            height: 30,
            rotation: 0,
            fill: layer.id === p.layers[0].id ? '#ff0000' : '#0000ff',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          },
        ],
      },
      { frame: 2, shapes: [] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 27, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByLabel('Batch layer Layer 1', { exact: true }).check();
  await page.getByLabel('Batch layer Second', { exact: true }).check();
  await page.getByText('Map multiple frame tracks', { exact: true }).click();
  await page.getByLabel('Destination for Layer 1', { exact: true }).selectOption(p.layers[2].id);
  await page.getByLabel('Destination for Second', { exact: true }).selectOption(p.layers[2].id);
  await page.getByLabel('Mapped tracks destination frame', { exact: true }).fill('5');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Copy mapped frame tracks', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unique destination');
  expect(await read()).toEqual(p);
  await page.getByLabel('Destination for Second', { exact: true }).selectOption(p.layers[3].id);
  await page.getByRole('button', { name: 'Copy mapped frame tracks', exact: true }).click();
  const copied = await read();
  expect(copied.layers.slice(0, 2)).toEqual(p.layers.slice(0, 2));
  for (const layer of copied.layers.slice(2))
    expect(layer.keys.find((k) => k.frame === 4)!.shapes).toHaveLength(1);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Move mapped frame tracks', exact: true }).click();
  const moved = await read();
  for (const layer of moved.layers.slice(0, 2)) expect(layer.keys[0].shapes).toEqual([]);
  for (const layer of moved.layers.slice(2))
    expect(layer.keys.find((k) => k.frame === 4)!.shapes).toHaveLength(1);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByLabel('Destination for Layer 1', { exact: true }).selectOption(p.layers[1].id);
  await page.getByLabel('Destination for Second', { exact: true }).selectOption(p.layers[0].id);
  await page.getByRole('button', { name: 'Swap mapped frame tracks', exact: true }).click();
  const swapped = await read();
  expect(swapped.layers[0].keys[0].shapes[0].fill).toBe('#0000ff');
  expect(swapped.layers[1].keys[0].shapes[0].fill).toBe('#ff0000');
  expect(swapped.duration).toBe(p.duration);
  expect(swapped.layers.slice(2)).toEqual(p.layers.slice(2));
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('cross-layer pointer drops preview, cancel and undo while vertical keys preserve artwork', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 12;
  p.layers.push(newLayer('Target'));
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          id: 'art',
          kind: 'rectangle',
          x: 20,
          y: 20,
          width: 30,
          height: 30,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
    { frame: 2, shapes: [] },
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
  const timeline = page.getByLabel('Timeline frames'),
    b = (await timeline.boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 68);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 27, b.y + 68);
  await page.keyboard.up('Shift');
  await page.getByLabel('Drag active range between layers', { exact: true }).check();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async () => {
    await page.mouse.move(b.x + 9, b.y + 68);
    await page.mouse.down();
    await page.mouse.move(b.x + 81, b.y + 40);
  };
  await drag();
  await expect(page.getByText('Drop layer: Target', { exact: true })).toBeVisible();
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(p);
  await drag();
  await page.mouse.up();
  const moved = await read();
  expect(moved.layers[0].keys[0].shapes).toEqual([]);
  expect(moved.layers[1].keys.find((k) => k.frame === 4)!.shapes).toHaveLength(1);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await timeline.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('group', { name: 'Layer row Layer 1', exact: true })).toHaveClass(
    /current/,
  );
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('group', { name: 'Layer row Target', exact: true })).toHaveClass(
    /current/,
  );
  expect(await read()).toEqual(p);
});

test('cross-layer drag vertically scrolls rows and stops on cancellation', async ({ page }) => {
  const p = newProject();
  for (let i = 2; i <= 8; i++) p.layers.push(newLayer('Layer ' + i));
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.getByLabel('Drag active range between layers', { exact: true }).check();
  await page.mouse.move(b.x + 9, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 81, b.y + 187);
  await expect(page.getByRole('group', { name: 'Layer row Layer 1', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(page.getByRole('group', { name: 'Layer row Layer 1', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
  ).toEqual(p);
});

test('folder sibling and artwork ordering are separate and undoable', async ({ page }) => {
  const p = newProject();
  p.layers.push(newLayer('Outside'), newLayer('Nested'));
  p.folders = [
    { id: 'a', name: 'A' },
    { id: 'child', name: 'Child', parentId: 'a' },
    { id: 'b', name: 'B' },
  ];
  p.layers[0].folderId = 'a';
  p.layers[2].folderId = 'child';
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
  await page
    .getByRole('group', { name: 'Folder row A', exact: true })
    .locator('.folder-name')
    .click();
  await page.getByText('Layer folders', { exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByRole('button', { name: 'Move folder later', exact: true }).click();
  expect((await read()).folders!.map((f) => f.id)).toEqual(['b', 'child', 'a']);
  expect((await read()).layers).toEqual(p.layers);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Bring folder artwork to front', exact: true }).click();
  expect((await read()).layers.map((l) => l.name)).toEqual(['Outside', 'Layer 1', 'Nested']);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Send folder artwork to back', exact: true }).click();
  expect((await read()).layers.map((l) => l.name)).toEqual(['Layer 1', 'Nested', 'Outside']);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Lock folder layers', exact: true }).click();
  const locked = await read();
  await page.getByRole('button', { name: 'Bring folder artwork to front', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unlock all folder layers');
  expect(await read()).toEqual(locked);
});

test('main timeline onion tint changes ghosts without changing artwork', async ({ page }) => {
  const p = newProject();
  p.background = '#ffffff';
  p.duration = 3;
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          id: 'red',
          kind: 'rectangle',
          x: 50,
          y: 50,
          width: 150,
          height: 150,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
    { frame: 1, shapes: [] },
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
  const timeline = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(timeline.x + 27, timeline.y + 40);
  await page.getByText('Onion skin settings', { exact: true }).click();
  await page.getByLabel('Enable onion skin', { exact: true }).check();
  await page.getByLabel('Onion opacity', { exact: true }).fill('50');
  await page.getByLabel('Onion tint', { exact: true }).check();
  await page.getByLabel('Onion past color', { exact: true }).fill('#0000ff');
  const count = (red: number, green: number, blue: number) =>
    page.getByLabel('Drawing stage', { exact: true }).evaluate(
      (c, rgb) => {
        const canvas = c as HTMLCanvasElement,
          data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const matches = (actual: number, expected: number) => Math.abs(actual - expected) <= (expected === 127 ? 1 : 0);
        let n = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i + 3] === 255 && matches(data[i], rgb[0]) && matches(data[i + 1], rgb[1]) && matches(data[i + 2], rgb[2])) n++;
        return n;
      },
      [red, green, blue],
    );
  await expect.poll(() => count(127, 127, 255)).toBeGreaterThan(100);
  const filledCount = await count(127, 127, 255);
  await page.getByLabel('Onion outlines', { exact: true }).check();
  await expect.poll(() => count(127, 127, 255)).toBeLessThan(filledCount / 10);
  const blueEdges = () =>
    page.getByLabel('Drawing stage', { exact: true }).evaluate((c) => {
      const canvas = c as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 2] > data[i] + 10 && data[i] === data[i + 1]) count++;
      return count;
    });
  await expect.poll(blueEdges).toBeGreaterThan(10);
  await expect.poll(blueEdges).toBeLessThan(filledCount / 10);
  await page.getByLabel('Onion outlines', { exact: true }).uncheck();
  await expect.poll(() => count(127, 127, 255)).toBe(filledCount);
  await page.getByLabel('Onion tint', { exact: true }).uncheck();
  await expect.poll(() => count(255, 127, 127)).toBeGreaterThan(100);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project,
  );
  expect(saved).toEqual(p);
});

test('canvas multi-frame movement previews whole exposures, cancels and commits one undo step', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 8;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 100,
    y: 100,
    width: 80,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 3, shapes: [{ ...art, x: 300 }] },
    { frame: 6, shapes: [{ ...art, x: 500 }] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 27, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 3 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  await expect
    .poll(() =>
      stage.evaluate((c) => {
        const canvas = c as HTMLCanvasElement,
          d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i + 2] > d[i] + 20 && d[i] > d[i + 1] + 10) count++;
        return count;
      }),
    )
    .toBeGreaterThan(10);
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(p);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const moved = await read();
  const dx = moved.layers[0].keys[0].shapes[0].x - 100;
  expect(dx).toBeGreaterThan(0);
  expect(moved.layers[0].keys[1].shapes[0].x).toBeCloseTo(300 + dx);
  expect(moved.layers[0].keys.map((k) => k.shapes[0].y)).toEqual([100, 100, 100]);
  expect(moved.layers[0].keys[2]).toEqual(p.layers[0].keys[2]);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByLabel('Multi-frame X offset', { exact: true }).fill('12');
  await page.getByLabel('Multi-frame Y offset', { exact: true }).fill('-5');
  await page.getByRole('button', { name: 'Move multi-frame artwork', exact: true }).click();
  expect((await read()).layers[0].keys.map((k) => k.shapes[0].x)).toEqual([112, 312, 500]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('multi-frame picking keeps exposure groups distinct and transforms only picked artwork', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 6;
  const art = {
    id: 'same',
    kind: 'rectangle' as const,
    x: 440,
    y: 240,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art, { ...art, id: 'sibling', x: 540 }] },
    { frame: 3, shapes: [{ ...art, x: 200, groups: undefined }] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 3 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Pick multi-frame objects', { exact: true }).check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!,
    zoom = Number(await page.locator('select[aria-label="Zoom"]').inputValue());
  const clickWorld = async (x: number, y: number) =>
    page.mouse.click(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
  await clickWorld(470, 270);
  await expect(page.getByText('2 picked members', { exact: true })).toBeVisible();
  await page.getByLabel('Multi-frame rotation', { exact: true }).fill('90');
  await page.getByRole('button', { name: 'Transform multi-frame artwork', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const result = await read();
  expect(result.layers[0].keys[0].shapes[0].x).toBeCloseTo(-240);
  expect(result.layers[0].keys[0].shapes[0].y).toBeCloseTo(440);
  expect(result.layers[0].keys[0].shapes[1].y).toBeCloseTo(540);
  expect(result.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await clickWorld(470, 270);
  await page.keyboard.down('Shift');
  await clickWorld(230, 270);
  await page.keyboard.up('Shift');
  await expect(page.getByText('3 picked members', { exact: true })).toBeVisible();
  await page.getByLabel('Multi-frame rotation', { exact: true }).fill('0');
  await page.getByLabel('Multi-frame scale', { exact: true }).fill('200');
  await page.getByLabel('Multi-frame pivot X', { exact: true }).fill('440');
  await page.getByLabel('Multi-frame pivot Y', { exact: true }).fill('240');
  await page.getByRole('button', { name: 'Transform multi-frame artwork', exact: true }).click();
  expect((await read()).layers[0].keys.map((k) => k.shapes[0].x)).toEqual([440, -40]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  const world = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - p.width / 2) * zoom,
    y: box.y + box.height / 2 + (y - p.height / 2) * zoom,
  });
  const region = async (points: number[][], cancel = false) => {
    const first = world(points[0][0], points[0][1]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) {
      const q = world(x, y);
      await page.mouse.move(q.x, q.y, { steps: 3 });
    }
    expect(await read()).toEqual(p);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await page.getByLabel('Multi-frame selection gesture', { exact: true }).selectOption('box');
  await region([
    [430, 230],
    [510, 310],
  ]);
  await expect(page.getByText('2 picked members', { exact: true })).toBeVisible();
  expect(await read()).toEqual(p);
  await region(
    [
      [190, 230],
      [270, 310],
    ],
    true,
  );
  await expect(page.getByText('2 picked members', { exact: true })).toBeVisible();
  await page.keyboard.down('Alt');
  await region([
    [430, 230],
    [510, 310],
  ]);
  await page.keyboard.up('Alt');
  await expect(page.getByText('0 picked members', { exact: true })).toBeVisible();
  await page.getByLabel('Multi-frame selection gesture', { exact: true }).selectOption('lasso');
  await region([
    [190, 230],
    [270, 230],
    [270, 310],
    [190, 310],
    [190, 230],
  ]);
  await expect(page.getByText('1 picked members', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete multi-frame artwork', exact: true }).click();
  const deleted = await read();
  expect(deleted.layers[0].keys[0]).toEqual(p.layers[0].keys[0]);
  expect(deleted.layers[0].keys[1]).toEqual({ frame: 3, shapes: [] });
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByLabel('Multi-frame selection gesture', { exact: true }).selectOption('point');
  await page.getByRole('button', { name: 'Select all multi-frame objects', exact: true }).click();
  await page.getByLabel('Multi-frame transform handles', { exact: true }).check();
  await region(
    [
      [600, 300],
      [700, 360],
    ],
    true,
  );
  expect(await read()).toEqual(p);
  await region([
    [600, 300],
    [700, 360],
  ]);
  const scaled = await read();
  expect(scaled.layers[0].keys[0].shapes[0].x).toBeCloseTo(500, 0);
  expect(scaled.layers[0].keys[0].shapes[0].transform![0]).toBeCloseTo(1.25, 1);
  expect(scaled.layers[0].keys[0].shapes[0].transform![3]).toBeCloseTo(2, 1);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.getByRole('button', { name: 'Select all multi-frame objects', exact: true }).click();
  await page.getByRole('button', { name: 'Center multi-frame pivot', exact: true }).click();
  const radius = 30 + 24 / zoom;
  await page.keyboard.down('Shift');
  await region([
    [400, 240 - 24 / zoom],
    [400 + radius, 270],
  ]);
  await page.keyboard.up('Shift');
  const rotated = await read();
  expect(rotated.layers[0].keys[0].shapes[0].x).toBeCloseTo(430, 0);
  expect(rotated.layers[0].keys[0].shapes[0].y).toBeCloseTo(310, 0);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('multi-frame edge skew previews cancels and commits selected holds with pivot modifiers', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 6;
  const art = {
    id: 'same',
    kind: 'rectangle' as const,
    x: 440,
    y: 240,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art, { ...art, id: 'sibling', x: 540 }] },
    { frame: 3, shapes: [{ ...art, x: 200, groups: undefined }] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 3 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Pick multi-frame objects', { exact: true }).check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!,
    zoom = Number(await page.locator('select[aria-label="Zoom"]').inputValue());
  const clickWorld = async (x: number, y: number) =>
    page.mouse.click(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
  await clickWorld(470, 270); // Select the complete group in the first exposure only.
  await page.getByLabel('Multi-frame transform handles', { exact: true }).check();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (x + dx - p.width / 2) * zoom,
      box.y + box.height / 2 + (y + dy - p.height / 2) * zoom,
    );
  };
  await drag(520, 240, 30, 12);
  expect(await read()).toEqual(p); // Live outline does not mutate saved artwork.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await read()).toEqual(p);
  await drag(520, 240, 30, 12);
  await page.mouse.up();
  const skewed = await read();
  for (let i = 0; i < 2; i++) {
    const a = skewed.layers[0].keys[0].shapes[i];
    expect(a.x).toBeCloseTo(p.layers[0].keys[0].shapes[i].x + 30, 0);
    expect(a.y).toBe(240);
    expect(a.transform![2]).toBeCloseTo(-0.5, 1);
    expect(a.groups).toEqual(['group']);
    expect(a.fill).toBe('#ff0000');
  }
  expect(skewed.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(skewed);
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Select all multi-frame objects', exact: true }).click();
  await page.getByRole('button', { name: 'Center multi-frame pivot', exact: true }).click();
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await drag(600, 270, 10, 60);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  const centered = await read();
  const shear = Math.tan(Math.PI / 12);
  for (const key of centered.layers[0].keys)
    for (const a of key.shapes) {
      expect(a.transform![1]).toBeCloseTo(shear, 5);
      expect(a.y).toBeCloseTo(240 + shear * (a.x - 400), 4);
    }
  expect(centered.layers[0].keys.map((k) => k.frame)).toEqual([0, 3]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('configured angles control main multi-frame rotation and skew with a matching cue', async ({ page }) => {
  const project = newProject();
  project.duration = 6;
  const artwork: Vector = { id: 'angle-art', kind: 'rectangle', x: 540, y: 240, width: 60, height: 60,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys = [
    { frame: 0, shapes: [artwork] },
    { frame: 3, shapes: [{ ...artwork, x: 200 }] },
    { frame: 5, shapes: [{ ...artwork, x: 720 }] },
  ];
  await page.addInitScript(p => {
    localStorage.setItem('splash-recovery-v1', JSON.stringify({ project: p, folder: null, manifest: null }));
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (this.fillStyle === '#ed428b' && text.endsWith('°')) this.canvas.dataset.rangeAngle = text;
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const view = page.getByRole('button', { name: 'View', exact: true });
  await view.click();
  await page.getByLabel('Angle increment', { exact: true }).selectOption('30');
  await view.click();
  const timeline = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(timeline.x + 9, timeline.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(timeline.x + 3 * 18 + 9, timeline.y + 40);
  await page.keyboard.up('Shift');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Pick multi-frame objects', { exact: true }).check();
  await page.getByLabel('Multi-frame transform handles', { exact: true }).check();
  const select = async () => {
    await page.getByRole('button', { name: 'Select all multi-frame objects', exact: true }).click();
    await page.getByRole('button', { name: 'Center multi-frame pivot', exact: true }).click();
  };
  await select();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!;
  const x = box.x + (box.width - project.width) / 2, y = box.y + (box.height - project.height) / 2;
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async (start: Point, end: Point, alt = false) => {
    await page.mouse.move(x + start.x, y + start.y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(x + end.x, y + end.y);
  };
  const release = async (alt = false) => {
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await page.keyboard.up('Shift');
  };
  const before = await read(), pivot = { x: 400, y: 270 };
  const angle = 38 * Math.PI / 180, rotateFrom = { x: 400, y: 216 };
  const rotateTo = { x: pivot.x + 54 * Math.sin(angle), y: pivot.y - 54 * Math.cos(angle) };
  await drag(rotateFrom, rotateTo);
  await expect(stage).toHaveAttribute('data-range-angle', '30°');
  expect(await read()).toEqual(before);
  await stage.press('Escape');
  await release();
  expect(await read()).toEqual(before);

  await drag(rotateFrom, { x: 406, y: 216 });
  await expect(stage).toHaveAttribute('data-range-angle', '0°');
  await release();
  expect(await read()).toEqual(before);

  await drag(rotateFrom, rotateTo);
  await release();
  await expect.poll(read).not.toEqual(before);
  const rotated = await read();
  const keys = (p: Project) => p.layers[0].keys;
  expect(keys(rotated)[2]).toEqual(keys(before)[2]);
  for (const [i, key] of keys(rotated).slice(0, 2).entries()) {
    const shape = key.shapes[0], dx = keys(before)[i].shapes[0].x - pivot.x;
    expect(shape.x).toBeCloseTo(pivot.x + Math.sqrt(3) / 2 * dx + 15, 9);
    expect(shape.y).toBeCloseTo(pivot.y + dx / 2 - 30 * Math.sqrt(3) / 2, 9);
  }
  await stage.press('Control+z');
  await expect.poll(read).toEqual(before);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(rotated);
  await stage.press('Control+z');
  await select();

  await drag({ x: 400, y: 240 }, { x: 435, y: 240 }, true);
  await expect(stage).toHaveAttribute('data-range-angle', '-60°');
  expect(await read()).toEqual(before);
  await release(true);
  await expect.poll(read).not.toEqual(before);
  const skewed = await read();
  expect(keys(skewed)[2]).toEqual(keys(before)[2]);
  for (const [i, key] of keys(skewed).slice(0, 2).entries()) {
    expect(key.shapes[0].transform?.[2]).toBeCloseTo(-Math.sqrt(3), 9);
    expect(key.shapes[0].x).toBeCloseTo(keys(before)[i].shapes[0].x + 30 * Math.sqrt(3), 9);
    expect(key.shapes[0].y).toBe(240);
  }
  await stage.press('Control+z');
  await expect.poll(read).toEqual(before);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(skewed);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('multi-frame shared pivot drags without artwork edits and constrains its axis', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 6;
  const art = {
    id: 'same',
    kind: 'rectangle' as const,
    x: 440,
    y: 240,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art, { ...art, id: 'sibling', x: 540 }] },
    { frame: 3, shapes: [{ ...art, x: 200, groups: undefined }] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 3 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Pick multi-frame objects', { exact: true }).check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!,
    zoom = Number(await page.locator('select[aria-label="Zoom"]').inputValue());
  const clickWorld = async (x: number, y: number) =>
    page.mouse.click(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
  await clickWorld(470, 270); // Select the complete group in the first exposure only.
  await page.getByLabel('Multi-frame transform handles', { exact: true }).check();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (x + dx - p.width / 2) * zoom,
      box.y + box.height / 2 + (y + dy - p.height / 2) * zoom,
    );
  };
  const x = page.getByLabel('Multi-frame pivot X', { exact: true });
  const y = page.getByLabel('Multi-frame pivot Y', { exact: true });
  await drag(520, 270, 40, 20);
  expect(await read()).toEqual(p);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(x).toHaveValue('520');
  await expect(y).toHaveValue('270');
  await page.keyboard.down('Shift');
  await drag(520, 270, 40, 20);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(Number(await x.inputValue())).toBeCloseTo(560, 0);
  await expect(y).toHaveValue('270');
  expect(await read()).toEqual(p);
  await page.getByLabel('Multi-frame rotation', { exact: true }).fill('180');
  await page.getByRole('button', { name: 'Transform multi-frame artwork', exact: true }).click();
  const result = await read();
  expect(result.layers[0].keys[0].shapes[0].x).toBeCloseTo(680, 0);
  expect(result.layers[0].keys[0].shapes[0].y).toBeCloseTo(300, 0);
  expect(result.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('main timeline reverses active and checked layers with atomic undo', async ({ page }) => {
  const p = newProject();
  p.duration = 8;
  const art = {
    id: 'a',
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
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 2, shapes: [{ ...art, id: 'b', fill: '#0000ff' }] },
    { frame: 5, shapes: [] },
  ];
  const other = newLayer('Other');
  other.keys = [
    { frame: 0, shapes: [{ ...art, id: 'c' }] },
    { frame: 3, shapes: [] },
  ];
  p.layers.push(other);
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
  const select = async () => {
    const b = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.click(b.x + 18 + 9, b.y + 64);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.x + 6 * 18 + 9, b.y + 64);
    await page.keyboard.up('Shift');
  };
  await select();
  await page.getByRole('button', { name: 'Reverse frame range', exact: true }).click();
  const single = await read();
  expect(single.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 3, 6, 7]);
  expect(single.layers[1]).toEqual(before.layers[1]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await select();
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page
    .getByRole('button', { name: 'Reverse frames on selected layers', exact: true })
    .click();
  const both = await read();
  expect(both.duration).toBe(8);
  expect(both.layers[0].keys).toEqual(single.layers[0].keys);
  expect(both.layers[1].keys.map((k) => k.frame)).toEqual([0, 1, 5, 7]);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(both);
});

test('multi-frame Alt-click cycles overlapping exposure groups without moving artwork', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 6;
  const art = {
    id: 'same',
    kind: 'rectangle' as const,
    x: 440,
    y: 240,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art, { ...art, id: 'sibling', x: 540 }] },
    { frame: 3, shapes: [{ ...art, x: 440, groups: undefined }] },
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 3 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Pick multi-frame objects', { exact: true }).check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!,
    zoom = Number(await page.locator('select[aria-label="Zoom"]').inputValue());
  const clickWorld = async (x: number, y: number) =>
    page.mouse.click(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await clickWorld(470, 270);
  await expect(page.getByText('1 picked members', { exact: true })).toBeVisible();
  await page.keyboard.down('Alt');
  await clickWorld(470, 270);
  await expect(page.getByText('2 picked members', { exact: true })).toBeVisible();
  await clickWorld(470, 270);
  await expect(page.getByText('1 picked members', { exact: true })).toBeVisible();
  await clickWorld(470, 270);
  await page.keyboard.up('Alt');
  expect(await read()).toEqual(p);
  await page.getByLabel('Multi-frame X offset', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Move multi-frame artwork', exact: true }).click();
  const result = await read();
  expect(result.layers[0].keys[0].shapes.map((s) => s.x)).toEqual([450, 550]);
  expect(result.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('multi-frame point picks follow layer stack when scope checkboxes are reversed', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 6;
  const art = {
    id: 'same',
    kind: 'rectangle' as const,
    x: 440,
    y: 240,
    width: 60,
    height: 60,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['group'],
  };
  p.layers[0].keys = [{ frame: 0, shapes: [{ ...art, groups: undefined }] }];
  p.layers[0].name = 'Bottom';
  const top = newLayer('Top');
  top.keys = [{ frame: 0, shapes: [{ ...art, id: 'top', groups: undefined }] }];
  p.layers.push(top);
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 9, b.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 3 * 18 + 9, b.y + 40);
  await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByLabel('Batch layer Top', { exact: true }).check();
  await page.getByLabel('Batch layer Bottom', { exact: true }).check();
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Pick multi-frame objects', { exact: true }).check();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const box = (await stage.boundingBox())!,
    zoom = Number(await page.locator('select[aria-label="Zoom"]').inputValue());
  const clickWorld = async (x: number, y: number) =>
    page.mouse.click(
      box.x + box.width / 2 + (x - p.width / 2) * zoom,
      box.y + box.height / 2 + (y - p.height / 2) * zoom,
    );
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await clickWorld(470, 270);
  await page.getByLabel('Multi-frame X offset', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Move multi-frame artwork', exact: true }).click();
  let result = await read();
  expect(result.layers[0]).toEqual(p.layers[0]);
  expect(result.layers[1].keys[0].shapes[0].x).toBe(450);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await clickWorld(470, 270);
  await page.keyboard.down('Alt');
  await clickWorld(470, 270);
  await page.keyboard.up('Alt');
  await page.getByRole('button', { name: 'Move multi-frame artwork', exact: true }).click();
  result = await read();
  expect(result.layers[0].keys[0].shapes[0].x).toBe(450);
  expect(result.layers[1]).toEqual(p.layers[1]);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('range retiming stretches and compresses checked tracks with blank timing and atomic undo', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 10;
  const art = {
    id: 'paint',
    kind: 'rectangle' as const,
    x: 20,
    y: 20,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 3, shapes: [] },
    { frame: 5, shapes: [{ ...art, id: 'later' }] },
  ];
  const other = newLayer('Other');
  other.keys = [
    { frame: 0, shapes: [{ ...art, id: 'other' }] },
    { frame: 4, shapes: [] },
  ];
  p.layers.push(other);
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
  const select = async (start: number, end: number) => {
    const b = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.click(b.x + start * 18 + 9, b.y + 64);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.x + end * 18 + 9, b.y + 64);
    await page.keyboard.up('Shift');
  };
  const undo = async () => {
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
  };
  await select(1, 6);
  await page.getByLabel('Retimed range length', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Retime frame range', exact: true }).click();
  const stretched = await read();
  expect(stretched.duration).toBe(16);
  expect(stretched.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 5, 9, 13]);
  expect(stretched.layers[0].keys[1].shapes).toEqual(before.layers[0].keys[0].shapes);
  expect(stretched.layers[1]).toEqual(before.layers[1]);
  await expect(page.getByText('Frames 2–13 · 12 selected', { exact: true })).toBeVisible();
  await undo();
  expect(await read()).toEqual(before);
  await select(1, 6);
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page.getByRole('button', { name: 'Retime frames on selected layers', exact: true }).click();
  const batch = await read();
  expect(batch.duration).toBe(16);
  expect(batch.layers[0].keys).toEqual(stretched.layers[0].keys);
  expect(batch.layers[1].keys.map((k) => k.frame)).toEqual([0, 1, 7, 13]);
  await page.getByLabel('Retimed range length', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Retime frames on selected layers', exact: true }).click();
  const compressed = await read();
  expect(compressed.duration).toBe(16);
  expect(compressed.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 3, 5, 7, 10]);
  expect(compressed.layers[1].keys.map((k) => k.frame)).toEqual([0, 1, 4, 7, 10]);
  expect(compressed.layers.every((l) => l.keys.at(-1)!.shapes.length === 0)).toBe(true);
  await undo();
  expect(await read()).toEqual(batch);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(compressed);
  await select(1, 6);
  await page.getByLabel('Retimed range length', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Retime frames on selected layers', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('collapse keyframes');
  expect(await read()).toEqual(compressed);
});

test('remembered multi-frame pivot survives recovery and undo without changing artwork', async ({
  page,
}) => {
  await page.addInitScript((p) => {
    if (!localStorage.getItem('splash-recovery-v1'))
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, newProject());
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const timelineBox = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(timelineBox.x + 9, timelineBox.y + 40);
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  const x = page.getByLabel('Multi-frame pivot X', { exact: true });
  const y = page.getByLabel('Multi-frame pivot Y', { exact: true });
  await x.fill('-40.5');
  await y.fill('125');
  await page.getByRole('button', { name: 'Remember pivot', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const saved = await read();
  expect(saved.multiFramePivot).toEqual({ x: -40.5, y: 125 });
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect((await read()).multiFramePivot).toBeUndefined();
  await expect(x).toHaveValue('0');
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const reopenedBox = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(reopenedBox.x + 9, reopenedBox.y + 40);
  await page.getByLabel('Move multiple frames', { exact: true }).check();
  await page.getByLabel('Multi-frame transform handles', { exact: true }).check();
  await expect(x).toHaveValue('-40.5');
  await expect(y).toHaveValue('125');
  await page.getByRole('button', { name: 'Forget saved pivot', exact: true }).click();
  expect((await read()).multiFramePivot).toBeUndefined();
  expect((await read()).layers).toEqual(saved.layers);
});

test('key every frame materializes a selected range across layers with one undo', async ({
  page,
}) => {
  const p = newProject();
  p.duration = 10;
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 20,
    y: 20,
    width: 30,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 3, shapes: [] },
    { frame: 6, shapes: [{ ...art, id: 'later' }] },
  ];
  const other = newLayer('Other');
  other.keys = [{ frame: 0, shapes: [{ ...art, id: 'other' }] }];
  p.layers.push(other);
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
  const b = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(b.x + 18 + 9, b.y + 64);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x + 4 * 18 + 9, b.y + 64);
  await page.keyboard.up('Shift');
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page
    .getByRole('button', { name: 'Key every frame on selected layers', exact: true })
    .click();
  const after = await read();
  expect(after.duration).toBe(10);
  expect(after.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 6]);
  expect(after.layers[0].keys[4].shapes).toEqual([]);
  expect(after.layers[1].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4]);
  expect(after.layers[1].keys[4].shapes).toEqual(before.layers[1].keys[0].shapes);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(after);
});

for (const bound of [false, true]) for (const mode of ['object', 'merge'] as const) {
  test(`distribute artwork to layers preserves ${mode} exposure history and undo (opacity ${bound})`, async ({
    page,
  }) => {
    const p = newProject();
    p.duration = 9;
    p.folders = [{ id: 'folder', name: 'Scene' }];
    const source = p.layers[0];
    source.folderId = 'folder';
    source.drawingMode = mode;
    const a = {
      id: 'a',
      kind: 'rectangle' as const,
      x: 50,
      y: 40,
      width: 60,
      height: 45,
      rotation: 18,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      transform: [1, 0.2, 0.3, 1] as [number, number, number, number],
    };
    const b = {
      ...a,
      id: 'b',
      x: 80,
      fill: '#0000ff',
      ...(mode === 'object' ? { groups: ['outer', 'inner'] } : {}),
    };
    const c = {
      ...a,
      id: 'c',
      x: 150,
      fill: '#00ff00',
      ...(mode === 'object' ? { groups: ['outer'] } : {}),
    };
    source.keys = [
      { frame: 0, shapes: [a, b, c] },
      { frame: 3, shapes: [] },
      { frame: 5, shapes: [{ ...a, x: 100 }, b, c] },
    ];
    const neighbor = newLayer('Unchanged');
    if (bound) neighbor.keys[0].shapes = [{ ...a, id: 'b', x: 300 }];
    p.layers.push(neighbor);
    if (bound) p.opacityBindings = [
      {layerId:source.id,shapeId:'b',start:0,end:2,keys:[{frame:0,opacity:0.25,ease:{kind:'cubic',x1:0.2,y1:0.1,x2:0.8,y2:0.95}}]},
      {layerId:neighbor.id,shapeId:'b',start:0,end:8,keys:[{frame:1,opacity:0.8}]},
      {layerId:source.id,shapeId:'b',start:5,end:8,keys:[{frame:7,opacity:0.6}]},
      {layerId:source.id,shapeId:'a',start:0,end:2,keys:[{frame:1,opacity:0.5}]},
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
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const timeline = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.click(timeline.x + 9, timeline.y + 64);
    await page.getByText('Layer organization', { exact: true }).click();
    const stagePixels = await page.getByLabel('Drawing stage').screenshot();
    await page.getByRole('button', { name: 'Distribute artwork to layers', exact: true }).click();
    const result = await read();
    await expect(async () =>
      expect(await page.getByLabel('Drawing stage').screenshot()).toEqual(stagePixels),
    ).toPass();
    const distributed = result.layers.slice(0, -1);
    expect(distributed).toHaveLength(mode === 'object' ? 2 : 3);
    expect(result.layers.at(-1)).toEqual(neighbor);
    expect(result.opacityBindings).toEqual(p.opacityBindings?.map(binding =>
      binding.layerId === source.id && binding.shapeId === 'b'
        ? { ...binding, layerId: distributed[1].id } : binding));
    expect(result.duration).toBe(p.duration);
    expect(distributed[0].id).toBe(source.id);
    expect(new Set(distributed.map((l) => l.id)).size).toBe(distributed.length);
    for (let i = 0; i < source.keys.length; i++) {
      expect(distributed.flatMap((l) => l.keys[i].shapes)).toEqual(source.keys[i].shapes);
      expect(
        distributed.every(
          (l) =>
            l.keys[i].frame === source.keys[i].frame &&
            l.folderId === 'folder' &&
            l.drawingMode === mode,
        ),
      ).toBe(true);
    }
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(result);
  });
}
test('distribute artwork rejects changing stack order without recovery or history changes', async ({
  page,
}) => {
  const p = newProject();
  const a = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 50,
    y: 40,
    width: 60,
    height: 45,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const b = { ...a, id: 'b', fill: '#0000ff' };
  p.layers[0].keys = [
    { frame: 0, shapes: [a, b] },
    { frame: 3, shapes: [b, a] },
  ];
  p.opacityBindings = [{layerId:p.layers[0].id,shapeId:'b',start:0,end:4,keys:[{frame:0,opacity:0.5}]}];
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
  const read = () => page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
  const before = await read();
  const timeline = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(timeline.x + 9, timeline.y + 40);
  await page.getByText('Layer organization', { exact: true }).click();
  await page.getByRole('button', { name: 'Distribute artwork to layers', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Error: Artwork changes stacking order across keys. Separate layers cannot preserve it.',
  );
  expect(await read()).toBe(before);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toBe(before);
});

for (const mode of ['object', 'merge', 'merge-affine'] as const) {
  test(`motion in-betweens generate editable ${mode} frames with atomic undo`, async ({ page }) => {
    const p = newProject();
    p.duration = 8;
    p.layers[0].drawingMode = mode === 'object' ? 'object' : 'merge';
    const a: Vector = {
      id: 'motion',
      kind: 'rectangle' as const,
      x: 20,
      y: 40,
      width: 50,
      height: 40,
      rotation: 350,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      transform: [1, 0.2, 0.3, 1] as [number, number, number, number],
    };
    p.layers[0].keys = [
      { frame: 0, shapes: [a] },
      { frame: 4, shapes: [{ ...a, x: 100, y: 80, rotation: -350, opacity: 0.2 }] },
      { frame: 6, shapes: [] },
    ];
    if (mode !== 'merge') {
      p.layers[0].keys[1].shapes[0].strokeWidth = 20;
      a.transform = [1, 0, 0, 1];
      p.layers[0].keys[1].shapes[0].transform = [3, 0, 2, 5];
    }
    if (mode === 'merge-affine') {
      a.kind = 'bezier';
      a.closed = true;
      a.nodes = [
        { x: 0, y: 0, out: { x: 20, y: 0 } },
        { x: 50, y: 0 },
        { x: 25, y: 40 },
      ];
      Object.assign(p.layers[0].keys[1].shapes[0], {
        kind: 'bezier',
        closed: true,
        nodes: [
          { x: 0, y: 20, out: { x: 20, y: 20 } },
          { x: 50, y: 0 },
          { x: 25, y: 40 },
        ],
      });
      p.layers[0].keys[1].shapes[0].fill = '#0000ff';
      p.layers[0].keys[1].shapes[0].stroke = '#00ff00';
    }
    if (mode === 'object') {
      const other = newLayer('Motion companion');
      other.keys = JSON.parse(JSON.stringify(p.layers[0].keys));
      for (const key of other.keys) for (const shape of key.shapes) shape.id = 'companion';
      p.layers.push(other);
    }
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
    const t = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.click(t.x + 9, t.y + 40);
    await page.keyboard.down('Shift');
    await page.mouse.click(t.x + 4 * 18 + 9, t.y + 40);
    await page.keyboard.up('Shift');
    await page.getByLabel('Motion easing', { exact: true }).selectOption('in');
    if (mode === 'merge') {
      await page.getByLabel('Motion easing', { exact: true }).selectOption('custom');
      for (const [key, value] of [
        ['X1', '0'],
        ['X2', '0'],
        ['Y1', String(1 / 3)],
        ['Y2', String(2 / 3)],
      ])
        await page.getByLabel(`Motion easing ${key}`, { exact: true }).fill(value);
    }
    if (mode !== 'merge')
      await page.getByLabel('Motion interpolate scale and skew', { exact: true }).check();
    if (mode === 'merge-affine') {
      await page.getByLabel('Motion interpolate paint colors', { exact: true }).check();
      await page.getByLabel('Motion interpolate curve nodes', { exact: true }).check();
    }
    if (mode === 'object') {
      await page.getByLabel('Motion rotation', { exact: true }).selectOption('clockwise');
      await page.getByLabel('Motion rotation extra turns', { exact: true }).fill('1');
      await page.getByLabel('Motion path', { exact: true }).check();
      await page.getByLabel('Motion path even distance', { exact: true }).check();
      await page.getByLabel('Motion path Start Y', { exact: true }).fill('0');
      await page.getByLabel('Motion path End Y', { exact: true }).fill('0');
      await page.getByText('Multi-layer frame edits', { exact: true }).click();
      await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
    }
    const generate = page.getByRole('button', {
      name:
        mode === 'object' ? 'Generate motion on selected layers' : 'Generate motion in-betweens',
      exact: true,
    });
    if (mode === 'object') {
      await page.getByLabel('Motion rotation extra turns', { exact: true }).fill('0.5');
      await generate.click();
      await expect(page.getByRole('alert')).toContainText('extra turns');
      expect(await read()).toEqual(p);
      await page.getByLabel('Motion rotation extra turns', { exact: true }).fill('1');
      await page.getByLabel('Motion path Start X', { exact: true }).fill('');
      await generate.click();
      await expect(page.getByRole('alert')).toContainText('finite numbers');
      expect(await read()).toEqual(p);
      await page.getByLabel('Motion path Start X', { exact: true }).fill('0');
    }
    if (mode === 'merge') {
      await page.getByLabel('Motion easing X1', { exact: true }).fill('1.1');
      await generate.click();
      await expect(page.getByRole('alert')).toContainText('between 0 and 1');
      expect(await read()).toEqual(p);
      await page.getByLabel('Motion easing X1', { exact: true }).fill('0');
    }
    if (mode !== 'merge') {
      await generate.click();
      await expect(page.getByRole('alert')).toContainText('enabled motion properties');
      expect(await read()).toEqual(p);
      await page.getByLabel('Motion interpolate stroke width', { exact: true }).check();
    }
    await generate.click();
    const after = await read(),
      keys = after.layers[0].keys;
    expect(keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 6]);
    const progress = mode === 'merge' ? Math.cbrt(0.5) : 0.25;
    const middle = keys[2].shapes[0];
    expect(middle.strokeWidth).toBeCloseTo(mode === 'merge' ? 0 : 20 * progress);
    expect(middle.x).toBeCloseTo(
      mode === 'object' ? 40 : 20 + 80 * progress,
      mode === 'object' ? 2 : 10,
    );
    expect(middle.y).toBeCloseTo(
      mode === 'object' ? 50 : 40 + 40 * progress,
      mode === 'object' ? 2 : 10,
    );
    expect(middle.rotation).toBeCloseTo(350 + (mode === 'object' ? 380 : 20) * progress, 10);
    expect(middle.opacity).toBeCloseTo(1 - 0.8 * progress, 10);
    expect({
      ...middle,
      x: a.x,
      y: a.y,
      rotation: a.rotation,
      opacity: undefined,
      nodes: a.nodes,
      transform: a.transform,
      fill: a.fill,
      stroke: a.stroke,
      strokeWidth: a.strokeWidth,
    }).toEqual(a);
    if (mode === 'merge-affine')
      expect(middle.nodes).toEqual([
        { x: 0, y: 5, out: { x: 20, y: 5 } },
        { x: 50, y: 0 },
        { x: 25, y: 40 },
      ]);
    expect(middle.fill).toBe(mode === 'merge-affine' ? '#bf0040' : a.fill);
    expect(middle.stroke).toBe(mode === 'merge-affine' ? '#004000' : a.stroke);
    expect(middle.transform).toEqual(mode !== 'merge' ? [1.5, 0, 0.5, 2] : a.transform);
    expect(keys[0]).toEqual(p.layers[0].keys[0]);
    expect(keys[4]).toEqual(p.layers[0].keys[1]);
    expect(keys[5]).toEqual(p.layers[0].keys[2]);
    expect(after.duration).toBe(8);
    if (mode === 'object') {
      expect(after.layers[1].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 6]);
      expect(after.layers[1].keys[2].shapes[0]).toEqual({ ...keys[2].shapes[0], id: 'companion' });
    }
    await generate.click();
    await expect(page.getByRole('alert')).toContainText('overwrite intermediate keys');
    expect(await read()).toEqual(after);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(after);
  });
}

for (const batch of [false, true]) test(`rejected bound cut preserves clipboard and history (batch ${batch})`, async ({page}) => {
  const p = newProject();
  p.duration = 10;
  if (batch) p.layers.push(newLayer('Bound'));
  for (const layer of p.layers) {
    const art: Vector = {id:layer.id+'-old',kind:'rectangle',x:20,y:20,width:20,height:20,rotation:0,
      fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
    layer.keys = [{frame:0,shapes:[art]}, {frame:2,shapes:[{...art,id:layer.id+'-new'}]}];
  }
  const bound = p.layers[p.layers.length-1];
  p.opacityBindings = [{layerId:bound.id,shapeId:bound.id+'-new',start:2,end:4,keys:[{frame:3,opacity:0.5}]}];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const timeline = page.getByLabel('Timeline frames');
  const cell = (frame:number) => timeline.click({position:{x:9+18*frame,y:40}});
  const command = (name:string) => page.getByRole('button',{name,exact:true}).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cut = batch ? 'Cut selected layer frames' : 'Cut frames';
  await cell(0);
  if (batch) {
    await page.getByText('Multi-layer frame edits',{exact:true}).click();
    await command('Select all timeline layers');
  }
  await command(cut);
  const cleared = await read();
  expect(cleared.opacityBindings).toEqual(p.opacityBindings);
  for (const [i,l] of cleared.layers.entries()) {
    expect(l.keys.map(k=>k.frame)).toEqual([0,1,2]);
    expect(l.keys[0].shapes).toEqual([]);
    expect(l.keys[1].shapes).toEqual(p.layers[i].keys[0].shapes);
  }
  await cell(3);
  if (batch) {
    await command('Clear frames on selected layers');
    await expect(page.getByRole('alert')).toContainText('uniquely');
    expect(await read()).toEqual(cleared);
  }
  await command(cut);
  await expect(page.getByRole('alert')).toContainText('uniquely');
  expect(await read()).toEqual(cleared);
  if (batch) await page.getByLabel('Batch destination frame',{exact:true}).fill('9');
  else await cell(8);
  await command(batch ? 'Insert multi-layer clipboard' : 'Insert copied frames');
  const pasted = await read();
  for (const [i,l] of pasted.layers.entries())
    expect(l.keys.find(k=>k.frame===8)?.shapes).toEqual(p.layers[i].keys[0].shapes);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(cleared);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
});

test('blank keys and pasted exposures preserve root opacity lifetimes, clipboard and undo', async ({page}) => {
  const p = newProject(), layer = p.layers[0];
  p.duration = 10;
  const art: Vector = {id:'copied',kind:'rectangle',x:20,y:20,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys = [{frame:0,shapes:[art]}, {frame:2,shapes:[{...art,id:'bound'}]}];
  p.opacityBindings = [{layerId:layer.id,shapeId:'bound',start:3,end:5,keys:[{frame:4,opacity:0.5}]}];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const timeline = page.getByLabel('Timeline frames'), stage = page.getByLabel('Drawing stage');
  const cell = (frame:number) => timeline.click({position:{x:9+18*frame,y:40}});
  const command = (name:string) => page.getByRole('button',{name,exact:true}).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await cell(0);
  await command('Copy frames');
  await cell(2);
  await stage.focus();
  await page.keyboard.press('F7');
  await expect(page.getByRole('alert')).toContainText('uniquely');
  expect(await read()).toEqual(p);
  await cell(4);
  await command('Insert copied frames');
  expect(await read()).toEqual(p);
  await cell(7);
  await command('Insert copied frames');
  const pasted = await read();
  expect(pasted.layers[0].keys.find(k=>k.frame===7)?.shapes).toEqual([art]);
  expect(pasted.layers[0].keys.find(k=>k.frame===8)?.shapes).toEqual(layer.keys[1].shapes);
  expect(pasted.duration).toBe(11);
  expect(pasted.opacityBindings).toEqual(p.opacityBindings);
  await cell(8);
  await stage.focus();
  await page.keyboard.press('F7');
  expect((await read()).layers[0].keys.find(k=>k.frame===8)?.shapes).toEqual([]);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(pasted);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(pasted);
});

test('Insert frame and Remove keyframe protect bound holds and publish valid changes once', async ({page}) => {
  const project = newProject(), layer = project.layers[0];
  project.duration = 10;
  const art: Vector = {id:'bound',kind:'rectangle',x:10,y:20,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys = [{frame:0,shapes:[]},{frame:2,shapes:[art]},{frame:6,shapes:[{...art,x:40}]}];
  project.layers.push(newLayer('Unchanged'));
  project.opacityBindings = [{layerId:layer.id,shapeId:art.id,start:2,end:3,keys:[{frame:3,opacity:0.5}]}];
  await page.addInitScript(p=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project:p,folder:null,manifest:null})),project);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const stage = page.getByLabel('Drawing stage'), timeline = page.getByLabel('Timeline frames');
  const cell = (n:number) => timeline.click({position:{x:9+18*n,y:68}});
  const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await cell(1);
  await stage.focus();
  await page.keyboard.press('F5');
  await expect(page.getByRole('alert')).toContainText('uniquely');
  expect(await read()).toEqual(project);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await cell(2);
  await page.getByTitle('Remove keyframe',{exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('uniquely');
  expect(await read()).toEqual(project);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await cell(3);
  await stage.focus();
  await page.keyboard.press('F5');
  const inserted = structuredClone(project);
  inserted.duration++;
  inserted.layers[0].keys[2].frame++;
  expect(await read()).toEqual(inserted);
  await cell(7);
  await page.getByTitle('Remove keyframe',{exact:true}).click();
  const removed = structuredClone(inserted);
  removed.layers[0].keys.pop();
  expect(await read()).toEqual(removed);
  await stage.focus();
  for (const [shortcut,expected] of [['Control+z',inserted],['Control+z',project],
    ['Control+Shift+z',inserted],['Control+Shift+z',removed]] as const) {
    await page.keyboard.press(shortcut);
    expect(await read()).toEqual(expected);
  }
});

test('deleting a layer removes its opacity channels and shortening respects surviving holds', async ({ page }) => {
  const p = newProject(), keep = p.layers[0], remove = newLayer('Delete this layer');
  p.duration = 12;
  p.layers.push(remove);
  const shape: Vector = {id:'shared',kind:'rectangle',x:20,y:20,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  for (const l of p.layers) l.keys[0].shapes = [structuredClone(shape)];
  const kept = {layerId:keep.id,shapeId:'shared',start:1,end:7,keys:[{frame:2,opacity:0.72,
    ease:{kind:'cubic' as const,x1:0.2,y1:0.3,x2:0.7,y2:0.9}}]};
  p.opacityBindings = [{layerId:remove.id,shapeId:'shared',start:0,end:2,keys:[{frame:0,opacity:0.5}]},
    kept,{layerId:remove.id,shapeId:'shared',start:7,end:10,keys:[{frame:8,opacity:0.2}]}];
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByLabel('Timeline frames').click({position:{x:9+18*10,y:40}});
  await page.getByRole('button',{name:'Delete layer',exact:true}).click();
  const deleted = {...p,layers:[keep],opacityBindings:[kept]};
  expect(await read()).toEqual(deleted);
  const frames = page.getByRole('spinbutton',{name:'Frames',exact:true});
  await frames.fill('7');
  await frames.press('Tab');
  await expect(page.getByRole('alert')).toContainText('opacity channel extends beyond');
  await expect(frames).toHaveValue('12');
  expect(await read()).toEqual(deleted);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await frames.fill('8');
  await frames.press('Tab');
  const shortened = {...deleted,duration:8};
  expect(await read()).toEqual(shortened);
  await expect(page.getByText('Frame 8 / 8',{exact:true})).toBeVisible();
  await page.getByLabel('Drawing stage').focus();
  for (const [key,expected] of [['Control+z',deleted],['Control+z',p],
    ['Control+Shift+z',deleted],['Control+Shift+z',shortened]] as const) {
    await page.keyboard.press(key);
    expect(await read()).toEqual(expected);
  }
});

test('duplicate layer remaps opacity artwork and allows independent editing with history', async ({page}) => {
  const p = newProject(), source = p.layers[0];
  p.duration = 12;
  const art: Vector = {id:'target',kind:'rectangle',x:p.width/2,y:p.height/2,width:40,height:40,
    rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  source.keys = [{frame:0,shapes:[art]},{frame:6,shapes:[{...art,x:art.x+10}]}];
  const curve = {kind:'cubic' as const,x1:0.3,y1:0,x2:0.7,y2:1};
  p.opacityBindings = [{layerId:source.id,shapeId:art.id,start:0,end:4,keys:[{frame:1,opacity:0.35,ease:curve}]},
    {layerId:source.id,shapeId:art.id,start:6,end:9,keys:[{frame:7,opacity:0.5}]}];
  await page.addInitScript(project => localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByLabel('Timeline frames').click({position:{x:9,y:40}});
  await page.getByText('Layer organization',{exact:true}).click();
  await page.getByRole('button',{name:'Duplicate layer',exact:true}).click();
  const duplicated = await read(), copy = duplicated.layers[1], shapeId = copy.keys[0].shapes[0].id;
  expect(duplicated.layers[0]).toEqual(source);
  expect(copy.id).not.toBe(source.id);
  expect(shapeId).not.toBe(art.id);
  expect(copy.keys[1].shapes[0].id).toBe(shapeId);
  expect(duplicated.opacityBindings).toEqual([...p.opacityBindings,...p.opacityBindings.map(b=>({...b,layerId:copy.id,shapeId}))]);
  await page.getByRole('button',{name:'Selection',exact:true}).click();
  const stage = page.getByLabel('Drawing stage'), box = (await stage.boundingBox())!;
  await page.mouse.click(box.x+box.width/2+8,box.y+box.height/2+8);
  await page.getByRole('button',{name:'Edit opacity channel',exact:true}).click();
  const draft = page.getByRole('region',{name:'Edit opacity channel'});
  await draft.getByLabel('Opacity (%)',{exact:true}).fill('80');
  await draft.getByRole('button',{name:'Apply opacity channel',exact:true}).click();
  const revised = structuredClone(duplicated), binding = revised.opacityBindings![2];
  binding.keys = [{...binding.keys[0],opacity:0.8}];
  expect(await read()).toEqual(revised);
  await stage.focus();
  for (const [key, expected] of [['Control+z',duplicated],['Control+z',p],
    ['Control+Shift+z',duplicated],['Control+Shift+z',revised]] as const) {
    await page.keyboard.press(key);
    expect(await read()).toEqual(expected);
  }
});


for (const batch of [false,true]) test(`root frame clipboard retains editable remembered motion (batch ${batch})`, async ({page}) => {
  const p=newProject(), layer=p.layers[0];
  p.duration=12;
  const art:Vector={id:'ink',kind:'rectangle',x:10,y:10,width:30,height:30,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[0,4,7,11].map(frame=>({frame,shapes:[{...art,x:frame*10}]}));
  createBasicMotionSpan(p,[layer.id],0,4,'linear');
  createBasicMotionSpan(p,[layer.id],7,11,'out');
  if(batch){
    const second=newLayer('Second');
    second.keys=structuredClone(layer.keys);
    second.motionSpans=structuredClone(layer.motionSpans);
    p.layers.push(second);
  }
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cell=(f:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*f,y:40}});
  const button=(name:string)=>page.getByRole('button',{name,exact:true}).click();
  const select = async (start:number,end:number) => {
    await cell(start);
    await page.keyboard.down('Shift');await cell(end);await page.keyboard.up('Shift');
  };
  await select(0,4);
  if(batch){await page.getByText('Multi-layer frame edits',{exact:true}).click();await button('Select all timeline layers');}
  await button(batch?'Copy selected layer frames':'Copy frames');
  const paste=async (f:number)=>{
    if(batch) await page.getByLabel('Batch destination frame',{exact:true}).fill(String(f+1));
    else await cell(f);
    await button(batch?'Insert multi-layer clipboard':'Insert copied frames');
  };
  await paste(3);
  await expect(page.getByRole('alert')).toContainText('inside a remembered');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await paste(6);
  const pasted=await read();
  expect(pasted.duration).toBe(17);
  for(const [i,l] of pasted.layers.entries()){
    expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[6,10],[12,16]]);
    expect(l.motionSpans![0]).toEqual(p.layers[i].motionSpans![0]);
    expect(l.motionSpans![1].id).not.toBe(l.motionSpans![0].id);
    expect(l.motionSpans![2].id).toBe(p.layers[i].motionSpans![1].id);
    expect(JSON.parse(l.motionSpans![1].baseline)).toEqual(l.keys.filter(k=>k.frame>6&&k.frame<10));
  }
  await select(6,10);
  await page.getByLabel('Remembered motion easing',{exact:true}).selectOption('in');
  await button('Apply easing to remembered motion');
  const revised=await read(), active=revised.layers.at(-1)!;
  expect(active.motionSpans![1].ease).toBe('in');
  expect(active.keys.find(k=>k.frame===8)!.shapes[0].x).toBeLessThan(20);
  await page.getByLabel('Drawing stage').focus();
  for(const [key,state] of [['Control+z',pasted],['Control+z',p],['Control+Shift+z',pasted],['Control+Shift+z',revised]] as const){
    await page.keyboard.press(key);
    expect(await read()).toEqual(state);
  }
});

for (const batch of [false,true]) test(`cut remembered ranges retain a shared endpoint and the last successful clipboard (batch ${batch})`, async ({page}) => {
  const p = newProject();
  p.duration = 16;
  if (batch) p.layers.push(newLayer('Second'));
  for (const [index,layer] of p.layers.entries()) {
    const art: Vector = {id:'ink'+index,kind:'rectangle',x:10,y:20,width:20,height:20,rotation:0,
      fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
    layer.keys = [0,2,6,10].map(frame=>({frame,shapes:[{...art,x:10+frame*5}]}));
    createBasicMotionSpan(p,[layer.id],2,6,'linear');
    createBasicMotionSpan(p,[layer.id],6,10,'in');
  }
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cell = (f:number) => page.getByLabel('Timeline frames').click({position:{x:9+18*f,y:40}});
  const select = async (first:number,last:number) => {
    await cell(first);await page.keyboard.down('Shift');await cell(last);await page.keyboard.up('Shift');
  };
  const command = (name:string) => page.getByRole('button',{name,exact:true}).click();
  const cut = batch?'Cut selected layer frames':'Cut frames';
  await select(2,6);
  if(batch){await page.getByText('Multi-layer frame edits',{exact:true}).click();await command('Select all timeline layers');}
  await command(cut);
  const cleared = await read();
  expect(cleared.duration).toBe(p.duration);
  for (const [i,l] of cleared.layers.entries()){
    expect(l.motionSpans).toEqual([p.layers[i].motionSpans![1]]);
    expect(l.keys).toEqual([p.layers[i].keys[0],{frame:2,shapes:[]},...p.layers[i].keys.filter(k=>k.frame>=6)]);
  }
  await select(7,8);
  await command(cut);
  await expect(page.getByRole('alert')).toContainText('complete remembered');
  expect(await read()).toEqual(cleared);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  if(batch) await page.getByLabel('Batch destination frame',{exact:true}).fill('14');
  else await cell(13);
  await command(batch?'Insert multi-layer clipboard':'Insert copied frames');
  const pasted = await read();
  expect(pasted.duration).toBe(21);
  for(const [i,l] of pasted.layers.entries()){
    const recipe = l.motionSpans![1];
    expect([recipe.start,recipe.end,recipe.ease]).toEqual([13,17,'linear']);
    expect(l.keys.filter(k=>k.frame>=13&&k.frame<=17)).toEqual(
      p.layers[i].keys.filter(k=>k.frame>=2&&k.frame<=6).map(k=>({...k,frame:k.frame+11})));
    expect(JSON.parse(recipe.baseline)).toEqual(l.keys.filter(k=>k.frame>13&&k.frame<17));
  }
  await page.getByLabel('Drawing stage').focus();
  for(const [key,expected] of [['Control+z',cleared],['Control+z',p],
    ['Control+Shift+z',cleared],['Control+Shift+z',pasted]] as const) {
    await page.keyboard.press(key);
    expect(await read()).toEqual(expected);
  }
});

for (const batch of [false,true]) test(`Duplicate frames preserves remembered junctions and the previous clipboard (batch ${batch})`, async ({page}) => {
  const p = newProject();
  p.duration = 16;
  if (batch) p.layers.push(newLayer('Second'));
  for (const layer of p.layers) {
    const art:Vector = {id:'ink',kind:'rectangle',x:10,y:20,width:20,height:20,rotation:0,
      fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
    layer.keys = [0,2,6,10].map(frame=>({frame,shapes:[{...art,x:10+frame*5}]}));
    createBasicMotionSpan(p,[layer.id],2,6,'linear');
    createBasicMotionSpan(p,[layer.id],6,10,'out');
  }
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cell = (frame:number) => page.getByLabel('Timeline frames').click({position:{x:9+18*frame,y:40}});
  const select = async (start:number,end:number) => {
    await cell(start);await page.keyboard.down('Shift');await cell(end);await page.keyboard.up('Shift');
  };
  const click = (name:string) => page.getByRole('button',{name,exact:true}).click();
  const duplicate = () => click(batch?'Duplicate frames on selected layers':'Duplicate frame range');
  await cell(0);
  if(batch){await page.getByText('Multi-layer frame edits',{exact:true}).click();await click('Select all timeline layers');}
  await click(batch?'Copy selected layer frames':'Copy frames');
  await select(3,4);await duplicate();
  await expect(page.getByRole('alert')).toContainText('inside a remembered');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await select(2,6);await duplicate();
  const duplicated=await read();
  expect(duplicated.duration).toBe(21);
  for (const [i,l] of duplicated.layers.entries()){
    expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[2,6],[7,11],[11,15]]);
    expect(l.motionSpans![0]).toEqual(p.layers[i].motionSpans![0]);
    expect(l.motionSpans![2].id).toBe(p.layers[i].motionSpans![1].id);
    expect(l.keys.filter(k=>k.frame>=7&&k.frame<=11)).toEqual(p.layers[i].keys.filter(k=>k.frame>=2&&k.frame<=6).map(k=>({...k,frame:k.frame+5})));
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(duplicated);
  if(batch) await page.getByLabel('Batch destination frame',{exact:true}).fill('18');
  else await cell(17);
  await click(batch?'Insert multi-layer clipboard':'Insert copied frames');
  const pasted=await read();
  expect(pasted.duration).toBe(22);
  for(const [i,l] of pasted.layers.entries()) expect(l.keys.find(k=>k.frame===17)?.shapes).toEqual(p.layers[i].keys[0].shapes);
});

async function openRootMotionRange(page: Page, batch: boolean) {
  const p=newProject();
  p.duration=18;
  if(batch) p.layers.push(newLayer('Second'));
  for(const layer of p.layers) {
    const art:Vector={id:'ink',kind:'rectangle',x:0,y:20,width:20,height:20,rotation:0,
      fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
    layer.keys=[0,2,6,9,13].map(frame=>({frame,shapes:[{...art,x:frame*4}]}));
    createBasicMotionSpan(p,[layer.id],2,6,'linear');
    createBasicMotionSpan(p,[layer.id],9,13,'out');
  }
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cell=(n:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*n,y:40}});
  const select=async (first:number,last:number)=>{
    await cell(first);await page.keyboard.down('Shift');await cell(last);await page.keyboard.up('Shift');
  };
  const click=(name:string)=>page.getByRole('button',{name,exact:true}).click();
  await select(3,4);
  if(batch){await page.getByText('Multi-layer frame edits',{exact:true}).click();await click('Select all timeline layers');}
  return {p, read, select, click};
}

for (const batch of [false,true]) test(`removing root frame ranges preserves surviving editable motion (batch ${batch})`, async ({page}) => {
  const {p, read, select, click} = await openRootMotionRange(page, batch);
  const remove=()=>click(batch?'Remove frames on selected layers':'Remove layer frames');
  await remove();
  await expect(page.getByRole('alert')).toContainText('part of a remembered motion span');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await select(2,6);await remove();
  const removed=await read();
  expect(removed.duration).toBe(18);
  for(const [i,l] of removed.layers.entries()){
    expect(l.motionSpans).toHaveLength(1);
    expect(l.motionSpans![0]).toMatchObject({start:4,end:8,ease:'out',id:p.layers[i].motionSpans![1].id});
    expect(JSON.parse(l.motionSpans![0].baseline)).toEqual(l.keys.filter(k=>k.frame>4&&k.frame<8));
    expect(l.keys.find(k=>k.frame===2)!.shapes).toEqual(p.layers[i].keys.find(k=>k.frame===6)!.shapes);
    expect(l.keys.at(-1)).toEqual({frame:13,shapes:[]});
  }
  await select(4,8);
  await page.getByLabel('Remembered motion easing',{exact:true}).selectOption('in');
  await click('Apply easing to remembered motion');
  const revised=await read();
  expect(revised.layers.at(-1)!.motionSpans![0].ease).toBe('in');
  expect(revised.layers.at(-1)!.keys.find(k=>k.frame===6)!.shapes[0].x).toBeLessThan(removed.layers.at(-1)!.keys.find(k=>k.frame===6)!.shapes[0].x);
  await page.getByLabel('Drawing stage').focus();
  for(const [key,expected] of [['Control+z',removed],['Control+z',p],['Control+Shift+z',removed],['Control+Shift+z',revised]] as const){
    await page.keyboard.press(key);expect(await read()).toEqual(expected);
  }
});

for (const batch of [false,true]) test(`retiming root frame ranges regenerates editable motion (batch ${batch})`, async ({page}) => {
  const {p, read, select, click} = await openRootMotionRange(page, batch);

  await page.getByLabel('Retimed range length',{exact:true}).fill('9');
  const retime = () => click(batch ? 'Retime frames on selected layers' : 'Retime frame range');
  await retime();
  await expect(page.getByRole('alert')).toContainText('part of a remembered');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await select(2,6);
  await retime();
  const stretched = await read();
  expect(stretched.duration).toBe(22);
  for (const [i,layer] of stretched.layers.entries()) {
    expect(layer.motionSpans!.map(s => [s.start,s.end])).toEqual([[2,10],[13,17]]);
    expect(layer.motionSpans!.map(s => s.id)).toEqual(p.layers[i].motionSpans!.map(s => s.id));
    expect(layer.keys.find(key => key.frame === 6)!.shapes[0].x).toBe(16);
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(stretched);
});

for (const batch of [false,true]) test(`root Reverse frames preserves editable motion (batch ${batch})`, async ({page}) => {
  const {p,read,select,click} = await openRootMotionRange(page,batch);
  const reverse = () => click(batch ? 'Reverse frames on selected layers' : 'Reverse frame range');
  await reverse();
  await expect(page.getByRole('alert')).toContainText('part of a remembered');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await select(2,13);
  await reverse();
  const reversed = await read();
  for (const [i,layer] of reversed.layers.entries()) {
    const spans = p.layers[i].motionSpans!;
    expect(layer.motionSpans!.map(s => [s.start,s.end,s.ease,s.id])).toEqual([
      [2,6,'in',spans[1].id], [9,13,'linear',spans[0].id],
    ]);
    expect(layer.keys.find(key => key.frame===2)!.shapes[0].x).toBe(52);
    expect(layer.keys.find(key => key.frame===14)!.shapes[0].x).toBe(52);
  }
  await select(2,6);
  await page.getByLabel('Remembered motion easing',{exact:true}).selectOption('out');
  await click('Apply easing to remembered motion');
  const revised = await read();
  expect(revised.layers.at(-1)!.motionSpans![0].ease).toBe('out');
  await page.getByLabel('Drawing stage').focus();
  for (const [key,expected] of [['Control+z',reversed],['Control+z',p],['Control+Shift+z',reversed]] as const) {
    await page.keyboard.press(key);
    expect(await read()).toEqual(expected);
  }
});

test('clearing remembered root ranges preserves the prior multi-layer clipboard and history', async ({page}) => {
  const {p,read,select,click} = await openRootMotionRange(page,true);
  await select(9,13);
  await click('Copy selected layer frames');
  await select(3,5);
  await click('Clear frames on selected layers');
  await expect(page.getByRole('alert')).toContainText('complete remembered');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await select(2,6);
  await click('Clear frames on selected layers');
  const cleared = await read();
  for (const [i,layer] of cleared.layers.entries()) {
    expect(layer.motionSpans).toEqual([p.layers[i].motionSpans![1]]);
    expect(layer.keys.find(key => key.frame===2)!.shapes).toEqual([]);
    expect(layer.keys.find(key => key.frame===7)!.shapes).toEqual(p.layers[i].keys.find(key => key.frame===6)!.shapes);
  }
  await page.getByLabel('Batch destination frame',{exact:true}).fill('18');
  await click('Insert multi-layer clipboard');
  const pasted = await read();
  for (const [i,layer] of pasted.layers.entries()) {
    expect(layer.motionSpans!.at(-1)).toMatchObject({start:17,end:21,ease:'out'});
    expect(layer.keys.find(key => key.frame===17)!.shapes).toEqual(p.layers[i].keys.find(key => key.frame===9)!.shapes);
  }
  await page.getByLabel('Drawing stage').focus();
  for (const [key,expected] of [['Control+z',cleared],['Control+z',p],['Control+Shift+z',cleared],['Control+Shift+z',pasted]] as const) {
    await page.keyboard.press(key);
    expect(await read()).toEqual(expected);
  }
});

for (const batch of [false,true]) test(`move remembered root frames with editable ownership (batch ${batch})`, async ({page}) => {
  const {p,read,select,click} = await openRootMotionRange(page,batch);
  const drag = async (from:number,to:number,cancel=false) => {
    const box = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.move(box.x+9+18*from,box.y+40);
    await page.mouse.down();
    await page.mouse.move(box.x+9+18*to,box.y+40);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await select(2,6);
  if (batch) {
    const at = page.getByLabel('Batch destination frame',{exact:true});
    await at.fill('10');
    await click('Move selected layer frames');
    await expect(page.getByRole('alert')).toContainText('Destination contains');
    expect(await read()).toEqual(p);
    await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
    await at.fill('19');
    await click('Move selected layer frames');
  } else {
    await page.getByLabel('Drag selected frames',{exact:true}).check();
    await drag(2,18,true);
    expect(await read()).toEqual(p);
    await drag(2,18);
    await page.getByLabel('Drag selected frames',{exact:true}).uncheck();
  }
  const moved = await read();
  expect(moved.duration).toBe(23);
  for (const [i,layer] of moved.layers.entries()) {
    expect(layer.motionSpans![0]).toEqual(p.layers[i].motionSpans![1]);
    expect(layer.motionSpans![1]).toMatchObject({start:18,end:22,id:p.layers[i].motionSpans![0].id});
    expect(layer.keys.slice(-5)).toEqual(p.layers[i].keys.filter(k => k.frame>=2 && k.frame<=6).map(k => ({...k,frame:k.frame+16})));
    expect(layer.keys.find(k => k.frame===2)!.shapes).toEqual([]);
  }
  await select(18,22);
  await page.getByLabel('Remembered motion easing',{exact:true}).selectOption('in');
  await click('Apply easing to remembered motion');
  const revised = await read();
  expect(revised.layers.at(-1)!.motionSpans![1].ease).toBe('in');
  await page.getByLabel('Drawing stage').focus();
  for (const [key,expected] of [['Control+z',moved],['Control+z',p],['Control+Shift+z',moved],['Control+Shift+z',revised]] as const) {
    await page.keyboard.press(key);
    expect(await read()).toEqual(expected);
  }
});

for (const action of ['copy','move','swap'] as const)
  test(`remembered root cross-layer ${action} publishes one editable history step`, async ({page}) => {
    const {p,read,select,click} = await openRootMotionRange(page,true);
    await select(2,6);
    const [target,source] = p.layers;
    if (action==='swap') {
      // Selecting the newer range selects its source row; map both original tracks explicitly.
      await click('Select all timeline layers');
      await page.getByText('Map multiple frame tracks',{exact:true}).click();
      await page.getByLabel('Destination for Layer 1',{exact:true}).selectOption(source.id);
      await page.getByLabel('Destination for Second',{exact:true}).selectOption(target.id);
      await click('Swap mapped frame tracks');
    } else {
      await page.getByText('Transfer frames between layers',{exact:true}).click();
      await page.getByLabel('Frame transfer destination layer',{exact:true}).selectOption(target.id);
      const dest = page.getByLabel('Frame transfer destination frame',{exact:true});
      await dest.fill('10');
      const command = action==='copy'?'Copy range to layer':'Move range to layer';
      await click(command);
      await expect(page.getByRole('alert')).toContainText('Destination contains');
      expect(await read()).toEqual(p);
      await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
      await dest.fill('19');
      await click(command);
    }
    const saved = await read(), at = action==='swap'?2:18;
    const recipe = saved.layers[0].motionSpans!.find(span => span.start===at)!;
    if (action==='copy') {
      expect(recipe.id).not.toBe(source.motionSpans![0].id);
      expect(saved.layers[1]).toEqual(source);
    } else expect(recipe.id).toBe(source.motionSpans![0].id);
    expect(saved.layers[0].keys.find(key => key.frame===at)!.shapes[0].id).not.toBe('ink');
    expect(JSON.parse(recipe.baseline)).toEqual(saved.layers[0].keys.filter(key => key.frame>at && key.frame<at+4));
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    expect(await read()).toEqual(saved);
  });

for (const operation of ['copy','move'] as const) for (const mapped of [false,true]) test(`${operation} root range with independent opacity and history (mapped ${mapped})`, async ({page}) => {
  const p = newProject();
  p.duration = 10;
  p.width = 120;
  p.height = 80;
  p.layers.push(newLayer('Second'),newLayer('First copy'),newLayer('Second copy'));
  const sources = p.layers.slice(0,mapped?2:1);
  p.opacityBindings = sources.map((source,i) => {
    const ink:Vector = {id:'ink',kind:'rectangle',x:i*60,y:0,width:120,height:80,rotation:0,
      fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
    source.keys = [{frame:0,shapes:[ink]},{frame:6,shapes:[]}];
    return {layerId:source.id,shapeId:ink.id,start:2,end:5,
      keys:[{frame:3,opacity:0.125,ease:{kind:'cubic',x1:0.25,y1:0,x2:0.75,y2:1}},{frame:5,opacity:0.875}]};
  });
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const click = (name:string) => page.getByRole('button',{name,exact:true}).click();
  const select = async (first:number,last:number) => {
    const grid = page.getByLabel('Timeline frames');
    await grid.click({position:{x:9+18*first,y:124}});
    await page.keyboard.down('Shift');
    await grid.click({position:{x:9+18*last,y:124}});
    await page.keyboard.up('Shift');
  };
  await select(3,5);
  if (mapped) {
    await page.getByText('Multi-layer frame edits',{exact:true}).click();
    for (const source of sources) await page.getByLabel('Batch layer '+source.name,{exact:true}).check();
    await page.getByText('Map multiple frame tracks',{exact:true}).click();
    for (const [i,source] of sources.entries())
      await page.getByLabel('Destination for '+source.name,{exact:true}).selectOption(p.layers[i+2].id);
    await page.getByLabel('Mapped tracks destination frame',{exact:true}).fill('8');
  } else {
    await page.getByText('Transfer frames between layers',{exact:true}).click();
    await page.getByLabel('Frame transfer destination layer',{exact:true}).selectOption(p.layers[2].id);
    await page.getByLabel('Frame transfer destination frame',{exact:true}).fill('8');
  }
  const verb = operation==='copy'?'Copy':'Move';
  const withOpacity = mapped?`${verb} mapped tracks with opacity animation`:`${verb} range with opacity animation`;
  await click(withOpacity);
  await expect(page.getByRole('alert')).toContainText('complete opacity channel');
  expect(await read()).toEqual(p);
  await page.getByRole('alert').getByRole('button',{name:'Dismiss'}).click();
  await select(2,5);
  await click(mapped?'Copy mapped frame tracks':'Copy range to layer');
  expect((await read()).opacityBindings).toEqual(p.opacityBindings);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  await click(withOpacity);
  const saved = await read();
  expect(saved.duration).toBe(11);
  const retained = operation==='copy' ? sources.length : 0;
  expect(saved.opacityBindings!.slice(0,retained)).toEqual(p.opacityBindings!.slice(0,retained));
  expect(saved.opacityBindings).toHaveLength(retained+sources.length);
  for (const [i,source] of sources.entries()) {
    if (operation==='copy') expect(saved.layers[i]).toEqual(source);
    else expect(saved.layers[i].keys.find(k => k.frame===2)!.shapes).toEqual([]);
    const dest = saved.layers[i+2],copiedId = dest.keys.find(k=>k.frame===7)!.shapes[0].id;
    expect(copiedId).not.toBe('ink');
    expect(saved.opacityBindings![retained+i]).toEqual({
      layerId:dest.id,shapeId:copiedId,start:7,end:10,
      keys:p.opacityBindings![i].keys.map(k=>({...k,frame:k.frame+5})),
    });
  }
  if (!mapped) {
    const stage = page.getByLabel('Drawing stage');
    for (const [frame,green] of [[8,223],[9,127],[10,32]]) {
      await page.getByLabel('Timeline frames').click({position:{x:9+18*frame,y:68}});
      await expect.poll(() => stage.evaluate((el,g) => {
        const canvas = el as HTMLCanvasElement;
        const [red,green,blue] = canvas.getContext('2d')!.getImageData(canvas.width/2+5,canvas.height/2+5,1,1).data;
        return red===255 && Math.abs(green-g)<=1 && Math.abs(blue-g)<=1;
      },green)).toBe(true);
    }
  }
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(saved);
});

for (const stale of [false,true]) for (const blocked of stale?[false]:[false,true]) test(`sampled editing stage binds paint and picks without recovery writes (stale ${stale}, blocked ${blocked})`, async ({page}) => {
  const p=newProject();p.width=120;p.height=80;p.duration=10;
  const layer=p.layers[0],ink:Vector={id:'ink',kind:'rectangle',x:0,y:10,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]}];
  createBasicMotionSpan(p,[layer.id],0,8,'linear');
  layer.keys.at(-1)!.shapes[0].x=40;
  if(stale)layer.keys[2].shapes[0].x++;
  if(blocked)p.layers.push({...newLayer('Locked foreground'),locked:true,keys:[{frame:0,shapes:[{...ink,id:'foreground',x:20,fill:'#0000ff'}]}]});
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const timeline=page.getByLabel('Timeline frames');
  await timeline.click({position:{x:9+18*4,y:40}});
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  const region=page.getByRole('region',{name:'Sampled motion stage'});
  await expect(region).toBeVisible();
  const stage=page.getByLabel('Drawing stage');
  const pixel=()=>stage.evaluate(el=>{
    const c=el as HTMLCanvasElement,dpr=devicePixelRatio||1;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2+(25-60)*.8*dpr,c.height/2+(15-40)*.8*dpr,1,1).data);
  });
  if(stale) {
    await expect(region.getByRole('alert')).toContainText('Generated keys changed');
    await expect.poll(pixel).toEqual([255,255,255,255]);
    await expect(region.getByLabel('Sampled stage artwork')).toHaveValue('');
  } else {
    await expect.poll(pixel).toEqual(blocked?[0,0,255,255]:[255,0,0,255]);
    const b=(await stage.boundingBox())!;
    await stage.click({position:{x:b.width/2+(25-60)*.8,y:b.height/2+(15-40)*.8}});
    const choice=region.getByLabel('Sampled stage artwork');
    await expect(choice).toHaveValue(blocked?'':JSON.stringify([layer.id,'ink']));
    await page.keyboard.press('Delete');
    expect(await read()).toEqual(p);
    await timeline.click({position:{x:9+18*5,y:40}});
    await expect(choice).toHaveValue('');
    if(!blocked)await choice.selectOption(JSON.stringify([layer.id,'ink']));
    expect(await read()).toEqual(p);
    await page.getByRole('button',{name:'Add layer',exact:true}).click();
    await expect(choice).toHaveValue('');
    const changed=await read();
    expect(changed.layers[0]).toEqual(layer);
    await page.getByRole('button',{name:'Play animation',exact:true}).click();
    await stage.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Play animation',exact:true})).toBeVisible();
    await expect(region).toBeHidden();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
  }
  if(stale) await region.getByRole('button',{name:'Return to authored stage'}).click();
  expect(await read()).toEqual(p);
});

for (const rejected of [false,true]) test(`promote sampled editing-stage pose in one history edit (rejected ${rejected})`,async({page})=>{
  const p=newProject();p.width=120;p.height=80;p.duration=10;
  const layer=p.layers[0], ink:Vector={id:'ink',kind:'rectangle',x:0,y:10,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]}];
  createBasicMotionSpan(p,[layer.id],0,8,rejected?'in-out':'linear');
  layer.keys.at(-1)!.shapes[0].x=40;
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const timeline=page.getByLabel('Timeline frames');
  const cell=(frame:number)=>timeline.click({position:{x:9+18*frame,y:40}});
  await cell(rejected?3:4);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  const region=page.getByRole('region',{name:'Sampled motion stage'});
  const choice=region.getByLabel('Sampled stage artwork');
  const promote=region.getByRole('button',{name:'Promote sampled stage pose',exact:true});
  await expect(promote).toBeDisabled();
  await choice.selectOption(JSON.stringify([layer.id,'ink']));
  await cell(rejected?4:5);
  await expect(promote).toBeDisabled();
  await cell(rejected?3:4);
  await choice.selectOption(JSON.stringify([layer.id,'ink']));
  expect(await read()).toEqual(p);
  await promote.click();
  if(rejected){
    await expect(page.getByRole('alert').filter({hasText:/easing|midpoint|preserv/i})).toBeVisible();
    await expect(region).toBeVisible();
    expect(await read()).toEqual(p);
    await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await read()).toEqual(p);
    return;
  }
  await expect(region).toBeHidden();
  const saved=await read(),result=saved.layers[0];
  expect(result.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
  expect(result.keys.find(k=>k.frame===4)!.shapes[0].x).toBe(20);
  expect(result.keys[0]).toEqual(layer.keys[0]);
  expect(result.keys.at(-1)).toEqual(layer.keys.at(-1));
  expect(saved.duration).toBe(p.duration);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for (const mode of ['move','tangent-rejection','merge'] as const) test(`sampled stage promotion translates both halves atomically (${mode})`,async({page})=>{
  const p=newProject(), layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
  const ink:Vector={id:'pick',kind:'rectangle',x:0,y:10,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[ink,{...ink,id:'other',y:60}]},
    {frame:8,shapes:[{...ink,x:80},{...ink,id:'other',x:80,y:60}]},{frame:9,shapes:[]}];
  if(mode==='merge')layer.drawingMode='merge';
  createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,
    mode==='tangent-rejection'?{startX:16,startY:0,endX:-16,endY:0,tangent:true}:undefined);
  if(mode==='move')layer.keys[8].shapes[0].x=160;
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const cell=(frame:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*frame,y:40}});
  await cell(4);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  const region=page.getByRole('region',{name:'Sampled motion stage'});
  const choice=region.getByLabel('Sampled stage artwork'), x=region.getByLabel('Sampled stage X offset'),
    y=region.getByLabel('Sampled stage Y offset'),
    move=region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true});
  await choice.selectOption(JSON.stringify([layer.id,'pick']));
  if(mode==='merge'){
    await expect(x).toHaveCount(0);await expect(move).toHaveCount(0);
    await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
  }else{
    await expect(move).toBeDisabled();
    await x.fill('20');await y.fill('8');
    await choice.selectOption(JSON.stringify([layer.id,'other']));
    await expect(x).toHaveValue('0');await expect(y).toHaveValue('0');
    await choice.selectOption(JSON.stringify([layer.id,'pick']));
    await x.fill('20');await cell(5);
    await expect(x).toHaveCount(0);
    await cell(4);await choice.selectOption(JSON.stringify([layer.id,'pick']));
    await expect(x).toHaveValue('0');
    await x.fill('');await y.fill('8');await expect(move).toBeDisabled();
    if(mode==='move'){
      await page.setViewportSize({width:1100,height:900});
      const box=(await move.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(1100);
    }
    await x.fill(mode==='tangent-rejection'?'40':'20');
    await y.fill(mode==='tangent-rejection'?'0':'8');
    expect(await read()).toEqual(p);
    await move.click();
    if(mode==='tangent-rejection'){
      await expect(page.getByRole('alert').filter({hasText:/tangent/i})).toBeVisible();
      await expect(region).toBeVisible();expect(await read()).toEqual(p);
      // Split succeeds on its own; failed right-side regeneration published no split.
      await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
    }
  }
  await expect(region).toBeHidden();
  const saved=await read(),keys=saved.layers[0].keys;
  expect(saved.layers[0].motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
  if(mode==='move'){
    expect([2,4,6].map(i=>[keys[i].shapes[0].x,keys[i].shapes[0].y])).toEqual([[50,14],[100,18],[130,14]]);
    expect(keys.map(k=>k.shapes[1])).toEqual(layer.keys.map(k=>k.shapes[1]));
    expect(keys[0]).toEqual(layer.keys[0]);expect(keys.slice(8)).toEqual(layer.keys.slice(8));
  }else expect(keys).toEqual(layer.keys);
  expect(saved.duration).toBe(p.duration);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for (const scenario of ['commit','cancel','source','frame'] as const) test(`sampled stage drag owns its pointer and pending offsets (${scenario})`,async({page})=>{
  const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
  const ink:Vector={id:'drag',kind:'rectangle',x:0,y:10,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[{...ink,x:80}]},{frame:9,shapes:[]}];
  createBasicMotionSpan(p,[layer.id],0,8,'linear');
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  await page.getByLabel('Timeline frames').click({position:{x:9+18*4,y:40}});
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  const region=page.getByRole('region',{name:'Sampled motion stage'}), stage=page.getByLabel('Drawing stage'),
    choice=region.getByLabel('Sampled stage artwork'), x=region.getByLabel('Sampled stage X offset'),
    y=region.getByLabel('Sampled stage Y offset'), commit=region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true});
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
  await choice.selectOption(JSON.stringify([layer.id,'drag']));
  const begin=async()=>{
    const b=(await stage.boundingBox())!;
    const start={x:b.x+b.width/2+(50-100)*.5,y:b.y+b.height/2+(20-50)*.5};
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    await page.mouse.move(start.x+10,start.y+4);
    await expect(commit).toBeDisabled();await expect(choice).toBeDisabled();
    expect(await read()).toEqual(p);
  };
  if(scenario==='cancel'){
    for(const cancel of ['escape','pointercancel','lost','blur','resize','zoom']){
      await x.fill('2');await y.fill('3');await begin();
      // A competing pointer cannot update or cancel the active drag.
      await stage.dispatchEvent('pointermove',{pointerId:999,clientX:0,clientY:0});
      await stage.dispatchEvent('pointercancel',{pointerId:999});
      expect(Number(await x.inputValue())).toBeCloseTo(22);
      if(cancel==='escape')await page.keyboard.press('Escape');
      else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      else if(cancel==='resize')await page.setViewportSize({width:1200,height:900});
      else if(cancel==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
      else await stage.evaluate((el,kind)=>{
        const c=el as HTMLCanvasElement;
        if(kind==='lost')c.releasePointerCapture(1);
        else c.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}));
      },cancel);
      if(cancel==='lost'){
        // Chromium processes pending capture release before the next pointer event.
        const b=(await stage.boundingBox())!;
        await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
      }
      await expect(choice,cancel).toBeEnabled();
      await expect(x).toHaveValue('2');await expect(y).toHaveValue('3');
      await page.mouse.up();expect(await read()).toEqual(p);
    }
    await region.getByRole('button',{name:'Return to authored stage'}).click();
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
    return;
  }
  await begin();
  if(scenario==='frame'){
    const timeline=page.getByLabel('Timeline frames'), b=(await timeline.boundingBox())!;
    await timeline.dispatchEvent('pointerdown',{clientX:b.x+9+18*5,clientY:b.y+40,button:0,pointerId:999});
    await timeline.dispatchEvent('pointerup',{pointerId:999});
    await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');
    await expect(x).toHaveCount(0);await page.mouse.up();
    expect(await read()).toEqual(p);
    await region.getByRole('button',{name:'Return to authored stage'}).click();
    return;
  }
  if(scenario==='source'){
    await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
    await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');
    await expect(x).toHaveCount(0);await page.mouse.up();
    const changed=await read();expect(changed.layers).toHaveLength(2);expect(changed.layers[0]).toEqual(layer);
    await region.getByRole('button',{name:'Return to authored stage'}).click();
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
    return;
  }
  await page.mouse.up();await expect(commit).toBeEnabled();
  expect(Number(await x.inputValue())).toBeCloseTo(20);
  expect(Number(await y.inputValue())).toBeCloseTo(8);
  expect(await read()).toEqual(p);await commit.click();await expect(region).toBeHidden();
  const saved=await read(),keys=saved.layers[0].keys;
  expect(keys[4].shapes[0].x).toBeCloseTo(60);expect(keys[4].shapes[0].y).toBeCloseTo(18);
  expect(keys[2].shapes[0].x).toBeCloseTo(30);expect(keys[6].shapes[0].x).toBeCloseTo(70);
  expect(keys[0]).toEqual(layer.keys[0]);expect(keys.slice(8)).toEqual(layer.keys.slice(8));
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for (const scenario of ['commit','invalidate','reject'] as const) test(`sampled stage proposal is detached and source-owned (${scenario})`,async({page})=>{
  const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
  const ink:Vector={id:'proposal',kind:'rectangle',x:0,y:10,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[ink,{...ink,id:'other',y:60}]},
    {frame:8,shapes:[{...ink,x:80},{...ink,id:'other',x:80,y:60}]},{frame:9,shapes:[]}];
  createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,
    scenario==='reject'?{startX:16,startY:0,endX:-16,endY:0,tangent:true}:undefined);
  if(scenario!=='reject')layer.keys[8].shapes[0].x=160;
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),
    cell=(frame:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*frame,y:40}});
  await cell(4);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
  const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),
    choice=region.getByLabel('Sampled stage artwork'),x=region.getByLabel('Sampled stage X offset'),
    y=region.getByLabel('Sampled stage Y offset'),preview=region.getByRole('button',{name:'Preview sampled stage move',exact:true}),
    proposed=region.getByRole('status'),commit=region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true});
  const select=async()=>{
    await choice.selectOption(JSON.stringify([layer.id,'proposal']));
    await x.fill(scenario==='reject'?'40':'20');await y.fill(scenario==='reject'?'0':'8');
  };
  const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
    const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),sx=c.width/r.width,sy=c.height/r.height;
    return Array.from(c.getContext('2d')!.getImageData((r.width/2+(p.x-100)*.5)*sx,(r.height/2+(p.y-50)*.5)*sy,1,1).data);
  },{x,y});
  await select();expect(await read()).toEqual(p);await preview.click();
  if(scenario==='reject'){
    await expect(page.getByRole('alert').filter({hasText:/tangent/i})).toBeVisible();
    await expect(proposed).toHaveCount(0);expect(await read()).toEqual(p);
    await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
    await expect(region).toBeHidden();expect((await read()).layers[0].keys).toEqual(layer.keys);
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
    return;
  }
  await expect(proposed).toContainText('not applied');
  await expect.poll(()=>pixel(105,23)).toEqual([255,0,0,255]);
  await expect.poll(()=>pixel(85,15)).toEqual([255,255,255,255]);
  expect(await read()).toEqual(p);
  // Proposed artwork never becomes the source of a new stage pick or drag.
  const b=(await stage.boundingBox())!;
  await stage.click({position:{x:b.width/2+(105-100)*.5,y:b.height/2+(23-50)*.5}});
  await expect(choice).toHaveValue(JSON.stringify([layer.id,'proposal']));
  await expect(x).toHaveValue('20');await expect(proposed).toBeVisible();
  if(scenario==='invalidate'){
    await x.fill('40');await expect(proposed).toHaveCount(0);
    await expect.poll(()=>pixel(85,15)).toEqual([255,0,0,255]);
    await x.fill('20');await expect(proposed).toHaveCount(0);
    await preview.click();await choice.selectOption(JSON.stringify([layer.id,'other']));
    await expect(proposed).toHaveCount(0);await expect(x).toHaveValue('0');
    await select();await preview.click();await cell(5);await expect(proposed).toHaveCount(0);
    await cell(4);await expect(choice).toHaveValue('');
    await select();await preview.click();
    await region.getByRole('button',{name:'Discard sampled stage proposal',exact:true}).click();
    await expect(proposed).toHaveCount(0);await expect(choice).toHaveValue(JSON.stringify([layer.id,'proposal']));
    expect(await read()).toEqual(p);
    await preview.click();await stage.focus();await page.keyboard.press('Escape');
    await expect(proposed).toHaveCount(0);await expect(region).toBeVisible();
    await preview.click();await page.getByRole('button',{name:'Add layer',exact:true}).click();
    await expect(proposed).toHaveCount(0);await expect(choice).toHaveValue('');
    const changed=await read();expect(changed.layers[0]).toEqual(layer);
    await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
    return;
  }
  await commit.click();await expect(region).toBeHidden();
  const saved=await read();expect(saved.layers[0].keys[4].shapes[0].x).toBe(100);
  expect(saved.layers[0].keys[4].shapes[0].y).toBe(18);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const scenario of ['commit','cancel','source','frame','reject','merge'] as const)test(`direct sampled-root drag authoring is guarded (${scenario})`,async({page})=>{
  const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
  const ink:Vector={id:'direct-pick',kind:'rectangle',x:0,y:10,width:20,height:20,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  layer.keys=[{frame:0,shapes:[ink,{...ink,id:'direct-other',y:60}]},
    {frame:8,shapes:[{...ink,x:80},{...ink,id:'direct-other',x:80,y:60}]},{frame:9,shapes:[]}];
  if(scenario==='merge')layer.drawingMode='merge';
  createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,
    scenario==='reject'?{startX:16,startY:0,endX:-16,endY:0,tangent:true}:undefined);
  if(scenario!=='reject' && scenario!=='merge')layer.keys[8].shapes[0].x=160;
  await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
  await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),
    cell=(at:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*at,y:40}});
  await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
  const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),
    choice=region.getByLabel('Sampled stage artwork'),author=region.getByRole('checkbox',{name:'Author sampled pose by dragging',exact:true});
  await choice.selectOption(JSON.stringify([layer.id,'direct-pick']));
  if(scenario==='merge'){
    await expect(author).toHaveCount(0);
    await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
    const saved=await read();expect(saved.layers[0].keys).toEqual(layer.keys);
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
  }
  await author.check();
  const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await settle();
  const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
    const c=el as HTMLCanvasElement,r=c.getBoundingClientRect();
    return Array.from(c.getContext('2d')!.getImageData((r.width/2+(p.x-100)*.5)*c.width/r.width,
      (r.height/2+(p.y-50)*.5)*c.height/r.height,1,1).data);
  },{x,y});
  const begin=async(move=true)=>{
    const b=(await stage.boundingBox())!,sx=scenario==='reject'?50:90;
    const start={x:b.x+b.width/2+(sx-100)*.5,y:b.y+b.height/2+(20-50)*.5};
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    if(move)await page.mouse.move(start.x+(scenario==='reject'?20:10),start.y+(scenario==='reject'?0:4));
  };
  if(scenario==='reject'){
    await begin();await page.mouse.up();
    await expect(page.getByRole('alert').filter({hasText:/tangent/i})).toBeVisible();
    await expect(choice).toBeEnabled();await expect(author).toBeChecked();expect(await read()).toEqual(p);
    await author.uncheck();await expect(region.getByLabel('Sampled stage X offset')).toHaveValue('0');
    await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
    expect((await read()).layers[0].keys).toEqual(layer.keys);
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
  }
  if(scenario==='cancel'){
    for(const cause of ['escape','pointercancel','lost','blur','resize','zoom','mode']){
      await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');await author.check();await settle();
      await begin();await expect.poll(()=>pixel(105,23)).toEqual([255,0,0,255]);
      await stage.dispatchEvent('pointermove',{pointerId:999,clientX:0,clientY:0});await stage.dispatchEvent('pointercancel',{pointerId:999});
      await expect(choice).toBeDisabled();
      if(cause==='escape')await page.keyboard.press('Escape');
      if(cause==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
      if(cause==='lost'){
        await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));
        const b=(await stage.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
      }
      if(cause==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      if(cause==='resize')await page.setViewportSize({width:1200,height:900});
      if(cause==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
      if(cause==='mode')await author.evaluate(el=>{
        (el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));
      });
      await expect(choice,cause).toBeEnabled();await page.mouse.up();expect(await read()).toEqual(p);
      await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');await settle();
      await expect.poll(()=>pixel(85,15)).toEqual([255,0,0,255]);
    }
    await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
  }
  await begin(false);await page.mouse.up();await expect(region).toBeVisible();expect(await read()).toEqual(p);
  await begin();await expect(choice).toBeDisabled();await expect(author).toBeDisabled();
  await expect.poll(()=>pixel(105,23)).toEqual([255,0,0,255]);await expect.poll(()=>pixel(85,15)).toEqual([255,255,255,255]);
  expect(await read()).toEqual(p);
  if(scenario==='frame'){
    const timeline=page.getByLabel('Timeline frames'),b=(await timeline.boundingBox())!;
    await timeline.dispatchEvent('pointerdown',{clientX:b.x+9+18*5,clientY:b.y+40,button:0,pointerId:999});
    await timeline.dispatchEvent('pointerup',{pointerId:999});
    await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');await page.mouse.up();expect(await read()).toEqual(p);
    await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();return;
  }
  if(scenario==='source'){
    await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
    await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');await page.mouse.up();
    const changed=await read();expect(changed.layers).toHaveLength(2);expect(changed.layers[0]).toEqual(layer);
    await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();
    await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
  }
  await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();
  await page.mouse.up();await expect(region).toBeHidden();
  const saved=await read(),keys=saved.layers[0].keys;
  expect(saved.layers[0].motionSpans!.map(span=>[span.start,span.end])).toEqual([[0,4],[4,8]]);
  expect([2,4,6].map(i=>[keys[i].shapes[0].x,keys[i].shapes[0].y])).toEqual([[50,14],[100,18],[130,14]]);
  expect(keys.map(key=>key.shapes[1])).toEqual(layer.keys.map(key=>key.shapes[1]));
  expect(keys[0]).toEqual(layer.keys[0]);expect(keys.slice(8)).toEqual(layer.keys.slice(8));expect(saved.duration).toBe(p.duration);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const mode of ['default','saved','invalidate','reject','merge'] as const)test('sampled root rotation preview and promotion are source-owned ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const ink:Vector={id:'rotating',kind:'rectangle',x:0,y:10,width:40,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(mode==='saved'?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear');layer.keys[8].shapes[0].x=160;
 if(mode==='merge')layer.drawingMode='merge';
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),
 cell=(frame:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*frame,y:40}});
 await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),
 angle=region.getByLabel('Sampled stage rotation',{exact:true}),preview=region.getByRole('button',{name:'Preview sampled stage rotation',exact:true}),
 commit=region.getByRole('button',{name:'Promote and rotate sampled stage pose',exact:true}),status=region.getByRole('status');
 const select=()=>choice.selectOption(JSON.stringify([layer.id,'rotating']));
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),sx=c.width/r.width,sy=c.height/r.height;
  return Array.from(c.getContext('2d')!.getImageData((r.width/2+(p.x-100)*.5)*sx,(r.height/2+(p.y-50)*.5)*sy,1,1).data);
 },{x,y});
 await select();
 if(mode==='merge'){
  await expect(angle).toHaveCount(0);await expect(commit).toHaveCount(0);expect(await read()).toEqual(p);
  await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
  expect((await read()).layers[0].motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 if(mode==='default')await region.getByLabel('Sampled stage X offset',{exact:true}).fill('');
 await angle.fill(mode==='reject'?'1e308':'90');await preview.click();
 if(mode==='reject'){
  await expect(page.getByRole('alert')).toContainText('finite rotation');await expect(status).toHaveCount(0);expect(await read()).toEqual(p);
  await commit.click();expect(await read()).toEqual(p);
  await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
  expect((await read()).layers[0].motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await expect(status).toContainText('Proposed rotation');
 await expect.poll(()=>pixel(mode==='saved'?74:100,28)).toEqual([255,0,0,255]);
 await expect.poll(()=>pixel(116,15)).toEqual([255,255,255,255]);expect(await read()).toEqual(p);
 // Presentation never replaces original pick ownership.
 await stage.click({position:{x:(await stage.boundingBox())!.width/2+8,y:(await stage.boundingBox())!.height/2-10}});
 await expect(choice).toHaveValue(JSON.stringify([layer.id,'rotating']));await expect(status).toBeVisible();
 if(mode==='invalidate'){
  await angle.fill('45');await expect(status).toHaveCount(0);await expect.poll(()=>pixel(116,15)).toEqual([255,0,0,255]);
  await angle.fill('90');await preview.click();await choice.selectOption(JSON.stringify([layer.id,'sibling']));
  await expect(status).toHaveCount(0);await expect(angle).toHaveValue('0');
  await select();await angle.fill('90');await preview.click();await cell(5);await expect(status).toHaveCount(0);
  await cell(4);await select();await angle.fill('90');await preview.click();await stage.focus();await page.keyboard.press('Escape');
  await expect(status).toHaveCount(0);expect(await read()).toEqual(p);
  await preview.click();await region.getByRole('button',{name:'Discard sampled stage proposal',exact:true}).click();await expect(status).toHaveCount(0);
  await preview.click();await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await commit.click();await expect(region).toBeHidden();
 const saved=await read(),track=saved.layers[0],joint=track.keys[4].shapes[0];
 expect(joint.rotation).toBe(90);expect(joint.x).toBeCloseTo(mode==='saved'?80:106);expect(joint.y).toBeCloseTo(mode==='saved'?10:-4);expect(joint.pivot).toEqual(ink.pivot);
 expect(track.keys[2].shapes[0].rotation).toBeCloseTo(45);expect(track.keys[6].shapes[0].rotation).toBeCloseTo(45);
 expect(track.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);expect(track.motionSpans![0].id).toBe(layer.motionSpans![0].id);
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);
 expect(track.keys[4].shapes[1]).toEqual(layer.keys[4].shapes[1]);expect(saved.duration).toBe(p.duration);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const mode of ['default','saved','css','cancel','source','frame','snap','wrap','reject'] as const)test('sampled root rotation handle owns preview and release ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const ink:Vector={id:'handle',kind:'rectangle',x:0,y:10,width:40,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(mode==='saved'?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 if(mode==='reject')for(const k of layer.keys)for(const shape of k.shapes)shape.groups=['rigid'];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',undefined,undefined,mode==='reject'?{direction:'shortest',turns:0,rigidGroups:true}:undefined);
 layer.keys[8].shapes[0].x=160;if(mode==='reject')layer.keys[8].shapes[1].x=160;
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});
 await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),
 choice=region.getByLabel('Sampled stage artwork'),rotate=region.getByRole('checkbox',{name:'Rotate sampled pose with handle',exact:true});
 await choice.selectOption(JSON.stringify([layer.id,'handle']));
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.transform='scale(.75)';});
 await rotate.check();
 const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,dpr=devicePixelRatio||1;
  return Array.from(c.getContext('2d')!.getImageData((c.width/dpr/2+(p.x-100)*.5)*dpr,(c.height/dpr/2+(p.y-50)*.5)*dpr,1,1).data);
 },{x,y});
 const position=()=>stage.evaluate((el,saved)=>{
  const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,rx=r.width/(c.width/dpr),ry=r.height/(c.height/dpr);
  return {x:r.x+r.width/2+((saved?80:100)-100)*.5*rx,y:r.y+r.height/2+((saved?10:16)-50)*.5*ry,rx,ry};
 },mode==='saved');
 const begin=async(move=true)=>{
  const c=await position();await page.mouse.move(c.x,c.y-32);await page.mouse.down();
  if(move){await page.keyboard.down('Shift');await page.mouse.move(c.x+32*c.rx/c.ry,c.y);await page.keyboard.up('Shift');}
  return c;
 };
 await begin(false);await page.mouse.up();expect(await read()).toEqual(p);await expect(region).toBeVisible();
 if(mode==='reject'){
  await begin();await expect(choice).toBeEnabled();await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText(/[Gg]roup/);expect(await read()).toEqual(p);
  await rotate.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
  await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 if(mode==='wrap'){
  const c=await begin(false);await page.keyboard.down('Shift');
  for(const degrees of [90,180,270,360]){
   const a=degrees*Math.PI/180;await page.mouse.move(c.x+32*Math.sin(a)*c.rx/c.ry,c.y-32*Math.cos(a));
  }
  await page.mouse.up();await page.keyboard.up('Shift');await expect(region).toBeVisible();expect(await read()).toEqual(p);
 }
 if(mode==='cancel'){
  for(const cause of ['escape','pointercancel','lost','blur','resize','zoom','mode','pivot']){
   await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');await rotate.check();await settle();
   const c=await begin();await expect.poll(()=>pixel(100,28)).toEqual([255,0,0,255]);
   await stage.dispatchEvent('pointermove',{pointerId:999,clientX:0,clientY:0});await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
   if(cause==='escape')await page.keyboard.press('Escape');
   if(cause==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
   if(cause==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(c.x,c.y);}
   if(cause==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   if(cause==='resize')await page.setViewportSize({width:1200,height:900});
   if(cause==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
   if(cause==='mode')await rotate.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   if(cause==='pivot')await stage.dispatchEvent('pointermove',{pointerId:1,clientX:c.x,clientY:c.y});
   await expect(choice,cause).toBeEnabled();await page.mouse.up();expect(await read()).toEqual(p);
  }
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 const center=await begin(mode!=='snap'&&mode!=='wrap');
 if(mode==='snap'||mode==='wrap'){
  await page.keyboard.down('Shift');
  for(const degrees of mode==='wrap'?[90,180,270,360,450]:[22]){
   const a=degrees*Math.PI/180;await page.mouse.move(center.x+32*Math.sin(a)*center.rx/center.ry,center.y-32*Math.cos(a));
  }
  await page.keyboard.up('Shift');
 }
 await expect(choice).toBeDisabled();expect(await read()).toEqual(p);
 if(mode!=='snap'){
  await expect.poll(()=>pixel(mode==='saved'?74:100,28)).toEqual([255,0,0,255]);await expect.poll(()=>pixel(116,20)).toEqual([255,255,255,255]);
 }
 if(mode==='source'||mode==='frame'){
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  else{
   const timeline=page.getByLabel('Timeline frames'),b=(await timeline.boundingBox())!;
   await timeline.dispatchEvent('pointerdown',{clientX:b.x+99,clientY:b.y+40,button:0,pointerId:999});await timeline.dispatchEvent('pointerup',{pointerId:999});
  }
  await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');await page.mouse.up();
  const changed=await read();expect(changed.layers[0]).toEqual(layer);
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();
  if(mode==='source'){await stage.focus();await page.keyboard.press('Control+z');}
  expect(await read()).toEqual(p);return;
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();
 // Preserve Shift at release: modifiers are sampled on every move/release.
 await page.keyboard.down('Shift');await page.mouse.up();await page.keyboard.up('Shift');await expect(region).toBeHidden();
 const saved=await read(),track=saved.layers[0],angle=mode==='snap'?15:mode==='wrap'?450:90;
 expect(track.keys[4].shapes[0].rotation).toBeCloseTo(angle);
 expect(track.keys[2].shapes[0].rotation).toBeCloseTo((angle%360)/2);expect(track.keys[6].shapes[0].rotation).toBeCloseTo(angle-(angle%360)/2);
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);
 expect(track.keys.map(k=>k.shapes[1])).toEqual(layer.keys.map(k=>k.shapes[1]));expect(saved.duration).toBe(p.duration);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const mode of ['default','saved','direct','invalidate','optin','reflection','overflow','merge'] as const)test('sampled root scale proposal is detached and atomically promoted ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const ink:Vector={id:'scale-pick',kind:'rectangle',x:0,y:10,width:40,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(mode==='saved'?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',mode==='optin'?undefined:{affine:true});layer.keys[8].shapes[0].x=160;
 if(mode==='merge')layer.drawingMode='merge';
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),
 cell=(at:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*at,y:40}});
 await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),
 choice=region.getByLabel('Sampled stage artwork'),sx=region.getByLabel('Sampled stage X scale',{exact:true}),sy=region.getByLabel('Sampled stage Y scale',{exact:true}),
 preview=region.getByRole('button',{name:'Preview sampled stage scale',exact:true}),commit=region.getByRole('button',{name:'Promote and scale sampled stage pose',exact:true}),status=region.getByRole('status');
 const select=()=>choice.selectOption(JSON.stringify([layer.id,'scale-pick']));
 await select();
 if(mode==='merge'){
  await expect(sx).toHaveCount(0);await expect(commit).toHaveCount(0);
  await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await expect(preview).toBeDisabled();await expect(commit).toBeDisabled();
 const factors=async()=>{
  await sx.fill(mode==='reflection'?'-100':mode==='overflow'?'1e308':'200');await sy.fill('150');
 };
 await factors();
 // Other unapplied commands never leak into scale or prevent it when blank.
 await region.getByLabel('Sampled stage X offset',{exact:true}).fill('');
 await region.getByLabel('Sampled stage rotation',{exact:true}).fill('');
 if(mode!=='direct')await preview.click();
 if(mode==='optin'||mode==='reflection'||mode==='overflow'){
  await expect(page.getByRole('alert')).toContainText(mode==='optin'?/enabled motion properties/:mode==='reflection'?/orientation|reflection|sign/i:/geometry|finite|scale/i);
  await expect(status).toHaveCount(0);expect(await read()).toEqual(p);await commit.click();expect(await read()).toEqual(p);
  await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();
  expect((await read()).layers[0].motionSpans!.map(s=>s.options)).toEqual([layer.motionSpans![0].options,layer.motionSpans![0].options]);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,dpr=devicePixelRatio||1;
  return Array.from(c.getContext('2d')!.getImageData((c.width/dpr/2+(p.x-100)*.5)*dpr,(c.height/dpr/2+(p.y-50)*.5)*dpr,1,1).data);
 },{x,y});
 if(mode!=='direct'){
 await expect(status).toContainText('Proposed scale');expect(await read()).toEqual(p);
 await expect.poll(()=>pixel(mode==='saved'?150:65,mode==='saved'?18:16)).toEqual([255,0,0,255]);
 await expect.poll(()=>pixel(65,35)).toEqual([255,255,255,255]);
 const b=(await stage.boundingBox())!;await stage.click({position:{x:b.width/2-17.5,y:b.height/2-17}});
 await expect(choice).toHaveValue(JSON.stringify([layer.id,'scale-pick']));await expect(status).toBeVisible();
 }else{await expect(status).toHaveCount(0);expect(await read()).toEqual(p);}
 if(mode==='invalidate'){
  await sx.fill('150');await expect(status).toHaveCount(0);await expect.poll(()=>pixel(65,16)).toEqual([255,255,255,255]);
  await factors();await preview.click();await sy.fill('50');await expect(status).toHaveCount(0);
  await factors();await preview.click();await choice.selectOption(JSON.stringify([layer.id,'sibling']));
  await expect(status).toHaveCount(0);await expect(sx).toHaveValue('100');await expect(sy).toHaveValue('100');
  await select();await factors();await preview.click();await cell(5);await expect(status).toHaveCount(0);
  await cell(4);await select();await factors();await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);
  await preview.click();await region.getByRole('button',{name:'Discard sampled stage proposal',exact:true}).click();await expect(status).toHaveCount(0);expect(await read()).toEqual(p);
  await preview.click();await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await commit.click();await expect(region).toBeHidden();
 const saved=await read(),track=saved.layers[0],joint=track.keys[4].shapes[0];
 expect(joint).toMatchObject({x:mode==='saved'?80:60,y:mode==='saved'?10:7,transform:[2,0,0,1.5]});expect(joint.pivot).toEqual(ink.pivot);
 expect(track.keys[2].shapes[0].transform).toEqual([1.5,0,0,1.25]);expect(track.keys[6].shapes[0].transform).toEqual([1.5,0,0,1.25]);
 expect(track.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);
 expect(track.keys[4].shapes[1]).toEqual(layer.keys[4].shapes[1]);expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);expect(saved.duration).toBe(p.duration);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const mode of ['default','saved','nw','ne','sw','css','proportional','cancel','source','frame','optin','reflection'] as const)test('sampled root corner scale handles guard preview and release ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const ink:Vector={id:'corner',kind:'rectangle',x:0,y:10,width:40,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(mode==='saved'?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',mode==='optin'?undefined:{affine:true});layer.keys[8].shapes[0].x=160;
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),
 tool=region.getByRole('checkbox',{name:'Scale sampled pose with handles',exact:true});
 await choice.selectOption(JSON.stringify([layer.id,'corner']));
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.transform='scale(.75)';});
 await tool.check();
 const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 await stage.evaluate(el=>{
  let start:{x:number;y:number}|undefined;
  const record=(e:Event)=>{
   const p=e as PointerEvent;if(p.pointerId!==1)return;
   if(e.type==='pointerdown')start={x:p.clientX,y:p.clientY};
   if(start)el.setAttribute('data-scale-input',JSON.stringify({start,end:{x:p.clientX,y:p.clientY},shift:p.shiftKey}));
  };
  for(const name of ['pointerdown','pointermove','pointerup'])el.addEventListener(name,record,true);
 });
 const location=()=>stage.evaluate((el,saved)=>{
  const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),d=devicePixelRatio||1;
  return {x:r.x+r.width/2+((saved?80:100)-100)*.5*r.width/(c.width/d),y:r.y+r.height/2+((saved?10:20)-50)*.5*r.height/(c.height/d),rx:r.width/(c.width/d),ry:r.height/(c.height/d)};
 },mode==='saved');
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,d=devicePixelRatio||1;
  return Array.from(c.getContext('2d')!.getImageData((c.width/d/2+(p.x-100)*.5)*d,(c.height/d/2+(p.y-50)*.5)*d,1,1).data);
 },{x,y});
 const begin=async(move=true)=>{
  const c=await location(),dx=(mode==='saved'?40:mode==='nw'||mode==='sw'?-20:20)*.5*c.rx,
  dy=(mode==='saved'?20:mode==='nw'||mode==='ne'?-10:10)*.5*c.ry;
  await page.mouse.move(c.x+dx,c.y+dy);await page.mouse.down();
  if(move){
   if(mode==='proportional')await page.keyboard.down('Shift');
   await page.mouse.move(c.x+dx*(mode==='reflection'?-1:2),c.y+dy*.5);
  }
  return c;
 };
 await begin(false);await page.mouse.up();await expect(region).toBeVisible();expect(await read()).toEqual(p);
 if(mode==='cancel'){
  for(const cause of ['escape','pointercancel','lost','blur','resize','zoom','mode']){
   await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');await tool.check();await settle();
   const c=await begin();await expect.poll(()=>pixel(80,20)).toEqual([255,0,0,255]);await expect(choice).toBeDisabled();
   await stage.dispatchEvent('pointermove',{pointerId:999,clientX:0,clientY:0});await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
   if(cause==='escape')await page.keyboard.press('Escape');
   if(cause==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
   if(cause==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(c.x,c.y);}
   if(cause==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   if(cause==='resize')await page.setViewportSize({width:1200,height:900});
   if(cause==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
   if(cause==='mode')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await expect(choice,cause).toBeEnabled();await page.mouse.up();expect(await read()).toEqual(p);
  }
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 const c=await begin();
 if(mode==='optin'||mode==='reflection'){
  await expect(choice).toBeEnabled();await page.mouse.up();await expect(page.getByRole('alert')).toContainText(mode==='optin'?/enabled motion properties/:/orientation|reflection|sign/i);expect(await read()).toEqual(p);
  await tool.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await expect(choice).toBeDisabled();expect(await read()).toEqual(p);
 await expect.poll(()=>pixel(mode==='saved'?100:80,mode==='saved'?15:20)).toEqual([255,0,0,255]);
 if(mode!=='proportional')await expect.poll(()=>pixel(mode==='saved'?120:100,45)).toEqual([255,255,255,255]);
 if(mode==='source'||mode==='frame'){
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  else{
   const timeline=page.getByLabel('Timeline frames'),b=(await timeline.boundingBox())!;await timeline.dispatchEvent('pointerdown',{clientX:b.x+99,clientY:b.y+40,button:0,pointerId:999});await timeline.dispatchEvent('pointerup',{pointerId:999});
  }
  await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');await page.mouse.up();expect((await read()).layers[0]).toEqual(layer);
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();
  if(mode==='source'){await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(p);return;
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');await expect(region).toBeHidden();
 const input=JSON.parse((await stage.getAttribute('data-scale-input'))!) as {start:{x:number;y:number};end:{x:number;y:number};shift:boolean};
 let sx=(input.end.x-c.x)/(input.start.x-c.x),sy=(input.end.y-c.y)/(input.start.y-c.y);
 if(input.shift){const size=Math.max(Math.abs(sx),Math.abs(sy));sx=Math.sign(sx||1)*size;sy=Math.sign(sy||1)*size;}
 const saved=await read(),track=saved.layers[0],joint=track.keys[4].shapes[0],px=mode==='saved'?80:100,py=mode==='saved'?10:20;
 expect(joint.x).toBeCloseTo(px+(80-px)*sx,8);expect(joint.y).toBeCloseTo(py+(10-py)*sy,8);
 expect(joint.transform![0]).toBeCloseTo(sx,8);expect(joint.transform![3]).toBeCloseTo(sy,8);expect(joint.pivot).toEqual(ink.pivot);
 expect(track.keys[2].shapes[0].transform![0]).toBeCloseTo((1+sx)/2,8);expect(track.keys[6].shapes[0].transform![3]).toBeCloseTo((1+sy)/2,8);
 expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);expect(track.keys.map(k=>k.shapes[1])).toEqual(layer.keys.map(k=>k.shapes[1]));
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);expect(saved.duration).toBe(p.duration);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const mode of ['n','e','s','w','flat-h','flat-v','css','saved','cancel','reject','optin'] as const)test('sampled root midpoint scaling preserves the orthogonal axis ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const flat=mode==='flat-h'||mode==='flat-v',vertical=mode==='n'||mode==='s'||mode==='saved'||mode==='flat-v',edge=mode==='n'?'n':mode==='w'?'w':vertical?'s':'e';
 const ink:Vector={id:'edge',kind:flat?'line':'rectangle',x:0,y:10,width:mode==='flat-v'?0:40,height:mode==='flat-h'?0:20,rotation:0,fill:'#ff0000',stroke:'#ff0000',strokeWidth:flat?2:0,points:[],...(mode==='saved'?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',mode==='optin'?undefined:{affine:true});layer.keys[8].shapes[0].x=160;
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),
 tool=region.getByRole('checkbox',{name:'Scale sampled pose with handles',exact:true});
 await choice.selectOption(JSON.stringify([layer.id,'edge']));if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.transform='scale(.75)';});await tool.check();
 const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 await stage.evaluate(el=>{
  let start:{x:number;y:number}|undefined;
  const record=(e:Event)=>{const p=e as PointerEvent;if(p.pointerId!==1)return;if(e.type==='pointerdown')start={x:p.clientX,y:p.clientY};if(start)el.setAttribute('data-axis-input',JSON.stringify({start,end:{x:p.clientX,y:p.clientY}}));};
  for(const name of ['pointerdown','pointermove','pointerup'])el.addEventListener(name,record,true);
 });
 const px=mode==='saved'||mode==='flat-v'?80:100,py=mode==='saved'||mode==='flat-h'?10:20;
 const screen=()=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),d=devicePixelRatio||1,rx=r.width/(c.width/d),ry=r.height/(c.height/d);
  return {x:r.x+r.width/2+(p.x-100)*.5*rx,y:r.y+r.height/2+(p.y-50)*.5*ry,rx,ry};
 },{x:px,y:py});
 const begin=async(move=true)=>{
  const c=await screen(),hx=vertical?(mode==='flat-v'?80:100):edge==='w'?80:120,hy=vertical?edge==='n'?10:30:mode==='flat-h'?10:20;
  const dx=(hx-px)*.5*c.rx,dy=(hy-py)*.5*c.ry;
  await page.mouse.move(c.x+dx,c.y+dy);await page.mouse.down();
  if(move){await page.keyboard.down('Shift');await page.mouse.move(vertical?c.x+60:c.x+dx*(mode==='reject'?-1:2),vertical?c.y+dy*2:c.y+40);}
  return c;
 };
 await begin(false);await page.mouse.up();expect(await read()).toEqual(p);await expect(region).toBeVisible();
 const c=await begin();
 if(mode==='reject'||mode==='optin'){
  await expect(choice).toBeEnabled();await page.mouse.up();await page.keyboard.up('Shift');
  await expect(page.getByRole('alert')).toContainText(mode==='optin'?/enabled motion properties/:/orientation|reflection|sign/i);expect(await read()).toEqual(p);
  await tool.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await expect(choice).toBeDisabled();expect(await read()).toEqual(p);
 if(!flat){
  const rgba=await stage.evaluate((el,p)=>{
   const c=el as HTMLCanvasElement,d=devicePixelRatio||1;return Array.from(c.getContext('2d')!.getImageData((c.width/d/2+(p.x-100)*.5)*d,(c.height/d/2+(p.y-50)*.5)*d,1,1).data);
  },{x:vertical?100:80,y:vertical?15:20});
  expect(rgba).toEqual([255,0,0,255]);
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='cancel'){
  await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect(await read()).toEqual(p);
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await page.mouse.up();await page.keyboard.up('Shift');await expect(region).toBeHidden();
 const input=JSON.parse((await stage.getAttribute('data-axis-input'))!)as{start:{x:number;y:number};end:{x:number;y:number}};
 const factor=vertical?(input.end.y-c.y)/(input.start.y-c.y):(input.end.x-c.x)/(input.start.x-c.x);
 const saved=await read(),track=saved.layers[0],joint=track.keys[4].shapes[0];
 expect(joint.transform![vertical?3:0]).toBeCloseTo(factor,8);expect(joint.transform![vertical?0:3]).toBe(1);
 expect(joint.x).toBeCloseTo(vertical?80:px+(80-px)*factor,8);expect(joint.y).toBeCloseTo(vertical?py+(10-py)*factor:10,8);
 expect(track.keys[2].shapes[0].transform![vertical?3:0]).toBeCloseTo((1+factor)/2,8);expect(track.keys[6].shapes[0].transform![vertical?0:3]).toBe(1);
 expect(joint.width).toBe(ink.width);expect(joint.height).toBe(ink.height);expect(joint.pivot).toEqual(ink.pivot);
 expect(track.keys.map(k=>k.shapes[1])).toEqual(layer.keys.map(k=>k.shapes[1]));expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);
 expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(saved);
});


for(const mode of ['x','y','saved-x','saved-y','direct','invalidate','optin','right-angle','overflow','merge'] as const)test('sampled root skew proposal preserves ownership and atomic promotion ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const savedPivot=mode.startsWith('saved'),axis=mode.endsWith('y')?'y':'x',h=Math.tan(Math.PI/6);
 const ink:Vector={id:'skew-pick',kind:'rectangle',x:0,y:10,width:40,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(savedPivot?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',mode==='optin'?undefined:{affine:true});layer.keys[8].shapes[0].x=160;
 if(mode==='merge')layer.drawingMode='merge';
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),
 cell=(at:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*at,y:40}});
 await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),
 skewAxis=region.getByLabel('Sampled stage skew axis',{exact:true}),angle=region.getByLabel('Sampled stage skew angle',{exact:true}),
 preview=region.getByRole('button',{name:'Preview sampled stage skew',exact:true}),commit=region.getByRole('button',{name:'Promote and skew sampled stage pose',exact:true}),status=region.getByRole('status');
 const select=()=>choice.selectOption(JSON.stringify([layer.id,'skew-pick']));
 await select();
 if(mode==='merge'){
  await expect(skewAxis).toHaveCount(0);await expect(commit).toHaveCount(0);expect(await read()).toEqual(p);
  await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await expect(preview).toBeDisabled();await expect(commit).toBeDisabled();
 const draft=async()=>{await skewAxis.selectOption(axis);await angle.fill(mode==='right-angle'?'90':mode==='overflow'?'1e308':'30');};
 await draft();
 // Unapplied transforms are independent, including blank values.
 await region.getByLabel('Sampled stage X offset',{exact:true}).fill('');await region.getByLabel('Sampled stage rotation',{exact:true}).fill('');await region.getByLabel('Sampled stage X scale',{exact:true}).fill('');
 if(mode!=='direct')await preview.click();
 if(mode==='optin'||mode==='right-angle'||mode==='overflow'){
  await expect(page.getByRole('alert')).toContainText(mode==='optin'?/enabled motion properties/:/90 degrees|finite|represented/);await expect(status).toHaveCount(0);expect(await read()).toEqual(p);
  await commit.click();expect(await read()).toEqual(p);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();
  expect((await read()).layers[0].motionSpans!.map(s=>s.options)).toEqual([layer.motionSpans![0].options,layer.motionSpans![0].options]);
  await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,d=devicePixelRatio||1;return Array.from(c.getContext('2d')!.getImageData((c.width/d/2+(p.x-100)*.5)*d,(c.height/d/2+(p.y-50)*.5)*d,1,1).data);
 },{x,y});
 if(mode!=='direct'){
  await expect(status).toContainText('Proposed skew');expect(await read()).toEqual(p);
  await expect.poll(()=>pixel(axis==='y'?115:savedPivot?125:95,axis==='y'?(savedPivot?35:32):savedPivot?26:20)).toEqual([255,0,0,255]);
  await expect.poll(()=>pixel(150,5)).toEqual([255,255,255,255]);
  const b=(await stage.boundingBox())!;await stage.click({position:{x:b.width/2+25,y:b.height/2-22.5}});await expect(choice).toHaveValue(JSON.stringify([layer.id,'skew-pick']));await expect(status).toBeVisible();
 }else{await expect(status).toHaveCount(0);expect(await read()).toEqual(p);}
 if(mode==='invalidate'){
  await angle.fill('15');await expect(status).toHaveCount(0);await draft();await preview.click();await skewAxis.selectOption('y');await expect(status).toHaveCount(0);await skewAxis.selectOption('x');await expect(status).toHaveCount(0);
  await preview.click();await choice.selectOption(JSON.stringify([layer.id,'sibling']));await expect(status).toHaveCount(0);await expect(angle).toHaveValue('0');await expect(skewAxis).toHaveValue('x');
  await select();await draft();await preview.click();await cell(5);await expect(status).toHaveCount(0);await cell(4);
  await select();await draft();await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);expect(await read()).toEqual(p);
  await preview.click();await region.getByRole('button',{name:'Discard sampled stage proposal',exact:true}).click();await expect(status).toHaveCount(0);
  await preview.click();await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await commit.click();await expect(region).toBeHidden();
 const result=await read(),track=result.layers[0],joint=track.keys[4].shapes[0];
 expect(joint.x).toBeCloseTo(80+(!savedPivot&&axis==='x'?-10*h:0),9);expect(joint.y).toBeCloseTo(10+(!savedPivot&&axis==='y'?-20*h:0),9);
 expect(joint.transform).toEqual([1,axis==='y'?h:0,axis==='x'?h:0,1]);expect(joint.pivot).toEqual(ink.pivot);
 if(axis==='x'){expect(track.keys[2].shapes[0].transform![2]).toBeCloseTo(h*.5,9);expect(track.keys[6].shapes[0].transform![2]).toBeCloseTo(h*.5,9);}
 expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);expect(track.keys[4].shapes[1]).toEqual(layer.keys[4].shapes[1]);
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);expect(result.duration).toBe(p.duration);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);
});


for(const mode of ['n','e','s','w','saved','css','snap','cancel','source','frame','optin','right-angle'] as const)test('sampled root skew handles guard original ownership and release ('+mode+')',async({page})=>{
 const p=newProject(),layer=p.layers[0];p.width=200;p.height=100;p.duration=10;
 const edge=['n','e','s','w'].includes(mode)?mode:'s',axis=edge==='e'||edge==='w'?'y':'x',savedPivot=mode==='saved';
 const ink:Vector={id:'diamond',kind:'rectangle',x:0,y:10,width:40,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(savedPivot?{pivot:{x:0,y:0}}:{})};
 layer.keys=[{frame:0,shapes:[ink,{...ink,id:'sibling',y:60}]},{frame:8,shapes:[{...ink,x:80},{...ink,id:'sibling',x:80,y:60}]},{frame:9,shapes:[]}];
 createBasicMotionSpan(p,[layer.id],0,8,'linear',mode==='optin'?undefined:{affine:true});layer.keys[8].shapes[0].x=160;
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByRole('checkbox',{name:'Skew sampled pose with handles',exact:true});
 await choice.selectOption(JSON.stringify([layer.id,'diamond']));if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.transform='scale(.75)';});await tool.check();
 const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 await stage.evaluate(el=>{
  let start:{x:number;y:number}|undefined;const record=(e:Event)=>{const p=e as PointerEvent;if(p.pointerId!==1)return;if(e.type==='pointerdown')start={x:p.clientX,y:p.clientY};if(start)el.setAttribute('data-skew-input',JSON.stringify({start,end:{x:p.clientX,y:p.clientY},shift:p.shiftKey}));};
  for(const name of ['pointerdown','pointermove','pointerup'])el.addEventListener(name,record,true);
 });
 const px=savedPivot?80:100,py=savedPivot?10:20;
 const screen=()=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),d=devicePixelRatio||1,rx=r.width/(c.width/d),ry=r.height/(c.height/d);
  return {x:r.x+r.width/2+(p.x-100)*.5*rx,y:r.y+r.height/2+(p.y-50)*.5*ry,rx,ry};
 },{x:px,y:py});
 const begin=async(move=true)=>{
  const c=await screen(),hx=edge==='e'?120:edge==='w'?80:100,hy=edge==='n'?10:edge==='s'?30:20;
  const dx=(hx-px)*.5*c.rx,dy=(hy-py)*.5*c.ry;
  await page.mouse.move(c.x+dx,c.y+dy);await page.mouse.down();
  if(move){
   const shear=mode==='snap'?Math.tan(22*Math.PI/180):mode==='right-angle'?Math.tan(85*Math.PI/180):1;
   if(mode==='snap'||mode==='right-angle')await page.keyboard.down('Shift');
   await page.mouse.move(c.x+dx+(axis==='x'?shear*(hy-py)*.5*c.rx:0),c.y+dy+(axis==='y'?shear*(hx-px)*.5*c.ry:0));
  }
  return c;
 };
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{
  const c=el as HTMLCanvasElement,d=devicePixelRatio||1;return Array.from(c.getContext('2d')!.getImageData((c.width/d/2+(p.x-100)*.5)*d,(c.height/d/2+(p.y-50)*.5)*d,1,1).data);
 },{x,y});
 await begin(false);await page.mouse.up();expect(await read()).toEqual(p);await expect(region).toBeVisible();
 if(mode==='cancel'){
  for(const cause of ['escape','pointercancel','lost','blur','resize','zoom','mode']){
   await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');await tool.check();await settle();const c=await begin();
   await expect.poll(()=>pixel(100,20)).toEqual([255,0,0,255]);expect(await read()).toEqual(p);
   await stage.dispatchEvent('pointermove',{pointerId:999,clientX:0,clientY:0});await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
   if(cause==='escape')await page.keyboard.press('Escape');
   if(cause==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
   if(cause==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(c.x,c.y);}
   if(cause==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
   if(cause==='resize')await page.setViewportSize({width:1200,height:900});
   if(cause==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
   if(cause==='mode')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
   await expect(choice,cause).toBeEnabled();await page.mouse.up();expect(await read()).toEqual(p);
  }
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 const c=await begin();
 if(mode==='optin'||mode==='right-angle'){
  await expect(choice).toBeEnabled();await page.mouse.up();await page.keyboard.up('Shift');await expect(page.getByRole('alert')).toContainText(mode==='optin'?/enabled motion properties/:/90 degrees/);expect(await read()).toEqual(p);
  await tool.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);return;
 }
 await expect(choice).toBeDisabled();expect(await read()).toEqual(p);
 if(mode!=='snap'){await expect.poll(()=>pixel(axis==='y'||savedPivot?110:100,axis==='y'?25:20)).toEqual([255,0,0,255]);await expect.poll(()=>pixel(150,5)).toEqual([255,255,255,255]);}
 if(mode==='source'||mode==='frame'){
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  else{const timeline=page.getByLabel('Timeline frames'),b=(await timeline.boundingBox())!;await timeline.dispatchEvent('pointerdown',{clientX:b.x+99,clientY:b.y+40,button:0,pointerId:999});await timeline.dispatchEvent('pointerup',{pointerId:999});}
  await expect(choice).toBeEnabled();await expect(choice).toHaveValue('');await page.mouse.up();expect((await read()).layers[0]).toEqual(layer);
  await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();if(mode==='source'){await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(p);return;
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');await expect(region).toBeHidden();
 const input=JSON.parse((await stage.getAttribute('data-skew-input'))!)as{start:{x:number;y:number};end:{x:number;y:number};shift:boolean};
 const shear=axis==='x'?(input.end.x-input.start.x)*c.ry/((input.start.y-c.y)*c.rx):(input.end.y-input.start.y)*c.rx/((input.start.x-c.x)*c.ry);
 const angle=input.shift?Math.round(Math.atan(shear)*180/Math.PI/15)*15:Math.atan(shear)*180/Math.PI,h=Math.tan(angle*Math.PI/180);
 const result=await read(),track=result.layers[0],joint=track.keys[4].shapes[0];
 expect(joint.transform![axis==='x'?2:1]).toBeCloseTo(h,8);expect(joint.transform![axis==='x'?1:2]).toBe(0);
 expect(joint.x).toBeCloseTo(80+(axis==='x'?(10-py)*h:0),8);expect(joint.y).toBeCloseTo(10+(axis==='y'?(80-px)*h:0),8);expect(joint.pivot).toEqual(ink.pivot);
 if(axis==='x'){expect(track.keys[2].shapes[0].transform![2]).toBeCloseTo(h*.5,8);expect(track.keys[6].shapes[0].transform![2]).toBeCloseTo(h*.5,8);}
 expect(track.motionSpans!.map(s=>s.options)).toEqual([{affine:true},{affine:true}]);expect(track.keys.map(k=>k.shapes[1])).toEqual(layer.keys.map(k=>k.shapes[1]));
 expect([track.keys[0],track.keys[8],track.keys[9]]).toEqual([layer.keys[0],layer.keys[8],layer.keys[9]]);expect(result.duration).toBe(p.duration);
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(p);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);
});

for(const mode of ['base','overlay','canvas','css','plain','invalid','reset','source','late','mode','offset','nested','no-drag','blocked','pending','direct']as const)test('complete sampled root groups pick preview and commit '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='blocked')p.layers.push({...newLayer('Foreground'),keys:[{frame:0,shapes:[ink('cover',80,10,'#ff00ff')]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base',cell=(at:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*at,y:40}});
 await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),groups=region.getByLabel('Select complete sampled stage groups'),choice=region.getByLabel('Sampled stage artwork'),x=region.getByLabel('Sampled stage X offset'),y=region.getByLabel('Sampled stage Y offset'),preview=region.getByRole('button',{name:'Preview sampled stage move',exact:true}),commit=region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true}),proposed=region.getByRole('status');
 await groups.check();await choice.selectOption(JSON.stringify([target,'a']));expect(await read()).toEqual(before);await expect(choice.locator('option')).toHaveCount(mode==='overlay'?7:4);await expect(region.getByLabel('Author sampled pose by dragging')).toHaveCount(0);
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*.5*devicePixelRatio,c.height/2+(p.y-50)*.5*devicePixelRatio,1,1).data];},{x,y});
 const click=async(x:number,y:number)=>{await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const box=(await stage.boundingBox())!;const size=await stage.evaluate(el=>({w:(el as HTMLCanvasElement).width/devicePixelRatio,h:(el as HTMLCanvasElement).height/devicePixelRatio}));await stage.click({position:{x:(size.w/2+(x-100)*.5)*box.width/size.w,y:(size.h/2+(y-50)*.5)*box.height/size.h}});};
 const offsets=async()=>{await x.fill('20');await y.fill('10');};
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 if(mode==='canvas'||mode==='css'){await click(135,45);await expect(choice).toHaveValue(JSON.stringify([target,'c']));await click(5,80);await expect(choice).toHaveValue('');await click(85,15);await expect(choice).toHaveValue(JSON.stringify([target,'b']));}
 if(mode==='pending'){await groups.uncheck();await choice.selectOption(JSON.stringify([target,'a']));await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const box=(await stage.boundingBox())!,size=await stage.evaluate(el=>({w:(el as HTMLCanvasElement).width/devicePixelRatio,h:(el as HTMLCanvasElement).height/devicePixelRatio}));await page.mouse.move(box.x+(size.w/2+5)*box.width/size.w,box.y+(size.h/2-17.5)*box.height/size.h);await page.mouse.down();await groups.evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();await expect(choice).toHaveValue('');await expect(choice).toBeEnabled();expect(await read()).toEqual(before);return;}
 if(mode==='blocked'){await click(85,15);await expect(choice).toHaveValue('');await click(135,45);await expect(choice).toHaveValue(JSON.stringify([target,'c']));expect(await read()).toEqual(before);return;}
 if(mode==='no-drag'){await offsets();await click(110,15);await expect(choice).toHaveValue(JSON.stringify([target,'a']));await expect(x).toHaveValue('0');expect(await read()).toEqual(before);return;}
 if(mode==='invalid'){await x.fill('5e-324');await preview.click();await expect(page.getByRole('alert')).toContainText('cannot be represented');expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 await offsets();if(mode!=='plain'&&mode!=='direct'){await preview.click();await expect(proposed).toContainText('not applied');expect(await read()).toEqual(before);await expect.poll(()=>pixel(105,25)).toEqual([255,0,0,255]);expect(await pixel(130,25)).toEqual([0,0,255,255]);expect(await pixel(155,55)).toEqual([0,255,0,255]);expect((await pixel(150,50)).slice(0,3)).not.toEqual([0,255,0]);await click(105,25);await expect(choice).not.toHaveValue('');await expect(x).toHaveValue('20');}
 if(mode==='reset'){await y.fill('11');await expect(proposed).toHaveCount(0);await offsets();await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(proposed).toHaveCount(0);await expect(choice).not.toHaveValue('');await preview.click();await cell(5);await expect(choice).toHaveValue('');await expect(region.getByRole('button',{name:'Promote sampled stage pose',exact:true})).toBeDisabled();expect(await read()).toEqual(before);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(region.getByRole('button',{name:'Promote sampled stage pose',exact:true})).toBeDisabled();await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode==='late'||mode==='mode'||mode==='offset')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='mode'){const input=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Sampled stage X offset"]')as HTMLInputElement;input.value='21';input.dispatchEvent(new Event('input',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await (mode==='plain'?region.getByRole('button',{name:'Promote sampled stage pose',exact:true}):commit).click();
 if(mode==='late'||mode==='mode'||mode==='offset'){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='mode')await expect(choice).toHaveValue('');if(mode==='offset')await expect(x).toHaveValue('21');if(mode==='late'){await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const result=await read(),actual=result.layers.find(l=>l.id===target)!;expect(actual.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8]]);expect(actual.keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(before.layers.find(l=>l.id===target)!.keys.filter(k=>[0,8,10].includes(k.frame)));expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(actual.keys[4].shapes.filter(s=>s.groups).map(s=>[s.id,s.x,s.y,s.groups,s.pivot])).toEqual(shapes.filter(s=>s.groups).map(s=>[s.id,s.x+80+(mode==='plain'?0:20),s.y+(mode==='plain'?0:10),s.groups,s.pivot]));
 for(const at of [2,6])expect(actual.keys[at].shapes.filter(s=>s.groups).map(s=>[s.id,s.x,s.y])).toEqual(shapes.filter(s=>s.groups).map(s=>[s.id,s.x+at*20+(mode==='plain'?0:10),s.y+(mode==='plain'?0:5)]));
 await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['a','b','c','overlay','css','shift','cancel','view','frame','source','offset','zero','blocked','prior','policy','late','zero-total','nested','reject']as const)
test('sampled root group offset dragging retains original ownership '+mode,async({page})=>{
 if(mode==='css')await page.setViewportSize({width:1600,height:1600});
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='blocked')p.layers.push({...newLayer('Foreground'),keys:[{frame:0,shapes:[ink('cover',80,10,'#ff00ff')]}]});

 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),groups=region.getByLabel('Select complete sampled stage groups'),dragging=region.getByLabel('Drag sampled group offsets'),choice=region.getByLabel('Sampled stage artwork'),x=region.getByLabel('Sampled stage X offset'),y=region.getByLabel('Sampled stage Y offset'),preview=region.getByRole('button',{name:'Preview sampled stage move',exact:true}),commit=region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true});
 if(mode==='policy'){await choice.selectOption(JSON.stringify([target,'a']));await region.getByLabel('Author sampled pose by dragging').check();}
 await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await dragging.check();
 await stage.evaluate(el=>{el.addEventListener('pointerdown',event=>{const e=event as PointerEvent;(el as HTMLElement).dataset.groupStart=JSON.stringify([e.clientX,e.clientY,e.pointerId]);});el.addEventListener('pointermove',event=>{const e=event as PointerEvent;(el as HTMLElement).dataset.groupEnd=JSON.stringify([e.clientX,e.clientY]);});});
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*.5*devicePixelRatio,c.height/2+(p.y-50)*.5*devicePixelRatio,1,1).data];},{x,y});
 const begin=async(member='c',dx=20,dy=10)=>{await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const box=(await stage.boundingBox())!,size=await stage.evaluate(el=>({w:(el as HTMLCanvasElement).width/devicePixelRatio,h:(el as HTMLCanvasElement).height/devicePixelRatio})),point=member==='a'?{x:110,y:15}:member==='b'?{x:85,y:15}:member==='blocked'?{x:85,y:15}:{x:135,y:45};const sx=box.x+(size.w/2+(point.x-100)*.5)*box.width/size.w,sy=box.y+(size.h/2+(point.y-50)*.5)*box.height/size.h;if(mode==='css')expect(await stage.evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,{x:sx,y:sy})).toBe(true);await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+dx*.5*box.width/size.w,sy+dy*.5*box.height/size.h,{steps:2});const delivered=await stage.evaluate(el=>({start:JSON.parse((el as HTMLElement).dataset.groupStart!),end:JSON.parse((el as HTMLElement).dataset.groupEnd!)}));return {x:(delivered.end[0]-delivered.start[0])*(size.w/box.width/.5),y:(delivered.end[1]-delivered.start[1])*(size.h/box.height/.5),id:delivered.start[2],clientX:delivered.end[0],clientY:delivered.end[1]};};
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 if(mode==='cancel'||mode==='view'){for(const action of mode==='cancel'?['escape','pointer','lost','blur','wrong','mode','drag']:['css','resize','scroll']){if(!await groups.isChecked())await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await dragging.check();await x.fill('4');await y.fill('6');await preview.click();const delivered=await begin();await expect(x).toBeDisabled();if(action==='escape')await page.keyboard.press('Escape');if(action==='pointer')await stage.dispatchEvent('pointercancel',{pointerId:delivered.id});if(action==='lost'){await stage.evaluate((el,id)=>(el as HTMLCanvasElement).releasePointerCapture(id),delivered.id);await page.mouse.move(delivered.clientX+1,delivered.clientY);}if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(action==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:delivered.id+10});await expect(x).toBeDisabled();await page.keyboard.press('Escape');}if(action==='mode')await groups.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(action==='drag')await dragging.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(action==='css')await stage.evaluate(el=>(el as HTMLCanvasElement).style.width='650px');if(action==='resize')await page.setViewportSize({width:1250,height:900});if(action==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));await page.mouse.move(delivered.clientX+1,delivered.clientY);if(action==='mode')await expect(choice).toHaveValue('');else{await expect(x,action).toBeEnabled();await expect(x).toHaveValue('4');await expect(y).toHaveValue('6');await expect(region.getByRole('status')).toContainText('not applied');}await page.mouse.up();expect(await read()).toEqual(before);}return;}
 if(mode==='prior'||mode==='zero'){await x.fill('4');await y.fill('6');await preview.click();}if(mode==='zero-total'){await x.fill('-20');await y.fill('-10');}
 if(mode==='reject')await x.fill('1.7976931348623157e+308');
 if(mode==='shift')await page.keyboard.down('Shift');
 const delivered=await begin(mode==='blocked'?'blocked':mode==='a'||mode==='b'?mode:'c',mode==='zero'?0:20,mode==='zero'?0:10);
 if(mode==='reject'){await page.mouse.up();await expect(x).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode==='blocked'){await page.mouse.up();await expect(choice).toHaveValue('');expect(await read()).toEqual(before);return;}
 if(mode==='frame'||mode==='source'||mode==='offset'||mode==='late'){
  if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='offset')await x.evaluate(el=>{(el as HTMLInputElement).value='21';el.dispatchEvent(new Event('input',{bubbles:true}));});
  if(mode==='late')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
  await page.mouse.up();if(mode==='offset'){await expect(x).toHaveValue('21');await expect(y).toHaveValue('0');}else await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='source'||mode==='late')expect((await read()).layers).toHaveLength(before.layers.length+1);return;
 }
 await expect(x).toBeDisabled();expect(await read()).toEqual(before);await page.mouse.up();if(mode==='shift')await page.keyboard.up('Shift');await expect(x).toBeEnabled();expect(await read()).toEqual(before);
 if(mode==='zero'){await expect(x).toHaveValue('4');await expect(y).toHaveValue('6');await expect(region.getByRole('status')).toContainText('not applied');return;}
 const dx=(mode==='prior'?4:mode==='zero-total'?-20:0)+delivered.x,dy=(mode==='prior'?6:mode==='zero-total'?-10:0)+(mode==='shift'?0:delivered.y);expect(Number(await x.inputValue())).toBe(dx);expect(Number(await y.inputValue())).toBe(dy);
 if(mode==='zero-total'){await expect(region.getByRole('status')).toHaveCount(0);await expect(commit).toBeDisabled();return;}
 await expect(region.getByRole('status')).toContainText('not applied');if(mode!=='css'&&mode!=='prior'){await expect.poll(()=>pixel(105,mode==='shift'?15:25)).toEqual([255,0,0,255]);expect(await pixel(155,mode==='shift'?45:55)).toEqual([0,255,0,255]);}
 await commit.click();await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4})),expected=capture.prepareGroupPromotion(target,'a',{x:dx,y:dy});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);capture.dispose();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);
});

for(const mode of ['a','b','c','overlay','css','shift','cancel','view','frame','source','offset','zero','blocked','prior','policy','late','zero-total','nested','reject','policy-change','late-policy','late-offset','late-view','late-policy-restore']as const)
test('sampled root group direct release admits one edit '+mode,async({page})=>{
 if(mode==='css')await page.setViewportSize({width:1600,height:1600});
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='blocked')p.layers.push({...newLayer('Foreground'),keys:[{frame:0,shapes:[ink('cover',80,10,'#ff00ff')]}]});

 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),groups=region.getByLabel('Select complete sampled stage groups'),dragging=region.getByLabel('Drag sampled group offsets'),choice=region.getByLabel('Sampled stage artwork'),x=region.getByLabel('Sampled stage X offset'),y=region.getByLabel('Sampled stage Y offset'),preview=region.getByRole('button',{name:'Preview sampled stage move',exact:true}),commit=region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true});
 if(mode==='policy'){await choice.selectOption(JSON.stringify([target,'a']));await region.getByLabel('Author sampled pose by dragging').check();}
 await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await dragging.check();await region.getByLabel('Author sampled group on drag release').check();
 await stage.evaluate(el=>{el.addEventListener('pointerdown',event=>{const e=event as PointerEvent;(el as HTMLElement).dataset.groupStart=JSON.stringify([e.clientX,e.clientY,e.pointerId]);});el.addEventListener('pointermove',event=>{const e=event as PointerEvent;(el as HTMLElement).dataset.groupEnd=JSON.stringify([e.clientX,e.clientY]);});});
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*.5*devicePixelRatio,c.height/2+(p.y-50)*.5*devicePixelRatio,1,1).data];},{x,y});
 const begin=async(member='c',dx=20,dy=10)=>{await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const box=(await stage.boundingBox())!,size=await stage.evaluate(el=>({w:(el as HTMLCanvasElement).width/devicePixelRatio,h:(el as HTMLCanvasElement).height/devicePixelRatio})),point=member==='a'?{x:110,y:15}:member==='b'?{x:85,y:15}:member==='blocked'?{x:85,y:15}:{x:135,y:45};const sx=box.x+(size.w/2+(point.x-100)*.5)*box.width/size.w,sy=box.y+(size.h/2+(point.y-50)*.5)*box.height/size.h;if(mode==='css')expect(await stage.evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,{x:sx,y:sy})).toBe(true);await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+dx*.5*box.width/size.w,sy+dy*.5*box.height/size.h,{steps:2});const delivered=await stage.evaluate(el=>({start:JSON.parse((el as HTMLElement).dataset.groupStart!),end:JSON.parse((el as HTMLElement).dataset.groupEnd!)}));return {x:(delivered.end[0]-delivered.start[0])*(size.w/box.width/.5),y:(delivered.end[1]-delivered.start[1])*(size.h/box.height/.5),id:delivered.start[2],clientX:delivered.end[0],clientY:delivered.end[1]};};
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 if(mode==='cancel'||mode==='view'){for(const action of mode==='cancel'?['escape','pointer','lost','blur','wrong','mode','drag']:['css','resize','scroll']){if(!await groups.isChecked())await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await dragging.check();await region.getByLabel('Author sampled group on drag release').check();await x.fill('4');await y.fill('6');await preview.click();const delivered=await begin();await expect(x).toBeDisabled();if(action==='escape')await page.keyboard.press('Escape');if(action==='pointer')await stage.dispatchEvent('pointercancel',{pointerId:delivered.id});if(action==='lost'){await stage.evaluate((el,id)=>(el as HTMLCanvasElement).releasePointerCapture(id),delivered.id);await page.mouse.move(delivered.clientX+1,delivered.clientY);}if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(action==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:delivered.id+10});await expect(x).toBeDisabled();await page.keyboard.press('Escape');}if(action==='mode')await groups.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(action==='drag')await dragging.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(action==='css')await stage.evaluate(el=>(el as HTMLCanvasElement).style.width='650px');if(action==='resize')await page.setViewportSize({width:1250,height:900});if(action==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));await page.mouse.move(delivered.clientX+1,delivered.clientY);if(action==='mode')await expect(choice).toHaveValue('');else{await expect(x,action).toBeEnabled();await expect(x).toHaveValue('4');await expect(y).toHaveValue('6');await expect(region.getByRole('status')).toContainText('not applied');}await page.mouse.up();expect(await read()).toEqual(before);}return;}
 if(mode==='prior'||mode==='zero'){await x.fill('4');await y.fill('6');await preview.click();}if(mode==='zero-total'){await x.fill('-20');await y.fill('-10');}
 if(mode==='reject')await x.fill('1.7976931348623157e+308');
 if(mode==='shift')await page.keyboard.down('Shift');
 const delivered=await begin(mode==='blocked'?'blocked':mode==='a'||mode==='b'?mode:'c',mode==='zero'?0:20,mode==='zero'?0:10);
 if(mode==='reject'){await page.mouse.up();await expect(x).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode==='blocked'){await page.mouse.up();await expect(choice).toHaveValue('');expect(await read()).toEqual(before);return;}
 if(mode==='policy-change'){await region.getByLabel('Author sampled group on drag release').evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();await expect(x).toHaveValue('0');expect(await read()).toEqual(before);return;}
 if(mode==='late-policy'||mode==='late-offset'||mode==='late-view'||mode==='late-policy-restore'){
  await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-policy'||mode==='late-policy-restore'){const input=document.querySelector('input[aria-label="Author sampled group on drag release"]')as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='late-policy-restore'){input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}}else if(mode==='late-offset'){const input=document.querySelector('input[aria-label="Sampled stage X offset"]')as HTMLInputElement;input.value='21';input.dispatchEvent(new Event('input',{bubbles:true}));}else (document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLCanvasElement).style.width='650px';}return result;})as typeof structuredClone;},mode);
  await page.mouse.up();await expect(region).toBeVisible();expect(await read()).toEqual(before);await expect(x).toHaveValue(mode==='late-offset'?'21':'0');await expect(y).toHaveValue('0');if(mode==='late-policy-restore')await expect(region.getByLabel('Author sampled group on drag release')).toBeChecked();return;
 }
 if(mode==='frame'||mode==='source'||mode==='offset'||mode==='late'){
  if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='offset')await x.evaluate(el=>{(el as HTMLInputElement).value='21';el.dispatchEvent(new Event('input',{bubbles:true}));});
  if(mode==='late')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
  await page.mouse.up();if(mode==='offset'){await expect(x).toHaveValue('21');await expect(y).toHaveValue('0');}else await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='source'||mode==='late')expect((await read()).layers).toHaveLength(before.layers.length+1);return;
 }
 await expect(x).toBeDisabled();expect(await read()).toEqual(before);if(mode!=='css'&&mode!=='prior'&&mode!=='zero'&&mode!=='zero-total'){await expect.poll(()=>pixel(105,mode==='shift'?15:25)).toEqual([255,0,0,255]);expect(await pixel(155,mode==='shift'?45:55)).toEqual([0,255,0,255]);}await page.mouse.up();if(mode==='shift')await page.keyboard.up('Shift');if(mode==='zero'||mode==='zero-total'){await expect(x).toBeEnabled();expect(await read()).toEqual(before);}
 if(mode==='zero'){await expect(x).toHaveValue('4');await expect(y).toHaveValue('6');await expect(region.getByRole('status')).toContainText('not applied');return;}
 const dx=(mode==='prior'?4:mode==='zero-total'?-20:0)+delivered.x,dy=(mode==='prior'?6:mode==='zero-total'?-10:0)+(mode==='shift'?0:delivered.y);if(mode==='zero-total'){expect(Number(await x.inputValue())).toBe(dx);expect(Number(await y.inputValue())).toBe(dy);}
 if(mode==='zero-total'){await expect(region.getByRole('status')).toHaveCount(0);await expect(commit).toBeDisabled();return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4})),expected=capture.prepareGroupPromotion(target,'a',{x:dx,y:dy});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);capture.dispose();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);
});

for(const mode of ['default','saved','overlay','nested','direct','reset','invalid','underflow','source','late-source','late-angle','late-mode','separate','css']as const)
test('sampled root group numeric rotation retains complete ownership '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,savedGroupPivots:mode==='saved'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);

 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base',cell=(f:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*f,y:40}});await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),groups=region.getByLabel('Select complete sampled stage groups'),choice=region.getByLabel('Sampled stage artwork'),angle=region.getByLabel('Sampled stage rotation',{exact:true}),preview=region.getByRole('button',{name:'Preview sampled stage rotation',exact:true}),commit=region.getByRole('button',{name:'Promote and rotate sampled stage pose',exact:true}),status=region.getByRole('status');
 await groups.check();await choice.selectOption(JSON.stringify([target,'a']));expect(await read()).toEqual(before);await expect(region.getByLabel('Rotate sampled pose with handle')).toHaveCount(0);
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*.5*devicePixelRatio,c.height/2+(p.y-50)*.5*devicePixelRatio,1,1).data];},{x,y});
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage Y offset').fill('10');}else await region.getByLabel('Sampled stage X offset').fill('');
 if(mode==='invalid')for(const value of ['', '0', '360', '-720']){await angle.fill(value);await expect(preview).toBeDisabled();await expect(commit).toBeDisabled();expect(await read()).toEqual(before);}
 await angle.fill(mode==='invalid'?'1e308':mode==='underflow'?'5e-324':'90');
 if(mode!=='direct'){await preview.click();if(mode==='invalid'||mode==='underflow'){await expect(page.getByRole('alert')).toContainText('finite rotation');await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 await expect(status).toContainText('Proposed rotation');expect(await read()).toEqual(before);await expect.poll(()=>pixel(mode==='saved'?74:126,mode==='saved'?16:6)).toEqual([255,0,0,255]);expect(await pixel(mode==='saved'?74:126,mode==='saved'?41:31)).toEqual([0,0,255,255]);expect(await pixel(mode==='saved'?44:96,mode==='saved'?66:56)).toEqual([0,255,0,255]);if(mode!=='saved')expect(await pixel(85,15)).toEqual(mode==='overlay'?[255,0,0,255]:[255,255,255,255]);
 const box=(await stage.boundingBox())!,size=await stage.evaluate(el=>({w:(el as HTMLCanvasElement).width/devicePixelRatio,h:(el as HTMLCanvasElement).height/devicePixelRatio}));await stage.click({position:{x:(size.w/2+13)*box.width/size.w,y:(size.h/2-22)*box.height/size.h}});await expect(choice).toHaveValue(JSON.stringify([target,'a']));await expect(status).toBeVisible();}
 if(mode==='reset'){await angle.fill('45');await expect(status).toHaveCount(0);await angle.fill('90');await preview.click();await choice.selectOption(JSON.stringify([target,'c']));await expect(status).toHaveCount(0);await expect(angle).toHaveValue('0');await angle.fill('90');await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await preview.click();await cell(5);await expect(choice).toHaveValue('');expect(await read()).toEqual(before);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode==='late-source'||mode==='late-angle'||mode==='late-mode')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-angle'){const input=document.querySelector('input[aria-label="Sampled stage rotation"]')as HTMLInputElement;input.value='45';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode==='late-source'||mode==='late-angle'||mode==='late-mode'){await expect(region).toBeVisible();const after=await read();expect(after.layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late-source'){expect(after.layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else expect(after).toEqual(before);if(mode==='late-angle')await expect(angle).toHaveValue('45');if(mode==='late-mode')await expect(choice).toHaveValue('');return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4})),expected=capture.prepareGroupPromotion(target,'a',undefined,90),actual=result.layers.find(l=>l.id===target)!,wanted=expected.layers.find(l=>l.id===target)!;expect(actual.keys).toEqual(wanted.keys);expect(actual.motionSpans!.map(({id:_id,...rest})=>rest)).toEqual(wanted.motionSpans!.map(({id:_id,...rest})=>rest));expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);capture.dispose();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','saved','overlay','nested','css','snap','cancel','view','frame','source','angle','zero','whole','turns','late','late-angle','late-mode']as const)
test('sampled root complete group rotation handle guards original ownership '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,savedGroupPivots:mode==='saved'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);


 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),groups=region.getByLabel('Select complete sampled stage groups'),choice=region.getByLabel('Sampled stage artwork'),rotate=region.getByLabel('Rotate sampled group with handle'),angle=region.getByLabel('Sampled stage rotation',{exact:true}),preview=region.getByRole('button',{name:'Preview sampled stage rotation',exact:true});await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await rotate.check();
 const settle=()=>stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*.5*devicePixelRatio,c.height/2+(p.y-50)*.5*devicePixelRatio,1,1).data];},{x,y});
 const position=()=>stage.evaluate((el,saved)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),rx=r.width/(c.width/devicePixelRatio),ry=r.height/(c.height/devicePixelRatio);return {x:r.x+r.width/2+((saved?80:111)-100)*.5*rx,y:r.y+r.height/2+((saved?10:31)-50)*.5*ry,rx,ry};},mode==='saved');
 await stage.evaluate(el=>{el.addEventListener('pointerdown',event=>(el as HTMLElement).dataset.handlePointer=String((event as PointerEvent).pointerId));});
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 const begin=async(degrees=90)=>{await settle();const pos=await position();await page.mouse.move(pos.x,pos.y-32);await page.mouse.down();if(degrees){await page.keyboard.down('Shift');const a=degrees*Math.PI/180;await page.mouse.move(pos.x+32*Math.sin(a)*pos.rx/pos.ry,pos.y-32*Math.cos(a));}const id=await stage.evaluate(el=>Number((el as HTMLElement).dataset.handlePointer));return {...pos,id};};
 if(mode==='cancel'||mode==='view'){
  for(const action of mode==='cancel'?['escape','pointer','lost','blur','wrong','mode','group','angle']:['css','resize','scroll']){
   if(!await groups.isChecked())await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await rotate.check();await angle.fill('30');await preview.click();await expect(region.getByRole('status')).toBeVisible();const pos=await begin();await expect(choice).toBeDisabled();
   if(action==='escape')await page.keyboard.press('Escape');if(action==='pointer')await stage.dispatchEvent('pointercancel',{pointerId:pos.id});if(action==='lost'){await stage.evaluate((el,id)=>(el as HTMLCanvasElement).releasePointerCapture(id),pos.id);await page.mouse.move(pos.x,pos.y);}if(action==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(action==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:pos.id+10});await expect(choice).toBeDisabled();await page.keyboard.press('Escape');}if(action==='mode')await rotate.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(action==='group')await groups.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(action==='angle')await angle.evaluate(el=>{(el as HTMLInputElement).value='45';el.dispatchEvent(new Event('input',{bubbles:true}));});if(action==='css')await stage.evaluate(el=>(el as HTMLCanvasElement).style.width='650px');if(action==='resize')await page.setViewportSize({width:1250,height:900});if(action==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
   await page.mouse.move(pos.x+1,pos.y);await expect(choice,action).toBeEnabled();await page.mouse.up();await page.keyboard.up('Shift');expect(await read()).toEqual(before);if(!['mode','group','angle'].includes(action)){await expect(angle).toHaveValue('30');await expect(region.getByRole('status')).toContainText('Proposed rotation');}if(action==='angle')await expect(angle).toHaveValue('45');
  }return;
 }
 if(mode==='zero'||mode==='whole')await angle.fill('');
 const pos=await begin(mode==='zero'||mode==='whole'||mode==='turns'?0:mode==='snap'?22:90);if(mode==='whole'||mode==='turns'){await page.keyboard.down('Shift');for(const degrees of mode==='whole'?[90,180,270,360]:[90,180,270,360,450]){const a=degrees*Math.PI/180;await page.mouse.move(pos.x+32*Math.sin(a)*pos.rx/pos.ry,pos.y-32*Math.cos(a));}}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);
 if(mode==='zero'||mode==='whole'){await page.mouse.up();await page.keyboard.up('Shift');await expect(region).toBeVisible();await expect(angle).toHaveValue('');expect(await read()).toEqual(before);return;}
 if(mode==='frame'||mode==='source'||mode==='angle'){if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='angle')await angle.evaluate(el=>{(el as HTMLInputElement).value='45';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.mouse.up();await page.keyboard.up('Shift');expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='angle')await expect(angle).toHaveValue('45');else await expect(choice).toHaveValue('');return;}
 if(mode==='late'||mode==='late-angle'||mode==='late-mode')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-angle'){const el=document.querySelector('input[aria-label="Sampled stage rotation"]')as HTMLInputElement;el.value='45';el.dispatchEvent(new Event('input',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Rotate sampled group with handle"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 if(mode!=='snap'){await expect.poll(()=>pixel(mode==='saved'?74:126,mode==='saved'?16:6)).toEqual([255,0,0,255]);expect(await pixel(mode==='saved'?44:96,mode==='saved'?66:56)).toEqual([0,255,0,255]);}
 const degrees=Number(await angle.inputValue());await page.mouse.up();await page.keyboard.up('Shift');
 if(mode==='late'||mode==='late-angle'||mode==='late-mode'){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late')expect((await read()).layers).toHaveLength(before.layers.length+1);else expect(await read()).toEqual(before);if(mode==='late-angle')await expect(angle).toHaveValue('45');return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();expect(degrees).toBe((mode==='snap'?1:mode==='turns'?30:6)*(15*Math.PI/180)*180/Math.PI);const result=await read();let expected:Project;
 if(mode==='turns'){
  // Keep exact equality while using Chromium's own trig for the public API oracle.
  const {build}=await import('vite'),bundle=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:'packages/animation/src/group-motion-owner.ts',formats:['es'],fileName:()=> 'root-group-oracle.js'}}});
  const chunks=(Array.isArray(bundle)?bundle:[bundle]).flatMap(r=>'output' in r?r.output:[]).filter(o=>o.type==='chunk');if(chunks.length!==1)throw Error('Expected one self-contained root group oracle.');await page.route('**/__root-group-oracle.js',r=>r.fulfill({contentType:'text/javascript',body:chunks[0].code}));
  expected=await page.evaluate(async input=>{const url='/__root-group-oracle.js',api=await import(url)as typeof import('../../packages/animation/src/group-motion-owner'),capture=api.captureRememberedGroupAuthoringFrame(()=>({project:input.before,revision:0,frame:4}));try{return capture.prepareGroupPromotion(input.target,'a',undefined,input.degrees);}finally{capture.dispose();}},{before,target,degrees});
 }else{const capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{expected=capture.prepareGroupPromotion(target,'a',undefined,degrees);}finally{capture.dispose();}}
 expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);
});

for(const mode of ['default','saved','overlay','nested','direct','x','y','reset','invalid','underflow','overflow','reflection','double','optin','source','late-source','late-factor','late-mode','separate','css']as const)
test('sampled root group numeric scaling retains complete ownership '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,savedGroupPivots:mode==='saved'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='optin')for(const layer of p.layers)for(const span of layer.motionSpans??[]){span.options={affine:false};delete span.rotation!.axisGroupScale;}


 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base',cell=(f:number)=>page.getByLabel('Timeline frames').click({position:{x:9+18*f,y:40}});await cell(4);await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),groups=region.getByLabel('Select complete sampled stage groups'),choice=region.getByLabel('Sampled stage artwork'),sx=region.getByLabel('Sampled stage X scale',{exact:true}),sy=region.getByLabel('Sampled stage Y scale',{exact:true}),preview=region.getByRole('button',{name:'Preview sampled stage scale',exact:true}),commit=region.getByRole('button',{name:'Promote and scale sampled stage pose',exact:true}),status=region.getByRole('status');
 await groups.check();await choice.selectOption(JSON.stringify([target,'a']));await expect(region.getByLabel('Scale sampled pose with handles')).toHaveCount(0);expect(await read()).toEqual(before);
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},{x,y});
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage Y offset').fill('10');await region.getByLabel('Sampled stage rotation').fill('30');}else{await region.getByLabel('Sampled stage X offset').fill('');await region.getByLabel('Sampled stage rotation').fill('');}
 if(mode==='invalid')for(const [x,y]of [['','100'],['100',''],['0','100'],['100','0'],['100','100']]){await sx.fill(x);await sy.fill(y);await expect(preview).toBeDisabled();await expect(commit).toBeDisabled();expect(await read()).toEqual(before);}
 const x=mode==='y'?100:mode==='underflow'?5e-322:mode==='overflow'?1e308:mode==='reflection'||mode==='double'?-100:200,y=mode==='x'||mode==='reflection'?100:mode==='double'?-100:50;
 await sx.fill(String(x));await sy.fill(String(y));const failed=['invalid','underflow','overflow','reflection','double','optin'].includes(mode);
 if(mode!=='direct'){await preview.click();if(failed&&mode!=='invalid'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 await expect(status).toContainText('Proposed scale');expect(await read()).toEqual(before);const pivot=mode==='saved'?{x:80,y:10}:{x:111,y:31},scaled=(a:number,b:number)=>({x:pivot.x+(a-pivot.x)*x/100,y:pivot.y+(b-pivot.y)*y/100});for(const [point,color]of [[scaled(86,16),[255,0,0,255]],[scaled(111,16),[0,0,255,255]],[scaled(136,46),[0,255,0,255]]]as const)await expect.poll(()=>pixel(point.x,point.y)).toEqual(color);
 const box=(await stage.boundingBox())!,size=await stage.evaluate(el=>({w:(el as HTMLCanvasElement).width/devicePixelRatio,h:(el as HTMLCanvasElement).height/devicePixelRatio}));await stage.click({position:{x:(size.w/2-39)*box.width/size.w,y:(size.h/2-26)*box.height/size.h}});await expect(choice).toHaveValue(JSON.stringify([target,'a']));await expect(status).toBeVisible();}
 if(mode==='reset'){await sx.fill('150');await expect(status).toHaveCount(0);await sx.fill('200');await preview.click();await choice.selectOption(JSON.stringify([target,'c']));await expect(status).toHaveCount(0);await expect(sx).toHaveValue('100');await sx.fill('200');await sy.fill('50');await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await preview.click();await cell(5);await expect(choice).toHaveValue('');expect(await read()).toEqual(before);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode==='late-source'||mode==='late-factor'||mode==='late-mode')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-factor'){const input=document.querySelector('input[aria-label="Sampled stage X scale"]')as HTMLInputElement;input.value='150';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode==='late-source'||mode==='late-factor'||mode==='late-mode'){await expect(region).toBeVisible();const after=await read();expect(after.layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late-source'){expect(after.layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else expect(after).toEqual(before);if(mode==='late-factor')await expect(sx).toHaveValue('150');if(mode==='late-mode')await expect(choice).toHaveValue('');return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4})),expected=capture.prepareGroupPromotion(target,'a',undefined,undefined,{x:x/100,y:y/100}),actual=result.layers.find(l=>l.id===target)!,wanted=expected.layers.find(l=>l.id===target)!;expect(actual.keys).toEqual(wanted.keys);expect(actual.motionSpans!.map(({id:_id,...rest})=>rest)).toEqual(wanted.motionSpans!.map(({id:_id,...rest})=>rest));expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);capture.dispose();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','nw','ne','sw','saved','overlay','nested','css','proportional','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','minimum','flat','zero','frame','source','factor','late-source','late-factor','late-mode','reflection','optin'] as const)
test('sampled root group corner scaling guards complete release '+mode,async({page})=>{
 if(mode==='css')await page.setViewportSize({width:1600,height:1600});
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 if(mode==='flat')shapes=shapes.map(s=>s.groups?{...s,kind:'line',height:0,y:10}:s);
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,savedGroupPivots:mode==='saved'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='optin')for(const layer of p.layers)for(const span of layer.motionSpans??[]){span.options={affine:false};delete span.rotation!.axisGroupScale;}



 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Scale sampled group with handles'),sx=region.getByLabel('Sampled stage X scale',{exact:true}),sy=region.getByLabel('Sampled stage Y scale',{exact:true});
 await region.getByLabel('Select complete sampled stage groups').check();await choice.selectOption(JSON.stringify([target,'a']));await tool.check();await sx.fill('');await sy.fill('');
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});
 if(mode==='flat'){await sx.fill('200');await sy.fill('150');await region.getByRole('button',{name:'Preview sampled stage scale',exact:true}).click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote and scale sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 const settle=()=>stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 await stage.evaluate(el=>{let start:{x:number;y:number}|undefined;for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId!==1)return;if(type==='pointerdown')start={x:p.clientX,y:p.clientY};if(start)el.setAttribute('data-group-scale',JSON.stringify({start,end:{x:p.clientX,y:p.clientY},shift:p.shiftKey}));},true);});
 const pos=await stage.evaluate((el,saved)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),rx=r.width/(c.width/devicePixelRatio),ry=r.height/(c.height/devicePixelRatio);return {left:r.left,top:r.top,w:c.width/devicePixelRatio,h:c.height/devicePixelRatio,cw:r.width,ch:r.height,x:r.x+r.width/2+((saved?80:111)-100)*rx,y:r.y+r.height/2+((saved?10:31)-50)*ry,rx,ry};},mode==='saved');
 const hx=mode==='nw'||mode==='sw'?80:142,hy=mode==='nw'||mode==='ne'?10:52,px=mode==='saved'?80:111,py=mode==='saved'?10:31;
 const begin=async()=>{if(mode==='css')expect(await stage.evaluate((el,p)=>document.elementFromPoint(p.x,p.y)===el,{x:pos.x+(hx-px)*pos.rx,y:pos.y+(hy-py)*pos.ry})).toBe(true);await page.mouse.move(pos.x+(hx-px)*pos.rx,pos.y+(hy-py)*pos.ry);await page.mouse.down();};
 await begin();await page.mouse.up();await expect(sx).toHaveValue('');await expect(sy).toHaveValue('');expect(await read()).toEqual(before);
 if(mode==='zero')return;
 if(mode==='prior'){await sx.fill('150');await sy.fill('150');await region.getByRole('button',{name:'Preview sampled stage scale',exact:true}).click();await expect(region.getByRole('status')).toContainText('Proposed scale');}
 await begin();if(mode==='proportional')await page.keyboard.down('Shift');await page.mouse.move(pos.x+(hx-px)*pos.rx*(mode==='reflection'?-1:mode==='minimum'?0:2),pos.y+(hy-py)*pos.ry*.5);
 if(mode==='reflection'||mode==='optin'){
  await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await tool.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);
 if(['cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','factor'].includes(mode)){
  await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
  if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
  if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}
  if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(mode==='resize')await page.setViewportSize({width:1200,height:900});
  if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  if(mode==='prior')await page.keyboard.press('Escape');
  if(mode==='cancel')await page.keyboard.press('Escape');
  if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  if(mode==='factor')await sx.evaluate(el=>{(el as HTMLInputElement).value='150';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.mouse.up();await expect(choice).toBeEnabled();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);
  if(mode==='factor')await expect(sx).toHaveValue('150');if(mode==='prior'){await expect(sx).toHaveValue('150');await expect(sy).toHaveValue('150');await expect(region.getByRole('status')).toContainText('Proposed scale');}if(mode==='cancel'){await expect(sx).toHaveValue('');await expect(sy).toHaveValue('');}expect(errors).toEqual([]);return;
 }
 if(mode==='late-source'||mode==='late-factor'||mode==='late-mode')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-factor'){const el=document.querySelector('input[aria-label="Sampled stage X scale"]')as HTMLInputElement;el.value='150';el.dispatchEvent(new Event('input',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Scale sampled group with handles"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 const input=JSON.parse((await stage.getAttribute('data-group-scale'))!)as{start:{x:number;y:number};end:{x:number;y:number};shift:boolean};
 const local=(point:{x:number;y:number})=>({x:(point.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(point.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),start=local(input.start),end=local(input.end);
 let fx=(end.x-px)/(start.x-px),fy=(end.y-py)/(start.y-py);if(input.shift){const max=Math.max(Math.abs(fx),Math.abs(fy));fx=Math.sign(fx||1)*max;fy=Math.sign(fy||1)*max;}
 // Match existing percent-field round trip; neither gesture arithmetic nor exact equality is relaxed.
 fx=(Math.sign(fx||1)*Math.max(.0001,Math.abs(fx))*100)/100;fy=(Math.sign(fy||1)*Math.max(.0001,Math.abs(fy))*100)/100;
 if(!mode.startsWith('late')&&mode!=='minimum'){
  const point={x:px+(86-px)*fx,y:py+(16-py)*fy};
  await expect.poll(()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point)).toEqual([255,0,0,255]);
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');
 if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late-source')expect((await read()).layers).toHaveLength(before.layers.length+1);else expect(await read()).toEqual(before);if(mode==='late-factor')await expect(sx).toHaveValue('150');expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();
 const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const expected=capture.prepareGroupPromotion(target,'a',undefined,undefined,{x:fx,y:fy});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(expected.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}
 expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['e','w','n','s','saved','overlay','nested','css','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','minimum','flat-h','flat-v','coincident-h','coincident-v','zero','orthogonal','frame','source','factor','late-source','late-factor','late-mode','reflection','optin'] as const)
test('sampled root group midpoint scaling preserves inactive axes '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 const horizontalFlat=mode==='flat-h'||mode==='coincident-h',verticalFlat=mode==='flat-v'||mode==='coincident-v';
 if(horizontalFlat||verticalFlat)shapes=shapes.map(s=>s.groups?{...s,kind:'line',...(horizontalFlat?{height:0,y:10}:{width:0,x:0}),stroke:s.fill,strokeWidth:2}:s);
 if(mode==='coincident-h'||mode==='coincident-v')for(const shape of shapes)if(shape.groups)shape.pivot={x:31-shape.x,y:31-shape.y};
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,savedGroupPivots:mode==='saved'||mode==='coincident-h'||mode==='coincident-v'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='optin')for(const layer of p.layers)for(const span of layer.motionSpans??[]){span.options={affine:false};delete span.rotation!.axisGroupScale;}



 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Scale sampled group with handles'),sx=region.getByLabel('Sampled stage X scale',{exact:true}),sy=region.getByLabel('Sampled stage Y scale',{exact:true});
 await region.getByLabel('Select complete sampled stage groups').check();await choice.selectOption(JSON.stringify([target,'a']));await tool.check();await sx.fill('');await sy.fill('');
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});
 const settle=()=>stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 await stage.evaluate(el=>{let start:{x:number;y:number}|undefined;for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId!==1)return;if(type==='pointerdown')start={x:p.clientX,y:p.clientY};if(start)el.setAttribute('data-group-scale',JSON.stringify({start,end:{x:p.clientX,y:p.clientY},shift:p.shiftKey}));},true);});
 const vertical=mode==='n'||mode==='s'||verticalFlat,edge=mode==='n'?'n':mode==='w'?'w':vertical?'s':'e';
 const px=mode==='saved'?80:verticalFlat&&mode!=='coincident-v'?80:111,py=mode==='saved'||horizontalFlat&&mode!=='coincident-h'?10:31;
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),rx=r.width/(c.width/devicePixelRatio),ry=r.height/(c.height/devicePixelRatio);return {left:r.left,top:r.top,w:c.width/devicePixelRatio,h:c.height/devicePixelRatio,cw:r.width,ch:r.height,x:r.x+r.width/2+(p.x-100)*rx,y:r.y+r.height/2+(p.y-50)*ry,rx,ry};},{x:px,y:py});
 const hx=vertical?verticalFlat?80:111:edge==='w'?80:142,hy=vertical?edge==='n'?10:52:horizontalFlat?10:31;
 const begin=async()=>{await page.mouse.move(pos.x+(hx-px)*pos.rx,pos.y+(hy-py)*pos.ry);await page.mouse.down();};
 await begin();await page.mouse.up();await expect(sx).toHaveValue('');await expect(sy).toHaveValue('');expect(await read()).toEqual(before);
 if(mode==='zero')return;
 if(mode==='prior'){await sx.fill('150');await sy.fill('150');await region.getByRole('button',{name:'Preview sampled stage scale',exact:true}).click();await expect(region.getByRole('status')).toContainText('Proposed scale');}
 await begin();await page.keyboard.down('Shift');
 const multiplier=mode==='reflection'?-1:mode==='minimum'?0:mode==='orthogonal'?1:2;
 await page.mouse.move(vertical?pos.x+75*pos.rx:pos.x+(hx-px)*pos.rx*multiplier,vertical?pos.y+(hy-py)*pos.ry*multiplier:pos.y+60*pos.ry);

 if(mode==='reflection'||mode==='optin'){
  await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await tool.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 await expect(choice).toBeDisabled();await expect(vertical?sx:sy).toHaveValue('100');expect(await read()).toEqual(before);
 if(['cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','factor'].includes(mode)){
  await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
  if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
  if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}
  if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(mode==='resize')await page.setViewportSize({width:1200,height:900});
  if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  if(mode==='prior')await page.keyboard.press('Escape');
  if(mode==='cancel')await page.keyboard.press('Escape');
  if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  if(mode==='factor')await sx.evaluate(el=>{(el as HTMLInputElement).value='150';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);
  if(mode==='factor')await expect(sx).toHaveValue('150');if(mode==='prior'){await expect(sx).toHaveValue('150');await expect(sy).toHaveValue('150');await expect(region.getByRole('status')).toContainText('Proposed scale');}if(mode==='cancel'){await expect(sx).toHaveValue('');await expect(sy).toHaveValue('');}expect(errors).toEqual([]);return;
 }
 if(mode==='late-source'||mode==='late-factor'||mode==='late-mode')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-factor'){const el=document.querySelector('input[aria-label="Sampled stage X scale"]')as HTMLInputElement;el.value='150';el.dispatchEvent(new Event('input',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Scale sampled group with handles"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 const input=JSON.parse((await stage.getAttribute('data-group-scale'))!)as{start:{x:number;y:number};end:{x:number;y:number};shift:boolean};
 const local=(point:{x:number;y:number})=>({x:(point.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(point.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),start=local(input.start),end=local(input.end);
 let fx=vertical?1:(end.x-px)/(start.x-px),fy=vertical?(end.y-py)/(start.y-py):1;
 // Match existing percent-field round trip; neither gesture arithmetic nor exact equality is relaxed.
 fx=(Math.sign(fx||1)*Math.max(.0001,Math.abs(fx))*100)/100;fy=(Math.sign(fy||1)*Math.max(.0001,Math.abs(fy))*100)/100;
 if(!mode.startsWith('late')&&mode!=='minimum'&&!horizontalFlat&&!verticalFlat&&mode!=='orthogonal'){
  for(const [x,y,color]of [[86,16,[255,0,0,255]],[111,16,[0,0,255,255]],[136,46,[0,255,0,255]]]as const){
   const point={x:px+(x-px)*fx,y:py+(y-py)*fy};
   await expect.poll(()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point)).toEqual(color);
  }
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');
 if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late-source')expect((await read()).layers).toHaveLength(before.layers.length+1);else expect(await read()).toEqual(before);if(mode==='late-factor')await expect(sx).toHaveValue('150');expect(errors).toEqual([]);return;}
 if(mode==='orthogonal'){await expect(region).toBeVisible();await expect(sx).toHaveValue('');await expect(sy).toHaveValue('');expect(await read()).toEqual(before);return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();
 const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const expected=capture.prepareGroupPromotion(target,'a',undefined,undefined,{x:fx,y:fy});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(expected.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}
 expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});


for(const mode of ['x','y','saved','overlay','nested','direct','css','separate','reset','invalid','right-angle','underflow','overflow','optin','group','source','late-source','late-angle','late-axis','late-mode']as const)
test('sampled root group numeric skew guards complete ownership '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,savedGroupPivots:mode==='saved'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='optin')for(const layer of p.layers)for(const span of layer.motionSpans??[]){span.options={affine:false};delete span.rotation!.axisGroupScale;delete span.rotation!.axisGroupShear;}


 if(mode==='group')for(const layer of p.layers)for(const span of layer.motionSpans!)delete span.rotation!.axisGroupShear;

 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),axis=region.getByLabel('Sampled stage skew axis',{exact:true}),angle=region.getByLabel('Sampled stage skew angle',{exact:true}),preview=region.getByRole('button',{name:'Preview sampled stage skew',exact:true}),commit=region.getByRole('button',{name:'Promote and skew sampled stage pose',exact:true}),status=region.getByRole('status');
 await region.getByLabel('Select complete sampled stage groups').check();await choice.selectOption(JSON.stringify([target,'a']));await expect(region.getByLabel('Skew sampled pose with handles')).toHaveCount(0);expect(await read()).toEqual(before);
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLCanvasElement).style.width='650px';(el as HTMLCanvasElement).style.height='260px';});
 if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage Y offset').fill('10');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage Y scale').fill('150');}else{await region.getByLabel('Sampled stage X offset').fill('');await region.getByLabel('Sampled stage rotation').fill('');await region.getByLabel('Sampled stage X scale').fill('');}
 if(mode==='invalid')for(const value of ['','0','180','-360']){await angle.fill(value);await expect(preview).toBeDisabled();await expect(commit).toBeDisabled();expect(await read()).toEqual(before);}
 const selectedAxis=mode==='y'||mode==='group'?'y':'x',degrees=mode==='right-angle'?90:mode==='underflow'?5e-324:mode==='overflow'?1e308:30;await axis.selectOption(selectedAxis);await angle.fill(String(degrees));
 const failed=['right-angle','underflow','overflow','optin','group'].includes(mode);
 if(mode!=='direct'){
  await preview.click();if(failed){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
  await expect(status).toContainText('Proposed skew');expect(await read()).toEqual(before);
  const pivot=mode==='saved'?{x:80,y:10}:{x:111,y:31},k=Math.tan(Math.PI/6);
  for(const [x,y,color]of [[86,16,[255,0,0,255]],[111,16,[0,0,255,255]],[136,46,[0,255,0,255]]]as const){const point={x:x+(selectedAxis==='x'?k*(y-pivot.y):0),y:y+(selectedAxis==='y'?k*(x-pivot.x):0)};await expect.poll(()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point)).toEqual(color);}
  const size=await stage.evaluate(el=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect();return {x:(c.width/devicePixelRatio/2-39)*r.width/(c.width/devicePixelRatio),y:(c.height/devicePixelRatio/2-26)*r.height/(c.height/devicePixelRatio)};});await stage.click({position:size});await expect(choice).toHaveValue(JSON.stringify([target,'a']));await expect(status).toBeVisible();
 }
 if(mode==='reset'){await angle.fill('15');await expect(status).toHaveCount(0);await preview.click();await axis.selectOption('y');await expect(status).toHaveCount(0);await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await preview.click();await choice.selectOption(JSON.stringify([target,'c']));await expect(status).toHaveCount(0);await expect(angle).toHaveValue('0');await angle.fill('30');await preview.click();await page.getByLabel('Timeline frames').click({position:{x:99,y:40}});await expect(choice).toHaveValue('');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(choice).toHaveValue('');await expect(status).toHaveCount(0);expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode.startsWith('late'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-angle'){const el=document.querySelector('input[aria-label="Sampled stage skew angle"]')as HTMLInputElement;el.value='15';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-axis'){const el=document.querySelector('select[aria-label="Sampled stage skew axis"]')as HTMLSelectElement;el.value='y';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else expect(await read()).toEqual(before);if(mode==='late-angle')await expect(angle).toHaveValue('15');if(mode==='late-axis')await expect(axis).toHaveValue('y');expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const expected=capture.prepareGroupPromotion(target,'a',undefined,undefined,undefined,{axis:selectedAxis,degrees});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(expected.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['e','w','n','s','saved','overlay','nested','css','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','snap','flat-h','flat-v','zero','orthogonal','frame','source','angle','axis','late-source','late-angle','late-axis','late-mode','right-angle','optin','group'] as const)
test('sampled root group diamond skew guards complete release '+mode,async({page})=>{
 const p=newProject(),track=p.layers[0];p.width=200;p.height=100;p.duration=12;track.id='base';track.drawingMode='object';
 const ink=(id:string,x:number,y:number,fill:string,groups?:string[]):Vector=>({id,kind:'rectangle',x,y,width:12,height:12,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[],pivot:{x:3,y:4},...(groups?{groups}:{})});
 let shapes=[ink('b',0,10,'#ff0000',['outer','inner']),ink('a',25,10,'#0000ff',['outer','inner']),ink('c',50,40,'#00ff00',['outer']),ink('sibling',0,75,'#ff00ff')];
 if(mode==='saved')for(const shape of shapes)if(shape.groups)shape.pivot={x:shape.id==='b'?0:shape.id==='a'?-25:-50,y:shape.id==='c'?-30:0};
 const horizontalFlat=mode==='flat-h',verticalFlat=mode==='flat-v';
 if(horizontalFlat||verticalFlat)shapes=shapes.map(s=>s.groups?{...s,kind:'line',...(horizontalFlat?{height:0,y:10}:{width:0,x:0}),stroke:s.fill,strokeWidth:2}:s);

 const child={id:'child',name:'Child',width:12,height:12,shapes:[ink('child-ink',0,0,'#ff0000')],timeline:{duration:3,keys:[{frame:1,shapes:[ink('child-ink',0,0,'#00ff00')]},{frame:2,shapes:[ink('child-ink',0,0,'#0000ff')]}]}};
 if(mode==='nested'){p.symbols=[child];shapes=shapes.map(s=>s.id==='c'?{...s,kind:'symbol',symbolId:'child',symbolPlayback:{mode:'loop',firstFrame:0}}:s);}
 track.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+(s.groups?80:0),...(s.symbolId?{symbolPlayback:{mode:'loop' as const,firstFrame:2}}:{})}))},{frame:10,shapes:[]}];
 createBasicMotionSpan(p,[track.id],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,savedGroupPivots:mode==='saved'});track.keys[8].shapes.filter(s=>s.groups).forEach(s=>s.x+=80);
 const overlay={...structuredClone(track),id:'overlay',name:'Overlay',visible:mode==='overlay'};overlay.motionSpans![0].id='overlay-recipe';p.layers.push(overlay);if(mode==='optin')for(const layer of p.layers)for(const span of layer.motionSpans??[]){span.options={affine:false};delete span.rotation!.axisGroupScale;delete span.rotation!.axisGroupShear;}



 if(mode==='group')for(const layer of p.layers)for(const span of layer.motionSpans!)delete span.rotation!.axisGroupShear;
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Skew sampled group with handles'),axisInput=region.getByLabel('Sampled stage skew axis',{exact:true}),angle=region.getByLabel('Sampled stage skew angle',{exact:true});
 await region.getByLabel('Select complete sampled stage groups').check();await choice.selectOption(JSON.stringify([target,'a']));await tool.check();await angle.fill('');
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});
 const settle=()=>stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await settle();
 await stage.evaluate(el=>{let start:{x:number;y:number}|undefined;for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId!==1)return;if(type==='pointerdown')start={x:p.clientX,y:p.clientY};if(start)el.setAttribute('data-group-scale',JSON.stringify({start,end:{x:p.clientX,y:p.clientY},shift:p.shiftKey}));},true);});
 const vertical=mode==='n'||mode==='s'||verticalFlat,edge=mode==='n'?'n':mode==='w'?'w':vertical?'s':'e';
 const px=mode==='saved'||verticalFlat?80:111,py=mode==='saved'||horizontalFlat?10:31;
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),rx=r.width/(c.width/devicePixelRatio),ry=r.height/(c.height/devicePixelRatio);return {left:r.left,top:r.top,w:c.width/devicePixelRatio,h:c.height/devicePixelRatio,cw:r.width,ch:r.height,x:r.x+r.width/2+(p.x-100)*rx,y:r.y+r.height/2+(p.y-50)*ry,rx,ry};},{x:px,y:py});
 const hx=vertical?verticalFlat?80:111:edge==='w'?80:142,hy=vertical?edge==='n'?10:52:horizontalFlat?10:31;
 const begin=async()=>{await page.mouse.move(pos.x+(hx-px)*pos.rx,pos.y+(hy-py)*pos.ry);await page.mouse.down();};
 await begin();await page.mouse.up();await expect(angle).toHaveValue('');await expect(axisInput).toHaveValue('x');expect(await read()).toEqual(before);
 if(mode==='zero')return;
 if(mode==='prior'){await angle.fill('15');await region.getByRole('button',{name:'Preview sampled stage skew',exact:true}).click();await expect(region.getByRole('status')).toContainText('Proposed skew');}
 await begin();if(mode==='snap'||mode==='right-angle')await page.keyboard.down('Shift');
 const distance=vertical?hy-py:hx-px,travel=mode==='orthogonal'?0:distance*(mode==='snap'?Math.tan(22*Math.PI/180):.5);
 if(mode==='right-angle')await stage.dispatchEvent('pointermove',{pointerId:1,clientX:pos.x+1e10,clientY:pos.y+1e10,shiftKey:true});
 else await page.mouse.move(vertical?pos.x+(hx-px+travel)*pos.rx:pos.x+(hx-px+75)*pos.rx,vertical?pos.y+(hy-py+60)*pos.ry:pos.y+(hy-py+travel)*pos.ry);
 if(mode==='right-angle'||mode==='optin'||mode==='group'){
  await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await tool.uncheck();await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 await expect(choice).toBeDisabled();await expect(axisInput).toHaveValue(vertical?'x':'y');expect(await read()).toEqual(before);
 if(['cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','angle','axis'].includes(mode)){
  await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
  if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});
  if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}
  if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(mode==='resize')await page.setViewportSize({width:1200,height:900});
  if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  if(mode==='prior')await page.keyboard.press('Escape');
  if(mode==='cancel')await page.keyboard.press('Escape');
  if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
  if(mode==='angle')await angle.evaluate(el=>{(el as HTMLInputElement).value='45';el.dispatchEvent(new Event('input',{bubbles:true}));});
  if(mode==='axis')await axisInput.evaluate(el=>{(el as HTMLSelectElement).value='x';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);
  if(mode==='angle')await expect(angle).toHaveValue('45');if(mode==='axis')await expect(axisInput).toHaveValue('x');if(mode==='prior'){await expect(angle).toHaveValue('15');await expect(region.getByRole('status')).toContainText('Proposed skew');}if(mode==='cancel'){await expect(angle).toHaveValue('');await expect(axisInput).toHaveValue('x');}expect(errors).toEqual([]);return;
 }
 if(mode==='late-source'||mode==='late-angle'||mode==='late-axis'||mode==='late-mode')await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-angle'){const el=document.querySelector('input[aria-label="Sampled stage skew angle"]')as HTMLInputElement;el.value='45';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-axis'){const el=document.querySelector('select[aria-label="Sampled stage skew axis"]')as HTMLSelectElement;el.value='x';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Skew sampled group with handles"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 const input=JSON.parse((await stage.getAttribute('data-group-scale'))!)as{start:{x:number;y:number};end:{x:number;y:number};shift:boolean};
 const local=(point:{x:number;y:number})=>({x:(point.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(point.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),start=local(input.start),end=local(input.end);
 let shear=vertical?(end.x-start.x)/(start.y-py):(end.y-start.y)/(start.x-px);
 if(input.shift){const a=Math.round(Math.atan(shear)/(Math.PI/12))*Math.PI/12;shear=Math.tan(a);}
 const degrees=Math.atan(shear)*180/Math.PI,axis=vertical?'x':'y';await expect(angle).toHaveValue(String(degrees));
 if(!mode.startsWith('late')&&!horizontalFlat&&!verticalFlat&&mode!=='orthogonal')for(const [x,y,color]of [[86,16,[255,0,0,255]],[111,18,[0,0,255,255]],[136,46,[0,255,0,255]]]as const){
  const point={x:x+(axis==='x'?Math.tan(degrees*Math.PI/180)*(y-py):0),y:y+(axis==='y'?Math.tan(degrees*Math.PI/180)*(x-px):0)};
  await expect.poll(()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point)).toEqual(color);
 }
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');
 if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id==='base'||l.id==='overlay')).toEqual(before.layers);if(mode==='late-source')expect((await read()).layers).toHaveLength(before.layers.length+1);else expect(await read()).toEqual(before);if(mode==='late-angle')await expect(angle).toHaveValue('45');if(mode==='late-axis')await expect(axisInput).toHaveValue('x');expect(errors).toEqual([]);return;}
 if(mode==='orthogonal'){await expect(region).toBeVisible();await expect(angle).toHaveValue('');await expect(axisInput).toHaveValue('x');expect(await read()).toEqual(before);return;}
 await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();
 const result=await read(),capture=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const expected=capture.prepareGroupPromotion(target,'a',undefined,undefined,undefined,{axis,degrees});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(expected.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}
 expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','overlay','group','fixed','movie','held','endpoint','blank','edited','later','hidden','unused','move','commit','pending','close','frame','mode','source','optout']as const)
test('main sampled stage remembers child artwork with guarded publication '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const ink=(id:string,x:number,y:number,fill:string):Vector=>({id,kind:'rectangle',x,y,width:8,height:8,rotation:0,fill,stroke:'#000000',strokeWidth:0,points:[]});
 const cp=newProject();cp.duration=12;const cl=cp.layers[0];cl.id='child-base';cl.keys=[{frame:0,shapes:[ink('ink',0,0,'#ff0000')]},{frame:8,shapes:[ink('ink',40,0,'#ff0000')]},{frame:10,shapes:[]}];createBasicMotionSpan(cp,[cl.id],0,8,'linear');const childOverlay={...structuredClone(cl),id:'child-overlay'};childOverlay.keys=childOverlay.keys.filter(k=>[0,8,10].includes(k.frame));delete childOverlay.motionSpans;for(const key of childOverlay.keys)for(const shape of key.shapes){shape.fill='#0000ff';shape.y=15;}cp.layers.push(childOverlay);createBasicMotionSpan(cp,[childOverlay.id],0,8,'linear');cl.keys[8].shapes[0].x=80;childOverlay.keys[8].shapes[0].x=120;
 if(mode==='edited')cl.keys[1].shapes[0].x++;if(mode==='later'||mode==='hidden')childOverlay.keys[1].shapes[0].x++;if(mode==='hidden')childOverlay.visible=false;
 const child={id:'child',name:'Child',width:100,height:30,shapes:cl.keys[0].shapes,timeline:{duration:12,keys:cl.keys.slice(1),motionSpans:cl.motionSpans,layers:[childOverlay]}};p.symbols=[child];if(mode==='unused'){const unused=structuredClone(child);unused.id='unused';unused.timeline.keys[0].shapes[0].x++;p.symbols.push(unused);}
 const playback={mode:mode==='movie'?'movie' as const:mode==='fixed'?'single' as const:'loop' as const,firstFrame:mode==='fixed'?2:0};
 const instance:Vector={...ink('instance',0,10,'#ff0000'),kind:'symbol',symbolId:'child',width:100,height:30,symbolPlayback:playback,groups:['outer']},other={...structuredClone(instance),id:'other',x:40,y:45};
 const root=p.layers[0];root.id='root';root.drawingMode='object';root.keys=[{frame:0,shapes:[instance,other]},{frame:8,shapes:[{...structuredClone(instance),x:40},{...structuredClone(other),x:80}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['root'],0,8,'linear',undefined,undefined,{direction:'shortest',turns:0,rigidGroups:true});root.keys[8].shapes.forEach(s=>s.x+=40);
 if(mode==='overlay'){const overlay={...structuredClone(root),id:'root-overlay'};overlay.motionSpans![0].id='root-overlay-motion';p.layers.push(overlay);root.visible=false;}
 const delayed=['pending','close','frame','mode','source','optout'].includes(mode);
 await page.addInitScript(({project,delayed})=>{localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null}));if(delayed){const original=window.setTimeout.bind(window);window.setTimeout=((handler:TimerHandler,timeout?:number,...args:unknown[])=>original(handler,timeout===0?250:timeout,...args))as typeof window.setTimeout;}},{project:p,delayed});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();
 const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),at=mode==='held'?9:mode==='endpoint'?8:mode==='blank'?10:4,target=mode==='overlay'?'root-overlay':'root';
 await page.getByLabel('Timeline frames').click({position:{x:9+18*at,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),toggle=region.getByLabel('Remember sampled stage children'),choice=region.getByLabel('Sampled stage artwork'),status=region.getByRole('status');
 const pixel=(x:number,y:number)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},{x,y});
 if(mode==='group'||mode==='move'||mode==='commit')await region.getByLabel('Select complete sampled stage groups').check();await toggle.check();
 if(delayed){await expect(status).toContainText('Preparing remembered child');await expect(choice).toBeDisabled();await expect(choice.locator('option')).toHaveCount(1);expect(await pixel(84,14)).toEqual([255,255,255,255]);
  if(mode==='close'){await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await expect(region).toBeHidden();await page.waitForTimeout(700);await expect(region).toBeHidden();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
  if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).click();
  if(mode==='mode')await region.getByLabel('Select complete sampled stage groups').check();
  if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).click();
  if(mode==='optout'){await toggle.uncheck();await expect(status).toHaveCount(0);await page.waitForTimeout(700);await expect(status).toHaveCount(0);await expect(toggle).not.toBeChecked();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 }
 if(mode==='edited'||mode==='later'){await expect(region.getByRole('alert')).toBeVisible();await expect(choice).toBeDisabled();await expect(choice.locator('option')).toHaveCount(1);expect(await pixel(84,14)).toEqual([255,255,255,255]);expect(await read()).toEqual(before);await toggle.uncheck();await expect(region.getByRole('alert')).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toHaveCount(0);await expect.poll(async()=>({disabled:await choice.isDisabled(),errors,alert:await region.getByRole('alert').allTextContents()})).toEqual({disabled:false,errors:[],alert:[]});
 const x=mode==='held'?94:mode==='endpoint'?84:mode==='fixed'?64:mode==='movie'?44:mode==='frame'?104:84;
 if(mode==='blank'){expect(await pixel(84,14)).toEqual([255,255,255,255]);expect(await choice.locator('option').count()).toBe(1);}else{await expect.poll(()=>pixel(x,14)).toEqual([255,0,0,255]);if(mode!=='hidden')await expect.poll(()=>pixel(mode==='held'?99:mode==='endpoint'?84:mode==='fixed'?74:mode==='movie'?44:mode==='frame'?129:104,29)).toEqual([0,0,255,255]);}
 if(mode==='source'){const result=await read();expect(result.layers.filter(l=>l.id==='root')).toEqual(before.layers);expect(result.layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='move'||mode==='commit'){
  await choice.selectOption(JSON.stringify([target,'instance']));await region.getByLabel('Sampled stage X offset').fill('10');await region.getByRole('button',{name:'Preview sampled stage move',exact:true}).click();await expect(status).toContainText('Proposed move');await expect.poll(()=>pixel(94,14)).toEqual([255,0,0,255]);expect(await read()).toEqual(before);
  if(mode==='commit'){await region.getByRole('button',{name:'Promote and move sampled stage pose',exact:true}).click();await expect(region).toBeHidden();const result=await read(),owner=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const expected=owner.prepareGroupPromotion(target,'instance',{x:10,y:0});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(expected.layers.find(l=>l.id===target)!.keys);}finally{owner.dispose();}expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);return;}
  await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await expect.poll(()=>pixel(84,14)).toEqual([255,0,0,255]);
 }
 expect(await read()).toEqual(before);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);
});

for(const mode of ['default','affine','reflected','overlay','direct','nodes-off','overflow','invalid','reset','group','source','late-source','late-target','late-node','late-group','children','separate']as const)
test('sampled root numeric node authoring retains original ownership '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:20}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),nx=region.getByLabel('Sampled node document X'),ny=region.getByLabel('Sampled node document Y'),preview=region.getByRole('button',{name:'Preview sampled node position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled node',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}
 await choice.selectOption(JSON.stringify([target,'curve']));await expect(commit).toBeDisabled();await number.fill('2');await number.press('Tab');await expect(commit).toBeDisabled();expect(await read()).toEqual(before);
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],point=worldPoint(original,{x:14,y:15}),probe=worldPoint(original,{x:10,y:5});cap.dispose();
 await expect(nx).toHaveValue(String(worldPoint(original,original.nodes![1]).x));
 const pixel=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},probe);
 await expect.poll(pixel).toEqual([255,0,0,255]);
 if(mode==='invalid'){await nx.fill('');await expect(preview).toBeDisabled();await ny.fill('');await expect(commit).toBeDisabled();await number.fill('99');await number.press('Tab');await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await number.fill('2');await number.press('Tab');}
 if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}
 await nx.fill(String(mode==='overflow'?1e308:point.x));await ny.fill(String(point.y));
 if(mode!=='direct'){await preview.click();if(mode==='nodes-off'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed node');await expect.poll(pixel).toEqual([255,255,255,255]);expect(await read()).toEqual(before);}
 if(mode==='reset'){await nx.fill(String(point.x+1));await expect(status).toHaveCount(0);await nx.fill(String(point.x));await preview.click();await number.fill('1');await number.press('Tab');await expect(status).toHaveCount(0);await number.fill('2');await number.press('Tab');await nx.fill(String(point.x));await ny.fill(String(point.y));await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await preview.click();await page.getByRole('button',{name:'Next frame',exact:true}).click();await expect(choice).toHaveValue('');await expect(number).toHaveCount(0);expect(await read()).toEqual(before);return;}
 if(mode==='group'){await region.getByLabel('Select complete sampled stage groups').check();await expect(number).toHaveCount(0);await expect(status).toHaveCount(0);expect(await read()).toEqual(before);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode.startsWith('late'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-target'){const el=document.querySelector('input[aria-label="Sampled node document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-node'){const el=document.querySelector('input[aria-label="Sampled Bezier node number"]')as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else expect(await read()).toEqual(before);if(mode==='late-target')await expect(nx).toHaveValue('111');expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareNodePosition(target,'curve',1,point);expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}expect(result.symbols).toEqual(before.symbols);expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});


for(const mode of ['default','affine','reflected','overlay','css','shift','zero','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','group','nodes-off','children','late-source']as const)
test('sampled root node canvas drag preserves original capture '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:20}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}

 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),nx=region.getByLabel('Sampled node document X'),ny=region.getByLabel('Sampled node document Y'),tool=region.getByLabel('Drag sampled Bezier nodes'),commit=region.getByRole('button',{name:'Promote and position sampled node',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));await tool.check();
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.nodes![1]);cap.dispose();
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});
 const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 const start=async()=>{await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.down();};
 await start();await page.mouse.up();await expect(number).toHaveValue('2');await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await read()).toEqual(before);await expect(commit).toBeDisabled();if(mode==='zero')return;
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled node position',exact:true}).click();await expect(status).toContainText('Proposed node');}
 await start();await expect(choice).toBeDisabled();if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 await page.mouse.move(pos.x+6*pos.rx,pos.y+16*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='nodes-off'){expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);await expect(status).toHaveCount(0);if(mode!=='affine'&&mode!=='reflected')await expect.poll(()=>pixel({x:89,y:16})).toEqual([255,255,255,255]);
 await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(['cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','group'].includes(mode)){
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(choice).toBeEnabled();await page.mouse.up();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed node');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}
  if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},end=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(end);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed node');await expect(nx).toHaveValue(String(point.x));await expect(ny).toHaveValue(String(point.y));expect(await read()).toEqual(before);
 await commit.click();await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareNodePosition(target,'curve',1,point);expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);}finally{capture.dispose();}expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','affine','reflected','overlay','css','shift','zero','cancel','pointercancel','lost','blur','resize','scroll','policy','author-policy','prior','frame','source','target','node','group','nodes-off','children','late-source','release-source','release-target','release-node','release-policy','release-policy-restore','release-view']as const)
test('sampled root node direct release guards fresh authoring '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0},{x:10,y:0},{x:20,y:20}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}

 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),nx=region.getByLabel('Sampled node document X'),ny=region.getByLabel('Sampled node document Y'),tool=region.getByLabel('Drag sampled Bezier nodes'),commit=region.getByRole('button',{name:'Promote and position sampled node',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));await tool.check();await region.getByLabel('Author sampled node on drag release').check();
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.nodes![1]);cap.dispose();
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});
 const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 const start=async()=>{await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.down();};
 await start();await page.mouse.up();await expect(number).toHaveValue('2');await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await read()).toEqual(before);await expect(commit).toBeDisabled();if(mode==='zero')return;
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled node position',exact:true}).click();await expect(status).toContainText('Proposed node');}
 await start();await expect(choice).toBeDisabled();if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 await page.mouse.move(pos.x+6*pos.rx,pos.y+16*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='nodes-off'){expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);await expect(status).toHaveCount(0);if(mode!=='affine'&&mode!=='reflected')await expect.poll(()=>pixel({x:89,y:16})).toEqual([255,255,255,255]);
 await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(['cancel','pointercancel','lost','blur','resize','scroll','policy','author-policy','prior','frame','source','target','node','group'].includes(mode)){
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='author-policy')await region.getByLabel('Author sampled node on drag release').evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(choice).toBeEnabled();await page.mouse.up();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed node');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}
  if(mode==='author-policy'){await expect(region.getByLabel('Author sampled node on drag release')).not.toBeChecked();await start();await page.mouse.move(pos.x+6*pos.rx,pos.y+16*pos.ry);await page.mouse.up();await expect(region).toBeVisible();await expect(status).toContainText('Proposed node');expect(await read()).toEqual(before);}if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},end=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(end);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 if(mode.startsWith('release-'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;
   if(mode==='release-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();
   if(mode==='release-target'){const el=document.querySelector('input[aria-label="Sampled node document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}
   if(mode==='release-node'){const el=document.querySelector('input[aria-label="Sampled Bezier node number"]')as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}
   if(mode==='release-policy'||mode==='release-policy-restore'){const el=document.querySelector('input[aria-label="Author sampled node on drag release"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='release-policy-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}
   if(mode==='release-view')(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLCanvasElement).style.width='700px';
  }return result;})as typeof structuredClone;},mode);
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');
 if(mode.startsWith('release-')){await expect(region).toBeVisible();if(mode==='release-policy-restore')await expect(region.getByLabel('Author sampled node on drag release')).toBeChecked();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='release-target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}if(mode==='release-node')await expect(number).toHaveValue('1');if(mode==='release-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareNodePosition(target,'curve',1,point);expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);}finally{capture.dispose();}expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['in','out','missing','affine','reflected','overlay','direct','nodes-off','curve-guard','overflow','invalid','reset','group','source','late-source','late-target','late-node','late-part','late-group','children','separate']as const)
test('sampled root numeric tangent authoring retains original ownership '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0,in:{x:-2,y:2},out:{x:2,y:0}},{x:10,y:0,in:{x:8,y:0},out:{x:12,y:0}},{x:20,y:20,in:{x:18,y:18},out:{x:18,y:22}}]};
 if(mode==='missing')delete ink.nodes![0].in;
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,curveTangents:mode==='curve-guard'});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),role=region.getByLabel('Sampled Bezier tangent role'),nx=region.getByLabel('Sampled tangent document X'),ny=region.getByLabel('Sampled tangent document Y'),preview=region.getByRole('button',{name:'Preview sampled tangent position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled tangent',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}
 await choice.selectOption(JSON.stringify([target,'curve']));await number.fill('2');await number.press('Tab');await expect(commit).toBeDisabled();const part=mode==='out'||mode==='late-part'?'out':'in';await role.selectOption(part);await expect(commit).toBeDisabled();expect(await read()).toEqual(before);
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],point=worldPoint(original,mode==='curve-guard'?original.nodes![1]:{x:part==='in'?6:16,y:30}),probe=worldPoint(original,part==='in'?{x:5,y:3}:{x:14,y:11});cap.dispose();
 await expect(nx).toHaveValue(String(worldPoint(original,original.nodes![1][part]!).x));
 const pixel=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},probe);
 await expect.poll(pixel).toEqual([255,0,0,255]);if(mode==='missing'){await number.fill('1');await number.press('Tab');await expect(role.locator('option')).toHaveText(['Choose original handle','Outgoing']);await role.evaluate(el=>{const select=el as HTMLSelectElement;select.add(new Option('Forged incoming','in'));select.value='in';select.dispatchEvent(new Event('change',{bubbles:true}));});await expect(commit).toBeDisabled();await expect(preview).toBeDisabled();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='invalid'){await nx.fill('');await expect(preview).toBeDisabled();await ny.fill('');await expect(commit).toBeDisabled();await number.fill('99');await number.press('Tab');await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await number.fill('2');await number.press('Tab');await role.selectOption(part);}
 if(mode==='separate'){await region.getByLabel('Sampled node document X').fill('99');await region.getByLabel('Sampled node document Y').fill('44');await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}
 await nx.fill(String(mode==='overflow'?1e308:point.x));await ny.fill(String(point.y));
 if(mode!=='direct'){await preview.click();if(mode==='nodes-off'||mode==='curve-guard'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed tangent');await expect.poll(pixel).toEqual([255,255,255,255]);expect(await read()).toEqual(before);}
 if(mode==='reset'){await nx.fill(String(point.x+1));await expect(status).toHaveCount(0);await nx.fill(String(point.x));await preview.click();await number.fill('1');await number.press('Tab');await expect(status).toHaveCount(0);await number.fill('2');await number.press('Tab');await role.selectOption(part);await nx.fill(String(point.x));await ny.fill(String(point.y));await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await preview.click();await page.getByRole('button',{name:'Next frame',exact:true}).click();await expect(choice).toHaveValue('');await expect(number).toHaveCount(0);expect(await read()).toEqual(before);return;}
 if(mode==='group'){await region.getByLabel('Select complete sampled stage groups').check();await expect(number).toHaveCount(0);await expect(status).toHaveCount(0);expect(await read()).toEqual(before);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode.startsWith('late'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-target'){const el=document.querySelector('input[aria-label="Sampled tangent document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-node'){const el=document.querySelector('input[aria-label="Sampled Bezier node number"]')as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='late-part'){const el=document.querySelector('select[aria-label="Sampled Bezier tangent role"]')as HTMLSelectElement;el.value='in';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else expect(await read()).toEqual(before);if(mode==='late-target')await expect(nx).toHaveValue('111');if(mode==='late-part')await expect(role).toHaveValue('in');expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareTangentPosition(target,'curve',1,part,point);expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}expect(result.symbols).toEqual(before.symbols);expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','out','retained','part','affine','reflected','overlay','css','shift','zero','return','foreground','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','group','nodes-off','children','late-source']as const)
test('sampled root tangent canvas drafts preserve original capture '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0,in:{x:-2,y:2},out:{x:2,y:0}},{x:10,y:0,in:{x:0,y:0},out:{x:20,y:0}},{x:20,y:20,in:{x:18,y:18},out:{x:18,y:22}}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}

 if(mode==='foreground'){const foreground={...structuredClone(layer),id:'foreground',motionSpans:undefined,keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle' as const,x:78,y:8,width:8,height:8,rotation:0,fill:'#00ff00',stroke:'#000000',strokeWidth:0,points:[]}]}]};p.layers.push(foreground);}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),role=region.getByLabel('Sampled Bezier tangent role'),nx=region.getByLabel('Sampled tangent document X'),ny=region.getByLabel('Sampled tangent document Y'),tool=region.getByLabel('Drag sampled Bezier tangents'),commit=region.getByRole('button',{name:'Promote and position sampled tangent',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));await number.fill('2');await number.press('Tab');if(mode==='retained'){await region.getByLabel('Drag sampled Bezier nodes').check();await region.getByLabel('Author sampled node on drag release').check();}await tool.check();const part=mode==='out'?'out':'in';
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.nodes![1][part]!);cap.dispose();
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});
 const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 const start=async()=>{await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.down();};
 await start();await page.mouse.up();if(mode==='foreground'){await expect(role).toHaveValue('');await expect(commit).toBeDisabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(number).toHaveValue('2');await expect(role).toHaveValue(part);await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await read()).toEqual(before);await expect(commit).toBeDisabled();if(mode==='zero')return;
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled tangent position',exact:true}).click();await expect(status).toContainText('Proposed tangent');}
 await start();await expect(choice).toBeDisabled();if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 await page.mouse.move(pos.x+6*pos.rx,pos.y+30*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='nodes-off'){expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);await expect(status).toHaveCount(0);if(mode!=='affine'&&mode!=='reflected')await expect.poll(()=>pixel(worldPoint(shape,part==='in'?{x:5,y:3}:{x:14,y:5}))).toEqual([255,255,255,255]);
 await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return'){await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.up();}
 if(['return','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','part','group'].includes(mode)){
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='part')await role.evaluate(el=>{const select=el as HTMLSelectElement;select.value=select.value==='in'?'out':'in';select.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(choice).toBeEnabled();await page.mouse.up();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='part')await expect(role).toHaveValue(part==='in'?'out':'in');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed tangent');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}
  if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},end=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(end);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed tangent');await expect(nx).toHaveValue(String(point.x));await expect(ny).toHaveValue(String(point.y));expect(await read()).toEqual(before);
 await commit.click();await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareTangentPosition(target,'curve',1,part,point);expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);}finally{capture.dispose();}expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','out','part','affine','reflected','overlay','css','shift','zero','return','cancel','pointercancel','lost','blur','resize','scroll','policy','author-policy','prior','frame','source','target','node','group','nodes-off','curve-guard','children','late-source','release-source','release-target','release-node','release-part','release-policy','release-policy-restore','release-view']as const)
test('sampled root tangent direct release guards fresh authoring '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0,in:{x:-2,y:2},out:{x:2,y:0}},{x:10,y:0,in:{x:0,y:0},out:{x:20,y:0}},{x:20,y:20,in:{x:18,y:18},out:{x:18,y:22}}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,curveTangents:mode==='curve-guard'});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}


 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),role=region.getByLabel('Sampled Bezier tangent role'),nx=region.getByLabel('Sampled tangent document X'),ny=region.getByLabel('Sampled tangent document Y'),tool=region.getByLabel('Drag sampled Bezier tangents'),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));await number.fill('2');await number.press('Tab');await tool.check();await region.getByLabel('Author sampled tangent on drag release').check();const part=mode==='out'?'out':'in';
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.nodes![1][part]!);cap.dispose();
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});
 const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 const start=async()=>{await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.down();};
 await start();await page.mouse.up();await expect(number).toHaveValue('2');await expect(role).toHaveValue(part);await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await read()).toEqual(before);await expect(region.getByRole('button',{name:'Promote and position sampled tangent',exact:true})).toBeDisabled();if(mode==='zero')return;
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled tangent position',exact:true}).click();await expect(status).toContainText('Proposed tangent');}
 await start();await expect(choice).toBeDisabled();if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 await page.mouse.move(pos.x+(mode==='curve-guard'?12:6)*pos.rx,pos.y+(mode==='curve-guard'?1:30)*pos.ry);
 if(mode==='nodes-off'||mode==='curve-guard'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='nodes-off'||mode==='curve-guard'){expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);await expect(status).toHaveCount(0);if(mode!=='affine'&&mode!=='reflected')await expect.poll(()=>pixel(worldPoint(shape,part==='in'?{x:5,y:3}:{x:14,y:5}))).toEqual([255,255,255,255]);
 await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return'){await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.up();}
 if(['return','author-policy','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','part','group'].includes(mode)){
  if(mode==='author-policy')await region.getByLabel('Author sampled tangent on drag release').evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='part')await role.evaluate(el=>{const select=el as HTMLSelectElement;select.value=select.value==='in'?'out':'in';select.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(choice).toBeEnabled();await page.mouse.up();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='part')await expect(role).toHaveValue(part==='in'?'out':'in');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed tangent');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}
  if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);if(mode==='author-policy'){await expect(region.getByLabel('Author sampled tangent on drag release')).not.toBeChecked();await start();await page.mouse.move(pos.x+6*pos.rx,pos.y+30*pos.ry);await page.mouse.up();await expect(region).toBeVisible();await expect(status).toContainText('Proposed tangent');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;
 }
 if(mode.startsWith('release-'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)&&!document.querySelector('canvas[aria-label="Drawing stage"]')?.hasPointerCapture(1)){window.structuredClone=original;if(mode==='release-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='release-target'){const el=document.querySelector('input[aria-label="Sampled tangent document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='release-node'){const el=document.querySelector('input[aria-label="Sampled Bezier node number"]')as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-part'){const el=document.querySelector('select[aria-label="Sampled Bezier tangent role"]')as HTMLSelectElement;el.value=el.value==='in'?'out':'in';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-view'){(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).style.width='700px';}else{const el=document.querySelector('input[aria-label="Author sampled tangent on drag release"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='release-policy-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},end=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(end);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');
 if(mode.startsWith('release-')){await expect(region).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='release-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}else{expect(await read()).toEqual(before);if(mode==='release-target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}if(mode==='release-node')await expect(number).toHaveValue('1');if(mode==='release-part')await expect(role).toHaveValue(part==='in'?'out':'in');if(mode==='release-policy-restore')await expect(region.getByLabel('Author sampled tangent on drag release')).toBeChecked();}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareTangentPosition(target,'curve',1,part,point);expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));}finally{capture.dispose();}expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['in','out','missing','affine','reflected','overlay','direct','nodes-off','curve-guard','overflow','invalid','reset','group','source','late-source','late-target','late-node','late-part','late-group','children','separate','mode','late-mode','late-restore','retained','capture-mode','preview-restore']as const)
test('sampled root numeric coupled tangents retain paired ownership '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0,in:{x:-2,y:2},out:{x:2,y:0}},{x:10,y:0,in:{x:8,y:0},out:{x:12,y:0}},{x:20,y:20,in:{x:18,y:18},out:{x:18,y:22}}]};
 if(mode==='missing')delete ink.nodes![0].in;
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,curveTangents:mode==='curve-guard'});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),role=region.getByLabel('Sampled Bezier tangent role'),nx=region.getByLabel('Sampled tangent document X'),ny=region.getByLabel('Sampled tangent document Y'),preview=region.getByRole('button',{name:'Preview sampled tangent position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled tangent',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}
 await choice.selectOption(JSON.stringify([target,'curve']));await number.fill('2');await number.press('Tab');await expect(commit).toBeDisabled();const part=mode==='out'||mode==='late-part'?'out':'in';await role.selectOption(part);await expect(commit).toBeDisabled();expect(await read()).toEqual(before);
 const coupling=region.getByLabel('Couple sampled tangent handles');await expect(coupling).not.toBeChecked();if(mode==='retained'){await region.getByLabel('Drag sampled Bezier tangents').check();await region.getByLabel('Author sampled tangent on drag release').check();}if(mode==='capture-mode'){await region.getByLabel('Drag sampled Bezier tangents').check();await region.getByLabel('Author sampled tangent on drag release').check();await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const pos=await stage.evaluate(el=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {x:r.left+(w/2+88-100)*r.width/w,y:r.top+(h/2+10-50)*r.height/h,rx:r.width/w,ry:r.height/h};});await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.mouse.move(pos.x+6*pos.rx,pos.y+20*pos.ry);await expect.poll(()=>stage.evaluate(el=>el.hasPointerCapture(1))).toBe(true);await coupling.evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});await expect.poll(()=>stage.evaluate(el=>el.hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);await expect(nx).toHaveValue('88');await expect(ny).toHaveValue('10');}else await coupling.check();await expect(region.getByLabel('Drag sampled Bezier tangents')).not.toBeChecked();await expect(region.getByLabel('Drag sampled Bezier tangents')).toBeEnabled();
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],point=worldPoint(original,mode==='curve-guard'?original.nodes![1]:{x:part==='in'?6:16,y:30}),probe=worldPoint(original,part==='in'?{x:5,y:3}:{x:14,y:11});cap.dispose();
 await expect(nx).toHaveValue(String(worldPoint(original,original.nodes![1][part]!).x));
 const pixel=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},probe);
 await expect.poll(pixel).toEqual([255,0,0,255]);if(mode==='missing'){await number.fill('1');await number.press('Tab');await expect(role.locator('option')).toHaveText(['Choose original handle','Outgoing']);await role.selectOption('out');await nx.fill('90');await ny.fill('20');await expect(commit).toBeDisabled();await expect(preview).toBeDisabled();await coupling.uncheck();await expect(coupling).toBeDisabled();await expect(commit).toBeEnabled();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='invalid'){await nx.fill('');await expect(preview).toBeDisabled();await ny.fill('');await expect(commit).toBeDisabled();await number.fill('99');await number.press('Tab');await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await number.fill('2');await number.press('Tab');await role.selectOption(part);}
 if(mode==='separate'){await region.getByLabel('Sampled node document X').fill('99');await region.getByLabel('Sampled node document Y').fill('44');await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}
 if(mode==='retained'){await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='430px';});}
 await nx.fill(String(mode==='overflow'?1e308:point.x));await ny.fill(String(point.y));
 if(mode==='preview-restore'){await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;const el=document.querySelector('input[aria-label="Couple sampled tangent handles"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;});await preview.click();await expect(status).toHaveCount(0);await expect(coupling).toBeChecked();expect(await read()).toEqual(before);}
 if(mode!=='direct'){await preview.click();if(mode==='nodes-off'||mode==='curve-guard'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed tangent');await expect.poll(pixel).toEqual([255,255,255,255]);expect(await read()).toEqual(before);}
 if(mode==='mode'){await coupling.uncheck();await expect(status).toHaveCount(0);await preview.click();await expect(status).toContainText('Proposed tangent');await coupling.check();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);}
 if(mode==='reset'){await nx.fill(String(point.x+1));await expect(status).toHaveCount(0);await nx.fill(String(point.x));await preview.click();await number.fill('1');await number.press('Tab');await expect(status).toHaveCount(0);await number.fill('2');await number.press('Tab');await role.selectOption(part);await nx.fill(String(point.x));await ny.fill(String(point.y));await preview.click();await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await preview.click();await page.getByRole('button',{name:'Next frame',exact:true}).click();await expect(choice).toHaveValue('');await expect(number).toHaveCount(0);expect(await read()).toEqual(before);return;}
 if(mode==='group'){await region.getByLabel('Select complete sampled stage groups').check();await expect(number).toHaveCount(0);await expect(status).toHaveCount(0);expect(await read()).toEqual(before);return;}
 if(mode==='source'){await page.getByRole('button',{name:'Add layer',exact:true}).click();await expect(status).toHaveCount(0);await expect(choice).toHaveValue('');expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);return;}
 if(mode.startsWith('late'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-mode'||mode==='late-restore'){const el=document.querySelector('input[aria-label="Couple sampled tangent handles"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='late-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}else if(mode==='late-target'){const el=document.querySelector('input[aria-label="Sampled tangent document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-node'){const el=document.querySelector('input[aria-label="Sampled Bezier node number"]')as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='late-part'){const el=document.querySelector('select[aria-label="Sampled Bezier tangent role"]')as HTMLSelectElement;el.value='in';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else expect(await read()).toEqual(before);if(mode==='late-target')await expect(nx).toHaveValue('111');if(mode==='late-part')await expect(role).toHaveValue('in');expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareTangentPosition(target,'curve',1,part,point,{coupled:true});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));}finally{capture.dispose();}const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],node=authored.nodes![1],opposite=part==='in'?'out':'in',anchor=worldPoint(original,original.nodes![1]),prior=worldPoint(original,original.nodes![1][opposite]!),other=worldPoint(authored,node[opposite]!),selected=worldPoint(authored,node[part]!);expect(Math.hypot(other.x-anchor.x,other.y-anchor.y)).toBeCloseTo(Math.hypot(prior.x-anchor.x,prior.y-anchor.y),9);expect((selected.x-anchor.x)*(other.y-anchor.y)-(selected.y-anchor.y)*(other.x-anchor.x)).toBeCloseTo(0,8);expect(node[opposite]).not.toEqual(original.nodes![1][opposite]);expect(node.x).toBe(original.nodes![1].x);expect(node.y).toBe(original.nodes![1].y);expect(result.symbols).toEqual(before.symbols);expect(result.layers.find(l=>l.id!==target)).toEqual(before.layers.find(l=>l.id!==target));await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','out','retained','part','affine','reflected','overlay','css','shift','zero','return','foreground','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','group','nodes-off','children','late-source','coupling','coupling-restore','release-coupling','release-restore','curve-guard']as const)
test('sampled root paired tangent canvas drafts preserve original capture '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0,in:{x:-2,y:2},out:{x:2,y:0}},{x:10,y:0,in:{x:0,y:0},out:{x:20,y:0}},{x:20,y:20,in:{x:18,y:18},out:{x:18,y:22}}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,curveTangents:mode==='curve-guard'});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}

 if(mode==='foreground'){const foreground={...structuredClone(layer),id:'foreground',motionSpans:undefined,keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle' as const,x:78,y:8,width:8,height:8,rotation:0,fill:'#00ff00',stroke:'#000000',strokeWidth:0,points:[]}]}]};p.layers.push(foreground);}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),role=region.getByLabel('Sampled Bezier tangent role'),nx=region.getByLabel('Sampled tangent document X'),ny=region.getByLabel('Sampled tangent document Y'),tool=region.getByLabel('Drag sampled Bezier tangents'),commit=region.getByRole('button',{name:'Promote and position sampled tangent',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));await number.fill('2');await number.press('Tab');if(mode==='retained'){await region.getByLabel('Drag sampled Bezier nodes').check();await region.getByLabel('Author sampled node on drag release').check();}await tool.check();await region.getByLabel('Author sampled tangent on drag release').check();await region.getByLabel('Couple sampled tangent handles').check();await expect(tool).not.toBeChecked();await expect(region.getByLabel('Author sampled tangent on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled tangent on drag release')).toBeDisabled();await tool.check();const part=mode==='out'?'out':'in';
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.nodes![1][part]!);cap.dispose();
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});
 const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 const start=async()=>{await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.down();};
 await start();await page.mouse.up();if(mode==='foreground'){await expect(role).toHaveValue('');await expect(commit).toBeDisabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(number).toHaveValue('2');await expect(role).toHaveValue(part);await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await read()).toEqual(before);await expect(commit).toBeDisabled();if(mode==='zero')return;
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled tangent position',exact:true}).click();await expect(status).toContainText('Proposed tangent');}
 await start();await expect(choice).toBeDisabled();if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 if(mode==='curve-guard'){const node=worldPoint(shape,shape.nodes![1]);await page.mouse.move(pos.x+(2+node.x-anchor.x)*pos.rx,pos.y+(1+node.y-anchor.y)*pos.ry);}else await page.mouse.move(pos.x+6*pos.rx,pos.y+30*pos.ry);
 if(mode==='nodes-off'||mode==='curve-guard'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='nodes-off'||mode==='curve-guard'){expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);await expect(status).toHaveCount(0);if(mode!=='affine'&&mode!=='reflected')await expect.poll(()=>pixel(worldPoint(shape,part==='in'?{x:5,y:3}:{x:14,y:5}))).toEqual([255,255,255,255]);
 await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return'){await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.up();}
 if(['return','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','part','group','coupling','coupling-restore'].includes(mode)){
  if(mode==='coupling'||mode==='coupling-restore')await region.getByLabel('Couple sampled tangent handles').evaluate((el,mode)=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='coupling-restore'){input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}},mode);
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='part')await role.evaluate(el=>{const select=el as HTMLSelectElement;select.value=select.value==='in'?'out':'in';select.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(choice).toBeEnabled();await page.mouse.up();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='part')await expect(role).toHaveValue(part==='in'?'out':'in');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed tangent');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}
  if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},end=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(end);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 if(mode==='release-coupling'||mode==='release-restore')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;const el=document.querySelector('input[aria-label="Couple sampled tangent handles"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='release-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();if(mode==='release-coupling'||mode==='release-restore'){await expect(choice).toBeEnabled();await expect(status).toHaveCount(0);await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await page.keyboard.up('Shift');await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed tangent');await expect(nx).toHaveValue(String(point.x));await expect(ny).toHaveValue(String(point.y));expect(await read()).toEqual(before);
 await commit.click();await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareTangentPosition(target,'curve',1,part,point,{coupled:true});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);}finally{capture.dispose();}const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],node=authored.nodes![1],opposite=part==='in'?'out':'in',center=worldPoint(shape,shape.nodes![1]),prior=worldPoint(shape,shape.nodes![1][opposite]!),other=worldPoint(authored,node[opposite]!),selected=worldPoint(authored,node[part]!);expect(Math.hypot(other.x-center.x,other.y-center.y)).toBeCloseTo(Math.hypot(prior.x-center.x,prior.y-center.y),9);expect((selected.x-center.x)*(other.y-center.y)-(selected.y-center.y)*(other.x-center.x)).toBeCloseTo(0,8);expect(node[opposite]).not.toEqual(shape.nodes![1][opposite]);expect(node.x).toBe(shape.nodes![1].x);expect(node.y).toBe(shape.nodes![1].y);expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['default','out','part','affine','reflected','overlay','css','shift','zero','return','cancel','pointercancel','lost','blur','resize','scroll','policy','author-policy','prior','frame','source','target','node','group','nodes-off','curve-guard','children','late-source','release-source','release-target','release-node','release-part','release-policy','release-policy-restore','release-view','coupling','coupling-restore','release-coupling','release-coupling-restore','release-restore-prior','capture-policy','capture-policy-restore']as const)
test('sampled root paired tangent direct release guards fresh authoring '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ink:Vector={id:'curve',kind:'bezier',x:0,y:10,width:20,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],closed:true,nodes:[{x:0,y:0,in:{x:-2,y:2},out:{x:2,y:0}},{x:10,y:0,in:{x:0,y:0},out:{x:20,y:0}},{x:20,y:20,in:{x:18,y:18},out:{x:18,y:22}}]};
 layer.keys=[{frame:0,shapes:[ink,{...structuredClone(ink),id:'other',y:60}]},{frame:8,shapes:[{...structuredClone(ink),x:80},{...structuredClone(ink),id:'other',x:80,y:60}]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,curveTangents:mode==='curve-guard'});layer.keys[8].shapes.forEach(s=>s.x+=80);
 if(mode==='overlay'){const overlay={...structuredClone(layer),id:'overlay'};overlay.motionSpans![0].id='overlay-motion';p.layers.push(overlay);layer.visible=false;}
 if(mode==='children'){p.symbols=[{id:'child',name:'Child',width:10,height:10,shapes:[{id:'child-ink',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]}];for(const l of p.layers)for(const key of l.keys)for(const shape of key.shapes)if(shape.id==='other'){shape.kind='symbol';shape.symbolId='child';shape.symbolPlayback={mode:'single',firstFrame:0};shape.nodes=undefined;shape.closed=undefined;}layer.keys=layer.keys.filter(k=>[0,8,10].includes(k.frame));delete layer.motionSpans;createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:true,affine:true});}


 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),number=region.getByLabel('Sampled Bezier node number'),role=region.getByLabel('Sampled Bezier tangent role'),nx=region.getByLabel('Sampled tangent document X'),ny=region.getByLabel('Sampled tangent document Y'),tool=region.getByLabel('Drag sampled Bezier tangents'),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));await number.fill('2');await number.press('Tab');await tool.check();await region.getByLabel('Author sampled tangent on drag release').check();await region.getByLabel('Couple sampled tangent handles').check();await tool.check();await expect(region.getByLabel('Author paired sampled tangent on drag release')).not.toBeChecked();await region.getByLabel('Author paired sampled tangent on drag release').check();const part=mode==='out'?'out':'in';
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='650px';(el as HTMLElement).style.height='260px';});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.nodes![1][part]!);cap.dispose();
 const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});
 const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 const start=async()=>{await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.down();};
 await start();await page.mouse.up();await expect(number).toHaveValue('2');await expect(role).toHaveValue(part);await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await read()).toEqual(before);await expect(region.getByRole('button',{name:'Promote and position sampled tangent',exact:true})).toBeDisabled();if(mode==='zero')return;
 if(mode==='prior'||mode==='release-restore-prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled tangent position',exact:true}).click();await expect(status).toContainText('Proposed tangent');}
 if(mode==='capture-policy'||mode==='capture-policy-restore'){await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;const el=document.querySelector('input[aria-label="Author paired sampled tangent on drag release"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='capture-policy-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;},mode);await start();await expect.poll(()=>stage.evaluate(el=>el.hasPointerCapture(1))).toBe(false);await expect(page.getByRole('alert')).toBeVisible();await expect(choice).toBeEnabled();await page.mouse.up();await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await start();await expect(choice).toBeDisabled();if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=original;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 await page.mouse.move(pos.x+(mode==='curve-guard'?12:6)*pos.rx,pos.y+(mode==='curve-guard'?1:30)*pos.ry);
 if(mode==='nodes-off'||mode==='curve-guard'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='nodes-off'||mode==='curve-guard'){expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();expect(await read()).toEqual(before);await expect(status).toHaveCount(0);if(mode!=='affine'&&mode!=='reflected')await expect.poll(()=>pixel(worldPoint(shape,part==='in'?{x:5,y:3}:{x:14,y:5}))).toEqual([255,255,255,255]);
 await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return'){await page.mouse.move(pos.x+2*pos.rx,pos.y+pos.ry);await page.mouse.up();}
 if(['return','author-policy','cancel','pointercancel','lost','blur','resize','scroll','policy','prior','frame','source','target','node','part','group','coupling','coupling-restore'].includes(mode)){
  if(mode==='coupling'||mode==='coupling-restore')await region.getByLabel('Couple sampled tangent handles').evaluate((el,mode)=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='coupling-restore'){input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}},mode);
  if(mode==='author-policy')await region.getByLabel('Author paired sampled tangent on drag release').evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost'){await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));await page.mouse.move(pos.x,pos.y);}if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='part')await role.evaluate(el=>{const select=el as HTMLSelectElement;select.value=select.value==='in'?'out':'in';select.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await expect(choice).toBeEnabled();await page.mouse.up();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='part')await expect(role).toHaveValue(part==='in'?'out':'in');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed tangent');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}
  if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);if(mode==='author-policy'){await expect(region.getByLabel('Author paired sampled tangent on drag release')).not.toBeChecked();await start();await page.mouse.move(pos.x+6*pos.rx,pos.y+30*pos.ry);await page.mouse.up();await expect(region).toBeVisible();await expect(status).toContainText('Proposed tangent');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;
 }
 if(mode.startsWith('release-'))await page.evaluate(mode=>{const original=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=original(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)&&!document.querySelector('canvas[aria-label="Drawing stage"]')?.hasPointerCapture(1)){window.structuredClone=original;if(mode==='release-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='release-coupling'||mode==='release-coupling-restore'){const el=document.querySelector('input[aria-label="Couple sampled tangent handles"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='release-coupling-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}else if(mode==='release-target'){const el=document.querySelector('input[aria-label="Sampled tangent document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='release-node'){const el=document.querySelector('input[aria-label="Sampled Bezier node number"]')as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-part'){const el=document.querySelector('select[aria-label="Sampled Bezier tangent role"]')as HTMLSelectElement;el.value=el.value==='in'?'out':'in';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-view'){(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).style.width='700px';}else{const el=document.querySelector('input[aria-label="Author paired sampled tangent on drag release"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='release-policy-restore'||mode==='release-restore-prior'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},end=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(end);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();await page.mouse.up();await page.keyboard.up('Shift');
 if(mode.startsWith('release-')){await expect(region).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='release-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}else{expect(await read()).toEqual(before);if(mode==='release-target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}if(mode==='release-node')await expect(number).toHaveValue('1');if(mode==='release-part')await expect(role).toHaveValue(part==='in'?'out':'in');if(mode==='release-policy-restore')await expect(region.getByLabel('Author paired sampled tangent on drag release')).toBeChecked();if(mode==='release-restore-prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed tangent');}if(mode==='release-coupling'||mode==='release-coupling-restore'){await expect(status).toHaveCount(0);await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4}));try{const wanted=capture.prepareTangentPosition(target,'curve',1,part,point,{coupled:true});expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));}finally{capture.dispose();}const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],node=authored.nodes![1],opposite=part==='in'?'out':'in',center=worldPoint(shape,shape.nodes![1]),prior=worldPoint(shape,shape.nodes![1][opposite]!),other=worldPoint(authored,node[opposite]!),selected=worldPoint(authored,node[part]!);expect(Math.hypot(other.x-center.x,other.y-center.y)).toBeCloseTo(Math.hypot(prior.x-center.x,prior.y-center.y),9);expect((selected.x-center.x)*(other.y-center.y)-(selected.y-center.y)*(other.x-center.x)).toBeCloseTo(0,8);expect(node[opposite]).not.toEqual(shape.nodes![1][opposite]);expect(node.x).toBe(shape.nodes![1].x);expect(node.y).toBe(shape.nodes![1].y);expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['in','out','paired','outer','overlay','affine','reflected','aligned','unequal','direct','missing','nodes-off','overflow','invalid','reset','group','children','separate','late-source','late-target','late-contour','late-node','late-role','late-mode','late-restore','late-group','late-frame','late-close','curve-guard','certified-in','certified-out','certified-paired','certified-both','certified-affine','certified-reflected','certified-aligned','certified-overlay','certified-contacts','contact-guard']as const)
test('sampled root compound numeric tangents keep original ring ownership '+mode,async({page})=>{
 const certifiedOptions=mode.startsWith('certified')?{curveTangents:true,...((mode==='certified-both'||mode==='certified-contacts')?{curveSelfContacts:true}:{}),...(mode==='certified-contacts'?{contourContacts:true}:{})}:{};
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ring=(points:number[][])=>points.map(([x,y],i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];return {x,y,in:{x:x+(prev[0]-x)/5,y:y+(prev[1]-y)/5},out:{x:x+(next[0]-x)/5,y:y+(next[1]-y)/5}};});
 const ink:Vector={id:'curve',kind:'polygon',fillRule:'evenodd',x:0,y:10,width:30,height:30,rotation:(mode==='affine'||mode==='certified-affine')||(mode==='reflected'||mode==='certified-reflected')?30:0,...((mode==='affine'||mode==='certified-affine')||(mode==='reflected'||mode==='certified-reflected')?{transform:((mode==='reflected'||mode==='certified-reflected')?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[],closed:true,contours:[ring(mode==='unequal'?[[0,0],[30,0],[30,30],[0,30]]:[[0,0],[30,0],[0,30]]),ring([[6,6],[6,12],[12,6]])]};if(mode==='missing')delete ink.contours![1][2].in;
 const end={...structuredClone(ink),x:80};if((mode==='aligned'||mode==='certified-aligned'))end.contours=[...end.contours!].reverse().map(r=>[r[1],r[0],r[2]].map(n=>({...n,in:n.out,out:n.in})));
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,...certifiedOptions},undefined,undefined,(mode==='aligned'||mode==='certified-aligned')?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);layer.keys[8].shapes[0].x+=80;if(mode==='curve-guard'){layer.motionSpans![0].options={...layer.motionSpans![0].options,curveTangents:true};delete layer.keys[0].shapes[0].contours![1][2].out;}if(mode==='contact-guard'){layer.motionSpans![0].options={...layer.motionSpans![0].options,contourContacts:true};for(const key of layer.keys)if(key.frame===0||key.frame===8)key.shapes[0].contours![1]=structuredClone(key.shapes[0].contours![0]);}
 if((mode==='overlay'||mode==='certified-overlay')){const extra={...structuredClone(layer),id:'overlay'};extra.motionSpans![0].id='extra-motion';p.layers.push(extra);layer.visible=false;}
 if(mode==='children'){const child={id:'child',name:'Child',width:10,height:10,shapes:[{id:'blue',kind:'rectangle' as const,x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]}]};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...child.shapes[0],id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,symbolPlayback:{mode:'single',firstFrame:0}}]}]});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=(mode==='overlay'||mode==='certified-overlay')?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),contour=region.getByLabel('Sampled compound contour number'),node=region.getByLabel('Sampled compound node number'),role=region.getByLabel('Sampled compound tangent role'),nx=region.getByLabel('Sampled compound tangent document X'),ny=region.getByLabel('Sampled compound tangent document Y'),coupling=region.getByLabel('Couple sampled compound tangent handles'),preview=region.getByRole('button',{name:'Preview sampled compound tangent position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled compound tangent',exact:true}),status=region.getByRole('status');
 await stage.evaluate((el,certified)=>{(el as HTMLElement).dataset.certifiedProbe=String(certified);},mode.startsWith('certified'));
 if(mode==='curve-guard'||mode==='contact-guard'){await expect(choice).toBeDisabled();await expect(contour).toHaveCount(0);await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await expect(region).toBeHidden();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));const ci=mode==='outer'?0:1,ni=mode==='outer'?0:2,part=(mode==='out'||mode==='certified-out')||mode==='late-role'?'out':'in';await contour.fill(String(ci+1));await node.fill(String(ni+1));await expect(region.getByLabel('Sampled Bezier node number')).toHaveCount(0);await expect(coupling).not.toBeChecked();
 if(mode==='missing'){await expect(role.locator('option')).toHaveText(['Choose original handle','Outgoing']);await role.evaluate(el=>{const select=el as HTMLSelectElement;select.add(new Option('Forged incoming','in'));select.value='in';select.dispatchEvent(new Event('change',{bubbles:true}));});await expect(commit).toBeDisabled();await expect(preview).toBeDisabled();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await role.selectOption(part);await expect(commit).toBeDisabled();if((mode==='paired'||mode==='certified-paired')||mode==='unequal')await coupling.check();
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],base=original.contours![ci][ni],point=worldPoint(original,{x:base[part]!.x+(mode==='outer'?-10:mode==='certified-out'?2:mode.startsWith('certified')?.25:2),y:base[part]!.y+(mode==='certified-out'?-2:mode.startsWith('certified')?.25:8)});cap.dispose();await expect(nx).toHaveValue(String(worldPoint(original,base[part]!).x));expect(await read()).toEqual(before);
 if(mode==='invalid'){await contour.fill('99');await expect(role).toBeDisabled();await expect(commit).toBeDisabled();await contour.fill(String(ci+1));await node.fill('99');await expect(role).toBeDisabled();await node.fill(String(ni+1));await role.selectOption(part);await nx.fill('');await expect(commit).toBeDisabled();}
 if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}
 const redHash=()=>stage.evaluate(el=>{const certified=(el as HTMLElement).dataset.certifiedProbe==='true';const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(let i=0;i<d.length;i+=4)if(certified?d[i]>d[i+1]&&d[i]>d[i+2]:d[i]===255&&d[i+1]===0&&d[i+2]===0)hash=Math.imul(hash^(certified?(i^(d[i]-d[i+1])):i),16777619);return hash;});await stage.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const hash=await redHash();await nx.fill(String(mode==='overflow'?1e308:point.x));await ny.fill(String(point.y));
 if(mode!=='direct'){await preview.click();if(mode==='nodes-off'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(status).toContainText('Proposed compound');await expect.poll(redHash).not.toBe(hash);expect(await read()).toEqual(before);}
 if(mode==='reset'){await nx.fill(String(point.x+1));await expect(status).toHaveCount(0);await nx.fill(String(point.x));await preview.click();await contour.fill('1');await expect(status).toHaveCount(0);await expect(role).toHaveValue('');await contour.fill('2');await node.fill('3');await role.selectOption(part);await nx.fill(String(point.x));await ny.fill(String(point.y));await preview.click();await page.getByRole('button',{name:'Next frame',exact:true}).click();await expect(choice).toHaveValue('');await expect(contour).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='group'){await region.getByLabel('Select complete sampled stage groups').check();await expect(contour).toHaveCount(0);await expect(status).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode.startsWith('late'))await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='late-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-group'){const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='late-frame')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Next frame')as HTMLButtonElement).click();else if(mode==='late-close')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();else if(mode==='late-target'){const el=document.querySelector('input[aria-label="Sampled compound tangent document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-contour'||mode==='late-node'){const el=document.querySelector(`input[aria-label="Sampled compound ${mode==='late-contour'?'contour':'node'} number"]`)as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='late-role'){const el=document.querySelector('select[aria-label="Sampled compound tangent role"]')as HTMLSelectElement;el.value='in';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Couple sampled compound tangent handles"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='late-restore'){el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 await commit.click();if(mode==='late-close'){await expect(region).toBeHidden();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(mode.startsWith('late')){await expect(region).toBeVisible();expect((await read()).layers.filter(l=>l.id===target)).toEqual(before.layers.filter(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);if(mode==='late-target')await expect(nx).toHaveValue('111');if(mode==='late-group'){await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();await expect(region.getByLabel('Sampled compound contour number')).toHaveCount(0);}if(mode==='late-frame'){await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');await expect(status).toHaveCount(0);await expect(commit).toHaveCount(0);}expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),coupled=(mode==='paired'||mode==='certified-paired')||mode==='unequal',wanted=capture.prepareCompoundTangentPosition(target,'curve',ci,ni,part,point,{coupled});capture.dispose();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],actual=authored.contours![ci][ni],opposite=part==='in'?'out':'in';expect(authored.contours![1-ci]).toEqual(original.contours![1-ci]);expect(actual.x).toBe(base.x);expect(actual.y).toBe(base.y);if(!coupled)expect(actual[opposite]).toEqual(base[opposite]);else{const center=worldPoint(original,base),prior=worldPoint(original,base[opposite]!),other=worldPoint(authored,actual[opposite]!);expect(Math.hypot(other.x-center.x,other.y-center.y)).toBeCloseTo(Math.hypot(prior.x-center.x,prior.y-center.y),9);}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['base','out','paired','paired-out','paired-affine','paired-reflected','outer','overlay','affine','reflected','aligned','unequal','css','shift','zero','return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','frame','source','target','contour','node','part','group','coupling','coupling-restore','nodes-off','late-source','release-restore','wrong','children','foreground','retained']as const)
test('sampled root compound tangent canvas drafts capture original rings '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ring=(points:number[][])=>points.map(([x,y],i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];return {x,y,in:{x:x+(prev[0]-x)/5,y:y+(prev[1]-y)/5},out:{x:x+(next[0]-x)/5,y:y+(next[1]-y)/5}};});
 const ink:Vector={id:'curve',kind:'polygon',fillRule:'evenodd',x:0,y:10,width:60,height:60,rotation:mode==='affine'||mode==='reflected'||mode==='paired-affine'||mode==='paired-reflected'?30:0,...(mode==='affine'||mode==='reflected'||mode==='paired-affine'||mode==='paired-reflected'?{transform:((mode==='reflected'||mode==='paired-reflected')?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[],closed:true,contours:[ring(mode==='unequal'?[[0,0],[60,0],[60,60],[0,60]]:[[0,0],[60,0],[0,60]]),ring([[10,10],[10,30],[30,10]])]};
 const end={...structuredClone(ink),x:80};if(mode==='aligned')end.contours=[...end.contours!].reverse().map(r=>[r[1],r[0],r[2]].map(n=>({...n,in:n.out,out:n.in})));
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];if(mode==='retained')for(const key of layer.keys)if(key.shapes.length)key.shapes.push({id:'legacy',kind:'bezier',x:key.frame===8?80:0,y:80,width:20,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[{x:0,y:0,in:{x:-5,y:0},out:{x:5,y:0}},{x:20,y:10,in:{x:15,y:10},out:{x:25,y:10}}]});createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true},undefined,undefined,mode==='aligned'?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);layer.keys[8].shapes[0].x+=80;
 if(mode==='overlay'){const extra={...structuredClone(layer),id:'overlay'};extra.motionSpans![0].id='extra-motion';p.layers.push(extra);layer.visible=false;}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const child={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle',x:90,y:10,width:40,height:40,rotation:0,fill:'#00ff00',stroke:'#000000',strokeWidth:0,points:[]}]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),contour=region.getByLabel('Sampled compound contour number'),number=region.getByLabel('Sampled compound node number'),role=region.getByLabel('Sampled compound tangent role'),nx=region.getByLabel('Sampled compound tangent document X'),ny=region.getByLabel('Sampled compound tangent document Y'),coupling=region.getByLabel('Couple sampled compound tangent handles'),tool=region.getByLabel('Drag sampled compound tangents'),commit=region.getByRole('button',{name:'Promote and position sampled compound tangent',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}if(mode==='retained'){await choice.selectOption(JSON.stringify([target,'legacy']));await region.getByLabel('Sampled Bezier node number').fill('1');await region.getByLabel('Sampled Bezier node number').press('Tab');await region.getByLabel('Sampled Bezier tangent role').selectOption('in');await region.getByLabel('Drag sampled Bezier tangents').check();await region.getByLabel('Author sampled tangent on drag release').check();await region.getByLabel('Couple sampled tangent handles').check();await region.getByLabel('Drag sampled Bezier tangents').check();await region.getByLabel('Author paired sampled tangent on drag release').check();}await choice.selectOption(JSON.stringify([target,'curve']));const ci=mode==='outer'?0:1,ni=mode==='outer'?0:2,part=mode==='out'||mode==='paired-out'?'out':'in',coupled=mode.startsWith('paired')||mode==='unequal'||mode==='coupling'||mode==='coupling-restore'||mode==='release-restore';await contour.fill(String(ci+1));await number.fill(String(ni+1));if(coupled)await coupling.check();await tool.check();
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.contours![ci][ni][part]!),opposite=worldPoint(shape,shape.contours![ci][ni][part==='in'?'out':'in']!);cap.dispose();
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='350px';});await stage.scrollIntoViewIfNeeded();const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);const vx=(anchor.x-opposite.x)*pos.rx,vy=(anchor.y-opposite.y)*pos.ry,distance=Math.hypot(vx,vy),markerProbe={x:anchor.x+vx/distance*1.5/pos.rx,y:anchor.y+vy/distance*1.5/pos.ry};
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});const start=async()=>{await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);await page.mouse.down();};const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 await start();await page.mouse.up();if(mode==='foreground'){await expect(role).toHaveValue('');await expect(commit).toBeDisabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(role).toHaveValue(part);await expect.poll(()=>pixel(markerProbe)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(commit).toBeDisabled();expect(await read()).toEqual(before);if(mode==='zero'){expect(errors).toEqual([]);return;}
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled compound tangent position',exact:true}).click();await expect(status).toContainText('Proposed compound');}
 await start();await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 const redHash=()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255)h=(h*31+i)|0;return h;});const hash=await redHash();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}else{expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();await expect(status).toHaveCount(0);await expect.poll(redHash).not.toBe(hash);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);expect(await read()).toEqual(before);await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return')await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);
 if(['return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','frame','source','target','contour','node','part','group','coupling','coupling-restore'].includes(mode)){
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='contour')await contour.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='part')await role.evaluate(el=>{const select=el as HTMLSelectElement;select.value='out';select.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='coupling'||mode==='coupling-restore')await coupling.evaluate((el,mode)=>{const input=el as HTMLInputElement;input.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='coupling-restore'){input.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}},mode);
  await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='contour'){await expect(contour).toHaveValue('1');await expect(number).toHaveValue('');}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='part')await expect(role).toHaveValue('out');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed compound');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}if(mode==='frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},delivered=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(delivered);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 if(mode==='release-restore')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;const el=document.querySelector('input[aria-label="Couple sampled compound tangent handles"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof structuredClone;});
 if(mode==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();}await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='release-restore'){await expect(status).toHaveCount(0);await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed compound');await expect(nx).toHaveValue(String(point.x));await expect(ny).toHaveValue(String(point.y));await expect.poll(()=>pixel(markerProbe)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);await commit.click();await expect(region).toBeHidden();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=capture.prepareCompoundTangentPosition(target,'curve',ci,ni,part,point,{coupled});capture.dispose();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['base','out','paired','paired-out','paired-affine','paired-reflected','outer','overlay','affine','reflected','aligned','unequal','css','shift','zero','return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','author-policy','frame','source','target','contour','node','part','group','coupling','coupling-restore','nodes-off','late-source','release-policy','release-restore','release-coupling','release-coupling-restore','release-target','release-contour','release-node','release-part','release-view','release-source','wrong','children','foreground','retained','capture-policy','capture-policy-restore','certified-in','certified-out','certified-paired','certified-both','certified-affine','certified-reflected','certified-css','certified-aligned','certified-overlay','certified-contacts']as const)
test('sampled root compound tangent direct release admits fresh rings '+mode,async({page})=>{
 const certifiedOptions=mode.startsWith('certified')?{curveTangents:true,...((mode==='certified-both'||mode==='certified-contacts')?{curveSelfContacts:true}:{}),...(mode==='certified-contacts'?{contourContacts:true}:{})}:{};
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ring=(points:number[][])=>points.map(([x,y],i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];return {x,y,in:{x:x+(prev[0]-x)/5,y:y+(prev[1]-y)/5},out:{x:x+(next[0]-x)/5,y:y+(next[1]-y)/5}};});
 const ink:Vector={id:'curve',kind:'polygon',fillRule:'evenodd',x:0,y:10,width:60,height:60,rotation:(mode==='affine'||mode==='certified-affine')||(mode==='reflected'||mode==='certified-reflected')||mode==='paired-affine'||mode==='paired-reflected'?30:0,...((mode==='affine'||mode==='certified-affine')||(mode==='reflected'||mode==='certified-reflected')||mode==='paired-affine'||mode==='paired-reflected'?{transform:(((mode==='reflected'||mode==='certified-reflected')||mode==='paired-reflected')?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[],closed:true,contours:[ring(mode==='unequal'?[[0,0],[60,0],[60,60],[0,60]]:[[0,0],[60,0],[0,60]]),ring([[10,10],[10,30],[30,10]])]};
 const end={...structuredClone(ink),x:80};if((mode==='aligned'||mode==='certified-aligned'))end.contours=[...end.contours!].reverse().map(r=>[r[1],r[0],r[2]].map(n=>({...n,in:n.out,out:n.in})));
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];if(mode==='retained')for(const key of layer.keys)if(key.shapes.length)key.shapes.push({id:'legacy',kind:'bezier',x:key.frame===8?80:0,y:80,width:20,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[{x:0,y:0,in:{x:-5,y:0},out:{x:5,y:0}},{x:20,y:10,in:{x:15,y:10},out:{x:25,y:10}}]});createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true,...certifiedOptions},undefined,undefined,(mode==='aligned'||mode==='certified-aligned')?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);layer.keys[8].shapes[0].x+=80;
 if((mode==='overlay'||mode==='certified-overlay')){const extra={...structuredClone(layer),id:'overlay'};extra.motionSpans![0].id='extra-motion';p.layers.push(extra);layer.visible=false;}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const child={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle',x:90,y:10,width:40,height:40,rotation:0,fill:'#00ff00',stroke:'#000000',strokeWidth:0,points:[]}]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=(mode==='overlay'||mode==='certified-overlay')?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),contour=region.getByLabel('Sampled compound contour number'),number=region.getByLabel('Sampled compound node number'),role=region.getByLabel('Sampled compound tangent role'),nx=region.getByLabel('Sampled compound tangent document X'),ny=region.getByLabel('Sampled compound tangent document Y'),coupling=region.getByLabel('Couple sampled compound tangent handles'),tool=region.getByLabel('Drag sampled compound tangents'),commit=region.getByRole('button',{name:'Promote and position sampled compound tangent',exact:true}),status=region.getByRole('status');
 await stage.evaluate((el,certified)=>{(el as HTMLElement).dataset.certifiedProbe=String(certified);},mode.startsWith('certified'));
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}if(mode==='retained'){await choice.selectOption(JSON.stringify([target,'legacy']));await region.getByLabel('Sampled Bezier node number').fill('1');await region.getByLabel('Sampled Bezier node number').press('Tab');await region.getByLabel('Sampled Bezier tangent role').selectOption('in');await region.getByLabel('Drag sampled Bezier tangents').check();await region.getByLabel('Author sampled tangent on drag release').check();await region.getByLabel('Couple sampled tangent handles').check();await region.getByLabel('Drag sampled Bezier tangents').check();await region.getByLabel('Author paired sampled tangent on drag release').check();}await choice.selectOption(JSON.stringify([target,'curve']));const ci=mode==='outer'?0:1,ni=mode==='outer'?0:2,part=(mode==='out'||mode==='certified-out')||mode==='paired-out'?'out':'in',coupled=(mode.startsWith('paired')||mode==='certified-paired')||mode==='unequal'||mode==='coupling'||mode==='coupling-restore'||mode==='release-restore'||mode==='release-coupling'||mode==='release-coupling-restore';await contour.fill(String(ci+1));await number.fill(String(ni+1));if(coupled)await coupling.check();await tool.check();const author=region.getByLabel('Author sampled compound tangent on drag release');await author.check();
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],anchor=worldPoint(shape,shape.contours![ci][ni][part]!),opposite=worldPoint(shape,shape.contours![ci][ni][part==='in'?'out':'in']!);cap.dispose();
 if((mode==='css'||mode==='certified-css'))await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='350px';});await stage.scrollIntoViewIfNeeded();const pos=await stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);const vx=(anchor.x-opposite.x)*pos.rx,vy=(anchor.y-opposite.y)*pos.ry,distance=Math.hypot(vx,vy),markerProbe={x:anchor.x+vx/distance*1.5/pos.rx,y:anchor.y+vy/distance*1.5/pos.ry};
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});const start=async()=>{await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);await page.mouse.down();};const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 await start();await page.mouse.up();if(mode==='foreground'){await expect(role).toHaveValue('');await expect(commit).toBeDisabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(role).toHaveValue(part);await expect.poll(()=>pixel(markerProbe)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(commit).toBeDisabled();expect(await read()).toEqual(before);if(mode==='zero'){expect(errors).toEqual([]);return;}
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled compound tangent position',exact:true}).click();await expect(status).toContainText('Proposed compound');}
 if(mode==='capture-policy'||mode==='capture-policy-restore'){await page.evaluate(mode=>{let armed=false;document.querySelector('canvas[aria-label="Drawing stage"]')!.addEventListener('pointerdown',()=>{armed=true;},true);const stringify=JSON.stringify;JSON.stringify=((value:unknown,replacer?:unknown,space?:string|number)=>{const result=stringify(value,replacer as never,space);if(armed){JSON.stringify=stringify;const el=document.querySelector('input[aria-label="Author sampled compound tangent on drag release"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='capture-policy-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}return result;})as typeof JSON.stringify;},mode);await start();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();await expect(choice).toBeEnabled();await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));expect(await read()).toEqual(before);await stage.scrollIntoViewIfNeeded();const fresh=await stage.boundingBox();const x=fresh!.x+(pos.x-pos.left),y=fresh!.y+(pos.y-pos.top);await page.mouse.move(x,y);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(x+8*pos.rx,y+20*pos.ry);expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1)),JSON.stringify({before:fresh,after:await stage.boundingBox(),error:await page.getByRole('alert').allTextContents()})).toBe(true);await page.mouse.up();if(mode==='capture-policy-restore'){await expect(region).toBeHidden();expect(await read()).not.toEqual(before);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);}else{await expect(status).toContainText('Proposed compound');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;}
 await start();await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='shift')await page.keyboard.down('Shift');
 if(mode==='late-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 const redHash=()=>stage.evaluate(el=>{const certified=(el as HTMLElement).dataset.certifiedProbe==='true';const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=4)if(certified?d[i]>d[i+1]&&d[i]>d[i+2]:d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255)h=(h*31+(certified?(i^(d[i]-d[i+1])):i))|0;return h;});const hash=await redHash();await page.mouse.move(pos.x+(mode.startsWith('certified')?1:8)*pos.rx,pos.y+(mode.startsWith('certified')?1:20)*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}else{expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();await expect(status).toHaveCount(0);await expect.poll(redHash).not.toBe(hash);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);expect(await read()).toEqual(before);await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return')await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);
 if(['return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','author-policy','frame','source','target','contour','node','part','group','coupling','coupling-restore'].includes(mode)){
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='author-policy')await author.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='contour')await contour.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='part')await role.evaluate(el=>{const select=el as HTMLSelectElement;select.value='out';select.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='coupling'||mode==='coupling-restore')await coupling.evaluate((el,mode)=>{const input=el as HTMLInputElement;input.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='coupling-restore'){input.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}},mode);
  await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='contour'){await expect(contour).toHaveValue('1');await expect(number).toHaveValue('');}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='part')await expect(role).toHaveValue('out');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed compound');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}if(mode==='frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);if(mode==='author-policy'){await stage.scrollIntoViewIfNeeded();const fresh=(await stage.boundingBox())!,x=fresh.x+(pos.x-pos.left),y=fresh.y+(pos.y-pos.top);await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+8*pos.rx,y+20*pos.ry);await page.mouse.up();await expect(status).toContainText('Proposed compound');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},delivered=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(delivered);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 if(mode.startsWith('release-'))await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)&&!document.querySelector('canvas[aria-label="Drawing stage"]')?.hasPointerCapture(1)){window.structuredClone=clone;if(mode==='release-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='release-view')(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).style.width='700px';else if(mode==='release-target'){const el=document.querySelector('input[aria-label="Sampled compound tangent document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='release-contour'||mode==='release-node'){const el=document.querySelector(`input[aria-label="Sampled compound ${mode==='release-contour'?'contour':'node'} number"]`)as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='release-part'){const el=document.querySelector('select[aria-label="Sampled compound tangent role"]')as HTMLSelectElement;el.value='out';el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector(`input[aria-label="${mode==='release-coupling'||mode==='release-coupling-restore'?'Couple sampled compound tangent handles':'Author sampled compound tangent on drag release'}"]`)as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));if(mode==='release-restore'||mode==='release-coupling-restore'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 if(mode==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();}await page.mouse.up();await page.keyboard.up('Shift');expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode.startsWith('release-')){await expect(choice).toBeEnabled();await expect(status).toHaveCount(0);if(mode==='release-target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='release-contour'){await expect(contour).toHaveValue('1');await expect(number).toHaveValue('');}else if(mode==='release-node')await expect(number).toHaveValue('1');else if(mode==='release-part')await expect(role).toHaveValue('out');else if(mode==='release-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}else{await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}if(mode==='release-policy'||mode==='release-restore')await expect(author).toBeChecked({checked:mode==='release-restore'});if(mode==='release-coupling'||mode==='release-coupling-restore')await expect(coupling).toBeChecked({checked:mode==='release-coupling-restore'});expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=capture.prepareCompoundTangentPosition(target,'curve',ci,ni,part,point,{coupled});capture.dispose();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['base','outer','overlay','affine','reflected','aligned','unequal','direct','missing','none','nodes-off','overflow','invalid','reset','group','children','separate','retained','curve-guard','late-source','late-target','late-contour','late-node','late-pick','late-group','late-frame','late-close','preview-source','preview-target']as const)
test('sampled root compound numeric anchors retain original ownership '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ring=(points:number[][])=>points.map(([x,y],i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];return {x,y,in:{x:x+(prev[0]-x)/5,y:y+(prev[1]-y)/5},out:{x:x+(next[0]-x)/5,y:y+(next[1]-y)/5}};});
 const ink:Vector={id:'curve',kind:'polygon',fillRule:'evenodd',x:0,y:10,width:30,height:30,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[],closed:true,contours:[ring(mode==='unequal'?[[0,0],[30,0],[30,30],[0,30]]:[[0,0],[30,0],[0,30]]),ring([[6,6],[6,12],[12,6]])]};if(mode==='missing'||mode==='none')delete ink.contours![1][2].in;if(mode==='none')delete ink.contours![1][2].out;
 const end={...structuredClone(ink),x:80};if(mode==='aligned')end.contours=[...end.contours!].reverse().map(r=>[r[1],r[0],r[2]].map(n=>({...n,in:n.out,out:n.in})));
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true},undefined,undefined,mode==='aligned'?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);layer.keys[8].shapes[0].x+=80;if(mode==='curve-guard'){layer.motionSpans![0].options={...layer.motionSpans![0].options,curveTangents:true};delete layer.keys[0].shapes[0].contours![1][2].out;}
 if(mode==='overlay'){const extra={...structuredClone(layer),id:'overlay'};extra.motionSpans![0].id='extra-motion';p.layers.push(extra);layer.visible=false;}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const child={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),contour=region.getByLabel('Sampled compound anchor contour number'),number=region.getByLabel('Sampled compound anchor node number'),nx=region.getByLabel('Sampled compound anchor document X'),ny=region.getByLabel('Sampled compound anchor document Y'),preview=region.getByRole('button',{name:'Preview sampled compound anchor position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled compound anchor',exact:true}),status=region.getByRole('status');
 if(mode==='curve-guard'){await expect(choice).toBeDisabled();await expect(contour).toHaveCount(0);await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await expect(region).toBeHidden();expect(errors).toEqual([]);return;}
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));const ci=mode==='outer'?0:1,ni=mode==='outer'?0:2;
 const tangentContour=region.getByLabel('Sampled compound contour number'),tangentNode=region.getByLabel('Sampled compound node number'),tangentRole=region.getByLabel('Sampled compound tangent role'),tangentX=region.getByLabel('Sampled compound tangent document X'),tangentY=region.getByLabel('Sampled compound tangent document Y'),canvasTool=region.getByLabel('Drag sampled compound tangents'),release=region.getByLabel('Author sampled compound tangent on drag release');if(mode==='retained'||mode==='separate'){await tangentContour.fill('2');await tangentNode.fill('3');await tangentRole.selectOption('in');if(mode==='retained'){await canvasTool.check();await release.check();}}
 await contour.fill(String(ci+1));await number.fill(String(ni+1));await expect(region.getByLabel('Sampled Bezier node number')).toHaveCount(0);await expect(commit).toBeDisabled();const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],base=original.contours![ci][ni],point=worldPoint(original,{x:base.x+(mode==='outer'?-10:2),y:base.y+8});cap.dispose();await expect(nx).toHaveValue(String(worldPoint(original,base).x));await expect(ny).toHaveValue(String(worldPoint(original,base).y));expect(await read()).toEqual(before);
 if(mode==='invalid'){await nx.fill('');await expect(commit).toBeDisabled();await contour.fill('99');await expect(number).toBeDisabled();await expect(nx).toHaveValue('');await contour.fill(String(ci+1));await number.fill('99');await expect(commit).toBeDisabled();await number.fill(String(ni+1));}
 if(mode==='separate'){await tangentX.fill('110');await tangentY.fill('30');await region.getByLabel('Couple sampled compound tangent handles').check();await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}
 const redHash=()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255)h=(h*31+i)|0;return h;}),hash=await redHash();await nx.fill(String(mode==='overflow'?1e308:point.x));await ny.fill(String(point.y));
 const arm=async(action:string)=>page.evaluate(action=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(action==='source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(action==='close')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();else if(action==='frame')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Next frame')as HTMLButtonElement).click();else if(action==='pick'){const el=document.querySelector('select[aria-label="Sampled stage artwork"]')as HTMLSelectElement;el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(action==='group'){const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}else{const label=action==='target'?'Sampled compound anchor document X':`Sampled compound anchor ${action==='contour'?'contour':'node'} number`,el=document.querySelector(`input[aria-label="${label}"]`)as HTMLInputElement;el.value=action==='target'?'111':'1';el.dispatchEvent(new Event('input',{bubbles:true}));}}return result;})as typeof structuredClone;},action);
 if(mode==='preview-source'||mode==='preview-target')await arm(mode==='preview-source'?'source':'target');
 if(mode!=='direct'){await preview.click();if(mode==='nodes-off'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await commit.click();expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(mode==='preview-source'||mode==='preview-target'){await expect(status).toHaveCount(0);if(mode==='preview-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}else await expect(nx).toHaveValue('111');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(status).toContainText('Proposed compound-anchor');await expect.poll(redHash).not.toBe(hash);expect(await read()).toEqual(before);if(mode==='children')await expect.poll(()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(75-100)*devicePixelRatio,c.height/2+(62-50)*devicePixelRatio,1,1).data];})).toEqual([0,0,255,255]);}
 if(mode==='retained'){await expect(canvasTool).not.toBeChecked();await expect(release).toBeChecked();await expect(release).toBeDisabled();await stage.scrollIntoViewIfNeeded();const p=await stage.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});await page.mouse.move(p.x,p.y);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.move(p.x+20,p.y+20);await page.mouse.up();await expect(status).toContainText('Proposed compound-anchor');expect(await read()).toEqual(before);}
 if(mode==='reset'){await nx.fill(String(point.x+1));await expect(status).toHaveCount(0);await contour.fill('1');await expect(number).toHaveValue('');await expect(nx).toHaveValue('');await page.getByRole('button',{name:'Next frame',exact:true}).click();await expect(choice).toHaveValue('');await expect(contour).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='group'){await region.getByLabel('Select complete sampled stage groups').check();await expect(contour).toHaveCount(0);await expect(status).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode.startsWith('late-'))await arm(mode.slice(5));await commit.click();if(mode==='late-close'){await expect(region).toBeHidden();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(mode.startsWith('late-')){await expect(region).toBeVisible();if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}if(mode==='late-target')await expect(nx).toHaveValue('111');if(mode==='late-contour')await expect(contour).toHaveValue('1');if(mode==='late-node')await expect(number).toHaveValue('1');if(mode==='late-pick')await expect(choice).toHaveValue('');if(mode==='late-group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();if(mode==='late-frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();if(['base','overlay','unequal'].includes(mode))await expect.poll(()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point)).toEqual([146,117,255,255]);const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=capture.prepareCompoundNodePosition(target,'curve',ci,ni,point);capture.dispose();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],node=authored.contours![ci][ni],old=worldPoint(original,base),actual=worldPoint(authored,node);expect(actual.x).toBeCloseTo(point.x,9);expect(actual.y).toBeCloseTo(point.y,9);expect(authored.contours![1-ci]).toEqual(original.contours![1-ci]);for(const part of ['in','out']as const)if(base[part]){const beforeHandle=worldPoint(original,base[part]!),afterHandle=worldPoint(authored,node[part]!);expect(afterHandle.x-actual.x).toBeCloseTo(beforeHandle.x-old.x,9);expect(afterHandle.y-actual.y).toBeCloseTo(beforeHandle.y-old.y,9);}else expect(node[part]).toBeUndefined();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['base','outer','overlay','affine','reflected','aligned','unequal','css','shift','zero','return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','frame','source','target','contour','node','group','nodes-off','late-source','wrong','children','foreground','retained','missing','release-target','release-source','capture-target','capture-policy-restore','close','target-y','release-policy-restore']as const)
test('sampled root compound anchor canvas drafts capture original rings '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ring=(points:number[][])=>points.map(([x,y],i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];return {x,y,in:{x:x+(prev[0]-x)/5,y:y+(prev[1]-y)/5},out:{x:x+(next[0]-x)/5,y:y+(next[1]-y)/5}};});
 const ink:Vector={id:'curve',kind:'polygon',fillRule:'evenodd',x:0,y:10,width:60,height:60,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:((mode==='reflected')?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[],closed:true,contours:[ring(mode==='unequal'?[[0,0],[60,0],[60,60],[0,60]]:[[0,0],[60,0],[0,60]]),ring([[10,10],[10,30],[30,10]])]};
 if(mode==='missing')delete ink.contours![1][2].in;
 const end={...structuredClone(ink),x:80};if(mode==='aligned')end.contours=[...end.contours!].reverse().map(r=>[r[1],r[0],r[2]].map(n=>({...n,in:n.out,out:n.in})));
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];if(mode==='retained')for(const key of layer.keys)if(key.shapes.length)key.shapes.push({id:'legacy',kind:'bezier',x:key.frame===8?80:0,y:80,width:20,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[{x:0,y:0,in:{x:-5,y:0},out:{x:5,y:0}},{x:20,y:10,in:{x:15,y:10},out:{x:25,y:10}}]});createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true},undefined,undefined,mode==='aligned'?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);layer.keys[8].shapes[0].x+=80;
 if(mode==='overlay'){const extra={...structuredClone(layer),id:'overlay'};extra.motionSpans![0].id='extra-motion';p.layers.push(extra);layer.visible=false;}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const child={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle',x:90,y:10,width:40,height:40,rotation:0,fill:'#00ff00',stroke:'#000000',strokeWidth:0,points:[]}]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),contour=region.getByLabel('Sampled compound anchor contour number'),number=region.getByLabel('Sampled compound anchor node number'),nx=region.getByLabel('Sampled compound anchor document X'),ny=region.getByLabel('Sampled compound anchor document Y'),tool=region.getByLabel('Drag sampled compound anchors'),commit=region.getByRole('button',{name:'Promote and position sampled compound anchor',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));const ci=mode==='outer'?0:1,ni=mode==='outer'?0:2;
 if(mode==='retained'){await region.getByLabel('Sampled compound contour number').fill('2');await region.getByLabel('Sampled compound node number').fill('3');await region.getByLabel('Sampled compound tangent role').selectOption('out');await region.getByLabel('Drag sampled compound tangents').check();await region.getByLabel('Author sampled compound tangent on drag release').check();}
 await tool.check();if(mode==='retained'){await expect(region.getByLabel('Drag sampled compound tangents')).not.toBeChecked();await expect(region.getByLabel('Author sampled compound tangent on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled compound tangent on drag release')).toBeDisabled();}
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],base=shape.contours![ci][ni],anchor=worldPoint(shape,base);cap.dispose();
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='350px';});await stage.scrollIntoViewIfNeeded();const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);let pos=await measure();
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});const start=async()=>{await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);await page.mouse.down();};const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 await expect.poll(()=>pixel(anchor)).toEqual([255,255,255,255]);await start();await page.mouse.up();if(mode==='foreground'){await expect(number).toHaveValue('');await expect(commit).toBeDisabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(contour).toHaveValue(String(ci+1));await expect(number).toHaveValue(String(ni+1));await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);await expect(nx).toHaveValue(String(anchor.x));expect(await read()).toEqual(before);
 const hook=async(kind:string)=>page.evaluate(kind=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(kind.endsWith('source'))(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(kind.endsWith('target')){const el=document.querySelector('input[aria-label="Sampled compound anchor document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Drag sampled compound anchors"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},kind);
 if(mode.startsWith('capture-')){await hook(mode);await start();await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='capture-target')await expect(nx).toHaveValue('111');else await expect(tool).toBeChecked();expect(await read()).toEqual(before);await stage.scrollIntoViewIfNeeded();pos=await measure();await start();await expect(choice).toBeDisabled();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);await page.mouse.up();await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed compound-anchor');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(commit).toBeDisabled();expect(await read()).toEqual(before);if(mode==='zero'){expect(errors).toEqual([]);return;}
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled compound anchor position',exact:true}).click();await expect(status).toContainText('Proposed compound-anchor');await stage.scrollIntoViewIfNeeded();pos=await measure();}
 await start();await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='shift')await page.keyboard.down('Shift');if(mode==='late-source')await hook(mode);
 const redHash=()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255)h=(h*31+i)|0;return h;});const hash=await redHash();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}else{expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();await expect(status).toHaveCount(0);await expect.poll(redHash).not.toBe(hash);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);expect(await read()).toEqual(before);await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return')await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);
 if(['return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','frame','source','target','contour','node','group','close','target-y'].includes(mode)){
  if(mode==='close'){await region.getByRole('button',{name:'Return to authored stage',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());await page.mouse.up();await expect(region).toBeHidden();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
  if(mode==='target-y')await ny.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='contour')await contour.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='target-y'){await expect(ny).toHaveValue('111');await expect(nx).toHaveValue(String(anchor.x));}else if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='contour'){await expect(contour).toHaveValue('1');await expect(number).toHaveValue('');}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed compound-anchor');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}if(mode==='frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},delivered=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(delivered);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 if(mode.startsWith('release-'))await hook(mode);if(mode==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();}await page.mouse.up();await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
 if(mode.startsWith('release-')){await expect(status).toHaveCount(0);if(mode==='release-target')await expect(nx).toHaveValue('111');else if(mode==='release-policy-restore'){await expect(tool).toBeChecked();await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}else{expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed compound-anchor');await expect(nx).toHaveValue(String(point.x));await expect(ny).toHaveValue(String(point.y));await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);await commit.click();await expect(region).toBeHidden();const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=capture.prepareCompoundNodePosition(target,'curve',ci,ni,point);capture.dispose();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],node=authored.contours![ci][ni],world=worldPoint(authored,node);expect(world.x).toBeCloseTo(point.x,9);expect(world.y).toBeCloseTo(point.y,9);for(const part of ['in','out']as const){if(!base[part])expect(node[part]).toBeUndefined();else{const old=worldPoint(shape,base[part]!),next=worldPoint(authored,node[part]!);expect(next.x-world.x).toBeCloseTo(old.x-anchor.x,9);expect(next.y-world.y).toBeCloseTo(old.y-anchor.y,9);}}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['base','outer','overlay','affine','reflected','aligned','unequal','css','shift','zero','return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','frame','source','target','contour','node','group','nodes-off','late-source','wrong','children','foreground','retained','missing','release-target','release-source','capture-target','capture-policy-restore','close','target-y','release-policy-restore','author-policy','draft','release-policy','release-contour','release-node','release-view','release-close','capture-author-policy','capture-author-policy-restore']as const)
test('sampled root compound anchor direct release admits original rings '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const layer=p.layers[0];layer.id='base';layer.drawingMode='object';
 const ring=(points:number[][])=>points.map(([x,y],i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];return {x,y,in:{x:x+(prev[0]-x)/5,y:y+(prev[1]-y)/5},out:{x:x+(next[0]-x)/5,y:y+(next[1]-y)/5}};});
 const ink:Vector={id:'curve',kind:'polygon',fillRule:'evenodd',x:0,y:10,width:60,height:60,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:((mode==='reflected')?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[],closed:true,contours:[ring(mode==='unequal'?[[0,0],[60,0],[60,60],[0,60]]:[[0,0],[60,0],[0,60]]),ring([[10,10],[10,30],[30,10]])]};
 if(mode==='missing')delete ink.contours![1][2].in;
 const end={...structuredClone(ink),x:80};if(mode==='aligned')end.contours=[...end.contours!].reverse().map(r=>[r[1],r[0],r[2]].map(n=>({...n,in:n.out,out:n.in})));
 layer.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];if(mode==='retained')for(const key of layer.keys)if(key.shapes.length)key.shapes.push({id:'legacy',kind:'bezier',x:key.frame===8?80:0,y:80,width:20,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],nodes:[{x:0,y:0,in:{x:-5,y:0},out:{x:5,y:0}},{x:20,y:10,in:{x:15,y:10},out:{x:25,y:10}}]});createBasicMotionSpan(p,['base'],0,8,'linear',{nodes:mode!=='nodes-off',affine:true},undefined,undefined,mode==='aligned'?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);layer.keys[8].shapes[0].x+=80;
 if(mode==='overlay'){const extra={...structuredClone(layer),id:'overlay'};extra.motionSpans![0].id='extra-motion';p.layers.push(extra);layer.visible=false;}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const child={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{id:'cover',kind:'rectangle',x:90,y:10,width:40,height:40,rotation:0,fill:'#00ff00',stroke:'#000000',strokeWidth:0,points:[]}]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),target=mode==='overlay'?'overlay':'base';
 await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
 const stage=page.getByLabel('Drawing stage'),region=page.getByRole('region',{name:'Sampled motion stage'}),choice=region.getByLabel('Sampled stage artwork'),contour=region.getByLabel('Sampled compound anchor contour number'),number=region.getByLabel('Sampled compound anchor node number'),nx=region.getByLabel('Sampled compound anchor document X'),ny=region.getByLabel('Sampled compound anchor document Y'),tool=region.getByLabel('Drag sampled compound anchors'),commit=region.getByRole('button',{name:'Promote and position sampled compound anchor',exact:true}),status=region.getByRole('status');
 if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'curve']));const ci=mode==='outer'?0:1,ni=mode==='outer'?0:2;
 if(mode==='retained'){await region.getByLabel('Sampled compound contour number').fill('2');await region.getByLabel('Sampled compound node number').fill('3');await region.getByLabel('Sampled compound tangent role').selectOption('out');await region.getByLabel('Drag sampled compound tangents').check();await region.getByLabel('Author sampled compound tangent on drag release').check();}
 await tool.check();const author=region.getByLabel('Author sampled compound anchor on drag release');await expect(author).not.toBeChecked();if(mode!=='retained'&&mode!=='draft')await author.check();if(mode==='retained'){await expect(region.getByLabel('Drag sampled compound tangents')).not.toBeChecked();await expect(region.getByLabel('Author sampled compound tangent on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled compound tangent on drag release')).toBeDisabled();}
 const cap=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),shape=cap.scene.find(t=>t.layerId===target)!.key.shapes[0],base=shape.contours![ci][ni],anchor=worldPoint(shape,base);cap.dispose();
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='350px';});await stage.scrollIntoViewIfNeeded();const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},anchor);let pos=await measure();
 await stage.evaluate(el=>{for(const type of ['pointerdown','pointermove','pointerup'])el.addEventListener(type,e=>{const p=e as PointerEvent;if(p.pointerId===1)(el as HTMLElement).dataset[type]=JSON.stringify({x:p.clientX,y:p.clientY,shift:p.shiftKey});},true);});const start=async()=>{await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);await page.mouse.down();};const pixel=(point:{x:number;y:number})=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);
 await expect.poll(()=>pixel(anchor)).toEqual([255,255,255,255]);await start();await page.mouse.up();if(mode==='foreground'){await expect(number).toHaveValue('');await expect(commit).toBeDisabled();await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(contour).toHaveValue(String(ci+1));await expect(number).toHaveValue(String(ni+1));await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);await expect(nx).toHaveValue(String(anchor.x));expect(await read()).toEqual(before);
 const hook=async(kind:string)=>page.evaluate(kind=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(kind.endsWith('source'))(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(kind.endsWith('target')){const el=document.querySelector('input[aria-label="Sampled compound anchor document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(kind==='release-contour'||kind==='release-node'){const el=document.querySelector(`input[aria-label="${kind==='release-contour'?'Sampled compound anchor contour number':'Sampled compound anchor node number'}"]`)as HTMLInputElement;el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));}else if(kind==='release-view')(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).style.width='700px';else if(kind==='release-close')([...document.querySelectorAll('button')].find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();else{const el=document.querySelector(`input[aria-label="${kind.includes('author')||kind.startsWith('release-')?'Author sampled compound anchor on drag release':'Drag sampled compound anchors'}"]`)as HTMLInputElement;for(const checked of (kind==='release-policy'||kind==='capture-author-policy'?[false]:[false,true])){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},kind);
 if(mode.startsWith('capture-')){await hook(mode);await start();await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='capture-target')await expect(nx).toHaveValue('111');else if(mode==='capture-author-policy')await expect(author).not.toBeChecked();else await expect(author).toBeChecked();expect(await read()).toEqual(before);await author.uncheck();await stage.scrollIntoViewIfNeeded();pos=await measure();await start();await expect(choice).toBeDisabled();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);await page.mouse.up();await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed compound-anchor');expect(await read()).toEqual(before);await author.check();await stage.scrollIntoViewIfNeeded();pos=await measure();await start();await expect(choice).toBeDisabled();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);await page.mouse.up();await expect(region).toBeHidden();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}

 await start();await expect(choice).toBeDisabled();await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(commit).toBeDisabled();expect(await read()).toEqual(before);if(mode==='zero'){expect(errors).toEqual([]);return;}
 if(mode==='prior'){await nx.fill(String(anchor.x+8));await ny.fill(String(anchor.y+5));await region.getByRole('button',{name:'Preview sampled compound anchor position',exact:true}).click();await expect(status).toContainText('Proposed compound-anchor');await stage.scrollIntoViewIfNeeded();pos=await measure();}
 await start();await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='shift')await page.keyboard.down('Shift');if(mode==='late-source')await hook(mode);
 const redHash=()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255)h=(h*31+i)|0;return h;});const hash=await redHash();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);
 if(mode==='nodes-off'||mode==='late-source'){await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await expect(page.getByRole('alert')).toBeVisible();expect((await read()).layers.find(l=>l.id===target)).toEqual(before.layers.find(l=>l.id===target));if(mode==='late-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();}else{expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(choice).toBeDisabled();await expect(status).toHaveCount(0);await expect.poll(redHash).not.toBe(hash);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);expect(await read()).toEqual(before);await stage.dispatchEvent('pointercancel',{pointerId:999});await expect(choice).toBeDisabled();
 if(mode==='return')await page.mouse.move(pos.x+.2*pos.rx,pos.y+.1*pos.ry);
 if(['return','cancel','prior','pointercancel','lost','blur','resize','scroll','policy','frame','source','target','contour','node','group','close','target-y','author-policy'].includes(mode)){
  if(mode==='author-policy')await author.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
  if(mode==='close'){await region.getByRole('button',{name:'Return to authored stage',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());await page.mouse.up();await expect(region).toBeHidden();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
  if(mode==='target-y')await ny.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});
  if(mode==='cancel'||mode==='prior')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='700px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='policy')await tool.evaluate(el=>{(el as HTMLInputElement).checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='frame')await page.getByRole('button',{name:'Next frame',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='target')await nx.evaluate(el=>{(el as HTMLInputElement).value='111';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='contour')await contour.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='node')await number.evaluate(el=>{(el as HTMLInputElement).value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{(el as HTMLInputElement).checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.mouse.up();await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode==='target-y'){await expect(ny).toHaveValue('111');await expect(nx).toHaveValue(String(anchor.x));}else if(mode==='target'){await expect(nx).toHaveValue('111');await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='contour'){await expect(contour).toHaveValue('1');await expect(number).toHaveValue('');}else if(mode==='node')await expect(number).toHaveValue('1');else if(mode==='prior'){await expect(nx).toHaveValue(String(anchor.x+8));await expect(ny).toHaveValue(String(anchor.y+5));await expect(status).toContainText('Proposed compound-anchor');}else if(!['source','frame','group'].includes(mode)){await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}if(mode==='frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();if(mode==='source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}expect(await read()).toEqual(before);if(mode==='author-policy'){await expect(author).not.toBeChecked();await stage.scrollIntoViewIfNeeded();pos=await measure();await start();await expect(choice).toBeDisabled();await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);await page.mouse.up();await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed compound-anchor');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;
 }
 const down=JSON.parse((await stage.getAttribute('data-pointerdown'))!)as{x:number;y:number},delivered=JSON.parse((await stage.getAttribute('data-pointermove'))!)as{x:number;y:number},local=(p:{x:number;y:number})=>({x:(p.x-pos.left)*pos.w/pos.cw-(pos.w-200)/2,y:(p.y-pos.top)*pos.h/pos.ch-(pos.h-100)/2}),a=local(down),b=local(delivered);let dx=b.x-a.x,dy=b.y-a.y;if(mode==='shift'){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const point={x:anchor.x+dx,y:anchor.y+dy};
 if(mode.startsWith('release-'))await hook(mode);if(mode==='wrong'){await stage.dispatchEvent('pointerup',{pointerId:999});await expect(choice).toBeDisabled();}await page.mouse.up();await page.keyboard.up('Shift');expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
 if(mode.startsWith('release-')){if(mode==='release-close')await expect(region).toBeHidden();else{await expect(region).toBeVisible();await expect(status).toHaveCount(0);if(mode==='release-target')await expect(nx).toHaveValue('111');else if(mode==='release-policy'||mode==='release-policy-restore'){await expect(author).toBeChecked({checked:mode==='release-policy-restore'});await expect(nx).toHaveValue(String(anchor.x));await expect(ny).toHaveValue(String(anchor.y));}else if(mode==='release-contour')await expect(contour).toHaveValue('1');else if(mode==='release-node')await expect(number).toHaveValue('1');else if(mode==='release-source'){expect((await read()).layers).toHaveLength(before.layers.length+1);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');}}expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='retained'||mode==='draft'){await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed compound-anchor');await expect(nx).toHaveValue(String(point.x));await expect(ny).toHaveValue(String(point.y));await expect.poll(()=>pixel(anchor)).toEqual([0,126,170,255]);expect(await read()).toEqual(before);await commit.click();}await expect(region).toBeHidden();await expect(page.getByText('1 anchors selected',{exact:true})).toBeVisible();if(['base','overlay','unequal'].includes(mode))await expect.poll(()=>pixel(point)).toEqual([146,117,255,255]);const result=await read(),capture=captureRememberedNodeAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=capture.prepareCompoundNodePosition(target,'curve',ci,ni,point);capture.dispose();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],node=authored.contours![ci][ni],world=worldPoint(authored,node);expect(world.x).toBeCloseTo(point.x,9);expect(world.y).toBeCloseTo(point.y,9);for(const part of ['in','out']as const){if(!base[part])expect(node[part]).toBeUndefined();else{const old=worldPoint(shape,base[part]!),next=worldPoint(authored,node[part]!);expect(next.x-world.x).toBeCloseTo(old.x-anchor.x,9);expect(next.y-world.y).toBeCloseTo(old.y-anchor.y,9);}}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['base','direct','default','mixed','affine','reflected','compound','extra','separate','children','retained','reset','discard','invalid','disabled','overflow','preview-target','preview-source','late-target','late-pick','late-group','late-frame','late-close','late-source'])test('sampled root numeric pivots retain original ownership '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const l=p.layers[0];l.id='base';l.drawingMode='object';const shape:Vector={id:'art',kind:mode==='compound'?'polygon':mode==='retained'?'bezier':'rectangle',x:0,y:10,width:30,height:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),...(mode==='default'||mode==='mixed'?{}:{pivot:{x:3,y:4}}),fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};if(mode==='retained')shape.nodes=[{x:0,y:0,out:{x:5,y:0}},{x:30,y:20,in:{x:25,y:20}}];if(mode==='compound'){shape.fillRule='evenodd';shape.contours=[[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}],[{x:5,y:5},{x:5,y:10},{x:10,y:5}]];}const end={...structuredClone(shape),x:80,...(mode==='mixed'?{pivot:{x:9,y:12}}:{})};l.keys=[{frame:0,shapes:[shape]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{affine:true,pivots:mode!=='disabled',...(mode==='default'||mode==='mixed'?{defaultPivots:true}:{})});l.keys[8].shapes[0].x+=80;let target='base';if(mode==='extra'){const extra=structuredClone(l);extra.id='extra';extra.motionSpans![0].id='extra-span';p.layers.push(extra);l.visible=false;target='extra';}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const child={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[child];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),x=region.getByLabel('Sampled pivot document X'),y=region.getByLabel('Sampled pivot document Y'),preview=region.getByRole('button',{name:'Preview sampled pivot position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled pivot',exact:true}),status=region.getByRole('status');if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'art']));if(mode==='retained'){await region.getByLabel('Sampled Bezier node number').fill('1');await region.getByLabel('Sampled Bezier node number').press('Tab');await region.getByLabel('Drag sampled Bezier nodes').check();await region.getByLabel('Author sampled node on drag release').check();}await region.getByRole('button',{name:'Select original sampled pivot',exact:true}).click();await expect(commit).toBeDisabled();expect(await read()).toEqual(before);if(mode==='retained'){await expect(region.getByLabel('Drag sampled Bezier nodes')).not.toBeChecked();await expect(region.getByLabel('Author sampled node on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled node on drag release')).toBeDisabled();}const originalCapture=captureRememberedPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=originalCapture.scene.find(t=>t.layerId===target)!.key.shapes[0],initial=worldPoint(original,original.pivot!);originalCapture.dispose();await expect(x).toHaveValue(String(initial.x));await expect(y).toHaveValue(String(initial.y));const redHash=()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255)h=(h*31+i)|0;return h;}),hash=await redHash();const point={x:mode==='overflow'?1e308:-55,y:207};
 if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}if(mode==='invalid'){await x.fill('');await expect(commit).toBeDisabled();}
 await x.fill(String(point.x));await y.fill(String(point.y));const arm=async(action:string)=>page.evaluate(action=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(action==='source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(action==='close')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();else if(action==='frame')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Next frame')as HTMLButtonElement).click();else if(action==='pick'){const el=document.querySelector('select[aria-label="Sampled stage artwork"]')as HTMLSelectElement;el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(action==='group'){const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Sampled pivot document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}}return result;})as typeof structuredClone;},action);
 if(mode.startsWith('preview-'))await arm(mode.slice(8));if(mode!=='direct'){await preview.click();if(mode==='disabled'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(mode.startsWith('preview-')){await expect(status).toHaveCount(0);if(mode==='preview-target')await expect(x).toHaveValue('111');else expect((await read()).layers).toHaveLength(before.layers.length+1);expect(errors).toEqual([]);return;}await expect(status).toContainText('Proposed pivot');expect(await read()).toEqual(before);await expect.poll(redHash).toBe(hash);if(mode==='children')await expect.poll(()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(75-100)*devicePixelRatio,c.height/2+(62-50)*devicePixelRatio,1,1).data];})).toEqual([0,0,255,255]);}
 if(mode==='reset'){await x.fill('-54');await expect(status).toHaveCount(0);await choice.selectOption('');await expect(x).toHaveCount(0);await choice.selectOption(JSON.stringify([target,'art']));await expect(x).toHaveValue('');await expect(x).toBeDisabled();expect(await read()).toEqual(before);return;}if(mode==='discard'){await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await expect(x).toHaveValue('-55');await preview.click();await expect(status).toContainText('Proposed pivot');}
 if(mode.startsWith('late-')){await arm(mode.slice(5));await commit.click();if(mode==='late-source')expect((await read()).layers).toHaveLength(before.layers.length+1);else expect(await read()).toEqual(before);if(mode==='late-target')await expect(x).toHaveValue('111');if(mode==='late-pick')await expect(choice).toHaveValue('');if(mode==='late-group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();if(mode==='late-close')await expect(region).toBeHidden();if(mode==='late-frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');expect(errors).toEqual([]);return;}
 const cap=captureRememberedPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=cap.preparePivotPosition(target,'art',point);cap.dispose();await commit.click();await expect(region).toBeHidden();await expect(page.getByLabel('Pivot X',{exact:true})).toHaveValue('-55');await expect(page.getByLabel('Pivot Y',{exact:true})).toHaveValue('207');const result=await read();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));const authored=result.layers.find(l=>l.id===target)!.keys[4].shapes[0],actual=worldPoint(authored,authored.pivot!);expect(actual.x).toBeCloseTo(point.x,9);expect(actual.y).toBeCloseTo(point.y,9);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});

for(const mode of ['saved','default','requires','unchanged'])test('remembered pivot recipe opt-ins remain explicit '+mode,async({page})=>{const p=newProject();p.duration=12;const shape:Vector={id:'art',kind:'rectangle',x:0,y:10,width:30,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(mode==='saved'||mode==='unchanged'?{pivot:{x:3,y:4}}:{})},end={...structuredClone(shape),x:80,...(mode==='saved'?{pivot:{x:9,y:12}}:{})};p.layers[0].keys=[{frame:0,shapes:[shape]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read(),timeline=page.getByLabel('Timeline frames');await timeline.click({position:{x:9,y:40}});await page.keyboard.down('Shift');await timeline.click({position:{x:153,y:40}});await page.keyboard.up('Shift');if(mode==='saved'||mode==='default')await page.getByLabel('Remembered motion saved pivots').check();if(mode==='default'||mode==='requires')await page.getByLabel('Remembered motion default pivots').check();await page.getByRole('button',{name:'Create remembered motion',exact:true}).click();if(mode==='requires'){await expect(page.getByRole('alert')).toBeVisible();expect(await read()).toEqual(before);return;}const result=await read(),span=result.layers[0].motionSpans![0];expect(span.options?.pivots).toBe(mode==='unchanged'?undefined:true);expect(span.options?.defaultPivots).toBe(mode==='default'?true:undefined);expect(result.layers[0].keys.filter(k=>[0,8,10].includes(k.frame))).toEqual(before.layers[0].keys);await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);});

for(const mode of ['base','default','mixed','affine','reflected','compound','extra','css','shift','offset','zero','return','escape','pointercancel','lost','blur','resize','scroll','zoom','policy','policy-restore','target','prior','prior-policy','disabled','foreground','late-source','release-source','capture-target','capture-policy-restore','children','retained','release-target','release-policy-restore','frame','group','pick','original-picks'])test('sampled root pivot canvas drafts preserve original capture '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const l=p.layers[0];l.id='base';l.drawingMode='object';const ink:Vector={id:'art',kind:mode==='compound'?'polygon':mode==='retained'?'bezier':'rectangle',x:0,y:10,width:60,height:50,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-1,.2,.2,1]:[1,.2,.2,1])as[number,number,number,number]}:{}),...(mode==='default'||mode==='mixed'?{}:{pivot:{x:20,y:20}}),fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};if(mode==='retained'){ink.closed=true;ink.nodes=[{x:0,y:0,out:{x:10,y:0}},{x:60,y:0,in:{x:50,y:0}},{x:0,y:50}];}if(mode==='compound'){ink.fillRule='evenodd';ink.contours=[[{x:0,y:0},{x:60,y:0},{x:60,y:50},{x:0,y:50}],[{x:5,y:5},{x:5,y:10},{x:10,y:5}]];}const end={...structuredClone(ink),x:80,...(mode==='mixed'?{pivot:{x:10,y:10}}:{})};l.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{affine:true,pivots:mode!=='disabled',...(mode==='default'||mode==='mixed'?{defaultPivots:true}:{})});l.keys[8].shapes[0].x+=80;let track='base';if(mode==='extra'){const extra=structuredClone(l);extra.id='extra';extra.motionSpans![0].id='extra-span';p.layers.push(extra);l.visible=false;track='extra';}if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{...ink,id:'cover',x:90,y:20,width:40,height:30,fill:'#00ff00'}]}]});
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const definition={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[definition];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Drag sampled pivots'),x=region.getByLabel('Sampled pivot document X'),y=region.getByLabel('Sampled pivot document Y'),status=region.getByRole('status'),commit=region.getByRole('button',{name:'Promote and position sampled pivot',exact:true});if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([track,'art']));if(mode==='retained'){await region.getByLabel('Sampled Bezier node number').fill('1');await region.getByLabel('Sampled Bezier node number').press('Tab');await region.getByLabel('Drag sampled Bezier nodes').check();await region.getByLabel('Author sampled node on drag release').check();}await region.getByRole('button',{name:'Select original sampled pivot',exact:true}).click();await tool.check();if(mode==='retained'){await expect(region.getByLabel('Drag sampled Bezier nodes')).not.toBeChecked();await expect(region.getByLabel('Author sampled node on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled node on drag release')).toBeDisabled();}const capture=captureRememberedPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=capture.scene.find(t=>t.layerId===track)!.key.shapes[0],pivot=worldPoint(original,original.pivot!);capture.dispose();const prior=mode==='prior'||mode==='prior-policy'||mode==='original-picks',priorPoint={x:pivot.x+(mode==='original-picks'?30:5),y:pivot.y+(mode==='original-picks'?30:7)};if(prior){await x.fill(String(priorPoint.x));await y.fill(String(priorPoint.y));await region.getByRole('button',{name:'Preview sampled pivot position',exact:true}).click();await expect(status).toContainText('Proposed pivot');}
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='90px';});await stage.scrollIntoViewIfNeeded();const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},pivot);const pos=await measure();const offset=mode==='offset'?{x:3,y:-2}:{x:0,y:0},start=()=>page.mouse.move(pos.x+offset.x,pos.y+offset.y),pixel=(point:Point)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);await expect.poll(()=>pixel(pivot)).toEqual(prior?[255,255,255,255]:[255,191,102,255]);
 if(mode==='capture-target'||mode==='capture-policy-restore')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='capture-target'){const input=document.querySelector('input[aria-label="Sampled pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Drag sampled pivots"]')as HTMLInputElement;for(const checked of [false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 await stage.evaluate(el=>{for(const name of ['pointerdown','pointermove'])el.addEventListener(name,event=>{const e=event as PointerEvent;(el as HTMLElement).dataset[name]=JSON.stringify({x:e.clientX,y:e.clientY,shift:e.shiftKey});},true);});if(mode==='original-picks'){await page.mouse.move(pos.x+30*pos.rx,pos.y+30*pos.ry);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();await expect(status).toContainText('Proposed pivot');}await start();await page.mouse.down();if(mode==='foreground'||mode.startsWith('capture-')){expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);if(mode==='capture-target')await expect(x).toHaveValue('111');if(mode.startsWith('capture-')){await stage.scrollIntoViewIfNeeded();Object.assign(pos,await measure());await start();await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);await page.mouse.up();await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed pivot');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;}await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='zero'){await page.mouse.up();await expect(status).toHaveCount(0);await expect(x).toHaveValue(String(pivot.x));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 const dx=8,dy=20;const point={x:pivot.x+(mode==='shift'?0:dx),y:pivot.y+dy};if(mode==='shift')await page.keyboard.down('Shift');await page.mouse.move(pos.x+offset.x+dx*pos.rx,pos.y+offset.y+dy*pos.ry);const delivered=await stage.evaluate(el=>({start:JSON.parse((el as HTMLElement).dataset.pointerdown!),end:JSON.parse((el as HTMLElement).dataset.pointermove!)}));const local=(p:Point)=>({x:((p.x-pos.left)*pos.w/pos.cw-(pos.w/2-100)),y:((p.y-pos.top)*pos.h/pos.ch-(pos.h/2-50))}),from=local(delivered.start),to=local(delivered.end);let deliveredX=to.x-from.x,deliveredY=to.y-from.y;if(delivered.end.shift){if(Math.abs(deliveredX)>=Math.abs(deliveredY))deliveredY=0;else deliveredX=0;}point.x=pivot.x+deliveredX;point.y=pivot.y+deliveredY;if(mode==='disabled'){await page.mouse.up();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(x).toHaveValue(String(point.x));await expect(y).toHaveValue(String(point.y));expect(await read()).toEqual(before);await expect.poll(()=>pixel(point)).toEqual([255,191,102,255]);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);
 if(mode==='late-source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='release-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 if(mode==='release-target'||mode==='release-policy-restore')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='release-target'){const input=document.querySelector('input[aria-label="Sampled pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Drag sampled pivots"]')as HTMLInputElement;for(const checked of [false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 const cancel=['return','escape','pointercancel','lost','blur','resize','scroll','zoom','policy','policy-restore','target','prior','prior-policy','release-target','release-policy-restore','frame','group','pick','original-picks'].includes(mode);if(mode==='return')await page.mouse.move(pos.x,pos.y);if(mode==='escape'||mode==='prior'||mode==='original-picks')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1,bubbles:true});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='600px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');if(mode==='policy'||mode==='prior-policy')await tool.evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='policy-restore')await page.evaluate(()=>{const el=document.querySelector('input[aria-label="Drag sampled pivots"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}});if(mode==='target')await x.evaluate(el=>{const input=el as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='frame')await page.getByLabel('Go to frame',{exact:true}).evaluate(el=>{const input=el as HTMLInputElement;input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{const input=el as HTMLInputElement;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='pick')await choice.evaluate(el=>{const input=el as HTMLSelectElement;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();if(mode==='shift')await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
 if(mode==='late-source'||mode==='release-source'){await expect(status).toHaveCount(0);const after=await read();expect(after.layers).toHaveLength(before.layers.length+1);expect(after.layers[0]).toEqual(before.layers[0]);expect(errors).toEqual([]);return;}if(['frame','group','pick'].includes(mode)){await expect(x).toHaveCount(0);await expect(status).toHaveCount(0);if(mode==='frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='group')await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(cancel){await expect(x).toHaveValue(String(mode==='target'||mode==='release-target'?111:prior?priorPoint.x:pivot.x));await expect(y).toHaveValue(String(prior?priorPoint.y:pivot.y));if(prior)await expect(status).toContainText('Proposed pivot');else await expect(status).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed pivot');expect(await read()).toEqual(before);const own=captureRememberedPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=own.preparePivotPosition(track,'art',point);own.dispose();await commit.click();await expect(region).toBeHidden();const after=await read();expect(after.layers.find(l=>l.id===track)!.keys).toEqual(wanted.layers.find(l=>l.id===track)!.keys);expect(after.layers.find(l=>l.id===track)!.motionSpans!.map(({id:_id,...span})=>span)).toEqual(wanted.layers.find(l=>l.id===track)!.motionSpans!.map(({id:_id,...span})=>span));expect(after.layers.filter(l=>l.id!==track)).toEqual(before.layers.filter(l=>l.id!==track));expect(after.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(after);expect(errors).toEqual([]);
});

for(const mode of ['base', 'default', 'mixed', 'affine', 'reflected', 'compound', 'extra', 'css', 'shift', 'offset', 'zero', 'return', 'escape', 'pointercancel', 'lost', 'blur', 'resize', 'scroll', 'zoom', 'policy', 'policy-restore', 'target', 'prior', 'prior-policy', 'original-picks', 'disabled', 'foreground', 'late-source', 'release-source', 'capture-target', 'capture-policy-restore', 'children', 'retained', 'release-target', 'release-policy-restore', 'frame', 'group', 'pick', 'draft', 'draft-retained', 'author-policy', 'capture-author-policy', 'capture-author-restore', 'release-author-policy', 'release-author-restore', 'release-pick', 'release-group', 'release-frame', 'release-close', 'release-view', 'late-authored-author-restore', 'late-authored-target', 'late-authored-source'])test('sampled root pivot direct release admits fresh authoring '+mode,async({page})=>{
 const p=newProject();p.width=200;p.height=100;p.duration=12;const l=p.layers[0];l.id='base';l.drawingMode='object';const ink:Vector={id:'art',kind:mode==='compound'?'polygon':(mode==='retained'||mode==='draft-retained')?'bezier':'rectangle',x:0,y:10,width:60,height:50,rotation:mode==='affine'||mode==='reflected'?30:0,...(mode==='affine'||mode==='reflected'?{transform:(mode==='reflected'?[-1,.2,.2,1]:[1,.2,.2,1])as[number,number,number,number]}:{}),...(mode==='default'||mode==='mixed'?{}:{pivot:{x:20,y:20}}),fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};if(mode==='retained'||mode==='draft-retained'){ink.closed=true;ink.nodes=[{x:0,y:0,out:{x:10,y:0}},{x:60,y:0,in:{x:50,y:0}},{x:0,y:50}];}if(mode==='compound'){ink.fillRule='evenodd';ink.contours=[[{x:0,y:0},{x:60,y:0},{x:60,y:50},{x:0,y:50}],[{x:5,y:5},{x:5,y:10},{x:10,y:5}]];}const end={...structuredClone(ink),x:80,...(mode==='mixed'?{pivot:{x:10,y:10}}:{})};l.keys=[{frame:0,shapes:[ink]},{frame:8,shapes:[end]},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{affine:true,pivots:mode!=='disabled',...(mode==='default'||mode==='mixed'?{defaultPivots:true}:{})});l.keys[8].shapes[0].x+=80;let track='base';if(mode==='extra'){const extra=structuredClone(l);extra.id='extra';extra.motionSpans![0].id='extra-span';p.layers.push(extra);l.visible=false;track='extra';}if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{...ink,id:'cover',x:90,y:20,width:40,height:30,fill:'#00ff00'}]}]});
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;const definition={id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}};p.symbols=[definition];p.layers.push({id:'child-track',name:'Child',visible:true,locked:false,keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Drag sampled pivots'),x=region.getByLabel('Sampled pivot document X'),y=region.getByLabel('Sampled pivot document Y'),status=region.getByRole('status'),commit=region.getByRole('button',{name:'Promote and position sampled pivot',exact:true});if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([track,'art']));if(mode==='retained'||mode==='draft-retained'){await region.getByLabel('Sampled Bezier node number').fill('1');await region.getByLabel('Sampled Bezier node number').press('Tab');await region.getByLabel('Drag sampled Bezier nodes').check();await region.getByLabel('Author sampled node on drag release').check();}await region.getByRole('button',{name:'Select original sampled pivot',exact:true}).click();await tool.check();const release=region.getByLabel('Author sampled pivot on drag release');if(mode!=='draft'&&mode!=='draft-retained')await release.check();if(mode==='retained'||mode==='draft-retained'){await expect(region.getByLabel('Drag sampled Bezier nodes')).not.toBeChecked();await expect(region.getByLabel('Author sampled node on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled node on drag release')).toBeDisabled();}const capture=captureRememberedPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=capture.scene.find(t=>t.layerId===track)!.key.shapes[0],pivot=worldPoint(original,original.pivot!);capture.dispose();const prior=mode==='prior'||mode==='prior-policy'||mode==='original-picks',priorPoint={x:pivot.x+(mode==='original-picks'?30:5),y:pivot.y+(mode==='original-picks'?30:7)};if(prior){await x.fill(String(priorPoint.x));await y.fill(String(priorPoint.y));await region.getByRole('button',{name:'Preview sampled pivot position',exact:true}).click();await expect(status).toContainText('Proposed pivot');}
 const published=async(point:Point)=>{await expect(region).toBeHidden();const own=captureRememberedPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=own.preparePivotPosition(track,'art',point);own.dispose();const after=await read();expect(after.layers.find(l=>l.id===track)!.keys).toEqual(wanted.layers.find(l=>l.id===track)!.keys);expect(after.layers.find(l=>l.id===track)!.motionSpans!.map(({id:_id,...span})=>span)).toEqual(wanted.layers.find(l=>l.id===track)!.motionSpans!.map(({id:_id,...span})=>span));expect(after.layers.filter(l=>l.id!==track)).toEqual(before.layers.filter(l=>l.id!==track));expect(after.symbols).toEqual(before.symbols);await expect(page.getByLabel('Pivot X',{exact:true})).toHaveValue(String(Math.round(point.x*100)/100));await expect(page.getByLabel('Pivot Y',{exact:true})).toHaveValue(String(Math.round(point.y*100)/100));await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(after);};
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='90px';});await stage.scrollIntoViewIfNeeded();const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-100)*r.width/w,y:r.top+(h/2+p.y-50)*r.height/h,rx:r.width/w,ry:r.height/h};},pivot);const pos=await measure();const offset=mode==='offset'?{x:3,y:-2}:{x:0,y:0},start=()=>page.mouse.move(pos.x+offset.x,pos.y+offset.y),pixel=(point:Point)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-100)*devicePixelRatio,c.height/2+(p.y-50)*devicePixelRatio,1,1).data];},point);await expect.poll(()=>pixel(pivot)).toEqual(prior?[255,255,255,255]:[255,191,102,255]);
 if(mode.startsWith('capture-'))await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='capture-target'){const input=document.querySelector('input[aria-label="Sampled pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector(`input[aria-label="${mode.includes('author')?'Author sampled pivot on drag release':'Drag sampled pivots'}"]`)as HTMLInputElement;for(const checked of mode==='capture-author-policy'?[false]:[false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 await stage.evaluate(el=>{for(const name of ['pointerdown','pointermove'])el.addEventListener(name,event=>{const e=event as PointerEvent;(el as HTMLElement).dataset[name]=JSON.stringify({x:e.clientX,y:e.clientY,shift:e.shiftKey});},true);});if(mode==='original-picks'){await page.mouse.move(pos.x+30*pos.rx,pos.y+30*pos.ry);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();await expect(status).toContainText('Proposed pivot');}await start();await page.mouse.down();if(mode==='foreground'||mode.startsWith('capture-')){expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);if(mode==='capture-target')await expect(x).toHaveValue('111');if(mode.startsWith('capture-')){await stage.scrollIntoViewIfNeeded();Object.assign(pos,await measure());await start();await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);const point={x:Number(await x.inputValue()),y:Number(await y.inputValue())},author=await release.isChecked();await page.mouse.up();if(author)await published(point);else{await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed pivot');expect(await read()).toEqual(before);}}expect(errors).toEqual([]);return;}await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='zero'){await page.mouse.up();await expect(status).toHaveCount(0);await expect(x).toHaveValue(String(pivot.x));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 const dx=8,dy=20;const point={x:pivot.x+(mode==='shift'?0:dx),y:pivot.y+dy};if(mode==='shift')await page.keyboard.down('Shift');await page.mouse.move(pos.x+offset.x+dx*pos.rx,pos.y+offset.y+dy*pos.ry);const delivered=await stage.evaluate(el=>({start:JSON.parse((el as HTMLElement).dataset.pointerdown!),end:JSON.parse((el as HTMLElement).dataset.pointermove!)}));const local=(p:Point)=>({x:((p.x-pos.left)*pos.w/pos.cw-(pos.w/2-100)),y:((p.y-pos.top)*pos.h/pos.ch-(pos.h/2-50))}),from=local(delivered.start),to=local(delivered.end);let deliveredX=to.x-from.x,deliveredY=to.y-from.y;if(delivered.end.shift){if(Math.abs(deliveredX)>=Math.abs(deliveredY))deliveredY=0;else deliveredX=0;}point.x=pivot.x+deliveredX;point.y=pivot.y+deliveredY;if(mode==='disabled'){await page.mouse.up();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(x).toHaveValue(String(point.x));await expect(y).toHaveValue(String(point.y));expect(await read()).toEqual(before);await expect.poll(()=>pixel(point)).toEqual([255,191,102,255]);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);
 if(mode==='late-source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='release-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 if(mode.startsWith('release-')&&mode!=='release-source')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='release-target'){const input=document.querySelector('input[aria-label="Sampled pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='release-view'){(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).style.transform='translateY(1px)';}else if(mode==='release-pick'){const input=document.querySelector('select[aria-label="Sampled stage artwork"]')as HTMLSelectElement;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-frame'){const input=document.querySelector('input[aria-label="Go to frame"]')as HTMLInputElement;input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-group'){const input=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-close'){(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();}else{const input=document.querySelector(`input[aria-label="${mode.includes('author')?'Author sampled pivot on drag release':'Drag sampled pivots'}"]`)as HTMLInputElement;for(const checked of mode==='release-author-policy'?[false]:[false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 if(mode.startsWith('late-authored-'))await page.evaluate(({mode,x,y})=>{const stringify=JSON.stringify;JSON.stringify=((value:unknown,replacer?:unknown,space?:string|number)=>{const result=stringify(value,replacer as never,space),shape=value as {id?:string;pivot?:{x:number;y:number}};if(shape?.id==='art'&&shape.pivot?.x===x&&shape.pivot?.y===y){JSON.stringify=stringify;(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).dataset.pivotReleaseHook='yes';if(mode==='late-authored-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-authored-target'){const input=document.querySelector('input[aria-label="Sampled pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Author sampled pivot on drag release"]')as HTMLInputElement;for(const checked of [false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof JSON.stringify;},{mode,x:point.x-80,y:point.y-10});
 const cancel=['return','escape','pointercancel','lost','blur','resize','scroll','zoom','policy','policy-restore','target','prior','prior-policy','release-target','release-policy-restore','frame','group','pick','original-picks','author-policy','release-author-policy','release-author-restore','release-view','late-authored-author-restore','late-authored-target'].includes(mode);if(mode==='author-policy')await release.evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='return')await page.mouse.move(pos.x,pos.y);if(mode==='escape'||mode==='prior'||mode==='original-picks')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1,bubbles:true});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='600px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');if(mode==='policy'||mode==='prior-policy')await tool.evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='policy-restore')await page.evaluate(()=>{const el=document.querySelector('input[aria-label="Drag sampled pivots"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}});if(mode==='target')await x.evaluate(el=>{const input=el as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='frame')await page.getByLabel('Go to frame',{exact:true}).evaluate(el=>{const input=el as HTMLInputElement;input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{const input=el as HTMLInputElement;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='pick')await choice.evaluate(el=>{const input=el as HTMLSelectElement;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();if(mode==='shift')await page.keyboard.up('Shift');if(await region.isVisible())await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode.startsWith('late-authored-'))await expect(stage).toHaveAttribute('data-pivot-release-hook','yes');
 if(mode==='late-source'||mode==='release-source'||mode==='late-authored-source'){await expect(status).toHaveCount(0);const after=await read();expect(after.layers).toHaveLength(before.layers.length+1);expect(after.layers[0]).toEqual(before.layers[0]);expect(errors).toEqual([]);return;}if(mode==='release-close'){await expect(region).toBeHidden();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(['frame','group','pick','release-frame','release-group','release-pick'].includes(mode)){await expect(x).toHaveCount(0);await expect(status).toHaveCount(0);if(mode.endsWith('frame'))await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode.endsWith('group'))await expect(region.getByLabel('Select complete sampled stage groups')).toBeChecked();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(cancel){await expect(x).toHaveValue(String(mode==='target'||mode==='release-target'||mode==='late-authored-target'?111:prior?priorPoint.x:pivot.x));await expect(y).toHaveValue(String(prior?priorPoint.y:pivot.y));if(prior)await expect(status).toContainText('Proposed pivot');else await expect(status).toHaveCount(0);expect(await read()).toEqual(before);if(mode==='author-policy'||mode==='release-author-policy'||mode==='release-author-restore'||mode==='late-authored-author-restore'){await stage.scrollIntoViewIfNeeded();Object.assign(pos,await measure());await start();await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);const target={x:Number(await x.inputValue()),y:Number(await y.inputValue())};await page.mouse.up();if(mode==='release-author-restore'||mode==='late-authored-author-restore')await published(target);else{await expect(status).toContainText('Proposed pivot');expect(await read()).toEqual(before);}}expect(errors).toEqual([]);return;}
 if(mode==='draft'||mode==='draft-retained'){await expect(status).toContainText('Proposed pivot');expect(await read()).toEqual(before);await commit.click();}await published(point);expect(errors).toEqual([]);
});

for(const mode of ['base','direct','default','mixed','affine','reflected','compound','extra','separate','children','retained','reset','discard','invalid','disabled','overflow','noop','member','preview-target','preview-source','late-target','late-source','late-pick','late-group','late-frame','late-close','late-candidate-target','late-candidate-source','center','resume'])test('sampled complete group numeric pivots retain original ownership '+mode,async({page})=>{
 await page.setViewportSize({width:1600,height:1200});const p=newProject();p.width=400;p.height=240;p.duration=12;const l=p.layers[0];l.id='base';l.drawingMode='object';const ink=(id:string,x:number,groups?:string[]):Vector=>({id,kind:mode==='compound'?'polygon':'rectangle',x,y:10,width:mode==='overflow'?300:30,height:mode==='overflow'?200:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(['affine','reflected','overflow'].includes(mode)?{transform:(mode==='overflow'?[.1,0,0,.1]:mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),...(mode==='default'||mode==='mixed'?{}:{pivot:{x:mode==='noop'?3-x:3,y:4}}),fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(groups?{groups}:{}),...(mode==='compound'?{fillRule:'evenodd',contours:[[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}],[{x:5,y:5},{x:5,y:10},{x:10,y:5}]]}: {})});
 const shapes=[ink('under',-50),ink('b',0,['outer','inner']),ink('a',40,['outer','inner']),ink('c',80,['outer']),ink('over',140)],end=structuredClone(shapes);for(const shape of end){shape.x+=80;if(mode==='mixed')shape.pivot={x:7,y:9};}l.keys=[{frame:0,shapes},{frame:8,shapes:end},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{affine:true,pivots:mode!=='disabled',...(mode==='default'||mode==='mixed'?{defaultPivots:true}:{})},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});for(const shape of l.keys[8].shapes)shape.x+=80;let target='base';if(mode==='extra'){const extra=structuredClone(l);extra.id='extra';extra.motionSpans![0].id='extra-span';p.layers.push(extra);l.visible=false;target='extra';}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;p.symbols=[{id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}}];p.layers.push({id:'children',name:'Children',visible:true,locked:false,drawingMode:'object',keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),group=region.getByLabel('Select complete sampled stage groups'),x=region.getByLabel('Sampled group pivot document X'),y=region.getByLabel('Sampled group pivot document Y'),preview=region.getByRole('button',{name:'Preview sampled group pivot position',exact:true}),commit=region.getByRole('button',{name:'Promote and position sampled group pivot',exact:true}),status=region.getByRole('status');await group.check();if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await choice.selectOption(JSON.stringify([target,'b']));if(mode==='retained'){await region.getByLabel('Drag sampled group offsets').check();await region.getByLabel('Author sampled group on drag release').check();}await region.getByRole('button',{name:'Select original sampled group pivot',exact:true}).click();expect(await read()).toEqual(before);
 const cap=captureRememberedGroupPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=cap.scene.find(t=>t.layerId===target)!.key.shapes;if(mode==='noop'){await expect(commit).toBeDisabled();cap.dispose();expect(errors).toEqual([]);return;}const point=mode==='center'?{x:Number(await x.inputValue()),y:Number(await y.inputValue())}:mode==='member'?worldPoint(original[1],original[1].pivot!):{x:mode==='overflow'?1e308:-55,y:207};if(mode==='retained'){await expect(region.getByLabel('Drag sampled group offsets')).not.toBeChecked();await expect(region.getByLabel('Author sampled group on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled group on drag release')).toBeDisabled();const box=(await stage.boundingBox())!;await page.mouse.move(box.x+box.width/2-100,box.y+box.height/2-100);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.move(box.x+box.width/2-80,box.y+box.height/2-80);await page.mouse.up();expect(await read()).toEqual(before);}
 const redHash=()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement,d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let h=0,n=0;for(let i=0;i<d.length;i+=4)if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255){h=(h*31+i)|0;n++;}return {h,n};}),hash=await redHash();expect(hash.n).toBeGreaterThan(20);if(mode==='separate'){await region.getByLabel('Sampled stage X offset').fill('20');await region.getByLabel('Sampled stage rotation').fill('30');await region.getByLabel('Sampled stage X scale').fill('200');await region.getByLabel('Sampled stage skew angle').fill('15');}if(mode==='invalid'){await x.fill('');await expect(commit).toBeDisabled();}await x.fill(String(point.x));await y.fill(String(point.y));
 const arm=async(action:string,late=false)=>page.evaluate(({action,late})=>{if(late){const stringify=JSON.stringify;JSON.stringify=((value:unknown,replacer?:unknown,space?:string|number)=>{const result=stringify(value,replacer as never,space);if(result?.includes('\"id\":\"b\"')&&result.includes('\"pivot\":{\"x\":-135,\"y\":197}')){JSON.stringify=stringify;(window as typeof window&{groupPivotHook?:boolean}).groupPivotHook=true;if(action==='source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else{const el=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}}return result;})as typeof JSON.stringify;return;}const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options),project=value as Project,pivot=project?.layers?.find(l=>l.id==='base')?.keys.find(k=>k.frame===4)?.shapes.find(s=>s.id==='b')?.pivot;if(project?.layers&&(!late||(pivot?.x===-135&&pivot.y===197))){window.structuredClone=clone;(window as typeof window&{groupPivotHook?:boolean}).groupPivotHook=true;if(action==='source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(action==='close')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();else if(action==='frame')(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Next frame')as HTMLButtonElement).click();else if(action==='pick'){const el=document.querySelector('select[aria-label="Sampled stage artwork"]')as HTMLSelectElement;el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));}else if(action==='group'){const el=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}else{const el=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;el.value='111';el.dispatchEvent(new Event('input',{bubbles:true}));}}return result;})as typeof structuredClone;},{action,late});
 if(mode.startsWith('preview-'))await arm(mode.slice(8));if(mode!=='direct'){await preview.click();if(mode==='disabled'||mode==='overflow'){await expect(page.getByRole('alert')).toBeVisible();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);cap.dispose();expect(errors).toEqual([]);return;}if(mode.startsWith('preview-')){expect(await page.evaluate(()=>(window as typeof window&{groupPivotHook?:boolean}).groupPivotHook)).toBe(true);await expect(status).toHaveCount(0);if(mode==='preview-target')await expect(x).toHaveValue('111');else expect((await read()).layers).toHaveLength(before.layers.length+1);cap.dispose();expect(errors).toEqual([]);return;}await expect(status).toContainText('Proposed group-pivot');expect(await read()).toEqual(before);await expect.poll(redHash).toEqual(hash);if(mode==='children')await expect.poll(()=>stage.evaluate(el=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(75-200)*devicePixelRatio,c.height/2+(62-120)*devicePixelRatio,1,1).data];})).toEqual([0,0,255,255]);}
 if(mode==='resume'){await region.getByLabel('Rotate sampled group with handle').check();await expect(x).toBeDisabled();await expect(status).toHaveCount(0);await region.getByLabel('Sampled stage rotation').fill('30');await region.getByRole('button',{name:'Promote and rotate sampled stage pose',exact:true}).click();await expect(region).toBeHidden();const own=captureRememberedGroupAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=own.prepareGroupPromotion(target,'b',undefined,30),result=await read();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);own.dispose();cap.dispose();expect(errors).toEqual([]);return;}
 if(mode==='reset'){await x.fill('-54');await expect(status).toHaveCount(0);await choice.selectOption('');await expect(x).toHaveCount(0);await choice.selectOption(JSON.stringify([target,'b']));await expect(x).toHaveValue('');await expect(x).toBeDisabled();cap.dispose();expect(await read()).toEqual(before);return;}if(mode==='discard'){await stage.focus();await page.keyboard.press('Escape');await expect(status).toHaveCount(0);await expect(x).toHaveValue('-55');await preview.click();await expect(status).toContainText('Proposed group-pivot');}
 if(mode.startsWith('late-')){await arm(mode.startsWith('late-candidate-')?mode.slice(15):mode.slice(5),mode.startsWith('late-candidate-'));await commit.click();expect(await page.evaluate(()=>(window as typeof window&{groupPivotHook?:boolean}).groupPivotHook)).toBe(true);if(mode.endsWith('source'))expect((await read()).layers).toHaveLength(before.layers.length+1);else expect(await read()).toEqual(before);if(mode.endsWith('target'))await expect(x).toHaveValue('111');if(mode==='late-pick')await expect(choice).toHaveValue('');if(mode==='late-group')await expect(group).not.toBeChecked();if(mode==='late-frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='late-close')await expect(region).toBeHidden();cap.dispose();expect(errors).toEqual([]);return;}
 const wanted=cap.prepareGroupPivotPosition(target,'b',point);cap.dispose();await commit.click();await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();await expect(page.getByLabel('Pivot X',{exact:true})).toHaveValue(String(Math.round(point.x*100)/100));await expect(page.getByLabel('Pivot Y',{exact:true})).toHaveValue(String(Math.round(point.y*100)/100));const result=await read();expect(result.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(result.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...r})=>r));expect(result.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(result.symbols).toEqual(before.symbols);for(const shape of result.layers.find(l=>l.id===target)!.keys[4].shapes.filter(s=>s.groups)){const world=worldPoint(shape,shape.pivot!);expect(world.x).toBeCloseTo(point.x,9);expect(world.y).toBeCloseTo(point.y,9);}await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(result);expect(errors).toEqual([]);
});
for(const mode of ['base','default','mixed','affine','reflected','compound','extra','css','shift','offset','zero','return','escape','pointercancel','lost','blur','resize','scroll','zoom','policy','policy-restore','target','prior','prior-policy','disabled','foreground','late-source','release-source','capture-target','capture-policy-restore','children','retained','release-target','release-policy-restore','frame','group','pick','original-picks','released-policy','return-prior','movement-source','wrong-pointer'])test('sampled complete group pivot canvas drafts preserve original capture '+mode,async({page})=>{
 await page.setViewportSize({width:1600,height:1200});const p=newProject();p.width=400;p.height=240;p.duration=12;const l=p.layers[0];l.id='base';l.drawingMode='object';const ink=(id:string,x:number,groups?:string[]):Vector=>({id,kind:mode==='compound'?'polygon':'rectangle',x,y:10,width:mode==='overflow'?300:30,height:mode==='overflow'?200:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(['affine','reflected','overflow'].includes(mode)?{transform:(mode==='overflow'?[.1,0,0,.1]:mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),...(mode==='default'||mode==='mixed'?{}:{pivot:{x:mode==='noop'?3-x:3,y:4}}),fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(groups?{groups}:{}),...(mode==='compound'?{fillRule:'evenodd',contours:[[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}],[{x:5,y:5},{x:5,y:10},{x:10,y:5}]]}: {})});
 const shapes=[ink('under',-50),ink('b',0,['outer','inner']),ink('a',40,['outer','inner']),ink('c',80,['outer']),ink('over',140)],end=structuredClone(shapes);for(const shape of end){shape.x+=80;if(mode==='mixed')shape.pivot={x:7,y:9};}l.keys=[{frame:0,shapes},{frame:8,shapes:end},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{affine:true,pivots:mode!=='disabled',...(mode==='default'||mode==='mixed'?{defaultPivots:true}:{})},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});for(const shape of l.keys[8].shapes)shape.x+=80;let target='base';if(mode==='extra'){const extra=structuredClone(l);extra.id='extra';extra.motionSpans![0].id='extra-span';p.layers.push(extra);l.visible=false;target='extra';}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;p.symbols=[{id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}}];p.layers.push({id:'children',name:'Children',visible:true,locked:false,drawingMode:'object',keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}

 if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{...shapes[0],id:'cover',groups:undefined,x:120,y:0,width:40,height:50,fill:'#00ff00'}]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Drag sampled group pivots'),x=region.getByLabel('Sampled group pivot document X'),y=region.getByLabel('Sampled group pivot document Y'),status=region.getByRole('status'),commit=region.getByRole('button',{name:'Promote and position sampled group pivot',exact:true});if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await region.getByLabel('Select complete sampled stage groups').check();await choice.selectOption(JSON.stringify([target,'b']));if(mode==='retained'){await region.getByLabel('Drag sampled group offsets').check();await region.getByLabel('Author sampled group on drag release').check();}await region.getByRole('button',{name:'Select original sampled group pivot',exact:true}).click();await tool.check();if(mode==='retained'){await expect(region.getByLabel('Drag sampled group offsets')).not.toBeChecked();await expect(region.getByLabel('Author sampled group on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled group on drag release')).toBeDisabled();}const capture=captureRememberedGroupPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=capture.scene.find(t=>t.layerId===target)!.key.shapes.filter(s=>s.groups),pivot=rememberedAuthoringPivot(original);capture.dispose();const prior=mode==='return-prior'||mode==='prior'||mode==='prior-policy'||mode==='original-picks',priorPoint={x:pivot.x+(mode==='original-picks'?30:5),y:pivot.y+(mode==='original-picks'?30:7)};if(prior){await x.fill(String(priorPoint.x));await y.fill(String(priorPoint.y));await region.getByRole('button',{name:'Preview sampled group pivot position',exact:true}).click();await expect(status).toContainText('Proposed group-pivot');}
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='300px';});await stage.scrollIntoViewIfNeeded();const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-200)*r.width/w,y:r.top+(h/2+p.y-120)*r.height/h,rx:r.width/w,ry:r.height/h};},pivot);const pos=await measure();const offset=mode==='offset'?{x:3,y:-2}:{x:0,y:0},start=()=>page.mouse.move(pos.x+offset.x,pos.y+offset.y),pixel=(point:Point)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-200)*devicePixelRatio,c.height/2+(p.y-120)*devicePixelRatio,1,1).data];},point);await expect.poll(()=>pixel(pivot)).toEqual(prior?[255,255,255,255]:[255,191,102,255]);
 if(mode==='capture-target'||mode==='capture-policy-restore')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='capture-target'){const input=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Drag sampled group pivots"]')as HTMLInputElement;for(const checked of [false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 await stage.evaluate(el=>{for(const name of ['pointerdown','pointermove'])el.addEventListener(name,event=>{const e=event as PointerEvent;(el as HTMLElement).dataset[name]=JSON.stringify({x:e.clientX,y:e.clientY,shift:e.shiftKey});},true);});if(mode==='original-picks'){await page.mouse.move(pos.x+30*pos.rx,pos.y+30*pos.ry);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();await expect(status).toContainText('Proposed group-pivot');}await start();await page.mouse.down();if(mode==='foreground'||mode.startsWith('capture-')){expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);if(mode==='capture-target')await expect(x).toHaveValue('111');if(mode.startsWith('capture-')){await stage.scrollIntoViewIfNeeded();Object.assign(pos,await measure());await start();await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);await page.mouse.up();await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed group-pivot');expect(await read()).toEqual(before);}expect(errors).toEqual([]);return;}await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='zero'){await page.mouse.up();await expect(status).toHaveCount(0);await expect(x).toHaveValue(String(pivot.x));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 const dx=8,dy=20;const point={x:pivot.x+(mode==='shift'?0:dx),y:pivot.y+dy};if(mode==='movement-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(window as typeof window&{groupPivotMovementHook?:boolean}).groupPivotMovementHook=true;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});if(mode==='shift')await page.keyboard.down('Shift');await page.mouse.move(pos.x+offset.x+dx*pos.rx,pos.y+offset.y+dy*pos.ry);const delivered=await stage.evaluate(el=>({start:JSON.parse((el as HTMLElement).dataset.pointerdown!),end:JSON.parse((el as HTMLElement).dataset.pointermove!)}));const local=(p:Point)=>({x:((p.x-pos.left)*pos.w/pos.cw-(pos.w/2-200)),y:((p.y-pos.top)*pos.h/pos.ch-(pos.h/2-120))}),from=local(delivered.start),to=local(delivered.end);let deliveredX=to.x-from.x,deliveredY=to.y-from.y;if(delivered.end.shift){if(Math.abs(deliveredX)>=Math.abs(deliveredY))deliveredY=0;else deliveredX=0;}point.x=pivot.x+deliveredX;point.y=pivot.y+deliveredY;if(mode==='movement-source'){await page.mouse.up();expect(await page.evaluate(()=>(window as typeof window&{groupPivotMovementHook?:boolean}).groupPivotMovementHook)).toBe(true);expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);const after=await read();expect(after.layers).toHaveLength(before.layers.length+1);expect(after.layers[0]).toEqual(before.layers[0]);await region.getByRole('button',{name:'Return to authored stage',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(after);expect(errors).toEqual([]);return;}if(mode==='disabled'){await page.mouse.up();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(x).toHaveValue(String(point.x));await expect(y).toHaveValue(String(point.y));expect(await read()).toEqual(before);await expect.poll(()=>pixel(point)).toEqual([255,191,102,255]);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);
 if(mode==='late-source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='release-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 if(mode==='release-target'||mode==='release-policy-restore')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='release-target'){const input=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Drag sampled group pivots"]')as HTMLInputElement;for(const checked of [false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 if(mode==='wrong-pointer'){await stage.dispatchEvent('pointerup',{pointerId:999,isPrimary:true,bubbles:true});expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);}const cancel=['return-prior','return','escape','pointercancel','lost','blur','resize','scroll','zoom','policy','policy-restore','target','prior','prior-policy','release-target','release-policy-restore','frame','group','pick','original-picks'].includes(mode);if(mode==='return'||mode==='return-prior')await page.mouse.move(pos.x,pos.y);if(mode==='escape'||mode==='prior'||mode==='original-picks')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1,bubbles:true});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='600px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');if(mode==='policy'||mode==='prior-policy')await tool.evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='policy-restore')await page.evaluate(()=>{const el=document.querySelector('input[aria-label="Drag sampled group pivots"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}});if(mode==='target')await x.evaluate(el=>{const input=el as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='frame')await page.getByLabel('Go to frame',{exact:true}).evaluate(el=>{const input=el as HTMLInputElement;input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='pick')await choice.evaluate(el=>{const input=el as HTMLSelectElement;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();if(mode==='shift')await page.keyboard.up('Shift');await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);
 if(mode==='late-source'||mode==='release-source'){await expect(status).toHaveCount(0);const after=await read();expect(after.layers).toHaveLength(before.layers.length+1);expect(after.layers[0]).toEqual(before.layers[0]);expect(errors).toEqual([]);return;}if(['frame','group','pick'].includes(mode)){await expect(x).toHaveCount(0);await expect(status).toHaveCount(0);if(mode==='frame')await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode==='group')await expect(region.getByLabel('Select complete sampled stage groups')).not.toBeChecked();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(cancel){await expect(x).toHaveValue(String(mode==='target'||mode==='release-target'?111:prior?priorPoint.x:pivot.x));await expect(y).toHaveValue(String(prior?priorPoint.y:pivot.y));if(prior)await expect(status).toContainText('Proposed group-pivot');else await expect(status).toHaveCount(0);expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 if(mode==='released-policy'){await expect(status).toContainText('Proposed group-pivot');const saved={x:await x.inputValue(),y:await y.inputValue()};await tool.uncheck();await expect(status).toHaveCount(0);await expect(x).toHaveValue(saved.x);await expect(y).toHaveValue(saved.y);expect(await read()).toEqual(before);await tool.check();await expect(status).toHaveCount(0);expect(errors).toEqual([]);return;}
 await expect(status).toContainText('Proposed group-pivot');expect(await read()).toEqual(before);const own=captureRememberedGroupPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=own.prepareGroupPivotPosition(target,'b',point);own.dispose();await commit.click();await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();await expect(page.getByLabel('Pivot X',{exact:true})).toHaveValue(String(Math.round(point.x*100)/100));await expect(page.getByLabel('Pivot Y',{exact:true})).toHaveValue(String(Math.round(point.y*100)/100));const after=await read();expect(after.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(after.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...span})=>span)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...span})=>span));expect(after.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(after.symbols).toEqual(before.symbols);await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(after);expect(errors).toEqual([]);
});
for(const mode of ['base', 'default', 'mixed', 'affine', 'reflected', 'compound', 'extra', 'css', 'shift', 'offset', 'zero', 'return', 'escape', 'pointercancel', 'lost', 'blur', 'resize', 'scroll', 'zoom', 'policy', 'policy-restore', 'target', 'prior', 'prior-policy', 'original-picks', 'disabled', 'foreground', 'late-source', 'release-source', 'capture-target', 'capture-policy-restore', 'children', 'retained', 'release-target', 'release-policy-restore', 'frame', 'group', 'pick', 'draft', 'draft-retained', 'author-policy', 'capture-author-policy', 'capture-author-restore', 'release-author-policy', 'release-author-restore', 'release-pick', 'release-group', 'release-frame', 'release-close', 'release-view', 'late-authored-author-restore', 'late-authored-target', 'late-authored-source'])test('sampled complete group pivot direct release admits fresh authoring '+mode,async({page})=>{
 await page.setViewportSize({width:1600,height:1200});const p=newProject();p.width=400;p.height=240;p.duration=12;const l=p.layers[0];l.id='base';l.drawingMode='object';const ink=(id:string,x:number,groups?:string[]):Vector=>({id,kind:mode==='compound'?'polygon':'rectangle',x,y:10,width:mode==='overflow'?300:30,height:mode==='overflow'?200:20,rotation:mode==='affine'||mode==='reflected'?30:0,...(['affine','reflected','overflow'].includes(mode)?{transform:(mode==='overflow'?[.1,0,0,.1]:mode==='reflected'?[-2,.5,1,3]:[2,.5,1,3])as[number,number,number,number]}:{}),...(mode==='default'||mode==='mixed'?{}:{pivot:{x:mode==='noop'?3-x:3,y:4}}),fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(groups?{groups}:{}),...(mode==='compound'?{fillRule:'evenodd',contours:[[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}],[{x:5,y:5},{x:5,y:10},{x:10,y:5}]]}: {})});
 const shapes=[ink('under',-50),ink('b',0,['outer','inner']),ink('a',40,['outer','inner']),ink('c',80,['outer']),ink('over',140)],end=structuredClone(shapes);for(const shape of end){shape.x+=80;if(mode==='mixed')shape.pivot={x:7,y:9};}l.keys=[{frame:0,shapes},{frame:8,shapes:end},{frame:10,shapes:[]}];createBasicMotionSpan(p,['base'],0,8,'linear',{affine:true,pivots:mode!=='disabled',...(mode==='default'||mode==='mixed'?{defaultPivots:true}:{})},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});for(const shape of l.keys[8].shapes)shape.x+=80;let target='base';if(mode==='extra'){const extra=structuredClone(l);extra.id='extra';extra.motionSpans![0].id='extra-span';p.layers.push(extra);l.visible=false;target='extra';}
 if(mode==='children'){const cp=newProject();cp.duration=12;const ct=cp.layers[0],blue:Vector={id:'blue',kind:'rectangle',x:0,y:0,width:8,height:8,rotation:0,fill:'#0000ff',stroke:'#000000',strokeWidth:0,points:[]};ct.drawingMode='object';ct.keys=[{frame:0,shapes:[blue]},{frame:8,shapes:[{...blue,x:8}]}];createBasicMotionSpan(cp,[ct.id],0,8,'linear');ct.keys[8].shapes[0].x=16;p.symbols=[{id:'child',name:'Child',width:30,height:10,shapes:ct.keys[0].shapes,timeline:{duration:12,keys:ct.keys.slice(1),motionSpans:ct.motionSpans,layers:[]}}];p.layers.push({id:'children',name:'Children',visible:true,locked:false,drawingMode:'object',keys:[{frame:0,shapes:[{...blue,id:'instance',kind:'symbol',symbolId:'child',x:60,y:60,width:30,height:10,symbolPlayback:{mode:'loop',firstFrame:0}}]}]});}

 if(mode==='foreground')p.layers.push({id:'cover',name:'Cover',visible:true,locked:false,keys:[{frame:0,shapes:[{...shapes[0],id:'cover',groups:undefined,x:120,y:0,width:40,height:50,fill:'#00ff00'}]}]});
 await page.addInitScript(project=>localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder:null,manifest:null})),p);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Recover changes',exact:true}).click();const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project),before=await read();await page.getByLabel('Timeline frames').click({position:{x:81,y:40}});await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Show sampled motion on stage',exact:true}).click();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');const region=page.getByRole('region',{name:'Sampled motion stage'}),stage=page.getByLabel('Drawing stage'),choice=region.getByLabel('Sampled stage artwork'),tool=region.getByLabel('Drag sampled group pivots'),x=region.getByLabel('Sampled group pivot document X'),y=region.getByLabel('Sampled group pivot document Y'),status=region.getByRole('status'),commit=region.getByRole('button',{name:'Promote and position sampled group pivot',exact:true});if(mode==='children'){await region.getByLabel('Remember sampled stage children').check();await expect(choice).toBeEnabled();}await region.getByLabel('Select complete sampled stage groups').check();await choice.selectOption(JSON.stringify([target,'b']));if(mode==='retained'||mode==='draft-retained'){await region.getByLabel('Drag sampled group offsets').check();await region.getByLabel('Author sampled group on drag release').check();}await region.getByRole('button',{name:'Select original sampled group pivot',exact:true}).click();await tool.check();const release=region.getByLabel('Author sampled group pivot on drag release');if(mode!=='draft'&&mode!=='draft-retained')await release.check();if(mode==='retained'||mode==='draft-retained'){await expect(region.getByLabel('Drag sampled group offsets')).not.toBeChecked();await expect(region.getByLabel('Author sampled group on drag release')).toBeChecked();await expect(region.getByLabel('Author sampled group on drag release')).toBeDisabled();}const capture=captureRememberedGroupPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),original=capture.scene.find(t=>t.layerId===target)!.key.shapes.filter(s=>s.groups),pivot=rememberedAuthoringPivot(original);capture.dispose();const prior=mode==='prior'||mode==='prior-policy'||mode==='original-picks',priorPoint={x:pivot.x+(mode==='original-picks'?30:5),y:pivot.y+(mode==='original-picks'?30:7)};if(prior){await x.fill(String(priorPoint.x));await y.fill(String(priorPoint.y));await region.getByRole('button',{name:'Preview sampled group pivot position',exact:true}).click();await expect(status).toContainText('Proposed group-pivot');}
 const published=async(point:Point)=>{await expect(region).toBeHidden();await expect(page.getByText('3 vectors selected. Drag or use arrow keys to move together.',{exact:true})).toBeVisible();const own=captureRememberedGroupPivotAuthoringFrame(()=>({project:before,revision:0,frame:4})),wanted=own.prepareGroupPivotPosition(target,'b',point);own.dispose();const after=await read();expect(after.layers.find(l=>l.id===target)!.keys).toEqual(wanted.layers.find(l=>l.id===target)!.keys);expect(after.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...span})=>span)).toEqual(wanted.layers.find(l=>l.id===target)!.motionSpans!.map(({id:_id,...span})=>span));expect(after.layers.filter(l=>l.id!==target)).toEqual(before.layers.filter(l=>l.id!==target));expect(after.symbols).toEqual(before.symbols);await expect(page.getByLabel('Pivot X',{exact:true})).toHaveValue(String(Math.round(point.x*100)/100));await expect(page.getByLabel('Pivot Y',{exact:true})).toHaveValue(String(Math.round(point.y*100)/100));await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await read()).toEqual(after);};
 if(mode==='css')await stage.evaluate(el=>{(el as HTMLElement).style.width='700px';(el as HTMLElement).style.height='300px';});await stage.scrollIntoViewIfNeeded();const measure=()=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement,r=c.getBoundingClientRect(),w=c.width/devicePixelRatio,h=c.height/devicePixelRatio;return {left:r.left,top:r.top,w,h,cw:r.width,ch:r.height,x:r.left+(w/2+p.x-200)*r.width/w,y:r.top+(h/2+p.y-120)*r.height/h,rx:r.width/w,ry:r.height/h};},pivot);const pos=await measure();const offset=mode==='offset'?{x:3,y:-2}:{x:0,y:0},start=()=>page.mouse.move(pos.x+offset.x,pos.y+offset.y),pixel=(point:Point)=>stage.evaluate((el,p)=>{const c=el as HTMLCanvasElement;return [...c.getContext('2d')!.getImageData(c.width/2+(p.x-200)*devicePixelRatio,c.height/2+(p.y-120)*devicePixelRatio,1,1).data];},point);await expect.poll(()=>pixel(pivot)).toEqual(prior?[255,255,255,255]:[255,191,102,255]);
 if(mode.startsWith('capture-'))await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='capture-target'){const input=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector(`input[aria-label="${mode.includes('author')?'Author sampled group pivot on drag release':'Drag sampled group pivots'}"]`)as HTMLInputElement;for(const checked of mode==='capture-author-policy'?[false]:[false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 await stage.evaluate(el=>{for(const name of ['pointerdown','pointermove'])el.addEventListener(name,event=>{const e=event as PointerEvent;(el as HTMLElement).dataset[name]=JSON.stringify({x:e.clientX,y:e.clientY,shift:e.shiftKey});},true);});if(mode==='original-picks'){await page.mouse.move(pos.x+30*pos.rx,pos.y+30*pos.ry);await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();await expect(status).toContainText('Proposed group-pivot');}await start();await page.mouse.down();if(mode==='foreground'||mode.startsWith('capture-')){expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);await page.mouse.up();expect(await read()).toEqual(before);if(mode==='capture-target')await expect(x).toHaveValue('111');if(mode.startsWith('capture-')){await stage.scrollIntoViewIfNeeded();Object.assign(pos,await measure());await start();await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);const point={x:Number(await x.inputValue()),y:Number(await y.inputValue())},author=await release.isChecked();await page.mouse.up();if(author)await published(point);else{await expect(choice).toBeEnabled();await expect(status).toContainText('Proposed group-pivot');expect(await read()).toEqual(before);}}expect(errors).toEqual([]);return;}await expect(choice).toBeDisabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);if(mode==='zero'){await page.mouse.up();await expect(status).toHaveCount(0);await expect(x).toHaveValue(String(pivot.x));expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}
 const dx=8,dy=20;const point={x:pivot.x+(mode==='shift'?0:dx),y:pivot.y+dy};if(mode==='shift')await page.keyboard.down('Shift');await page.mouse.move(pos.x+offset.x+dx*pos.rx,pos.y+offset.y+dy*pos.ry);const delivered=await stage.evaluate(el=>({start:JSON.parse((el as HTMLElement).dataset.pointerdown!),end:JSON.parse((el as HTMLElement).dataset.pointermove!)}));const local=(p:Point)=>({x:((p.x-pos.left)*pos.w/pos.cw-(pos.w/2-200)),y:((p.y-pos.top)*pos.h/pos.ch-(pos.h/2-120))}),from=local(delivered.start),to=local(delivered.end);let deliveredX=to.x-from.x,deliveredY=to.y-from.y;if(delivered.end.shift){if(Math.abs(deliveredX)>=Math.abs(deliveredY))deliveredY=0;else deliveredX=0;}point.x=pivot.x+deliveredX;point.y=pivot.y+deliveredY;if(mode==='disabled'){await page.mouse.up();await expect(status).toHaveCount(0);expect(await read()).toEqual(before);await region.getByRole('button',{name:'Promote sampled stage pose',exact:true}).click();await stage.focus();await page.keyboard.press('Control+z');expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}await expect(x).toHaveValue(String(point.x));await expect(y).toHaveValue(String(point.y));expect(await read()).toEqual(before);await expect.poll(()=>pixel(point)).toEqual([255,191,102,255]);if(mode==='children')await expect.poll(()=>pixel({x:75,y:62})).toEqual([0,0,255,255]);
 if(mode==='late-source')await page.getByRole('button',{name:'Add layer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());if(mode==='release-source')await page.evaluate(()=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();}return result;})as typeof structuredClone;});
 if(mode.startsWith('release-')&&mode!=='release-source')await page.evaluate(mode=>{const clone=structuredClone;window.structuredClone=((value:unknown,options?:StructuredSerializeOptions)=>{const result=clone(value,options);if(Array.isArray((value as {layers?:unknown})?.layers)){window.structuredClone=clone;if(mode==='release-target'){const input=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else if(mode==='release-view'){(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).style.transform='translateY(1px)';}else if(mode==='release-pick'){const input=document.querySelector('select[aria-label="Sampled stage artwork"]')as HTMLSelectElement;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-frame'){const input=document.querySelector('input[aria-label="Go to frame"]')as HTMLInputElement;input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-group'){const input=document.querySelector('input[aria-label="Select complete sampled stage groups"]')as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}else if(mode==='release-close'){(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Return to authored stage')as HTMLButtonElement).click();}else{const input=document.querySelector(`input[aria-label="${mode.includes('author')?'Author sampled group pivot on drag release':'Drag sampled group pivots'}"]`)as HTMLInputElement;for(const checked of mode==='release-author-policy'?[false]:[false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof structuredClone;},mode);
 if(mode.startsWith('late-authored-'))await page.evaluate(({mode,x,y})=>{const stringify=JSON.stringify;JSON.stringify=((value:unknown,replacer?:unknown,space?:string|number)=>{const result=stringify(value,replacer as never,space),shape=value as {id?:string;pivot?:{x:number;y:number}};if(shape?.id==='b'&&shape.pivot?.x===x&&shape.pivot?.y===y){JSON.stringify=stringify;(document.querySelector('canvas[aria-label="Drawing stage"]')as HTMLElement).dataset.pivotReleaseHook='yes';if(mode==='late-authored-source')(document.querySelector('button[aria-label="Add layer"]')as HTMLButtonElement).click();else if(mode==='late-authored-target'){const input=document.querySelector('input[aria-label="Sampled group pivot document X"]')as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));}else{const input=document.querySelector('input[aria-label="Author sampled group pivot on drag release"]')as HTMLInputElement;for(const checked of [false,true]){input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}}}return result;})as typeof JSON.stringify;},{mode,x:point.x-80,y:point.y-10});
 const cancel=['return','escape','pointercancel','lost','blur','resize','scroll','zoom','policy','policy-restore','target','prior','prior-policy','release-target','release-policy-restore','frame','group','pick','original-picks','author-policy','release-author-policy','release-author-restore','release-view','late-authored-author-restore','late-authored-target'].includes(mode);if(mode==='author-policy')await release.evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='return')await page.mouse.move(pos.x,pos.y);if(mode==='escape'||mode==='prior'||mode==='original-picks')await page.keyboard.press('Escape');if(mode==='pointercancel')await stage.dispatchEvent('pointercancel',{pointerId:1,bubbles:true});if(mode==='lost')await stage.evaluate(el=>(el as HTMLCanvasElement).releasePointerCapture(1));if(mode==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));if(mode==='resize')await stage.evaluate(el=>(el as HTMLElement).style.width='600px');if(mode==='scroll')await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));if(mode==='zoom')await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('0.5');if(mode==='policy'||mode==='prior-policy')await tool.evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='policy-restore')await page.evaluate(()=>{const el=document.querySelector('input[aria-label="Drag sampled group pivots"]')as HTMLInputElement;for(const checked of [false,true]){el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));}});if(mode==='target')await x.evaluate(el=>{const input=el as HTMLInputElement;input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}));});if(mode==='frame')await page.getByLabel('Go to frame',{exact:true}).evaluate(el=>{const input=el as HTMLInputElement;input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='group')await region.getByLabel('Select complete sampled stage groups').evaluate(el=>{const input=el as HTMLInputElement;input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));});if(mode==='pick')await choice.evaluate(el=>{const input=el as HTMLSelectElement;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));});await page.mouse.up();if(mode==='shift')await page.keyboard.up('Shift');if(await region.isVisible())await expect(choice).toBeEnabled();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(false);if(mode.startsWith('late-authored-'))await expect(stage).toHaveAttribute('data-pivot-release-hook','yes');
 if(mode==='late-source'||mode==='release-source'||mode==='late-authored-source'){await expect(status).toHaveCount(0);const after=await read();expect(after.layers).toHaveLength(before.layers.length+1);expect(after.layers[0]).toEqual(before.layers[0]);expect(errors).toEqual([]);return;}if(mode==='release-close'){await expect(region).toBeHidden();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(['frame','group','pick','release-frame','release-group','release-pick'].includes(mode)){await expect(x).toHaveCount(0);await expect(status).toHaveCount(0);if(mode.endsWith('frame'))await expect(page.getByLabel('Go to frame',{exact:true})).toHaveValue('6');if(mode.endsWith('group'))await expect(region.getByLabel('Select complete sampled stage groups')).not.toBeChecked();expect(await read()).toEqual(before);expect(errors).toEqual([]);return;}if(cancel){await expect(x).toHaveValue(String(mode==='target'||mode==='release-target'||mode==='late-authored-target'?111:prior?priorPoint.x:pivot.x));await expect(y).toHaveValue(String(prior?priorPoint.y:pivot.y));if(prior)await expect(status).toContainText('Proposed group-pivot');else await expect(status).toHaveCount(0);expect(await read()).toEqual(before);if(mode==='author-policy'||mode==='release-author-policy'||mode==='release-author-restore'||mode==='late-authored-author-restore'){await stage.scrollIntoViewIfNeeded();Object.assign(pos,await measure());await start();await page.mouse.down();expect(await stage.evaluate(el=>(el as HTMLCanvasElement).hasPointerCapture(1))).toBe(true);await page.mouse.move(pos.x+8*pos.rx,pos.y+20*pos.ry);const target={x:Number(await x.inputValue()),y:Number(await y.inputValue())};await page.mouse.up();if(mode==='release-author-restore'||mode==='late-authored-author-restore')await published(target);else{await expect(status).toContainText('Proposed group-pivot');expect(await read()).toEqual(before);}}expect(errors).toEqual([]);return;}
 if(mode==='draft'||mode==='draft-retained'){await expect(status).toContainText('Proposed group-pivot');expect(await read()).toEqual(before);await commit.click();}await published(point);expect(errors).toEqual([]);
});
