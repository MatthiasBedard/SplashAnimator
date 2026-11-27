import { validateProject } from '../packages/document/src';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import type { SymbolSimplifyRequest } from '../packages/geometry/src/symbol-simplify-request';

export function symbolSimplifyFrameFixture(basis = 'plain', button = false): SymbolSimplifyRequest {
  const input = symbolSimplifyFixture(basis),
    definition = input.project.symbols![0];
  definition.timeline = {
    duration: 12,
    keys: [
      { frame: 4, shapes: structuredClone(definition.shapes) },
      { frame: 10, shapes: [] },
    ],
    frameScripts: [{ frame: 2, source: 'throw new Error("stored source must stay inert");' }],
    layers: [
      {
        id: 'detail',
        name: 'Detail',
        visible: true,
        locked: false,
        keys: [
          { frame: 0, shapes: structuredClone(definition.shapes) },
          { frame: 6, shapes: structuredClone(definition.shapes) },
          { frame: 9, shapes: [] },
        ],
      },
    ],
  };
  if (button) definition.buttonStates = { up: 0, over: 4, down: 6, hit: 10 };
  validateProject(input.project);
  return { ...input, location: { layerId: '@base', frame: 4 } };
}
