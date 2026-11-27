import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { newProject, symbolLayers, type Project, type Vector } from '../../packages/document/src';
import {
  createBasicMotionSpan,
  editSymbolBasicMotionSpan,
} from '../../packages/animation/src/motion-spans';
import { symbolInstance } from '../../packages/geometry/src/symbols';
type Mode = 'off' | 'linear' | 'out' | 'custom';
type Style = 'solid' | 'gradient' | 'weighted';
function fixture(symbol: boolean, batch: boolean, style: Style) {
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
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 2,
    points: [],
    opacity: 0,
  };
  const b: Vector = { ...a, x: 90, fill: '#808080', stroke: '#808080', opacity: 1 };
  if (style !== 'solid')
    for (const [art, end] of [
      [a, false],
      [b, true],
    ] as const)
      art.gradient = {
        kind: 'linear',
        from: { x: 0, y: 0 },
        to: { x: 40, y: 0 },
        stops: [0, 1].map((offset) => ({
          offset,
          color: style === 'weighted' ? (end ? '#0000ff' : '#ff0000') : end ? '#808080' : '#000000',
          opacity: style === 'weighted' ? (end ? 1 : 0) : end ? 0.8 : 0.2,
        })),
      };
  const keys = [
      { frame: 0, shapes: [a] },
      { frame: 8, shapes: [b] },
      { frame: 10, shapes: [] },
    ],
    extra = {
      id: 'extra',
      name: 'Extra',
      visible: true,
      locked: false,
      drawingMode: 'object' as const,
      keys: structuredClone(keys).map((k) => ({
        ...k,
        shapes: k.shapes.map((s) => ({ ...s, id: 'extra-art', y: 60 })),
      })),
    };
  if (symbol) {
    const s = {
      id: 'paint',
      name: 'Paint',
      width: 160,
      height: 100,
      multiFramePivot: { x: 5, y: 7 },
      shapes: keys[0].shapes,
      timeline: { duration: 12, keys: keys.slice(1), layers: [extra] },
    };
    p.symbols = [s];
    p.layers[0].keys[0].shapes = [symbolInstance(s, 0, 0)];
  } else {
    p.layers[0].drawingMode = batch && style === 'weighted' ? 'merge' : 'object';
    p.layers[0].keys = keys;
    if (batch) p.layers.push(extra);
  }
  return p;
}
async function setup(
  page: Page,
  symbol: boolean,
  batch: boolean,
  style: Style,
  prepared?: Project,
) {
  const p = prepared ?? fixture(symbol, batch, style),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.addInitScript((p) => {
    if (window.top === window && !sessionStorage.getItem('paint-seeded')) {
      sessionStorage.setItem('paint-seeded', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function mainRange(page: Page, at?: number) {
  const box = (await page.getByLabel('Timeline frames').boundingBox())!;
  await page.mouse.click(box.x + (at ?? 0) * 18 + 9, box.y + 40);
  if (at === undefined) {
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 8 * 18 + 9, box.y + 40);
    await page.keyboard.up('Shift');
  }
}
async function openSymbol(page: Page) {
  await page
    .getByRole('group', { name: 'Symbol Paint', exact: true })
    .getByRole('button', { name: 'Edit symbol timeline', exact: true })
    .click();
  await page.getByLabel('Symbol range start', { exact: true }).fill('1');
  await page.getByLabel('Symbol range end', { exact: true }).fill('9');
}
async function controls(page: Page, symbol: boolean, batch: boolean, style: Style, mode: Mode) {
  if (symbol) {
    if (batch) {
      await page.getByRole('button', { name: 'Select all symbol tracks', exact: true }).click();
      await page.getByLabel('Remembered motion on checked symbol tracks', { exact: true }).check();
    }
  } else {
    await mainRange(page);
    if (batch) {
      await page.getByText('Multi-layer frame edits', { exact: true }).click();
      await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
      await page.getByLabel('Remembered motion on checked layers', { exact: true }).check();
    }
  }
  const name = symbol ? 'symbol ' : '';
  await page.getByLabel(`Remembered ${name}motion easing`, { exact: true }).selectOption('in');
  await page.getByLabel(`Remembered ${name}motion paint colors`, { exact: true }).check();
  await page.getByLabel(`Independent remembered ${name}opacity easing`, { exact: true }).check();
  await page.getByLabel(`Remembered ${name}opacity easing`, { exact: true }).selectOption('out');
  await expect(
    page.getByLabel(`Independent remembered ${name}paint easing`, { exact: true }),
  ).not.toBeChecked();
  if (mode !== 'off') {
    await page.getByLabel(`Independent remembered ${name}paint easing`, { exact: true }).check();
    await page.getByLabel(`Remembered ${name}paint easing`, { exact: true }).selectOption(mode);
    if (mode === 'custom')
      for (const [key, value] of [
        ['X1', 1 / 3],
        ['X2', 2 / 3],
        ['Y1', 0],
        ['Y2', 0],
      ] as const)
        await page
          .getByLabel(`Remembered ${name}paint easing ${key}`, { exact: true })
          .fill(String(value));
  }
  if (style === 'weighted')
    await page
      .getByLabel(`Remembered ${name}motion opacity-weighted gradient colors`, { exact: true })
      .check();
}
const create = (page: Page, symbol: boolean) =>
  page
    .getByRole('button', {
      name: symbol ? 'Create remembered symbol motion' : 'Create remembered motion',
      exact: true,
    })
    .click();
test('remembered stroke color follows geometry independently of eased fill paint', async ({page}) => {
  const p = fixture(false,false,'solid');
  p.layers[0].keys[1].shapes[0].stroke = '#808080';
  const f = await setup(page,false,false,'solid',p);
  await controls(page,false,false,'solid','out');
  await page.getByLabel('Remembered motion stroke color',{exact:true}).check();
  await create(page,false);
  const saved = await f.read();
  expect(saved.layers[0].motionSpans?.[0].options?.strokeColor).toBe(true);
  expect(saved.layers[0].keys.find(key=>key.frame===4)?.shapes[0]).toMatchObject({
    stroke:'#202020', fill:'#606060'
  });
  expect(saved.layers[0].keys.filter(key=>[0,8,10].includes(key.frame))).toEqual(p.layers[0].keys);
});
async function pixel(page: Page) {
  await mainRange(page, 4);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const down = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const data = (await fs.readFile((await (await down).path())!)).toString('base64');
  return page.evaluate(async (data) => {
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
}
function assertTrack(layer: Project['layers'][number], mode: Mode, style: Style) {
  const span = layer.motionSpans![0],
    shape = layer.keys.find((k) => k.frame === 4)!.shapes[0],
    beta = mode === 'off' ? 0.25 : mode === 'linear' ? 0.5 : mode === 'out' ? 0.75 : 0.125,
    gray = Math.round(128 * beta)
      .toString(16)
      .padStart(2, '0');
  expect(Object.hasOwn(span, 'paintEase')).toBe(mode !== 'off');
  expect(span.opacityEase).toBe('out');
  expect(span.ease).toBe('in');
  expect(span.options?.paint).toBe(true);
  expect(shape.x).toBe(30);
  expect(shape.opacity).toBe(0.75);
  expect(shape.fill).toBe('#' + gray.repeat(3));
  if (style !== 'solid') {
    expect(shape.gradient!.from).toEqual({ x: 0, y: 0 });
    expect(shape.gradient!.stops[0].offset).toBe(0);
    expect(shape.gradient!.stops[0].opacity).toBeCloseTo(
      style === 'weighted' ? beta : 0.2 + 0.6 * beta,
      13,
    );
  }
  return beta;
}
const cases: [boolean, boolean, Style, Mode][] = [
  ...(['off', 'linear', 'out', 'custom'] as Mode[]).map(
    (mode) => [false, false, 'solid', mode] as [boolean, boolean, Style, Mode],
  ),
  [false, true, 'gradient', 'custom'],
  [false, true, 'weighted', 'custom'],
  [true, true, 'solid', 'off'],
  [true, false, 'solid', 'linear'],
  [true, true, 'solid', 'out'],
  [true, true, 'solid', 'custom'],
  [true, true, 'gradient', 'custom'],
  [true, true, 'weighted', 'custom'],
];
for (const [symbol, batch, style, mode] of cases)
  test(`paint creation ${symbol ? 'symbol' : 'main'} ${batch ? 'checked' : 'active'} ${style} ${mode}`, async ({
    page,
  }) => {
    const f = await setup(page, symbol, batch, style);
    if (symbol) await openSymbol(page);
    await controls(page, symbol, batch, style, mode);
    await create(page, symbol);
    await expect(page.getByRole('alert')).toHaveCount(0);
    if (symbol) {
      expect(await f.read()).toEqual(f.p);
      await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await f.read()).toEqual(f.p);
      await openSymbol(page);
      await controls(page, true, batch, style, mode);
      await create(page, true);
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    }
    const saved = await f.read(),
      layers = symbol ? symbolLayers(saved.symbols![0]) : saved.layers,
      original = symbol ? symbolLayers(f.p.symbols![0]) : f.p.layers;
    let beta = 0;
    for (const [i, l] of layers.entries()) {
      if (!batch && i > 0) {
        expect(l).toEqual(original[i]);
        continue;
      }
      beta = assertTrack(l, mode, style);
      expect(l.keys[0]).toEqual(original[i].keys[0]);
      expect(l.keys[8]).toEqual(original[i].keys[1]);
      expect(l.keys.at(-1)).toEqual(original[i].keys.at(-1));
    }
    const rgba = await pixel(page),
      alpha = 0.75 * (style === 'solid' ? 1 : style === 'weighted' ? beta : 0.2 + 0.6 * beta),
      color = style === 'weighted' ? [0, 0, 255] : Array(3).fill(Math.round(128 * beta));
    expect(rgba[3]).toBe(255);
    rgba
      .slice(0, 3)
      .forEach((v, i) =>
        expect(Math.abs(v - (color[i] * alpha + 255 * (1 - alpha)))).toBeLessThanOrEqual(1),
      );
    expect(await f.read()).toEqual(saved);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(saved);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    expect(await f.read()).toEqual(saved);
    if (mode === 'custom') {
      expect(await pixel(page)).toEqual(rgba);
      expect(await f.read()).toEqual(saved);
    }
    expect(f.errors).toEqual([]);
  });
for (const symbol of [false, true])
  test(`paint creation requires paint and preserves invalid drafts/corrected retry in ${symbol ? 'symbol' : 'main'}`, async ({
    page,
  }) => {
    const f = await setup(page, symbol, false, 'solid');
    if (symbol) await openSymbol(page);
    else await mainRange(page);
    const name = symbol ? 'symbol ' : '';
    await page.getByLabel(`Independent remembered ${name}paint easing`, { exact: true }).check();
    await create(page, symbol);
    await expect(page.getByRole('alert')).toContainText(/requires paint interpolation/);
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel(`Remembered ${name}motion paint colors`, { exact: true }).check();
    await page.getByLabel(`Remembered ${name}paint easing`, { exact: true }).selectOption('custom');
    await page.getByLabel(`Remembered ${name}paint easing Y1`, { exact: true }).fill('2');
    await create(page, symbol);
    expect(await f.read()).toEqual(f.p);
    await expect(page.getByLabel(`Remembered ${name}paint easing Y1`, { exact: true })).toHaveValue(
      '2',
    );
    await page.getByLabel(`Independent remembered ${name}paint easing`, { exact: true }).uncheck();
    await create(page, symbol);
    if (symbol) {
      await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
      ).toHaveCount(0);
    } else {
      expect(Object.hasOwn((await f.read()).layers[0].motionSpans![0], 'paintEase')).toBe(false);
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
      expect(await f.read()).toEqual(f.p);
    }
    await page.getByLabel(`Independent remembered ${name}paint easing`, { exact: true }).check();
    await expect(page.getByLabel(`Remembered ${name}paint easing Y1`, { exact: true })).toHaveValue(
      '2',
    );
    await page.getByLabel(`Remembered ${name}paint easing Y1`, { exact: true }).fill('0');
    await create(page, symbol);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

for (const symbol of [false, true])
  for (const change of ['target', 'source'] as const)
    test(`paint creation rejects late ${change} after complete candidate in ${symbol ? 'symbol' : 'main'} and retries freshly`, async ({
      page,
    }) => {
      const f = await setup(page, symbol, false, 'solid');
      if (symbol) await openSymbol(page);
      await controls(page, symbol, false, 'solid', 'out');
      const label = `Remembered ${symbol ? 'symbol ' : ''}paint easing`;
      await page.evaluate(
        ({ symbol, change, label }) => {
          const stringify = JSON.stringify;
          let hit = false;
          Object.assign(window, { paintCreationHook: false });
          JSON.stringify = ((value: unknown, ...args: unknown[]) => {
            const p = value as {
              id?: string;
              schemaVersion?: number;
              layers?: { motionSpans?: { paintEase?: unknown }[] }[];
              timeline?: { motionSpans?: { paintEase?: unknown }[] };
            } | null;
            if (
              !hit &&
              p &&
              typeof p === 'object' &&
              (symbol
                ? p.id === 'paint' && p.timeline?.motionSpans?.[0].paintEase === 'out'
                : p.schemaVersion === 53 && p.layers?.[0].motionSpans?.[0].paintEase === 'out')
            ) {
              hit = true;
              Object.assign(window, { paintCreationHook: true });
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
                if (!input) throw Error('Missing actual source control');
                input.value = symbol ? '13' : '#00ff00';
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return stringify(value, ...(args as []));
          }) as typeof JSON.stringify;
        },
        { symbol, change, label },
      );
      await create(page, symbol);
      expect(
        await page.evaluate(
          () => (window as unknown as { paintCreationHook: boolean }).paintCreationHook,
        ),
      ).toBe(true);
      await expect(page.getByRole('alert')).toContainText(/changed/);
      if (symbol) {
        await expect(
          page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
        ).toHaveCount(0);
        if (change === 'source') {
          await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('13');
          await page
            .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
            .click();
          await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('12');
        } else
          await expect(
            page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
          ).toBeDisabled();
      } else {
        const result = await f.read();
        expect(result.layers[0].motionSpans).toBeUndefined();
        if (change === 'source') {
          expect(result.background).toBe('#00ff00');
          await page.getByLabel('Drawing stage').focus();
          await page.keyboard.press('Control+z');
        }
        expect(await f.read()).toEqual(f.p);
      }
      await create(page, symbol);
      await expect(page.getByRole('alert')).toHaveCount(0);
      if (symbol) {
        await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
        expect((await f.read()).symbols![0].timeline!.motionSpans![0].paintEase).toBe('out');
      } else expect((await f.read()).layers[0].motionSpans![0].paintEase).toBe('out');
      expect(f.errors).toEqual([]);
    });

test('paint creation rejects late isolated close and retains a clean remounted history', async ({
  page,
}) => {
  const f = await setup(page, true, true, 'gradient');
  await openSymbol(page);
  await controls(page, true, true, 'gradient', 'custom');
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let hit = false;
    Object.assign(window, { paintCloseHook: false });
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const s = value as {
        id?: string;
        timeline?: { motionSpans?: { paintEase?: unknown }[] };
      } | null;
      if (!hit && s?.id === 'paint' && s.timeline?.motionSpans?.[0].paintEase) {
        hit = true;
        Object.assign(window, { paintCloseHook: true });
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Cancel symbol timeline',
        );
        if (!button) throw Error('Missing actual close');
        button.click();
      }
      return stringify(value, ...(args as []));
    }) as typeof JSON.stringify;
  });
  await create(page, true);
  expect(
    await page.evaluate(() => (window as unknown as { paintCloseHook: boolean }).paintCloseHook),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await openSymbol(page);
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
  ).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('paint creation rejects source edits during history before-image preparation without stale history', async ({
  page,
}) => {
  const f = await setup(page, false, false, 'solid');
  await controls(page, false, false, 'solid', 'out');
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let prepared = false,
      reads = 0,
      hit = false;
    Object.assign(window, { paintHistoryHook: false });
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const p = value as {
        schemaVersion?: number;
        layers?: { motionSpans?: { paintEase?: unknown }[] }[];
      } | null;
      if (p?.schemaVersion === 53) {
        if (p.layers?.[0].motionSpans?.[0].paintEase === 'out') prepared = true;
        else if (prepared && !hit && ++reads === 1) {
          hit = true;
          Object.assign(window, { paintHistoryHook: true });
          const input = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
          if (!input) throw Error('Missing actual source control');
          input.value = '#00ff00';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return stringify(value, ...(args as []));
    }) as typeof JSON.stringify;
  });
  await create(page, false);
  expect(
    await page.evaluate(
      () => (window as unknown as { paintHistoryHook: boolean }).paintHistoryHook,
    ),
  ).toBe(true);
  const result = await f.read();
  expect(result.background).toBe('#00ff00');
  expect(result.layers[0].motionSpans).toBeUndefined();
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await create(page, false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await f.read()).layers[0].motionSpans![0].paintEase).toBe('out');
  expect(f.errors).toEqual([]);
});

for (const symbol of [false, true])
  test(`paint creation preferences do not edit saved channels during global refresh in ${symbol ? 'symbol' : 'main'}`, async ({
    page,
  }) => {
    const f = await setup(page, symbol, false, 'solid');
    if (symbol) await openSymbol(page);
    await controls(page, symbol, false, 'solid', 'custom');
    await create(page, symbol);
    if (symbol)
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const saved = await f.read(),
      old = symbol ? saved.symbols![0].timeline!.motionSpans![0] : saved.layers[0].motionSpans![0];
    if (symbol) {
      await openSymbol(page);
      await page.getByLabel('Independent remembered symbol paint easing', { exact: true }).check();
    }
    await page
      .getByLabel(`Remembered ${symbol ? 'symbol ' : ''}paint easing`, { exact: true })
      .selectOption('linear');
    expect(await f.read()).toEqual(saved);
    await page
      .getByLabel(`Remembered ${symbol ? 'symbol ' : ''}motion easing`, { exact: true })
      .selectOption('linear');
    await page
      .getByRole('button', {
        name: symbol
          ? 'Apply easing to remembered symbol motion'
          : 'Apply easing to remembered motion',
        exact: true,
      })
      .click();
    if (symbol)
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const after = await f.read(),
      layer = symbol ? symbolLayers(after.symbols![0])[0] : after.layers[0];
    expect(layer.motionSpans![0]).toMatchObject({
      id: old.id,
      ease: 'linear',
      paintEase: old.paintEase,
      opacityEase: 'out',
    });
    expect(layer.keys.find((k) => k.frame === 4)!.shapes[0]).toMatchObject({
      x: 50,
      fill: '#101010',
      opacity: 0.75,
    });
    expect(f.errors).toEqual([]);
  });

function existingFixture(symbol: boolean, batch: boolean, style: Style) {
  const p = fixture(symbol, batch, style),
    options = { paint: true, gradientPremultiplied: style === 'weighted' };
  if (symbol) {
    const original = p.symbols![0];
    p.symbols![0] = editSymbolBasicMotionSpan(
      original,
      ['@base', 'extra'],
      0,
      8,
      'create',
      'in',
      [original],
      undefined,
      false,
      options,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      'out',
    );
  } else
    createBasicMotionSpan(
      p,
      p.layers.map((l) => l.id),
      0,
      8,
      'in',
      options,
      undefined,
      undefined,
      undefined,
      'out',
    );
  return p;
}
async function existingRange(page: Page, symbol: boolean, batch: boolean) {
  if (symbol) {
    await openSymbol(page);
    if (batch) {
      await page.getByRole('button', { name: 'Select all symbol tracks', exact: true }).click();
      await page.getByLabel('Remembered motion on checked symbol tracks', { exact: true }).check();
    }
  } else {
    await mainRange(page);
    if (batch) {
      await page.getByText('Multi-layer frame edits', { exact: true }).click();
      await page.getByRole('button', { name: 'Select all timeline layers', exact: true }).click();
      await page.getByLabel('Remembered motion on checked layers', { exact: true }).check();
    }
  }
}
async function existingCurve(page: Page, symbol: boolean, mode: Mode) {
  const name = `Existing ${symbol ? 'symbol ' : ''}paint easing`;
  await page.getByLabel(name, { exact: true }).selectOption(mode);
  if (mode === 'custom')
    for (const [key, value] of [
      ['X1', 1 / 3],
      ['X2', 2 / 3],
      ['Y1', 0],
      ['Y2', 0],
    ] as const)
      await page.getByLabel(name + ' ' + key, { exact: true }).fill(String(value));
}
const existingApply = (page: Page, symbol: boolean, remove = false) =>
  page
    .getByRole('button', {
      name: remove
        ? `Remove remembered ${symbol ? 'symbol ' : ''}paint override`
        : `Apply paint easing to remembered ${symbol ? 'symbol ' : ''}motion`,
      exact: true,
    })
    .click();
const withoutPaint = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, function (this: Record<string, unknown>, key, value) {
      return ['fill', 'stroke', 'color', 'paintEase', 'baseline'].includes(key) ||
        (key === 'opacity' && typeof this.offset === 'number')
        ? undefined
        : value;
    }),
  );
for (const [symbol, batch, style, mode] of [
  [false, false, 'solid', 'linear'],
  [false, false, 'solid', 'out'],
  [false, false, 'solid', 'custom'],
  [false, true, 'gradient', 'out'],
  [false, true, 'weighted', 'custom'],
  [true, false, 'solid', 'linear'],
  [true, true, 'solid', 'out'],
  [true, true, 'solid', 'custom'],
  [true, true, 'gradient', 'out'],
  [true, true, 'weighted', 'custom'],
] as [boolean, boolean, Style, Mode][])
  test(`existing paint edit ${symbol ? 'symbol' : 'main'} ${batch ? 'checked' : 'active'} ${style} ${mode}`, async ({
    page,
  }) => {
    const f = await setup(page, symbol, batch, style, existingFixture(symbol, batch, style));
    const beforePixel = await pixel(page);
    await existingRange(page, symbol, batch);
    await existingCurve(page, symbol, mode);
    // Preferences for the next recipe must not become the saved editing target.
    await page
      .getByLabel(`Independent remembered ${symbol ? 'symbol ' : ''}paint easing`, { exact: true })
      .check();
    await page
      .getByLabel(`Remembered ${symbol ? 'symbol ' : ''}paint easing`, { exact: true })
      .selectOption('in-out');
    await existingApply(page, symbol);
    const summary = page.getByLabel(`Saved remembered ${symbol ? 'symbol ' : ''}paint easing`, {
      exact: true,
    });
    await expect(summary).toContainText('Independent paint');
    if (symbol) {
      expect(await f.read()).toEqual(f.p);
      await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
      await expect(summary).toHaveText('Paint inherits global easing');
      await page.getByRole('button', { name: 'Redo symbol timeline change', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      expect(await f.read()).toEqual(f.p);
      await existingRange(page, symbol, batch);
      await existingCurve(page, symbol, mode);
      await existingApply(page, symbol);
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    }
    const saved = await f.read(),
      tracks = symbol ? symbolLayers(saved.symbols![0]) : saved.layers;
    for (const l of batch ? tracks : tracks.slice(0, 1)) assertTrack(l, mode, style);
    if (!batch && symbol) expect(tracks[1]).toEqual(symbolLayers(f.p.symbols![0])[1]);
    expect(withoutPaint(saved)).toEqual(withoutPaint(f.p));
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    await page.keyboard.press('Control+Shift+z');
    expect(await f.read()).toEqual(saved);
    const afterPixel = await pixel(page);
    expect(afterPixel).not.toEqual(beforePixel);
    const beta = mode === 'linear' ? 0.5 : mode === 'out' ? 0.75 : 0.125;
    const alpha =
      0.75 * (style === 'weighted' ? beta : style === 'gradient' ? 0.2 + 0.6 * beta : 1);
    const color = style === 'weighted' ? [0, 0, 255] : Array(3).fill(Math.round(128 * beta));
    color.forEach((c, i) =>
      expect(
        Math.abs(afterPixel[i] - Math.round(c * alpha + 255 * (1 - alpha))),
      ).toBeLessThanOrEqual(1),
    );
    expect(afterPixel[3]).toBe(255);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    expect(await f.read()).toEqual(saved);
    await existingRange(page, symbol, batch);
    await existingApply(page, symbol, true);
    if (symbol)
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    expect(await f.read()).toEqual(f.p);
    expect(await pixel(page)).toEqual(beforePixel);
    expect(f.errors).toEqual([]);
  });

for (const symbol of [false, true])
  for (const change of ['target', 'source'] as const)
    test(`existing paint rejects late ${change} after complete candidate in ${symbol ? 'symbol' : 'main'} and retries freshly`, async ({
      page,
    }) => {
      const f = await setup(page, symbol, false, 'solid', existingFixture(symbol, false, 'solid'));
      await existingRange(page, symbol, false);
      await existingCurve(page, symbol, 'out');
      const label = `Existing ${symbol ? 'symbol ' : ''}paint easing`;
      await page.evaluate(
        ({ symbol, change, label }) => {
          const stringify = JSON.stringify;
          let hit = false;
          Object.assign(window, { paintCreationHook: false });
          JSON.stringify = ((value: unknown, ...args: unknown[]) => {
            const p = value as {
              id?: string;
              schemaVersion?: number;
              layers?: { motionSpans?: { paintEase?: unknown }[] }[];
              timeline?: { motionSpans?: { paintEase?: unknown }[] };
            } | null;
            if (
              !hit &&
              p &&
              typeof p === 'object' &&
              (symbol
                ? p.id === 'paint' && p.timeline?.motionSpans?.[0].paintEase === 'out'
                : p.schemaVersion === 53 && p.layers?.[0].motionSpans?.[0].paintEase === 'out')
            ) {
              hit = true;
              Object.assign(window, { paintCreationHook: true });
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
                if (!input) throw Error('Missing actual source control');
                input.value = symbol ? '13' : '#00ff00';
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return stringify(value, ...(args as []));
          }) as typeof JSON.stringify;
        },
        { symbol, change, label },
      );
      await existingApply(page, symbol);
      expect(
        await page.evaluate(
          () => (window as unknown as { paintCreationHook: boolean }).paintCreationHook,
        ),
      ).toBe(true);
      await expect(page.getByRole('alert')).toContainText(/changed/);
      if (symbol) {
        await expect(
          page.getByLabel('Saved remembered symbol paint easing', { exact: true }),
        ).toHaveText('Paint inherits global easing');
        if (change === 'source') {
          await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('13');
          await page
            .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
            .click();
          await expect(page.getByLabel('Symbol duration', { exact: true })).toHaveValue('12');
        } else
          await expect(
            page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
          ).toBeDisabled();
      } else {
        const result = await f.read();
        expect(Object.hasOwn(result.layers[0].motionSpans![0], 'paintEase')).toBe(false);
        if (change === 'source') {
          expect(result.background).toBe('#00ff00');
          await page.getByLabel('Drawing stage').focus();
          await page.keyboard.press('Control+z');
        }
        expect(await f.read()).toEqual(f.p);
      }
      await existingApply(page, symbol);
      await expect(page.getByRole('alert')).toHaveCount(0);
      if (symbol) {
        await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
        expect((await f.read()).symbols![0].timeline!.motionSpans![0].paintEase).toBe('out');
      } else expect((await f.read()).layers[0].motionSpans![0].paintEase).toBe('out');
      expect(f.errors).toEqual([]);
    });

test('existing paint rejects late isolated close and retains a clean remounted history', async ({
  page,
}) => {
  const f = await setup(page, true, true, 'gradient', existingFixture(true, true, 'gradient'));
  await existingRange(page, true, true);
  await existingCurve(page, true, 'custom');
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let hit = false;
    Object.assign(window, { paintCloseHook: false });
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const s = value as {
        id?: string;
        timeline?: { motionSpans?: { paintEase?: unknown }[] };
      } | null;
      if (!hit && s?.id === 'paint' && s.timeline?.motionSpans?.[0].paintEase) {
        hit = true;
        Object.assign(window, { paintCloseHook: true });
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Cancel symbol timeline',
        );
        if (!button) throw Error('Missing actual close');
        button.click();
      }
      return stringify(value, ...(args as []));
    }) as typeof JSON.stringify;
  });
  await existingApply(page, true);
  expect(
    await page.evaluate(() => (window as unknown as { paintCloseHook: boolean }).paintCloseHook),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  await openSymbol(page);
  await expect(
    page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Select remembered symbol frames 1–9', exact: true }),
  ).toHaveCount(1);
  expect(f.errors).toEqual([]);
});

test('existing paint rejects source edits during history before-image preparation without stale history', async ({
  page,
}) => {
  const f = await setup(page, false, false, 'solid', existingFixture(false, false, 'solid'));
  await existingRange(page, false, false);
  await existingCurve(page, false, 'out');
  await page.evaluate(() => {
    const stringify = JSON.stringify;
    let prepared = false,
      reads = 0,
      hit = false;
    Object.assign(window, { paintHistoryHook: false });
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const p = value as {
        schemaVersion?: number;
        layers?: { motionSpans?: { paintEase?: unknown }[] }[];
      } | null;
      if (p?.schemaVersion === 53) {
        if (p.layers?.[0].motionSpans?.[0].paintEase === 'out') prepared = true;
        else if (prepared && !hit && ++reads === 2) {
          hit = true;
          Object.assign(window, { paintHistoryHook: true });
          const input = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
          if (!input) throw Error('Missing actual source control');
          input.value = '#00ff00';
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return stringify(value, ...(args as []));
    }) as typeof JSON.stringify;
  });
  await existingApply(page, false);
  expect(
    await page.evaluate(
      () => (window as unknown as { paintHistoryHook: boolean }).paintHistoryHook,
    ),
  ).toBe(true);
  const result = await f.read();
  expect(result.background).toBe('#00ff00');
  expect(Object.hasOwn(result.layers[0].motionSpans![0], 'paintEase')).toBe(false);
  await page.getByLabel('Drawing stage').focus();
  await page.keyboard.press('Control+z');
  expect(await f.read()).toEqual(f.p);
  await existingApply(page, false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await f.read()).layers[0].motionSpans![0].paintEase).toBe('out');
  expect(f.errors).toEqual([]);
});

for (const symbol of [false, true])
  test(`existing paint raw invalid/no-op retry in ${symbol ? 'symbol' : 'main'}`, async ({
    page,
  }) => {
    const f = await setup(page, symbol, false, 'solid', existingFixture(symbol, false, 'solid'));
    await existingRange(page, symbol, false);
    await existingApply(page, symbol, true);
    const label = `Existing ${symbol ? 'symbol ' : ''}paint easing`;
    await page.getByLabel(label, { exact: true }).selectOption('custom');
    await page.getByLabel(label + ' Y1', { exact: true }).fill('2');
    await existingApply(page, symbol);
    expect(await f.read()).toEqual(f.p);
    await expect(page.getByLabel(label + ' Y1', { exact: true })).toHaveValue('2');
    if (symbol)
      await expect(
        page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
      ).toBeDisabled();
    await page.getByLabel(label + ' Y1', { exact: true }).fill('0');
    await existingApply(page, symbol);
    if (symbol) {
      await page.getByRole('button', { name: 'Undo symbol timeline change', exact: true }).click();
      await expect(
        page.getByLabel('Saved remembered symbol paint easing', { exact: true }),
      ).toHaveText('Paint inherits global easing');
    } else {
      await page.getByLabel('Drawing stage').focus();
      await page.keyboard.press('Control+z');
    }
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
for (const symbol of [false, true])
  test(`existing paint disabled recipe cannot be enabled by editing in ${symbol ? 'symbol' : 'main'}`, async ({
    page,
  }) => {
    const p = existingFixture(symbol, false, 'solid');
    const tracks = symbol ? symbolLayers(p.symbols![0]) : p.layers;
    for (const l of tracks) {
      delete l.motionSpans![0].options!.paint;
      const end = l.keys.find((k) => k.frame === 8)!.shapes[0];
      end.fill = '#000000';
      end.stroke = '#000000';
    }
    // Make endpoints compatible with disabled paint, then reconstruct its saved baseline.
    if (symbol)
      p.symbols![0] = editSymbolBasicMotionSpan(
        p.symbols![0],
        ['@base', 'extra'],
        0,
        8,
        'refresh',
        'linear',
        p.symbols,
      );
    else {
      const { refreshBasicMotionSpan } = await import('../../packages/animation/src/motion-spans');
      refreshBasicMotionSpan(p, [p.layers[0].id], 0, 8);
    }
    const f = await setup(page, symbol, false, 'solid', p);
    await existingRange(page, symbol, false);
    await expect(
      page.getByLabel(`Saved remembered ${symbol ? 'symbol ' : ''}paint easing`, { exact: true }),
    ).toHaveText('Paint interpolation disabled');
    await existingCurve(page, symbol, 'out');
    for (const remove of [false, true]) {
      await existingApply(page, symbol, remove);
      await expect(page.getByRole('alert')).toContainText(/paint/i);
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

for (const symbol of [false, true])
  test(`existing paint checked mixed overrides admit unchanged members in ${symbol ? 'symbol' : 'main'}`, async ({
    page,
  }) => {
    const p = existingFixture(symbol, true, 'gradient');
    if (symbol)
      p.symbols![0] = editSymbolBasicMotionSpan(
        p.symbols![0],
        ['@base'],
        0,
        8,
        'paint',
        'linear',
        p.symbols,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        'linear',
      );
    else {
      const { setRememberedMotionPaintEase } =
        await import('../../packages/animation/src/motion-spans');
      setRememberedMotionPaintEase(p, [p.layers[0].id], 0, 8, 'linear');
    }
    const f = await setup(page, symbol, true, 'gradient', p);
    await existingRange(page, symbol, true);
    const summary = page.getByLabel(`Saved remembered ${symbol ? 'symbol ' : ''}paint easing`, {
      exact: true,
    });
    await expect(summary).toHaveText('Mixed paint easing');
    await existingCurve(page, symbol, 'linear');
    await existingApply(page, symbol);
    await expect(summary).toHaveText('Independent paint: linear');
    if (symbol)
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    const result = await f.read(),
      tracks = symbol ? symbolLayers(result.symbols![0]) : result.layers;
    expect(tracks[0]).toEqual((symbol ? symbolLayers(f.p.symbols![0]) : f.p.layers)[0]);
    for (const l of tracks) assertTrack(l, 'linear', 'gradient');
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+z');
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
