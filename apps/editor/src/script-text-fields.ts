import { keyAt, type Layer, type Vector } from '../../../packages/document/src';
import { fontFamilyForRendering } from '../../../packages/geometry/src/font-family';
import { matrix, multiply } from '../../../packages/geometry/src/affine';
import { objectBounds, type Bounds } from '../../../packages/geometry/src/layout';

type TextField = { key: string; binding: string; content: string; overlay?: Vector };
export type ScriptArtworkSize = { width: number; height: number; naturalWidth: number; naturalHeight: number };

function intersects(a: Bounds, b: Bounds) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function canOverlay(shape: Vector) {
  const text = shape.text!;
  return shape.fillEnabled !== false && (shape.opacity ?? 1) === 1 &&
    shape.strokeWidth === 0 && !shape.gradient && !shape.bitmap && !text.runs?.length &&
    shape.width > 0 && shape.height > 0 && (text.scaleX ?? 1) > 0 && (text.scaleY ?? 1) > 0;
}

export function scriptTextFields(layers: readonly Layer[], frame: number, placeOverArtwork = false) {
  const fields = new Map<string, TextField | null>();
  let foreground: Bounds | undefined;
  let uncertain = !placeOverArtwork;
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index];
    if (!layer.visible) continue;
    const key = keyAt(layer, frame);
    for (let index = key.shapes.length - 1; index >= 0; index--) {
      const shape = key.shapes[index];
      const text = shape.kind === 'text' ? shape.text : undefined;
      const binding = text?.dynamicBinding;
      if (binding && text?.input === true) {
        const overlay = !uncertain && canOverlay(shape) && (!foreground || !intersects(objectBounds(shape), foreground))
          ? shape : undefined;
        fields.set(binding, fields.has(binding) ? null : {
          key: JSON.stringify([layer.id, key.frame, shape.id, binding]), binding, content: text.content, overlay,
        });
      }
      if (uncertain || shape.opacity === 0) continue;
      // Only bounded primitive fills can prove they leave a lower editor unobscured.
      if ((shape.kind !== 'rectangle' && shape.kind !== 'ellipse') || shape.strokeWidth !== 0 || shape.contours) {
        uncertain = true;
        continue;
      }
      const box = objectBounds(shape);
      foreground = foreground ? {
        left: Math.min(foreground.left, box.left), top: Math.min(foreground.top, box.top),
        right: Math.max(foreground.right, box.right), bottom: Math.max(foreground.bottom, box.bottom),
      } : box;
    }
  }
  return [...fields.values()].filter(field => field !== null).reverse();
}

export function scriptFieldPlacement(shape: Vector | undefined, image: ScriptArtworkSize | undefined) {
  if (!shape || !image) return;
  const bounds = objectBounds(shape);
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > image.naturalWidth ||
      bounds.bottom > image.naturalHeight) return;
  const x = image.width / image.naturalWidth, y = image.height / image.naturalHeight;
  const text = shape.text!, sx = text.scaleX ?? 1, sy = text.scaleY ?? 1;
  const width = shape.width / sx;
  if (text.wrapWidth && Math.abs(text.wrapWidth - width) > 1e-8 * width) return;
  const transform = multiply(multiply([x, 0, 0, y, 0, 0], matrix(shape)), [sx, 0, 0, sy, 0, 0]);
  const det = transform[0] * transform[3] - transform[1] * transform[2];
  if (!transform.every(Number.isFinite) || !Number.isFinite(det) || det === 0) return;
  const rgb = [1, 3, 5].map(offset => parseInt(shape.fill.slice(offset, offset + 2), 16) / 255);
  const luminance = rgb.reduce((sum, value, index) =>
    sum + [0.2126, 0.7152, 0.0722][index] * (value <= 0.04045
      ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), 0);
  return {
    transform: `matrix(${transform.join(',')})`,
    width: width + 'px',
    height: shape.height / sy + 'px',
    buttonX: bounds.left * x + 'px', buttonY: bounds.bottom * y + 'px',
    font: `${text.italic ? 'italic' : 'normal'} ${text.bold ? 'bold' : 'normal'} ${text.size}px/${text.lineHeight ?? 1.2} ${fontFamilyForRendering(text.font)}`,
    color: shape.fill,
    editBackground: luminance > 0.179 ? '#000' : '#fff',
    align: text.align,
    direction: text.direction ?? 'ltr',
    letterSpacing: (text.letterSpacing ?? 0) + 'px',
    wordSpacing: (text.wordSpacing ?? 0) + 'px',
    kerning: text.kerning ?? 'auto',
    wrap: text.wrapWidth ? 'soft' as const : 'off' as const,
  };
}
export type ScriptFieldPlacement = NonNullable<ReturnType<typeof scriptFieldPlacement>>;
