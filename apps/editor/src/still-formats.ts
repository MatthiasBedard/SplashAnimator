export const stillFormats = [
  { id: 'gif', label: 'GIF', transparency: true },
  { id: 'png', label: 'PNG', transparency: true },
  { id: 'jpg', label: 'JPG', transparency: false },
  { id: 'bmp', label: 'BMP', transparency: false },
  { id: 'tiff', label: 'TIFF', transparency: true },
  { id: 'svg', label: 'SVG (vector)', transparency: true },
  { id: 'eps', label: 'EPS (vector)', transparency: true },
] as const;

export type StillFormat = (typeof stillFormats)[number]['id'];
