import { maskPaintChains } from '../../document/src/layer-masks';
import type { Project, Vector } from '../../document/src';
import { around, matrix } from '../../geometry/src/affine';
import type { Command } from '../../geometry/src/drawing';
import { wrapText } from '../../geometry/src/text-layout';
import type { SymbolPaintItem } from '../../geometry/src/symbols';
import { renderData } from '../../stage/src/render-data';

export type VectorStillTrack = { id: string; visible: boolean; items: SymbolPaintItem[] };
type Masks = NonNullable<Project['layerMasks']>;
type Frame = Pick<Project, 'width' | 'height' | 'background' | 'assets' | 'layerMasks'>;

function fills(shape: Vector) {
  return (
    shape.fillEnabled !== false &&
    (shape.kind === 'text' ||
      !!shape.closed ||
      ['rectangle', 'ellipse', 'polygon', 'brush'].includes(shape.kind))
  );
}

function strokes(shape: Vector) {
  return shape.kind !== 'brush' && shape.strokeWidth > 0;
}

function xml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
}

function svgPath(commands: Command[]) {
  return commands.map(([kind, ...coordinates]) => `${kind}${coordinates.join(' ')}`).join(' ');
}

export function encodeSvg(
  frame: Frame,
  tracks: VectorStillTrack[],
  transparent: boolean,
  measure: CanvasRenderingContext2D,
) {
  const defs: string[] = [];
  let nextId = 0;
  function paintFill(shape: Vector) {
    if (!fills(shape)) return 'none';
    if (shape.bitmap) {
      const bitmap = shape.bitmap;
      const data = frame.assets.find((asset) => asset.id === bitmap.assetId)?.bitmap?.dataUrl;
      if (!data) throw Error('SVG bitmap fill is missing its source image.');
      const id = `paint-${++nextId}`;
      if (!bitmap.repeat)
        throw Error(
          'SVG export does not support non-repeating bitmap fills. Choose a raster format.',
        );
      const transform = [...(bitmap.transform ?? [1, 0, 0, 1]), bitmap.x, bitmap.y];
      defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${bitmap.width}" height="${bitmap.height}" patternTransform="matrix(${transform.join(' ')})"><image width="${bitmap.width}" height="${bitmap.height}" preserveAspectRatio="none" href="${xml(data)}"/></pattern>`,
      );
      return `url(#${id})`;
    }
    const gradient = shape.gradient;
    if (!gradient) return shape.fill;
    const id = `paint-${++nextId}`;
    const { x, y } = gradient.from;
    const tag = gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient';
    const coordinates =
      gradient.kind === 'linear'
        ? `x1="${x}" y1="${y}" x2="${gradient.to.x}" y2="${gradient.to.y}"`
        : `cx="${x}" cy="${y}" r="${Math.max(0.001, Math.hypot(gradient.to.x - x, gradient.to.y - y))}"`;
    const transform = gradient.transform
      ? ` gradientTransform="matrix(${around({ x, y }, ...gradient.transform).join(' ')})"`
      : '';
    const stops = gradient.stops
      .map(
        (stop) =>
          `<stop offset="${stop.offset}" stop-color="${stop.color}" stop-opacity="${stop.opacity ?? 1}"/>`,
      )
      .join('');
    defs.push(
      `<${tag} id="${id}" gradientUnits="userSpaceOnUse" ${coordinates}${transform}>${stops}</${tag}>`,
    );
    return `url(#${id})`;
  }

  function paint(item: SymbolPaintItem): string {
    if (item.kind === 'masked-symbol') {
      if (item.blurRadius || item.tint?.amount || item.blendMode)
        throw Error(
          'SVG export does not support grouped blur, tint, or blend effects. Choose a raster format.',
        );
      const layers = item.layers.map((layer) => ({
        id: layer.id,
        visible: layer.visible,
        items: layer.items,
      }));
      return `<g opacity="${item.opacity}">${paintTracks(layers, item.masks)}</g>`;
    }
    if (item.opacity === 0) return '';
    if (
      item.blurRadius ||
      item.tint?.amount ||
      item.blendMode ||
      item.groupBlur?.radius ||
      item.groupBlur?.tint?.amount ||
      item.groupBlur?.blendMode
    )
      throw Error(
        'SVG export does not support blur, tint, or blend effects. Choose a raster format.',
      );
    const shape = renderData(item);
    if (shape.pressurePaint)
      throw Error('SVG export does not support pressure opacity brushes. Choose a raster format.');
    const opacity = shape.opacity ?? 1;
    const fill = paintFill({ ...item, fill: shape.fill, gradient: shape.gradient });
    const stroke = strokes(item) ? shape.stroke : 'none';
    const attributes = `fill="${fill}" fill-opacity="${opacity}" fill-rule="${shape.fillRule ?? 'nonzero'}" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${shape.strokeWidth}" stroke-linecap="${shape.strokeCap ?? 'round'}" stroke-linejoin="${shape.strokeJoin ?? 'round'}" stroke-miterlimit="4"`;
    const transform = matrix(item).join(' ');
    if (item.kind !== 'text' || !item.text)
      return `<path transform="matrix(${transform})" d="${svgPath(shape.commands)}" ${attributes}/>`;
    const text = item.text;
    if (
      text.runs?.length ||
      frame.assets.some(
        (asset) => asset.font && text.font.toLowerCase().includes(asset.font.family.toLowerCase()),
      )
    )
      throw Error(
        'SVG export does not support rich text or embedded fonts. Choose a raster format.',
      );
    const sx = text.scaleX ?? 1,
      sy = text.scaleY ?? 1;
    if (!sx || !sy) return '';
    measure.font = `${text.italic ? 'italic ' : ''}${text.bold ? 'bold ' : ''}${text.size}px ${text.font}`;
    measure.direction = text.direction ?? 'ltr';
    measure.letterSpacing = `${text.letterSpacing ?? 0}px`;
    measure.wordSpacing = `${text.wordSpacing ?? 0}px`;
    measure.fontKerning = text.kerning ?? 'auto';
    measure.textBaseline = 'top';
    const x =
      text.align === 'center' ? item.width / sx / 2 : text.align === 'right' ? item.width / sx : 0;
    const anchor =
      text.align === 'center'
        ? 'middle'
        : (text.align === 'right') !== (text.direction === 'rtl')
          ? 'end'
          : 'start';
    const lines = wrapText(text.content, text.wrapWidth, (line) => measure.measureText(line).width);
    const rows = lines
      .map((line, index) => {
        const baseline = measure.measureText(line || 'M').alphabeticBaseline;
        return `<tspan x="${x}" y="${baseline + index * text.size * (text.lineHeight ?? 1.2)}">${xml(line)}</tspan>`;
      })
      .join('');
    return `<text transform="matrix(${transform}) scale(${sx} ${sy})" ${attributes} paint-order="stroke fill" font-family="${xml(text.font)}" font-size="${text.size}" font-weight="${text.bold ? 'bold' : 'normal'}" font-style="${text.italic ? 'italic' : 'normal'}" text-anchor="${anchor}" direction="${text.direction ?? 'ltr'}" letter-spacing="${text.letterSpacing ?? 0}" word-spacing="${text.wordSpacing ?? 0}" xml:space="preserve">${rows}</text>`;
  }

  function paintTracks(layers: VectorStillTrack[], masks: Masks): string {
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const { chains, members } = maskPaintChains(masks);
    const layerPaint = (layer?: VectorStillTrack) =>
      layer?.visible ? layer.items.map(paint).join('') : '';
    return layers
      .map((layer) => {
        if (members.has(layer.id)) return '';
        const passes = chains.get(layer.id);
        if (!passes) return layerPaint(layer);
        let contents = '';
        for (const pass of passes) {
          const mask = layerPaint(byId.get(pass.source));
          const id = `mask-${++nextId}`;
          defs.push(
            `<mask id="${id}" x="0" y="0" width="${frame.width}" height="${frame.height}" maskUnits="userSpaceOnUse" style="mask-type:alpha">${mask}</mask>`,
          );
          contents = `<g mask="url(#${id})">${contents}${pass.members.map((id) => layerPaint(byId.get(id))).join('')}</g>`;
        }
        return contents;
      })
      .join('');
  }

  const artwork = paintTracks(tracks, frame.layerMasks ?? []);
  const background = transparent
    ? ''
    : `<rect width="100%" height="100%" fill="${frame.background}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}" overflow="hidden">\n<defs>${defs.join('')}</defs>\n${background}${artwork}\n</svg>\n`;
}

function psNumber(value: number) {
  // PostScript real literals use an uppercase exponent.
  return value.toString().replace('e', 'E');
}

function psColor(color: string) {
  return (
    [1, 3, 5]
      .map((index) => psNumber(parseInt(color.slice(index, index + 2), 16) / 255))
      .join(' ') + ' setrgbcolor'
  );
}

function psPath(commands: Command[]) {
  const verbs = { M: 'moveto', L: 'lineto', C: 'curveto', Z: 'closepath' };
  return (
    'newpath\n' +
    commands
      .map(([kind, ...coordinates]) => [...coordinates.map(psNumber), verbs[kind]].join(' '))
      .join('\n')
  );
}

export function encodeEps(frame: Frame, tracks: VectorStillTrack[], transparent: boolean) {
  if (frame.layerMasks?.length)
    throw Error('EPS does not support layer masks. Choose SVG or a raster format.');
  const lines = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(frame.width)} ${Math.ceil(frame.height)}`,
    '%%LanguageLevel: 2',
    '%%EndComments',
    'gsave',
    `0 ${psNumber(frame.height)} translate`,
    '1 -1 scale',
    `0 0 ${psNumber(frame.width)} ${psNumber(frame.height)} rectclip`,
  ];
  if (!transparent)
    lines.push(
      psColor(frame.background),
      `0 0 ${psNumber(frame.width)} ${psNumber(frame.height)} rectfill`,
    );
  for (const track of tracks) {
    if (!track.visible) continue;
    for (const item of track.items) {
      if (item.kind === 'masked-symbol')
        throw Error(
          'EPS does not support masks or grouped effects. Choose SVG or a raster format.',
        );
      if (item.opacity === 0) continue;
      const shape = renderData(item);
      if (
        shape.kind === 'text' ||
        shape.gradient ||
        shape.bitmap ||
        shape.pressurePaint ||
        (shape.opacity ?? 1) !== 1 ||
        shape.blurRadius ||
        shape.tint?.amount ||
        shape.blendMode ||
        item.groupBlur?.radius ||
        item.groupBlur?.tint?.amount ||
        item.groupBlur?.blendMode
      )
        throw Error(
          'EPS supports solid, opaque vector paths. Choose SVG or a raster format for other artwork.',
        );
      lines.push(
        'gsave',
        `[${matrix(item).map(psNumber).join(' ')}] concat`,
        psPath(shape.commands),
      );
      if (fills(item))
        lines.push(
          'gsave',
          psColor(shape.fill),
          shape.fillRule === 'evenodd' ? 'eofill' : 'fill',
          'grestore',
        );
      if (strokes(item)) {
        const caps = { butt: 0, round: 1, square: 2 },
          joins = { miter: 0, round: 1, bevel: 2 };
        lines.push(
          psColor(shape.stroke),
          `${psNumber(shape.strokeWidth)} setlinewidth`,
          `${caps[shape.strokeCap ?? 'round']} setlinecap`,
          `${joins[shape.strokeJoin ?? 'round']} setlinejoin`,
          '4 setmiterlimit',
          'stroke',
        );
      }
      lines.push('grestore');
    }
  }
  lines.push('grestore', '%%EOF', '');
  return lines.join('\n');
}
