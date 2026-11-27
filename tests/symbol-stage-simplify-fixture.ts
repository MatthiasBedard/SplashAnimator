import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import { symbolSimplifyFrameFixture } from './symbol-simplify-frame-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
import {
  nestedSymbolEditContext,
  symbolEditContext,
} from '../packages/geometry/src/symbol-context';
import type { SymbolStagePath } from '../apps/editor/src/symbol-stage-ownership';
export function symbolStageSimplifyFixture(nested = false, animated = false, depth = 1) {
  const input = animated ? symbolSimplifyFrameFixture('plain', true) : symbolSimplifyFixture(),
    p = input.project,
    leaf = p.symbols![0];
  if (animated) leaf.buttonStates!.up = 4;
  p.width = 500;
  p.height = 290;
  const child = symbolInstance(leaf, 360, 0);
  child.transform = [-1, 0.1, 0.2, 1];
  if (animated) child.symbolPlayback = { mode: 'single', firstFrame: 4 };
  const parent = { id: 'parent', name: 'Stage parent', width: 400, height: 240, shapes: [child] };
  let top = parent;
  const ancestors = [parent];
  if (nested) {
    for (let i = 1; i < depth; i++) {
      top = {
        id: `parent${i + 1}`,
        name: `Stage ancestor ${i + 1}`,
        width: 400,
        height: 240,
        shapes: [symbolInstance(top, 0, 0)],
      };
      ancestors.unshift(top);
    }
    p.symbols!.push(...ancestors);
  }
  const root = symbolInstance(nested ? top : leaf, 40, 20);
  if (animated && !nested) root.symbolPlayback = { mode: 'single', firstFrame: 4 };
  p.layers[0].keys[0].shapes = [root];
  p.layers.push({
    id: 'reference',
    name: 'Reference',
    visible: true,
    locked: true,
    keys: [
      {
        frame: 0,
        shapes: [
          {
            id: 'blue',
            kind: 'rectangle',
            x: 450,
            y: 230,
            width: 20,
            height: 20,
            rotation: 0,
            points: [],
            fill: '#0000ff',
            stroke: '#000000',
            strokeWidth: 0,
          },
        ],
      },
    ],
  });
  const path: SymbolStagePath = {
    layerId: p.layers[0].id,
    instanceId: root.id,
    frame: 0,
    children: nested ? ancestors.map((a) => ({ instanceId: a.shapes[0].id })) : [],
  };
  let context = symbolEditContext(p, path.layerId, root.id, 0);
  if (nested)
    for (const ancestor of ancestors)
      context = nestedSymbolEditContext(context, ancestor, ancestor.shapes[0].id, p.symbols!);
  return { input, path, context };
}
