import { newProject, symbolLayers, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import type { GroupAuthoringSource } from '../packages/animation/src/group-motion-owner';
import type { SymbolAuthoringSource } from '../packages/animation/src/symbol-motion-owner';
export function sampledAttachedFillFixture(
  curved = false,
  configure?: (line: Vector, fill: Vector) => void,
): GroupAuthoringSource {
  const project = newProject();
  project.width = 400;
  project.height = 240;
  project.duration = 12;
  const line: Vector = {
    id: 'line',
    kind: 'bezier',
    x: 40,
    y: 60,
    width: 200,
    height: 100,
    rotation: 0,
    points: [],
    nodes: [
      { x: 0, y: 0, ...(curved ? { out: { x: 60, y: -30 } } : {}) },
      { x: 200, y: 0, ...(curved ? { in: { x: 140, y: -30 } } : {}) },
    ],
    fill: '#000000',
    fillEnabled: false,
    stroke: '#223344',
    strokeWidth: 4,
    drawingMode: 'merge',
  };
  const fill: Vector = {
    ...structuredClone(line),
    id: 'paint',
    kind: 'polygon',
    nodes: undefined,
    closed: true,
    fillRule: 'evenodd',
    fill: '#ff0000',
    fillEnabled: true,
    strokeWidth: 0,
    contours: [
      structuredClone(line.nodes!).concat([
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ]),
    ],
    pivot: { x: -15, y: 20 },
  };
  configure?.(line, fill);
  const layer = project.layers[0];
  layer.id = 'base';
  layer.drawingMode = 'object';
  layer.keys = [
    { frame: 0, shapes: [fill, line] },
    { frame: 8, shapes: [fill, line].map((s) => ({ ...structuredClone(s), x: s.x + 80 })) },
    { frame: 10, shapes: [] },
  ];
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear', { nodes: true, affine: true });
  return { project, revision: 0, frame: 4 };
}
export function isolatedSampledAttachedFillFixture(
  curved = false,
  configure?: (line: Vector, fill: Vector) => void,
): SymbolAuthoringSource {
  const source = sampledAttachedFillFixture(curved, configure),
    track = source.project.layers[0],
    definition = {
      id: 'art',
      name: 'Sampled attached',
      width: 400,
      height: 240,
      shapes: track.keys[0].shapes,
      buttonStates: { up: 0, over: 4, down: 8, hit: 10 },
      timeline: { duration: 12, keys: track.keys.slice(1), motionSpans: track.motionSpans },
    };
  return { definition, symbols: [definition], revision: 0, frame: 4 };
}
export const sampledFillShapes = (source: SymbolAuthoringSource) =>
  symbolLayers(source.definition)[0].keys.find((k) => k.frame === 4)!.shapes;
