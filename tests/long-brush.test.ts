import { expect, it, vi } from 'vitest';
import type { Vector } from '../packages/document/src';
import { mergeVectors, prepareBrushSweep } from '../packages/geometry/src/merge';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { finishBrushPaint, prepareBrushFinisher } from '../packages/geometry/src/brush-finish';
import { brushNib, smoothBrushSamples } from '../packages/geometry/src/pressure';
import { containsPoint, normalizeVector, worldPaths } from '../packages/geometry/src/drawing';
import { hit, segmentDistance } from '../packages/geometry/src';
import { editorPreferenceDefaults } from '../apps/editor/src/editor-preferences';
import { fitBrushCenterline, fitVariablePressureBrushCenterline } from '../packages/geometry/src/brush-centerline';
import { optimizeNewPaint } from '../packages/geometry/src/stroke-optimize';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { traceRoundBrush } from '../packages/geometry/src/round-brush-trace';
import { certifyRoundBrushFootprint, prepareTracedRoundBrush } from '../packages/geometry/src/round-brush-fit';
import * as contactFit from '../packages/geometry/src/brush-contact-fit';
import { healDeletedInk } from '../packages/geometry/src/join-recolored-fills';
import * as pathEdit from '../packages/geometry/src/path-edit';

const { prepareBrushContactFit } = contactFit;

const count = (art:Vector[]) => art.reduce((sum, shape) => sum + (shape.contours?.flat().length ?? 0), 0);

function firmWaveGesture(): Vector {
  const points=Array.from({length:4500},(_,i)=>({
    x:i*.9,y:150+40*Math.sin(i/60),pressure:.25+.3*(1+Math.sin(i/67)),
  }));
  return {kind:'brush',id:'firm-wave',x:0,y:0,width:4100,height:300,rotation:0,
    fill:'#552211',stroke:'#000000',strokeWidth:24,points,
    brush:{pressure:true,minimum:.1,aspect:1,angle:0,tilt:false,response:2}};
}

function firmWaveSweep() {
  const brush=firmWaveGesture();
  brush.points=smoothBrushSamples(brush.points,.5);
  normalizeVector(brush);
  return {brush,sweep:prepareBrushSweep(brush)};
}

it('keeps the actual dense firm-pressure self-contact without attempting impossible fits', () => {
  const {brush,sweep}=firmWaveSweep();
  const footprints=sweep.merge();
  expect(footprints).toHaveLength(1);
  const [outline]=footprints;
  const ring=outline.contours![0], raw=structuredClone(outline);
  expect(ring.length).toBeGreaterThan(20000);
  const contact=ring.findIndex((p,i)=>i+3<ring.length&&p.x===ring[i+3].x&&p.y===ring[i+3].y);
  expect(contact).toBeGreaterThanOrEqual(0);
  const [p,a,b]=ring.slice(contact,contact+3);
  expect((a.x-p.x)*(b.y-p.y)-(a.y-p.y)*(b.x-p.x)).not.toBe(0);

  const attempts=vi.spyOn(pathEdit,'preparePathSimplification');
  try {
    expect(prepareBrushFinisher({brush,amount:.5},sweep.sample)([outline])[0]).toBe(outline);
    expect(attempts).not.toHaveBeenCalled();
    expect(outline).toEqual(raw);
  } finally {
    attempts.mockRestore();
  }
},15000);

it('fits the firm-pressure boundary with the exact triangle and both visits retained', () => {
  const {sweep}=firmWaveSweep();
  const [outline]=sweep.merge();
  const snapshot=structuredClone(outline), ring=outline.contours![0];
  const contact=ring.findIndex((p,i)=>i+3<ring.length&&p.x===ring[i+3].x&&p.y===ring[i+3].y);
  const fitted=prepareBrushContactFit(outline,.5)!;
  expect(fitted).toBeDefined();
  const [main,lobe]=fitted.contours!;
  const result=[...lobe,...main];
  expect(result.length).toBeLessThan(ring.length/50);
  expect(result.slice(0,4)).toEqual(ring.slice(contact,contact+4));
  expect(result.slice(0,4).every((node,i)=>node!==ring[contact+i])).toBe(true);
  expect(result.filter(node=>node.x===result[0].x&&node.y===result[0].y)).toHaveLength(2);
  expect(result.some(node=>node.in&&node.out)).toBe(true);
  expect({...fitted,contours:undefined}).toEqual({...snapshot,contours:undefined});

  const [a,b,c] = result;
  const centroid={x:outline.x+(a.x+b.x+c.x)/3,y:outline.y+(a.y+b.y+c.y)/3};
  const [before]=worldPaths(outline,.005), [after,lobePath]=worldPaths(fitted,.005);
  const covered = (point:typeof centroid) => containsPoint(after,point) !== containsPoint(lobePath,point);
  expect(covered(centroid)).toBe(containsPoint(before,centroid));
  for (let dy=-.12;dy<=.12;dy+=.005) {
    for (let dx=-.1;dx<=.1;dx+=.005) {
      const point={x:centroid.x+dx,y:centroid.y+dy};
      expect(covered(point)).toBe(containsPoint(before,point));
    }
  }
  expect(outline).toEqual(snapshot);
},15000);

it('rejects an ambiguous contact or invalid original fit request without editing the boundary', () => {
  const outline:Vector={kind:'polygon',id:'contact',x:0,y:0,width:16,height:16,rotation:0,
    fill:'#552211',stroke:'#000000',strokeWidth:0,points:[],closed:true,fillRule:'evenodd',contours:[[
      {x:0,y:0},{x:-2,y:0},{x:-1,y:0},{x:0,y:0},{x:8,y:0},{x:8,y:8},{x:0,y:8},
    ]]};
  const snapshot=structuredClone(outline);
  expect(prepareBrushContactFit(outline,1)).toBeUndefined();
  expect(outline).toEqual(snapshot);
  const ring=outline.contours![0];
  ring[2].y=1;
  ring.push({...ring[4]});
  expect(prepareBrushContactFit(outline,1)).toBeUndefined();
  let reads=0;
  Object.defineProperty(outline,'contours',{get:()=>{ reads++; return [ring]; }});
  expect(prepareBrushContactFit(outline,1)).toBeUndefined();
  expect(reads).toBe(0);
});
it.each(['empty','different','matching'] as const)('edits the compact pressure stroke on %s paint', background => {
  const brush=firmWaveGesture();
  const base:Vector={kind:'rectangle',id:'under',x:800,y:135,width:30,height:110,rotation:0,
    points:[],fill:background==='matching'?brush.fill:'#2877a0',stroke:'#000000',strokeWidth:0,drawingMode:'merge'};
  const prior=background==='empty'?[]:[base], snapshot=structuredClone(prior);
  const committed=prepareBrushPaint(prior,{brush,amount:.5,optimize:true,merge:true,
    mode:'normal',at:prior.length,selected:[]});
  expect(committed.retainedOverlap).toBeUndefined();
  expect(count(committed.shapes)).toBeLessThan(500);
  const center={x:815,y:150+40*Math.sin(815/54)};
  const above={x:815,y:151}, below={x:815,y:225};
  const owner = (art:Vector[], point:typeof center) =>
    art.filter(s=>!s.strokeWidth && hit(s,point,0));
  expect(owner(committed.shapes,center).map(s=>s.fill)).toEqual([brush.fill]);
  if (background==='different') {
    expect(owner(committed.shapes,above).map(s=>s.fill)).toEqual([base.fill]);
    expect(owner(committed.shapes,below).map(s=>s.fill)).toEqual([base.fill]);
    expect(owner(committed.shapes,above)[0]).not.toBe(owner(committed.shapes,below)[0]);
  } else if (background==='matching') {
    expect(owner(committed.shapes,below)).toEqual(owner(committed.shapes,center));
  }

  const ink:Vector={kind:'path',id:'divider',x:0,y:0,width:0,height:0,rotation:0,
    points:[{x:600,y:70},{x:600,y:220}],fill:'#000000',stroke:'#000000',strokeWidth:2,fillEnabled:false};
  const cut=preparePencilDrawing(committed.shapes,{stroke:ink,mode:'ink',merge:true});
  expect(cut.retainedOverlap).toBeUndefined();
  const wave=(x:number)=>({x,y:150+40*Math.sin(x/54)});
  const left=owner(cut.shapes,wave(595)), right=owner(cut.shapes,wave(605));
  expect(left).toHaveLength(1);
  expect(right).toHaveLength(1);
  expect(left[0]).not.toBe(right[0]);
  // The divider divides the paint and stays one line: only another line cuts it.
  const dividers=cut.shapes.filter(s=>s.strokeWidth);
  expect(dividers).toHaveLength(1);
  expect(dividers.every(s=>s.fillEnabled===false && (s.kind==='path'||s.kind==='bezier'))).toBe(true);
  expect(prior).toEqual(snapshot);
},15000);
it('recuts the compact pressure contour after removing Pencil dividers', () => {
  const brush=firmWaveGesture();
  const committed=prepareBrushPaint([],{brush,amount:.5,optimize:true,merge:true,mode:'normal',at:0,selected:[]});
  const [paint]=committed.shapes;
  const [,lobe]=worldPaths(paint,.005);
  const pencil=(artwork:Vector[], x:number)=>{
    const stroke:Vector={kind:'path',id:'divider-'+x,x:0,y:0,width:0,height:0,rotation:0,
      points:[{x,y:65},{x,y:230}],fill:'#000000',stroke:'#000000',strokeWidth:2,fillEnabled:false};
    const cut=preparePencilDrawing(artwork,{stroke,mode:'ink',merge:true});
    expect(cut.retainedOverlap).toBeUndefined();
    return cut.shapes;
  };
  const faces=(artwork:Vector[])=>artwork.filter(shape=>!shape.strokeWidth);
  const first=pencil(committed.shapes,600), both=pencil(first,1275);
  expect(faces(first)).toHaveLength(2);
  expect(faces(both)).toHaveLength(3);
  const ink=both.filter(shape=>shape.strokeWidth>0);
  const healed=healDeletedInk(faces(both),ink);
  expect(healed).toHaveLength(1);
  const reopened=JSON.parse(JSON.stringify(healed)) as Vector[];
  expect(faces(pencil(reopened,600))).toHaveLength(2);
  // The sweep's second contour is a zero-width sliver. The planar merge welds points closer than
  // SNAP, so such a sliver closes up once the paint is cut and healed.
  const sliver=lobe.reduce((sum,p,i)=>{const q=lobe[(i+1)%lobe.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
  expect(Math.abs(sliver)).toBeLessThan(0.01);
},15000);
it('reuses the complete original pressure sweep when fitted placement rejects', () => {
  const brush=firmWaveGesture();
  const base:Vector={kind:'rectangle',id:'under',x:800,y:135,width:30,height:110,rotation:0,
    points:[],fill:'#2877a0',stroke:'#000000',strokeWidth:0,drawingMode:'merge'};
  const request={brush,amount:.5,optimize:true,merge:true,mode:'normal' as const,at:1,selected:[]};
  const fit=vi.spyOn(contactFit,'prepareBrushContactFit').mockReturnValueOnce(undefined);
  try {
    const original=prepareBrushPaint([base],request);
    expect(original.retainedOverlap).toBeUndefined();
    expect(count(original.shapes)).toBeGreaterThan(20000);
    fit.mockImplementationOnce((source,tolerance)=>{
      const compact=prepareBrushContactFit(source,tolerance)!;
      const [main,lobe]=compact.contours!;
      return {...compact,contours:[[...lobe,...main]]};
    });
    const phases:string[]=[];
    const retried=prepareBrushPaint([base],request,phase=>phases.push(phase));
    expect(phases.filter(phase=>phase==='paint')).toHaveLength(2);
    expect(retried.retainedOverlap).toBeUndefined();
    expect(retried.shapes.map(shape=>worldPaths(shape,.005))).toEqual(
      original.shapes.map(shape=>worldPaths(shape,.005)));
  } finally { fit.mockRestore(); }
},15000);
it('still attempts a dense fit when the only repeated vertices are closure duplicates', () => {
  const ring=Array.from({length:8250},(_,i)=>{
    const angle=i*Math.PI*2/8250;
    return {x:90+80*Math.cos(angle),y:90+80*Math.sin(angle)};
  });
  ring.push({...ring[0]},{...ring[0]});
  const outline:Vector={kind:'polygon',id:'dense-closed',x:0,y:0,width:180,height:180,rotation:0,
    fill:'#552211',stroke:'#000000',strokeWidth:0,points:[],closed:true,fillRule:'evenodd',contours:[ring]};
  const brush:Vector={...outline,kind:'brush',strokeWidth:24,contours:undefined};
  const attempts=vi.spyOn(pathEdit,'preparePathSimplification');
  try {
    prepareBrushFinisher({brush,amount:.5},()=>[ring])([outline]);
    expect(attempts).toHaveBeenCalledTimes(2);
  } finally {
    attempts.mockRestore();
  }
});

it('bounds changing round Brush width and retains the stationary pressure transition exactly', () => {
  const approach = Array.from({length:161},(_,x)=>({x,y:18*Math.sin(x/24),pressure:.25+x/1600}));
  const stop = {...approach.at(-1)!,pressure:.8,tiltX:12};
  const restart = Array.from({length:160},(_,index)=>{
    const distance = index+1;
    return {x:stop.x+distance,y:stop.y+distance*.75-2*Math.max(0,distance-80),pressure:.8-distance/1600};
  });
  const brush:Vector = {kind:'brush',id:'pressure-fit',x:0,y:0,width:320,height:90,rotation:0,
    points:[...approach,stop,...restart],fill:'#0088ff',stroke:'#000000',strokeWidth:24};
  const snapshot = structuredClone(brush);
  const result = fitVariablePressureBrushCenterline(brush,.5)!;
  expect(result).toBeDefined();
  expect(result.length).toBeLessThan(brush.points.length/2);
  expect(result.filter(p=>p.x===stop.x)).toEqual([approach.at(-1),stop]);
  expect(result[0]).toEqual(brush.points[0]);
  expect(result.at(-1)).toEqual(brush.points.at(-1));
  const compare = (points:Vector['points'], x:number) => {
    const index = points.findIndex(p=>p.x>=x);
    const a = points[index-1], b = points[index], t=(x-a.x)/(b.x-a.x);
    const radius = brushNib(brush,a).rx*(1-t)+brushNib(brush,b).rx*t;
    return {y:a.y+(b.y-a.y)*t,radius};
  };
  let maxError = 0;
  for (let x=.25;x<320;x+=.25) {
    const expected = compare(brush.points,x), actual = compare(result,x);
    maxError = Math.max(maxError,Math.abs(expected.y-actual.y)+Math.abs(expected.radius-actual.radius));
  }
  expect(maxError).toBeLessThan(.3);
  const sourcePaint = mergeVectors([brush]);
  const fittedPaint = mergeVectors([{...brush,points:result}]);
  expect(sourcePaint).toHaveLength(1);
  expect(fittedPaint).toHaveLength(1);
  expect(certifyRoundBrushFootprint(sourcePaint[0],fittedPaint[0],1)).toBe(true);
  expect(brush).toEqual(snapshot);
  expect(fitBrushCenterline(brush,.5)).toBeUndefined();
});

it('retains the input edges of a sharp pressure spike while fitting either side', () => {
  const brush:Vector = {kind:'brush',id:'pressure-spike',x:0,y:0,width:320,height:0,rotation:0,
    points:Array.from({length:321},(_,x)=>({x,y:0,pressure:x===155?1:.25})),
    fill:'#0088ff',stroke:'#000000',strokeWidth:24};
  const snapshot = structuredClone(brush);
  const fit = fitVariablePressureBrushCenterline(brush,.5)!;
  expect(fit).toBeDefined();
  expect(fit.length).toBeLessThan(10);
  expect(fit.filter(point=>point.x>=154 && point.x<=156)).toEqual(brush.points.slice(154,157));
  const [source] = mergeVectors([brush]);
  const [candidate] = mergeVectors([{...brush,points:fit}]);
  expect(certifyRoundBrushFootprint(source,candidate,1)).toBe(true);
  expect(hit(candidate,{x:155,y:9},0)).toBe(true);
  expect(hit(candidate,{x:120,y:9},0)).toBe(false);
  expect(brush).toEqual(snapshot);
});

it.each([.25,.5,2,4])('bounds nonlinear round Brush width and preserves a stationary spike (response %s)', response=>{
  const transition = 145;
  const before = Array.from({length:transition+1},(_,x)=>({
    x,y:8*Math.sin(x/26),pressure:.16+x/620+.0008*Math.sin(x/11),
  }));
  const stop = {...before.at(-1)!,pressure:.86,twist:12};
  const after = Array.from({length:170},(_,i)=>{
    const x=transition+i+1;
    return {x,y:8*Math.sin(x/26),pressure:.86-(i+1)/550+.0008*Math.sin((i+1)/11)};
  });
  const brush: Vector = {kind:'brush',id:'nonlinear-fit',x:0,y:0,width:315,height:16,rotation:0,
    fill:'#0088ff',stroke:'#000000',strokeWidth:24,points:[...before,stop,...after],
    brush:{pressure:true,minimum:.2,aspect:1,angle:0,tilt:false,response}};
  const snapshot = structuredClone(brush);
  const fit=fitVariablePressureBrushCenterline(brush,.5)!;
  expect(fit).toBeDefined();
  expect(fit.length).toBeLessThan(brush.points.length/2);
  expect(fit.filter(point=>point.x===transition)).toEqual([before.at(-1),stop]);
  expect(fit[0]).toEqual(brush.points[0]);
  expect(fit.at(-1)).toEqual(brush.points.at(-1));
  const allowance=Math.min(.75,...brush.points.map(p=>brushNib(brush,p).rx/12));
  const at = (points: Vector['points'], x: number) => {
    const index=points.findIndex(p=>p.x>=x), a=points[index-1], b=points[index];
    const t=(x-a.x)/(b.x-a.x);
    const pressure=a.pressure!+(b.pressure!-a.pressure!)*t;
    return { y:a.y+(b.y-a.y)*t, radius:brushNib(brush,{x,y:0,pressure}).rx };
  };
  let largestWidthError = 0;
  for(let x=.125;x<315;x+=.125) {
    if (x===transition) continue;
    const source=at(brush.points,x), fitted=at(fit,x);
    const widthError = Math.abs(source.radius-fitted.radius);
    largestWidthError = Math.max(largestWidthError,widthError);
    expect(Math.abs(source.y-fitted.y)+widthError)
      .toBeLessThanOrEqual(allowance+1e-10);
  }
  expect(largestWidthError).toBeGreaterThan(.0001);
  const [source] = mergeVectors([brush]);
  const [candidate] = mergeVectors([{...brush,points:fit}]);
  expect(certifyRoundBrushFootprint(source,candidate,1)).toBe(true);
  expect(brush).toEqual(snapshot);
});

it('bounds a soft response at zero without removing its initial width change', ()=>{
  const brush:Vector={kind:'brush',id:'soft-at-zero',x:0,y:0,width:320,height:0,rotation:0,
    fill:'#0088ff',stroke:'#000000',strokeWidth:24,
    points:Array.from({length:321},(_,x)=>({x,y:0,pressure:x*.005/320})),
    brush:{pressure:true,minimum:.1,aspect:1,angle:0,tilt:false,response:.25}};
  const fitted=fitVariablePressureBrushCenterline(brush,.5)!;
  expect(fitted).toBeDefined();
  expect(fitted.length).toBeLessThan(brush.points.length);
  expect(fitted.slice(0,2)).toEqual(brush.points.slice(0,2));
  const [source]=mergeVectors([brush]);
  const [candidate]=mergeVectors([{...brush,points:fitted}]);
  expect(certifyRoundBrushFootprint(source,candidate,1)).toBe(true);
});

it('retains a firm pressure trace when the reduced centerline cannot certify the width peaks', ()=>{
  const brush:Vector={kind:'brush',id:'firm-peaks',x:0,y:0,width:320,height:0,rotation:0,
    fill:'#0088ff',stroke:'#000000',strokeWidth:24,
    points:Array.from({length:321},(_,x)=>({x,y:0,pressure:x%2 ? .82 : .8})),
    brush:{pressure:true,minimum:.1,aspect:1,angle:0,tilt:false,response:4}};
  const before=structuredClone(brush);
  const radius=brushNib(brush,brush.points[0]).rx;
  const nextRadius=brushNib(brush,brush.points[1]).rx;
  expect(nextRadius-radius).toBeLessThanOrEqual(radius/12);
  expect(fitVariablePressureBrushCenterline(brush,.5)).toBeUndefined();
  expect(brush).toEqual(before);
});

it('leaves invalid response, unsupported nibs and invalid pressure on the existing sweep', () => {
  const brush:Vector = {kind:'brush',id:'pressure-ramp',x:0,y:0,width:320,height:0,rotation:0,
    points:Array.from({length:321},(_,x)=>({x,y:0,pressure:.25+x/640})),
    fill:'#0088ff',stroke:'#000000',strokeWidth:24};
  const snapshot = structuredClone(brush);
  const nib={pressure:true,minimum:.1,aspect:1,angle:0,tilt:false};
  for (const response of [NaN, Infinity, .24, 4.01])
    expect(fitVariablePressureBrushCenterline({...brush,brush:{...nib,response}},.5)).toBeUndefined();
  expect(fitVariablePressureBrushCenterline({...brush,brush:{...nib,response:2,twist:true}},.5)).toBeUndefined();
  expect(fitVariablePressureBrushCenterline({...brush,brush:{...nib,response:.5,aspect:.8}},.5)).toBeUndefined();
  expect(fitVariablePressureBrushCenterline({...brush,brush:{...nib,minimum:NaN,response:.5}},.5)).toBeUndefined();
  const missingMinimum = {...nib,response:.5};
  Reflect.deleteProperty(missingMinimum,'minimum');
  expect(fitVariablePressureBrushCenterline({...brush,brush:missingMinimum},.5)).toBeUndefined();
  const invalid = {...brush,points:[...brush.points,{x:322,y:0,pressure:Infinity}]};
  expect(fitVariablePressureBrushCenterline(invalid,.5)).toBeUndefined();
  expect(brush).toEqual(snapshot);
});

it.each([false,true])('finishes a long stroke above the standard fit sample limit (looping %s)', looping => {
  const {brushSize, brushSmoothing, brushOptimize} = editorPreferenceDefaults;
  const points = Array.from({length:looping ? 3500 : 4500}, (_,i) => {
    const x = i*.9, y = 150 + 40 * Math.sin(i/60);
    return looping
      ? {x:x + 40*Math.sin(i/17), y:y + 40*Math.cos(i/17)}
      : {x:Math.round(x), y:Math.round(y)};
  });
  const brush: Vector = {kind:'brush',id:'long',x:0,y:0,rotation:0,width:4100,height:300,
    points,fill:'#0088ff',stroke:'#000000',strokeWidth:brushSize};
  const amount = brushSmoothing / 100;
  const smoothed = {...brush,points:smoothBrushSamples(points,amount)};
  const raw = mergeVectors([smoothed]);
  const centerline = fitBrushCenterline(smoothed,amount);
  expect(centerline).toBeDefined();
  expect(centerline!.length).toBeLessThan(points.length / 2);
  expect(centerline![0]).toEqual({...points[0],pressure:1});
  expect(centerline!.at(-1)).toEqual({...points.at(-1),pressure:1});
  expect(fitBrushCenterline({...brush,points:points.map((p,i)=>i===1 ? {...p,pressure:0.3} : p)},amount))
    .toBeUndefined();
  expect(raw).toHaveLength(1);
  expect(count(raw)).toBeGreaterThan(8192);
  const simplified = finishBrushPaint(raw,{brush,amount});
  expect(count(simplified)).toBeLessThan(count(raw) / 12);
  const snapshot = structuredClone(brush);
  const result = prepareBrushPaint([], {brush,mode:'normal',merge:true,amount,optimize:brushOptimize,selected:[],at:0});
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(1);
  const [shape] = result.shapes;
  expect(count(result.shapes)).toBeLessThan(count(optimizeNewPaint(simplified)) * .92);
  expect(count(result.shapes)).toBeLessThan(looping ? 650 : 110);
  expect(shape.contours).toHaveLength(raw[0].contours!.length);
  expect(shape.contours!.length > 1).toBe(looping);
  expect(shape.contours![0].some(n=>n.in || n.out)).toBe(true);
  expect(brush).toEqual(snapshot);
  const before = worldPaths(raw[0], .05), after = worldPaths(shape, .05);
  const edgeDistance = (ring: typeof points, point: typeof points[number]) =>
    ring.slice(1).reduce((distance,p,i)=>Math.min(distance,segmentDistance(point,ring[i],p)), Infinity);
  const covers = (rings: typeof before, point: typeof points[number]) =>
    rings.reduce((inside, ring)=>inside !== containsPoint(ring,point), false);
  for (let x = 11; x < (looping ? 3150 : 4050); x += 71) for (let y = 24; y < 275; y += 17) {
    const p = {x,y};
    if (before.every(r=>edgeDistance(r,p) > 2)) expect(covers(after,p)).toBe(covers(before,p));
  }
  if (!looping) return;

  const target:Vector = {kind:'rectangle',id:'lower',x:5,y:165,width:25,height:70,rotation:0,
    fill:'#aa1133',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge'};
  const settings = {brush,mode:'normal' as const,merge:true,amount,optimize:brushOptimize,selected:[],at:1};
  const over = prepareBrushPaint([target], settings);
  expect(over.retainedOverlap).toBeUndefined();
  const shared = {x:15,y:191}, below = {x:18,y:225};
  expect(over.shapes.filter(s=>hit(s,shared,0)).map(s=>s.fill)).toEqual([brush.fill]);
  expect(over.shapes.filter(s=>hit(s,below,0)).map(s=>s.fill)).toEqual([target.fill]);
  const matching:Vector = {...target,fill:brush.fill};
  const same = prepareBrushPaint([matching], settings);
  expect(same.retainedOverlap).toBeUndefined();
  expect(same.shapes).toHaveLength(1);
  expect(hit(same.shapes[0],below,0)).toBe(true);
  expect(hit(same.shapes[0],shared,0)).toBe(true);
  const pencil:Vector = {kind:'path',id:'line',x:0,y:0,width:1,height:220,rotation:0,
    fill:'#000000',stroke:'#000000',strokeWidth:1,fillEnabled:false,
    points:[{x:0,y:40},{x:0,y:260}]};
  const partition = preparePencilDrawing(result.shapes,{stroke:pencil,mode:'ink',merge:true});
  expect(partition.retainedOverlap).toBeUndefined();
  expect(partition.shapes.filter(s=>!s.strokeWidth).length).toBeGreaterThan(1);
  expect(partition.shapes.filter(s=>s.strokeWidth).every(s=>s.fillEnabled===false)).toBe(true);
},15000);

it.each([40,40.25])('preserves the source loops in a sparsely sampled round Brush release (amplitude %s)', amplitude => {
  const points = Array.from({length:1751},(_,index) => {
    const i = Math.min(index * 2, 3499);
    return {x:i*.9+amplitude*Math.sin(i/17), y:150+40*Math.sin(i/60)+amplitude*Math.cos(i/17)};
  });
  const {brushSize, brushSmoothing, brushOptimize} = editorPreferenceDefaults;
  const brush:Vector = {kind:'brush',id:'sparse-loop',x:0,y:0,rotation:0,width:4100,height:300,
    points,fill:'#0088ff',stroke:'#000000',strokeWidth:brushSize};
  const snapshot = structuredClone(brush);
  const amount = brushSmoothing / 100;
  const smoothed = {...brush,points:smoothBrushSamples(points,amount)};
  normalizeVector(smoothed);
  const fitted = fitBrushCenterline(smoothed,amount)!;
  const fittedSweep = mergeVectors([{...smoothed,points:fitted}]);
  expect(fittedSweep).toHaveLength(1);
  expect(fittedSweep[0].contours).toHaveLength(34);
  expect(traceRoundBrush(fitted,brushSize/2,.44)).toBeUndefined();
  expect(traceRoundBrush(fitted,brushSize/2,.44,true)).toHaveLength(34);
  const [source] = mergeVectors([smoothed]);
  const holdsSourceTopology = amplitude === 40.25;
  expect(source.contours).toHaveLength(holdsSourceTopology?34:35);
  const candidate = prepareTracedRoundBrush(smoothed,fitted,amount,.44,fittedSweep[0])!;
  expect(count([candidate])).toBeLessThan(660);
  expect(certifyRoundBrushFootprint(source,candidate,1)).toBe(holdsSourceTopology);

  const result = prepareBrushPaint([], {brush,mode:'normal',merge:true,amount,optimize:brushOptimize,selected:[],at:0});
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(1);
  const [paint] = result.shapes;
  expect(paint.contours).toHaveLength(source.contours!.length);
  expect(paint.contours![0].some(node=>node.in || node.out)).toBe(true);
  if (holdsSourceTopology) {
    expect(count([paint])).toBeLessThan(660);
    expect(certifyRoundBrushFootprint(source,paint,1)).toBe(true);
  } else {
    const [fallback] = optimizeNewPaint(finishBrushPaint([source],{brush:smoothed,amount}));
    expect(worldPaths(paint,.005)).toEqual(worldPaths(fallback,.005));
  }
  const covers = (rings:typeof points[],point:typeof points[number]) =>
    rings.reduce((inside,ring)=>inside !== containsPoint(ring,point),false);
  const before = worldPaths(source,.025), after = worldPaths(paint,.025);
  for (let x=11;x<3150;x+=71) for (let y=24;y<275;y+=17) {
    const point = {x,y};
    if (before.every(ring=>ring.slice(1).every((b,i)=>segmentDistance(point,ring[i],b)>1.1)))
      expect(covers(after,point)).toBe(covers(before,point));
  }
  expect(brush).toEqual(snapshot);
},15000);

it('preserves a near-resolution hole when a round Brush retraces a tight circle', () => {
  const radius = 12.12;
  const points = Array.from({length:69},(_,i)=>{
    const angle = i*Math.PI/30;
    return {x:radius*Math.cos(angle),y:radius*Math.sin(angle)};
  });
  const {brushSize,brushSmoothing,brushOptimize} = editorPreferenceDefaults;
  const brush:Vector = {kind:'brush',id:'tight-retrace',x:0,y:0,width:0,height:0,rotation:0,
    points,fill:'#0088ff',stroke:'#000000',strokeWidth:brushSize};
  const snapshot = structuredClone(brush);
  const amount = brushSmoothing / 100;
  const smoothed = {...brush,points:smoothBrushSamples(points,amount)};
  normalizeVector(smoothed);
  const [source] = mergeVectors([smoothed]);
  expect(source.contours).toHaveLength(2);
  expect(fitBrushCenterline(smoothed,amount)).toBeUndefined();
  // A sampled trace without the tiny aperture cannot replace the sweep.
  const traced = traceRoundBrush(smoothed.points,brushSize/2,.44,true);
  expect(traced).toBeDefined();
  expect(traced).toHaveLength(1);

  const prepared = prepareBrushPaint([], {brush,amount,merge:true,optimize:brushOptimize,mode:'normal',selected:[],at:0});
  expect(prepared.retainedOverlap).toBeUndefined();
  expect(prepared.shapes).toHaveLength(1);
  const [paint] = prepared.shapes;
  expect(paint.contours).toHaveLength(2);
  expect(paint.contours![0].some(node=>node.in || node.out)).toBe(true);
  const [expected] = optimizeNewPaint(finishBrushPaint([source],{brush:smoothed,amount}));
  const boundary = worldPaths(paint,.005);
  expectStoredPinhole(paint, expected, boundary);
  const covers = (point:typeof points[number]) =>
    boundary.reduce((inside,ring)=>inside !== containsPoint(ring,point),false);
  expect(covers({x:0,y:0})).toBe(false);
  expect(covers({x:0,y:radius})).toBe(true);
  expect(covers({x:26,y:0})).toBe(false);
  expect(brush).toEqual(snapshot);
});

it('preserves a tight local Brush retrace after a long approach', () => {
  const radius = 12.12;
  const lead = Array.from({length:180},(_,i)=>({x:radius,y:i-180}));
  const turn = Array.from({length:69},(_,i)=>{
    const angle = i*Math.PI/30;
    return {x:radius*Math.cos(angle),y:radius*Math.sin(angle)};
  });
  const brush:Vector = {kind:'brush',id:'local-retrace',x:0,y:0,width:0,height:0,rotation:0,
    points:[...lead,...turn],fill:'#0088ff',stroke:'#000000',strokeWidth:24};
  const snapshot = structuredClone(brush);
  const amount = .5;
  const smoothed = {...brush,points:smoothBrushSamples(brush.points,amount)};
  normalizeVector(smoothed);
  const [source] = mergeVectors([smoothed]);
  expect(source.contours).toHaveLength(2);
  expect(fitBrushCenterline(smoothed,amount)).toBeUndefined();
  const result = prepareBrushPaint([], {brush,amount,merge:true,optimize:true,mode:'normal',selected:[],at:0});
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(1);
  const [paint] = result.shapes;
  expect(paint.contours).toHaveLength(2);
  const boundary = worldPaths(paint,.005);
  const [fallback] = optimizeNewPaint(finishBrushPaint([source],{brush:smoothed,amount}));
  expectStoredPinhole(paint, fallback, boundary);
  const covers = (point:typeof lead[number]) =>
    boundary.reduce((inside,ring)=>inside !== containsPoint(ring,point),false);
  expect(covers({x:0,y:0})).toBe(false);
  expect(covers({x:radius,y:-150})).toBe(true);
  expect(covers({x:0,y:radius})).toBe(true);
  expect(paint.contours![0].some(node=>node.in || node.out)).toBe(true);
  expect(brush).toEqual(snapshot);
});

function expectStoredPinhole(paint: Vector, original: Vector, boundary: ReturnType<typeof worldPaths>) {
  expect(original.contours![1]).toHaveLength(2);
  expect(paint.contours![1]).toHaveLength(3);
  const [exterior, pinhole] = worldPaths(original, .005);
  expect(boundary[0]).toEqual(exterior);
  expect(boundary[1]).toHaveLength(pinhole.length);
  for (const [i, point] of pinhole.entries()) {
    expect(boundary[1][i].x).toBeCloseTo(point.x, 12);
    expect(boundary[1][i].y).toBeCloseTo(point.y, 12);
  }
}

it('finishes the smoothed samples when neither lattice resolves a dense Brush contact', () => {
  const amplitude = 39.75;
  const points = Array.from({length:1751},(_,sample)=>{
    const i = Math.min(sample*2,3499);
    return {x:i*.9+amplitude*Math.sin(i/17),y:150+40*Math.sin(i/60)+amplitude*Math.cos(i/17)};
  });
  const brush:Vector = {kind:'brush',id:'dense-contact',x:0,y:0,width:0,height:0,rotation:0,
    points,fill:'#0088ff',stroke:'#000000',strokeWidth:24};
  const smoothed = {...brush, points:smoothBrushSamples(points,.5)};
  normalizeVector(smoothed);
  const snapshot = structuredClone(brush);
  const line = fitBrushCenterline(smoothed,.5)!;
  const fitted = mergeVectors([{...smoothed,points:line}]);
  expect(fitted[0].contours).toHaveLength(35);
  expect(traceRoundBrush(line,12,.44)).toBeUndefined();
  expect(traceRoundBrush(line,12,.44,true)).toBeUndefined();
  const source = mergeVectors([smoothed]);
  expect(source[0].contours).toHaveLength(34);
  const [finished] = optimizeNewPaint(finishBrushPaint(source,{brush:smoothed,amount:.5}));
  const settings = {brush,amount:.5,merge:true,optimize:true,mode:'normal' as const,selected:[],at:1};
  const blank = prepareBrushPaint([],settings);
  expect(blank.shapes).toHaveLength(1);
  expect(blank.retainedOverlap).toBeUndefined();
  expect(blank.shapes[0].contours).toHaveLength(34);
  expect(worldPaths(blank.shapes[0],.005)).toEqual(worldPaths(finished,.005));
  expect(blank.shapes[0].contours![0].some(node=>node.in || node.out)).toBe(true);

  const lower:Vector = {kind:'rectangle',id:'lower',x:5,y:165,width:25,height:70,rotation:0,
    fill:'#aa1133',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge'};
  const untouched:Vector = {kind:'polygon',id:'untouched',x:100,y:700,width:30,height:30,rotation:0,
    fill:'#225500',stroke:'#000000',strokeWidth:0,points:[],drawingMode:'merge',fillRule:'evenodd',closed:true,
    contours:[[{x:0,y:0,out:{x:15,y:-9}},{x:30,y:0,in:{x:21,y:-9}},{x:30,y:30},{x:0,y:30}]]};
  const before = structuredClone([lower,untouched]);
  const placed = prepareBrushPaint([lower,untouched],{...settings,at:2,removeCoveredStrokes:true});
  expect(placed.retainedOverlap).toBeUndefined();
  expect(placed.shapes.find(shape=>shape.id===untouched.id)).toEqual(before[1]);
  expect(placed.shapes.filter(shape=>hit(shape,{x:15,y:191},0)).map(shape=>shape.fill)).toEqual([brush.fill]);
  expect(placed.shapes.filter(shape=>hit(shape,{x:18,y:225},0)).map(shape=>shape.fill)).toEqual([lower.fill]);
  expect([lower,untouched]).toEqual(before);
  expect(brush).toEqual(snapshot);
},15000);
