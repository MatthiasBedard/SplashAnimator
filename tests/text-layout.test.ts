import { it, expect } from 'vitest';
import { newProject, id, validateProject, migrateProject } from '../packages/document/src';
it('validates text spacing and preserves legacy default layout', () => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [
    {
      id: id(),
      kind: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      text: {
        content: 'Text',
        font: 'Arial, sans-serif',
        size: 30,
        bold: false,
        italic: false,
        align: 'left',
        lineHeight: 2,
        letterSpacing: 4,
        wordSpacing: 12,
        direction: 'rtl',
        kerning: 'normal',
      },
    },
  ];
  expect(() => validateProject(p)).not.toThrow();
  expect(migrateProject({ ...p, schemaVersion: 3 }).schemaVersion).toBe(59);
  const t = p.layers[0].keys[0].shapes[0].text!;
  t.wordSpacing = Infinity;
  expect(() => validateProject(p)).toThrow('text');
  t.wordSpacing = 0;
  Object.assign(t, { direction: 'invalid' });
  expect(() => validateProject(p)).toThrow('text');
  t.direction = 'ltr';
  Object.assign(t, { kerning: 'invalid' });
  expect(() => validateProject(p)).toThrow('text');
  t.kerning = 'auto';
  p.layers[0].keys[0].shapes[0].text!.lineHeight = 0;
  expect(() => validateProject(p)).toThrow('text');
});
