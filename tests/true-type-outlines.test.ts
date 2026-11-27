import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { openTrueTypeOutlines, quadraticGlyphRing } from '../packages/geometry/src/true-type-outlines';

test('preserves implied quadratic anchors and handles including the closing segment', () => {
  const ring = quadraticGlyphRing([
    { x: 0, y: 0, onCurve: false }, { x: 20, y: 0, onCurve: false },
    { x: 20, y: 20, onCurve: false }, { x: 0, y: 20, onCurve: false },
  ]);
  expect(ring.winding).toBe(1);
  expect(ring.nodes).toHaveLength(4);
  expect(ring.nodes[0]).toMatchObject({ x: 10, y: 0, in: { y: 0 }, out: { y: 0 } });
  expect(ring.nodes[0].in!.x).toBeCloseTo(10/3);
  expect(ring.nodes[0].out!.x).toBeCloseTo(50/3);
  expect(ring.nodes[3].out!.y).toBeCloseTo(10/3);
});

test('reads real TrueType curves and opposing hole winding, and rejects missing glyphs', async () => {
  const bytes = await readFile('node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf');
  const font = openTrueTypeOutlines(bytes);
  const glyph = font.glyph(0xeabc);
  expect(glyph.advance).toBeGreaterThan(0);
  expect(glyph.rings.map(ring => ring.winding).sort()).toEqual([-1, 1]);
  expect(glyph.rings.every(ring => ring.nodes.some(node => node.in && node.out))).toBe(true);
  expect(() => font.glyph(0xfeff)).toThrow(/does not contain/);
});

test.skipIf(process.platform !== 'win32')('admits a regular face with horizontal positioning and refuses glyph displacement', async ({ skip }) => {
  const bytes = await readFile(`${process.env.WINDIR ?? 'C:/Windows'}/Fonts/trebuc.ttf`).catch(() => undefined);
  if (!bytes) {
    skip('Uses a locally installed Windows TrueType fixture.');
    return;
  }
  const font = openTrueTypeOutlines(bytes);
  expect(font.glyph(65).rings).toHaveLength(2);
  expect(font.glyph(86).rings).toHaveLength(1);
  const changed = Buffer.from(bytes);
  const entry = Array.from({ length: changed.readUInt16BE(4) }, (_, i) => 12 + 16 * i)
    .find(i => changed.toString('ascii', i, i + 4) === 'GPOS')!;
  const gpos = changed.readUInt32BE(entry + 8);
  const list = gpos + changed.readUInt16BE(gpos + 8);
  const lookup = list + changed.readUInt16BE(list + 2);
  const sub = lookup + changed.readUInt16BE(lookup + 6);
  expect(changed.readUInt16BE(sub + 4)).toBe(4);
  changed.writeUInt16BE(1, sub + 4); // xPlacement occupies the same bytes as xAdvance.
  expect(() => openTrueTypeOutlines(changed).glyph(65)).toThrow(/positioning outside/);
});
