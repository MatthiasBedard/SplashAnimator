import { expect, test } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { encodeEps, encodeSvg } from '../packages/export-web/src/still-vector';

const shape: Vector = {
  id: 'art', kind: 'rectangle', x: 4, y: 6, width: 12, height: 14, rotation: 0,
  fill: '#ff0000', stroke: '#000000', strokeWidth: 2, points: [],
};

function tracks(item: Vector) {
  return [{ id: 'artwork', visible: true, items: [item] }];
}

test('SVG preserves vector paths, editable gradients and opacity without painting a transparent page', () => {
  const project = newProject();
  const item: Vector = {
    ...shape, opacity: 0.4,
    gradient: {
      kind: 'linear', from: { x: 0, y: 0 }, to: { x: 12, y: 0 },
      stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
    },
  };
  const result = encodeSvg(project, tracks(item), true, {} as CanvasRenderingContext2D);
  expect(result).toContain('<linearGradient');
  expect(result).toContain('<path transform="matrix(1 0 0 1 4 6)"');
  expect(result).toContain('fill-opacity="0.4"');
  expect(result).not.toContain('<rect');
  expect(result).not.toContain('<image');
});

test('EPS leaves an unpainted page when requested and rejects artwork it cannot preserve as vectors', () => {
  const project = newProject();
  const transparent = encodeEps(project, tracks(shape), true);
  expect(transparent).toContain('[1 0 0 1 4 6] concat');
  expect(transparent).toContain('moveto');
  expect(transparent).toContain('stroke');
  expect(transparent).not.toContain('rectfill');
  expect(encodeEps(project, tracks(shape), false)).toContain('rectfill');
  expect(() => encodeEps(project, tracks({ ...shape, opacity: 0.4 }), false)).toThrow('opaque vector paths');
});
