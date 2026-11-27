import { newProject, validateProject, type Vector } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';

const artworkFormat = 'splash-artwork-1';
export const MAX_ARTWORK_CLIPBOARD_CHARS = 16 * 1024 * 1024;

const pointKeys = new Set(['x', 'y', 'pressure', 'tiltX', 'tiltY', 'twist']);
const nodeKeys = new Set([...pointKeys, 'in', 'out']);
const gradientKeys = new Set(['kind', 'from', 'to', 'transform', 'stops']);
const stopKeys = new Set(['offset', 'color', 'opacity']);
const brushKeys = new Set(['pressure', 'minimum', 'response', 'opacityProfile', 'tilt', 'twist', 'aspect', 'angle']);
const profileKeys = new Set(['minimum', 'response']);
const payloadKeys = new Set(['format', 'artwork']);
const vectorKeys = (
  'id kind x y width height rotation transform pivot fill stroke strokeWidth strokeCap strokeJoin ' +
  'points nodes contours closed cornerRadius brush fillEnabled fillRule drawingMode opacity groups gradient'
).split(' ');
const allowed = new Set([...vectorKeys, 'bitmap', 'symbolId', 'symbolPlayback', 'instanceName', 'text']);
const supported = new Set(['rectangle', 'ellipse', 'line', 'path', 'brush', 'bezier', 'polygon']);

function assertKeys(value: unknown, keys: ReadonlySet<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.has(key)))
    throw Error('Unsupported field in Splash Artwork JSON.');
}

export function assertPortableArtwork(artwork: unknown, allowEmpty = false): asserts artwork is Vector[] {
  validateLiveGraphicData(artwork);
  if (!Array.isArray(artwork) || (!allowEmpty && !artwork.length))
    throw Error('Invalid Splash Artwork JSON shape list.');
  for (const value of artwork) {
    const shape = value as Vector;
    if (!shape || !supported.has(shape.kind) || shape.bitmap !== undefined || shape.text !== undefined ||
        shape.symbolId !== undefined || shape.symbolPlayback !== undefined || shape.instanceName !== undefined)
      throw Error('Editable clipboard artwork supports vectors without bitmaps, text or symbol instances.');
    if (Reflect.ownKeys(shape).some(key => typeof key !== 'string' || !allowed.has(key)))
      throw Error('Unsupported field in Splash Artwork JSON.');
    if (!Array.isArray(shape.points) || (shape.contours !== undefined && !Array.isArray(shape.contours)))
      throw Error('Invalid clipboard artwork points or contours.');
    shape.points.forEach(point => assertKeys(point, pointKeys));
    if (shape.nodes !== undefined && !Array.isArray(shape.nodes)) throw Error('Invalid clipboard artwork nodes.');
    for (const ring of [shape.nodes ?? [], ...(shape.contours ?? [])]) {
      if (!Array.isArray(ring)) throw Error('Invalid clipboard artwork contour.');
      for (const node of ring) {
        assertKeys(node, nodeKeys);
        if (node.in !== undefined) assertKeys(node.in, pointKeys);
        if (node.out !== undefined) assertKeys(node.out, pointKeys);
      }
    }
    if (shape.pivot !== undefined) assertKeys(shape.pivot, pointKeys);
    if (shape.gradient !== undefined) {
      assertKeys(shape.gradient, gradientKeys);
      assertKeys(shape.gradient.from, pointKeys);
      assertKeys(shape.gradient.to, pointKeys);
      if (!Array.isArray(shape.gradient.stops)) throw Error('Invalid clipboard gradient stops.');
      shape.gradient.stops.forEach(stop => assertKeys(stop, stopKeys));
    }
    if (shape.brush !== undefined) {
      assertKeys(shape.brush, brushKeys);
      if (shape.brush.opacityProfile !== undefined) assertKeys(shape.brush.opacityProfile, profileKeys);
    }
  }
}

function validateArtwork(artwork: unknown): asserts artwork is Vector[] {
  assertPortableArtwork(artwork);
  const scene = newProject();
  scene.layers[0].drawingMode = 'object';
  scene.layers[0].keys[0].shapes = artwork;
  validateProject(scene);
}

export function encodeClipboardArtwork(artwork: Vector[]) {
  validateArtwork(artwork);
  const text = JSON.stringify({ format: artworkFormat, artwork });
  if (text.length > MAX_ARTWORK_CLIPBOARD_CHARS) throw Error('Splash Artwork JSON exceeds the clipboard size limit.');
  return text;
}

export function decodeClipboardArtwork(text: string): Vector[] {
  if (text.length > MAX_ARTWORK_CLIPBOARD_CHARS) throw Error('Splash Artwork JSON exceeds the clipboard size limit.');
  let payload: { format?: unknown; artwork?: unknown };
  try { payload = JSON.parse(text); }
  catch { throw Error('Copy valid Splash Artwork JSON to the system clipboard.'); }
  if (!payload || payload.format !== artworkFormat) throw Error('Clipboard text is not Splash Artwork JSON version 1.');
  assertKeys(payload, payloadKeys);
  validateArtwork(payload.artwork);
  return payload.artwork;
}
