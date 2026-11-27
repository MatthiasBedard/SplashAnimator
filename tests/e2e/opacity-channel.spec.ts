import { openExportSettings } from './export-settings';
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import {
  createBasicMotionSpan,
  editSymbolBasicMotionSpan,
  setRememberedColorKey, setRememberedMotionOpacityEase, setRememberedOpacityKey, setRememberedRotationOrShearKey,
} from '../../packages/animation/src/motion-spans';
import { newProject, type Project, type Vector, symbolLayers } from '../../packages/document/src';
function fixture(symbol = false) {
  const p = newProject();
  p.width = 160;
  p.height = 100;
  p.duration = 12;
  const a: Vector = {
      id: 'art',
      kind: 'rectangle',
      x: 10,
      y: 20,
      width: 40,
      height: 30,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      opacity: 0.2,
    },
    keys = [
      { frame: 0, shapes: [a] },
      { frame: 8, shapes: [{ ...a, x: 90, opacity: 0.8 }] },
      { frame: 10, shapes: [] },
    ];
  if (!symbol) {
    p.layers[0].drawingMode = 'object';
    p.layers[0].keys = keys;
  } else
    p.symbols = [
      {
        id: 's',
        name: 'Opacity',
        width: 160,
        height: 100,
        shapes: keys[0].shapes,
        multiFramePivot: { x: 5, y: 7 },
        timeline: {
          duration: 12,
          keys: keys.slice(1),
          layers: [
            {
              id: 'extra',
              name: 'Extra',
              visible: true,
              locked: false,
              keys: structuredClone(keys),
            },
          ],
        },
      },
    ];
  return p;
}
async function setup(page: Page, symbol = false, project?: Project) {
  const p = project ?? fixture(symbol),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.addInitScript((p) => {
    if (window.top === window && !sessionStorage.getItem('opacity-fixture-seeded')) {
      sessionStorage.setItem('opacity-fixture-seeded', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, read, errors };
}
async function openSymbolTimeline(page:Page){
  await page.getByRole('option',{name:'Library item Opacity',exact:true}).dblclick();
  await page.getByRole('button',{name:'Advanced symbol timeline tools…',exact:true}).click();
  await page.getByRole('button',{name:'Timeline tools…',exact:true}).click();
}
async function range(page: Page) {
  const box = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x + 9, box.y + 40);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + 8 * 18 + 9, box.y + 40);
  await page.keyboard.up('Shift');
}
function rememberedFixture(symbol = false) {
  const p = fixture(symbol);
  if (symbol) {
    const s = p.symbols![0];
    p.symbols![0] = editSymbolBasicMotionSpan(
      s,
      symbolLayers(s).map((l) => l.id),
      0,
      8,
      'create',
      'in',
      [s],
    );
  } else createBasicMotionSpan(p, [p.layers[0].id], 0, 8, 'in');
  return p;
}
test('remembered X and Y keys regenerate at separate times, recover and undo independently',async({page})=>{
  const p=rememberedFixture(),f=await setup(page,false,p);
  await range(page);
  await page.getByText('Remembered position keys',{exact:true}).click();
  for(const [axis,frame,value] of [['x','3','80'],['y','5','50']]){
    await page.getByLabel('Remembered position axis').selectOption(axis);
    await page.getByLabel('Remembered position key frame').fill(frame);
    await page.getByLabel('Document coordinate',{exact:true}).fill(value);
    await page.getByRole('button',{name:'Set remembered position key',exact:true}).click();
  }
  const saved=await f.read();
  expect(saved.layers[0].keys[2].shapes[0]).toMatchObject({x:80,y:35});
  expect(saved.layers[0].keys[4].shapes[0].y).toBe(50);
  expect(saved.layers[0].keys.map(k=>k.shapes[0]?.opacity)).toEqual(p.layers[0].keys.map(k=>k.shapes[0]?.opacity));
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const box=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x+2*18+9,box.y+40);
  const pixel=()=>page.getByLabel('Drawing stage',{exact:true}).evaluate(el=>{
    const c=el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2+20*devicePixelRatio,c.height/2,1,1).data);
  });
  const green=Math.round(255*(1-saved.layers[0].keys[2].shapes[0].opacity!));
  await expect.poll(async()=>{const [r,g,b,a]=await pixel(); return r===255 && a===255 && b===g && Math.abs(g-green)<=1;}).toBe(true);
  await range(page); await page.getByText('Remembered position keys',{exact:true}).click();
  await page.getByRole('button',{name:'Frame 3 · X 80',exact:true}).click();
  await page.getByRole('button',{name:'Remove remembered position key',exact:true}).click();
  const cleared=await f.read();
  expect(cleared.layers[0].motionSpans![0].xKeys).toBeUndefined();
  expect(cleared.layers[0].keys[2].shapes[0]).toMatchObject({x:p.layers[0].keys[2].shapes[0].x,y:35});
  await page.keyboard.press('Control+z'); expect(await f.read()).toEqual(saved);
});
test('remembered opacity keys regenerate artwork and recover independently of geometry',async({page})=>{
  const p=rememberedFixture(), f=await setup(page,false,p);
  await range(page);
  await page.getByText('Remembered opacity keys',{exact:true}).click();
  await page.getByLabel('Remembered opacity key frame').fill('5');
  await page.getByLabel('Remembered key opacity (%)').fill('100');
  await page.getByRole('button',{name:'Set remembered opacity key',exact:true}).click();
  await expect.poll(async()=>(await f.read()).layers[0].keys[4].shapes[0].opacity).toBe(1);
  const saved=await f.read();
  expect(saved.layers[0].keys.map(k=>k.shapes[0]?.x)).toEqual(p.layers[0].keys.map(k=>k.shapes[0]?.x));
  expect(saved.layers[0].motionSpans![0].opacityKeys).toEqual([{offset:4,value:1}]);
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const box=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x+4*18+9,box.y+40);
  const pixel=()=>page.getByLabel('Drawing stage',{exact:true}).evaluate(el=>{
    const c=el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2-35*devicePixelRatio,c.height/2-20*devicePixelRatio,1,1).data);
  });
  await expect.poll(pixel).toEqual([255,0,0,255]);
  await range(page); await page.getByText('Remembered opacity keys',{exact:true}).click();
  await page.getByRole('button',{name:'Frame 5 · 100%',exact:true}).click();
  await page.getByRole('button',{name:'Remove remembered opacity key',exact:true}).click();
  expect(await f.read()).toEqual(p);
  await page.keyboard.press('Control+z'); expect(await f.read()).toEqual(saved);
});
test('main existing opacity resolves mixed checked tracks without changing other channels', async ({
  page,
}) => {
  const p = rememberedFixture();
  p.layers.push({
    ...structuredClone(p.layers[0]),
    id: 'extra',
    name: 'Extra',
    motionSpans: p.layers[0].motionSpans!.map((s) => ({
      ...structuredClone(s),
      id: s.id + '-extra',
    })),
  });
  setRememberedMotionOpacityEase(p, [p.layers[0].id], 0, 8, 'out');
  const f = await setup(page, false, p);
  await range(page);
  await page.getByText('Multi-layer frame edits', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
  await page.getByLabel('Remembered motion on checked layers', { exact: true }).check();
  await expect(page.getByLabel('Saved remembered opacity easing', { exact: true })).toHaveText(
    'Mixed opacity easing',
  );
  await page
    .getByRole('button', { name: 'Apply opacity easing to remembered motion', exact: true })
    .click();
  for (const l of (await f.read()).layers) {
    expect(l.motionSpans![0].opacityEase).toBe('linear');
    expect(l.keys[4].shapes[0].opacity).toBeCloseTo(0.5, 13);
    expect(l.keys[4].shapes[0].x).toBe(30);
  }
  await expect(page.getByLabel('Saved remembered opacity easing', { exact: true })).toHaveText(
    'Independent opacity: linear',
  );
  expect(f.errors).toEqual([]);
});
for (const symbol of [false, true])
  for (const change of ['target', 'source'] as const)
    test(`existing opacity rejects late ${change} after complete candidate preparation in ${symbol ? 'symbol' : 'main'}`, async ({
      page,
    }) => {
      const f = await setup(page, symbol, rememberedFixture(symbol));
      if (symbol) {
        await page
          .getByRole('group', { name: 'Symbol Opacity', exact: true })
          .getByRole('button', { name: 'Edit symbol timeline', exact: true })
          .click();
        await page.getByLabel('Symbol range end', { exact: true }).fill('9');
      } else await range(page);
      const label = symbol ? 'Existing symbol opacity easing' : 'Existing opacity easing';
      await page.getByLabel(label, { exact: true }).selectOption('out');
      await page.evaluate(
        ({ symbol, change, label, schemaVersion }) => {
          const original = JSON.stringify;
          let fired = false;
          Object.assign(window, { opacityLateHook: false });
          JSON.stringify = ((value: unknown, ...args: unknown[]) => {
            const v = value as {
              id?: string;
              schemaVersion?: number;
              layers?: { motionSpans?: { opacityEase?: unknown }[] }[];
              timeline?: { motionSpans?: { opacityEase?: unknown }[] };
            } | null;
            if (
              !fired &&
              v &&
              typeof v === 'object' &&
              (symbol
                ? v.id === 's' && v.timeline?.motionSpans?.[0].opacityEase === 'out'
                : v.schemaVersion === schemaVersion &&
                  v.layers?.[0].motionSpans?.[0].opacityEase === 'out')
            ) {
              fired = true;
              Object.assign(window, { opacityLateHook: true });
              if (change === 'target') {
                const input = document.querySelector(
                  `[aria-label="${label}"]`,
                ) as HTMLSelectElement;
                input.value = 'linear';
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.value = 'out';
                input.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                const input = document.querySelector(
                  `[aria-label="${symbol ? 'Symbol duration' : 'Stage color'}"]`,
                ) as HTMLInputElement;
                if (!input) throw Error('Missing actual source edit control');
                input.value = symbol ? '13' : '#00ff00';
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return original(value, ...(args as []));
          }) as typeof JSON.stringify;
        },
        { symbol, change, label, schemaVersion: f.p.schemaVersion },
      );
      await page
        .getByRole('button', {
          name: symbol
            ? 'Apply opacity easing to remembered symbol motion'
            : 'Apply opacity easing to remembered motion',
          exact: true,
        })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { opacityLateHook: boolean }).opacityLateHook,
        ),
      ).toBe(true);
      await expect(page.getByRole('alert')).toContainText(/changed/);
      if (symbol) {
        await expect(
          page.getByLabel('Saved remembered symbol opacity easing', { exact: true }),
        ).toHaveText('Opacity inherits global easing');
        if (change === 'source')
          await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('13');
        else
          await expect(
            page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
          ).toBeDisabled();
        await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
        expect(await f.read()).toEqual(f.p);
      } else {
        const result = await f.read();
        expect(Object.hasOwn(result.layers[0].motionSpans![0], 'opacityEase')).toBe(false);
        if (change === 'source') {
          expect(result.background).toBe('#00ff00');
          await page.getByLabel('Drawing stage').focus();
          await page.keyboard.press('Control+z');
        }
        expect(await f.read()).toEqual(f.p);
      }
      expect(f.errors).toEqual([]);
    });
for (const mode of ['linear', 'out', 'custom'] as const)
  test('edit existing main opacity override, remove and reopen ' + mode, async ({ page }) => {
    const f = await setup(page, false, rememberedFixture());
    await range(page);
    await expect(page.getByLabel('Saved remembered opacity easing', { exact: true })).toHaveText(
      'Opacity inherits global easing',
    );
    await page.getByLabel('Existing opacity easing', { exact: true }).selectOption(mode);
    if (mode === 'custom')
      for (const [key, value] of [
        ['X1', 1 / 3],
        ['X2', 2 / 3],
        ['Y1', 0],
        ['Y2', 0],
      ] as const)
        await page
          .getByLabel('Existing opacity easing ' + key, { exact: true })
          .fill(String(value));
    // Creation preferences remain independent of existing authoring actions.
    await page.getByLabel('Independent remembered opacity easing', { exact: true }).check();
    await page.getByLabel('Remembered opacity easing', { exact: true }).selectOption('in-out');
    await page
      .getByRole('button', { name: 'Apply opacity easing to remembered motion', exact: true })
      .click();
    const saved = await f.read(),
      layer = saved.layers[0];
    expect(layer.keys[4].shapes[0].opacity).toBeCloseTo(
      mode === 'linear' ? 0.5 : mode === 'out' ? 0.65 : 0.275,
      13,
    );
    expect(layer.keys[4].shapes[0].x).toBe(30);
    expect(layer.motionSpans![0].id).toBe(f.p.layers[0].motionSpans![0].id);
    expect(layer.keys[0]).toEqual(f.p.layers[0].keys[0]);
    expect(layer.keys[8]).toEqual(f.p.layers[0].keys[8]);
    expect(layer.keys.at(-1)).toEqual(f.p.layers[0].keys.at(-1));
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(saved);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await range(page);
    await expect(page.getByLabel('Saved remembered opacity easing', { exact: true })).toContainText(
      'Independent opacity',
    );
    await page
      .getByRole('button', { name: 'Remove remembered opacity override', exact: true })
      .click();
    const removed = await f.read();
    expect(Object.hasOwn(removed.layers[0].motionSpans![0], 'opacityEase')).toBe(false);
    expect(removed.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(0.35, 13);
    expect(f.errors).toEqual([]);
  });
test('existing main opacity rejects no-op/invalid controls without extra history and permits correction', async ({
  page,
}) => {
  const f = await setup(page, false, rememberedFixture());
  await range(page);
  await page
    .getByRole('button', { name: 'Remove remembered opacity override', exact: true })
    .click();
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Existing opacity easing', { exact: true }).selectOption('custom');
  await page.getByLabel('Existing opacity easing Y1', { exact: true }).fill('2');
  await page
    .getByRole('button', { name: 'Apply opacity easing to remembered motion', exact: true })
    .click();
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Existing opacity easing Y1', { exact: true }).fill('0');
  await page
    .getByRole('button', { name: 'Apply opacity easing to remembered motion', exact: true })
    .click();
  expect((await f.read()).layers[0].motionSpans![0].opacityEase).toMatchObject({
    kind: 'cubic',
    y1: 0,
  });
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('existing opacity Apply and Remove change real PNG alpha without moving the artwork', async ({
  page,
}) => {
  const f = await setup(page, false, rememberedFixture()),
    greens: number[] = [];
  for (const action of ['original', 'apply', 'remove']) {
    await range(page);
    if (action === 'apply') {
      await page.getByLabel('Existing opacity easing', { exact: true }).selectOption('out');
      await page
        .getByRole('button', { name: 'Apply opacity easing to remembered motion', exact: true })
        .click();
    }
    if (action === 'remove')
      await page
        .getByRole('button', { name: 'Remove remembered opacity override', exact: true })
        .click();
    const box = (await page.getByLabel('Timeline frames').boundingBox())!;
    await page.mouse.click(box.x + 4 * 18 + 9, box.y + 40);
    await openExportSettings(page);
    const down = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    const data = (await fs.readFile((await (await down).path())!)).toString('base64');
    const pixel = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(40, 30, 1, 1).data];
    }, data);
    expect(pixel[0]).toBe(255);
    expect(pixel[3]).toBe(255);
    expect(pixel[2]).toBe(pixel[1]);
    expect(Math.abs(pixel[1] - (action === 'apply' ? 89 : 166))).toBeLessThanOrEqual(1);
    greens.push(pixel[1]);
  }
  expect(greens[0] - greens[1]).toBeGreaterThan(70);
  expect(greens[2]).toBe(greens[0]);
  expect(f.errors).toEqual([]);
});
test('late symbol close after complete opacity candidate cannot publish into a remounted editor', async ({
  page,
}) => {
  const f = await setup(page, true, rememberedFixture(true));
  const open = () =>
    page
      .getByRole('group', { name: 'Symbol Opacity', exact: true })
      .getByRole('button', { name: 'Edit symbol timeline', exact: true })
      .click();
  await open();
  await page.getByLabel('Symbol range end', { exact: true }).fill('9');
  await page.getByLabel('Existing symbol opacity easing', { exact: true }).selectOption('out');
  await page.evaluate(() => {
    const original = JSON.stringify;
    let hit = false;
    Object.assign(window, { opacityCloseHook: false });
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const s = value as {
        id?: string;
        timeline?: { motionSpans?: { opacityEase?: unknown }[] };
      } | null;
      if (!hit && s?.id === 's' && s.timeline?.motionSpans?.[0].opacityEase === 'out') {
        hit = true;
        Object.assign(window, { opacityCloseHook: true });
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Cancel symbol timeline',
        );
        if (!button) throw Error('Missing actual close control');
        button.click();
      }
      return original(value, ...(args as []));
    }) as typeof JSON.stringify;
  });
  await page
    .getByRole('button', { name: 'Apply opacity easing to remembered symbol motion', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { opacityCloseHook: boolean }).opacityCloseHook,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await open();
  await page.getByLabel('Symbol range end', { exact: true }).fill('9');
  await expect(
    page.getByLabel('Saved remembered symbol opacity easing', { exact: true }),
  ).toHaveText('Opacity inherits global easing');
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  expect(f.errors).toEqual([]);
});
test('main opacity rejects source changes while its history before-image is being prepared', async ({
  page,
}) => {
  const f = await setup(page, false, rememberedFixture());
  await range(page);
  await page.getByLabel('Existing opacity easing', { exact: true }).selectOption('out');
  await page.evaluate((schemaVersion) => {
    const original = JSON.stringify;
    let prepared = false,
      reads = 0,
      hit = false;
    Object.assign(window, { opacityHistoryHook: false });
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const p = value as {
        schemaVersion?: number;
        layers?: { motionSpans?: { opacityEase?: unknown }[] }[];
      } | null;
      if (p?.schemaVersion === schemaVersion) {
        if (p.layers?.[0].motionSpans?.[0].opacityEase === 'out') prepared = true;
        else if (prepared && !hit && ++reads === 2) {
          hit = true;
          Object.assign(window, { opacityHistoryHook: true });
          const input = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
          if (!input) throw Error('Missing actual source control');
          input.value = '#00ff00';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return original(value, ...(args as []));
    }) as typeof JSON.stringify;
  }, f.p.schemaVersion);
  await page
    .getByRole('button', { name: 'Apply opacity easing to remembered motion', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { opacityHistoryHook: boolean }).opacityHistoryHook,
    ),
  ).toBe(true);
  const result = await f.read();
  expect(result.background).toBe('#00ff00');
  expect(Object.hasOwn(result.layers[0].motionSpans![0], 'opacityEase')).toBe(false);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('isolated existing all-track opacity retains local/Apply/document history and settings', async ({
  page,
}) => {
  const f = await setup(page, true, rememberedFixture(true));
  const open = async () => {
    await openSymbolTimeline(page);
    await page.getByLabel('Symbol range start', { exact: true }).fill('1');
    await page.getByLabel('Symbol range end', { exact: true }).fill('9');
    await page.getByRole('button', { name: 'Select all symbol tracks', exact: true }).click();
    await page.getByLabel('Remembered motion on checked symbol tracks', { exact: true }).check();
  };
  const apply = () =>
    page
      .getByRole('button', {
        name: 'Apply opacity easing to remembered symbol motion',
        exact: true,
      })
      .click();
  await open();
  await page.getByLabel('Existing symbol opacity easing', { exact: true }).selectOption('out');
  await apply();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByLabel('Saved remembered symbol opacity easing', { exact: true }),
  ).toHaveText('Independent opacity: out');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('dialog',{name:'Symbol timeline',exact:true}).getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
  await expect(
    page.getByLabel('Saved remembered symbol opacity easing', { exact: true }),
  ).toHaveText('Opacity inherits global easing');
  await page.getByRole('dialog',{name:'Symbol timeline',exact:true}).getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  await page.getByRole('button',{name:'Cancel symbol editing',exact:true}).click();
  expect(await f.read()).toEqual(f.p);
  await open();
  await page.getByLabel('Existing symbol opacity easing', { exact: true }).selectOption('out');
  await apply();
  await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByRole('button',{name:'Save and return to scene',exact:true}).click();
  const saved = await f.read();
  for (const l of symbolLayers(saved.symbols![0])) {
    expect(l.motionSpans![0].opacityEase).toBe('out');
    expect(l.keys[4].shapes[0].opacity).toBeCloseTo(0.65, 13);
    expect(l.keys[4].shapes[0].x).toBe(30);
  }
  expect(saved.symbols![0].multiFramePivot).toEqual(f.p.symbols![0].multiFramePivot);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  expect(await f.read()).toEqual(saved);
  await open();
  await page
    .getByRole('button', { name: 'Remove remembered symbol opacity override', exact: true })
    .click();
  await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await page.getByRole('button',{name:'Save and return to scene',exact:true}).click();
  for (const l of symbolLayers((await f.read()).symbols![0])) {
    expect(Object.hasOwn(l.motionSpans![0], 'opacityEase')).toBe(false);
    expect(l.keys[4].shapes[0].opacity).toBeCloseTo(0.35, 13);
  }
  expect(f.errors).toEqual([]);
});
for (const mode of ['off', 'out', 'custom'])
  test('main independent opacity recipe creation ' + mode, async ({ page }) => {
    const f = await setup(page);
    await range(page);
    await page.getByLabel('Remembered motion easing', { exact: true }).selectOption('in');
    await expect(
      page.getByLabel('Independent remembered opacity easing', { exact: true }),
    ).not.toBeChecked();
    if (mode !== 'off') {
      await page.getByLabel('Independent remembered opacity easing', { exact: true }).check();
      await page.getByLabel('Remembered opacity easing', { exact: true }).selectOption(mode);
      if (mode === 'custom')
        for (const [key, value] of [
          ['X1', 1 / 3],
          ['X2', 2 / 3],
          ['Y1', 0],
          ['Y2', 0],
        ] as const)
          await page
            .getByLabel('Remembered opacity easing ' + key, { exact: true })
            .fill(String(value));
    }
    await page.getByRole('button', { name: 'Create remembered motion', exact: true }).click();
    await expect.poll(async () => (await f.read()).layers[0].motionSpans?.length).toBe(1);
    const saved = await f.read(),
      layer = saved.layers[0],
      span = layer.motionSpans![0];
    expect(layer.keys[4].shapes[0].x).toBe(30);
    expect(layer.keys[4].shapes[0].opacity).toBeCloseTo(
      mode === 'off' ? 0.35 : mode === 'out' ? 0.65 : 0.275,
      13,
    );
    expect(Object.hasOwn(span, 'opacityEase')).toBe(mode !== 'off');
    expect(span.ease).toBe('in');
    expect(layer.keys[0]).toEqual(f.p.layers[0].keys[0]);
    expect(layer.keys[8]).toEqual(f.p.layers[0].keys[1]);
    expect(layer.keys.at(-1)).toEqual(f.p.layers[0].keys[2]);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(saved);
    await page.getByLabel('Remembered motion easing', { exact: true }).selectOption('linear');
    await page
      .getByRole('button', { name: 'Apply easing to remembered motion', exact: true })
      .click();
    const refreshed = await f.read();
    expect(refreshed.layers[0].keys[4].shapes[0].x).toBe(50);
    expect(refreshed.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(
      mode === 'off' ? 0.5 : mode === 'out' ? 0.65 : 0.275,
      13,
    );
    expect(refreshed.layers[0].motionSpans![0].opacityEase).toEqual(span.opacityEase);
    expect(f.errors).toEqual([]);
  });
test('main independent opacity rejects raw invalid custom controls and recovers without history', async ({
  page,
}) => {
  const f = await setup(page);
  await range(page);
  await page.getByLabel('Independent remembered opacity easing', { exact: true }).check();
  await page.getByLabel('Remembered opacity easing', { exact: true }).selectOption('custom');
  await page.getByLabel('Remembered opacity easing Y1', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Create remembered motion', exact: true }).click();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Remembered opacity easing Y1', { exact: true })).toHaveValue('2');
  await page.getByLabel('Remembered opacity easing Y1', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Create remembered motion', exact: true }).click();
  await expect.poll(async () => (await f.read()).layers[0].motionSpans?.length).toBe(1);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const enabled of [false, true])
  test('isolated all-track opacity creation history ' + enabled, async ({ page }) => {
    const f = await setup(page, true),
      open = () =>
        page
          .getByRole('group', { name: 'Symbol Opacity', exact: true })
          .getByRole('button', { name: 'Edit symbol timeline', exact: true })
          .click();
    const create = async () => {
      await page.getByLabel('Symbol range start', { exact: true }).fill('1');
      await page.getByLabel('Symbol range end', { exact: true }).fill('9');
      await page.getByRole('button', { name: 'Select all symbol tracks', exact: true }).click();
      await page.getByLabel('Remembered motion on checked symbol tracks', { exact: true }).check();
      await page.getByLabel('Remembered symbol motion easing', { exact: true }).selectOption('in');
      await expect(
        page.getByLabel('Independent remembered symbol opacity easing', { exact: true }),
      ).not.toBeChecked();
      if (enabled) {
        await page
          .getByLabel('Independent remembered symbol opacity easing', { exact: true })
          .check();
        await page
          .getByLabel('Remembered symbol opacity easing', { exact: true })
          .selectOption('out');
      }
      await page
        .getByRole('button', { name: 'Create remembered symbol motion', exact: true })
        .click();
    };
    await open();
    await create();
    await expect(
      page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
    ).toBeVisible();
    expect(await f.read()).toEqual(f.p);
    await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
    expect(await f.read()).toEqual(f.p);
    await open();
    await create();
    await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const saved = await f.read();
    for (const l of symbolLayers(saved.symbols![0])) {
      expect(Object.hasOwn(l.motionSpans![0], 'opacityEase')).toBe(enabled);
      expect(l.keys[4].shapes[0].opacity).toBeCloseTo(enabled ? 0.65 : 0.35, 13);
      expect(l.keys[4].shapes[0].x).toBe(30);
    }
    expect(saved.symbols![0].multiFramePivot).toEqual(f.p.symbols![0].multiFramePivot);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(saved);
    expect(f.errors).toEqual([]);
  });

test('remembered PNG uses independent opacity from edited endpoints without changing baked artwork', async ({
  page,
}) => {
  const p = fixture();
  createBasicMotionSpan(
    p,
    [p.layers[0].id],
    0,
    8,
    'in',
    undefined,
    undefined,
    undefined,
    undefined,
    'out',
  );
  p.layers[0].keys[8].shapes[0].opacity = 0.4;
  const f = await setup(page, false, p);
  const box = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x + 4 * 18 + 9, box.y + 40);
  const observed: number[][] = [];
  for (const remembered of [false, true]) {
    await openExportSettings(page);
    await page.getByLabel('Use remembered PNG motion', { exact: true }).setChecked(remembered);
    const down = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    const data = (await fs.readFile((await (await down).path())!)).toString('base64');
    const pixel = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(40, 30, 1, 1).data];
    }, data);
    observed.push(pixel);
    expect(pixel[0]).toBe(255);
    expect(pixel[3]).toBe(255);
    expect(Math.abs(pixel[1] - (remembered ? 166 : 89))).toBeLessThanOrEqual(1);
    expect(pixel[2]).toBe(pixel[1]);
  }
  expect(observed[1][1] - observed[0][1]).toBeGreaterThan(70);
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
});

test('remembered PNG retains independent paint progress separately from geometry and object opacity', async ({
  page,
}) => {
  const p = fixture();
  for (const key of p.layers[0].keys)
    for (const art of key.shapes) {
      art.fill = key.frame ? '#808080' : '#000000';
      art.stroke = art.fill;
      art.opacity = key.frame ? 1 : 0;
    }
  createBasicMotionSpan(
    p,
    [p.layers[0].id],
    0,
    8,
    'in',
    { paint: true },
    undefined,
    undefined,
    undefined,
    'out',
    { kind: 'cubic', x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 },
  );
  p.layers[0].keys[8].shapes[0].fill = '#ffffff';
  const f = await setup(page, false, p),
    box = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x + 4 * 18 + 9, box.y + 40);
  for (const remembered of [false, true]) {
    await openExportSettings(page);
    await page.getByLabel('Use remembered PNG motion', { exact: true }).setChecked(remembered);
    const down = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    const data = (await fs.readFile((await (await down).path())!)).toString('base64');
    const pixel = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(40, 30, 1, 1).data];
    }, data);
    const color = remembered ? 32 : 16,
      expected = color * 0.75 + 255 * 0.25;
    expect(pixel[3]).toBe(255);
    for (const value of pixel.slice(0, 3))
      expect(Math.abs(value - expected)).toBeLessThanOrEqual(1);
  }
  expect(await f.read()).toEqual(p);
  expect(f.errors).toEqual([]);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
});

test('remembered color keys recover stage fill and stroke and undo independently',async({page})=>{
  const p=fixture(), layer=p.layers[0];
  for(const key of layer.keys) for(const art of key.shapes) Object.assign(art,{opacity:1,strokeWidth:6});
  createBasicMotionSpan(p,[layer.id],0,8,'linear',{paint:true,strokeColor:true});
  const f=await setup(page,false,p);
  await range(page);
  await page.getByText('Remembered color keys',{exact:true}).click();
  for(const [property,frame,color] of [['fill','3','#00ff00'],['stroke','5','#0000ff']]){
    await page.getByLabel('Remembered color property').selectOption(property);
    await page.getByLabel('Remembered color key frame').fill(frame);
    await page.getByLabel('Remembered key color').fill(color);
    await page.getByRole('button',{name:'Set remembered color key',exact:true}).click();
  }
  const saved=await f.read();
  expect(saved.layers[0].keys[2].shapes[0]).toMatchObject({x:30,fill:'#00ff00',stroke:'#000080'});
  expect(saved.layers[0].keys[4].shapes[0].stroke).toBe('#0000ff');
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const box=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x+2*18+9,box.y+40);
  const pixel=(y:number)=>page.getByLabel('Drawing stage',{exact:true}).evaluate((el,y)=>{
    const c=el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2-40*devicePixelRatio,c.height/2+(y-50)*devicePixelRatio,1,1).data);
  },y);
  await expect.poll(()=>pixel(30)).toEqual([0,255,0,255]);
  await expect.poll(()=>pixel(20)).toEqual([0,0,128,255]);
  await range(page); await page.getByText('Remembered color keys',{exact:true}).click();
  await page.getByRole('button',{name:'Frame 3 · fill #00ff00',exact:true}).click();
  await page.getByRole('button',{name:'Remove remembered color key',exact:true}).click();
  const cleared=await f.read();
  expect(cleared.layers[0].keys[2].shapes[0]).toMatchObject({fill:'#ff0000',stroke:'#000080'});
  await page.keyboard.press('Control+z'); expect(await f.read()).toEqual(saved);
  expect(f.errors).toEqual([]);
});

test('remembered scale keys resize artwork independently and survive recovery and undo',async({page})=>{
  const p=fixture(), layer=p.layers[0];
  for(const key of layer.keys) for(const art of key.shapes) art.opacity=1;
  createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true});
  const f=await setup(page,false,p);
  await range(page); await page.getByText('Remembered scale keys',{exact:true}).click();
  for(const [axis,frame,value] of [['x','3','2'],['y','5','0.5']]){
    await page.getByLabel('Remembered scale axis').selectOption(axis);
    await page.getByLabel('Remembered scale key frame').fill(frame);
    await page.getByLabel('Scale factor',{exact:true}).fill(value);
    await page.getByRole('button',{name:'Set remembered scale key',exact:true}).click();
  }
  for(const [axis,label,ease] of [['x','Horizontal scale','out'],['y','Vertical scale','in']]){
    await page.getByLabel('Remembered scale axis').selectOption(axis);
    await page.getByLabel(label+' interval easing',{exact:true}).selectOption(ease);
    await page.getByRole('button',{name:'Apply '+label.toLowerCase()+' interval easing',exact:true}).click();
  }
  const saved=await f.read();
  expect(saved.layers[0].keys[1].shapes[0].transform).toEqual([1.75,0,0,0.96875]);
  expect(saved.layers[0].keys[2].shapes[0].transform).toEqual([2,0,0,0.875]);
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const box=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x+2*18+9,box.y+40);
  const pixel=(y:number)=>page.getByLabel('Drawing stage',{exact:true}).evaluate((el,y)=>{
    const c=el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2+10*devicePixelRatio,c.height/2+(y-50)*devicePixelRatio,1,1).data);
  },y);
  await expect.poll(()=>pixel(44)).toEqual([255,0,0,255]);
  await expect.poll(()=>pixel(48)).toEqual([255,255,255,255]);
  await range(page);await page.getByText('Remembered scale keys',{exact:true}).click();
  await page.getByRole('button',{name:'Frame 3 · X 2',exact:true}).click();
  await page.getByRole('button',{name:'Remove remembered scale key',exact:true}).click();
  expect((await f.read()).layers[0].keys[2].shapes[0].transform).toEqual([1,0,0,0.875]);
  await page.keyboard.press('Control+z');expect(await f.read()).toEqual(saved);
  expect(f.errors).toEqual([]);
});

test('remembered rotation and shear keys animate full turns and survive recovery and undo',async({page})=>{
  const p=fixture(), layer=p.layers[0];
  for(const key of layer.keys) for(const art of key.shapes) art.opacity=1;
  createBasicMotionSpan(p,[layer.id],0,8,'linear',{affine:true});
  const f=await setup(page,false,p);
  await range(page); await page.getByText('Remembered rotation and shear keys',{exact:true}).click();
  for(const [axis,frame,value] of [['rotation','3','450'],['shear','5','1']]){
    await page.getByLabel('Remembered transform property').selectOption(axis);
    await page.getByLabel('Remembered transform key frame').fill(frame);
    await page.getByLabel(axis==='rotation'?'Rotation (degrees)':'Shear factor',{exact:true}).fill(value);
    await page.getByRole('button',{name:'Set remembered transform key',exact:true}).click();
  }
  const saved=await f.read();
  expect(saved.layers[0].keys[2].shapes[0]).toMatchObject({rotation:450,transform:[1,0,0.5,1]});
  await page.reload(); await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const box=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x+2*18+9,box.y+40);
  const pixel=(y:number)=>page.getByLabel('Drawing stage',{exact:true}).evaluate((el,y)=>{
    const c=el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2-60*devicePixelRatio,c.height/2+(y-50)*devicePixelRatio,1,1).data);
  },y);
  await expect.poll(()=>pixel(63)).toEqual([255,0,0,255]);
  await expect.poll(()=>pixel(15)).toEqual([255,255,255,255]);
  await range(page);await page.getByText('Remembered rotation and shear keys',{exact:true}).click();
  await page.getByRole('button',{name:'Frame 3 · rotation 450',exact:true}).click();
  await page.getByRole('button',{name:'Remove remembered transform key',exact:true}).click();
  expect((await f.read()).layers[0].keys[2].shapes[0]).toMatchObject({rotation:0,transform:[1,0,0.5,1]});
  await page.keyboard.press('Control+z');expect(await f.read()).toEqual(saved);
  expect(f.errors).toEqual([]);
});

test('remembered gradient stop key restores rendered color after recovery and supports removal and undo',async({page})=>{
  const p=fixture(),layer=p.layers[0];
  for(const key of layer.keys.slice(0,2)){
    const shape=key.shapes[0];shape.opacity=1;
    shape.gradient={kind:'linear',from:{x:10,y:0},to:{x:30,y:0},stops:[
      {offset:0,color:'#ff0000',opacity:0.5},{offset:1,color:'#0000ff'}]};
  }
  createBasicMotionSpan(p,[layer.id],0,8,'linear',{paint:true});
  const f=await setup(page,false,p);
  async function openStops(){
    await range(page);await page.getByText('Remembered color keys',{exact:true}).click();
    await page.getByLabel('Remembered color property').selectOption('gradient');
    await page.getByLabel('Matched gradient stop',{exact:true}).fill('1');
  }
  await openStops();
  await page.getByLabel('Remembered color key frame').fill('3');
  await page.getByLabel('Remembered key color').fill('#00ff00');
  await page.getByRole('button',{name:'Set remembered color key',exact:true}).click();
  await page.getByLabel('Gradient stop interval easing',{exact:true}).selectOption('in');
  await page.getByRole('button',{name:'Apply gradient stop interval easing',exact:true}).click();
  const saved=await f.read();
  expect(saved.layers[0].keys[1].shapes[0].gradient!.stops[0]).toEqual({offset:0,color:'#bf4000',opacity:0.5});
  expect(saved.layers[0].keys[2].shapes[0].gradient!.stops).toEqual([{offset:0,color:'#00ff00',opacity:0.5},{offset:1,color:'#0000ff'}]);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  const box=(await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x+2*18+9,box.y+40);
  const pixel=()=>page.getByLabel('Drawing stage',{exact:true}).evaluate(el=>{
    const c=el as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(c.width/2-45*devicePixelRatio,c.height/2-20*devicePixelRatio,1,1).data);
  });
  await expect.poll(async()=>{const [r,g,b,a]=await pixel();return Math.abs(r-128)<=1 && b===r && g===255 && a===255;}).toBe(true);
  await openStops();await page.getByRole('button',{name:'Frame 3 · gradient #00ff00',exact:true}).click();
  await page.getByRole('button',{name:'Remove remembered color key',exact:true}).click();
  expect(await f.read()).toEqual(p);
  await page.keyboard.press('Control+z');expect(await f.read()).toEqual(saved);
});

test('symbol remembered keys support local history, Cancel, Apply and restored property edits',async({page})=>{
  const p=fixture(true),original=p.symbols![0],ids=symbolLayers(original).map(l=>l.id);
  const sibling={...structuredClone(original),id:'sibling',name:'Sibling'};p.symbols!.push(sibling);
  p.symbols![0]=editSymbolBasicMotionSpan(original,ids,0,8,'create','linear',p.symbols,undefined,false,{paint:true,strokeColor:true,affine:true});
  const f=await setup(page,true,p);
  async function open(){
    await openSymbolTimeline(page);
    await page.getByLabel('Symbol range start',{exact:true}).fill('1');
    await page.getByLabel('Symbol range end',{exact:true}).fill('9');
    await page.getByRole('button',{name:'Select all symbol tracks',exact:true}).click();
    await page.getByLabel('Remembered motion on checked symbol tracks',{exact:true}).check();
    await page.getByText('Remembered symbol property keys',{exact:true}).click();
  }
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  async function set(prop:string,at:string,value:string){
    await page.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption(prop);
    await page.getByLabel('Symbol property key frame',{exact:true}).fill(at);
    await page.getByLabel(value.startsWith('#')?'Symbol key color':'Symbol key value',{exact:true}).fill(value);
    await button('Set symbol property key').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await open();await set('rotationKeys','3','450');
  await page.getByRole('dialog',{name:'Symbol timeline',exact:true}).getByRole('button',{name:'Undo symbol timeline change',exact:true}).click();await expect(button('Frame 3 · 450')).toHaveCount(0);
  await page.getByRole('dialog',{name:'Symbol timeline',exact:true}).getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();await expect(button('Frame 3 · 450')).toBeVisible();
  await button('Cancel symbol timeline').click();await button('Cancel symbol editing').click();expect(await f.read()).toEqual(p);
  await open();
  for(const [prop,value] of [['xKeys','30'],['yKeys','40'],['scaleXKeys','2'],['scaleYKeys','0.5'],['opacityKeys','75'],['shearKeys','1'],['rotationKeys','450'],['fillColorKeys','#00ff00'],['strokeColorKeys','#0000ff']])await set(prop,'3',value);
  for(const [prop,label,ease] of [['scaleXKeys','Horizontal scale','in'],['scaleYKeys','Vertical scale','out'],['shearKeys','Shear','in']]){
    await page.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption(prop);
    await page.getByLabel(label+' interval easing',{exact:true}).selectOption(ease);
    await button('Apply '+label.toLowerCase()+' interval easing').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await set('rotationKeys','3','720');
  expect(await f.read()).toEqual(p);
  await button('Apply symbol timeline').click();await button('Save and return to scene').click();
  const saved=await f.read();expect(saved.layers).toEqual(p.layers);expect(saved.symbols![1]).toEqual(sibling);
  for(const [i,l] of symbolLayers(saved.symbols![0]).entries()){
    expect(l.keys[1].shapes[0].transform).toEqual([1.25,0,0.25,0.625]);
    expect(l.keys[2].shapes[0]).toMatchObject({x:30,y:40,opacity:0.75,rotation:720,transform:[2,0,1,0.5],fill:'#00ff00',stroke:'#0000ff'});
    const before=symbolLayers(p.symbols![0])[i];
    for(const at of [0,8,10])expect(l.keys.find(k=>k.frame===at)).toEqual(before.keys.find(k=>k.frame===at));
  }
  await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+z');expect(await f.read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await f.read()).toEqual(saved);
  await page.reload();await button('Recover changes').click();await open();
  await page.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption('rotationKeys');await button('Frame 3 · 720').click();
  await button('Remove symbol property key').click();await button('Apply symbol timeline').click();await button('Save and return to scene').click();
  for(const l of symbolLayers((await f.read()).symbols![0])){
    expect(l.motionSpans![0].rotationKeys).toBeUndefined();expect(l.keys[2].shapes[0].transform).toEqual([2,0,1,0.5]);
  }
  expect(f.errors).toEqual([]);
});

test('symbol gradient stop keys reject a mixed selection and apply to the original gradient track',async({page})=>{
  const p=fixture(true),s=p.symbols![0];
  for(const art of [...s.shapes,...s.timeline!.keys.flatMap(k=>k.shapes)])art.gradient={
    kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:'#000000',opacity:0.5},{offset:1,color:'#ffffff'}]};
  p.symbols![0]=editSymbolBasicMotionSpan(s,symbolLayers(s).map(l=>l.id),0,8,'create','linear',[s],undefined,false,{paint:true});
  const f=await setup(page,true,p),button=(name:string)=>page.getByRole('button',{name,exact:true});
  await openSymbolTimeline(page);
  await page.getByLabel('Symbol range start',{exact:true}).fill('1');await page.getByLabel('Symbol range end',{exact:true}).fill('9');
  await button('Select all symbol tracks').click();
  const batch=page.getByLabel('Remembered motion on checked symbol tracks',{exact:true});await batch.check();
  await page.getByText('Remembered symbol property keys',{exact:true}).click();
  await page.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption('gradient');
  await page.getByLabel('Symbol matched stop',{exact:true}).fill('1');
  await page.getByLabel('Symbol property key frame',{exact:true}).fill('4');
  await page.getByLabel('Symbol key color',{exact:true}).fill('#00ff00');
  await button('Set symbol property key').click();await expect(page.getByRole('alert')).toContainText('missing');
  expect(await f.read()).toEqual(p);await expect(button('Frame 4 · #00ff00')).toHaveCount(0);
  await batch.uncheck();await button('Set symbol property key').click();await expect(button('Frame 4 · #00ff00')).toBeVisible();
  await page.getByLabel('Gradient stop interval easing',{exact:true}).selectOption('in');
  await batch.check();await button('Apply gradient stop interval easing').click();
  await expect(page.getByRole('alert')).toContainText('existing gradient stop interval');
  await batch.uncheck();await button('Apply gradient stop interval easing').click();
  const timeline=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  await timeline.getByRole('button',{name:'Undo symbol timeline change',exact:true}).click();
  await expect(timeline.getByLabel('Gradient stop interval easing',{exact:true})).toHaveValue('linear');
  await timeline.getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();
  await expect(timeline.getByLabel('Gradient stop interval easing',{exact:true})).toHaveValue('in');
  await button('Apply symbol timeline').click();await button('Save and return to scene').click();
  const saved=await f.read(),layers=symbolLayers(saved.symbols![0]);
  expect(layers[0].keys[1].shapes[0].gradient!.stops[0].color).toBe('#001c00');
  expect(layers[0].keys[3].shapes[0].gradient!.stops[0]).toEqual({offset:0,color:'#00ff00',opacity:0.5});
  expect(layers[1]).toEqual(symbolLayers(p.symbols![0])[1]);expect(f.errors).toEqual([]);
});

test('edits remembered position interval easing, recovers its curve and undoes removal',async({page})=>{
  const p=rememberedFixture(),f=await setup(page,false,p);
  const open=async()=>{
    await range(page);
    await page.getByText('Remembered position keys',{exact:true}).click();
  };
  await open();
  await page.getByLabel('Remembered position key frame').fill('5');
  await page.getByLabel('Document coordinate',{exact:true}).fill('80');
  await page.getByRole('button',{name:'Set remembered position key',exact:true}).click();
  const linear=await f.read();
  const easing=page.getByLabel('Position interval easing',{exact:true});
  await easing.selectOption('custom');
  for(const [name,value] of [['X1',1/3],['X2',2/3],['Y1',0],['Y2',0]]){
    await page.getByLabel('Position interval easing '+name,{exact:true}).fill(String(value));
  }
  const apply=page.getByRole('button',{name:'Apply position interval easing',exact:true});
  await apply.click();
  const saved=await f.read(),from=p.layers[0].keys[0].shapes[0].x;
  expect(saved.layers[0].keys[2].shapes[0].x).toBeCloseTo(from+(80-from)/8,10);
  expect(saved.layers[0].keys[4]).toEqual(linear.layers[0].keys[4]);
  expect(saved.layers[0].keys.slice(5)).toEqual(linear.layers[0].keys.slice(5));
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await open();
  await expect(easing).toHaveValue('custom');
  await easing.selectOption('linear'); await apply.click();
  expect(await f.read()).toEqual(linear);
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(saved);
  expect(f.errors).toEqual([]);
});

test('isolated symbol position intervals recover custom timing through local and document history',async({page})=>{
  const p=rememberedFixture(true), symbol=p.symbols![0], ids=symbolLayers(symbol).map(l=>l.id);
  let original=editSymbolBasicMotionSpan(symbol,ids,0,8,{property:'xKeys',frame:4,value:80});
  original=editSymbolBasicMotionSpan(original,[ids[0]],0,8,{property:'yKeys',frame:4,value:60});
  p.symbols![0]=original;
  const f=await setup(page,true,p);
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  const dialog=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
  const ease=dialog.getByLabel('Position interval easing',{exact:true});
  async function open(){
    await openSymbolTimeline(page);
    await page.getByLabel('Symbol range start',{exact:true}).fill('1');
    await page.getByLabel('Symbol range end',{exact:true}).fill('9');
    await button('Select all symbol tracks').click();
    await page.getByLabel('Remembered motion on checked symbol tracks',{exact:true}).check();
    await page.getByText('Remembered symbol property keys',{exact:true}).click();
  }
  async function applyCustom(){
    await ease.selectOption('custom');
    for(const [name,value] of [['X1',1/3],['X2',2/3],['Y1',0],['Y2',0]]){
      await dialog.getByLabel('Position interval easing '+name,{exact:true}).fill(String(value));
    }
    await button('Apply position interval easing').click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  }
  await open();
  await dialog.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption('yKeys');
  await ease.selectOption('in');await button('Apply position interval easing').click();
  await expect(dialog.getByRole('alert')).toContainText('existing position interval');
  await dialog.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption('xKeys');
  await applyCustom();
  await dialog.getByRole('button',{name:'Undo symbol timeline change',exact:true}).click();
  await expect(ease).toHaveValue('linear');
  await dialog.getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();
  await expect(ease).toHaveValue('custom');
  await button('Cancel symbol timeline').click();await button('Cancel symbol editing').click();
  expect(await f.read()).toEqual(p);
  await open();await applyCustom();
  await button('Apply symbol timeline').click();
  expect(await f.read()).toEqual(p);
  await button('Save and return to scene').click();
  const saved=await f.read();
  expect(saved.layers).toEqual(p.layers);
  for(const [i,l] of symbolLayers(saved.symbols![0]).entries()){
    const before=symbolLayers(original)[i];
    const x=before.keys[0].shapes[0].x;
    expect(l.keys[2].shapes[0].x).toBeCloseTo(x+(80-x)/8,10);
    expect(l.keys.map(k=>k.shapes[0]?.y)).toEqual(before.keys.map(k=>k.shapes[0]?.y));
    expect(l.keys.slice(4)).toEqual(before.keys.slice(4));
    expect(l.motionSpans![0].yKeyEases).toBeUndefined();
  }
  await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+z');expect(await f.read()).toEqual(p);
  await page.keyboard.press('Control+Shift+z');expect(await f.read()).toEqual(saved);
  await page.reload();await button('Recover changes').click();await open();
  await expect(ease).toHaveValue('custom');
  expect(f.errors).toEqual([]);
});

for(const isolated of [false,true]) test('remembered opacity and rotation timing in '+(isolated?'symbol':'scene')+' authoring',async({page})=>{
  const p=rememberedFixture(isolated);
  if(isolated){
    let symbol=p.symbols![0];
    const ids=symbolLayers(symbol).map(layer=>layer.id);
    symbol=editSymbolBasicMotionSpan(symbol,ids,0,8,{property:'opacityKeys',frame:4,value:1});
    p.symbols![0]=editSymbolBasicMotionSpan(symbol,ids,0,8,{property:'rotationKeys',frame:4,value:480});
  } else {
    const ids=[p.layers[0].id];
    setRememberedOpacityKey(p,ids,0,8,4,1);
    setRememberedRotationOrShearKey(p,ids,0,8,'rotation',4,480);
  }
  const f=await setup(page,isolated,p);
  if(isolated){
    await openSymbolTimeline(page);
    await page.getByLabel('Symbol range start',{exact:true}).fill('1');
    await page.getByLabel('Symbol range end',{exact:true}).fill('9');
    await page.getByRole('button',{name:'Select all symbol tracks',exact:true}).click();
    await page.getByLabel('Remembered motion on checked symbol tracks',{exact:true}).check();
    await page.getByText('Remembered symbol property keys',{exact:true}).click();
  }else await range(page);
  for(const [name,curve] of [['opacity','in'],['rotation','out']]){
    if(isolated)await page.getByRole('combobox',{name:'Symbol key property',exact:true}).selectOption(name+'Keys');
    else await page.getByText(name==='opacity'?'Remembered opacity keys':'Remembered rotation and shear keys',{exact:true}).click();
    await page.getByLabel((name==='opacity'?'Opacity':'Rotation')+' interval easing',{exact:true}).selectOption(curve);
    await page.getByRole('button',{name:'Apply '+name+' interval easing',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  if(isolated){
    expect(await f.read()).toEqual(p);
    const dialog=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
    await dialog.getByRole('button',{name:'Undo symbol timeline change',exact:true}).click();
    await expect(dialog.getByLabel('Rotation interval easing',{exact:true})).toHaveValue('linear');
    await dialog.getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();
    await page.getByRole('button',{name:'Apply symbol timeline',exact:true}).click();
    await page.getByRole('button',{name:'Save and return to scene',exact:true}).click();
  }
  const saved=await f.read(),layers=isolated?symbolLayers(saved.symbols![0]):saved.layers;
  for(const layer of layers){
    expect(layer.keys[2].shapes[0].opacity).toBeCloseTo(0.4,10);
    expect(layer.keys[2].shapes[0].rotation).toBe(360);
    expect(layer.keys[4].shapes[0]).toMatchObject({opacity:1,rotation:480});
  }
  await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+z');
  const undone=await f.read();
  if(isolated)expect(undone).toEqual(p);else expect(undone.layers[0].motionSpans![0].rotationKeyEases).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');expect(await f.read()).toEqual(saved);
  await page.reload();await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  expect(await f.read()).toEqual(saved);
  expect(f.errors).toEqual([]);
});

for(const isolated of [false,true])test('remembered fill and stroke interval curves in '+(isolated?'symbol':'scene')+' artwork',async({page})=>{
  const p=fixture(isolated), options={paint:true,strokeColor:true};
  if(isolated){
    let symbol=p.symbols![0];const ids=symbolLayers(symbol).map(l=>l.id);
    symbol=editSymbolBasicMotionSpan(symbol,ids,0,8,'create','linear',[symbol],undefined,false,options);
    symbol=editSymbolBasicMotionSpan(symbol,ids,0,8,{property:'fillColorKeys',frame:4,value:'#0000ff'});
    p.symbols![0]=editSymbolBasicMotionSpan(symbol,ids,0,8,{property:'strokeColorKeys',frame:4,value:'#00ff00'});
  }else{
    const ids=[p.layers[0].id];
    createBasicMotionSpan(p,ids,0,8,'linear',options);
    setRememberedColorKey(p,ids,0,8,'fill',4,'#0000ff');
    setRememberedColorKey(p,ids,0,8,'stroke',4,'#00ff00');
  }
  const f=await setup(page,isolated,p);
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  if(isolated){
    await openSymbolTimeline(page);
    await page.getByLabel('Symbol range start',{exact:true}).fill('1');
    await page.getByLabel('Symbol range end',{exact:true}).fill('9');
    await button('Select all symbol tracks').click();
    await page.getByLabel('Remembered motion on checked symbol tracks',{exact:true}).check();
    await page.getByText('Remembered symbol property keys',{exact:true}).click();
  }else{
    await range(page);
    await page.getByText('Remembered color keys',{exact:true}).click();
  }
  for(const [channel,curve] of [['Fill','custom'],['Stroke','out']]){
    const prop=channel.toLowerCase();
    await page.getByRole('combobox',{name:isolated?'Symbol key property':'Remembered color property',exact:true}).selectOption(isolated?prop+'ColorKeys':prop);
    await page.getByLabel(channel+' interval easing',{exact:true}).selectOption(curve);
    if(curve==='custom')for(const [control,value] of [['X1',1/3],['X2',2/3],['Y1',0],['Y2',0]]){
      await page.getByLabel(channel+' interval easing '+control,{exact:true}).fill(String(value));
    }
    await button('Apply '+prop+' interval easing').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  if(isolated){
    expect(await f.read()).toEqual(p);
    const dialog=page.getByRole('dialog',{name:'Symbol timeline',exact:true});
    await dialog.getByRole('button',{name:'Undo symbol timeline change',exact:true}).click();
    await expect(dialog.getByLabel('Stroke interval easing',{exact:true})).toHaveValue('linear');
    await dialog.getByRole('button',{name:'Redo symbol timeline change',exact:true}).click();
    await button('Apply symbol timeline').click();await button('Save and return to scene').click();
  }
  const saved=await f.read(),layers=isolated?symbolLayers(saved.symbols![0]):saved.layers;
  for(const l of layers){
    expect(l.keys[2].shapes[0]).toMatchObject({fill:'#df0020',stroke:'#00bf00'});
    expect(l.keys[4].shapes[0]).toMatchObject({fill:'#0000ff',stroke:'#00ff00'});
  }
  await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+z');
  const undone=await f.read();if(isolated)expect(undone).toEqual(p);else expect(undone.layers[0].motionSpans![0].strokeKeyEases).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');expect(await f.read()).toEqual(saved);
  await page.reload();await button('Recover changes').click();expect(await f.read()).toEqual(saved);
  expect(f.errors).toEqual([]);
});
