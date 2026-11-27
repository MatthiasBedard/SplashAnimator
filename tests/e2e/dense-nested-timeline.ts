import { newLayer, newProject, type Vector, type Project, type SymbolDefinition } from '../../packages/document/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';

export function denseNestedTimeline(): Project {
  const p = newProject();
  Object.assign(p, { width: 500, height: 270, duration: 480 });
  const tile: Vector = {
    id: 'tile', kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0,
    fill: '#00ccff', stroke: '#000000', strokeWidth: 0, points: [],
  };
  const leaf: SymbolDefinition = {
    id: 'leaf', name: 'Animated leaf', width: 10, height: 10, shapes: [tile],
    timeline: { duration: 4, keys: [
      { frame: 1, shapes: [{ ...tile, fill: '#ff0066' }] },
      { frame: 3, shapes: [{ ...tile, fill: '#ffcc00' }] },
    ] },
  };
  const nest = (id: string, child: SymbolDefinition): SymbolDefinition => ({
    id, name: id, width: 10, height: 10,
    shapes: [{ ...symbolInstance(child, 0, 0), id: id + '-child' }],
    timeline: { duration: 4, keys: [] },
  });
  const middle = nest('Middle', leaf), outer = nest('Outer', middle);
  p.symbols = [leaf, middle, outer];
  p.layers = Array.from({ length: 12 }, (_, row) => ({
    ...newLayer(`Track ${row + 1}`),
    drawingMode: 'object',
    keys: Array.from({ length: 48 }, (_, key) => ({
      frame: key * 10,
      shapes: Array.from({ length: 8 }, (_, column) => ({
        ...symbolInstance(outer, 25 + column * 34 + key % 4 * 12, 20 + row * 18),
        id: `placement-${row}-${column}`,
      })),
    })),
  }));
  return p;
}
