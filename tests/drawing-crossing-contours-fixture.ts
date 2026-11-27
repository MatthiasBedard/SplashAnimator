import type { Vector } from '../packages/document/src';

export function crossingCompoundPair(): [Vector, Vector] {
  const lower: Vector = {
    id: 'old-compound', kind: 'polygon', x: 0, y: 0, width: 58, height: 50, rotation: 0,
    fill: '#6d5efc', stroke: '#292444', strokeWidth: 0, fillRule: 'evenodd',
    fillEnabled: true, closed: true, points: [], drawingMode: 'merge',
    contours: [
      [
        { x: 5, y: 0, out: { x: 12, y: 3 } },
        { x: 50, y: 0, in: { x: 38, y: 6 }, out: { x: 58, y: 8 } },
        { x: 58, y: 50, in: { x: 46, y: 38 } },
        { x: 5, y: 50, out: { x: 7, y: 35 }, in: { x: 23, y: 44 } },
      ],
      [
        { x: 15, y: 22, out: { x: 10, y: 16 } },
        { x: 1, y: 25, in: { x: 6, y: 14 }, out: { x: 7, y: 34 } },
        { x: 15, y: 30, in: { x: 12, y: 33 } },
      ],
    ],
  };
  const upper: Vector = { ...lower, id: 'incoming-fill', kind: 'ellipse', x: 30, y: 10, width: 50, height: 32 };
  delete upper.contours;
  return [lower, upper];
}

export function adjacentPrecisionBoundaries(): [Vector, Vector, Vector] {
  const first: Vector = {
    id: 'precision-upper-x', kind: 'rectangle', x: 40, y: 12, width: 60.000000000000014, height: 60,
    rotation: 0, fill: '#6d5efc', stroke: '#292444', strokeWidth: 0, points: [], drawingMode: 'merge',
  };
  const second: Vector = { ...first, id: 'precision-lower-x', x: 25, y: 39, width: 75 };
  const upper: Vector = { ...first, id: 'precision-oval', kind: 'ellipse', x: 65, y: 50, width: 73, height: 32 };
  return [first, second, upper];
}

export function consecutiveInkCoordinates() {
  const horizontal: Vector = {
    id: 'first', kind: 'path', x: 20, y: 40, width: 60, height: 0, rotation: 0,
    strokeWidth: 2, stroke: '#222222', fill: '#6d5efc', fillEnabled: false,
    points: [{ x: 0, y: 0 }, { x: 60, y: 0 }], drawingMode: 'merge',
  };
  const second: Vector = { ...horizontal, id: 'second', y: 40.00000000000001 };
  const vertical: Vector = {
    ...horizontal, id: 'incoming', x: 50, y: 5, width: 0, height: 90,
    points: [{ x: 0, y: 0 }, { x: 0, y: 90 }],
  };
  return { horizontal, second, vertical };
}

export function consecutiveCurvedInkCoordinates() {
  const offset = 2 ** -47;
  const curve = (id: string, dx: number): Vector => ({
    id, kind: 'bezier', x: 0, y: 0, width: 64, height: 128, rotation: 0,
    strokeWidth: 2, stroke: '#222222', fill: '#6d5efc', fillEnabled: false, closed: false,
    points: [], drawingMode: 'merge',
    nodes: [
      { x: 40 + dx, y: 0, out: { x: 52 + dx, y: 32 } },
      { x: 40 + dx, y: 128, in: { x: 52 + dx, y: 96 } },
    ],
  });
  const first = curve('first-arc', 0), second = curve('second-arc', offset);
  const pencil: Vector = {
    ...first, id: 'incoming', kind: 'path', x: 5, y: 64, width: 120, height: 0, nodes: undefined,
    points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
  };
  // Symmetric control ordinates give y = 64 only at t = 1/2. At that
  // time the Bernstein weights give x = 49 plus the original offset.
  return { first, second, pencil, junctions: [{ x: 49, y: 64 }, { x: 49 + offset, y: 64 }] };
}

export function consecutiveObliqueInkCoordinates() {
  const offset = 2 ** -43;
  const { first, second, pencil } = consecutiveCurvedInkCoordinates();
  const arc = (owner: Vector, dx: number): Vector => ({
    ...owner, height: 116 + dx / 2,
    nodes: [
      { x: 40 + dx, y: 20 + dx / 2, out: { x: 52 + dx, y: 58 + dx / 2 } },
      { x: 40 + dx, y: 116 + dx / 2, in: { x: 52 + dx, y: 90 + dx / 2 } },
    ],
  });
  // The incoming line is y = 32 + x/2. Signed distances of the
  // cubic controls are proportional to [-32, 0, 32, 64].
  // At the unique root u = 1/3 the world abscissa is 48 + dx.
  return {
    first: arc(first, 0), second: arc(second, offset),
    pencil: { ...pencil, x: 8, y: 36, height: 60, points: [{ x: 0, y: 0 }, { x: 120, y: 60 }] },
    junctions: [{ x: 48, y: 56 }, { x: 48 + offset, y: 56 + offset / 2 }],
  };
}

export function consecutiveObliquePaintBoundaries() {
  const { first, second, pencil, junctions } = consecutiveObliqueInkCoordinates();
  const fill = (arc: Vector, side: number, color: string): Vector => {
    const [top, bottom] = arc.nodes!;
    return {
      ...arc, kind: 'polygon', width: 100, nodes: undefined, fill: color, fillEnabled: true,
      strokeWidth: 0, closed: true, fillRule: 'evenodd',
      contours: [[top, bottom, { x: side, y: bottom.y }, { x: side, y: top.y }]],
    };
  };
  return { left: fill(first, 10, '#6644cc'), right: fill(second, 100, '#228855'), pencil, junctions };
}

export function twoGroupsOfObliqueInkCrossings() {
  const { first, pencil } = consecutiveObliqueInkCoordinates();
  const offset = 2 ** -42;
  const arcs = [0, 80].flatMap((shift, group) => [0, offset].map((gap, index): Vector => ({
    ...first, id: `arc-${group}-${index}`, x: shift + gap, y: (shift + gap) / 2,
    height: 156,
    nodes: [
      { x: 40, y: 44, out: { x: 52, y: 18 } },
      { x: 40, y: 156, in: { x: 52, y: 130 } },
    ],
  })));
  // Subtracting the line y = 56 + x/2 gives Bernstein coefficients
  // [-32, -64, 48, 80], with exactly one sign change and a root at 1/2.
  const junctions = [49,129].flatMap(x => [x,x + offset].map(x => ({ x, y: 56 + x / 2 })));
  return { arcs, pencil: { ...pencil, y: 60, width: 160, height: 80, points: [{x:0,y:0},{x:160,y:80}] }, junctions };
}

export function collidingObliqueInkCrossings() {
  const { arcs, pencil } = twoGroupsOfObliqueInkCrossings();
  const shifted = { ...structuredClone(arcs[2]), id: 'one-control-offset' };
  shifted.nodes![0].out!.x += 2 ** -45;
  shifted.nodes![0].out!.y += 2 ** -46;
  return { arcs: [...arcs.slice(0,3), shifted], pencil };
}

export function mixedObliqueInkCrossings() {
  const { arcs, pencil } = collidingObliqueInkCrossings();
  const curves = [
    ...arcs.slice(2).map((arc, index) => ({
      ...arc, y: 0, height: 11,
      nodes: [
        {x:40,y:-6,out:{x:52 + index * 2 ** -45,y:-2 + index * 2 ** -46}},
        {x:40,y:1,in:{x:52,y:5}},
      ],
    })),
    ...arcs.slice(0,2).map(arc => ({ ...arc, x: arc.x + 160, y: arc.y - 40 })),
  ];
  const line = (id: string, y: number, height: number, stroke: string): Vector => ({
    ...pencil, id, x: 180, y, width: 0, height, stroke,
    points: [{x:0,y:0},{x:0,y:height}],
  });
  const straight = [line('first-line', -5, 80, '#111111'), line('second-line', 1, 94, '#444444')];
  const junctions = [
    {x:129,y:.5}, {x:129,y:.5 + 3 / 8 * 2 ** -46},
    {x:180,y:26}, {x:209,y:40.5}, {x:209 + 2 ** -42,y:40.5 + 2 ** -43},
  ];
  return { curves, straight, junctions, pencil: {
    ...pencil, x: 128, y: 0, width: 120, height: 60, points: [{x:0,y:0},{x:120,y:60}],
  } };
}

export function subpixelPencilPiece(): Vector {
  const { pencil } = collidingObliqueInkCrossings();
  const width = 3 / 8 * 2 ** -45, height = 3 / 8 * 2 ** -46;
  return {
    ...pencil, id: 'reopened-subpixel-ink', x: 129, y: 120.5, width, height,
    stroke: '#e23257', strokeWidth: 8, strokeCap: 'round',
    points: [{x:0,y:0},{x:width,y:height}],
  };
}

export function subpixelPencilAcrossOrigin(): Vector {
  const piece = subpixelPencilPiece(), end = piece.points[1];
  return {
    ...piece, width:2*end.x, height:2*end.y,
    points:[{x:-end.x,y:-end.y},end],
  };
}

export function nearbySavedPencilCrossings(workingX = 224.5) {
  const { pencil } = consecutiveObliqueInkCoordinates();
  // Two oppositely directed cubics from the second saved Pencil span, in the
  // nearby working basis. Both are met inside their spans.
  const point = (x: number, y: number) => ({ x: x - workingX, y: y - 188 });
  const arc = (id: string, stroke: string, nodes: NonNullable<Vector['nodes']>): Vector => ({
    ...pencil, id, kind: 'bezier', x: 0, y: 0, width: 19, height: 12, points: [], stroke, nodes,
  });
  const first = arc('first-saved-arc', '#e23257', [
    { ...point(234.55487981963546, 181.69049390922817), out: point(228.41515573968985, 185.55994326713937) },
    { ...point(215.89720130668658, 192.68375108546337), in: point(222.35224563956632, 189.61648440723047) },
  ]);
  const second = arc('second-saved-arc', '#222288', [
    { ...point(215.8972013066866, 192.68375108546334), out: point(222.35224563956635, 189.61648440723047) },
    { ...point(234.5548798196355, 181.69049390922814), in: point(228.41515573968988, 185.55994326713935) },
  ]);
  return {
    arcs: [first, second],
    pencil: { ...pencil, x: 0, y: 0, width: 75, height: 55, points: [point(200, 170), point(275, 225)] },
  };
}
