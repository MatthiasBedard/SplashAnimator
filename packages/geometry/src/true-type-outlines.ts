import { checkEmbeddableFont } from '../../document/src/embedded-font';
import type { BezierNode, Point } from '../../document/src';

type FontPoint = Point & { onCurve: boolean };
export type GlyphRing = { nodes: BezierNode[]; winding: number };

const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const handle = (anchor: Point, control: Point) => ({
  x: anchor.x + 2 * (control.x - anchor.x) / 3,
  y: anchor.y + 2 * (control.y - anchor.y) / 3,
});

export function quadraticGlyphRing(points: FontPoint[]): GlyphRing {
  const expanded: FontPoint[] = [];
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length];
    expanded.push(point);
    if (!point.onCurve && !next.onCurve) expanded.push({ ...middle(point, next), onCurve: true });
  }
  const anchors = expanded.flatMap((point, index) => point.onCurve ? [index] : []);
  if (anchors.length < 3) throw Error('The glyph contour has too few editable anchors.');
  const nodes: BezierNode[] = anchors.map(index => ({ x: expanded[index].x, y: expanded[index].y }));
  let area = 0;
  for (const [index, anchor] of anchors.entries()) {
    const a = nodes[index], b = nodes[(index + 1) % nodes.length];
    const control = expanded[(anchor + 1) % expanded.length];
    if (control.onCurve) area += cross(a, b) / 2;
    else {
      a.out = handle(a, control);
      b.in = handle(b, control);
      area += (2 * cross(a, control) + cross(a, b) + 2 * cross(control, b)) / 6;
    }
  }
  if (!area) throw Error('The glyph contour has unresolved winding.');
  return { nodes, winding: Math.sign(area) };
}

function readSimpleGlyph(glyph: DataView, leftBearing: number): GlyphRing[] {
  const contourCount = glyph.getInt16(0);
  if (contourCount < 0) throw Error('This font uses a composite glyph, which cannot be outlined yet.');
  if (!contourCount) return [];
  const stops = Array.from({ length: contourCount }, (_, i) => glyph.getUint16(10 + i * 2) + 1);
  const count = stops[stops.length - 1];
  if (stops.some((end, i) => i > 0 && end <= stops[i - 1])) throw Error('Invalid TrueType contour points.');
  let cursor = 10 + contourCount * 2;
  cursor += 2 + glyph.getUint16(cursor); // Skip native raster hint instructions.
  const flags: number[] = [];
  while (flags.length < count) {
    const flag = glyph.getUint8(cursor++);
    const repeat = flag & 8 ? glyph.getUint8(cursor++) : 0;
    if (flags.length + repeat >= count) throw Error('Invalid TrueType repeated points.');
    for (let i = 0; i <= repeat; i++) flags.push(flag);
  }
  const coordinates = (short: number, same: number) => {
    let coordinate = 0;
    return flags.map(flag => {
      if (flag & short) coordinate += (flag & same ? 1 : -1) * glyph.getUint8(cursor++);
      else if (!(flag & same)) { coordinate += glyph.getInt16(cursor); cursor += 2; }
      return coordinate;
    });
  };
  const x = coordinates(2, 16), y = coordinates(4, 32);
  const dx = leftBearing - glyph.getInt16(2);
  const points = flags.map((flag, i) => ({ x: x[i] + dx, y: y[i], onCurve: !!(flag & 1) }));
  return stops.map((end, i) => quadraticGlyphRing(points.slice(stops[i - 1] ?? 0, end)));
}

function glyphIndex(cmap: DataView, code: number) {
  const format = cmap.getUint16(0);
  if (format === 12) {
    let low = 0, high = cmap.getUint32(12);
    if (16 + high * 12 > cmap.byteLength) throw Error('Invalid TrueType character map.');
    while (low < high) {
      const middle = Math.floor((low + high) / 2), i = 16 + middle * 12;
      const start = cmap.getUint32(i), end = cmap.getUint32(i + 4);
      if (code < start) high = middle;
      else if (code > end) low = middle + 1;
      else return cmap.getUint32(i + 8) + code - start;
    }
    return 0;
  }
  const segments = cmap.getUint16(6) / 2;
  if (!Number.isInteger(segments) || !segments || 16 + segments * 8 > cmap.byteLength)
    throw Error('Invalid TrueType character map.');
  let low = 0, high = segments;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (code <= cmap.getUint16(14 + middle * 2)) high = middle;
    else low = middle + 1;
  }
  if (low === segments) return 0;
  const start = cmap.getUint16(16 + segments * 2 + low * 2);
  if (code < start) return 0;
  const delta = cmap.getInt16(16 + segments * 4 + low * 2);
  const range = 16 + segments * 6 + low * 2;
  const offset = cmap.getUint16(range);
  if (!offset) return (code + delta) & 0xffff;
  const glyph = cmap.getUint16(range + offset + (code - start) * 2);
  return glyph ? (glyph + delta) & 0xffff : 0;
}

// Canvas uses normal font variants. Keep required features and any unknown
// feature conservative while skipping the explicitly opt-in stylistic ones.
const optInFeature = /^(?:afrc|c2sc|cswh|dlig|dnom|frac|hist|hlig|lnum|numr|onum|ordn|ornm|pnum|salt|sinf|smcp|ss(?:0[1-9]|1[0-9]|20)|subs|sups|swsh|titl|tnum|unic)$/;
const tableTag = (table: DataView, offset: number) =>
  String.fromCharCode(table.getUint8(offset), table.getUint8(offset + 1),
    table.getUint8(offset + 2), table.getUint8(offset + 3));

function defaultLayoutLookups(table: DataView) {
  const scriptList = table.getUint16(4), featureList = table.getUint16(6);
  const scripts = table.getUint16(scriptList), numFeatures = table.getUint16(featureList);
  const languages = new Set<number>(), features = new Map<number, boolean>();
  const visitedScripts = new Set<number>();
  let work = 0;
  for (let i = 0; i < scripts; i++) {
    const entry = scriptList + 2 + 6 * i;
    const tag = tableTag(table, entry);
    if (tag !== 'latn' && tag !== 'DFLT' && tag !== 'dflt') continue;
    const script = scriptList + table.getUint16(entry + 4), fallback = table.getUint16(script);
    if (visitedScripts.has(script)) continue;
    visitedScripts.add(script);
    if (fallback) languages.add(script + fallback);
    const count = table.getUint16(script + 2);
    work += count + 1;
    if (work > table.byteLength / 2) throw Error('TrueType script records exceed their work budget.');
    for (let j = 0; j < count; j++) languages.add(script + table.getUint16(script + 8 + 6 * j));
  }
  work = 0;
  for (const language of languages) {
    const required = table.getUint16(language + 2), count = table.getUint16(language + 4);
    if (required !== 0xffff) features.set(required, true);
    work += count + 1;
    if (work > table.byteLength / 2) throw Error('TrueType language records exceed their work budget.');
    for (let i = 0; i < count; i++) {
      const index = table.getUint16(language + 6 + 2 * i);
      if (!features.has(index)) features.set(index, false);
    }
  }
  const lookups = new Set<number>();
  work = 0;
  for (const [index, required] of features) {
    if (index >= numFeatures) throw Error('Invalid TrueType layout feature.');
    const entry = featureList + 2 + 6 * index;
    if (!required && optInFeature.test(tableTag(table, entry))) continue;
    const feature = featureList + table.getUint16(entry + 4), count = table.getUint16(feature + 2);
    work += count + 1;
    if (work > table.byteLength / 2) throw Error('TrueType feature records exceed their work budget.');
    for (let i = 0; i < count; i++) lookups.add(table.getUint16(feature + 4 + 2 * i));
  }
  return lookups;
}

function* layoutSubtables(table: DataView, extension: number) {
  if (table.getUint16(0) !== 1 || table.getUint16(2) > 1)
    throw Error('Unsupported TrueType layout table version.');
  const lookupList = table.getUint16(8), lookups = table.getUint16(lookupList);
  // An offset is at least two bytes. Shared records cannot multiply traversal
  // work beyond the size of the admitted font table.
  let remaining = Math.floor(table.byteLength / 2);
  for (const i of defaultLayoutLookups(table)) {
    if (i >= lookups) throw Error('Invalid TrueType layout lookup.');
    const lookup = lookupList + table.getUint16(lookupList + 2 + 2 * i);
    const type = table.getUint16(lookup), flags = table.getUint16(lookup + 2);
    const count = table.getUint16(lookup + 4);
    remaining -= count + 1;
    if (remaining < 0) throw Error('TrueType layout table exceeds its lookup work budget.');
    for (let j = 0; j < count; j++) {
      let offset = lookup + table.getUint16(lookup + 6 + 2 * j), effective = type;
      if (type === extension) {
        if (table.getUint16(offset) !== 1) throw Error('Invalid TrueType extension lookup.');
        effective = table.getUint16(offset + 2);
        offset += table.getUint32(offset + 4);
      }
      yield { type: effective, flags, offset, format: table.getUint16(offset) };
    }
  }
}

function substitutionCoverages(gsub: DataView): number[] {
  const result: number[] = [];
  for (const { type, offset, format } of layoutSubtables(gsub, 7)) {
    if (type === 5 || type === 6) {
      result.push(contextCoverage(gsub, offset, format, type === 6));
      continue;
    }
    if (![1, 2, 3, 4, 8].includes(type) || (format !== 1 && !(type === 1 && format === 2)))
      throw Error('Invalid TrueType substitution subtable.');
    result.push(offset + gsub.getUint16(offset + 2));
  }
  return result;
}

function contextCoverage(table: DataView, offset: number, format: number, chained: boolean) {
  if (format === 1 || format === 2) return offset + table.getUint16(offset + 2);
  if (format !== 3) throw Error('Invalid TrueType contextual lookup.');
  const input = chained ? offset + 4 + 2 * table.getUint16(offset + 2) : offset + 2;
  if (!table.getUint16(input)) throw Error('Empty TrueType contextual input.');
  return offset + table.getUint16(input + (chained ? 2 : 4));
}

function nonHorizontalPositioning(gpos: DataView) {
  // Canvas supplies the actual pair adjustment, including the selected
  // kerning policy. Only changes to the first glyph's xAdvance can be
  // recovered from the measured width of a pair alone.
  const xAdvance = 0x0004;
  const coverage: number[] = [];
  let ignoreMarks = false;
  for (const { type, flags, offset, format } of layoutSubtables(gpos, 9)) {
    if (type === 7 || type === 8) {
      coverage.push(contextCoverage(gpos, offset, format, type === 8));
      continue;
    }
    if (type < 1 || type > 6 || (format !== 1 && !((type === 1 || type === 2) && format === 2)))
      throw Error('Invalid TrueType positioning subtable.');
    if (type === 2 && (flags === 0 || flags === 8) && (gpos.getUint16(offset + 4) & ~xAdvance) === 0 &&
        gpos.getUint16(offset + 6) === 0) {
      ignoreMarks ||= flags === 8;
      continue;
    }
    // Mark attachment can only apply when the selected text includes a mark
    // in the first coverage, even if it includes the corresponding base.
    coverage.push(offset + gpos.getUint16(offset + 2));
  }
  return { coverage, ignoreMarks };
}

function glyphClass(gdef: DataView, glyph: number) {
  const offset = gdef.getUint16(4);
  if (!offset) return 0;
  const format = gdef.getUint16(offset);
  if (format === 1) {
    const index = glyph - gdef.getUint16(offset + 2);
    return index >= 0 && index < gdef.getUint16(offset + 4) ? gdef.getUint16(offset + 6 + 2 * index) : 0;
  }
  if (format !== 2) throw Error('Invalid TrueType glyph class definition.');
  let low = 0, high = gdef.getUint16(offset + 2);
  if (offset + 4 + 6 * high > gdef.byteLength) throw Error('Invalid TrueType glyph class range.');
  while (low < high) {
    const middle = Math.floor((low + high) / 2), entry = offset + 4 + 6 * middle;
    if (glyph < gdef.getUint16(entry)) high = middle;
    else if (glyph > gdef.getUint16(entry + 2)) low = middle + 1;
    else return gdef.getUint16(entry + 4);
  }
  return 0;
}

function admitLegacyKerning(kern: DataView) {
  if (kern.getUint16(0) !== 0) throw Error('Unsupported legacy font kerning.');
  const count = kern.getUint16(2);
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const length = kern.getUint16(offset + 2), coverage = kern.getUint16(offset + 4);
    // Format 0 is pair kerning. Allow horizontal and override flags only.
    if (kern.getUint16(offset) !== 0 || length < 14 || offset + length > kern.byteLength ||
        (coverage & ~0x0008) !== 0x0001)
      throw Error('Unsupported legacy font kerning.');
    offset += length;
  }
}

function coveredGlyphs(table: DataView, starts: number[]) {
  if (!starts.length) return;
  const ranges = new Int32Array(65537);
  let work = 0;
  for (const start of new Set(starts)) {
    const format = table.getUint16(start), count = table.getUint16(start + 2);
    const stride = format === 1 ? 2 : format === 2 ? 6 : 0;
    if (!stride || start + 4 + count * stride > table.byteLength)
      throw Error('Invalid TrueType glyph coverage.');
    work += count + 1;
    if (work > table.byteLength / 2) throw Error('TrueType glyph coverage exceeds its work budget.');
    let previous = -1;
    for (let index = 0; index < count; index++) {
      const entry = start + 4 + index * stride;
      const first = table.getUint16(entry), last = format === 1 ? first : table.getUint16(entry + 2);
      if (first <= previous || last < first) throw Error('Invalid TrueType coverage order.');
      ranges[first]++;
      ranges[last + 1]--;
      previous = last;
    }
  }
  let winding = 0;
  return Uint8Array.from(ranges.subarray(0, 65536), change => {
    winding += change;
    return winding > 0 ? 1 : 0;
  });
}

export function openTrueTypeOutlines(bytes: Uint8Array) {
  const tables = checkEmbeddableFont(bytes);
  if (['morx', 'mort', 'kerx', 'trak', 'fvar', 'gvar', 'COLR', 'SVG ', 'CBDT', 'EBDT', 'sbix']
      .some(tag => tables.has(tag)))
    throw Error('This face requires font shaping or paint features that cannot be outlined yet.');
  const table = (tag: string) => {
    const span = tables.get(tag)!;
    return new DataView(bytes.buffer, bytes.byteOffset + span.offset, span.length);
  };
  const cmapTable = table('cmap'), head = table('head'), loca = table('loca');
  const hhea = table('hhea'), hmtx = table('hmtx'), glyf = table('glyf');
  const gpos = tables.has('GPOS') ? table('GPOS') : undefined;
  const placements = gpos ? nonHorizontalPositioning(gpos) : undefined;
  const positioned = gpos && coveredGlyphs(gpos, placements!.coverage);
  const gdef = placements?.ignoreMarks && tables.has('GDEF') ? table('GDEF') : undefined;
  if (tables.has('kern')) admitLegacyKerning(table('kern'));
  const gsub = tables.has('GSUB') ? table('GSUB') : undefined;
  const substituted = gsub && coveredGlyphs(gsub, substitutionCoverages(gsub));
  const units = head.getUint16(18), locations = head.getInt16(50);
  const glyphCount = table('maxp').getUint16(4), metricCount = hhea.getUint16(34);
  if (units < 16 || units > 16384 || (locations !== 0 && locations !== 1) || !metricCount || metricCount > glyphCount)
    throw Error('Unsupported TrueType glyph metrics.');
  const maps: DataView[] = [];
  const mapCount = cmapTable.getUint16(2);
  for (let index = 0; index < mapCount; index++) {
    const entry = 4 + index * 8, offset = cmapTable.getUint32(entry + 4);
    const platform = cmapTable.getUint16(entry), encoding = cmapTable.getUint16(entry + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const format = cmapTable.getUint16(offset);
    if (format !== 4 && format !== 12) continue;
    const length = format === 4 ? cmapTable.getUint16(offset + 2) : cmapTable.getUint32(offset + 4);
    if (offset + length > cmapTable.byteLength) throw Error('Invalid TrueType character map.');
    const map = new DataView(cmapTable.buffer, cmapTable.byteOffset + offset, length);
    if (format === 12) maps.unshift(map);
    else maps.push(map);
  }
  if (!maps.length) throw Error('The face has no supported Unicode character map.');
  const location = (index: number) => locations ? loca.getUint32(index * 4) : loca.getUint16(index * 2) * 2;
  const cache = new Map<number, { rings: GlyphRing[]; advance: number }>();
  return {
    units,
    glyph(code: number) {
      let glyph = 0;
      for (const map of maps) {
        const mapped = glyphIndex(map, code);
        if (glyph && mapped && glyph !== mapped) throw Error('The font has conflicting glyph mappings.');
        glyph ||= mapped;
      }
      if (!glyph || glyph >= glyphCount) throw Error('The embedded face does not contain every selected character.');
      const cached = cache.get(glyph);
      if (cached) return cached;
      if (substituted?.[glyph])
        throw Error('A selected character may require a glyph substitution that cannot be outlined yet.');
      if (positioned?.[glyph] || gdef && glyphClass(gdef, glyph) === 3)
        throw Error('A selected character requires positioning outside supported horizontal pair kerning.');
      const start = location(glyph), end = location(glyph + 1);
      if (start > end || end > glyf.byteLength) throw Error('Invalid TrueType glyph offsets.');
      const advance = hmtx.getUint16(4 * Math.min(glyph, metricCount - 1));
      const lsb = glyph < metricCount ? glyph * 4 + 2 : metricCount * 4 + (glyph - metricCount) * 2;
      const rings = start === end ? [] :
        readSimpleGlyph(new DataView(glyf.buffer, glyf.byteOffset + start, end - start), hmtx.getInt16(lsb));
      const result = { rings, advance };
      cache.set(glyph, result);
      return result;
    },
  };
}
