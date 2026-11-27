import type { Layer, Project, Vector } from '../../../packages/document/src';

function ordinaryRecord(value: object): boolean {
  return Object.getPrototypeOf(value) === Object.prototype &&
    typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

function ordinaryArray(value: unknown[]): boolean {
  return Object.getPrototypeOf(value) === Array.prototype &&
    typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

function ownDataField(record: object, name: string): boolean {
  const field = Object.getOwnPropertyDescriptor(record, name);
  return !!field?.enumerable && Object.prototype.hasOwnProperty.call(field, 'value');
}

function replaceField(record: object, name: string, encoded: string) {
  const fields: string[] = [];
  for (const key of Object.keys(record)) {
    if (!ownDataField(record, key)) return;
    if (key === name) {
      fields.push(JSON.stringify(key) + ':' + encoded);
    } else {
      // Encode in an object so undefined fields and child toJSON keys behave
      // exactly as they do during the ordinary project serialization.
      const field = JSON.stringify({ [key]: (record as Record<string, unknown>)[key] });
      if (field !== '{}') fields.push(field.slice(1, -1));
    }
  }
  return '{' + fields.join(',') + '}';
}

function encodeLayer(layer: Layer, encodeRoot: (shape: Vector) => string) {
  if (!layer || !ordinaryRecord(layer) || !ownDataField(layer, 'keys')) return;
  const { keys } = layer;
  if (!Array.isArray(keys) || keys.length !== 1 || !ordinaryArray(keys) || !ownDataField(keys, '0')) return;
  const key = keys[0];
  if (!key || !ordinaryRecord(key) || !ownDataField(key, 'shapes')) return;
  const { shapes } = key;
  if (!Array.isArray(shapes) || !ordinaryArray(shapes)) return;
  const roots: string[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape || !ordinaryRecord(shape)) return;
    roots.push(encodeRoot(shape));
  }
  const encodedKey = replaceField(key, 'shapes', '[' + roots.join(',') + ']');
  if (encodedKey === undefined) return;
  return replaceField(layer, 'keys', '[' + encodedKey + ']');
}

/** Exact project JSON for ordinary Brush scenes with one key per layer.
 * A missing result requests the native serializer.
 */
export function encodeBrushScene(project: Project, encodeRoot: (shape: Vector) => string): string | undefined {
  if (!ordinaryRecord(project) || !ownDataField(project, 'layers') || project.symbols?.length) return;
  const { layers } = project;
  if (!Array.isArray(layers) || !layers.length || !ordinaryArray(layers)) return;
  const encodedLayers: string[] = [];
  for (let i = 0; i < layers.length; i++) {
    if (!ownDataField(layers, String(i))) return;
    const encoded = encodeLayer(layers[i], encodeRoot);
    if (encoded === undefined) return;
    encodedLayers.push(encoded);
  }
  return replaceField(project, 'layers', '[' + encodedLayers.join(',') + ']');
}
