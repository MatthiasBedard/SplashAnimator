import { expect, it } from 'vitest';
import { newProject, validateProject } from '../packages/document/src';
import { prepareFrameLabel, validateFrameLabels } from '../packages/document/src/frame-labels';
import { finishSymbolScene, prepareSymbolScene } from '../apps/editor/src/symbol-scene-scope';

it('validates ordered labels and prepares detached add, rename and removal', () => {
  const original = [{ frame: 2, name: 'Reveal' }];
  const next = prepareFrameLabel(original, 6, 0, '  Start  ');
  expect(next).toEqual([{ frame: 0, name: 'Start' }, ...original]);
  expect(prepareFrameLabel(next, 6, 2, 'Hold')).toEqual([{ frame: 0, name: 'Start' }, { frame: 2, name: 'Hold' }]);
  expect(prepareFrameLabel(original, 6, 2, null)).toBeUndefined();
  expect(original).toEqual([{ frame: 2, name: 'Reveal' }]);
  expect(() => prepareFrameLabel(original, 6, 1, 'Reveal')).toThrow('unique');
  expect(() => prepareFrameLabel(original, 6, 6, 'Out')).toThrow('existing frame');
  expect(() => validateFrameLabels([{ frame: 4, name: 'B' }, { frame: 0, name: 'A' }], 6)).toThrow();
});

it('validates original getters without reading them and keeps root and symbol names independent', () => {
  let read = 0;
  const invalid = [{ frame: 0, get name() { read++; return 'Unsafe'; } }];
  expect(() => validateFrameLabels(invalid, 1)).toThrow();
  expect(read).toBe(0);
  const project = newProject();
  project.duration = 2;
  project.frameLabels = [{ frame: 0, name: 'Start' }];
  const definition = {
    id: 'symbol', name: 'Symbol', width: 12, height: 12,
    shapes: [{ id: 'art', kind: 'rectangle' as const, x: 0, y: 0, width: 12, height: 12,
      rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] }],
    timeline: { duration: 4, keys: [], frameLabels: [{ frame: 3, name: 'Start' }] },
  };
  project.symbols = [definition];
  expect(validateProject(project)).toEqual(project);
  const scene = prepareSymbolScene(project, definition)!;
  const original = structuredClone(scene.project);
  scene.project.frameLabels = prepareFrameLabel(scene.project.frameLabels, 4, 1, 'Reveal');
  expect(finishSymbolScene(definition, original, scene.project).timeline?.frameLabels)
    .toEqual([{ frame: 1, name: 'Reveal' }, { frame: 3, name: 'Start' }]);
  expect(project.frameLabels).toEqual([{ frame: 0, name: 'Start' }]);
});
