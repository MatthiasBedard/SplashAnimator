export const spiralSamples = Array.from({ length: 109 }, (_, i) => {
  const angle = i * Math.PI / 24, radius = 8 + 112 * i / 108;
  return { x: 200 + radius * Math.cos(angle), y: 165 + radius * Math.sin(angle) };
});
export const circleSamples = Array.from({ length: 97 }, (_, i) => {
  const angle = (i % 96) * Math.PI / 48;
  return { x: 190 + 85 * Math.cos(angle), y: 150 + 85 * Math.sin(angle) };
});

const turns = [
  { x: 60, y: 93 }, { x: 340, y: 119 }, { x: 65, y: 151 },
  { x: 335, y: 176 }, { x: 66, y: 206 }, { x: 337, y: 232 },
];
export const zigzagSamples = [turns[0], ...turns.slice(1).flatMap((b, i) =>
  Array.from({ length: 20 }, (_, k) => ({
    x: turns[i].x + (b.x - turns[i].x) * (k + 1) / 20,
    y: turns[i].y + (b.y - turns[i].y) * (k + 1) / 20,
  })))];
