import type { BezierNode, Point, Vector } from '../../../packages/document/src';
import { decodeEmbeddedFont, type EmbeddedFont } from '../../../packages/document/src/embedded-font';
import { openTrueTypeOutlines, type GlyphRing } from '../../../packages/geometry/src/true-type-outlines';
import { fontFamilyForRendering } from '../../../packages/geometry/src/font-family';
import { wrapText } from '../../../packages/geometry/src/text-layout';
import { canvasPath, renderData } from '../../../packages/stage/src/render-data';
import { validateMotionContourContacts } from '../../../packages/animation/src/motion-contact';
import { validateMotionCurveSelfContacts } from '../../../packages/animation/src/motion-curve-self-contact';

function certifyParity(ctx: CanvasRenderingContext2D, outline: Vector, rings: GlyphRing[]) {
  validateMotionContourContacts(outline, outline);
  const proof = {
    ...outline,
    contours: outline.contours!.map(ring => ring.map((node, index): BezierNode => {
      const previous = ring[(index + ring.length - 1) % ring.length], next = ring[(index + 1) % ring.length];
      const third = (other: Point) => ({
        x: node.x + (other.x - node.x) / 3,
        y: node.y + (other.y - node.y) / 3,
      });
      return {
        ...node,
        in: node.in ?? (previous.out ? { x: node.x, y: node.y } : third(previous)),
        out: node.out ?? (next.in ? { x: node.x, y: node.y } : third(next)),
      };
    })),
  };
  validateMotionCurveSelfContacts(proof, proof);
  // Pair certification above excludes contacts, so testing a boundary point
  // against the other rings identifies its containing contours unambiguously.
  const paths = outline.contours!.map(ring => canvasPath(renderData({ ...outline, contours: [ring] }))!);
  ctx.save();
  try {
    ctx.resetTransform();
    for (const [index, ring] of outline.contours!.entries()) {
      const node = ring[0];
      let parents = 0, winding = 0;
      for (const [other, path] of paths.entries()) {
        if (other === index || !ctx.isPointInPath(path, node.x, node.y)) continue;
        parents++;
        winding += rings[other].winding;
      }
      if ((winding !== 0) !== (parents % 2 === 1) ||
          (winding + rings[index].winding !== 0) !== (parents % 2 === 0))
        throw Error('The glyph winding cannot be represented without changing its holes.');
    }
  } finally { ctx.restore(); }
}

export function outlineEmbeddedText(ctx: CanvasRenderingContext2D, source: Vector, font: EmbeddedFont): Vector {
  const text = source.text;
  if (source.kind !== 'text' || !text || text.dynamicBinding || text.input || text.runs?.length ||
      text.bold || text.italic || text.direction === 'rtl' || text.letterSpacing || text.wordSpacing ||
      source.strokeWidth || source.fillEnabled === false)
    throw Error('Outlining supports static, unstyled left-to-right text with fill.');
  if (!text.content.trim() || !/^[\x20-\x7e\ue000-\uf8ff\n]+$/.test(text.content))
    throw Error('Outlining supports basic Latin and private-use glyphs in the embedded face.');
  if (text.font.split(',')[0].trim().toLowerCase() !== font.family.toLowerCase() || !font.dataUrl)
    throw Error('Choose an embedded project font as the first text family to outline.');
  if (![...document.fonts].some(face => face.status === 'loaded' && face.family === font.family))
    throw Error('Wait for the embedded project font to finish loading.');
  const design = openTrueTypeOutlines(decodeEmbeddedFont(font.dataUrl));
  const scale = text.size / design.units;
  const xScale = text.scaleX ?? 1, yScale = text.scaleY ?? 1;
  const rings: GlyphRing[] = [];
  const contours: BezierNode[][] = [];
  ctx.save();
  try {
    ctx.font = `${text.size}px ${fontFamilyForRendering(text.font)}`;
    ctx.fontKerning = text.kerning ?? 'auto';
    ctx.letterSpacing = '0px';
    ctx.wordSpacing = '0px';
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    const width = (value: string) => ctx.measureText(value).width;
    const lines = wrapText(text.content, text.wrapWidth, width);
    const widths = new Map<string, number>();
    const advance = (char: string) => {
      if (!widths.has(char)) widths.set(char, width(char));
      return widths.get(char)!;
    };
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      ctx.textBaseline = 'top';
      const top = ctx.measureText(line);
      ctx.textBaseline = 'alphabetic';
      const baseline = index * text.size * (text.lineHeight ?? 1.2) +
        ctx.measureText(line).actualBoundingBoxAscent - top.actualBoundingBoxAscent;
      const align = text.align === 'center' ? (source.width / xScale - top.width) / 2 :
        text.align === 'right' ? source.width / xScale - top.width : 0;
      let last = '', pen = 0;
      for (const char of line) {
        const glyph = design.glyph(char.charCodeAt(0)), step = advance(char);
        if (Math.abs(step - glyph.advance * scale) > 1 / 32)
          throw Error('The resolved font metrics do not match the editable glyph.');
        if (last) pen += width(last + char) - advance(last) - step;
        const map = (point: Point) => ({
          x: (align + pen + point.x * scale) * xScale,
          y: (baseline - point.y * scale) * yScale,
        });
        for (const ring of glyph.rings) {
          if (contours.length >= 10000) throw Error('Text outline exceeds the project contour limit.');
          rings.push(ring);
          contours.push(ring.nodes.map(node => ({
            ...map(node),
            ...(node.in ? { in: map(node.in) } : {}),
            ...(node.out ? { out: map(node.out) } : {}),
          })));
        }
        pen += step;
        last = char;
      }
      if (Math.abs(pen - top.width) > 1 / 32) throw Error('The selected text uses unsupported shaping.');
    }
  } finally { ctx.restore(); }
  if (!contours.length) throw Error('The selected text has no editable glyph outlines.');
  const result: Vector = { ...structuredClone(source), kind: 'polygon', points: [], contours, fillRule: 'evenodd', closed: true };
  delete result.text;
  certifyParity(ctx, result, rings);
  return result;
}
