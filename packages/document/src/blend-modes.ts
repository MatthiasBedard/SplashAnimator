export const blendModes = [
  ['multiply', 'Multiply'],
  ['color-burn', 'Color Burn'],
  ['linear-burn', 'Linear Burn'],
  ['darker-color', 'Darker Color'],
  ['lighten', 'Lighten'],
  ['screen', 'Screen'],
  ['color-dodge', 'Color Dodge'],
  ['linear-dodge', 'Linear Dodge (Add)'],
  ['lighter-color', 'Lighter Color'],
  ['overlay', 'Overlay'],
  ['soft-light', 'Soft Light'],
  ['hard-light', 'Hard Light'],
  ['vivid-light', 'Vivid Light'],
  ['linear-light', 'Linear Light'],
  ['pin-light', 'Pin Light'],
  ['hard-mix', 'Hard Mix'],
  ['difference', 'Difference'],
  ['exclusion', 'Exclusion'],
  ['subtract', 'Subtract'],
  ['divide', 'Divide'],
  ['hue', 'Hue'],
  ['saturation', 'Saturation'],
  ['color', 'Color'],
  ['luminosity', 'Luminosity'],
] as const;

export type BlendMode = (typeof blendModes)[number][0];
const values = new Set<unknown>(blendModes.map(([value]) => value));

export function isBlendMode(value: unknown): value is BlendMode {
  return values.has(value);
}
