import { expect, it } from 'vitest';
import { newLayer } from '../packages/document/src';
import { captureAnimatedFrameClipboard, prepareAnimatedFramePaste } from '../packages/animation/src/animated-frame-clipboard';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { liveSplitFixture } from './live-motion-split-fixture';

function fixture() {
  const source = liveSplitFixture();
  const remembered = structuredClone(source.layers[0]);
  remembered.id = 'remembered';
  delete remembered.liveMotionSpans;
  const first = { ...newLayer('First'), id: 'first' }, second = { ...newLayer('Second'), id: 'second' };
  source.layers.push(remembered, first, second);
  createBasicMotionSpan(source, ['remembered'], 0, 8, 'linear');
  return source;
}

it('cuts both recipe types into a detached clipboard and admits a repeated paste with fresh identities', () => {
  const source = fixture(), before = structuredClone(source);
  const { clipboard, project } = captureAnimatedFrameClipboard(source, ['track', 'remembered'], 0, 8, true);
  expect(source).toEqual(before);
  expect(project.layers.slice(0, 2).map(layer => layer.keys)).toEqual(Array.from({ length: 2 }, () => [
    { frame: 0, shapes: [] }, { frame: 10, shapes: [] },
  ]));
  source.layers[0].keys[0].shapes[0].x = 500;
  const out = prepareAnimatedFramePaste(project, 2, ['first', 'second'], clipboard);
  const repeat = prepareAnimatedFramePaste(out, 2, ['first', 'second'], clipboard);
  expect(out.layers[2].keys[1].shapes[0].x).toBe(8);
  expect(out.layers[2].liveMotionSpans![0]).toMatchObject({ start: 2, end: 10 });
  expect(out.layers[3].motionSpans![0]).toMatchObject({ start: 2, end: 10 });
  expect(JSON.parse(out.layers[3].motionSpans![0].baseline)).toEqual(out.layers[3].keys.slice(2, -1));
  expect(repeat.layers[2].liveMotionSpans![0].id).not.toBe(out.layers[2].liveMotionSpans![0].id);
  expect(repeat.layers[3].keys[1].shapes[0].id).not.toBe(out.layers[3].keys[1].shapes[0].id);
});

it('rejects partial captures and failed later-track pastes without consuming the clipboard or the project', () => {
  const source = fixture();
  const { clipboard } = captureAnimatedFrameClipboard(source, ['track', 'remembered'], 0, 8, false);
  source.layers[3].locked = true;
  const before = structuredClone(source);
  expect(() => captureAnimatedFrameClipboard(source, ['track', 'remembered'], 0, 6, true)).toThrow('complete tween');
  expect(() => prepareAnimatedFramePaste(source, 2, ['first', 'second'], clipboard)).toThrow('unlocked');
  expect(() => prepareAnimatedFramePaste(source, 2, ['first', 'second'], structuredClone(clipboard))).toThrow('Copy or cut');
  expect(source).toEqual(before);
  source.layers[3].locked = false;
  expect(prepareAnimatedFramePaste(source, 2, ['first', 'second'], clipboard).layers[3].motionSpans).toHaveLength(1);
});
