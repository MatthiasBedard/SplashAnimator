import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../layer-presentation-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/layer-presentation-fixture.ts',
        formats: ['iife'],
        name: 'LayerPresentation',
        fileName: () => 'layer-presentation.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((r) => r.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one presentation API bundle');
  code = chunks[0].code;
});
async function setup(page: Page) {
  await page.goto('/');
  await page.addScriptTag({ content: code });
}
for (const [frame, time, position, expected] of [
  [0, 0, 0, 'green'],
  [0, 0.5, 0, 'blue'],
  [0, 1, 0, 'white'],
  [1, 0.5, 1, 'blue'],
  [5, 2.5, 5, 'white'],
  [6, 3, 6, 'green'],
] as const)
  test(`resolved multi-layer Canvas equals ordinary rendering and preserves clocks ${frame}/${time}`, async ({
    page,
  }) => {
    await setup(page);
    const result = await page.evaluate(
      ({ frame, time, position }) => {
        const api = (window as unknown as { LayerPresentation: API }).LayerPresentation,
          p = api.layerPresentationFixture(),
          before = JSON.stringify(p),
          view = api.createInteractiveButtonView(p, { layerPresentation: true }),
          movies = api.createMovieTreeClock(),
          states = api.createRootButtonMoviePlayback();
        let calls = 0;
        function sample(frame: number, time: number, position: number) {
          const frames = movies.sample(p, frame, time, position),
            origins = movies.origins();
          const snapshot = view.sample(frame, frames, origins, null, null, (button) => {
            calls++;
            const b = states.sample(p, [button], null, null, time, false);
            return {
              frames: b.stateFrames.get(button.token)!,
              origins: b.stateOrigins.get(button.token)!,
            };
          });
          const bank = states.sample(p, snapshot.buttons, null, null, time);
          return { snapshot, bank, frames };
        }
        sample(0, 0, 0);
        const s = sample(frame, time, position),
          count = calls,
          origins = movies.origins(),
          banks = JSON.stringify([...s.bank.stateFrames]);
        const ordinary = api.evaluate(
            s.snapshot.render(null, null, s.bank.artwork, s.bank.stateFrames),
            frame,
            s.frames,
          ),
          captured = s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames);
        const make = () => {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 80;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 160, 80);
          return ctx;
        };
        const a = make(),
          b = make();
        for (const shape of ordinary) api.drawShape(a, shape, p.assets);
        for (const layer of captured.layers)
          for (const shape of layer.shapes) api.drawShape(b, shape, p.assets);
        for (let read = 0; read < 3; read++)
          s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames);
        const ordinaryPixels = a.getImageData(0, 0, 160, 80).data,
          layerPixels = b.getImageData(0, 0, 160, 80).data;
        return {
          same: ordinaryPixels.every((n, i) => n === layerPixels[i]),
          point: Array.from(b.getImageData(115, 20, 1, 1).data),
          layers: captured.layers.map((l) => [l.layerId, l.shapes.length]),
          buttonsSame: JSON.stringify(captured.buttons) === JSON.stringify(s.snapshot.buttons),
          countStable: calls === count,
          originsSame: JSON.stringify(movies.origins()) === JSON.stringify(origins),
          banksSame: JSON.stringify([...s.bank.stateFrames]) === banks,
          sourceSame: JSON.stringify(p) === before,
        };
      },
      { frame, time, position },
    );
    expect(result.same).toBe(true);
    expect(result.point).toEqual(
      expected === 'green'
        ? [0, 255, 0, 255]
        : expected === 'blue'
          ? [0, 0, 255, 255]
          : [255, 255, 255, 255],
    );
    expect(result.layers.map((l) => l[0])).toEqual(['a', 'b', 'hidden']);
    expect(result.layers[2][1]).toBe(0);
    expect(
      result.buttonsSame &&
        result.countStable &&
        result.originsSame &&
        result.banksSame &&
        result.sourceSame,
    ).toBe(true);
  });

for (const time of [0, 0.5, 1, 1.5])
  test(`button-state movie layer pose enters private Canvas masks without resampling at ${time}`, async ({
    page,
  }) => {
    await setup(page);
    const result = await page.evaluate(async (time) => {
      const api = (window as unknown as { LayerPresentation: API }).LayerPresentation,
        p = api.layerPresentationMaskFixture(),
        before = JSON.stringify(p),
        view = api.createInteractiveButtonView(p, { layerPresentation: true }),
        states = api.createRootButtonMoviePlayback();
      let calls = 0;
      const sample = (time: number) => {
        const snap = view.sample(0, {}, {}, null, null, (button) => {
          calls++;
          const bank = states.sample(p, [button], null, null, time, false);
          return {
            frames: bank.stateFrames.get(button.token)!,
            origins: bank.stateOrigins.get(button.token)!,
          };
        });
        const bank = states.sample(p, snap.buttons, null, null, time);
        return { snap, bank };
      };
      sample(0);
      const { snap, bank } = sample(time),
        count = calls,
        data = snap.presentation(bank.artwork, bank.stateFrames);
      let revision = 0;
      const scene = api.prepareLayerScene(
        p,
        0,
        [{ maskLayerId: 'mask', layerIds: ['target'] }],
        () =>
          data.layers.map((l) => ({ layerId: l.layerId, shapes: structuredClone([...l.shapes]) })),
        {
          validate: () => {
            if (revision) throw Error('Clock presentation changed');
          },
        },
      );
      const painter = await api.prepareMaskedLayerPainter(scene),
        canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 40;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 80, 40);
      painter.paint(ctx);
      const points = [5, 25, 55].map((x) => Array.from(ctx.getImageData(x, 20, 1, 1).data)),
        rendered = Array.from(ctx.getImageData(0, 0, 80, 40).data);
      revision++;
      let rejected = false;
      try {
        painter.paint(ctx);
      } catch {
        rejected = true;
      }
      const after = ctx.getImageData(0, 0, 80, 40).data;
      const unchanged = rendered.every((n, i) => n === after[i]);
      painter.dispose();
      api.disposeLayerScene(scene);
      return {
        points,
        unchanged,
        rejected,
        disposed: painter.disposed,
        sourceSame: JSON.stringify(p) === before,
        callsSame: calls === count,
        tokens: data.buttons.map((b) => b.shape.id),
      };
    }, time);
    const half = [128, 0, 127, 255],
      blue = [0, 0, 255, 255];
    expect(result.points).toEqual(
      time === 0 || time === 1.5
        ? [half, blue, blue]
        : time === 0.5
          ? [blue, half, blue]
          : [blue, blue, blue],
    );
    expect(
      result.unchanged &&
        result.rejected &&
        result.disposed &&
        result.sourceSame &&
        result.callsSame,
    ).toBe(true);
    expect(result.tokens).toEqual(['button']);
  });
