import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import type { SymbolSimplifyRequest } from '../packages/geometry/src/symbol-simplify-request';
/** Two relative units within one original outer group. */
export function isolatedSymbolSimplifyFixture(basis = 'plain'): SymbolSimplifyRequest {
  const input = symbolSimplifyFixture(basis),
    shapes = input.project.symbols![0].shapes;
  shapes.splice(1, 0, { ...structuredClone(shapes[0]), id: 'partner', y: 100 });
  return { ...input, ancestry: ['outer'] };
}
