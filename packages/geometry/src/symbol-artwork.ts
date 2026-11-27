import { groupVectors, ungroupVectors, reparentVectors, selectionUnit } from '../../document/src/groups';
import { around, transformVectors, type Matrix } from './affine';
import { objectBounds } from './layout';
import { normalizeVector, smoothPoints } from './drawing';
import { smoothPencilStroke } from './pencil';
import {
  MAX_VECTOR_POINTS,
  clone,
  id,
  type Point,
  type Vector,
  type Brush,
} from '../../document/src';

/** Operate on complete outer units, preserving member paint order and local authoring values. */
export function editSymbolChildren(
  artwork: Vector[],
  selected: string | readonly string[],
  action: 'duplicate' | 'delete' | 'front' | 'back' | 'group' | 'ungroup',
): { artwork: Vector[]; selected: string } {
  const chosen=symbolUnitMembers(artwork,selected);
  const active=typeof selected==='string'?selected:chosen[0].id;
  const ids=new Set(chosen.map(item=>item.id)),rest=artwork.filter(item=>!ids.has(item.id));
  if(action==='group' || action==='ungroup'){
    const next=structuredClone(artwork),memberIds=chosen.map(item=>item.id);
    // Same-root placement is an original ancestry/stack validator without mutation.
    reparentVectors(next,memberIds,[],[]);
    if(action==='group'){
      if(new Set(chosen.map(item=>selectionUnit(item,0))).size<2)
        throw new Error('Choose at least two complete units to group.');
      if(chosen.some(item=>(item.groups?.length ?? 0)>=32))throw new Error('Group nesting exceeds 32.');
      const reserved=new Set(artwork.flatMap(item=>[item.id,...(item.groups ?? [])]));
      groupVectors(next,memberIds,[]);
      const group=next.find(item=>item.id===memberIds[0])!.groups![0];
      if(reserved.has(group))throw new Error('New group identity collision.');
    }else{
      if(!chosen.some(item=>item.groups?.length))return {artwork,selected:active};
      ungroupVectors(next,memberIds,[]);
    }
    reparentVectors(next,memberIds,[],[]);
    return {artwork:next,selected:active};
  }
  if(action==='delete')return {artwork:rest,selected:rest[0]?.id ?? ''};
  if(action==='front')return {artwork:[...rest,...chosen],selected:active};
  if(action==='back')return {artwork:[...chosen,...rest],selected:active};
  const pasted=pasteSymbolChildren(artwork,chosen);
  const copies=pasted.artwork.slice(artwork.length);
  const selectedIndex=chosen.findIndex(item=>item.id===active);
  const last=artwork.length-1-[...artwork].reverse().findIndex(item=>ids.has(item.id));
  return {artwork:[...artwork.slice(0,last+1),...copies,...artwork.slice(last+1)],
    selected:copies[selectedIndex].id};
}
function symbolUnitMembers(artwork: Vector[], selected: string | readonly string[]): Vector[] {
  const ids = typeof selected === 'string' ? [selected] : selected;
  if (!ids.length) throw new Error('Choose symbol artwork first.');
  const byId = new Map(artwork.map(item => [item.id, item]));
  const groups = new Set<string>(), singles = new Set<string>();
  for (const id of ids) {
    const source = byId.get(id);
    if (!source) throw new Error('Choose current symbol artwork first.');
    if (source.groups?.[0]) groups.add(source.groups[0]); else singles.add(id);
  }
  return artwork.filter(item => singles.has(item.id) || !!item.groups?.[0] && groups.has(item.groups[0]));
}
/** Translate complete outer units once in definition coordinates without rewriting local paint. */
export function moveSymbolChildren(
  artwork: Vector[],
  selected: string | readonly string[],
  dx: number,
  dy: number,
): Vector[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Enter a finite movement.');
  const chosen = new Set(symbolUnitMembers(artwork, selected).map(item => item.id));
  return artwork.map((s) => {
    if (!chosen.has(s.id)) return s;
    const next = clone(s);
    next.x += dx;
    next.y += dy;
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) throw new Error('Movement exceeds finite geometry.');
    return next;
  });
}
export function drawnSymbolPrimitive(
  kind: 'rectangle' | 'ellipse' | 'line',
  id: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  square = false,
  center = false,
): Vector {
  let dx = end.x - start.x,
    dy = end.y - start.y;
  if (![start.x, start.y, dx, dy].every(Number.isFinite))
    throw new Error('Invalid drawing coordinates.');
  if (square && kind === 'line') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4),
      length = Math.hypot(dx, dy);
    dx = Math.cos(angle) * length;
    dy = Math.sin(angle) * length;
  } else if (square) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  const a = center ? { x: start.x - dx, y: start.y - dy } : start,
    b = { x: start.x + dx, y: start.y + dy };
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    id,
    kind,
    x,
    y,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    rotation: 0,
    fill: '#6366f1',
    stroke: '#000000',
    strokeWidth: kind === 'line' ? 2 : 0,
    ...(kind === 'line' ? { fillEnabled: false } : {}),
    points:
      kind === 'line'
        ? [
            { x: a.x - x, y: a.y - y },
            { x: b.x - x, y: b.y - y },
          ]
        : [],
  };
}

function validatePencilSamples(samples: Point[], width: number) {
  if (
    samples.length < 2 ||
    samples.length > MAX_VECTOR_POINTS ||
    samples.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw new Error(`A symbol stroke requires 2-${MAX_VECTOR_POINTS} finite samples.`);
  if (!Number.isFinite(width) || width <= 0 || width > 1000)
    throw new Error('Pencil width must be greater than zero and at most 1000.');
}

/** Finish a bounded pencil stroke using the stage's smoothing and normalization. */
export function drawnSymbolPencil(
  id: string,
  samples: Point[],
  mode: 'raw' | 'smooth' | 'straight',
  stroke: string,
  width: number,
): Vector {
  validatePencilSamples(samples, width);
  const points =
    mode === 'straight'
      ? [samples[0], samples.at(-1)!].map((p) => ({ ...p }))
      : clone(samples);
  const result: Vector = {
    id,
    kind: 'path',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    fill: '#000000',
    fillEnabled: false,
    stroke,
    strokeWidth: width,
    points,
  };
  if (mode === 'smooth') return smoothPencilStroke(result);
  normalizeVector(result);
  return result;
}

export function drawnSymbolBrush(
  id: string,
  samples: Point[],
  fill: string,
  width: number,
  smooth: boolean,
  brush?: Brush,
): Vector {
  validatePencilSamples(samples.length === 1 ? [samples[0], samples[0]] : samples, width);
  const result = drawnSymbolPencil(
    id,
    samples.length === 1
      ? [samples[0], samples[0]]
      : smooth ? smoothPoints(samples) : samples,
    'raw',
    fill,
    width,
  );
  result.kind = 'brush';
  result.fill = fill;
  result.fillEnabled = true;
  result.brush = clone(brush ?? { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 });
  return result;
}
/** Only merge above protected artwork, preserving its stack position. */
export function symbolBrushMergeStart(shapes: Vector[]): number {
  let start = 0;
  shapes.forEach((s, i) => {
    if (s.kind === 'text' || s.kind === 'symbol' || s.groups?.length) start = i + 1;
  });
  return start;
}

/** Stroke-only connectivity cannot cross a protected stack item or use a fill as a bridge. */
export function symbolStrokeCandidates(artwork: Vector[], seed: string): Vector[] {
  const protectedItem = (s: Vector) =>
    s.kind === 'text' || s.kind === 'symbol' || !!s.groups?.length;
  const index = artwork.findIndex((s) => s.id === seed);
  if (index < 0 || protectedItem(artwork[index])) return [];
  let start = index,
    end = index + 1;
  while (start > 0 && !protectedItem(artwork[start - 1])) start--;
  while (end < artwork.length && !protectedItem(artwork[end])) end++;
  return artwork
    .slice(start, end)
    .filter((s) => s.kind !== 'brush' && s.strokeWidth > 0)
    .map((s) => ({ ...clone(s), fillEnabled: false }));
}

/** Detached session clipboard; preserves linked assets/symbols, with fresh shape/group identities on paste. */
export function copySymbolChildren(artwork: Vector[], selected: string | readonly string[]): Vector[] {
  // Unlike the document JSON clone, preserve original invalid numerics for admission to reject.
  return structuredClone(symbolUnitMembers(artwork, selected));
}
export function pasteSymbolChildren(
  artwork: Vector[],
  copied: Vector[],
): { artwork: Vector[]; selected: string } {
  if (!Array.isArray(copied) || !copied.length) throw new Error('Copy symbol artwork before pasting.');
  const validGroup=(value:unknown)=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const originalIds=new Set<string>();
  for(const item of copied){
    if(!item || typeof item.id!=='string' || originalIds.has(item.id))throw new Error('Invalid clipboard artwork identity.');
    originalIds.add(item.id);
    if(!Number.isFinite(item.x) || !Number.isFinite(item.y))throw new Error('Invalid clipboard position.');
    if(item.groups!==undefined && (!Array.isArray(item.groups) || item.groups.length>32 ||
      new Set(item.groups).size!==item.groups.length || !item.groups.every(validGroup)))
      throw new Error('Invalid clipboard group ancestry.');
  }
  const used=new Set([...artwork,...copied].flatMap(item=>[item.id,...(item.groups ?? [])]));
  const fresh=()=>{const next=id();if(used.has(next))throw new Error('Copied identity collision.');used.add(next);return next;};
  const groups=new Map<string,string>();
  const copies=structuredClone(copied).map(item=>{
    item.id=fresh();item.x+=10;item.y+=10;
    if(!Number.isFinite(item.x) || !Number.isFinite(item.y))throw new Error('Invalid clipboard position.');
    if(item.groups)item.groups=item.groups.map(group=>{
      if(!groups.has(group))groups.set(group,fresh());
      return groups.get(group)!;
    });
    return item;
  });
  return {artwork:[...artwork,...copies],selected:copies[0].id};
}

function symbolMemberBounds(members: Vector[]) {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const item of members){
    const b=objectBounds(item);left=Math.min(left,b.left);top=Math.min(top,b.top);
    right=Math.max(right,b.right);bottom=Math.max(bottom,b.bottom);
  }
  if(![left,top,right,bottom].every(Number.isFinite))throw new Error('Enter finite transform bounds.');
  return {left,top,right,bottom};
}
/** Complete-unit authoring bounds, shared by canvas handles and pivot resolution. */
export function symbolTransformBounds(artwork: Vector[], selected: string | readonly string[]) {
  return symbolMemberBounds(symbolUnitMembers(artwork,selected));
}
/** Resolve the same context-space pivot used by shared transforms and their canvas handles. */
export function symbolTransformPivot(artwork: Vector[], selected: string | readonly string[], pivot?: Point): Point {
  const members=symbolUnitMembers(artwork,selected);
  if (pivot !== undefined) {
    if (!pivot || !Number.isFinite(pivot.x) || !Number.isFinite(pivot.y))
      throw new Error('Enter finite transform pivot coordinates.');
    return {x:pivot.x,y:pivot.y};
  }
  const {left,top,right,bottom}=symbolMemberBounds(members);
  const x=(left+right)/2,y=(top+bottom)/2;
  if(!Number.isFinite(x) || !Number.isFinite(y))throw new Error('Enter finite transform pivot coordinates.');
  return {x,y};
}
/** Apply one affine operation to detached complete units; prepare all members before publication. */
export function affineSymbolChildren(artwork: Vector[], selected: string | readonly string[], operation: Matrix): Vector[] {
  const chosen=clone(symbolUnitMembers(artwork,selected));
  transformVectors(chosen,operation);
  const replacements=new Map(chosen.map(item=>[item.id,item]));
  return artwork.map(item=>replacements.get(item.id) ?? item);
}

/** Transform complete outer units once about an explicit context pivot or their combined box center. */
export function transformSymbolChildren(
  artwork: Vector[],
  selected: string | readonly string[],
  options: { dx: number; dy: number; rotation: number; scaleX: number; scaleY: number; pivot?: Point },
): Vector[] {
  if (
    ![options.dx, options.dy, options.rotation, options.scaleX, options.scaleY].every(Number.isFinite) ||
    options.scaleX === 0 ||
    options.scaleY === 0
  )
    throw new Error('Enter finite transform values and nonzero scales.');
  if (options.pivot !== undefined && (!options.pivot ||
      !Number.isFinite(options.pivot.x) || !Number.isFinite(options.pivot.y)))
    throw new Error('Enter finite transform pivot coordinates.');
  const chosen = clone(symbolUnitMembers(artwork, selected));
  if (
    !options.dx &&
    !options.dy &&
    !options.rotation &&
    options.scaleX === 1 &&
    options.scaleY === 1
  )
    return artwork;
  const pivot=symbolTransformPivot(chosen,chosen.map(item=>item.id),options.pivot);
  const angle = (options.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const operation = around(
    pivot,
    c * options.scaleX,
    s * options.scaleX,
    -s * options.scaleY,
    c * options.scaleY,
  );
  operation[4] += options.dx;
  operation[5] += options.dy;
  transformVectors(chosen, operation);
  const replacements = new Map(chosen.map((s) => [s.id, s]));
  return artwork.map((s) => replacements.get(s.id) ?? s);
}

/** Remove only the selected outer group boundary for an isolated editing draft. */
export function isolateSymbolGroup(
  artwork: Vector[],
  selected: string,
): { group: string; artwork: Vector[] } {
  const source = artwork.find((s) => s.id === selected),
    group = source?.groups?.[0];
  if (!group) throw new Error('Choose grouped symbol artwork first.');
  return {
    group,
    artwork: copySymbolChildren(artwork, selected).map((s) => {
      s.groups = s.groups!.slice(1);
      if (!s.groups.length) delete s.groups;
      return s;
    }),
  };
}
/** Replace one isolated group at its original stack position, restoring its boundary. */
export function replaceSymbolGroup(artwork: Vector[], group: string, edited: Vector[]): Vector[] {
  const first = artwork.findIndex((s) => s.groups?.[0] === group);
  if (first < 0) throw new Error('The isolated group no longer exists.');
  const copies = clone(edited).map((s) => ({ ...s, groups: [group, ...(s.groups ?? [])] }));
  const result = artwork.filter((s) => s.groups?.[0] !== group);
  result.splice(first, 0, ...copies);
  return result;
}
