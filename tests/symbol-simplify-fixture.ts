import { newProject, type Vector } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import type { SymbolSimplifyRequest } from '../packages/geometry/src/symbol-simplify-request';
export function symbolSimplifyFixture(basis = 'plain'): SymbolSimplifyRequest {
  const project = newProject();
  const line: Vector = {
    id: 'line',
    kind: 'path',
    x: 10,
    y: 20,
    width: 240,
    height: 40,
    rotation: 0,
    points: Array.from({ length: 241 }, (_, i) => ({
      x: i,
      y: 20 * Math.sin(i / 40) + Math.sin(i / 3),
    })),
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#ff0000',
    strokeWidth: 3,
    groups: ['outer', 'inner'],
    pivot: { x: -30, y: 25 },
  };
  if (basis !== 'plain') line.transform = [basis === 'reflected' ? -1 : 1, 0.2, 0.3, 1];
  const paint: Vector = {
    ...structuredClone(line),
    id: 'paint',
    kind: 'polygon',
    points: [],
    groups: ['outer'],
    strokeWidth: 0,
    fillEnabled: true,
    fillRule: 'evenodd',
    contours: [40, 12].map((r) =>
      Array.from({ length: 120 }, (_, i) => ({
        x: 100 + r * Math.cos((i / 120) * Math.PI * 2),
        y: 100 + r * Math.sin((i / 120) * Math.PI * 2),
      })),
    ),
  };
  const other: Vector = {
    ...structuredClone(line),
    id: 'other',
    kind: 'rectangle',
    points: [],
    groups: undefined,
    strokeWidth: 0,
    fillEnabled: true,
  };
  project.symbols = [
    {
      id: 'art',
      name: 'Original art',
      width: 400,
      height: 240,
      defaultPlayback: 'loop',
      shapes: [line, paint, other],
    },
    { id: 'unrelated', name: 'Other', width: 400, height: 240, shapes: [structuredClone(other)] },
  ];
  project.layers[0].keys[0].shapes = [symbolInstance(project.symbols[0], 100, 50)];
  return { project, symbolId: 'art', selected: ['line'] };
}
