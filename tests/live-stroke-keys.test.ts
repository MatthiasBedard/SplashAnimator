import { expect, it, vi } from 'vitest';
import { liveSplitFixture } from './live-motion-split-fixture';
import { splitLiveMotionLayer } from '../packages/animation/src/live-motion-split';
import { prepareUpdateLiveMotionSpans } from '../packages/animation/src/live-motion';
import { sampleMotionFrame } from '../packages/animation/src/motion-frames';
import { prepareTimelineFrameInsertion } from '../apps/editor/src/timeline-keyframe';
import { transferFrameBlock } from '../packages/animation/src/timeline';

import {setRememberedIntervalTiming, setRememberedPositionTiming, reverseBasicMotionSpan, createBasicMotionSpan, setRememberedRotationOrShearKey, setRememberedScaleKey, setRememberedColorKey, refreshBasicMotionSpan, setRememberedPositionKey, setRememberedOpacityKey, retimeBasicMotionSpan, splitBasicMotionSpan} from '../packages/animation/src/motion-spans';
it('remembers independent positions across regeneration, split, retime and key removal',()=>{
  const p=liveSplitFixture(),l=p.layers[0]; delete l.liveMotionSpans;
  createBasicMotionSpan(p,['track'],0,8,'linear');
  setRememberedPositionKey(p,['track'],0,8,'x',2,80);
  setRememberedPositionKey(p,['track'],0,8,'y',4,52);
  refreshBasicMotionSpan(p,['track'],0,8);
  expect(l.keys[2].shapes[0]).toMatchObject({x:80,y:32});
  expect(l.keys[4].shapes[0].y).toBe(52);
  expect(()=>refreshBasicMotionSpan(p,['track'],0,8,undefined,{startX:2,startY:2,endX:-2,endY:-2})).toThrow(/path/);
  const timed=structuredClone(p);
  retimeBasicMotionSpan(timed,['track'],0,8,5);
  expect(timed.layers[0].motionSpans![0]).toMatchObject({xKeys:[{offset:1,value:80}],yKeys:[{offset:2,value:52}]});
  const split=structuredClone(p); splitBasicMotionSpan(split,['track'],0,8,4,true);
  expect(split.layers[0].keys).toEqual(l.keys);
  const reversed=structuredClone(p);
  reverseBasicMotionSpan(reversed,['track'],0,8);
  expect(reversed.layers[0].motionSpans![0]).toMatchObject({xKeys:[{offset:6,value:80}],yKeys:[{offset:4,value:52}]});
  refreshBasicMotionSpan(reversed,['track'],0,8);
  expect(reversed.layers[0].keys[6].shapes[0]).toMatchObject({x:80,y:32});
  expect(()=>setRememberedPositionKey(p,['track'],0,8,'x',3,Infinity)).toThrow();
  setRememberedPositionKey(p,['track'],0,8,'x',2,null);
  expect(l.keys[2].shapes[0]).toMatchObject({x:28,y:32});
  expect(l.motionSpans![0].xKeys).toBeUndefined();
  l.keys[2].shapes[0].x=777;
  expect(()=>setRememberedPositionKey(p,['track'],0,8,'y',4,null)).toThrow(/Generated keys changed/);
});
it('remembers and refreshes opacity keys and protects manual edits on every selected track',()=>{
  const p=liveSplitFixture();
  const l=p.layers[0]; delete l.liveMotionSpans;
  createBasicMotionSpan(p,['track'],0,8,'in');
  const outside=structuredClone(l.keys.at(-1));
  setRememberedOpacityKey(p,['track'],0,8,2,0);
  expect(l.keys[2].shapes[0].opacity).toBe(0);
  l.keys[0].shapes[0].opacity=0.6;
  expect(()=>setRememberedOpacityKey(p,['track'],0,8,3,0.5)).toThrow(/Refresh/);
  refreshBasicMotionSpan(p,['track'],0,8);
  expect(l.keys[1].shapes[0].opacity).toBeCloseTo(0.3);
  expect(l.keys.at(-1)).toEqual(outside);
  const split=structuredClone(p);
  splitBasicMotionSpan(split,['track'],0,8,4,true);
  expect(split.layers[0].motionSpans!.map(s=>s.opacityKeys)).toEqual([[{offset:2,value:0}],[]]);
  const timed=structuredClone(p);
  retimeBasicMotionSpan(timed,['track'],0,8,5);
  expect(timed.layers[0].motionSpans![0].opacityKeys).toEqual([{offset:1,value:0}]);
  p.layers.push({...structuredClone(l),id:'other'});
  p.layers[1].keys[3].shapes[0].x+=4;
  const prior=structuredClone(p);
  expect(()=>setRememberedOpacityKey(p,['track','other'],0,8,4,0.5)).toThrow(/Generated keys changed/);
  expect(p).toEqual(prior);
});
function fixture() {
  return liveSplitFixture((p, span) => {
    span.ease = 'in';
    span.options = { strokeColor: true };
    span.strokeColorKeys = [
      { offset: 2, color: '#404040' },
      { offset: 6, color: '#808080' },
    ];
    p.layers[0].keys[1].shapes[0].stroke = '#a0a0a0';
  });
}
it('scales each reflected affine axis on its own schedule and preserves shear and endpoint metadata', () => {
  const p=liveSplitFixture((project,span)=>{
    span.options={affine:true};
    for (const key of project.layers[0].keys.slice(0,2)) key.shapes[0].transform=[1,0,0.25,-1];
    span.scaleXKeys=[{offset:2,value:2}];
    span.sxKeyEases=['in','linear'];span.syKeyEases=['out','in'];
    span.scaleYKeys=[{offset:4,value:-3}];
  });
  const span=p.layers[0].liveMotionSpans![0];
  expect(sampleMotionFrame(p,'track',span,1)[0].transform).toEqual([1.25,0,0.25,-1.875]);
  expect(sampleMotionFrame(p,'track',span,2)[0].transform).toEqual([2,0,0.25,-2.5]);
  expect(sampleMotionFrame(p,'track',span,4)[0].transform![3]).toBe(-3);
  const split=prepareTimelineFrameInsertion(p,'track',2,'key');
  for(let at=0;at<=8;at++){
    const half=split.layers[0].liveMotionSpans![at<=2?0:1];
    const basis=sampleMotionFrame(split,'track',half,at)[0].transform!;
    sampleMotionFrame(p,'track',span,at)[0].transform!.forEach((v,i)=>expect(basis[i]).toBeCloseTo(v,12));
  }
  const shifted=prepareTimelineFrameInsertion(p,'track',2,'frame').layers[0].liveMotionSpans![0];
  expect(shifted.scaleXKeys).toEqual(span.scaleXKeys);
  expect(shifted.scaleYKeys).toEqual([{offset:5,value:-3}]);
  for(const changes of [{scaleYKeys:[{offset:3,value:1}]},{scaleXKeys:[{offset:3,value:0}]},
    {scaleXKeys:[{offset:3,value:1e-6}],scaleYKeys:[{offset:3,value:-1e-6}]},
    {options:{affine:false}},{scaleYKeys:[{offset:3,value:-100001}]}])
    expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes}])).toThrow();
  expect(sampleMotionFrame(p,'track',span,0)[0]).toEqual(p.layers[0].keys[0].shapes[0]);
});
it('rejects an eased scale interval that slips below the determinant threshold between valid integer frames', () => {
  const p=liveSplitFixture((project,span)=>{
    span.options={affine:true}; span.ease='in';
    project.layers[0].keys[0].shapes[0].transform=[0.01,0,0,1e-8];
    project.layers[0].keys[1].shapes[0].transform=[1,0,0,1];
  });
  const span=p.layers[0].liveMotionSpans![0];
  const determinant = (f:number) => {
    const x = f<=1 ? 0.01*(1-f)+1e-8*f : 1e-8+(1-1e-8)*(f-1)/7;
    const t = (f/8)**2;
    return x*((1-t)*1e-8+t);
  };
  for(let f=0;f<=8;f++) expect(determinant(f)).toBeGreaterThanOrEqual(1e-10);
  expect(determinant(1e-7)).toBeLessThan(1e-10);
  expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes:{
    scaleXKeys:[{offset:1,value:1e-8}]
  }}])).toThrow(/nonsingular/);
  expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes:{
    ease:'linear',scaleXKeys:[{offset:1,value:1e-8}],scaleYKeys:[],syKeyEases:['in']
  }}])).toThrow(/nonsingular/);
  expect(span.scaleXKeys).toBeUndefined();
});
it('preserves signed full turns and reversals across a split and restores saved direction on removal', () => {
  const p=liveSplitFixture((project,span)=>{
    span.rotation={direction:'clockwise',turns:1};
    span.options={affine:true};
    for(const key of project.layers[0].keys.slice(0,2)) key.shapes[0].transform=[0,1,1,0];
    span.rotationKeys=[{offset:2,value:450},{offset:6,value:-270}];
  });
  const span=p.layers[0].liveMotionSpans![0];
  const angle=(frame:number)=>sampleMotionFrame(p,'track',span,frame)[0].rotation;
  expect([1,2,3,4,5,6,7].map(angle)).toEqual([270,450,270,90,-90,-270,-90]);
  const split=prepareTimelineFrameInsertion(p,'track',3,'key');
  for(let at=0;at<=8;at++){
    const half=split.layers[0].liveMotionSpans![at<=3?0:1];
    const before=sampleMotionFrame(p,'track',span,at)[0], after=sampleMotionFrame(split,'track',half,at)[0];
    expect(after.rotation).toBe(before.rotation);
    expect(after.transform).toEqual(before.transform);
    expect(after.x).toBeCloseTo(before.x,12);
    expect(after.y).toBeCloseTo(before.y,12);
  }
  const shifted=prepareTimelineFrameInsertion(p,'track',2,'frame');
  expect(shifted.layers[0].liveMotionSpans![0].rotationKeys?.map(k=>k.offset)).toEqual([2,7]);
  for(const changes of [{path:{startX:1,startY:1,endX:-1,endY:-1,tangent:true}},{rotationKeys:[{offset:4,value:Number.MAX_VALUE}]}])
    expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes}])).toThrow();
  const cleared=prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes:{rotationKeys:undefined}}]);
  const restored=cleared.layers[0].liveMotionSpans![0];
  expect(restored.rotation).toEqual(span.rotation);
  expect(sampleMotionFrame(cleared,'track',restored,4)[0].rotation).toBe(270);
});
it('keys signed shear independently of rotation and reflected scale and preserves the split pose', () => {
  const p = liveSplitFixture((project,span)=>{
    span.options={affine:true};
    span.scaleYKeys=[{offset:4,value:-3}];
    span.shearKeys=[{offset:2,value:2},{offset:6,value:-2}];
    for(const key of project.layers[0].keys.slice(0,2)) key.shapes[0].transform=[0,2,1,0.5];
  });
  const span=p.layers[0].liveMotionSpans![0];
  const sample=(at:number)=>sampleMotionFrame(p,'track',span,at)[0];
  expect(sample(2)).toMatchObject({rotation:90,transform:[2,0,2,-2]});
  expect(sample(4)).toMatchObject({rotation:90,transform:[2,0,0,-3]});
  expect(sample(6)).toMatchObject({rotation:90,transform:[2,0,-2,-2]});
  const split=prepareTimelineFrameInsertion(p,'track',4,'key');
  for(let at=0;at<=8;at++){
    const half=split.layers[0].liveMotionSpans![at<=4?0:1];
    expect(sampleMotionFrame(split,'track',half,at)[0].transform).toEqual(sample(at).transform);
  }
  const shifted=prepareTimelineFrameInsertion(p,'track',2,'frame');
  expect(shifted.layers[0].liveMotionSpans![0].shearKeys?.map(k=>k.offset)).toEqual([2,7]);
  for(const changes of [{options:{}},{shearKeys:[{offset:4,value:100001}]},{shearKeys:[{offset:3,value:NaN}]}])
    expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes}])).toThrow();
  const cleared=prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes:{shearKeys:undefined}}]);
  const restored=cleared.layers[0].liveMotionSpans![0];
  expect(sampleMotionFrame(cleared,'track',restored,4)[0].transform).toEqual([2,0,0.5,-3]);
});
it('rejects a shear endpoint whose original matrix components fit but whose decomposed shear exceeds the document limit', () => {
  expect(()=>liveSplitFixture((project,span)=>{
    span.options={affine:true};
    span.shearKeys=[{offset:4,value:0}];
    for(const key of project.layers[0].keys.slice(0,2)) key.shapes[0].transform=[1,1,100000,99999];
  })).toThrow(/Endpoint shear/);
});
it('keys one matched hard-edge occurrence across unequal endpoint gradients and keeps the other stops intact', () => {
  const p=liveSplitFixture((project,span)=>{
    span.options={paint:true,gradientStops:true};
    for(const [i,key] of project.layers[0].keys.slice(0,2).entries()){
      key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[
        {offset:0,color:'#000000'}, {offset:0.5,color:'#000000'},
        ...(i ? [] : [{offset:0.5,color:'#000000'}]),{offset:1,color:'#ffffff'}]};
    }
    span.gradientColorTracks=[{stop:2,keys:[{offset:4,color:'#008000'}],eases:['in','out']}];
  });
  const span=p.layers[0].liveMotionSpans![0];
  expect(sampleMotionFrame(p,'track',span,2)[0].gradient!.stops.map(s=>s.color)).toEqual(['#000000','#000000','#002000','#ffffff']);
  const stops=sampleMotionFrame(p,'track',span,4)[0].gradient!.stops;
  expect(stops.map(s=>s.color)).toEqual(['#000000','#000000','#008000','#ffffff']);
  const split=prepareTimelineFrameInsertion(p,'track',4,'key');
  for(let at=0;at<=8;at++){
    const half=split.layers[0].liveMotionSpans![at<=4?0:1];
    expect(sampleMotionFrame(split,'track',half,at)[0].gradient).toEqual(sampleMotionFrame(p,'track',span,at)[0].gradient);
  }
  const shifted=prepareTimelineFrameInsertion(p,'track',2,'frame');
  expect(shifted.layers[0].liveMotionSpans![0].gradientColorTracks![0].keys[0].offset).toBe(5);
  for(const changes of [{gradientColorTracks:[{stop:0,keys:[],eases:['in','out'] as const}]},{gradientColorTracks:[{stop:4,keys:[]}]},{gradientColorTracks:[{stop:0,keys:[{offset:1,color:'red'}]}]},
    {options:{paint:true,gradientStops:false}}])
    expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes}])).toThrow();
  expect(sampleMotionFrame(p,'track',span,8)[0].gradient!.stops).toHaveLength(3);
});
it('weights keyed gradient RGB by endpoint opacity while leaving the opacity curve alone', () => {
  const p=liveSplitFixture((project,span)=>{
    span.options={paint:true,gradientPremultiplied:true};
    for(const [i,key] of project.layers[0].keys.slice(0,2).entries())
      key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:'#ff0000',opacity:i},{offset:1,color:'#ffffff'}]};
    span.gradientColorTracks=[{stop:0,keys:[{offset:4,color:'#00ff00'}],eases:['linear','out']}];
  });
  const span=p.layers[0].liveMotionSpans![0],stops=sampleMotionFrame(p,'track',span,2)[0].gradient!.stops;
  expect(stops[0]).toEqual({offset:0,color:'#00ff00',opacity:0.25});
  expect(sampleMotionFrame(p,'track',span,6)[0].gradient!.stops[0]).toEqual({offset:0,color:'#db2400',opacity:0.75});
  expect(stops[1].color).toBe('#ffffff');
});
it('keys opacity on a motion path, splits and retimes its fade, then restores endpoint easing', () => {
  const p = liveSplitFixture((project, span) => {
    delete project.layers[0].keys[0].shapes[0].opacity;
    project.layers[0].keys[1].shapes[0].opacity = 0;
    span.opacityEase = 'in';
    span.path = {startX:16,startY:4,endX:-12,endY:3};
    span.opacityKeys = [{offset:2,value:0.25},{offset:6,value:0.25}];
  });
  const span = p.layers[0].liveMotionSpans![0];
  const sample = (at:number) => sampleMotionFrame(p,'track',span,at)[0];
  expect(sample(0).opacity).toBeUndefined();
  expect(sample(1).opacity).toBe(0.625);
  expect(sample(4).opacity).toBe(0.25);
  expect(sample(8).opacity).toBe(0);
  const split = prepareTimelineFrameInsertion(p,'track',4,'key');
  for(let at=0;at<=8;at++) {
    const half = split.layers[0].liveMotionSpans![at<=4 ? 0 : 1];
    expect(sampleMotionFrame(split,'track',half,at)[0].opacity).toBe(sample(at).opacity);
  }
  const shifted = prepareTimelineFrameInsertion(p,'track',2,'frame');
  expect(shifted.layers[0].liveMotionSpans![0].opacityKeys?.map(k=>k.offset)).toEqual([2,7]);
  const change = (value?:number) => prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes:{opacityKeys:value===undefined ? undefined : [{offset:2,value}]}}]);
  for(const invalid of [-0.01,1.01,NaN,Infinity]) expect(()=>change(invalid)).toThrow();
  const restored = change();
  const original = sampleMotionFrame(restored,'track',restored.layers[0].liveMotionSpans![0],4)[0];
  expect(original.opacity).toBeGreaterThan(0.5);
  expect([original.x,original.y]).toEqual([sample(4).x,sample(4).y]);
});
it('samples, holds, splits and retimes independent X/Y keys', () => {
  const p = liveSplitFixture((_project, span) => {
    span.xKeys = [{offset:2,value:80}, {offset:4,value:80}];
    span.yKeys = [{offset:4,value:52}];
  });
  const span = p.layers[0].liveMotionSpans![0];
  function position(project: typeof p, at: number) {
    const recipe = project.layers[0].liveMotionSpans!.find(s => s.start <= at && at <= s.end)!;
    const {x,y} = sampleMotionFrame(project,'track',recipe,at)[0];
    return [x,y];
  }
  expect(position(p,2)).toEqual([80,32]);
  expect(position(p,3)).toEqual([80,42]);
  expect(position(p,6)).toEqual([84,32]);
  const split = prepareTimelineFrameInsertion(p,'track',4,'key');
  for(let frame=0;frame<=8;frame++) expect(position(split,frame)).toEqual(position(p,frame));
  const shifted = prepareTimelineFrameInsertion(p,'track',2,'frame').layers[0].liveMotionSpans![0];
  expect(shifted.xKeys?.map(k=>k.offset)).toEqual([2,5]);
  expect(shifted.yKeys?.map(k=>k.offset)).toEqual([5]);
  for (const changes of [{path:{startX:1,startY:0,endX:1,endY:0}}, {xKeys:[{offset:3,value:NaN}]}]) {
    expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:span.id,changes}])).toThrow();
  }
  expect(position(p,2)).toEqual([80,32]);
});
it('splits and inserts time for coexisting fill and stroke keys independently', () => {
  const p = fixture(),
    span = p.layers[0].liveMotionSpans![0];
  span.options!.paint = true;
  span.fillColorKeys = [{ offset: 4, color: '#7f0000' }];
  const inserted = prepareTimelineFrameInsertion(p, 'track', 3, 'frame');
  const retimed = inserted.layers[0].liveMotionSpans![0];
  expect(retimed.fillColorKeys?.map((key) => key.offset)).toEqual([5]);
  expect(retimed.strokeColorKeys?.map((key) => key.offset)).toEqual([2, 7]);
  const split = prepareTimelineFrameInsertion(p, 'track', 4, 'key');
  const halves = split.layers[0].liveMotionSpans!;
  expect(halves.map((s) => s.fillColorKeys)).toEqual([[], []]);
  expect(halves.map((s) => s.strokeColorKeys?.map((key) => key.offset))).toEqual([[2], [2]]);
  for (let at = 0; at <= 8; at++) {
    const [before] = sampleMotionFrame(p, 'track', span, at);
    const [after] = sampleMotionFrame(split, 'track', halves[at <= 4 ? 0 : 1], at);
    expect([after.fill, after.stroke]).toEqual([before.fill, before.stroke]);
  }
});

it.each(['gradient', 'bitmap', 'disabled'])(
  'rejects a later %s fill without publishing an earlier valid edit',
  (kind) => {
    const p = fixture();
    const other = { ...structuredClone(p.layers[0]), id: 'later' };
    p.layers.push(other);
    if (kind === 'bitmap')
      p.assets = [
        {
          id: 'paper',
          path: 'assets/bitmaps/paper.json',
          bitmap: { name: 'Paper', width: 2, height: 2 },
        },
      ];
    for (const key of other.keys.slice(0, 2)) {
      const shape = key.shapes[0];
      if (kind === 'gradient')
        shape.gradient = {
          kind: 'linear',
          from: { x: 0, y: 0 },
          to: { x: 20, y: 0 },
          stops: [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#ffffff' },
          ],
        };
      if (kind === 'bitmap') shape.bitmap = { assetId: 'paper', x: 0, y: 0, width: 2, height: 2 };
      if (kind === 'disabled') shape.fillEnabled = false;
    }
    const before = structuredClone(p);
    expect(() =>
      prepareUpdateLiveMotionSpans(
        p,
        p.layers.map((layer) => ({
          layerId: layer.id,
          spanId: 'live',
          changes: {
            options: { strokeColor: true, paint: true },
            fillColorKeys: [{ offset: 2, color: '#00ff00' }],
          },
        })),
      ),
    ).toThrow(/solid fill/);
    expect(p).toEqual(before);
  },
);
it('samples independent key times and partitions keys on a preserved split', () => {
  const p = fixture(),
    split = prepareTimelineFrameInsertion(p, 'track', 4, 'key');
  const [left, right] = split.layers[0].liveMotionSpans!;
  expect(left.strokeColorKeys).toEqual([{ offset: 2, color: '#404040' }]);
  expect(right.strokeColorKeys).toEqual([{ offset: 2, color: '#808080' }]);
  expect(split.layers[0].keys[1].shapes[0].stroke).toBe('#606060');
  for (let frame = 0; frame <= 8; frame++) {
    const sample = sampleMotionFrame(split, 'track', frame <= 4 ? left : right, frame)[0];
    expect(sample.stroke).toBe(
      sampleMotionFrame(p, 'track', p.layers[0].liveMotionSpans![0], frame)[0].stroke,
    );
  }
});
it('rejects an endpoint move across a fill key even when all stroke keys still fit', () => {
  const p = fixture(), span = p.layers[0].liveMotionSpans![0];
  span.options!.paint = true;
  span.fillColorKeys = [{offset:7,color:'#00ff00'}];
  const original = structuredClone(p);
  expect(() => transferFrameBlock(p,[{sourceId:'track',targetId:'track'}],8,8,7))
    .toThrow(/cross an interior fill color key/);
  expect(p).toEqual(original);
});
it('inserting time shifts only later property keys, and moving an endpoint cannot discard one', () => {
  const p = fixture(),
    inserted = prepareTimelineFrameInsertion(p, 'track', 2, 'frame');
  expect(inserted.layers[0].liveMotionSpans![0].strokeColorKeys?.map((key) => key.offset)).toEqual([
    2, 7,
  ]);
  const original = structuredClone(p);
  expect(() => transferFrameBlock(p, [{ sourceId: 'track', targetId: 'track' }], 8, 8, 5)).toThrow(
    /cross an interior/,
  );
  expect(p).toEqual(original);
});
it('rejects later-track invalid key times and original accessor input without consuming an edit', () => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  const before = structuredClone(p);
  const request = (id: string, offset: number) => ({
    layerId: id,
    spanId: 'live',
    changes: { strokeColorKeys: [{ offset, color: '#abcdef' }] },
  });
  expect(() => prepareUpdateLiveMotionSpans(p, [request('track', 3), request('later', 8)])).toThrow(
    /interior/,
  );
  const invalid = request('track', 2);
  Object.defineProperty(invalid.changes.strokeColorKeys[0], 'color', {
    get() {
      throw Error('getter invoked');
    },
  });
  expect(() => prepareUpdateLiveMotionSpans(p, [invalid])).toThrow(/accessor|data field/);
  expect(p).toEqual(before);
});

it('rejects a modified detached color key before exposing any sampled artwork', () => {
  const p = fixture(),
    span = p.layers[0].liveMotionSpans![0];
  const copy = structuredClone;
  const mock = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
    const result = copy(value);
    if (value === span.strokeColorKeys && Array.isArray(result)) result[0].color = '#ffffff';
    return result;
  });
  try {
    expect(() => sampleMotionFrame(p, 'track', span, 2)).toThrow(/Stroke key capture changed/);
    expect(span.strokeColorKeys![0].color).toBe('#404040');
  } finally {
    mock.mockRestore();
  }
});

it('refreshes, partitions, reverses and removes remembered fill and stroke independently',()=>{
  const p=liveSplitFixture(),l=p.layers[0]; delete l.liveMotionSpans;
  for(const key of l.keys.slice(0,2)) Object.assign(key.shapes[0],{fill:'#000000',stroke:'#000000'});
  createBasicMotionSpan(p,['track'],0,8,'linear',{paint:true,strokeColor:true});
  setRememberedColorKey(p,['track'],0,8,'fill',2,'#600000');
  setRememberedColorKey(p,['track'],0,8,'stroke',4,'#008000');
  refreshBasicMotionSpan(p,['track'],0,8);
  expect(l.keys[2].shapes[0]).toMatchObject({fill:'#600000',stroke:'#004000'});
  const divided=structuredClone(p); splitBasicMotionSpan(divided,['track'],0,8,4,true);
  expect(divided.layers[0].keys).toEqual(l.keys);
  const reversed=structuredClone(p); reverseBasicMotionSpan(reversed,['track'],0,8);
  expect(reversed.layers[0].motionSpans![0].fillColorKeys).toEqual([{offset:6,color:'#600000'}]);
  const timed=structuredClone(p); retimeBasicMotionSpan(timed,['track'],0,8,5);
  expect(timed.layers[0].motionSpans![0].strokeColorKeys).toEqual([{offset:2,color:'#008000'}]);
  setRememberedColorKey(p,['track'],0,8,'fill',2,null);
  expect(l.keys[2].shapes[0]).toMatchObject({fill:'#000000',stroke:'#004000'});
  p.layers.push({...structuredClone(l),id:'later'}); p.layers[1].keys[3].shapes[0].x++;
  const before=structuredClone(p);
  expect(()=>setRememberedColorKey(p,['track','later'],0,8,'stroke',4,null)).toThrow(/Generated keys changed/);
  expect(p).toEqual(before);
});
it('requires the saved fill option independently of stroke interpolation',()=>{
  const p=liveSplitFixture(),l=p.layers[0]; delete l.liveMotionSpans;
  createBasicMotionSpan(p,['track'],0,8,'linear',{strokeColor:true});
  setRememberedColorKey(p,['track'],0,8,'stroke',3,'#abcdef');
  const before=structuredClone(p);
  expect(()=>setRememberedColorKey(p,['track'],0,8,'fill',4,'#123456')).toThrow(/color interpolation/);
  expect(p).toEqual(before);
});

it('remembers signed scale on independent axes and rejects a reflection change atomically',()=>{
  const p=liveSplitFixture(),l=p.layers[0]; delete l.liveMotionSpans;
  for(const key of l.keys.slice(0,2)) key.shapes[0].transform=[1,0,0.5,-1];
  createBasicMotionSpan(p,['track'],0,8,'linear',{affine:true});
  setRememberedScaleKey(p,['track'],0,8,'x',2,4);
  setRememberedScaleKey(p,['track'],0,8,'y',4,-3);
  setRememberedIntervalTiming(p,['track'],0,8,'sy',4,'in');
  const reversed=structuredClone(p);reverseBasicMotionSpan(reversed,['track'],0,8);
  refreshBasicMotionSpan(reversed,['track'],0,8);
  expect(reversed.layers[0].keys[6].shapes[0].transform![3]).toBe(-1.5);
  const retimed=structuredClone(p);retimeBasicMotionSpan(retimed,['track'],0,8,5);
  expect(retimed.layers[0].keys[1].shapes[0].transform![3]).toBe(-1.5);
  refreshBasicMotionSpan(p,['track'],0,8);
  expect(l.keys[2].shapes[0].transform).toEqual([4,0,0.5,-1.5]);
  const before=structuredClone(p);
  expect(()=>setRememberedScaleKey(p,['track'],0,8,'y',5,1)).toThrow(/reflection/);
  expect(()=>setRememberedScaleKey(p,['track'],0,8,'x',4,0)).toThrow();
  expect(()=>setRememberedScaleKey(p,['track'],0,8,'x',4,1e-15)).toThrow(/nonsingular/);
  expect(p).toEqual(before);
  const split=structuredClone(p); splitBasicMotionSpan(split,['track'],0,8,4,true);
  expect(split.layers[0].keys).toEqual(l.keys);
  setRememberedScaleKey(p,['track'],0,8,'x',2,null);
  expect(l.keys[2].shapes[0].transform).toEqual([1,0,0.5,-1.5]);
});

it('rejects independently eased remembered scales that lose determinant safety between frames',()=>{
  const p=liveSplitFixture(),l=p.layers[0]; delete l.liveMotionSpans;
  l.keys[0].shapes[0].transform=[0.01,0,0,1e-8];
  l.keys[1].shapes[0].transform=[1,0,0,1];
  createBasicMotionSpan(p,['track'],0,8,'linear',{affine:true});
  setRememberedScaleKey(p,['track'],0,8,'x',1,1e-8);
  setRememberedScaleKey(p,['track'],0,8,'y',4,0.5);
  const before=structuredClone(p);
  expect(()=>setRememberedIntervalTiming(p,['track'],0,8,'sy',4,'in')).toThrow(/nonsingular/);
  expect(p).toEqual(before);
});

it('rejects a scale key on a later non-affine recipe without changing the first track',()=>{
  const p=liveSplitFixture(), l=p.layers[0]; delete l.liveMotionSpans;
  p.layers.push({...structuredClone(l),id:'plain'});
  createBasicMotionSpan(p,['track'],0,8,'linear',{affine:true});
  createBasicMotionSpan(p,['plain'],0,8,'linear');
  const before=structuredClone(p);
  expect(()=>setRememberedScaleKey(p,['track','plain'],0,8,'y',3,2)).toThrow(/affine/);
  expect(p).toEqual(before);
});

it('preserves remembered full turns, signed shear and reflected scale through subdivision',()=>{
  const p=liveSplitFixture(), l=p.layers[0]; delete l.liveMotionSpans;
  for(const key of l.keys.slice(0,2)) key.shapes[0].transform=[1,0,0,-1];
  createBasicMotionSpan(p,['track'],0,8,'linear',{affine:true},undefined,{direction:'clockwise',turns:1});
  setRememberedRotationOrShearKey(p,['track'],0,8,'rotation',2,-540);
  setRememberedRotationOrShearKey(p,['track'],0,8,'shear',4,-2);
  refreshBasicMotionSpan(p,['track'],0,8);
  expect(l.keys[2].shapes[0]).toMatchObject({rotation:-540,transform:[1,0,-1,-1]});
  expect(l.keys[4].shapes[0].rotation).toBe(-360);
  const split=structuredClone(p); splitBasicMotionSpan(split,['track'],0,8,4,true);
  expect(split.layers[0].keys).toEqual(l.keys);
  const original=structuredClone(p);
  expect(()=>setRememberedRotationOrShearKey(p,['track'],0,8,'rotation',1,Number.MAX_VALUE)).toThrow(/angle/);
  expect(()=>setRememberedRotationOrShearKey(p,['track'],0,8,'shear',1,100001)).toThrow(/limit/);
  expect(p).toEqual(original);
  setRememberedRotationOrShearKey(p,['track'],0,8,'rotation',2,null);
  expect(l.keys[2].shapes[0]).toMatchObject({rotation:90,transform:[1,0,-1,-1]});
});
it('rejects tangent heading conflicts and shear without affine, while ordinary rotation remains keyable',()=>{
  const p=liveSplitFixture(),l=p.layers[0]; delete l.liveMotionSpans;
  createBasicMotionSpan(p,['track'],0,8,'linear',undefined,{startX:10,startY:0,endX:-10,endY:0,tangent:true});
  const before=structuredClone(p);
  expect(()=>setRememberedRotationOrShearKey(p,['track'],0,8,'rotation',2,90)).toThrow(/heading/);
  expect(()=>setRememberedRotationOrShearKey(p,['track'],0,8,'shear',4,2)).toThrow(/affine/);
  expect(p).toEqual(before);
  const plain=liveSplitFixture();delete plain.layers[0].liveMotionSpans;
  createBasicMotionSpan(plain,['track'],0,8,'linear');
  setRememberedRotationOrShearKey(plain,['track'],0,8,'rotation',2,720);
  expect(plain.layers[0].keys[1].shapes[0].rotation).toBe(360);
});

it('keys the matched hard-edge occurrence of an unequal remembered gradient through split and removal',()=>{
  const p=liveSplitFixture(),layer=p.layers[0];delete layer.liveMotionSpans;
  for(const [i,key] of layer.keys.slice(0,2).entries()){
    key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[
      {offset:0,color:'#000000'}, {offset:0.5,color:'#000000'},
      ...(i?[]:[{offset:0.5,color:'#000000'}]), {offset:1,color:'#ffffff'}]};
  }
  createBasicMotionSpan(p,['track'],0,8,'linear',{paint:true,gradientStops:true});
  const original=structuredClone(layer.keys);
  setRememberedColorKey(p,['track'],0,8,2,4,'#008000');
  setRememberedColorKey(p,['track'],0,8,0,2,'#600000');
  setRememberedIntervalTiming(p,['track'],0,8,2,4,'in');
  expect(layer.keys[2].shapes[0].gradient!.stops[2].color).toBe('#002000');
  refreshBasicMotionSpan(p,['track'],0,8);
  expect(layer.keys[4].shapes[0].gradient!.stops.map(s=>s.color)).toEqual(['#400000','#000000','#008000','#ffffff']);
  const split=structuredClone(p);splitBasicMotionSpan(split,['track'],0,8,4,true);
  expect(split.layers[0].keys).toEqual(layer.keys);
  const before=structuredClone(p);
  expect(()=>setRememberedColorKey(p,['track'],0,8,4,3,'#123456')).toThrow(/missing/);
  expect(p).toEqual(before);
  setRememberedColorKey(p,['track'],0,8,2,4,null);
  expect(layer.motionSpans![0].gradientColorTracks).toEqual([{stop:0,keys:[{offset:2,color:'#600000'}]}]);
  setRememberedColorKey(p,['track'],0,8,0,2,null);
  expect(layer.keys).toEqual(original);
});
it('weights remembered stop colors using the original opacity curve',()=>{
  const p=liveSplitFixture(),layer=p.layers[0];delete layer.liveMotionSpans;
  for(const [i,key] of layer.keys.slice(0,2).entries()) key.shapes[0].gradient={
    kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:'#ff0000',opacity:i},{offset:1,color:'#ffffff'}]};
  createBasicMotionSpan(p,['track'],0,8,'linear',{paint:true,gradientPremultiplied:true});
  setRememberedColorKey(p,['track'],0,8,0,4,'#00ff00');
  expect(layer.keys[2].shapes[0].gradient!.stops[0]).toEqual({offset:0,color:'#00ff00',opacity:0.25});
  setRememberedIntervalTiming(p,['track'],0,8,0,8,'out');
  const expected={offset:0,color:'#db2400',opacity:0.75};
  expect(layer.keys[6].shapes[0].gradient!.stops[0]).toEqual(expected);
  const reversed=structuredClone(p);
  reverseBasicMotionSpan(reversed,['track'],0,8);
  refreshBasicMotionSpan(reversed,['track'],0,8);
  expect(reversed.layers[0].keys[2].shapes[0].gradient!.stops[0]).toEqual(expected);
  retimeBasicMotionSpan(p,['track'],0,8,5);
  expect(layer.keys[3].shapes[0].gradient!.stops[0]).toEqual(expected);
});

it('restricts custom keyed position timing repeatedly and independently across both axes',()=>{
  const cubic={kind:'cubic' as const,x1:1/3,y1:0,x2:2/3,y2:0};
  const p=liveSplitFixture((_p,s)=>{
    s.xKeys=[{offset:4,value:72}];s.xKeyEases=[cubic,'out'];
    s.yKeys=[{offset:6,value:60}];s.yKeyEases=['in','linear'];
  });
  const row=p.layers[0].liveMotionSpans![0],samples=Array.from({length:9},(_,i)=>sampleMotionFrame(p,'track',row,i)[0]);
  expect(samples[2].x).toBeCloseTo(16,10);expect(samples[4].x).toBe(72);expect(samples[6].x).toBe(84);
  expect(samples[3].y).toBeCloseTo(24,10);expect(samples[6].y).toBe(60);
  let edited=p;
  for(const at of [2,4,6])edited=prepareTimelineFrameInsertion(edited,'track',at,'key');
  for(let i=0;i<=8;i++){
    const half=edited.layers[0].liveMotionSpans!.find(s=>i>=s.start&&i<=s.end)!;
    const shape=sampleMotionFrame(edited,'track',half,i)[0];
    expect(shape.x).toBeCloseTo(samples[i].x,11);expect(shape.y).toBeCloseTo(samples[i].y,11);
  }
  expect(edited.layers[0].keys.map(k=>k.frame)).toEqual([0,2,4,6,8,10]);
  const before=structuredClone(p);
  for(const invalid of [[],['linear'],['linear',{...cubic,y1:NaN}]]){
    expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:row.id,changes:{xKeyEases:invalid as typeof row.xKeyEases}}])).toThrow();
  }
  expect(p).toEqual(before);
});

it('preserves eased remembered intervals across split, refresh, reversal and retiming',()=>{
  const p=liveSplitFixture(), layer=p.layers[0];
  delete layer.liveMotionSpans;
  createBasicMotionSpan(p,['track'],0,8,'linear');
  setRememberedPositionKey(p,['track'],0,8,'x',4,72);
  const untouched=structuredClone(layer.keys);
  setRememberedPositionTiming(p,['track'],0,8,'x',4,'in');
  setRememberedPositionTiming(p,['track'],0,8,'x',8,'out');
  expect(layer.keys[2].shapes[0].x).toBe(24);
  expect(layer.keys[6].shapes[0].x).toBe(84);
  expect(layer.keys.map(key=>key.shapes[0]?.y)).toEqual(untouched.map(key=>key.shapes[0]?.y));
  const before=structuredClone(p);
  expect(()=>setRememberedPositionTiming(p,['track'],0,8,'x',3,'out')).toThrow(/interval/);
  expect(()=>setRememberedPositionTiming(p,['track'],0,8,'y',8,'in')).toThrow(/interval/);
  expect(p).toEqual(before);
  const reversed=structuredClone(p);
  reverseBasicMotionSpan(reversed,['track'],0,8);
  refreshBasicMotionSpan(reversed,['track'],0,8);
  expect(reversed.layers[0].keys[2].shapes[0].x).toBe(84);
  const retimed=structuredClone(p);
  retimeBasicMotionSpan(retimed,['track'],0,8,5);
  expect(retimed.layers[0].keys[1].shapes[0].x).toBe(24);
  splitBasicMotionSpan(p,['track'],0,8,2,true);
  splitBasicMotionSpan(p,['track'],2,8,4,true);
  for(const [a,b] of [[0,2],[2,4],[4,8]]) refreshBasicMotionSpan(p,['track'],a,b);
  for(let i=0;i<=8;i++) expect(layer.keys[i].shapes[0].x).toBeCloseTo(before.layers[0].keys[i].shapes[0].x,10);
  setRememberedPositionKey(before,['track'],0,8,'x',4,null);
  expect(before.layers[0].motionSpans![0].xKeyEases).toBeUndefined();
});

it('rejects a missing interval on the second remembered track before publishing either edit',()=>{
  const p=liveSplitFixture(),layer=p.layers[0];
  delete layer.liveMotionSpans;
  const second=structuredClone(layer);
  second.id='second';
  p.layers.push(second);
  createBasicMotionSpan(p,['track','second'],0,8,'linear');
  setRememberedPositionKey(p,['track'],0,8,'x',4,72);
  setRememberedPositionKey(p,['second'],0,8,'x',6,72);
  const before=structuredClone(p);
  expect(()=>setRememberedPositionTiming(p,['track','second'],0,8,'x',4,'in')).toThrow(/interval/);
  expect(p).toEqual(before);
  let reads=0;
  const malformed={kind:'cubic' as const,get x1(){reads++;return 0.3},x2:0.7,y1:0,y2:1};
  expect(()=>setRememberedPositionTiming(p,['track'],0,8,'x',4,malformed)).toThrow();
  expect(reads).toBe(0);
  expect(p).toEqual(before);
});

it('preserves independent live opacity and multi-turn rotation curves through repeated cuts',()=>{
  const p=liveSplitFixture((_p,span)=>{
    span.opacityKeys=[{offset:4,value:0}];
    span.rotationKeys=[{offset:4,value:480}];
    span.opacityKeyEases=['in','linear'];
    span.rotationKeyEases=['out',{kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:0}];
  });
  const row=p.layers[0].liveMotionSpans![0];
  const samples=Array.from({length:9},(_,i)=>sampleMotionFrame(p,'track',row,i)[0]);
  expect(samples[2]).toMatchObject({rotation:360,opacity:0.75});
  expect(samples[4]).toMatchObject({rotation:480,opacity:0});
  expect(samples[6].rotation).toBeCloseTo(420,10);
  let split=p;
  for(const at of [2,4,6])split=prepareTimelineFrameInsertion(split,'track',at,'key');
  for(let i=0;i<=8;i++){
    const half=split.layers[0].liveMotionSpans!.find(s=>s.start<=i&&i<=s.end)!;
    const artwork=sampleMotionFrame(split,'track',half,i)[0];
    expect(artwork.rotation).toBeCloseTo(samples[i].rotation,10);
    expect(artwork.opacity).toBeCloseTo(samples[i].opacity!,10);
  }
  const original=structuredClone(p);
  expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:row.id,changes:{rotationKeyEases:['out'],opacityKeyEases:['in','in']}}])).toThrow();
  expect(p).toEqual(original);
});

it('rejects a missing keyed opacity interval on a later remembered track atomically',()=>{
  const p=liveSplitFixture(),first=p.layers[0];
  delete first.liveMotionSpans;
  p.layers.push({...structuredClone(first),id:'other'});
  const ids=['track','other'];
  createBasicMotionSpan(p,ids,0,8,'linear');
  setRememberedOpacityKey(p,['track'],0,8,4,0.25);
  const before=structuredClone(p);
  expect(()=>setRememberedIntervalTiming(p,ids,0,8,'opacity',4,'out')).toThrow(/existing opacity interval/);
  expect(p).toEqual(before);
});

it('preserves eased fill and stroke samples on a qualified split and rejects rounded color drift',()=>{
  const p=liveSplitFixture((project,span)=>{
    span.options={paint:true,strokeColor:true};
    for(const key of project.layers[0].keys.slice(0,2))key.shapes[0].fill='#000000';
    span.fillColorKeys=[{offset:4,color:'#c00000'}];span.fillKeyEases=['in','linear'];
    span.strokeColorKeys=[{offset:4,color:'#00c000'}];span.strokeKeyEases=['out','linear'];
  });
  const layer=p.layers[0],row=layer.liveMotionSpans![0];
  const before=structuredClone(p);
  expect(sampleMotionFrame(p,'track',row,2)[0]).toMatchObject({fill:'#300000',stroke:'#009000'});
  const split=splitLiveMotionLayer(p,layer,row,2,'right'), next={...p,layers:[split]};
  for(let frame=0;frame<=8;frame++){
    const half=split.liveMotionSpans![frame<=2?0:1];
    const pose=sampleMotionFrame(p,'track',row,frame)[0];
    expect(sampleMotionFrame(next,'track',half,frame)[0]).toMatchObject({fill:pose.fill,stroke:pose.stroke});
  }
  expect(()=>prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:row.id,changes:{fillKeyEases:['out'],strokeKeyEases:['out','in']}}])).toThrow();
  expect(p).toEqual(before);
  const drift=prepareUpdateLiveMotionSpans(p,[{layerId:'track',spanId:row.id,changes:{fillColorKeys:[{offset:4,color:'#010000'}],fillKeyEases:['linear','in']}}]);
  const original=structuredClone(drift);
  expect(()=>splitLiveMotionLayer(drift,drift.layers[0],drift.layers[0].liveMotionSpans![0],2,'right')).toThrow();
  expect(drift).toEqual(original);
});

it('rejects a missing remembered stroke interval on the last selected layer without changing the first',()=>{
  const p=liveSplitFixture(),layer=p.layers[0],ids=['track','second'];
  delete layer.liveMotionSpans;
  p.layers.push({...structuredClone(layer),id:'second'});
  createBasicMotionSpan(p,ids,0,8,'linear',{strokeColor:true});
  setRememberedColorKey(p,['track'],0,8,'stroke',4,'#00c000');
  const before=structuredClone(p);
  expect(()=>setRememberedIntervalTiming(p,ids,0,8,'stroke',4,'out')).toThrow(/existing stroke interval/);
  expect(p).toEqual(before);
  setRememberedIntervalTiming(p,['track'],0,8,'stroke',4,'out');
  expect(layer.keys[2].shapes[0].stroke).toBe('#009000');
  expect(layer.motionSpans![0].options).toEqual(before.layers[0].motionSpans![0].options);
});

it('rejects a remembered color split when the rounded endpoint changes another frame',()=>{
  const p=liveSplitFixture(),layer=p.layers[0],ids=['track'];
  delete layer.liveMotionSpans;
  for(const key of layer.keys.slice(0,2))key.shapes[0].fill='#000000';
  createBasicMotionSpan(p,ids,0,8,'linear',{paint:true});
  setRememberedColorKey(p,ids,0,8,'fill',4,'#010000');
  setRememberedIntervalTiming(p,ids,0,8,'fill',4,'out');
  const before=structuredClone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,8,2,true)).toThrow(/rounded fill color/);
  expect(p).toEqual(before);
});
