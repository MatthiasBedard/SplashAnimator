import { expect, it } from 'vitest';
import { newProject, validateProject, type FrameComment } from '../packages/document/src';
import { MAX_FRAME_COMMENT_LENGTH, prepareFrameComment, validateFrameComments } from '../packages/document/src/frame-comments';
import { disposeLayerScene, prepareLayerScene } from '../packages/animation/src/layer-scene';
import { editLayerFrameRanges } from '../packages/animation/src/timeline';
import { exportHTML } from '../packages/export-web/src';

it('adds multiline comments in frame order, edits and removes them without sharing records', () => {
  const original = [{ frame: 4, text: 'Hold this pose' }];
  const withComment = prepareFrameComment(original, 8, 1, ' Beat one\n\tThen pause ');
  expect(withComment).toEqual([{ frame: 1, text: ' Beat one\n\tThen pause ' }, ...original]);
  expect(withComment?.[1]).not.toBe(original[0]);
  expect(prepareFrameComment(withComment, 8, 4, 'Slower')).toEqual([
    { frame: 1, text: ' Beat one\n\tThen pause ' }, { frame: 4, text: 'Slower' },
  ]);
  expect(prepareFrameComment(original, 8, 4, null)).toBeUndefined();
});

it('rejects getters, invalid frames, duplicate positions and oversized comments on original data', () => {
  let reads = 0;
  const original = newProject();
  Object.defineProperty(original, 'frameComments', { enumerable: true, get() { reads++; return []; } });
  expect(() => validateProject(original)).toThrow();
  expect(() => validateFrameComments([{ frame: 0, get text() { reads++; return 'text'; } }], 2)).toThrow();
  expect(reads).toBe(0);
  const oversized = 'x'.repeat(MAX_FRAME_COMMENT_LENGTH + 1);
  for (const comments of [
    [{ frame: 0, text: oversized }], [{ frame: 0, text: '\n\t' }], [{ frame: -1, text: 'Text' }],
    [{ frame: 2, text: 'Text' }], [{ frame: 0, text: 'Text\x00' }],
    [{ frame: 0, text: 'First' }, { frame: 0, text: 'Second' }],
  ]) expect(() => validateFrameComments(comments, 2)).toThrow();
});

it('admits the exact per-timeline comment budget and rejects the next character', () => {
  const cap = 256 * 1024;
  const full = Array.from({ length: Math.ceil(cap / MAX_FRAME_COMMENT_LENGTH) }, (_, frame): FrameComment => ({
    frame, text: 'a'.repeat(Math.min(MAX_FRAME_COMMENT_LENGTH, cap - frame * MAX_FRAME_COMMENT_LENGTH)),
  }));
  expect(() => validateFrameComments(full, full.length)).not.toThrow();
  full.at(-1)!.text += 'a';
  expect(() => validateFrameComments(full, full.length)).toThrow('text budget');
});

it('keeps comments out of one-frame admission and standalone playback data', () => {
  const project = newProject();
  project.duration = 5;
  const html = exportHTML(project);
  project.frameComments = [{ frame: 4, text: 'Private cue' }];
  const scene = prepareLayerScene(project, 0, [], source =>
    source.layers.map(layer => ({ layerId: layer.id, shapes: layer.keys[0].shapes })),
  );
  disposeLayerScene(scene);
  expect(exportHTML(project)).toBe(html);
});

it('retains a timeline comment when a layer range at that position is removed', () => {
  const project = newProject();
  project.duration = 8;
  project.frameComments = [{ frame: 2, text: 'A cue for every layer' }];
  const layer = project.layers[0];
  layer.keys.push({ frame: 4, shapes: [] });
  editLayerFrameRanges(project, [layer.id], 2, 3, 'remove');
  expect(layer.keys.map(key => key.frame)).toEqual([0, 2, 6]);
  expect(project.duration).toBe(8);
  expect(project.frameComments).toEqual([{ frame: 2, text: 'A cue for every layer' }]);
});
