import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Vector } from '../packages/document/src';
import { partitionInkOverPaint, partitionJoinedPaint } from '../packages/geometry/src/ink-paint-cut';
import { planVacatedInkHealing } from '../packages/geometry/src/join-recolored-fills';
import { mergeControlBounds } from '../packages/geometry/src/merge';
import { hit } from '../packages/geometry/src';
import { bendEdge } from '../packages/geometry/src/edge-bend';
import { captureAttachedFillEdit } from '../packages/geometry/src/attached-fill';
import {
  mergeEditedPiecesInWorker,
  pencilInWorker,
  rebuildCurrentLayerInWorker,
  fitContoursInWorker,
  regionInWorker,
  selectPaintRegionInWorker,
  deletePaintRegionInWorker,
  splitPaintRegionInWorker,
} from '../apps/editor/src/geometry-worker';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fill = (id: string): Vector => ({
  id, kind:'rectangle', x:30, y:20, width:20, height:20, rotation:0, points:[],
  fill:'#008844', stroke:'#111111', strokeWidth:0, drawingMode:'merge',
});
const target = fill('target'), secondTarget = fill('second-target'), protectedFill = fill('protected');
const source = [target,protectedFill,secondTarget,fill('a'),fill('b'),fill('c'),fill('d')];
const enlarged = {...target,width:50};
const intoTarget = (moving: string) => ({moving,into:target.id});
const joinedReply = {
  artwork:[enlarged,1,2,4,6], clearMargin:false, preservedDestination:false,
  absorbedFills:['a','c'].map(intoTarget),
};
function replyToDrop(reply: Record<string,unknown>, options?: {strokeEdit?:boolean;keepFillIds?:boolean}, moved=['a','b','c','d']) {
  const pending=mergeEditedPiecesInWorker(source,moved,undefined,[target.id,secondTarget.id],options);
  FakeWorker.instances.at(-1)!.onmessage!({data:{id:1,result:reply}});
  return pending;
}

it('admits several moved fills into the same destination while retaining the other moving pieces in order',async()=>{
  const result=await replyToDrop(joinedReply);
  expect(result.artwork).toEqual([enlarged,protectedFill,secondTarget,source[4],source[6]]);
  expect(result.artwork[3]).toBe(source[4]);
  expect(result.artwork[4]).toBe(source[6]);
  expect(result.absorbedFills).toEqual([intoTarget('a'),intoTarget('c')]);
});

it('admits separate material owners when all moved fills join',async()=>{
  const absorbedFills=[intoTarget('a'),{moving:'b',into:secondTarget.id},intoTarget('c'),{moving:'d',into:secondTarget.id}];
  const other={...secondTarget,height:40};
  const result=await replyToDrop({...joinedReply,artwork:[enlarged,1,other],absorbedFills});
  expect(result.artwork).toEqual([enlarged,protectedFill,other]);
  expect(result.absorbedFills).toEqual(absorbedFills);
});

it('keeps the single moving fill reply compatible',async()=>{
  const absorbedFill=intoTarget('a');
  const result=await replyToDrop({artwork:[enlarged,1,2,4,5,6],absorbedFill,preservedDestination:false,clearMargin:false},{},['a']);
  expect(result.absorbedFill).toEqual(absorbedFill);
  expect(result.absorbedFills).toBeUndefined();
});

it.each([
  ['duplicate moved ID',{absorbedFills:[intoTarget('a'),intoTarget('a')]}],
  ['stationary ID marked as moved',{absorbedFills:[intoTarget('second-target')]}],
  ['unknown moving ID',{absorbedFills:[intoTarget('absent')]}],
  ['ineligible destination',{absorbedFills:[{moving:'a',into:'protected'}]}],
  ['moving destination',{absorbedFills:[{moving:'a',into:'b'}]}],
  ['unknown destination',{absorbedFills:[{moving:'a',into:'other'}]}],
  ['conflicting single and multiple mappings',{absorbedFill:intoTarget('a')}],
  ['missing destination replacement',{artwork:[1,2,4,6]}],
  ['unchanged destination reference',{artwork:[0,1,2,4,6]}],
  ['incompatible destination paint',{artwork:[{...enlarged,fill:'#333333'},1,2,4,6]}],
  ['missing surviving piece',{artwork:[enlarged,1,2,4]}],
  ['rewritten surviving piece',{artwork:[enlarged,1,2,4,{...source[6]}]}],
  ['surviving movers in the wrong order',{artwork:[enlarged,1,2,6,4]}],
  ['absorbed moving piece reintroduced',{artwork:[enlarged,1,2,3,4,6]}],
  ['preserved destination',{preservedDestination:true}],
  ['ink partition and absorption',{inkCuts:[]}],
  ['empty mappings',{absorbedFills:[]}],
  ['malformed mappings',{absorbedFills:null}],
  ['null mapping entry',{absorbedFills:[null]}],
] as const)('rejects a multi-piece fill reply with %s',async(_name,change)=>{
  await expect(replyToDrop({...joinedReply,...change})).rejects.toThrow('invalid paint drop');
});

it.each([{strokeEdit:true},{keepFillIds:true}])('rejects fill absorption for protected drops %o',async options=>{
  await expect(replyToDrop(joinedReply,options)).rejects.toThrow('invalid paint drop');
});

const movedInk = (id:string,x:number,y:number,length:number):Vector=>({
  ...fill(id),kind:'path',fillEnabled:false,strokeWidth:2,x,y,width:length,height:0,
  points:[{x:0,y:0},{x:length,y:0}],
});

it('restores the captured layer from a compact Pencil recovery reply', async () => {
  const ink = movedInk('pencil', 20, 28, 30);
  const pending = pencilInWorker(source, ink, 'ink', true);
  const worker = FakeWorker.instances[0];
  expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ shapes: source, pencil: { stroke: ink } });
  worker.onmessage!({ data: { id: 1, result: { shape: ink, retainedOverlap: true } } });
  const result = await pending;
  expect(result).toStrictEqual({ shape: ink, shapes: [...source, ink], retainedOverlap: true });
  expect(result.shapes).not.toBe(source);
  expect(result.shapes[0]).toBe(source[0]);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(['object mode', 'replacement array', 'foreign ID', 'incoming ID collision', 'invalid ink', 'closed ink', 'missing points'] as const)(
  'rejects a Pencil recovery with %s', async (scenario) => {
    const ink = movedInk('pencil', 20, 28, 30);
    const retained = scenario === 'foreign ID' ? target : { ...ink,
      ...(scenario === 'invalid ink' && { fillEnabled: true }),
      ...(scenario === 'closed ink' && { closed: true }),
      ...(scenario === 'missing points' && { points: [] }),
    };
    const inputs = scenario === 'incoming ID collision' ? [...source, ink] : source;
    const pending = pencilInWorker(inputs, ink, 'ink', scenario !== 'object mode');
    FakeWorker.instances[0].onmessage!({ data: { id: 1, result: { shape: retained, retainedOverlap: true,
      ...(scenario === 'replacement array' && { shapes: [target, ink] }),
    } } });
    await expect(pending).rejects.toThrow(/invalid Pencil/);
  },
);

it.each(['admit', 'ordinary move', 'protected stroke'] as const)('checks an ink-only partition for %s', async scenario => {
  const lower = { ...movedInk('lower', 45, 10, 0), height: 45, points: [{x:0,y:0},{x:0,y:45}] };
  const edited = movedInk('edited', 30, 30, 55);
  const artwork = [lower, protectedFill, edited];
  const partition = partitionInkOverPaint([lower, edited], edited, mergeControlBounds, new Set([lower.id]), true, true)!;
  expect(partition.strokes[0].id).toBe(edited.id);
  expect(partition.background.get(lower)?.every(s => s.fillEnabled === false && s.stroke === lower.stroke &&
    s.strokeWidth === lower.strokeWidth && s.drawingMode === 'merge')).toBe(true);
  expect(new Set([...artwork.map(s => s.id), ...partition.strokes.slice(1).map(s => s.id),
    ...partition.background.get(lower)!.map(s => s.id)]).size).toBe(6);
  const pending = mergeEditedPiecesInWorker(artwork, [edited.id], undefined,
    scenario === 'protected stroke' ? [] : [lower.id], {strokeEdit: scenario !== 'ordinary move'});
  FakeWorker.instances[0].onmessage!({data:{id:1,result:{artwork:[0,1,2], clearMargin:false, preservedDestination:false,
    inkCuts:[{source:0,pieces:partition.background.get(lower)}, {source:2,pieces:partition.strokes}],
  }}});
  if (scenario !== 'admit') {
    await expect(pending).rejects.toThrow('invalid paint drop');
    return;
  }
  const result = await pending;
  expect(result.artwork).toEqual([...partition.background.get(lower)!, protectedFill, ...partition.strokes]);
  expect(result.artwork[2]).toBe(protectedFill);
  expect(result.strokeReplacements?.get(edited.id)).toEqual(partition.strokes.map(s => s.id));
});

it('divides fresh stationary paint fragments after a mixed drop without touching protected or carried paint', async () => {
  const blue = {...fill('blue'),width:90}, red = {...fill('red'),fill:'#ff4400'};
  const protectedPaint = {...blue,id:'protected'};
  const exposed = {...blue,id:'exposed',x:50,width:70};
  const ink = {...movedInk('vertical',80,10,0),height:40,points:[{x:0,y:0},{x:0,y:40}]};
  const job = mergeEditedPiecesInWorker([blue,protectedPaint,red,ink],[red.id,ink.id],undefined,[blue.id],{cutPlacedInk:true});
  FakeWorker.instances[0].onmessage!({data:{id:1,result:{artwork:[exposed,1,2,3],clearMargin:false,preservedDestination:false}}});
  await vi.waitFor(()=>expect(FakeWorker.instances).toHaveLength(2));
  const second = FakeWorker.instances[1];
  const packet = second.postMessage.mock.calls[0][0] as {shapes:Vector[];joinedPaintInk:string[]};
  expect(packet).toMatchObject({shapes:[exposed,ink],joinedPaintInk:[ink.id]});
  const parts = partitionJoinedPaint(structuredClone(packet.shapes),new Set(packet.joinedPaintInk),mergeControlBounds);
  second.onmessage!({data:{id:1,result:parts}});
  const result = await job;
  const [a,b,protectedResult,carried] = result.artwork;
  expect(protectedResult).toBe(protectedPaint);
  expect(carried).toBe(red);
  for (const x of [72, 89]) expect([a,b].filter(s=>hit(s,{x,y:30},0))).toHaveLength(1);
  expect([a,b].find(s=>hit(s,{x:72,y:30},0))?.id).not.toBe([a,b].find(s=>hit(s,{x:89,y:30},0))?.id);
});

it.each([true,false])('cuts carried paint only with placed Pencil above it (%s)', async inkAbove => {
  const paint = { ...fill('carried'), kind:'ellipse' as const, width:80, height:40 };
  const pencil = movedInk('pencil', 15, 40, 115);
  const outside = { ...paint, id:'protected-carried-neighbor', x:250 };
  const artwork = inkAbove ? [outside,paint,pencil] : [outside,pencil,paint];
  const request = mergeEditedPiecesInWorker(artwork, [paint.id,pencil.id], undefined, [], {cutPlacedInk:true});
  FakeWorker.instances[0].onmessage!({data:{id:1,result:{artwork:[0,1,2],clearMargin:false,preservedDestination:false}}});
  if (!inkAbove) {
    expect((await request).artwork).toEqual(artwork);
    expect(FakeWorker.instances).toHaveLength(1);
    return;
  }
  await vi.waitFor(()=>expect(FakeWorker.instances).toHaveLength(2));
  const worker = FakeWorker.instances[1];
  const payload = worker.postMessage.mock.calls[0][0] as {shapes:Vector[];joinedPaintInk:string[];joinedPaintStackOrder:boolean};
  expect(payload).toMatchObject({shapes:[paint,pencil],joinedPaintInk:[pencil.id],joinedPaintStackOrder:true});
  const parts = partitionJoinedPaint(structuredClone(payload.shapes),new Set(payload.joinedPaintInk),mergeControlBounds,
    payload.joinedPaintStackOrder);
  worker.onmessage!({data:{id:1,result:parts}});
  const result = await request;
  expect(result.artwork[0]).toBe(outside);
  const faces = result.artwork.slice(1).filter(s=>!s.strokeWidth);
  const upper = faces.filter(s=>hit(s,{x:70,y:31},0)), lower = faces.filter(s=>hit(s,{x:70,y:49},0));
  expect(upper).toHaveLength(1);
  expect(lower).toHaveLength(1);
  expect(upper[0].id).not.toBe(lower[0].id);
  expect(faces.every(s=>s.contours?.some(ring=>ring.some(node=>node.in || node.out)))).toBe(true);
  expect(result.artwork.filter(s=>s.strokeWidth).every(s=>s.fillEnabled===false)).toBe(true);
});

it.each([false,true])('heals a departed divider before cutting at its final pose (malformed reply: %s)', async malformed => {
  const left = {...fill('left'),fillEnabled:true}, right = {...left,id:'right',x:50};
  const original = {...movedInk('divider',50,10,0),points:[{x:0,y:0},{x:0,y:40}],height:40};
  const moved = {...original,x:55}, protectedPaint = {...left,id:'protected',x:200};
  const shapes = [left,right,protectedPaint,moved];
  const job = mergeEditedPiecesInWorker(shapes,[moved.id],undefined,[left.id,right.id],{vacatedInk:[original]});
  const first = FakeWorker.instances[0];
  expect(first.postMessage.mock.calls[0][0]).toMatchObject({vacatedInk:{original:[original],eligible:[left.id,right.id]}});
  const healed = planVacatedInkHealing(shapes,[original],new Set([left.id,right.id]))!;
  expect(healed.artwork).toHaveLength(3);
  const [joined] = healed.artwork;
  first.onmessage!({data:{id:1,result:{artwork:[joined,2,3], absorbed:malformed ? [[protectedPaint.id,joined.id]] : [...healed.absorbed]}}});
  if (malformed) {
    await expect(job).rejects.toThrow('invalid divider healing');
    expect(FakeWorker.instances).toHaveLength(1);
    return;
  }
  await vi.waitFor(()=>expect(FakeWorker.instances).toHaveLength(2));
  const second = FakeWorker.instances[1];
  expect(second.postMessage.mock.calls[0][0]).toMatchObject({shapes:[joined,protectedPaint,moved],includeStraightPaint:true});
  const cut = partitionInkOverPaint([joined,protectedPaint,moved],moved,mergeControlBounds,new Set([joined.id]),true)!;
  second.onmessage!({data:{id:1,result:{artwork:[0,1,2],clearMargin:false,preservedDestination:false,inkCuts:[
    {source:0,pieces:cut.background.get(joined)},{source:2,pieces:cut.strokes},
  ]}}});
  const result = await job;
  expect(result.artwork[2]).toBe(protectedPaint);
  const leftFace = result.artwork.slice(0,2).filter(s=>hit(s,{x:54,y:30},0));
  const rightFace = result.artwork.slice(0,2).filter(s=>hit(s,{x:56,y:30},0));
  expect(leftFace).toHaveLength(1);
  expect(rightFace).toHaveLength(1);
  expect(leftFace[0].id).not.toBe(rightFace[0].id);
});
async function mixedDrop(ink:Vector[], change?:(response:ReturnType<typeof partitionJoinedPaint>)=>void) {
  const art=[target,protectedFill,source[3],...ink];
  const promise=mergeEditedPiecesInWorker(art,['a',...ink.map(s=>s.id)],undefined,[target.id]);
  FakeWorker.instances[0].onmessage!({data:{id:1,result:{
    artwork:[enlarged,1,...ink.map((_,i)=>i+3)],clearMargin:false,preservedDestination:false,
    absorbedFills:[intoTarget('a')],
  }}});
  await vi.waitFor(()=>expect(FakeWorker.instances).toHaveLength(2));
  const worker=FakeWorker.instances[1];
  const payload=worker.postMessage.mock.calls[0][0] as {shapes:Vector[];joinedPaintInk:string[]};
  expect(payload.shapes).toEqual([enlarged,...ink]);
  const packet=partitionJoinedPaint(structuredClone(payload.shapes),new Set(payload.joinedPaintInk),mergeControlBounds);
  change?.(packet);
  worker.onmessage!({data:{id:1,result:packet}});
  return promise;
}
it('cuts admitted Brush paint when an attached fill and its divider were both edited', async () => {
  const ink: Vector = { ...movedInk('divider', 40, 70, 230), kind: 'bezier', points: [],
    nodes: [{ x: 0, y: 0 }, { x: 230, y: 0 }] };
  const brush: Vector = { ...fill('brush'), kind: 'polygon', x: 110, y: 100, width: 90, height: 65,
    contours: [[{ x: 0, y: 0, out: { x: 30, y: -6 } }, { x: 90, y: 0, in: { x: 60, y: -6 } },
      { x: 90, y: 65 }, { x: 0, y: 65 }]], fillRule: 'evenodd', closed: true };
  const attached = { ...fill('attached'), x: 40, y: 45, width: 40, height: 25, fill: '#ff4400' };
  const bent = bendEdge(ink, 0, 0.5, { x: 0, y: 65 });
  const [coupled] = captureAttachedFillEdit([brush, attached, ink], [ink.id], true).prepare([bent]);
  expect(coupled).toBeDefined();
  const protectedPaint = { ...brush, id: 'excluded' };
  const artwork = [brush, coupled, protectedPaint, bent];
  const promise = mergeEditedPiecesInWorker(artwork, [coupled.id, bent.id], undefined,
    [brush.id, coupled.id, bent.id], { cutEditedInk: true });
  FakeWorker.instances[0].onmessage!({ data: { id: 1, result: {
    artwork: [0, 2, 1, 3], clearMargin: false, preservedDestination: false,
  } } });
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
  const worker = FakeWorker.instances[1];
  const request = worker.postMessage.mock.calls[0][0] as { shapes: Vector[]; joinedPaintInk: string[] };
  expect(request.shapes).toEqual([brush, bent]);
  const packet = partitionJoinedPaint(structuredClone(request.shapes), new Set(request.joinedPaintInk), mergeControlBounds);
  worker.onmessage!({ data: { id: 1, result: packet } });
  const result = await promise;
  expect(result.artwork[2]).toBe(coupled);
  expect(result.artwork[3]).toBe(protectedPaint);
  expect(result.fillReplacements?.get(brush.id)).toEqual(result.artwork.slice(0, 2).map(shape => shape.id));
  expect(result.strokeReplacements?.get(bent.id)).toEqual(result.artwork.slice(4).map(shape => shape.id));
});
it('cuts united paint with the moved Pencil while keeping the original layers and stroke style',async()=>{
  const through=movedInk('crossing',0,30,120);
  const result=await mixedDrop([through]);
  const faces=result.artwork.slice(0,2);
  expect(faces.every(s=>s.kind==='polygon' && s.fill===target.fill && !s.strokeWidth)).toBe(true);
  const above=faces.filter(s=>hit(s,{x:55,y:25},0)), below=faces.filter(s=>hit(s,{x:55,y:36},0));
  expect(above).toHaveLength(1);
  expect(below).toHaveLength(1);
  expect(above[0].id).not.toBe(below[0].id);
  expect(result.artwork[2]).toBe(protectedFill);
  const strokes=result.artwork.slice(3);
  expect(strokes).toHaveLength(3);
  expect(strokes.every(s=>s.fillEnabled===false && s.stroke===through.stroke && s.strokeWidth===2)).toBe(true);
  expect(result.strokeReplacements?.get(through.id)).toEqual(strokes.map(s=>s.id));
  expect(result.fillReplacements?.get(target.id)).toEqual(faces.map(s=>s.id));
});
it('keeps a dangling Pencil inside the united paint independently editable',async()=>{
  const dangling=movedInk('dangling',40,30,15);
  const result=await mixedDrop([dangling]);
  expect(result.artwork).toEqual([enlarged,protectedFill,dangling]);
  expect(result.artwork[2]).toBe(dangling);
});
it('subsequent moved Pencil cuts use the already divided faces',async()=>{
  const result=await mixedDrop([movedInk('first',0,25,120),movedInk('second',0,35,120)]);
  const faces=result.artwork.slice(0,3);
  for (const y of [22,30,38]) expect(faces.filter(s=>hit(s,{x:60,y},0))).toHaveLength(1);
  expect(new Set([22,30,38].map(y=>faces.find(s=>hit(s,{x:60,y},0))!.id)).size).toBe(3);
  expect(result.artwork[3]).toBe(protectedFill);
  expect(result.artwork.slice(4)).toHaveLength(6);
});
it('a malformed ink split cannot publish even the earlier fill union',async()=>{
  const before=structuredClone(source);
  await expect(mixedDrop([movedInk('crossing',0,30,120)],packet=>{
    packet[0].pieces[1].id=protectedFill.id;
  })).rejects.toThrow('invalid paint drop');
  expect(source).toEqual(before);
});
it('rejects a follow-up that replaces the united paint without its cutting ink',async()=>{
  await expect(mixedDrop([movedInk('crossing',0,30,120)],packet=>packet.pop())).rejects.toThrow('invalid paint drop');
});
it('does not start work for an already cancelled request', async () => {
  const c = new AbortController();
  c.abort();
  await expect(fitContoursInWorker([], [], 0.1, c.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(FakeWorker.instances).toHaveLength(0);
});
it('terminates cancelled work, removes listeners and ignores a queued late response', async () => {
  const c = new AbortController(),
    remove = vi.spyOn(c.signal, 'removeEventListener');
  const p = fitContoursInWorker([], [], 0.1, c.signal),
    w = FakeWorker.instances[0],
    late = w.onmessage!;
  const rejected = expect(p).rejects.toMatchObject({ name: 'AbortError' });
  c.abort();
  late({ data: { id: 1, result: { shapes: [] } } });
  await rejected;
  expect(w.terminate).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
it('ignores mismatched responses and cleans up successful work exactly once', async () => {
  const c = new AbortController(),
    p = fitContoursInWorker([], [], 0.1, c.signal),
    w = FakeWorker.instances[0];
  w.onmessage!({ data: { id: 2, result: { shapes: [] } } });
  expect(w.terminate).not.toHaveBeenCalled();
  w.onmessage!({ data: { id: 1, result: { shapes: [], fits: [] } } });
  await expect(p).resolves.toEqual({ shapes: [], fits: [] });
  c.abort();
  expect(w.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('terminates work on timeout and unreadable responses', async () => {
  const p = fitContoursInWorker([], []),
    rejected = expect(p).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  const q = fitContoursInWorker([], []),
    unreadable = expect(q).rejects.toThrow('could not be read');
  FakeWorker.instances[1].onmessageerror!();
  await unreadable;
  expect(vi.getTimerCount()).toBe(0);
});
it('cleans up when posting throws or the worker returns no result', async () => {
  const p = fitContoursInWorker([], []),
    w = FakeWorker.instances[0];
  w.onmessage!({ data: { id: 1 } });
  await expect(p).rejects.toThrow('no result');
  expect(w.terminate).toHaveBeenCalledOnce();
  class BrokenWorker extends FakeWorker {
    postMessage = vi.fn(() => {
      throw Error('clone failed');
    });
  }
  vi.stubGlobal('Worker', BrokenWorker);
  await expect(fitContoursInWorker([], [])).rejects.toThrow('clone failed');
  expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps the legacy region request exact while opting into artwork-aware selection', async () => {
  const request = {
    current: [],
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    mode: 'replace' as const,
  };
  const legacy = regionInWorker(request),
    old = FakeWorker.instances[0];
  expect(old.postMessage).toHaveBeenCalledWith({ id: 1, shapes: [], region: request });
  old.onmessage!({ data: { id: 1, result: [] } });
  await expect(legacy).resolves.toEqual([]);
  const selected = selectPaintRegionInWorker([], request, ['paint']),
    worker = FakeWorker.instances[1];
  expect(worker.postMessage).toHaveBeenCalledWith({
    id: 1,
    shapes: [],
    region: request,
    regionPaint: ['paint'],
  });
  worker.onmessage!({ data: { id: 1, result: {mask:[],footprint:[]} } });
  await expect(selected).resolves.toEqual({mask:[],footprint:[]});
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels artwork-aware selection and cannot publish its queued late response', async () => {
  const controller = new AbortController(),
    promise = selectPaintRegionInWorker(
      [],
      { current: [], polygon: [], mode: 'replace' },
      [],
      controller.signal,
    ),
    worker = FakeWorker.instances[0],
    late = worker.onmessage!;
  const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  late({ data: { id: 1, result: [] } });
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['cut', 'delete'] as const)('cancels paint region %s and ignores a late worker response', async action => {
  const controller = new AbortController();
  const start = () => action === 'cut'
    ? splitPaintRegionInWorker(source, [], [target.id], true, undefined, controller.signal)
    : deletePaintRegionInWorker(source, [], [target.id], controller.signal);
  const pending = start(), worker = FakeWorker.instances[0], late = worker.onmessage!;
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  late({ data: { id: 1, result: { inside: [target], outside: source.slice(1), artwork: source.slice(1), changed: true } } });
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  await expect(start()).rejects.toMatchObject({ name: 'AbortError' });
  expect(FakeWorker.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('forwards cancellation through cross-layer selection rebuilding and terminates the worker', async () => {
  const c = new AbortController(),
    pending = rebuildCurrentLayerInWorker([], ['picked'], true, c.signal),
    w = FakeWorker.instances[0];
  expect(w.postMessage).toHaveBeenCalledWith({
    id: 1,
    shapes: [],
    selectedArtwork: ['picked'],
    preserveStrokeCurves: true,
  });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  c.abort();
  await rejection;
  expect(w.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('rebuilds deletion without invalid empty selectedArtwork and rejects nonarray output', async () => {
  const p = rebuildCurrentLayerInWorker([], [], false),
    w = FakeWorker.instances[0];
  expect(w.postMessage).toHaveBeenCalledWith({ id: 1, shapes: [], preserveStrokeCurves: false });
  w.onmessage!({ data: { id: 1, result: [] } });
  await expect(p).resolves.toEqual({ artwork: [], selected: [] });
  const q = rebuildCurrentLayerInWorker([], [], true);
  FakeWorker.instances[1].onmessage!({ data: { id: 1, result: {} } });
  await expect(q).rejects.toThrow('invalid layer artwork');
  expect(vi.getTimerCount()).toBe(0);
});
