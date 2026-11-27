import { expect, it } from 'vitest';
import { liveGraphicFixture, createLiveGraphics } from './live-graphics-fixture';
import {
  prepareUpdateLiveMotionSpans,
  captureLiveMotionTimeline,
} from '../packages/animation/src/live-motion';
for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`edits ${mode}/${basis} geometry timing independently from authored graphic age`, () => {
      const { p, span } = liveGraphicFixture(mode, basis),
        source = createLiveGraphics(p, span),
        before = structuredClone(source);
      const out = prepareUpdateLiveMotionSpans(source, [
          { layerId: 'track', spanId: 'live', changes: { ease: 'in' } },
        ]),
        owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
        shape = owner.sample(6)[0].key.shapes[0];
      expect(shape.x).toBe(40);
      expect(shape.y).toBe(40);
      expect(shape.rotation).toBeCloseTo(22.5);
      expect(shape.symbolPlayback!.firstFrame).toBe(
        mode === 'single' ? 1 : mode === 'once' || mode === 'default' ? 4 : 0,
      );
      expect(out.layers[0].liveMotionSpans).toEqual([{ ...span, ease: 'in' }]);
      expect(out.layers[0].keys).toEqual(before.layers[0].keys);
      expect(out.symbols).toEqual(before.symbols);
      expect(source).toEqual(before);
      owner.dispose();
    });
for (const failure of ['clock', 'button', 'later'])
  it(`requalifies graphic ${failure} failures before any detached update returns`, () => {
    const { p, span } = liveGraphicFixture(),
      source = createLiveGraphics(p, span);
    if (failure === 'clock') source.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
    if (failure === 'button') source.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (failure === 'later') {
      const later = structuredClone(source.layers[0]);
      later.id = 'later';
      later.keys[2].shapes[0].width++;
      source.layers.push(later);
    }
    const before = structuredClone(source),
      requests = [{ layerId: 'track', spanId: 'live', changes: { ease: 'in' as const } }];
    if (failure === 'later') requests.push({ ...requests[0], layerId: 'later' });
    expect(() => prepareUpdateLiveMotionSpans(source, requests)).toThrow();
    expect(source).toEqual(before);
  });
