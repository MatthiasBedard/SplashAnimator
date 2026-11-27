import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { newProject, type Vector } from '../../packages/document/src';
let bundle = '';
test('private activation delivery qualifies readonly input before the local body chooses a new frame and retries failed execution', async ({
  page,
}) => {
  const data = fixture(),
    body =
      'if(input.fail===true)throw new Error("delivery body failed");state.count=(typeof state.count==="number"?state.count:0)+1;state.activation=JSON.parse(JSON.stringify(input.buttonActivation));if(input.type==="pointerdown")timeline.gotoAndStop(2);else timeline.gotoAndStop(1);';
  data.definition.timeline!.frameScripts = [
    { frame: 0, source: body },
    { frame: 2, source: body },
  ];
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      before = JSON.stringify(data.project),
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      prepared = await owner.prepare({}),
      runtime = prepared.preview!;
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const query = () => api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
    const down = api.prepareSymbolScriptArtworkDelivery(provider, image, await query(), 0, {
      type: 'pointerdown',
      pointerId: 1,
      button: 0,
    });
    const initial = runtime.checkpoint(),
      downInput = down.input();
    const first = await runtime.runWithPresentation(1, { events: [{ tick: 0, data: downInput }] });
    image = await api.renderSymbolScriptArtworkDelivery(provider, down, {
      frame: first.checkpoint.session.timeline.frame,
      tick: first.checkpoint.session.timeline.tick,
    });
    const checkpoint = runtime.checkpoint(),
      history = api.captureSymbolScriptArtworkHistory(provider, image),
      release = api.prepareSymbolScriptArtworkDelivery(provider, image, await query(), 0, {
        type: 'pointerup',
        pointerId: 1,
        button: 0,
      }),
      input = release.input();
    const beforeExecution = runtime.checkpoint();
    let failed = '';
    try {
      await runtime.runWithPresentation(1, {
        events: [{ tick: 1, data: { ...input, fail: true } }],
      });
    } catch (error) {
      failed = String(error);
    }
    const retained = JSON.stringify(runtime.checkpoint()) === JSON.stringify(beforeExecution);
    const next = await runtime.runWithPresentation(1, {
      events: [{ tick: 1, data: release.input() }],
    });
    image = await api.renderSymbolScriptArtworkDelivery(provider, release, {
      frame: next.checkpoint.session.timeline.frame,
      tick: next.checkpoint.session.timeline.tick,
    });
    const bitmap = await createImageBitmap(image),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = Array.from(ctx.getImageData(85, 5, 1, 1).data);
    runtime.restore(checkpoint);
    image = await api.restoreSymbolScriptArtworkHistory(provider, history);
    const again = api.prepareSymbolScriptArtworkDelivery(provider, image, await query(), 0, {
      type: 'pointerup',
      pointerId: 1,
      button: 0,
    });
    const rebound = again.input();
    const output = {
      initialTick: initial.session.timeline.tick,
      downInput,
      input,
      firstFrame: first.checkpoint.session.timeline.frame,
      nextFrame: next.checkpoint.session.timeline.frame,
      state: next.checkpoint.session.state,
      retained,
      failed,
      pixel,
      rebound,
      unchanged: JSON.stringify(data.project) === before,
    };
    runtime.dispose();
    provider.dispose();
    owner.dispose();
    return output;
  }, data);
  expect(result.initialTick).toBe(0);
  expect(result.downInput.buttonActivation).toBeNull();
  expect(result.input.buttonActivation).toMatchObject({ symbolId: 'button' });
  expect(result.input.targetScope).toBe('symbol-local');
  expect(result.firstFrame).toBe(2);
  expect(result.nextFrame).toBe(1);
  expect(result.state).toMatchObject({ count: 2, activation: result.input.buttonActivation });
  expect(result.retained).toBe(true);
  expect(result.failed).toContain('delivery body failed');
  expect(result.pixel).toEqual([0, 255, 0, 255]);
  expect(result.rebound.buttonActivation).toEqual(result.input.buttonActivation);
  expect(result.rebound.targetImageId).not.toBe(result.input.targetImageId);
  expect(result.unchanged).toBe(true);
});

for (const fault of ['cancel', 'source'] as const)
  test(`private qualified delivery ${fault} retains current image input and source-valid retry`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(
      async ({ data, fault }) => {
        const api = (
            window as unknown as {
              SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
                typeof import('../../apps/editor/src/symbol-script-artwork');
            }
          ).SymbolImageHarness,
          source = { ...data, validateEnclosing: () => {} },
          before = JSON.stringify(data.project),
          owner = api.captureSymbolLocalProgram(() => source),
          provider = api.createSymbolScriptArtworkProvider(owner);
        let image = await provider.render([{ frame: 0, tick: 0 }]);
        let proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
        image = await api.renderSymbolScriptArtworkVisual(
          provider,
          api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'over', {
            frame: 0,
            tick: 1,
          }),
        );
        api.captureSymbolScriptArtworkHistory(provider, image);
        proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
        image = await api.renderSymbolScriptArtworkPress(
          provider,
          api.prepareSymbolScriptArtworkPress(
            provider,
            image,
            proof,
            0,
            { type: 'pointerdown', pointerId: 1, button: 0 },
            { frame: 0, tick: 2 },
          ),
        );
        const current = await api.querySymbolScriptArtworkTargets(provider, image, [
            { x: 85, y: 5 },
          ]),
          controller = new AbortController(),
          plan = api.prepareSymbolScriptArtworkDelivery(provider, image, current, 0, {
            type: 'pointerup',
            pointerId: 1,
            button: 0,
          }),
          pending = api.renderSymbolScriptArtworkDelivery(
            provider,
            plan,
            { frame: 0, tick: 3 },
            {
              signal: controller.signal,
            },
          );
        if (fault === 'cancel') controller.abort();
        else source.revision++;
        let message = '';
        try {
          await pending;
        } catch (error) {
          message = String(error);
        }
        let retained = false;
        if (fault === 'cancel') {
          retained =
            (await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]))
              .imageId === current.imageId;
          await api.renderSymbolScriptArtworkDelivery(provider, plan, { frame: 0, tick: 3 });
        }
        provider.dispose();
        owner.dispose();
        return {
          message,
          retained,
          unchanged: JSON.stringify(data.project) === before,
          leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
        };
      },
      { data: fixture(), fault },
    );
    expect(result.message).toMatch(fault === 'cancel' ? /abort/i : /changed/);
    if (fault === 'cancel') expect(result.retained).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.leaks).toBe(0);
  });
test('private press histories restore owned Down state movie phases and matching release restarts Over', async ({
  page,
}) => {
  const data = fixture(),
    button = data.project.symbols![2],
    art = button.shapes[0],
    movie = {
      ...structuredClone(art),
      id: 'state-movie',
      kind: 'symbol' as const,
      symbolId: 'clock',
      symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    };
  button.shapes = [movie];
  button.timeline!.keys = [
    { frame: 1, shapes: [structuredClone(movie)] },
    { frame: 2, shapes: [structuredClone(movie)] },
  ];
  data.project.symbols!.push({
    id: 'clock',
    name: 'Clock',
    width: 20,
    height: 20,
    shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#ff0000' }],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#0000ff' }] },
        { frame: 2, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#00ff00' }] },
      ],
    },
  });
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const colors = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const initial = api.captureSymbolScriptArtworkHistory(provider, image),
      colors = [];
    const pixel = async () => {
      const bitmap = await createImageBitmap(image),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(85, 5, 1, 1).data);
    };
    const pressedQuery = await api.querySymbolScriptArtworkTargets(provider, image, [
      { x: 85, y: 5 },
    ]);
    image = await api.renderSymbolScriptArtworkPress(
      provider,
      api.prepareSymbolScriptArtworkPress(
        provider,
        image,
        pressedQuery,
        0,
        { type: 'pointerdown', pointerId: 1, button: 0 },
        { frame: 0, tick: 1 },
      ),
    );
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 0, tick: 2 }]),
    );
    colors.push(await pixel());
    const history = api.captureSymbolScriptArtworkHistory(provider, image);
    const releasedQuery = await api.querySymbolScriptArtworkTargets(provider, image, [
      { x: 85, y: 5 },
    ]);
    image = await api.renderSymbolScriptArtworkPress(
      provider,
      api.prepareSymbolScriptArtworkPress(
        provider,
        image,
        releasedQuery,
        0,
        { type: 'pointerup', pointerId: 1, button: 0 },
        { frame: 0, tick: 3 },
      ),
    );
    colors.push(await pixel());
    image = await api.restoreSymbolScriptArtworkHistory(provider, history);
    colors.push(await pixel());
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 0, tick: 3 }]),
    );
    colors.push(await pixel());
    image = await api.restoreSymbolScriptArtworkHistory(provider, initial);
    colors.push(await pixel());
    provider.dispose();
    owner.dispose();
    return colors;
  }, data);
  expect(colors).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
  ]);
});

test('private primary press paints Down with original pointer ownership through continuation and restored history', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      before = JSON.stringify(data.project),
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]),
      tick = 0;
    const colors = [],
      states: ReturnType<
        import('../../apps/editor/src/symbol-script-artwork').SymbolArtworkPressPreparation['snapshot']
      >[] = [];
    const pixel = async () => {
      const bitmap = await createImageBitmap(image),
        c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(85, 5, 1, 1).data);
    };
    const event = async (
      type: 'pointerdown' | 'pointerup' | 'pointercancel' | 'pointermove' | 'pointerleave',
      pointerId = 1,
      button = 0,
      x = 85,
    ) => {
      const query = await api.querySymbolScriptArtworkTargets(provider, image, [{ x, y: 5 }]),
        plan = api.prepareSymbolScriptArtworkPress(
          provider,
          image,
          query,
          0,
          { type, pointerId, button },
          { frame: 0, tick: ++tick },
        );
      states.push(plan.snapshot());
      image = await api.renderSymbolScriptArtworkPress(provider, plan);
      colors.push(await pixel());
    };
    await event('pointerdown');
    const saved = api.captureSymbolScriptArtworkHistory(provider, image);
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 2, tick: ++tick }]),
    );
    colors.push(await pixel());
    await event('pointerup', 2);
    await event('pointerup', 1, 0, -1);
    image = await api.restoreSymbolScriptArtworkHistory(provider, saved);
    tick = 1;
    await event('pointerup', 2);
    await event('pointerup', 1);
    await event('pointerdown', 1, 2);
    await event('pointerdown');
    await event('pointercancel', 1, -1);
    provider.dispose();
    owner.dispose();
    return {
      colors,
      states,
      unchanged: JSON.stringify(data.project) === before,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.colors).toEqual([
    [0, 0, 255, 255],
    [0, 0, 255, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
  ]);
  expect(result.states.map((s) => s.pressed)).toEqual([
    true,
    true,
    false,
    true,
    false,
    false,
    true,
    false,
  ]);
  expect(result.states.every((s) => !('activation' in s))).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.leaks).toBe(0);
});

test('private owned press cannot revive expired reflected nested targets and matching release clears the old lifetime', async ({
  page,
}) => {
  const data = fixture(),
    local = data.definition,
    button = data.project.symbols![2],
    art = button.shapes[0],
    inner = { ...structuredClone(button), id: 'inner', name: 'Inner' };
  button.shapes = [
    { ...structuredClone(art), id: 'inner-instance', kind: 'symbol', symbolId: 'inner' },
  ];
  button.timeline!.keys = [];
  local.shapes = [
    {
      ...structuredClone(art),
      id: 'outer',
      kind: 'symbol',
      symbolId: 'button',
      x: 80,
      y: 10,
      transform: [-1, 0, 0, 1],
    },
  ];
  local.timeline!.layers = [];
  local.timeline!.keys = [
    { frame: 1, shapes: [] },
    { frame: 2, shapes: structuredClone(local.shapes) },
  ];
  data.project.symbols!.push(inner);
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const first = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkPress(
      provider,
      api.prepareSymbolScriptArtworkPress(
        provider,
        image,
        first,
        0,
        { type: 'pointerdown', pointerId: 1, button: 0 },
        { frame: 0, tick: 1 },
      ),
    );
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 1, tick: 2 }]),
    );
    const absent = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 2, tick: 3 }]),
    );
    const resetBitmap = await createImageBitmap(image),
      resetCanvas = document.createElement('canvas');
    resetCanvas.width = resetBitmap.width;
    resetCanvas.height = resetBitmap.height;
    const resetContext = resetCanvas.getContext('2d')!;
    resetContext.drawImage(resetBitmap, 0, 0);
    resetBitmap.close();
    const resetPixel = Array.from(resetContext.getImageData(75, 15, 1, 1).data);
    const fresh = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkPress(
      provider,
      api.prepareSymbolScriptArtworkPress(
        provider,
        image,
        fresh,
        0,
        { type: 'pointerup', pointerId: 1, button: 0 },
        { frame: 2, tick: 4 },
      ),
    );
    const bitmap = await createImageBitmap(image),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = Array.from(ctx.getImageData(75, 15, 1, 1).data);
    provider.dispose();
    owner.dispose();
    return {
      first: first.targets[0],
      absent: absent.targets[0],
      fresh: fresh.targets[0],
      pixel,
      resetPixel,
    };
  }, data);
  expect(result.first?.symbolId).toBe('inner');
  expect(result.absent).toBeNull();
  expect(result.fresh!.lifetime).toBeGreaterThan(result.first!.lifetime);
  expect(result.resetPixel).toEqual([255, 0, 0, 255]);
  expect(result.pixel).toEqual([0, 255, 0, 255]);
});
test('private multi-pose continuation preserves qualified Over Down and Up while plain rendering stays exact', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const colors = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      owner = api.captureSymbolLocalProgram(() => ({ ...data, validateEnclosing: () => {} })),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const colors = [];
    const pixel = async () => {
      const bitmap = await createImageBitmap(image),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const c = canvas.getContext('2d')!;
      c.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(c.getImageData(85, 5, 1, 1).data);
    };
    let tick = 0;
    for (const state of ['over', 'down', 'up'] as const) {
      const proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
      image = await api.renderSymbolScriptArtworkVisual(
        provider,
        api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, state, {
          frame: 2,
          tick: ++tick,
        }),
      );
      const poses = [
        { frame: 0, tick: ++tick },
        { frame: 2, tick: ++tick },
      ];
      image = await api.renderSymbolScriptArtworkContinuation(
        provider,
        api.prepareSymbolScriptArtworkContinuation(provider, image, poses),
      );
      colors.push(await pixel());
    }
    image = await provider.render([
      { frame: 0, tick: 0 },
      { frame: 2, tick: 1 },
    ]);
    colors.push(await pixel());
    provider.dispose();
    owner.dispose();
    return colors;
  }, fixture());
  expect(colors).toEqual([
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
});

test('private visual continuation preserves descendant phases across stopped ticks and restored history', async ({
  page,
}) => {
  const data = fixture(),
    button = data.project.symbols![2],
    art = button.shapes[0],
    movie = {
      ...structuredClone(art),
      id: 'state-movie',
      kind: 'symbol' as const,
      symbolId: 'clock',
      symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    };
  button.shapes = [movie];
  button.timeline!.keys = [
    { frame: 1, shapes: [structuredClone(movie)] },
    { frame: 2, shapes: [structuredClone(movie)] },
  ];
  data.project.symbols!.push({
    id: 'clock',
    name: 'Clock',
    width: 20,
    height: 20,
    shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#ff0000' }],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#0000ff' }] },
        { frame: 2, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#00ff00' }] },
      ],
    },
  });
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const colors = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const initial = api.captureSymbolScriptArtworkHistory(provider, image),
      colors = [];
    const advance = async (state: 'over' | 'down', tick: number) => {
      const proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
      image = await api.renderSymbolScriptArtworkVisual(
        provider,
        api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, state, { frame: 0, tick }),
      );
    };
    const pixel = async () => {
      const bitmap = await createImageBitmap(image),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(85, 5, 1, 1).data);
    };
    await advance('over', 1);
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 0, tick: 2 }]),
    );
    colors.push(await pixel());
    const history = api.captureSymbolScriptArtworkHistory(provider, image);
    await advance('down', 3);
    colors.push(await pixel());
    image = await api.restoreSymbolScriptArtworkHistory(provider, history);
    colors.push(await pixel());
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 0, tick: 3 }]),
    );
    colors.push(await pixel());
    image = await api.restoreSymbolScriptArtworkHistory(provider, initial);
    colors.push(await pixel());
    provider.dispose();
    owner.dispose();
    return colors;
  }, data);
  expect(colors).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
  ]);
});

test('private visual continuation cannot revive expired reflected nested targets across absence and reentry', async ({
  page,
}) => {
  const data = fixture(),
    local = data.definition,
    button = data.project.symbols![2],
    art = button.shapes[0],
    inner = { ...structuredClone(button), id: 'inner', name: 'Inner' };
  button.shapes = [
    { ...structuredClone(art), id: 'inner-instance', kind: 'symbol', symbolId: 'inner' },
  ];
  button.timeline!.keys = [];
  local.shapes = [
    {
      ...structuredClone(art),
      id: 'outer',
      kind: 'symbol',
      symbolId: 'button',
      x: 80,
      y: 10,
      transform: [-1, 0, 0, 1],
    },
  ];
  local.timeline!.layers = [];
  local.timeline!.keys = [
    { frame: 1, shapes: [] },
    { frame: 2, shapes: structuredClone(local.shapes) },
  ];
  data.project.symbols!.push(inner);
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const first = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, first, 0, 'down', {
        frame: 0,
        tick: 1,
      }),
    );
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 1, tick: 2 }]),
    );
    const absent = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkContinuation(
      provider,
      api.prepareSymbolScriptArtworkContinuation(provider, image, [{ frame: 2, tick: 3 }]),
    );
    const resetBitmap = await createImageBitmap(image),
      resetCanvas = document.createElement('canvas');
    resetCanvas.width = resetBitmap.width;
    resetCanvas.height = resetBitmap.height;
    const resetContext = resetCanvas.getContext('2d')!;
    resetContext.drawImage(resetBitmap, 0, 0);
    resetBitmap.close();
    const resetPixel = Array.from(resetContext.getImageData(75, 15, 1, 1).data);
    const fresh = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, fresh, 0, 'over', {
        frame: 2,
        tick: 4,
      }),
    );
    const bitmap = await createImageBitmap(image),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = Array.from(ctx.getImageData(75, 15, 1, 1).data);
    provider.dispose();
    owner.dispose();
    return {
      first: first.targets[0],
      absent: absent.targets[0],
      fresh: fresh.targets[0],
      pixel,
      resetPixel,
    };
  }, data);
  expect(result.first?.symbolId).toBe('inner');
  expect(result.absent).toBeNull();
  expect(result.fresh!.lifetime).toBeGreaterThan(result.first!.lifetime);
  expect(result.resetPixel).toEqual([255, 0, 0, 255]);
  expect(result.pixel).toEqual([0, 255, 0, 255]);
});
for (const fault of ['cancel', 'source'] as const)
  test(`private continuation ${fault} retains current image and permits source-valid retry`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(
      async ({ data, fault }) => {
        const api = (
            window as unknown as {
              SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
                typeof import('../../apps/editor/src/symbol-script-artwork');
            }
          ).SymbolImageHarness,
          source = { ...data, validateEnclosing: () => {} },
          before = JSON.stringify(data.project),
          owner = api.captureSymbolLocalProgram(() => source),
          provider = api.createSymbolScriptArtworkProvider(owner);
        let image = await provider.render([{ frame: 0, tick: 0 }]);
        let proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
        image = await api.renderSymbolScriptArtworkVisual(
          provider,
          api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'over', {
            frame: 0,
            tick: 1,
          }),
        );
        api.captureSymbolScriptArtworkHistory(provider, image);
        proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
        image = await api.renderSymbolScriptArtworkVisual(
          provider,
          api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'down', {
            frame: 0,
            tick: 2,
          }),
        );
        const current = await api.querySymbolScriptArtworkTargets(provider, image, [
            { x: 85, y: 5 },
          ]),
          controller = new AbortController(),
          plan = api.prepareSymbolScriptArtworkContinuation(provider, image, [
            { frame: 0, tick: 3 },
            { frame: 0, tick: 4 },
          ]),
          pending = api.renderSymbolScriptArtworkContinuation(provider, plan, {
            signal: controller.signal,
          });
        if (fault === 'cancel') controller.abort();
        else source.revision++;
        let message = '';
        try {
          await pending;
        } catch (error) {
          message = String(error);
        }
        let retained = false;
        if (fault === 'cancel') {
          retained =
            (await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]))
              .imageId === current.imageId;
          await api.renderSymbolScriptArtworkContinuation(provider, plan);
        }
        provider.dispose();
        owner.dispose();
        return {
          message,
          retained,
          unchanged: JSON.stringify(data.project) === before,
          leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
        };
      },
      { data: fixture(), fault },
    );
    expect(result.message).toMatch(fault === 'cancel' ? /abort/i : /changed/);
    if (fault === 'cancel') expect(result.retained).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.leaks).toBe(0);
  });
test('private visual history restores exact mapped pixels and expires identical-image queries and plans', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      before = JSON.stringify(data.project),
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const initial = api.captureSymbolScriptArtworkHistory(provider, image),
      colors = [];
    const pixel = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(85, 5, 1, 1).data);
    };
    let proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'over', {
        frame: 2,
        tick: 1,
      }),
    );
    const history = api.captureSymbolScriptArtworkHistory(provider, image);
    colors.push(await pixel(image));
    proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'down', {
        frame: 2,
        tick: 2,
      }),
    );
    colors.push(await pixel(image));
    image = await api.restoreSymbolScriptArtworkHistory(provider, initial);
    colors.push(await pixel(image));
    image = await api.restoreSymbolScriptArtworkHistory(provider, history);
    colors.push(await pixel(image));
    const old = image,
      oldProof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]),
      plan = api.prepareSymbolScriptArtworkVisual(provider, image, oldProof, 0, 'down', {
        frame: 2,
        tick: 2,
      });
    image = await api.restoreSymbolScriptArtworkHistory(provider, history);
    colors.push(await pixel(image));
    let stale = '';
    try {
      await api.querySymbolScriptArtworkTargets(provider, old, [{ x: 85, y: 5 }]);
    } catch (error) {
      stale = String(error);
    }
    let expired = '';
    try {
      plan.snapshot();
    } catch (error) {
      expired = String(error);
    }
    const fresh = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]),
      metadata = history.snapshot();
    provider.dispose();
    owner.dispose();
    return {
      colors,
      stale,
      expired,
      different: fresh.imageId !== oldProof.imageId,
      metadata,
      unchanged: JSON.stringify(data.project) === before,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.colors).toEqual([
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 255, 0, 255],
  ]);
  expect(result.stale).toMatch(/stale/);
  expect(result.expired).toMatch(/stale/);
  expect(result.different).toBe(true);
  expect(result.metadata).toMatchObject({ frame: 2, tick: 1, poseCount: 2, visualPoseCount: 1 });
  expect(result.unchanged).toBe(true);
  expect(result.leaks).toBe(0);
});

test('restored private visual history reconstructs descendant state clocks and resumes their original phase', async ({
  page,
}) => {
  const data = fixture(),
    button = data.project.symbols![2],
    art = button.shapes[0],
    movie = {
      ...structuredClone(art),
      id: 'state-movie',
      kind: 'symbol' as const,
      symbolId: 'clock',
      symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    };
  button.shapes = [movie];
  button.timeline!.keys = [
    { frame: 1, shapes: [structuredClone(movie)] },
    { frame: 2, shapes: [structuredClone(movie)] },
  ];
  data.project.symbols!.push({
    id: 'clock',
    name: 'Clock',
    width: 20,
    height: 20,
    shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#ff0000' }],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#0000ff' }] },
        { frame: 2, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#00ff00' }] },
      ],
    },
  });
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const colors = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const initial = api.captureSymbolScriptArtworkHistory(provider, image),
      colors = [];
    const advance = async (state: 'over' | 'down', tick: number) => {
      const proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
      image = await api.renderSymbolScriptArtworkVisual(
        provider,
        api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, state, { frame: 0, tick }),
      );
    };
    const pixel = async () => {
      const bitmap = await createImageBitmap(image),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(85, 5, 1, 1).data);
    };
    await advance('over', 1);
    await advance('over', 2);
    colors.push(await pixel());
    const history = api.captureSymbolScriptArtworkHistory(provider, image);
    await advance('down', 3);
    colors.push(await pixel());
    image = await api.restoreSymbolScriptArtworkHistory(provider, history);
    colors.push(await pixel());
    await advance('over', 3);
    colors.push(await pixel());
    image = await api.restoreSymbolScriptArtworkHistory(provider, initial);
    colors.push(await pixel());
    provider.dispose();
    owner.dispose();
    return colors;
  }, data);
  expect(colors).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
  ]);
});

for (const fault of ['cancel', 'source'] as const)
  test(`private history ${fault} during restoration retains current image and cleans rendering`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(
      async ({ data, fault }) => {
        const api = (
            window as unknown as {
              SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
                typeof import('../../apps/editor/src/symbol-script-artwork');
            }
          ).SymbolImageHarness,
          source = { ...data, validateEnclosing: () => {} },
          before = JSON.stringify(data.project),
          owner = api.captureSymbolLocalProgram(() => source),
          provider = api.createSymbolScriptArtworkProvider(owner);
        let image = await provider.render([{ frame: 0, tick: 0 }]);
        let proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
        image = await api.renderSymbolScriptArtworkVisual(
          provider,
          api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'over', {
            frame: 0,
            tick: 1,
          }),
        );
        const history = api.captureSymbolScriptArtworkHistory(provider, image);
        proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
        image = await api.renderSymbolScriptArtworkVisual(
          provider,
          api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'down', {
            frame: 0,
            tick: 2,
          }),
        );
        const current = await api.querySymbolScriptArtworkTargets(provider, image, [
            { x: 85, y: 5 },
          ]),
          controller = new AbortController(),
          pending = api.restoreSymbolScriptArtworkHistory(provider, history, {
            signal: controller.signal,
          });
        if (fault === 'cancel') controller.abort();
        else source.revision++;
        let message = '';
        try {
          await pending;
        } catch (error) {
          message = String(error);
        }
        let retained = false;
        if (fault === 'cancel') {
          retained =
            (await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]))
              .imageId === current.imageId;
          await api.restoreSymbolScriptArtworkHistory(provider, history);
        }
        provider.dispose();
        owner.dispose();
        return {
          message,
          retained,
          unchanged: JSON.stringify(data.project) === before,
          leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
        };
      },
      { data: fixture(), fault },
    );
    expect(result.message).toMatch(fault === 'cancel' ? /abort/i : /changed/);
    if (fault === 'cancel') expect(result.retained).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.leaks).toBe(0);
  });
for (const fault of ['cancel', 'source'] as const)
  test(`local visual ${fault} rejects asynchronous output and cleans renderer ownership`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(
      async ({ data, fault }) => {
        const api = (
            window as unknown as {
              SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
                typeof import('../../apps/editor/src/symbol-script-artwork');
            }
          ).SymbolImageHarness,
          source = { ...data, validateEnclosing: () => {} },
          before = JSON.stringify(data.project),
          owner = api.captureSymbolLocalProgram(() => source),
          provider = api.createSymbolScriptArtworkProvider(owner),
          image = await provider.render([{ frame: 0, tick: 0 }]),
          proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]),
          plan = api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, 'over', {
            frame: 0,
            tick: 1,
          }),
          controller = new AbortController();
        const pending = api.renderSymbolScriptArtworkVisual(provider, plan, {
          signal: controller.signal,
        });
        if (fault === 'cancel') controller.abort();
        else source.revision++;
        let message = '';
        try {
          await pending;
        } catch (error) {
          message = String(error);
        }
        let retry = false;
        if (fault === 'cancel') {
          const current = await api.querySymbolScriptArtworkTargets(provider, image, [
            { x: 85, y: 5 },
          ]);
          retry = current.imageId === proof.imageId;
          await api.renderSymbolScriptArtworkVisual(provider, plan);
        }
        provider.dispose();
        owner.dispose();
        return {
          message,
          retry,
          unchanged: JSON.stringify(data.project) === before,
          leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
        };
      },
      { data: fixture(), fault },
    );
    expect(result.message).toMatch(fault === 'cancel' ? /abort/i : /changed/);
    if (fault === 'cancel') expect(result.retry).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.leaks).toBe(0);
  });
test('qualified local visual preparations paint Over Down Up without changing plain rendering or source', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      before = JSON.stringify(data.project),
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const colors = [];
    const pixel = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(85, 5, 1, 1).data);
    };
    colors.push(await pixel(image));
    for (const [index, state] of (['over', 'down', 'up'] as const).entries()) {
      const proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]),
        plan = api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, state, {
          frame: 2,
          tick: index + 1,
        });
      image = await api.renderSymbolScriptArtworkVisual(provider, plan);
      colors.push(await pixel(image));
    }
    const plain = await provider.render(
      Array.from({ length: 4 }, (_, tick) => ({ frame: tick ? 2 : 0, tick })),
    );
    colors.push(await pixel(plain));
    provider.dispose();
    owner.dispose();
    return {
      colors,
      unchanged: JSON.stringify(data.project) === before,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.colors).toEqual([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  expect(result.unchanged).toBe(true);
  expect(result.leaks).toBe(0);
});

test('local visual state clocks advance within a state and restart across mapped state changes', async ({
  page,
}) => {
  const data = fixture(),
    button = data.project.symbols![2],
    art = button.shapes[0],
    movie = {
      ...structuredClone(art),
      id: 'state-movie',
      kind: 'symbol' as const,
      symbolId: 'clock',
      symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
    };
  button.shapes = [movie];
  button.timeline!.keys = [
    { frame: 1, shapes: [structuredClone(movie)] },
    { frame: 2, shapes: [structuredClone(movie)] },
  ];
  data.project.symbols!.push({
    id: 'clock',
    name: 'Clock',
    width: 20,
    height: 20,
    shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#ff0000' }],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#0000ff' }] },
        { frame: 2, shapes: [{ ...structuredClone(art), id: 'clock-art', fill: '#00ff00' }] },
      ],
    },
  });
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const colors = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const colors = [];
    for (const [index, state] of (
      ['over', 'over', 'over', 'down', 'down', 'up'] as const
    ).entries()) {
      const proof = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
      image = await api.renderSymbolScriptArtworkVisual(
        provider,
        api.prepareSymbolScriptArtworkVisual(provider, image, proof, 0, state, {
          frame: 0,
          tick: index + 1,
        }),
      );
      const bitmap = await createImageBitmap(image),
        canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      colors.push(Array.from(ctx.getImageData(85, 5, 1, 1).data));
    }
    provider.dispose();
    owner.dispose();
    return colors;
  }, data);
  expect(colors).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [255, 0, 0, 255],
  ]);
});

test('reflected nested visual targets keep child-first identity and cannot revive expired lifetimes', async ({
  page,
}) => {
  const data = fixture(),
    local = data.definition,
    button = data.project.symbols![2],
    art = button.shapes[0],
    inner = { ...structuredClone(button), id: 'inner', name: 'Inner' };
  button.shapes = [
    { ...structuredClone(art), id: 'inner-instance', kind: 'symbol', symbolId: 'inner' },
  ];
  button.timeline!.keys = [];
  local.shapes = [
    {
      ...structuredClone(art),
      id: 'outer',
      kind: 'symbol',
      symbolId: 'button',
      x: 80,
      y: 10,
      transform: [-1, 0, 0, 1],
    },
  ];
  local.timeline!.layers = [];
  local.timeline!.keys = [
    { frame: 1, shapes: [] },
    { frame: 2, shapes: structuredClone(local.shapes) },
  ];
  data.project.symbols!.push(inner);
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let image = await provider.render([{ frame: 0, tick: 0 }]);
    const first = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, first, 0, 'down', {
        frame: 1,
        tick: 1,
      }),
    );
    const absent = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, absent, 0, 'up', { frame: 2, tick: 2 }),
    );
    const fresh = await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 75, y: 15 }]);
    image = await api.renderSymbolScriptArtworkVisual(
      provider,
      api.prepareSymbolScriptArtworkVisual(provider, image, fresh, 0, 'over', {
        frame: 2,
        tick: 3,
      }),
    );
    const bitmap = await createImageBitmap(image),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixel = Array.from(ctx.getImageData(75, 15, 1, 1).data);
    provider.dispose();
    owner.dispose();
    return { first: first.targets[0], absent: absent.targets[0], fresh: fresh.targets[0], pixel };
  }, data);
  expect(result.first?.symbolId).toBe('inner');
  expect(result.absent).toBeNull();
  expect(result.fresh!.lifetime).toBeGreaterThan(result.first!.lifetime);
  expect(result.pixel).toEqual([0, 255, 0, 255]);
});
test('local queries use reflected Hit geometry rather than visible Up pixels', async ({ page }) => {
  const data = fixture(),
    local = data.definition,
    button = data.project.symbols![2],
    art = button.shapes[0];
  local.shapes = [
    {
      ...structuredClone(art),
      id: 'reflected-button',
      kind: 'symbol',
      symbolId: button.id,
      x: 50,
      y: 10,
      transform: [-1, 0, 0, 1],
    },
  ];
  local.timeline!.keys = [];
  local.timeline!.layers = [];
  button.buttonStates!.hit = 1;
  button.timeline!.keys = [
    { frame: 1, shapes: [{ ...structuredClone(art), x: 30, width: 10, height: 10 }] },
  ];
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      image = await provider.render([{ frame: 0, tick: 0 }]),
      hits = await api.querySymbolScriptArtworkTargets(provider, image, [
        { x: 15, y: 15 },
        { x: 45, y: 15 },
      ]);
    const bitmap = await createImageBitmap(image),
      canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = [15, 45].map((x) => Array.from(ctx.getImageData(x, 15, 1, 1).data));
    provider.dispose();
    owner.dispose();
    return { hits, pixels };
  }, data);
  expect(result.pixels).toEqual([
    [255, 255, 255, 255],
    [255, 0, 0, 255],
  ]);
  expect(result.hits.targets[0]).toMatchObject({ name: 'Button', symbolId: 'button' });
  expect(result.hits.targets[1]).toBeNull();
});

test('independent movie clocks change local button target exposure on a stopped frame', async ({
  page,
}) => {
  const data = fixture(),
    movie = data.project.symbols![1],
    art = movie.shapes[0];
  movie.shapes = [structuredClone(art)];
  movie.timeline!.keys = [
    {
      frame: 1,
      shapes: [
        { ...structuredClone(art), id: 'nested-button', kind: 'symbol', symbolId: 'button' },
      ],
    },
    { frame: 2, shapes: [] },
  ];
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const queries = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      results = [];
    for (const length of [1, 2, 4]) {
      const poses = Array.from({ length }, (_, tick) => ({ frame: 0, tick })),
        image = await provider.render(poses);
      results.push(
        await api.querySymbolScriptArtworkTargets(provider, image, [
          { x: 55, y: 5 },
          { x: 85, y: 5 },
        ]),
      );
    }
    provider.dispose();
    owner.dispose();
    return results;
  }, data);
  expect(queries[0].targets[0]).toMatchObject({ symbolId: 'button' });
  expect(queries[0].targets[0]!.instanceId).not.toBe(queries[0].targets[1]!.instanceId);
  expect(queries[1].targets[0]).toBeNull();
  expect(queries[2].targets[0]!.lifetime).toBeGreaterThan(queries[0].targets[0]!.lifetime);
  expect(queries[2].targets[1]).toEqual(queries[0].targets[1]);
});

test('actual local hit jobs reject late source and program disposal and clean renderers', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      image = await provider.render([{ frame: 0, tick: 0 }]);
    let late = '',
      closed = '';
    const pending = api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
    source.revision++;
    try {
      await pending;
    } catch (error) {
      late = String(error);
    }
    source.revision--;
    const last = api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
    owner.dispose();
    try {
      await last;
    } catch (error) {
      closed = String(error);
    }
    provider.dispose();
    return {
      late,
      closed,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.late).toMatch(/changed/);
  expect(result.closed).toMatch(/closed/);
  expect(result.leaks).toBe(0);
});
test('private target queries bind exact current images and isolate local button identities', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      poses = [{ frame: 0, tick: 0 }],
      image = await provider.render(poses),
      first = await api.querySymbolScriptArtworkTargets(provider, image, [
        { x: 85, y: 5 },
        { x: 5, y: 5 },
        { x: 150, y: 50 },
      ]);
    const next = await provider.render([...poses, { frame: 2, tick: 1 }]);
    let stale = '';
    try {
      await api.querySymbolScriptArtworkTargets(provider, image, [{ x: 85, y: 5 }]);
    } catch (error) {
      stale = String(error);
    }
    const second = await api.querySymbolScriptArtworkTargets(provider, next, [{ x: 85, y: 5 }]),
      other = api.createSymbolScriptArtworkProvider(owner),
      otherImage = await other.render(poses);
    let foreign = '';
    try {
      await api.querySymbolScriptArtworkTargets(provider, otherImage, [{ x: 85, y: 5 }]);
    } catch (error) {
      foreign = String(error);
    }
    provider.dispose();
    other.dispose();
    owner.dispose();
    return {
      first,
      second,
      stale,
      foreign,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.first.targets[0]).toMatchObject({
    name: 'Button',
    symbolId: 'button',
    lifetime: 1,
  });
  expect(result.first.targets.slice(1)).toEqual([null, null]);
  expect(JSON.parse(result.first.targets[0]!.instanceId)[0]).toBe(result.first.namespace);
  expect(JSON.parse(result.first.targets[0]!.token)[0]).toBe(result.first.namespace);
  expect(result.second.targets[0]).toEqual(result.first.targets[0]);
  expect(result.second.imageId).not.toBe(result.first.imageId);
  expect(result.second).toMatchObject({ frame: 2, tick: 1 });
  expect(result.stale).toMatch(/stale/);
  expect(result.foreign).toMatch(/foreign/);
  expect(result.leaks).toBe(0);
});

test('nested reflected button queries prefer children and preserve absence/reentry lifetimes', async ({
  page,
}) => {
  const data = fixture(),
    local = data.definition,
    button = data.project.symbols![2],
    art = button.shapes[0];
  const inner = {
    ...structuredClone(button),
    id: 'inner',
    name: 'Inner',
    shapes: [{ ...structuredClone(art), id: 'inner-art' }],
  };
  button.shapes = [
    {
      ...structuredClone(art),
      id: 'inner-instance',
      kind: 'symbol',
      symbolId: 'inner',
      x: 0,
      y: 0,
    },
  ];
  button.timeline!.keys = [];
  local.shapes = [
    {
      ...structuredClone(art),
      id: 'outer',
      kind: 'symbol',
      symbolId: 'button',
      x: 80,
      y: 10,
      transform: [-1, 0, 0, 1],
    },
  ];
  local.timeline!.layers = [];
  local.timeline!.keys = [
    { frame: 1, shapes: [] },
    { frame: 2, shapes: structuredClone(local.shapes) },
  ];
  data.project.symbols!.push(inner);
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      queries = [];
    for (let length = 1; length <= 3; length++) {
      const poses = Array.from({ length }, (_, tick) => ({ frame: tick, tick })),
        image = await provider.render(poses);
      queries.push(
        await api.querySymbolScriptArtworkTargets(provider, image, [
          { x: 75, y: 15 },
          { x: 85, y: 15 },
        ]),
      );
    }
    provider.dispose();
    owner.dispose();
    return queries;
  }, data);
  expect(result[0].targets[0]).toMatchObject({ symbolId: 'inner', name: 'Inner', lifetime: 2 });
  expect(result[0].targets[1]).toBeNull();
  expect(result[1].targets).toEqual([null, null]);
  expect(result[2].targets[0]).toMatchObject({ symbolId: 'inner', name: 'Inner' });
  expect(result[2].targets[0]!.lifetime).toBeGreaterThan(result[0].targets[0]!.lifetime);
  expect(result[2].targets[0]!.instanceId).toEqual(result[0].targets[0]!.instanceId);
});
test.beforeAll(async () => {
  const assets = await fs.readdir('dist/assets');
  const worker = (prefix: string) => {
    const name = assets.find((n) => n.startsWith(prefix) && n.endsWith('.js'));
    if (!name) throw Error('Build compiler assets first.');
    return name;
  };
  const files = [
    ['/packages/scripting/src/compile-async.ts', 'compile-worker.ts', worker('compile-worker-')],
    [
      '/apps/editor/src/script-artwork-compile.ts',
      'script-artwork-worker.ts',
      worker('script-artwork-worker-'),
    ],
  ];
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'private-symbol-image-harness',
        enforce: 'pre',
        resolveId(id) {
          if (id.endsWith('symbol-image-test-entry.ts')) return '\0symbol-image-test-entry';
        },
        load(id) {
          if (id === '\0symbol-image-test-entry')
            return [
              'packages/scripting/src/symbol-program.ts',
              'apps/editor/src/symbol-script-artwork.ts',
            ]
              .map((p) => `export * from ${JSON.stringify(path.resolve(p).replaceAll('\\', '/'))};`)
              .join('\n');
        },
        transform(source, id) {
          for (const [suffix, original, output] of files)
            if (id.replaceAll('\\', '/').endsWith(suffix)) {
              const revised = source.replace(
                `new URL('./${original}',import.meta.url)`,
                `new URL('/assets/${output}',location.href)`,
              );
              if (revised === source) throw Error('Worker harness path changed.');
              return revised;
            }
        },
      },
    ],
    build: {
      write: false,
      emptyOutDir: false,
      minify: false,
      lib: { entry: 'symbol-image-test-entry.ts', name: 'SymbolImageHarness', formats: ['iife'] },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((r) =>
      'output' in r ? r.output : [],
    ),
    entry = chunks.find((c) => c.type === 'chunk' && c.isEntry);
  if (!entry || entry.type !== 'chunk') throw Error('Missing harness');
  bundle = entry.code;
});
function fixture() {
  const project = newProject();
  project.background = '#ffffff';
  project.fps = 30;
  project.frameScripts = [{ frame: 0, source: 'throw new Error("main ran")' }];
  const rect = (id: string, fill: string, x = 0, y = 0): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 20,
    height: 20,
    rotation: 0,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  project.symbols = [
    {
      id: 'local',
      name: 'Local',
      width: 100,
      height: 60,
      shapes: [rect('base', '#ff0000')],
      timeline: {
        duration: 3,
        keys: [{ frame: 2, shapes: [rect('base', '#00ff00', 20)] }],
        frameScripts: [{ frame: 0, source: 'throw new Error("local ran")' }],
        layers: [
          {
            id: 'children',
            name: 'Children',
            visible: true,
            locked: false,
            keys: [
              {
                frame: 0,
                shapes: [
                  {
                    ...rect('movie', '#000000', 50),
                    kind: 'symbol',
                    symbolId: 'movie',
                    symbolPlayback: { mode: 'movie', firstFrame: 1 },
                  },
                  { ...rect('button', '#000000', 80), kind: 'symbol', symbolId: 'button' },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      id: 'movie',
      name: 'Movie',
      width: 20,
      height: 20,
      shapes: [rect('m', '#0000ff')],
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [rect('m', '#ffff00')] },
          { frame: 2, shapes: [rect('m', '#ff00ff')] },
        ],
        frameScripts: [{ frame: 0, source: 'throw new Error("child ran")' }],
      },
    },
    {
      id: 'button',
      name: 'Button',
      width: 20,
      height: 20,
      shapes: [rect('b', '#ff0000')],
      buttonStates: { up: 0, over: 1, down: 2, hit: 0 },
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [rect('b', '#00ff00')] },
          { frame: 2, shapes: [rect('b', '#0000ff')] },
        ],
      },
    },
  ];
  return { project, definition: project.symbols[0], frame: 1, revision: 1 };
}
test('private PNGs preserve local seeks, stopped descendant clocks and button Up without executing source', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    const images = [];
    for (let length = 1; length <= 3; length++) {
      const poses = Array.from({ length }, (_, tick) => ({ frame: tick === 0 ? 0 : 2, tick })),
        blob = await provider.render(poses),
        image = await createImageBitmap(blob),
        canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      images.push({
        width: canvas.width,
        height: canvas.height,
        pixels: [5, 25, 55, 85].map((x) => Array.from(ctx.getImageData(x, 5, 1, 1).data)),
      });
    }
    provider.dispose();
    owner.dispose();
    return {
      images,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.images).toEqual([
    {
      width: 100,
      height: 60,
      pixels: [
        [255, 0, 0, 255],
        [255, 255, 255, 255],
        [255, 255, 0, 255],
        [255, 0, 0, 255],
      ],
    },
    {
      width: 100,
      height: 60,
      pixels: [
        [255, 255, 255, 255],
        [0, 255, 0, 255],
        [255, 0, 255, 255],
        [255, 0, 0, 255],
      ],
    },
    {
      width: 100,
      height: 60,
      pixels: [
        [255, 255, 255, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 0, 0, 255],
      ],
    },
  ]);
  expect(result.leaks).toBe(0);
  expect(errors).toEqual([]);
});
test('actual artwork cancellation preserves ownership and allows a fresh render', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      controller = new AbortController();
    const pending = provider.render([{ frame: 0, tick: 0 }], { signal: controller.signal });
    controller.abort();
    let rejected = false;
    try {
      await pending;
    } catch {
      rejected = true;
    }
    const blob = await provider.render([{ frame: 0, tick: 0 }]);
    provider.dispose();
    owner.dispose();
    return {
      rejected,
      type: blob.type,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result).toEqual({ rejected: true, type: 'image/png', leaks: 0 });
});

test('private rendering preserves reflected geometry and awaits bitmap and text readiness', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
      window as unknown as {
        SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
          typeof import('../../apps/editor/src/symbol-script-artwork');
      }
    ).SymbolImageHarness;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 2;
    const tc = tile.getContext('2d')!;
    tc.fillStyle = '#ff00ff';
    tc.fillRect(0, 0, 2, 2);
    data.project.assets = [
      {
        id: 'tile',
        path: 'assets/bitmaps/tile.json',
        bitmap: { name: 'Tile', width: 2, height: 2, dataUrl: tile.toDataURL() },
      },
    ];
    const original = data.definition.shapes[0];
    data.definition.shapes = [
      { ...original, x: 30, y: 5, width: 10, height: 10, transform: [-1, 0, 0, 1] },
      {
        ...original,
        id: 'bitmap',
        x: 40,
        y: 5,
        width: 10,
        height: 10,
        bitmap: { assetId: 'tile', x: 0, y: 0, width: 10, height: 10 },
      },
      {
        ...original,
        id: 'text',
        kind: 'text',
        x: 5,
        y: 30,
        width: 80,
        height: 25,
        fill: '#000000',
        text: {
          content: 'Ready',
          font: 'sans-serif',
          size: 20,
          bold: false,
          italic: false,
          align: 'left',
        },
      },
    ];
    data.definition.timeline!.layers = [];
    data.definition.timeline!.keys = [];
    const source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      blob = await provider.render([{ frame: 0, tick: 0 }]),
      image = await createImageBitmap(blob),
      canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    image.close();
    let ink = 0;
    const pixels = ctx.getImageData(0, 25, 100, 35).data;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 128 && pixels[i + 1] < 128 && pixels[i + 2] < 128) ink++;
    const samples = [25, 35, 45].map((x) => Array.from(ctx.getImageData(x, 10, 1, 1).data));
    provider.dispose();
    owner.dispose();
    return {
      samples,
      ink,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.samples).toEqual([
    [255, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 0, 255, 255],
  ]);
  expect(result.ink).toBeGreaterThan(50);
  expect(result.leaks).toBe(0);
});

test('missing bitmap readiness fails without consuming the private program', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
      window as unknown as {
        SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
          typeof import('../../apps/editor/src/symbol-script-artwork');
      }
    ).SymbolImageHarness;
    data.project.assets = [
      {
        id: 'missing',
        path: 'assets/bitmaps/missing.json',
        bitmap: { name: 'Missing', width: 2, height: 2 },
      },
    ];
    data.definition.shapes[0].bitmap = { assetId: 'missing', x: 0, y: 0, width: 20, height: 20 };
    const source = { ...data, validateEnclosing: () => {} },
      before = JSON.stringify(data.project),
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner);
    let message = '';
    try {
      await provider.render([{ frame: 0, tick: 0 }]);
    } catch (error) {
      message = String(error);
    }
    const current = owner.snapshot();
    provider.dispose();
    owner.dispose();
    return {
      message,
      frame: current.selectedFrame,
      unchanged: JSON.stringify(data.project) === before,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.message).toMatch(/bitmap|embedded/i);
  expect(result.frame).toBe(1);
  expect(result.unchanged).toBe(true);
  expect(result.leaks).toBe(0);
});

test('late original source changes reject real completed images without publishing state', async ({
  page,
}) => {
  await page.goto('/');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async (data) => {
    const api = (
        window as unknown as {
          SymbolImageHarness: typeof import('../../packages/scripting/src/symbol-program') &
            typeof import('../../apps/editor/src/symbol-script-artwork');
        }
      ).SymbolImageHarness,
      source = { ...data, validateEnclosing: () => {} },
      owner = api.captureSymbolLocalProgram(() => source),
      provider = api.createSymbolScriptArtworkProvider(owner),
      before = JSON.stringify(data.project);
    const pending = provider.render([{ frame: 0, tick: 0 }]);
    source.revision++;
    let message = '';
    try {
      await pending;
    } catch (error) {
      message = String(error);
    }
    provider.dispose();
    owner.dispose();
    return {
      message,
      unchanged: JSON.stringify(data.project) === before,
      leaks: document.querySelectorAll('iframe[title="Script artwork renderer"]').length,
    };
  }, fixture());
  expect(result.message).toMatch(/changed/);
  expect(result.unchanged).toBe(true);
  expect(result.leaks).toBe(0);
});
