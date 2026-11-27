import { newLayer, newProject, type Vector } from '../../packages/document/src';
import { denseNestedTimeline } from './dense-nested-timeline';

export function denseDrawingProject(partial: boolean, crowd: boolean, layered: boolean) {
  const p = newProject();
  p.width = 600;
  p.height = 360;
  p.layers[0].drawingMode = partial ? 'merge' : 'object';
  const ink: Vector = {
    id: 'dense',
    kind: 'polygon',
    x: 80,
    y: 70,
    width: 160,
    height: 140,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    closed: true,
    points: Array.from({ length: 12000 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 12000;
      return { x: 80 + 80 * Math.cos(a), y: 70 + 70 * Math.sin(a) };
    }),
  };
  p.layers[0].keys[0].shapes = [
    {
      ...ink,
      id: 'back',
      kind: 'rectangle',
      x: 40,
      y: 40,
      width: 300,
      height: 220,
      fill: '#0000ff',
      points: [],
    },
    ink,
    {
      ...ink,
      id: 'front',
      kind: 'rectangle',
      x: 190,
      y: 100,
      width: 30,
      height: 20,
      fill: '#00ff00',
      points: [],
    },
  ];
  if (crowd)
    for (let i = 0; i < 1200; i++)
      p.layers[0].keys[0].shapes.push({
        ...ink,
        id: `crowd-${i}`,
        kind: i % 2 ? 'line' : 'rectangle',
        fillEnabled: i % 2 === 0,
        strokeWidth: i % 2 ? 1 : 0,
        x: 380 + (i % 40) * 4,
        y: 40 + Math.floor(i / 40) * 4,
        width: 2,
        height: 2,
        rotation: 7,
        points: [],
      });
  if (layered) {
    const background = newLayer('Stationary ink');
    background.drawingMode = 'merge';
    background.keys[0].shapes = p.layers[0].keys[0].shapes.slice(3).map(shape => ({
      ...shape, id: 'background-' + shape.id, y: shape.y + 160,
    }));
    p.layers.push(background);
  }
  return p;
}

export function addDenseTimeline(project: ReturnType<typeof denseDrawingProject>) {
  const timeline = denseNestedTimeline();
  project.duration = timeline.duration;
  project.symbols = timeline.symbols;
  project.layers.push(...timeline.layers);
}
